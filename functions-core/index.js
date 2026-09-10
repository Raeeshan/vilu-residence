'use strict';
// Vilu Residence — Cloud Functions ("core" codebase)
//   blockDoubleBooking  server-side overlap backstop (create AND update)
//   publicBooking       trusted write path for the unauthenticated website (Stage 0 fix)
//   availabilityOnReservation / availabilityOnBlock  event-driven sellable-inventory derivation
//   nightlyReconcile    03:30 Indian/Maldives: full 730-day availability recompute
//
// Split out of the original single-codebase functions/index.js so this
// codebase never declares or evaluates an OTA secret (BEDS24_REFRESH_TOKEN,
// OTA_WEBHOOK_SECRET) — Cloud Functions v2 discovery loads and validates every
// declared secret across a whole codebase before applying --only filtering,
// so as long as those two secrets have no value set, a codebase that merely
// mentions them can't deploy anything at all, even functions that don't use
// them. This codebase contains zero reference to either secret by design.
// The OTA-facing functions (otaWebhook, processOtaEvent, otaCatchUp) live in
// the separate "ota" codebase (functions-ota/) and remain undeployed/disabled
// until real OTA credentials exist.
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');
const { FirestoreStore } = require('./lib/store-firestore');
const { writeReservationTx } = require('./lib/booking-core');
const { syncAvailability, FULL_HORIZON_DAYS } = require('./lib/availability');
const { PHYSICAL_ROOMS, addDays, dateRange, isActiveStatus, overlaps } = require('./lib/inventory');
// Beds24 differential-sync enqueue (2026-09-10 continuous-sync pass): this
// codebase computes WHICH room-type+dates are affected and writes a pending
// ota_pushes job -- it never calls the Beds24 API itself and never
// references BEDS24_REFRESH_TOKEN, preserving the secret-free "core" split
// explained above. The actual API call happens in the separate "ota"
// codebase's beds24OutboundWorker, triggered by the ota_pushes doc creation.
const { computeAffectedDates, buildBeds24PushRecord, BEDS24_ROOM_MAP, maldivesNow } = require('./lib/beds24-bridge');
const { ROOM_TYPE_ID_TO_CODE, CODE_TO_ROOM_TYPE_ID, INITIAL_OTA_ROOM_TYPES } = require('./lib/ota-room-types');

initializeApp();
const db = getFirestore();
const store = new FirestoreStore(db);

async function roomsDocs() {
  try {
    const s = await db.collection('rooms').get();
    const out = s.docs.map((d) => Object.assign({ id: d.id }, d.data())).filter((r) => /^VR0[1-6]$/.test(r.id));
    return out.length ? out : PHYSICAL_ROOMS;
  } catch (e) { return PHYSICAL_ROOMS; }
}

// ── blockDoubleBooking: create + update (Stage 5) ────────────────────────────
// Neutralises the LATER-written doc of an overlapping pair in the same room.
// On an update it only acts when the update changed room/dates/status into an
// overlap, so unrelated edits (notes, payments) are never touched.
exports.blockDoubleBooking = onDocumentWritten('reservations/{reservationId}', async (event) => {
  const after = event.data && event.data.after; if (!after || !after.exists) return;
  const before = event.data.before && event.data.before.exists ? event.data.before.data() : null;
  const data = after.data(); const id = event.params.reservationId;
  if (!data || !isActiveStatus(data.status) || !data.room_id || !data.check_in || !data.check_out) return;
  if (before && isActiveStatus(before.status) && before.room_id === data.room_id && before.check_in === data.check_in && before.check_out === data.check_out) return;
  const sameRoom = await db.collection('reservations').where('room_id', '==', data.room_id).get();
  const myTime = (before ? after.updateTime : after.createTime).toMillis();
  let conflict = null;
  sameRoom.forEach((doc) => {
    if (conflict || doc.id === id) return;
    const o = doc.data(); if (!o || !isActiveStatus(o.status) || !o.check_in || !o.check_out) return;
    if (!overlaps(data.check_in, data.check_out, o.check_in, o.check_out)) return;
    const otherTime = (doc.updateTime || doc.createTime).toMillis();
    const amLater = myTime > otherTime || (myTime === otherTime && id > doc.id);
    if (amLater) conflict = { id: doc.id, check_in: o.check_in, check_out: o.check_out };
  });
  if (!conflict) return;
  await after.ref.update({ status: 'Cancelled', autoBlockedReason: 'double_booking_detected_by_server', autoBlockedAt: FieldValue.serverTimestamp(), autoBlockedConflictId: conflict.id, autoBlockedOn: before ? 'update' : 'create' });
  const message = 'Reservation ' + id + ' for room ' + data.room_id + ' (' + data.check_in + ' to ' + data.check_out + ') overlapped ' + conflict.id + ' (' + conflict.check_in + ' to ' + conflict.check_out + ') and was auto-cancelled by the server-side double-booking guard (' + (before ? 'update' : 'create') + ').';
  await db.collection('reconciliation_log').add({ type: 'double_booking_blocked', roomId: data.room_id, reservationId: id, conflictingReservationId: conflict.id, check_in: data.check_in, check_out: data.check_out, source: data.source || null, agencyId: data.agencyId || null, timestamp: new Date().toISOString(), triggeredBy: 'blockDoubleBooking', message });
  console.warn(message);
});

// ── publicBooking: Stage 0 fix ───────────────────────────────────────────────
// The public website has no Firebase auth and its client transaction also
// writes room_availability, which the rules (correctly) allow only to
// admin/staff. This trusted function performs the identical transaction with
// the Admin SDK. Rules are NOT weakened. The rate is recomputed server-side.
const ALLOWED_ORIGINS = ['https://viluresidence.net', 'https://www.viluresidence.net', 'https://viluresidence.web.app', 'https://viluresidence.firebaseapp.com', 'http://localhost:5173', 'http://127.0.0.1:5173'];
function cors(req, res) {
  const o = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(o)) { res.set('Access-Control-Allow-Origin', o); res.set('Vary', 'Origin'); }
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS'); res.set('Access-Control-Allow-Headers', 'Content-Type'); res.set('Access-Control-Max-Age', '600');
}
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T12:00:00Z'));
// Strips only the characters that are actually unsafe to store verbatim
// (angle brackets -- the same stored-XSS concern esc() guards against
// elsewhere in the PMS). The previous /[ -<>]/g had an unescaped hyphen
// between two other characters inside the class, which JS parses as a
// RANGE (space..'<', i.e. U+0020-U+003C) rather than three literal
// characters -- silently stripping spaces, hyphens, dots and more from
// every guest field. That broke the email regex for any real address
// (the dot never survived "cleaning"), so publicBooking rejected valid
// guests with GUEST/400 -- caught by a live controlled test booking.
const clean = (s, max) => String(s == null ? '' : s).replace(/[<>]/g, '').trim().slice(0, max || 200);
const DEFAULT_RATES = { VR01: 80, VR02: 80, VR03: 85, VR04: 85, VR05: 90, VR06: 90 };

// Room -> ota_room_types doc id, built once from the same canonical
// BEDS24_ROOM_MAP the Beds24 bridge itself uses -- never a second mapping.
const ROOM_ID_TO_ROOM_TYPE_ID = {};
Object.keys(BEDS24_ROOM_MAP).forEach((code) => {
  const roomTypeId = CODE_TO_ROOM_TYPE_ID[code];
  if (!roomTypeId) return;
  BEDS24_ROOM_MAP[code].vilu_rooms.forEach((roomId) => { ROOM_ID_TO_ROOM_TYPE_ID[roomId] = roomTypeId; });
});

// Category-canonical fallback (2026-09-10 pricing-consistency pass): the
// public sell rate for a night with no date-specific room_prices override
// is the room's CATEGORY's owner-locked base_rate (live ota_room_types doc,
// falling back to the bundled INITIAL_OTA_ROOM_TYPES default -- the same
// fallback pattern functions-beds24/index.js's roomTypeConfig() already
// uses) -- never the physical room's own .rate/DEFAULT_RATES, which is
// each room's internal/legacy default only and can genuinely differ within
// one category (VR03/VR04 $85 vs VR05 $90, all three Double). Reading a
// stale/differing physical default here was the exact bug that let a real
// publicBooking charge $85 for VR03 while Bulk Price Manager/Calendar/
// Beds24 all agreed the category's real public sell price was $90.
async function categoryBaseRate(roomId) {
  const roomTypeId = ROOM_ID_TO_ROOM_TYPE_ID[roomId];
  if (!roomTypeId) return null;
  const otaType = await store.get('ota_room_types', roomTypeId);
  if (otaType && typeof otaType.base_rate === 'number') return otaType.base_rate;
  const fallback = INITIAL_OTA_ROOM_TYPES[roomTypeId];
  return fallback && typeof fallback.base_rate === 'number' ? fallback.base_rate : null;
}

async function serverRate(roomId, ci, co) {
  const room = await store.get('rooms', roomId);
  const catBase = await categoryBaseRate(roomId);
  const base = catBase != null ? catBase : (room && typeof room.rate === 'number' ? room.rate : (DEFAULT_RATES[roomId] || 0));
  const prices = ((await store.get('room_prices', roomId)) || {}).prices || {};
  let total = 0, n = 0;
  for (let d = ci; d < co; d = addDays(d, 1)) { total += prices[d] != null ? Number(prices[d]) : base; n++; }
  return n ? Math.round(total / n) : base;
}

exports.publicBooking = onRequest({ region: 'us-central1', maxInstances: 5 }, async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD' });
  const b = req.body || {};
  if (b.website_url) return res.status(200).json({ id: 'WEB' + Date.now() }); // honeypot: pretend success, write nothing
  const roomId = clean(b.roomId, 4);
  if (!/^VR0[1-6]$/.test(roomId)) return res.status(400).json({ error: 'ROOM' });
  if (!isDate(b.ci) || !isDate(b.co) || b.co <= b.ci) return res.status(400).json({ error: 'DATES' });
  const today = new Date().toISOString().slice(0, 10);
  if (b.ci < today || addDays(b.ci, 60) < b.co) return res.status(400).json({ error: 'DATES' });
  const name = clean(b.name, 120), email = clean(b.email, 160), phone = clean(b.phone, 40), country = clean(b.country, 80);
  if (name.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'GUEST' });
  const adults = Math.min(3, Math.max(1, parseInt(b.adults, 10) || 2));
  // abuse / replay limit: 10 requests per (ip,email) per hour; only a hash is stored
  const key = crypto.createHash('sha256').update(String(req.headers['x-forwarded-for'] || req.ip || '') + '|' + email.toLowerCase()).digest('hex').slice(0, 24);
  const rlRef = db.collection('rate_limits').doc(key + '_' + new Date().toISOString().slice(0, 13));
  const count = await db.runTransaction(async (t) => { const s = await t.get(rlRef); const c = (s.exists ? s.data().count : 0) + 1; t.set(rlRef, { count: c, updated_at: new Date().toISOString() }); return c; });
  if (count > 10) return res.status(429).json({ error: 'RATE_LIMIT' });
  const id = 'WEB' + Date.now();
  const rate = await serverRate(roomId, b.ci, b.co);
  const now = new Date().toISOString();
  const fields = { id, room_id: roomId, guest_name: name, guest_email: email, guest_phone: phone, guest_country: country, check_in: b.ci, check_out: b.co, adults, children: 0, rate, status: 'Pending', source: 'Website', channel: 'website', notes: b.notes ? clean(b.notes, 1000) : '', created_at: now, updated_at: now, created_via: 'publicBooking' };
  try {
    await writeReservationTx(store, id, fields);
    return res.status(200).json({ id, rate });
  } catch (e) {
    if (e.code === 'ROOM_CONFLICT') return res.status(409).json({ error: 'CONFLICT' });
    console.error('publicBooking failed', e);
    return res.status(500).json({ error: 'FAILED' });
  }
});

// ── availability engine triggers (Stage 6) ───────────────────────────────────
async function runAvailability(trigger, roomsDocsList) {
  const rooms = roomsDocsList || await roomsDocs();
  const r = await syncAvailability({ store, roomsDocs: rooms, trigger });
  if (r.errors && r.errors.length) console.warn('room type mapping errors', r.errors);
  return r;
}

// Beds24 differential-sync enqueue: writes ONE pending ota_pushes job per
// affected room-type code (never a second queue collection -- see Step 8 of
// the continuous-sync pass). A room type this Vilu build doesn't map to
// Beds24 (BEDS24_ROOM_MAP has no entry) is silently skipped -- there is
// nothing to sync for it. An empty affectedDates map enqueues nothing at
// all, matching "do not rewrite the whole calendar after every reservation."
async function enqueueBeds24Sync(trigger, affectedDates) {
  const codes = Object.keys(affectedDates || {});
  for (const code of codes) {
    if (!BEDS24_ROOM_MAP[code]) continue;
    const dates = affectedDates[code];
    if (!dates || !dates.length) continue;
    const { id, record } = buildBeds24PushRecord({ roomTypeCode: code, dateRange: { affected_dates: dates }, payload: null, status: 'pending', trigger });
    await db.collection('ota_pushes').doc(id).set(record);
  }
}

exports.availabilityOnReservation = onDocumentWritten('reservations/{id}', async (event) => {
  const b = event.data.before.exists ? event.data.before.data() : null, a = event.data.after.exists ? event.data.after.data() : null;
  const sig = (x) => x && [x.room_id, x.check_in, x.check_out, x.status].join('|');
  if (sig(b) === sig(a)) return; // notes/payment edits do not change inventory
  const rooms = await roomsDocs();
  await runAvailability('reservation:' + event.params.id, rooms);
  const affectedDates = computeAffectedDates({
    roomsDocs: rooms,
    before: b && isActiveStatus(b.status) ? { room_id: b.room_id, check_in: b.check_in, check_out: b.check_out } : null,
    after: a && isActiveStatus(a.status) ? { room_id: a.room_id, check_in: a.check_in, check_out: a.check_out } : null,
  });
  await enqueueBeds24Sync('reservation:' + event.params.id, affectedDates);
});
exports.availabilityOnBlock = onDocumentWritten('blocks/{id}', async (event) => {
  const rooms = await roomsDocs();
  await runAvailability('block:' + event.params.id, rooms);
  const b = event.data.before.exists ? event.data.before.data() : null, a = event.data.after.exists ? event.data.after.data() : null;
  const affectedDates = computeAffectedDates({
    roomsDocs: rooms,
    before: b ? { room_id: b.room_id, check_in: b.from_date, check_out: b.to_date } : null,
    after: a ? { room_id: a.room_id, check_in: a.from_date, check_out: a.to_date } : null,
  });
  await enqueueBeds24Sync('block:' + event.params.id, affectedDates);
});

// ── Beds24 rate/restriction-change sync (continuous-sync pass) ──────────────
// Reacts to an actual field change on ota_room_types/{roomTypeId} (base_rate,
// min_stay, max_stay, closed_to_arrival, closed_to_departure,
// manual_stop_sell) -- a no-op write (unrelated field, or identical values)
// enqueues nothing. A base-rate/restriction change has no natural "affected
// dates" of its own (unlike a reservation/block), so per the owner's own
// guidance it resyncs that ONE room type's entire future booking window --
// never any other room type. ota_room_type_overrides is intentionally NOT
// wired here yet: no per-date override schema is defined or used anywhere
// in this codebase (confirmed empty in production), so triggering off an
// undefined shape would mean inventing behavior -- deferred until the
// override schema itself is decided.
exports.beds24RateChangeSync = onDocumentWritten('ota_room_types/{roomTypeId}', async (event) => {
  const a = event.data.after.exists ? event.data.after.data() : null;
  if (!a) return; // deletion: not this pass's concern
  const b = event.data.before.exists ? event.data.before.data() : null;
  const watchedFields = ['base_rate', 'min_stay', 'max_stay', 'closed_to_arrival', 'closed_to_departure', 'manual_stop_sell'];
  const changed = watchedFields.some((f) => !b || b[f] !== a[f]);
  if (!changed) return;
  const code = ROOM_TYPE_ID_TO_CODE[event.params.roomTypeId];
  if (!code || !BEDS24_ROOM_MAP[code]) return;
  const today = maldivesNow().date;
  const windowDays = a.booking_window_days || 365;
  const dates = dateRange(today, addDays(today, windowDays));
  await enqueueBeds24Sync('ota_room_types:' + event.params.roomTypeId, { [code]: dates });
});

// ── Beds24 date-specific rate-override sync (Bulk Price Manager rebuild,
// 2026-09-10) ──────────────────────────────────────────────────────────────
// Reacts to ota_room_type_overrides/{roomTypeId} writes -- the per-date
// override store the category-first Bulk Price Manager now writes alongside
// the existing room_prices/{VRxx} website/direct-booking path. Unlike
// beds24RateChangeSync's full booking-window resync (a base-rate change has
// no natural "affected dates" of its own), an override write DOES: only the
// date keys that were actually added, changed, or removed between before and
// after are enqueued -- never the whole horizon -- matching "no full-calendar
// push for a one-day edit". beds24OutboundWorker re-reads this same
// collection live at push time (see functions-beds24/index.js
// roomTypeOverrides()), so it doesn't matter whether THIS trigger, a
// reservation/block change, or the nightly safety net enqueued the job --
// the override is always applied fresh, never trusted from enqueue time.
exports.beds24OverrideChangeSync = onDocumentWritten('ota_room_type_overrides/{roomTypeId}', async (event) => {
  const code = ROOM_TYPE_ID_TO_CODE[event.params.roomTypeId];
  if (!code || !BEDS24_ROOM_MAP[code]) return;
  const before = (event.data.before.exists ? event.data.before.data() : null) || {};
  const after = (event.data.after.exists ? event.data.after.data() : null) || {};
  const beforeOverrides = before.overrides || {};
  const afterOverrides = after.overrides || {};
  const changedDates = new Set();
  for (const date of Object.keys(beforeOverrides)) {
    if (!(date in afterOverrides) || afterOverrides[date] !== beforeOverrides[date]) changedDates.add(date);
  }
  for (const date of Object.keys(afterOverrides)) {
    if (!(date in beforeOverrides) || afterOverrides[date] !== beforeOverrides[date]) changedDates.add(date);
  }
  if (!changedDates.size) return; // e.g. a metadata-only write, or before===after
  await enqueueBeds24Sync('ota_room_type_overrides:' + event.params.roomTypeId, { [code]: Array.from(changedDates).sort() });
});

// ── nightly reconciliation (Stage 10) ───────────────────────────────────────
// Full 730-day Vilu-internal availability recompute (unchanged), plus a
// nightly Beds24 safety-net resync of the full 365-day booking window for
// every mapped room type -- self-heals any differential push a trigger
// might have missed (a failed retry, a deploy gap, a missed event), without
// ever trusting a remembered "last known Beds24 state": every date is
// recomputed fresh at push time by the worker, then range-compressed, so
// this stays cheap even though it touches the whole horizon nightly.
exports.nightlyReconcile = onSchedule({ schedule: '30 3 * * *', timeZone: 'Indian/Maldives' }, async () => {
  const rooms = await roomsDocs();
  await syncAvailability({ store, roomsDocs: rooms, trigger: 'nightly', days: FULL_HORIZON_DAYS });
  const today = maldivesNow().date;
  const affectedDates = {};
  for (const code of Object.keys(BEDS24_ROOM_MAP)) affectedDates[code] = dateRange(today, addDays(today, 365));
  await enqueueBeds24Sync('nightly', affectedDates);
});
