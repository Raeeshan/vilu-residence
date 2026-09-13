'use strict';
// Vilu Residence — Cloud Functions ("core" codebase)
//   blockDoubleBooking  server-side overlap backstop (create AND update)
//   publicBooking       trusted write path for the unauthenticated website (Stage 0 fix)
//   availabilityOnReservation / availabilityOnBlock  event-driven sellable-inventory derivation
//   nightlyReconcile    03:30 Indian/Maldives: full 730-day availability recompute
//   getReservationDocument / uploadReservationDocument  authenticated,
//     role-checked read/write for the Reservation Document Vault (passports,
//     IDs, visas, etc.) -- see the comment above those exports for why they
//     exist instead of a direct Storage-rules read/write.
//   submitAgencyCustomQuote  Agency Sales Workflow Phase C -- re-verifies
//     every Custom Package component's Vilu rate server-side (Admin SDK,
//     bypassing client rules) before writing agency_quotes, so an agency
//     can never persist a spoofed rate. See the comment above that export.
//   getAgencyAvailability  Agency Sales Workflow Phase D -- redacted, per-
//     room-per-date availability + this agency's own reservation
//     enrichment only, reusing the exact overlap math already used by
//     writeReservation/hasBlockConflict/isOcc. See the comment above that
//     export for why blocks.reason can't just be filtered client-side.
//   approveAgencyHoldRequest / rejectAgencyHoldRequest /
//     releaseAgencyHoldRequest / expireAgencyHoldRequests  Agency Sales
//     Workflow Phase E -- temporary room hold requests, reusing
//     block_requests (requestType:'AGENCY_HOLD') rather than a new
//     collection. Approval recomputes availability and creates the real
//     block inside one Firestore transaction; a scheduled sweep releases
//     expired holds automatically. See the comment above these exports.
//   confirmAgencyBookingRequest / rejectAgencyBookingRequest /
//     requestChangeAgencyBookingRequest  Agency Sales Workflow Phase F --
//     turns an agency's agency_booking_requests document (a snapshot of a
//     finalized quote) into a real canonical `reservations` doc, only on
//     Vilu's server-side confirmation. Confirmation re-rechecks
//     availability and consumes any linked active hold inside one Firestore
//     transaction; the old direct agency reservation-create path is
//     retired once this is proven. See the comment above these exports.
//   getAgencyBookingConfirmationData  Agency Sales Workflow Phase G -- the
//     hard server-side allowlist behind the guest-safe printable Booking
//     Confirmation. Verifies the caller owns the booking request AND its
//     linked reservation, that the request is CONFIRMED, and that the
//     reservation is still actually Confirmed (not since cancelled) before
//     returning ONLY guest-safe fields -- never viluNetTotal, agencyEarnings,
//     paymentCollector, component rates, or any internal note. See the
//     comment above that export.
//   searchAgencyGuests  Agency Sales Workflow Phase H -- bounded, in-memory
//     substring search across an agency's OWN reservations/booking-requests/
//     quotes only (agencyId always request.auth.uid, never client-supplied).
//     Direct/OTA/other-agency records are never fetched in the first place.
//     See the comment above that export.
//   getMyAgencyBookings  Agency Sales Workflow Phase I security fix -- a
//     safe-projection list of an agency's own reservations, replacing the
//     direct client read Phase H used to make (rules now deny it). Never
//     returns internal_note/notes/viluNetTotal/agencyEarnings/
//     paymentCollector or any other internal PMS field. See the comment
//     above that export.
//   submitAgencyAssignedPackageQuote  Agency Quote Security Hardening -- the
//     ONLY way an Assigned Package quote is now created, edited, or
//     finalized (direct client writes to agency_quotes are refused by
//     firestore.rules for this quoteType entirely). Re-resolves the
//     agency's own package + accommodation + any admin-approved partner-
//     property rate override server-side, every save, and blocks
//     finalizing with no configured rate. A Vilu-only quote's total is
//     byte-identical to the old client formula. See the comment above that
//     export.
//   settlementEligibilityOnReservation / markAgencySettlementPaymentSent /
//     confirmAgencySettlementReceived / disputeAgencySettlement /
//     resolveAgencySettlementDispute / reconcileMissingAgencySettlements
//     Agency Sales Workflow Phase J -- the Earnings & Settlement Ledger.
//     One agency_settlements doc per confirmed agency reservation, created
//     atomically inside confirmAgencyBookingRequest's own transaction from
//     that reservation's immutable price snapshot. Direction-aware
//     (HOTEL_TO_AGENCY vs AGENCY_TO_HOTEL) server functions gate every
//     status transition by who the sender/receiver actually is for that
//     direction; eligibility (NOT_YET_PAYABLE -> PAYABLE) is driven by the
//     PMS's own existing 'Checked in' status, never by arrivalDate alone.
//     See the comment above these exports.
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
const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { getAuth } = require('firebase-admin/auth');
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
// Observability (Post-completion hardening, item 4): a Cloud Scheduler
// cold start ("Starting new instance") only proves the container booted,
// never that the reconciliation logic inside actually ran to completion --
// this function previously logged nothing at all, so a silent failure
// (an uncaught rejection, syncAvailability throwing) was indistinguishable
// from a successful night in Cloud Functions logs. These three structured
// log lines (never guest-identifying -- room-type-level counts only, no
// reservation ids/guest names/emails) let `firebase functions:log --only
// nightlyReconcile` answer "did last night's run actually finish, and what
// did it do" directly, without needing separate Firestore access to read
// the ota_pushes audit trail syncAvailability() already writes per room
// type.
exports.nightlyReconcile = onSchedule({ schedule: '30 3 * * *', timeZone: 'Indian/Maldives' }, async () => {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  logger.info('nightlyReconcile.start', { startedAt });
  try {
    const rooms = await roomsDocs();
    const result = await syncAvailability({ store, roomsDocs: rooms, trigger: 'nightly', days: FULL_HORIZON_DAYS });
    const today = maldivesNow().date;
    const affectedDates = {};
    for (const code of Object.keys(BEDS24_ROOM_MAP)) affectedDates[code] = dateRange(today, addDays(today, 365));
    await enqueueBeds24Sync('nightly', affectedDates);
    const roomTypesChecked = Object.keys((result.payload && result.payload.room_types) || {}).length;
    const differencesFound = (result.changed || []).reduce((sum, c) => sum + (c.dates || 0), 0);
    logger.info('nightlyReconcile.complete', {
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      recordsChecked: roomTypesChecked,
      differencesFound,
      changesApplied: (result.changed || []).length,
      pushResult: result.pushResult,
      roomTypeErrors: (result.errors || []).length,
    });
  } catch (e) {
    logger.error('nightlyReconcile.failed', {
      startedAt,
      failedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      error: (e && e.message) || String(e),
    });
    throw e;
  }
});

// ── Reservation Document Vault: authenticated read/write (security
// hardening pass, 2026-09-10) ────────────────────────────────────────────
// Storage rules cannot reliably check a caller's Firestore-backed role from
// Storage's own rule language (the storage.rules file documents an earlier,
// abandoned attempt at exactly this). The client's original design worked
// around that with storage.rules gating reservation-documents/ to a single
// hardcoded admin email, then falling back to getDownloadURL() for actual
// reads -- but a getDownloadURL() token is a bearer credential that keeps
// working forever for anyone who obtains it, regardless of Storage rules,
// which is unacceptable for a passport/ID scan. These two callables replace
// BOTH the direct client Storage read (getDownloadURL) and the direct
// client Storage write (fsStorage.ref().put()) for this one path: the
// client now sends auth + a document/reservation reference, the SERVER
// checks the caller's real Firestore role (reliable -- same-service, admin
// SDK, not a client Storage rule), and only then touches the bucket via
// the Admin SDK, which is never subject to Storage rules at all. No
// download token, no signed URL, no client-visible file path token is ever
// created -- the file only ever reaches the client as an in-memory base64
// payload over the existing HTTPS callable channel, used once, discarded.
const SENSITIVE_DOC_TYPES = ['PASSPORT', 'IDENTITY', 'TRAVEL'];
const ALL_DOC_TYPES = ['PASSPORT', 'IDENTITY', 'TRAVEL', 'TRANSFER', 'SIGNED_BILL', 'INVOICE', 'RECEIPT', 'OTHER'];
const ADMIN_EMAIL = 'viluresidence@gmail.com';
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB decoded -- comfortably inside the callable payload limit once base64-encoded (~11MB)

async function callerRole(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const email = (request.auth.token.email || '').toLowerCase();
  if (!email) throw new HttpsError('permission-denied', 'No email on this account.');
  if (email === ADMIN_EMAIL) return { email, role: 'admin' };
  const userDoc = await db.collection('users').doc(email).get();
  const role = userDoc.exists ? userDoc.data().role : null;
  if (role === 'staff') return { email, role: 'staff' };
  if (role === 'manager') return { email, role: 'manager' };
  // Agency Self-Registration Suspension (2026-09-13): a suspended agency's
  // users/{email}.role is left as 'agency' (never overwritten -- suspension
  // must never delete history or force re-approval), only accountStatus
  // flips to 'SUSPENDED'. Returning a distinct 'suspended' sentinel here
  // (instead of 'agency') makes every existing `role !== 'agency'`
  // throw-gate across every agency-only callable in this file automatically
  // also reject a suspended agency, with zero changes to any of them --
  // every such call site is a simple equality/inequality check, none
  // combine role with another OR'd truthy role that 'suspended' could
  // accidentally satisfy. An account with no accountStatus field at all
  // (every pre-existing agency created before this feature) is unaffected
  // and continues to resolve to 'agency' exactly as before.
  if (role === 'agency' && userDoc.exists && userDoc.data().accountStatus === 'SUSPENDED') {
    return { email, role: 'suspended' };
  }
  // Mirrors firestore.rules' isStaff(): a staff_permissions/{uid} doc also
  // grants staff-level access even without users/{email}.role === 'staff'.
  const staffPerm = await db.collection('staff_permissions').doc(request.auth.uid).get();
  if (staffPerm.exists) return { email, role: 'staff' };
  return { email, role: role || 'none' };
}
function canAccessDocType(role, type) {
  if (SENSITIVE_DOC_TYPES.includes(type)) return role === 'admin' || role === 'manager';
  return role === 'admin' || role === 'manager' || role === 'staff';
}

exports.getReservationDocument = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { email, role } = await callerRole(request);
  const documentId = String((request.data || {}).documentId || '');
  if (!documentId) throw new HttpsError('invalid-argument', 'documentId required.');
  const docRef = db.collection('reservation_documents').doc(documentId);
  const snap = await docRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Document not found.');
  const doc = snap.data();
  if (!canAccessDocType(role, doc.type)) throw new HttpsError('permission-denied', 'Not authorized for this document type.');
  const bucket = getStorage().bucket();
  const [buffer] = await bucket.file(doc.storagePath).download();
  if (SENSITIVE_DOC_TYPES.includes(doc.type)) {
    await db.collection('document_access_audit').add({
      documentId, reservationId: doc.reservationId, type: doc.type, action: 'view',
      userUid: request.auth.uid, userEmail: email, userRole: role,
      accessedAt: FieldValue.serverTimestamp(),
    });
  }
  return { base64: buffer.toString('base64'), mimeType: doc.mimeType || 'application/octet-stream', title: doc.title || doc.type };
});

exports.uploadReservationDocument = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { email, role } = await callerRole(request);
  if (role !== 'admin' && role !== 'manager') throw new HttpsError('permission-denied', 'Admin/Manager access only.');
  const d = request.data || {};
  const resId = String(d.resId || '');
  const type = String(d.type || '');
  const base64 = String(d.base64 || '');
  const mimeType = String(d.mimeType || '');
  const fileExt = String(d.fileExt || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
  if (!resId || !ALL_DOC_TYPES.includes(type)) throw new HttpsError('invalid-argument', 'resId/type required.');
  if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(mimeType)) throw new HttpsError('invalid-argument', 'Only JPEG/PNG/WEBP images or PDF are accepted.');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw new HttpsError('invalid-argument', 'Empty file.');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new HttpsError('invalid-argument', 'File exceeds the 8MB limit.');
  // guestName is display metadata only (not security-sensitive -- access
  // control above is entirely by resId/type/role, never by name), so it's
  // trusted from the client the same way title is, rather than guessed
  // server-side against a reservation schema this codebase doesn't own a
  // single canonical field-name convention for (the client's own in-memory
  // RES shape and the raw Firestore reservations doc use different keys).
  const docRef = db.collection('reservation_documents').doc();
  const storagePath = 'reservation-documents/' + resId + '/' + docRef.id + '.' + fileExt;
  const bucket = getStorage().bucket();
  await bucket.file(storagePath).save(buffer, { contentType: mimeType, resumable: false });
  await docRef.set({
    reservationId: resId, type, title: String(d.title || '').slice(0, 200) || type,
    guestName: d.guestName ? String(d.guestName).slice(0, 160) : null, folioItemId: null, invoiceId: null,
    storagePath, mimeType,
    uploadedByUid: request.auth.uid, uploadedByName: String(d.uploaderName || email).slice(0, 120),
    uploadedAt: FieldValue.serverTimestamp(), status: 'active',
  });
  return { docId: docRef.id };
});

// ── submitAgencyCustomQuote: Agency Sales Workflow Phase C ─────────────────
// Why this needs a callable and not just firestore.rules: a Custom Package
// quote's selectedComponents is a variable-length array, each entry drawn
// from a different canonical source (service_catalog / agency_packages /
// the global booking-settings doc). Firestore security rules have no loop
// construct that can fetch a different reference document per array element
// and validate each one's rate -- rules can gate a single document read
// (that's how service_catalog's new agency-visibility clause below works)
// but not "for each of N components, look up its real rate and compare".
// So an agency client could otherwise write agency_quotes directly with a
// spoofed viluUnitRate (e.g. claiming an $85 activity costs $1), corrupting
// the very numbers Phase J's future settlement will rely on. This function
// is the trust boundary instead: it re-reads every component's rate from
// its canonical source with the Admin SDK (which bypasses client rules and
// is therefore authoritative), computes viluNetTotal/agencyEarnings itself,
// and only THEN writes agency_quotes -- the client never gets to persist a
// rate it supplied. agencyGuestSellingTotal is the one number NOT
// re-derived here: it's the agency's own commercial decision, not a Vilu
// rate, so there's nothing to validate it against.
const AGENCY_QUOTE_CURRENCIES = ['USD', 'MVR', 'EUR'];
const AGENCY_QUOTE_PAYMENT_COLLECTORS = ['HOTEL', 'AGENCY', 'UNDECIDED'];
const AGENCY_QUOTE_MAX_COMPONENTS = 40;

// ── Multi-Property Availability (Part 1-14) ──────────────────────────────
// Audit finding: the ONLY pre-existing "partner hotel" concept anywhere in
// this codebase is `PH` in vilu-unified.html -- a hardcoded, non-Firestore
// JS array ("Ranfaru Inn"/"White Sand Inn", flat $70/night, decorative rows
// on the PMS Calendar only). No property records, room/rate data,
// availability, package eligibility, or agency-facing rules exist for it
// anywhere. Per this task's own instruction ("do not invent partner hotel
// names/rates"), that array is left completely untouched here and is NEVER
// read by anything below -- it is not treated as real partner data. This is
// the clean, new, Vilu-admin-managed structure instead (Part 2):
//   accommodation_properties/{propertyId}                  (admin-managed)
//   accommodation_properties/{propertyId}/room_types/{id}   (admin-managed)
//   .../room_types/{id}/manual_availability/data            (admin-managed, MANUAL_INVENTORY only)
// Vilu Residence itself is NEVER a Firestore doc here -- it is synthesized
// (id 'VILU') everywhere below, since duplicating the real PMS's own
// canonical room/category data into a second collection would create two
// sources of truth (Part 23), which this task explicitly forbids. No
// partner property is ever pre-seeded; the admin UI starts empty until Vilu
// staff enters real data (Part 29).
const ACCOMMODATION_AVAILABILITY_MODES = ['VILU_LIVE', 'MANUAL_INVENTORY', 'ON_REQUEST'];
const ACCOMMODATION_BOOKING_STATUSES = ['AVAILABILITY_REQUESTED', 'PARTNER_CONFIRMED', 'PARTNER_REJECTED'];

// Hotel-selection live-bug investigation (2026-09-12): the ONLY code path
// that ever writes accommodation_properties/room_types is the PMS's own
// Partner Accommodation admin UI, which always sends a real JS boolean
// (a checkbox's .checked property) for active/visibleToAgencies -- but
// Vilu staff could always also hand-edit a doc directly in the Firebase
// console (there is no rule against it, and non-technical staff copying a
// value in by hand commonly type "true" as a string, or 1, rather than
// picking the Console's boolean field type). A strict `=== true` check --
// or worse, a `.where('field','==',true)` QUERY, which is type-strict in
// Firestore -- would then silently exclude an otherwise fully-configured
// real property with NO error anywhere, forever. This loose-but-still-safe
// check accepts true/"true"/1 as "on"; anything else (undefined, false,
// "false", 0) stays "off" -- never a security loosening (an absent or
// falsy field is still excluded exactly as before), just tolerant of how
// the flag actually got typed in.
function isFlagOn(v) { return v === true || v === 'true' || v === 1; }

// Resolves + validates the agency's chosen accommodation server-side for a
// quote (Part 11-13). Vilu needs no lookup (it is always offered, always
// available as a choice). A partner property/room type must be active AND
// visibleToAgencies, or it is rejected outright -- never silently
// downgraded to "make something up". `rate` is null when no agencyRate has
// been configured yet; callers must treat that as "Rate on request" and
// block finalizing a real total against it (Part 13), never compute
// against a guessed number.
async function resolveAccommodationSelection(d) {
  const propertyId = String(d.accommodationPropertyId || 'VILU') || 'VILU';
  if (propertyId === 'VILU') {
    return { propertyId: 'VILU', propertyName: 'Vilu Residence', isVilu: true, roomTypeId: null, roomTypeName: null, rate: null, currency: null, availabilityMode: 'VILU_LIVE' };
  }
  const propSnap = await db.collection('accommodation_properties').doc(propertyId).get();
  if (!propSnap.exists || !isFlagOn(propSnap.data().active) || !isFlagOn(propSnap.data().visibleToAgencies)) {
    throw new HttpsError('invalid-argument', 'Selected accommodation is not available.');
  }
  const prop = propSnap.data();
  const roomTypeId = String(d.accommodationRoomTypeId || '');
  if (!roomTypeId) throw new HttpsError('invalid-argument', 'Select a room type for this accommodation.');
  const rtSnap = await db.collection('accommodation_properties').doc(propertyId).collection('room_types').doc(roomTypeId).get();
  if (!rtSnap.exists || !isFlagOn(rtSnap.data().active) || !isFlagOn(rtSnap.data().visibleToAgencies)) {
    throw new HttpsError('invalid-argument', 'Selected room type is not available.');
  }
  const rt = rtSnap.data();
  const mode = ACCOMMODATION_AVAILABILITY_MODES.includes(prop.availabilityMode) ? prop.availabilityMode : 'ON_REQUEST';
  return {
    propertyId, propertyName: String(prop.propertyName || propertyId), isVilu: false,
    roomTypeId, roomTypeName: String(rt.roomTypeName || roomTypeId),
    rate: typeof rt.agencyRate === 'number' && Number.isFinite(rt.agencyRate) ? rt.agencyRate : null,
    currency: rt.currency || null,
    availabilityMode: mode,
  };
}

// Same regex as sanitizeGuestLabel() in vilu-agency-portal.html -- kept in
// sync deliberately (see that function's own comment) since both strip the
// same admin-authored "Name — $NN" price-in-label convention before a name
// ever reaches a guest-facing document.
function sanitizeGuestLabel(label) {
  return String(label || '').replace(/\s*[-–—]\s*\$\d+(?:\.\d+)?\s*$/, '').trim();
}

function newAgencyQuoteId(email) {
  const codePart = String(email || 'agency').split('@')[0].toUpperCase().replace(/[^A-Z0-9]/g, '') || 'AGENCY';
  return 'VQ-' + codePart + '-' + new Date().getFullYear() + '-' + Date.now().toString().slice(-6);
}

// Resolves one selectedComponents entry against its canonical source,
// returning the SERVER-VERIFIED {name, category, unit, viluUnitRate} --
// nothing from the client's own copy of these fields is trusted or used.
async function resolveAgencyQuoteComponent(entry, agencyEmailLower) {
  const sourceType = String((entry || {}).sourceType || '');
  const sourceId = String((entry || {}).sourceId || '');
  const quantity = Number((entry || {}).quantity);
  if (!sourceId) throw new HttpsError('invalid-argument', 'Each component needs a sourceId.');
  if (!(quantity > 0) || !Number.isFinite(quantity) || quantity > 999) {
    throw new HttpsError('invalid-argument', 'Component quantity must be a positive number.');
  }

  if (sourceType === 'catalog') {
    const snap = await db.collection('service_catalog').doc(sourceId).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Catalog item not found: ' + sourceId);
    const item = snap.data();
    if (item.active === false) throw new HttpsError('failed-precondition', 'Catalog item is no longer active: ' + sourceId);
    const visible = item.visibleToAgencies;
    const approved = visible === 'all' || (Array.isArray(visible) && visible.indexOf(agencyEmailLower) !== -1);
    if (!approved) throw new HttpsError('permission-denied', 'This catalog item is not approved for your agency.');
    return {
      sourceType, sourceId, name: String(item.name || ''), category: String(item.category || 'OTHER_SERVICE'),
      unit: String(item.unitType || 'PER_ITEM'), viluUnitRate: Number(item.basePrice) || 0, quantity,
    };
  }

  if (sourceType === 'agency_package') {
    const snap = await db.collection('agency_packages').doc(agencyEmailLower).get();
    const packages = (snap.exists && snap.data().packages) || [];
    const pkg = packages.find((p) => p.id === sourceId);
    if (!pkg) throw new HttpsError('not-found', 'Package not found in your own agency package set: ' + sourceId);
    if (pkg.active === false) throw new HttpsError('failed-precondition', 'This package is currently Not assigned.');
    return {
      sourceType, sourceId, name: String(pkg.name || ''), category: 'ACCOMMODATION_BASE',
      unit: 'PER_PERSON', viluUnitRate: Number(pkg.agencyPricePerRoom || pkg.pricePerRoom) || 0, quantity,
    };
  }

  if (sourceType === 'global_setting') {
    if (sourceId !== 'extraNightRate' && sourceId !== 'flightSurcharge') {
      throw new HttpsError('invalid-argument', 'Unknown global setting: ' + sourceId);
    }
    const snap = await db.collection('website_content').doc('agency_booking_settings').get();
    const data = (snap.exists && snap.data()) || {};
    const rate = sourceId === 'extraNightRate' ? (data.extraNightRate != null ? data.extraNightRate : 40) : (data.flightSurcharge != null ? data.flightSurcharge : 110);
    return {
      sourceType, sourceId,
      name: sourceId === 'extraNightRate' ? 'Additional Night' : 'Domestic Flight',
      category: 'TRANSPORT_ACCOMMODATION', unit: sourceId === 'extraNightRate' ? 'PER_PERSON_PER_NIGHT' : 'PER_PERSON_ONE_WAY',
      viluUnitRate: Number(rate) || 0, quantity,
    };
  }

  throw new HttpsError('invalid-argument', 'Unknown component sourceType: ' + sourceType);
}

exports.submitAgencyCustomQuote = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { email, role } = await callerRole(request);
  if (role !== 'agency') throw new HttpsError('permission-denied', 'Agency access only.');
  const agencyEmailLower = email.toLowerCase();
  const d = request.data || {};

  const status = d.status === 'FINALIZED' ? 'FINALIZED' : 'DRAFT';
  const currency = AGENCY_QUOTE_CURRENCIES.includes(d.currency) ? d.currency : 'USD';
  const paymentCollector = AGENCY_QUOTE_PAYMENT_COLLECTORS.includes(d.paymentCollector) ? d.paymentCollector : 'UNDECIDED';
  const adults = Math.max(1, Math.min(20, Math.round(Number(d.adults) || 1)));
  const children = Math.max(0, Math.min(20, Math.round(Number(d.children) || 0)));
  const guestName = String(d.guestName || '').slice(0, 160).trim();
  const arrivalDate = /^\d{4}-\d{2}-\d{2}$/.test(d.arrivalDate) ? d.arrivalDate : '';
  const departureDate = /^\d{4}-\d{2}-\d{2}$/.test(d.departureDate) ? d.departureDate : '';
  // Phase I hardening (I-6/I-30): unlike adults/children just above (which
  // are safe already -- Math.min(20,...) correctly caps an Infinity input,
  // and NaN is falsy so `|| 1`/`|| 0` catches it), this field had no upper
  // bound: `Number(Infinity) || 0` evaluates to Infinity (truthy), so
  // Math.max(0, Infinity) let a non-finite value straight through to a
  // Firestore write, which would reject it with an opaque low-level error
  // instead of a clean one. Explicit Number.isFinite check + a generous but
  // real upper bound closes that.
  const rawSellingTotal = Number(d.agencyGuestSellingTotal);
  if (d.agencyGuestSellingTotal != null && d.agencyGuestSellingTotal !== '' && !Number.isFinite(rawSellingTotal)) {
    throw new HttpsError('invalid-argument', 'Guest selling total must be a valid number.');
  }
  const agencyGuestSellingTotal = Math.max(0, Math.min(500000, Number.isFinite(rawSellingTotal) ? rawSellingTotal : 0));
  const packageName = String(d.packageName || '').slice(0, 160).trim() || 'Custom Maldives Package';
  const guestDescription = String(d.guestDescription || '').slice(0, 500).trim();
  const guestMessage = String(d.guestMessage || '').slice(0, 500).trim();

  const selectedComponentsInput = Array.isArray(d.selectedComponents) ? d.selectedComponents : [];
  if (!selectedComponentsInput.length) throw new HttpsError('invalid-argument', 'Select at least one component.');
  if (selectedComponentsInput.length > AGENCY_QUOTE_MAX_COMPONENTS) throw new HttpsError('invalid-argument', 'Too many components.');
  if (status === 'FINALIZED' && !(agencyGuestSellingTotal > 0)) throw new HttpsError('invalid-argument', 'Enter a guest selling price before finalizing.');
  if (status === 'FINALIZED' && (!guestName || !arrivalDate || !departureDate)) throw new HttpsError('invalid-argument', 'Guest name and travel dates are required before finalizing.');

  const resolvedComponents = [];
  for (const entry of selectedComponentsInput) {
    resolvedComponents.push(await resolveAgencyQuoteComponent(entry, agencyEmailLower));
  }
  const componentsWithTotals = resolvedComponents.map((c) => Object.assign({}, c, { viluLineTotal: +(c.viluUnitRate * c.quantity).toFixed(2) }));
  const componentsNetTotal = +componentsWithTotals.reduce((sum, c) => sum + c.viluLineTotal, 0).toFixed(2);

  // Guest-facing snapshot: name only, never the rate/quantity/line total --
  // the SAME structural allowlist discipline as buildGuestQuotationHTML() on
  // the client, just applied here to what gets INTO the quote in the first
  // place. Trips & Activities go to guestActivities, everything else to
  // guestIncludes, matching how an assigned-package quote already splits
  // includes vs. activities.
  const guestIncludes = [];
  const guestActivities = [];
  componentsWithTotals.forEach((c) => {
    const label = sanitizeGuestLabel(c.name);
    if (!label) return;
    if (c.category === 'TRIPS_ACTIVITIES') guestActivities.push(label); else guestIncludes.push(label);
  });

  let nights = 0;
  if (arrivalDate && departureDate) {
    const n = Math.round((new Date(departureDate) - new Date(arrivalDate)) / 864e5);
    if (n > 0) nights = n;
  }

  // Multi-Property Availability (Part 11-13): Vilu needs no extra line here
  // (its own accommodation is already whichever agency_package component
  // the builder added, unchanged). A partner property's room cost is a
  // SEPARATE line, resolved only from that room type's own admin-configured
  // agencyRate -- never guessed, never left for the client to supply.
  const accommodation = await resolveAccommodationSelection(d);
  if (!accommodation.isVilu && accommodation.rate == null && status === 'FINALIZED') {
    throw new HttpsError('failed-precondition', 'This accommodation has no approved rate yet -- ask Vilu to configure it before finalizing.');
  }
  const accommodationTotal = (!accommodation.isVilu && accommodation.rate != null && nights > 0)
    ? +(accommodation.rate * nights).toFixed(2) : 0;
  const viluNetTotal = +(componentsNetTotal + accommodationTotal).toFixed(2);
  const agencyEarnings = +(agencyGuestSellingTotal - viluNetTotal).toFixed(2);

  const now = new Date().toISOString();
  let quoteId = String(d.quoteId || '').trim();
  let createdAt = now;
  if (quoteId) {
    const existingSnap = await db.collection('agency_quotes').doc(quoteId).get();
    if (existingSnap.exists) {
      const existing = existingSnap.data();
      if (existing.agencyId !== request.auth.uid) throw new HttpsError('permission-denied', 'Not your quotation.');
      if (existing.status !== 'DRAFT') throw new HttpsError('failed-precondition', 'This quotation is finalized and can no longer be edited.');
      createdAt = existing.createdAt || now;
    } else {
      // A client-supplied id for a brand-new quote (first save) is fine --
      // it was generated by the SAME newAgencyQuoteId() format client-side;
      // the security boundary is the agencyId write below, not the id.
    }
  } else {
    quoteId = newAgencyQuoteId(email);
  }

  // Look up the agency's display name the same way enterAgencyPortal() does
  // client-side (users/{email}.name, falling back to the email) -- never
  // trusted from the client request.
  const userSnap = await db.collection('users').doc(agencyEmailLower).get();
  const agencyName = (userSnap.exists && (userSnap.data().name || userSnap.data().company)) || email;

  const quote = {
    quoteId, agencyId: request.auth.uid, agencyEmail: email, agencyName,
    guestName, arrivalDate, departureDate, adults, children, nights,
    currency, quoteType: 'CUSTOM_PACKAGE',
    packageId: null, packageName, guestDescription,
    guestIncludes, guestActivities, guestMessage,
    selectedComponents: componentsWithTotals,
    viluNetTotal, agencyGuestSellingTotal, agencyEarnings, paymentCollector,
    exchangeRate: 1, exchangeRateSource: null, exchangeRateSnapshotAt: null,
    status, createdAt, updatedAt: now,
    finalizedAt: status === 'FINALIZED' ? now : null,
    // Multi-Property Availability (Part 14): frozen at finalize time --
    // reads only what resolveAccommodationSelection() just verified, never
    // the property/room type's current live name/rate on reopen (Part 14:
    // "historical quote must remain stable").
    accommodationPropertyId: accommodation.propertyId,
    accommodationPropertyName: accommodation.propertyName,
    accommodationIsVilu: accommodation.isVilu,
    accommodationRoomTypeId: accommodation.roomTypeId,
    accommodationRoomTypeName: accommodation.roomTypeName,
    accommodationRateSnapshot: accommodation.rate,
    accommodationCurrency: accommodation.currency,
    accommodationAvailabilityMode: accommodation.availabilityMode,
    accommodationTotal,
  };
  await db.collection('agency_quotes').doc(quoteId).set(quote);
  return quote;
});

// Same per-person/extra-nights formula as calcQuoteViluNet() in
// vilu-agency-portal.html (Phase B) -- kept byte-for-byte equivalent so a
// Vilu-only assigned-package quote's total is IDENTICAL whether computed
// here or by the client during editing. The only new thing this adds is
// *which* basePerPerson number feeds the formula: the package's own
// agencyPricePerRoom for Vilu, or an admin-approved partner override for a
// partner property (see resolveAssignedPackageRate below) -- never a
// client-supplied number either way.
function calcAssignedPackageViluNet(basePerPerson, childDiscountPct, baseNights, adults, children, arrivalDate, departureDate, extraNightRate) {
  const childPerPerson = basePerPerson * (1 - (childDiscountPct || 0) / 100);
  const baseTotal = basePerPerson * (adults || 0) + childPerPerson * (children || 0);
  let totalNights = baseNights || 0;
  if (arrivalDate && departureDate) {
    const n = Math.round((new Date(departureDate) - new Date(arrivalDate)) / 864e5);
    if (n > 0) totalNights = n;
  }
  const extraNights = Math.max(0, totalNights - (baseNights || 0));
  const extraNightsCost = extraNights * (extraNightRate || 0) * (adults || 0);
  return { baseNights: baseNights || 0, totalNights, extraNights, total: +(baseTotal + extraNightsCost).toFixed(2) };
}

// Calendar-fix follow-up task (Part 5/6): "the server must use a trusted
// Vilu-controlled package/property/room rate -- do NOT blindly reuse the
// Vilu Residence package rate." A package's own agencyPricePerRoom is a
// Vilu-only figure (it prices Vilu's own rooms/meals/transport bundle);
// swapping in a partner property must never silently reuse that number.
// Instead each package may carry an admin-set `partnerRates[propertyId] =
// { agencyPricePerRoom, currency }` override (edited alongside the
// package's own Vilu rate in the PMS's per-agency package editor) -- the
// SAME per-person unit the Vilu path already uses, just scoped to one
// partner property. No override configured => null => "Rate on request",
// exactly like a partner room type's unset agencyRate already means for
// Custom Package quotes (resolveAccommodationSelection above).
function resolveAssignedPackageRate(pkg, accommodation) {
  if (accommodation.isVilu) {
    return { perPerson: Number(pkg.agencyPricePerRoom || pkg.pricePerRoom) || 0, currency: 'USD', configured: true };
  }
  const override = pkg.partnerRates && pkg.partnerRates[accommodation.propertyId];
  if (!override || typeof override.agencyPricePerRoom !== 'number' || !Number.isFinite(override.agencyPricePerRoom)) {
    return { perPerson: null, currency: null, configured: false };
  }
  return { perPerson: override.agencyPricePerRoom, currency: override.currency || 'USD', configured: true };
}

// ── submitAgencyAssignedPackageQuote: Agency Quote Security Hardening ──────
// Assigned Package quotes were, until this task, created/edited/finalized
// via direct client writes straight to agency_quotes -- proven exploitable
// (not assumed): with the OLD firestore.rules, an agency could create a
// brand-new doc with status:'FINALIZED' and any viluNetTotal/agencyEarnings/
// fake packageId/propertyId/roomTypeId it wanted on the very FIRST write (no
// DRAFT step required at all), and could update its own DRAFT straight to
// FINALIZED with a spoofed viluNetTotal even for a Vilu-only accommodation
// (the calendar-fix follow-up task only closed the non-Vilu case). This one
// callable is now the ONLY way an assigned-package quote is ever created,
// edited, or finalized -- mirroring submitAgencyCustomQuote's exact shape
// (same quoteId-optional create-or-update pattern, same DRAFT/FINALIZED
// status handling): the agency sends only the fields it is actually allowed
// to choose (guest name/dates/adults/children/currency/guestMessage/
// agencyGuestSellingTotal/which package/which accommodation), and the server
// re-reads the agency's own package + resolves the accommodation + computes
// viluNetTotal/agencyEarnings itself, every single time, whether saving a
// draft or finalizing. firestore.rules' agency_quotes create/update rules
// now refuse a direct agency write entirely -- see the comment on that
// match block. A Vilu-only quote computed through here comes out
// byte-identical to the old client formula (calcAssignedPackageViluNet's
// own comment) -- this is not a parallel formula, it is the same one, just
// run somewhere the agency cannot see or edit its inputs.
exports.submitAgencyAssignedPackageQuote = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { email, role } = await callerRole(request);
  if (role !== 'agency') throw new HttpsError('permission-denied', 'Agency access only.');
  const agencyEmailLower = email.toLowerCase();
  const d = request.data || {};

  const status = d.status === 'FINALIZED' ? 'FINALIZED' : 'DRAFT';
  const currency = AGENCY_QUOTE_CURRENCIES.includes(d.currency) ? d.currency : 'USD';
  const adults = Math.max(1, Math.min(20, Math.round(Number(d.adults) || 1)));
  const children = Math.max(0, Math.min(20, Math.round(Number(d.children) || 0)));
  const guestName = String(d.guestName || '').slice(0, 160).trim();
  const arrivalDate = /^\d{4}-\d{2}-\d{2}$/.test(d.arrivalDate) ? d.arrivalDate : '';
  const departureDate = /^\d{4}-\d{2}-\d{2}$/.test(d.departureDate) ? d.departureDate : '';
  const guestMessage = String(d.guestMessage || '').slice(0, 500).trim();
  const rawSellingTotal = Number(d.agencyGuestSellingTotal);
  if (d.agencyGuestSellingTotal != null && d.agencyGuestSellingTotal !== '' && !Number.isFinite(rawSellingTotal)) {
    throw new HttpsError('invalid-argument', 'Guest selling total must be a valid number.');
  }
  const agencyGuestSellingTotal = Math.max(0, Math.min(500000, Number.isFinite(rawSellingTotal) ? rawSellingTotal : 0));
  const rawExchangeRate = Number(d.exchangeRate);
  const exchangeRateEntered = currency !== 'USD' && Number.isFinite(rawExchangeRate) && rawExchangeRate > 0;
  const exchangeRate = currency === 'USD' ? 1 : (exchangeRateEntered ? rawExchangeRate : 1);

  if (status === 'FINALIZED' && !(agencyGuestSellingTotal > 0)) throw new HttpsError('invalid-argument', 'Enter a guest selling price before finalizing.');
  if (status === 'FINALIZED' && (!guestName || !arrivalDate || !departureDate)) throw new HttpsError('invalid-argument', 'Guest name and travel dates are required before finalizing.');

  const packageId = String(d.packageId || '').trim();
  if (!packageId) throw new HttpsError('invalid-argument', 'A package must be selected.');

  // The agency's own package -- the SAME trusted source resolveAgencyQuoteComponent()
  // already reads for a Custom Package's 'agency_package' component; never
  // trusted from anything the client itself supplies.
  const pkgSnap = await db.collection('agency_packages').doc(agencyEmailLower).get();
  const packages = (pkgSnap.exists && pkgSnap.data().packages) || [];
  const pkg = packages.find((p) => p.id === packageId);
  if (!pkg) throw new HttpsError('not-found', 'Package not found in your own agency package set.');
  if (pkg.active === false) throw new HttpsError('failed-precondition', 'This package is currently Not assigned.');

  const accommodation = await resolveAccommodationSelection(d);
  const rate = resolveAssignedPackageRate(pkg, accommodation);
  if (status === 'FINALIZED' && !rate.configured) {
    throw new HttpsError('failed-precondition', 'This accommodation has no approved package rate yet -- ask Vilu to configure it before finalizing.');
  }

  const settingsSnap = await db.collection('website_content').doc('agency_booking_settings').get();
  const extraNightRate = (settingsSnap.exists && settingsSnap.data().extraNightRate != null) ? settingsSnap.data().extraNightRate : 40;

  // A DRAFT with no configured rate yet still needs SOME preview number --
  // 0 is the honest value when there's genuinely nothing trusted to compute
  // from (never a guess), same as Custom Package's own DRAFT-with-no-
  // configured-partner-rate behavior; FINALIZE with the same gap is already
  // blocked just above.
  const net = calcAssignedPackageViluNet(
    rate.configured ? rate.perPerson : 0, pkg.childDiscountPct, pkg.nights,
    adults, children, arrivalDate, departureDate, extraNightRate
  );

  const now = new Date().toISOString();
  let quoteId = String(d.quoteId || '').trim();
  let createdAt = now;
  let existing = null;
  if (quoteId) {
    const existingSnap = await db.collection('agency_quotes').doc(quoteId).get();
    if (existingSnap.exists) {
      existing = existingSnap.data();
      if (existing.agencyId !== request.auth.uid) throw new HttpsError('permission-denied', 'Not your quotation.');
      if (existing.quoteType !== 'ASSIGNED_PACKAGE') throw new HttpsError('invalid-argument', 'Wrong quote type for this function.');
      if (existing.status !== 'DRAFT') throw new HttpsError('failed-precondition', 'This quotation is finalized and can no longer be edited.');
      createdAt = existing.createdAt || now;
    }
    // A client-supplied id for a brand-new quote (first save) is fine -- see
    // submitAgencyCustomQuote's identical comment; the security boundary is
    // the agencyId write below, not the id.
  } else {
    quoteId = newAgencyQuoteId(email);
  }

  const userSnap = await db.collection('users').doc(agencyEmailLower).get();
  const agencyName = (userSnap.exists && (userSnap.data().name || userSnap.data().company)) || email;

  // Guest-facing snapshot (Part 19 precedent, preserved from the old client
  // logic): sanitized ONCE, the first time this quote is ever saved, and
  // then carried through unchanged on every later edit -- reusing the
  // EXISTING doc's own guestIncludes/guestActivities rather than
  // recomputing from the package's current (possibly since-edited)
  // includes/activities, so if Vilu edits this package's content later, an
  // already-saved quote's guest-facing text stays exactly as it was.
  const guestIncludes = existing ? (existing.guestIncludes || []) : (pkg.includes || []).map(sanitizeGuestLabel).filter(Boolean);
  const guestActivities = existing ? (existing.guestActivities || []) : (pkg.activities || []).map(sanitizeGuestLabel).filter(Boolean);

  const quote = {
    quoteId, agencyId: request.auth.uid, agencyEmail: email, agencyName,
    guestName, arrivalDate, departureDate, adults, children, nights: net.totalNights,
    currency, quoteType: 'ASSIGNED_PACKAGE',
    packageId, packageName: String(pkg.name || ''), childDiscountPct: pkg.childDiscountPct || 0,
    guestIncludes, guestActivities, guestMessage,
    viluNetTotal: net.total, agencyGuestSellingTotal,
    agencyEarnings: +(agencyGuestSellingTotal - net.total).toFixed(2),
    exchangeRate, exchangeRateSource: exchangeRateEntered ? 'agency-entered' : null,
    exchangeRateSnapshotAt: exchangeRateEntered ? now : null,
    status, createdAt, updatedAt: now,
    finalizedAt: status === 'FINALIZED' ? now : null,
    // Frozen at save time (Part 14 precedent from Custom Package quotes) --
    // reads only what resolveAccommodationSelection() just verified, never
    // the property/room type's current live name/rate on reopen.
    accommodationPropertyId: accommodation.propertyId,
    accommodationPropertyName: accommodation.propertyName,
    accommodationIsVilu: accommodation.isVilu,
    accommodationRoomTypeId: accommodation.roomTypeId,
    accommodationRoomTypeName: accommodation.roomTypeName,
    accommodationRateSnapshot: rate.configured ? rate.perPerson : null,
    accommodationCurrency: rate.configured ? rate.currency : null,
    accommodationAvailabilityMode: accommodation.availabilityMode,
  };
  await db.collection('agency_quotes').doc(quoteId).set(quote);
  return quote;
});

// ── getAgencyAvailability: Agency Sales Workflow Phase D ───────────────────
// Why this needs a callable and not a client-side read: the Admin PMS's own
// Calendar (fetchRoomIntervals/hasBlockConflict, see the comment trail this
// phase's audit left) checks room_availability (reservation date ranges,
// already PII-free) PLUS the `blocks` collection -- but `blocks.reason` can
// contain "Agency: <name> — <note>" (set by approveBlockRequest() in
// vilu-unified.html), and `blocks` is `allow read: if true` because the
// UNAUTHENTICATED public website also needs it for its own live conflict
// check (vilu-website.html + every /<locale>/index.html mirror -- none of
// them have a Firebase Auth session to gate on). Tightening that rule would
// break the public site, so it stays as-is (documented, not fixed, in the
// Phase D report) -- instead the Agency Portal stops reading `blocks` (or
// `reservations` beyond its own agencyId-scoped query) directly at all, and
// gets its availability exclusively through this redacted projection.
//
// Reuses the EXACT overlap semantics already used everywhere else in this
// codebase (writeReservation's transaction check, hasBlockConflict,
// isOcc, freeRoomsForStay): a half-open interval test, checkIn < end &&
// checkOut > start -- not a new formula.
const AGENCY_AVAILABILITY_MAX_DAYS = 90;

function withinRange(date, from, to) {
  return date >= from && date < to;
}

// Multi-Property Availability (Part 3/4/25): partner properties never have
// real physical-room inventory in this codebase -- Vilu's own 6 rooms stay
// the only PMS-canonical inventory (Part 23). A partner property's
// "availability" is whatever Vilu staff entered manually (see the
// Partner Accommodation admin UI in vilu-unified.html), or, for an
// ON_REQUEST property, an explicit "must ask Vilu" marker per date --
// NEVER a fabricated AVAILABLE/green state. No guest/agency identity is
// ever tracked here (Part 10/17): a partner "booking" only ever exists as
// an accommodation_booking_requests record, never a room-availability
// grid entry, so there is no own/other distinction to make for partner
// cells at all.
async function getPartnerPropertyAvailability(propertyId, startDate, endDate, agencyId) {
  const propSnap = await db.collection('accommodation_properties').doc(propertyId).get();
  if (!propSnap.exists) throw new HttpsError('not-found', 'Property not found.');
  const prop = propSnap.data();
  if (!isFlagOn(prop.active) || !isFlagOn(prop.visibleToAgencies)) {
    throw new HttpsError('permission-denied', 'Property not available to agencies.');
  }
  const mode = ACCOMMODATION_AVAILABILITY_MODES.includes(prop.availabilityMode) ? prop.availabilityMode : 'ON_REQUEST';

  // Loose-flag tolerant (see isFlagOn's own comment): fetch the (always
  // small) room_types subcollection unfiltered and filter in application
  // code, rather than a type-strict .where('active','==',true) query that
  // would silently exclude a hand-typed "true"/1.
  const roomTypesSnap = await db.collection('accommodation_properties').doc(propertyId).collection('room_types').get();
  const roomTypes = roomTypesSnap.docs
    .filter((doc) => isFlagOn(doc.data().active) && isFlagOn(doc.data().visibleToAgencies))
    .map((doc) => Object.assign({ roomTypeId: doc.id }, doc.data()));
  const dates = dateRange(startDate, endDate);
  const days = [];

  for (const rt of roomTypes) {
    let blockedDates = {};
    if (mode === 'MANUAL_INVENTORY') {
      const availSnap = await db.collection('accommodation_properties').doc(propertyId)
        .collection('room_types').doc(rt.roomTypeId).collection('manual_availability').doc('data').get();
      blockedDates = (availSnap.exists && availSnap.data().blockedDates) || {};
    }
    dates.forEach((date) => {
      if (mode === 'ON_REQUEST') { days.push({ roomTypeId: rt.roomTypeId, date, state: 'ON_REQUEST' }); return; }
      days.push({ roomTypeId: rt.roomTypeId, date, state: blockedDates[date] ? 'BLOCKED' : 'AVAILABLE' });
    });
  }

  // Internal PMS manual room slots -- CALENDAR DISPLAY ONLY (2026-09-13).
  // `manualPmsRoomSlots` is a staff-only PMS operational count; it is
  // projected here under a deliberately different, narrower name
  // (`calendarRoomSlotCount`, also returned per-property from
  // getAgencyProperties()) so the Agency Portal can render Room 1..N rows
  // that visually mirror the PMS -- it must NEVER be read as confirmed
  // commercial availability math (that stays exactly `mode` above, which
  // remains ON_REQUEST regardless of how many slots exist). Room-level
  // occupancy is sourced the SAME way Vilu's own PHYSICAL_ROOMS branch
  // above reads it -- room_availability/{roomId} + blocks -- since a
  // manually-created PMS partner reservation writes to that exact
  // collection under prefix+N ids. A PMS-created manual booking never
  // carries an agencyId, so it can never be misattributed as "your
  // booking" here; only a genuine Agency-Portal-originated reservation
  // (matched via the same ownReservations query already used for Vilu)
  // is ever marked as the caller's own.
  const slotCount = Math.max(0, Math.round(+prop.manualPmsRoomSlots || 0));
  const legacyPrefix = prop.legacyRoomPrefix || (propertyId + '-R');
  const roomIds = [];
  for (let i = 1; i <= slotCount; i++) roomIds.push(legacyPrefix + i);

  const ownReservations = {};
  const roomDays = [];
  if (roomIds.length) {
    const roomResults = await Promise.all(roomIds.map(async (roomId) => {
      const availSnap = await db.collection('room_availability').doc(roomId).get();
      const bookings = (availSnap.exists && availSnap.data().bookings) || [];
      const blockSnap = await db.collection('blocks').where('room_id', '==', roomId).get();
      const blocks = blockSnap.docs.map((doc) => doc.data());
      return { roomId, bookings, blocks };
    }));

    if (agencyId) {
      // Single-field query (same shape as Vilu's own ownReservations lookup
      // above) -- no composite index needed. Scoped to this property's
      // rooms in application code, not in the query itself.
      const ownResSnap = await db.collection('reservations').where('agencyId', '==', agencyId).get();
      ownResSnap.docs.forEach((doc) => {
        const r = doc.data();
        if (!roomIds.includes(r.room_id)) return;
        if (!isActiveStatus(r.status)) return;
        if (!overlaps(r.check_in, r.check_out, startDate, endDate)) return;
        ownReservations[doc.id] = {
          reservationId: doc.id, guestName: r.guest_name || '', arrivalDate: r.check_in, departureDate: r.check_out,
          adults: r.adults || 0, children: r.children || 0, status: r.status, bookingReference: doc.id,
        };
      });
    }

    roomResults.forEach(({ roomId, bookings, blocks }) => {
      dates.forEach((date) => {
        const booking = bookings.find((b) => withinRange(date, b.from, b.to));
        if (booking) {
          const cell = { roomId, date, state: 'OCCUPIED' };
          if (ownReservations[booking.id]) cell.ownReservationId = booking.id;
          roomDays.push(cell);
          return;
        }
        const block = blocks.find((b) => withinRange(date, (b.from_date || '').slice(0, 10), (b.to_date || '').slice(0, 10)));
        if (block) { roomDays.push({ roomId, date, state: 'BLOCKED' }); return; }
        // Deliberately its own state, never 'AVAILABLE' -- an empty slot on
        // an ON_REQUEST property is not confirmed bookable inventory, only
        // "not currently known to be occupied/blocked". The client must
        // still show the property-level "Availability on request" notice
        // and route any booking through Vilu confirmation, never a direct
        // click-to-book like a Vilu room.
        roomDays.push({ roomId, date, state: mode === 'ON_REQUEST' ? 'ON_REQUEST_SLOT' : 'AVAILABLE' });
      });
    });
  }

  return {
    property: { propertyId, propertyName: String(prop.propertyName || propertyId), isVilu: false, availabilityMode: mode },
    roomTypes: roomTypes.map((rt) => ({
      roomTypeId: rt.roomTypeId, roomTypeName: String(rt.roomTypeName || rt.roomTypeId),
      capacity: typeof rt.capacity === 'number' ? rt.capacity : null,
      agencyRate: typeof rt.agencyRate === 'number' && Number.isFinite(rt.agencyRate) ? rt.agencyRate : null,
      currency: rt.currency || null,
    })),
    days,
    rooms: roomIds.map((id, i) => ({ roomId: id, label: 'Room ' + (i + 1) })),
    roomDays,
    ownReservations,
  };
}

// Multi-Property Availability (Part 1/11/19): the agency-safe property list
// backing the Calendar's property filter and the Accommodation picker in
// both quote builders. Vilu Residence is synthesized here (never a
// Firestore doc -- it is this app's own root identity, already canonical
// everywhere else in this codebase) and always sorted first, ahead of any
// partner's own displayOrder. A partner property is included ONLY when
// active && visibleToAgencies -- an inactive or not-yet-approved property
// (and its notesInternal/internal contact fields, which are never even
// selected below) never reaches this response at all.
exports.getAgencyProperties = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role } = await callerRole(request);
  if (role !== 'agency') throw new HttpsError('permission-denied', 'Agency access only.');
  // Loose-flag tolerant (see isFlagOn's own comment above): fetch the
  // (always small) accommodation_properties collection unfiltered and
  // filter in application code, rather than a type-strict
  // .where('active','==',true) query that would silently exclude a real
  // property whose active/visibleToAgencies was hand-typed as "true"/1
  // instead of a real boolean.
  const snap = await db.collection('accommodation_properties').get();
  const partners = snap.docs
    .filter((doc) => isFlagOn(doc.data().active) && isFlagOn(doc.data().visibleToAgencies))
    .map((doc) => Object.assign({ propertyId: doc.id }, doc.data()))
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
    .map((p) => ({
      propertyId: p.propertyId, propertyName: String(p.propertyName || p.propertyId), propertyType: String(p.propertyType || ''),
      isVilu: false, location: String(p.location || ''),
      availabilityMode: ACCOMMODATION_AVAILABILITY_MODES.includes(p.availabilityMode) ? p.availabilityMode : 'ON_REQUEST',
      // Calendar-row-count projection ONLY (2026-09-13) -- deliberately a
      // different, narrower name than the PMS's own `manualPmsRoomSlots`
      // field, and deliberately just a count, never a rate/room-id/config
      // value. Used solely so the Agency Calendar can render the same
      // number of Room 1..N rows the PMS shows; never confirmed commercial
      // availability (that stays `availabilityMode`, untouched above).
      calendarRoomSlotCount: Math.max(0, Math.round(+p.manualPmsRoomSlots || 0)),
    }));
  return {
    properties: [
      { propertyId: 'VILU', propertyName: 'Vilu Residence', propertyType: 'Guesthouse', isVilu: true, location: 'Maamigili, South Ari Atoll', availabilityMode: 'VILU_LIVE' },
    ].concat(partners),
  };
});

// ONE-TIME LEGACY PARTNER-HOTEL BRIDGE (2026-09-12) -- to be deleted once run
// in production. Live PMS investigation confirmed two REAL, though both
// Cancelled, historical reservations reference the legacy hardcoded PH
// array's room ids ("ha-R1", "hb-R2"), proving "Ranfaru Inn"/"White Sand
// Inn" are real partner properties with real (if old) business history --
// not pure decorative test data. This bridges them into the canonical
// accommodation_properties architecture WITHOUT trusting anything about
// PH's own placeholder numbers: no $70/night rate, no fabricated 10/8-room
// inventory, no invented room type -- ON_REQUEST + no room_types docs at
// all, until Vilu staff enters real current data via the PMS's own Partner
// Accommodation UI. Every field written below is fixed/hardcoded (never
// taken from request.data), so this cannot be used to write anything other
// than these exact two known-safe records. Idempotent: a doc that already
// exists (e.g. staff has since edited it for real) is never overwritten.
const LEGACY_PARTNER_HOTEL_BRIDGE = [
  {
    propertyId: 'ha', propertyName: 'Ranfaru Inn', propertyType: 'Guesthouse', location: 'Maafushi Island',
    legacyPropertyId: 'ha', legacyRoomPrefix: 'ha-R', displayOrder: 10,
  },
  {
    propertyId: 'hb', propertyName: 'White Sand Inn', propertyType: 'Guesthouse', location: 'Maafushi Island',
    legacyPropertyId: 'hb', legacyRoomPrefix: 'hb-R', displayOrder: 20,
  },
];
exports.bridgeLegacyPartnerHotels = onCall({ region: 'us-central1', maxInstances: 3 }, async (request) => {
  const { role } = await callerRole(request);
  requireStaffLike(role);
  const now = new Date().toISOString();
  const results = [];
  for (const entry of LEGACY_PARTNER_HOTEL_BRIDGE) {
    const ref = db.collection('accommodation_properties').doc(entry.propertyId);
    const existing = await ref.get();
    if (existing.exists) { results.push({ propertyId: entry.propertyId, action: 'skipped-already-exists' }); continue; }
    await ref.set({
      propertyName: entry.propertyName, propertyType: entry.propertyType, location: entry.location,
      availabilityMode: 'ON_REQUEST', displayOrder: entry.displayOrder, active: true, visibleToAgencies: true, isVilu: false,
      legacyPropertyId: entry.legacyPropertyId, legacyRoomPrefix: entry.legacyRoomPrefix,
      notesInternal: 'Bridged from the legacy PH placeholder record (2026-09-12) after confirming real historical reservations reference its room ids. No rate/room-type/availability data was migrated -- configure real current room types, agency rates, and availability mode here before relying on this property for live quoting.',
      createdAt: now, updatedAt: now,
    });
    results.push({ propertyId: entry.propertyId, action: 'created' });
  }
  return { results };
});

// Room types for ONE partner property (Part 11: the accommodation picker
// only fetches this once a non-Vilu property is actually selected, not for
// every property up front).
exports.getAgencyPropertyRoomTypes = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role } = await callerRole(request);
  if (role !== 'agency') throw new HttpsError('permission-denied', 'Agency access only.');
  const propertyId = String((request.data || {}).propertyId || '');
  if (!propertyId || propertyId === 'VILU') throw new HttpsError('invalid-argument', 'A partner propertyId is required.');
  const propSnap = await db.collection('accommodation_properties').doc(propertyId).get();
  if (!propSnap.exists || !isFlagOn(propSnap.data().active) || !isFlagOn(propSnap.data().visibleToAgencies)) {
    throw new HttpsError('not-found', 'Property not found.');
  }
  // Loose-flag tolerant -- see isFlagOn's own comment above.
  const snap = await db.collection('accommodation_properties').doc(propertyId).collection('room_types').get();
  return {
    roomTypes: snap.docs.filter((doc) => isFlagOn(doc.data().active) && isFlagOn(doc.data().visibleToAgencies)).map((doc) => {
      const rt = doc.data();
      return {
        roomTypeId: doc.id, roomTypeName: String(rt.roomTypeName || doc.id),
        capacity: typeof rt.capacity === 'number' ? rt.capacity : null,
        agencyRate: typeof rt.agencyRate === 'number' && Number.isFinite(rt.agencyRate) ? rt.agencyRate : null,
        currency: rt.currency || null,
      };
    }),
  };
});

exports.getAgencyAvailability = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role } = await callerRole(request);
  if (role !== 'agency') throw new HttpsError('permission-denied', 'Agency access only.');
  const d = request.data || {};
  const startDate = String(d.startDate || '');
  const endDate = String(d.endDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new HttpsError('invalid-argument', 'startDate/endDate must be YYYY-MM-DD.');
  }
  if (endDate <= startDate) throw new HttpsError('invalid-argument', 'endDate must be after startDate.');
  const spanDays = dateRange(startDate, endDate).length;
  if (spanDays > AGENCY_AVAILABILITY_MAX_DAYS) {
    throw new HttpsError('invalid-argument', 'Date range too large (max ' + AGENCY_AVAILABILITY_MAX_DAYS + ' days).');
  }

  // Multi-Property Availability (Part 4/19/25): propertyId is optional and
  // defaults to Vilu, so every existing caller (before this task) is
  // completely unaffected -- the branch below is the ONLY new code path;
  // everything from here down this function is byte-for-byte the original
  // Vilu-only implementation.
  // agencyId is ALWAYS request.auth.uid -- never accepted from request.data,
  // so an agency can never ask "as if" it were a different agency (Part 17/31).
  const agencyId = request.auth.uid;

  const propertyId = String(d.propertyId || 'VILU') || 'VILU';
  if (propertyId !== 'VILU') {
    return getPartnerPropertyAvailability(propertyId, startDate, endDate, agencyId);
  }

  // Same two canonical sources the Admin Calendar's own fetchRoomIntervals()
  // uses (see this phase's audit): room_availability/{roomId} for
  // reservation date ranges (already PII-free -- just {id, from, to}), and
  // a per-room `blocks` query for admin/agency-approved holds. Both reads
  // use the Admin SDK, so they see the real, complete data regardless of
  // firestore.rules -- the redaction happens in what THIS function chooses
  // to return below, not in what it's allowed to read.
  const roomResults = await Promise.all(PHYSICAL_ROOMS.map(async (room) => {
    const availSnap = await db.collection('room_availability').doc(room.id).get();
    const bookings = (availSnap.exists && availSnap.data().bookings) || [];
    const blockSnap = await db.collection('blocks').where('room_id', '==', room.id).get();
    const blocks = blockSnap.docs.map((doc) => doc.data());
    return { room, bookings, blocks };
  }));

  // Own reservations: fetched once, scoped by the SAME agencyId == uid
  // condition firestore.rules already enforces for a direct client read of
  // this agency's own reservations -- fetched here via Admin SDK only so a
  // single call can return calendar cells AND the enrichment together,
  // never so agencyId can be spoofed (it's ignored even if the client sent
  // a `data.agencyId` -- see above).
  const ownResSnap = await db.collection('reservations').where('agencyId', '==', agencyId).get();
  const ownReservations = {};
  ownResSnap.docs.forEach((doc) => {
    const r = doc.data();
    if (!isActiveStatus(r.status)) return;
    if (!overlaps(r.check_in, r.check_out, startDate, endDate)) return;
    ownReservations[doc.id] = {
      reservationId: doc.id,
      guestName: r.guest_name || '',
      arrivalDate: r.check_in,
      departureDate: r.check_out,
      adults: r.adults || 0,
      children: r.children || 0,
      status: r.status,
      bookingReference: doc.id,
    };
  });

  const dates = dateRange(startDate, endDate);
  const days = [];
  roomResults.forEach(({ room, bookings, blocks }) => {
    dates.forEach((date) => {
      const booking = bookings.find((b) => withinRange(date, b.from, b.to));
      if (booking) {
        const cell = { roomId: room.id, date, state: 'OCCUPIED' };
        if (ownReservations[booking.id]) cell.ownReservationId = booking.id;
        days.push(cell);
        return;
      }
      const block = blocks.find((b) => withinRange(date, (b.from_date || '').slice(0, 10), (b.to_date || '').slice(0, 10)));
      if (block) {
        // Deliberately no `reason` field -- that's the exact leak Part 5
        // exists to close. Agencies (including the one whose own approved
        // hold this is) only ever see the state, never the reason text.
        days.push({ roomId: room.id, date, state: 'BLOCKED' });
        return;
      }
      days.push({ roomId: room.id, date, state: 'AVAILABLE' });
    });
  });

  return {
    rooms: PHYSICAL_ROOMS.map((r) => ({ roomId: r.id, category: r.type })),
    days,
    ownReservations,
  };
});

// ── Agency Sales Workflow Phase E: Temporary Room Hold ──────────────────
// Reuses block_requests (no separate dedicated hold-request collection was
// created) with requestType:'AGENCY_HOLD' -- a different,
// single-room shape from the pre-existing legacy multi-room group-block
// request (created by submitBlock() in vilu-agency-portal.html, lowercase
// status, no requestType). The two coexist in the same collection and are
// never cross-processed: approveBlockRequest()/rejectBlockRequest() (in
// vilu-unified.html, unchanged by this phase) only ever query
// status=='pending' (lowercase); these new functions only ever query/act
// on requestType=='AGENCY_HOLD' with UPPERCASE status values.
//
// Why approval/rejection/release are callables and not a client write:
// approving a hold creates REAL inventory state (a `blocks` doc) and must
// recheck availability at the moment of approval, not trust whatever was
// true when the agency first asked -- and the block-creation + block_
// request-status-update must not be two independently-failable client
// writes (that's exactly the non-atomicity the legacy approveBlockRequest()
// already has, which this phase deliberately does better for, without
// touching the legacy path itself). Every read AND write below happens
// inside one Firestore transaction, so "recheck availability, then act" can
// never race against another approval (or a reservation landing in the
// same room) between the check and the write.
//
// Block reason privacy (Part 11): the real `blocks` doc created on
// approval always gets the generic reason 'Agency Hold' -- never the
// agency name, guest name, quote reference, or note. Those stay only in
// block_requests, which is read-access-scoped (own agency or admin/staff/
// manager) -- `blocks` itself is still public-read (unchanged, see Phase
// D's own note on why that rule can't be tightened without breaking the
// public website), so this is the one thing that must never leak into it.
// excludeBlockId (Phase F addition, optional) lets a caller ask "is this
// room free, ignoring one specific block" -- needed by
// confirmAgencyBookingRequest below to check availability while about to
// consume its own linked hold's block, without that same block reading as
// a false conflict against itself. Every existing call site (Phase E's
// approveAgencyHoldRequest) omits the argument, so `doc.id !== undefined`
// is always true there and behavior is unchanged.
async function agencyHoldAvailable(tx, roomId, arrivalDate, departureDate, excludeBlockId) {
  const availRef = db.collection('room_availability').doc(roomId);
  const availSnap = await tx.get(availRef);
  const bookings = (availSnap.exists && availSnap.data().bookings) || [];
  const resClash = bookings.some((b) => overlaps(b.from, b.to, arrivalDate, departureDate));
  if (resClash) return false;
  const blocksQuery = db.collection('blocks').where('room_id', '==', roomId);
  const blocksSnap = await tx.get(blocksQuery);
  const blkClash = blocksSnap.docs.some((doc) => doc.id !== excludeBlockId && overlaps(doc.data().from_date, doc.data().to_date, arrivalDate, departureDate));
  return !blkClash;
}

function requireStaffLike(role) {
  if (role !== 'admin' && role !== 'staff' && role !== 'manager') {
    throw new HttpsError('permission-denied', 'Admin/Staff/Manager access only.');
  }
}

// Manager+Admin-only gate for agency-application lifecycle actions (Agency
// Self-Registration, 2026-09-13) -- deliberately narrower than
// requireStaffLike(): ordinary Staff may NOT approve/reject/suspend/
// reactivate an agency or reassign its packages, per explicit product
// decision, even though Staff otherwise passes requireStaffLike() everywhere
// else in this file.
function requireManagerLike(role) {
  if (role !== 'admin' && role !== 'manager') {
    throw new HttpsError('permission-denied', 'Admin/Manager access only.');
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Agency Self-Registration + Approval (2026-09-13)
//
// An agency applies for access from the Agency Portal (public Firebase Auth
// signup, done client-side -- there is no admin session to protect there,
// unlike the PMS's own throwaway-secondary-app account-creation trick).
// Immediately after signup the client calls submitAgencyApplication(), which
// creates agency_applications/{uid} with status PENDING_APPROVAL.
// users/{email} is deliberately NEVER created at this point -- callerRole()
// already returns role:'none' for any authenticated caller with no
// users/{email} doc, so every existing agency-only callable in this file
// already correctly rejects a pending applicant with zero changes to any of
// them. Only approveAgencyApplication (Admin/Manager only) ever creates that
// doc, with role:'agency'.
// ─────────────────────────────────────────────────────────────────────────

const AGENCY_APP_FIELD_LIMITS = { agencyName: 120, contactPerson: 120, phone: 40, country: 60, website: 200, businessRegistrationNumber: 80, message: 2000 };

exports.submitAgencyApplication = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = request.auth.uid;
  const emailLower = (request.auth.token.email || '').toLowerCase();
  if (!emailLower) throw new HttpsError('permission-denied', 'No email on this account.');

  const d = request.data || {};
  function str(field, max, required) {
    const v = String(d[field] || '').trim();
    if (required && !v) throw new HttpsError('invalid-argument', field + ' is required.');
    if (v.length > max) throw new HttpsError('invalid-argument', field + ' is too long.');
    return v;
  }
  const agencyName = str('agencyName', AGENCY_APP_FIELD_LIMITS.agencyName, true);
  const contactPerson = str('contactPerson', AGENCY_APP_FIELD_LIMITS.contactPerson, true);
  const phone = str('phone', AGENCY_APP_FIELD_LIMITS.phone, true);
  const country = str('country', AGENCY_APP_FIELD_LIMITS.country, true);
  const website = str('website', AGENCY_APP_FIELD_LIMITS.website, false);
  const businessRegistrationNumber = str('businessRegistrationNumber', AGENCY_APP_FIELD_LIMITS.businessRegistrationNumber, false);
  const message = str('message', AGENCY_APP_FIELD_LIMITS.message, false);
  if (d.agreedToTerms !== true) throw new HttpsError('invalid-argument', 'You must agree to the agency access terms.');

  // Identity-collision hardening (2026-09-13): refuse self-registration for
  // ANY existing users/{email} document, not just role==='agency'. The
  // email-already-in-use recovery path in doAgencySignup() (sign in instead
  // of creating a new Auth account) means this callable can be reached by
  // an account that ALREADY belongs to an existing admin/manager/staff/
  // agency identity -- accepting that would let a later approval overwrite
  // a privileged users/{email} doc with role:'agency'. The legitimate retry
  // case (a genuinely new applicant whose first submitAgencyApplication
  // call failed after Auth account creation succeeded) has no users/{email}
  // doc at all, so this never blocks it. The error message is deliberately
  // generic -- never reveal to the public applicant which internal role the
  // email already holds.
  const userDoc = await db.collection('users').doc(emailLower).get();
  if (userDoc.exists) {
    throw new HttpsError('already-exists', 'This account is already associated with an existing Vilu account and cannot be used for a new agency application.');
  }

  const appRef = db.collection('agency_applications').doc(uid);
  const existing = await appRef.get();
  if (existing.exists) {
    const existingStatus = existing.data().status;
    // Resumability (2026-09-13 hardening): if a prior attempt already wrote
    // this doc as PENDING_APPROVAL (e.g. the client's first call succeeded
    // but a network error hid the response), treat a retry as a successful
    // no-op rather than an error -- a transient failure here must never
    // permanently strand the applicant.
    if (existingStatus === 'PENDING_APPROVAL') return { status: 'PENDING_APPROVAL' };
    if (existingStatus === 'APPROVED') throw new HttpsError('already-exists', 'This account is already an approved agency.');
    // REJECTED: no self-service re-apply in v1 -- staff must use
    // resetAgencyApplicationToPending() if they want to reconsider.
    throw new HttpsError('already-exists', 'An application already exists for this account. Please contact Vilu Residence.');
  }

  const now = FieldValue.serverTimestamp();
  await appRef.set({
    uid, emailLower, agencyName, contactPerson, phone, country, website,
    businessRegistrationNumber, message, agreedToTerms: true,
    status: 'PENDING_APPROVAL',
    submittedAt: now, approvedAt: null, approvedBy: null, approvedPackageIds: null,
    rejectedAt: null, rejectedBy: null, rejectionReason: null,
  });
  await db.collection('agency_application_audit').add({
    actorUid: uid, actorRole: 'applicant', actorEmail: emailLower,
    agencyUid: uid, agencyEmail: emailLower, action: 'SUBMITTED',
    timestamp: now, details: {},
  });
  return { status: 'PENDING_APPROVAL' };
});

// The ONLY path an applicant's own browser can learn its application status
// through -- agency_applications itself is `allow read: if false` (for
// anyone but Admin/Manager) in firestore.rules specifically because the raw
// doc carries rejectionReason/approvedBy, which must never reach the
// applicant's own browser (same field-leak class getMyAgencyBookings()
// already closed for agency-owned reservations). Returns an explicit
// allowlist only.
exports.getMyAgencyApplicationStatus = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const snap = await db.collection('agency_applications').doc(request.auth.uid).get();
  if (!snap.exists) return { status: 'NONE' };
  const a = snap.data();
  return {
    status: a.status,
    agencyName: a.agencyName || '',
    submittedAt: a.submittedAt ? a.submittedAt.toDate().toISOString() : null,
  };
});

// Admin/Manager-only listing for the PMS's Pending tab. Merges LIVE Firebase
// Auth state (emailVerified/authUserExists) per row -- never a cached/
// stored value -- so staff can see accurate verification status before
// approving. This callable is UI-display-only: approveAgencyApplication
// independently re-fetches and re-verifies Auth identity/email/emailVerified
// itself and never trusts this list result for authorization (a row shown
// as "verified" here could go stale between this call and the approve
// click).
exports.listPendingAgencyApplications = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role } = await callerRole(request);
  requireManagerLike(role);
  const snap = await db.collection('agency_applications').where('status', '==', 'PENDING_APPROVAL').get();
  const auth = getAuth();
  const applications = await Promise.all(snap.docs.map(async (doc) => {
    const a = doc.data();
    let emailVerified = false;
    let authUserExists = true;
    try {
      const authUser = await auth.getUser(a.uid);
      emailVerified = !!authUser.emailVerified;
    } catch (e) {
      authUserExists = false;
    }
    return {
      applicationId: doc.id, uid: a.uid, agencyName: a.agencyName || '', contactPerson: a.contactPerson || '',
      emailLower: a.emailLower || '', phone: a.phone || '', country: a.country || '',
      website: a.website || '', businessRegistrationNumber: a.businessRegistrationNumber || '', message: a.message || '',
      submittedAt: a.submittedAt ? a.submittedAt.toDate().toISOString() : null,
      emailVerified, authUserExists,
    };
  }));
  return { applications };
});

// Admin/Manager-only, narrow, purpose-built projection for the PMS's
// Approved/Suspended tabs -- deliberately NOT a direct client query against
// the `users` collection (least-privilege: even though isManagerRole()
// already has broad read access to `users` in firestore.rules for other
// reasons, this new UI never exercises that directly, and returns only the
// fields this specific screen needs). Existing admin User Management
// (#s-users) is untouched and keeps using its own existing direct reads.
exports.listAgencyAccounts = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role } = await callerRole(request);
  requireManagerLike(role);
  const usersSnap = await db.collection('users').where('role', '==', 'agency').get();
  const accounts = await Promise.all(usersSnap.docs.map(async (doc) => {
    const u = doc.data();
    const pkgSnap = await db.collection('agency_packages').doc(doc.id).get();
    const packages = (pkgSnap.exists && pkgSnap.data().packages) || [];
    return {
      email: doc.id, uid: u.uid || null, agencyName: u.name || u.company || doc.id,
      accountStatus: u.accountStatus === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
      commission: typeof u.commission === 'number' ? u.commission : 0,
      assignedPackageCount: packages.length, assignedPackageIds: packages.map((p) => p.id),
    };
  }));
  return { accounts };
});

// Re-fetches canonical agency-channel packages from the `packages`
// collection (the same collection the PMS Package Manager's Agency Packages
// tab already syncs to via syncPackagesToFirestore()) and returns the FULL
// stored objects for the requested ids -- never a hand-picked subset of
// fields, and never trusting any package content the client might have
// supplied. Shared by approveAgencyApplication and setAgencyPackages.
async function resolveCanonicalAgencyPackages(packageIds) {
  const pkgSnap = await db.collection('packages').get();
  const masterAgencyPkgs = pkgSnap.docs
    .map((d) => Object.assign({}, d.data(), { id: d.id }))
    .filter((p) => p.channel === 'agency');
  const idSet = new Set(packageIds);
  return masterAgencyPkgs.filter((p) => idSet.has(p.id));
}

exports.approveAgencyApplication = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role, email: approverEmail } = await callerRole(request);
  requireManagerLike(role);
  const applicationId = String((request.data || {}).applicationId || '');
  const requestedPackageIds = Array.isArray((request.data || {}).packageIds) ? (request.data || {}).packageIds.map(String) : [];
  if (!applicationId) throw new HttpsError('invalid-argument', 'applicationId required.');

  const appRef = db.collection('agency_applications').doc(applicationId);
  const appSnap = await appRef.get();
  if (!appSnap.exists) throw new HttpsError('not-found', 'Application not found.');
  const app = appSnap.data();
  if (app.status !== 'PENDING_APPROVAL') {
    throw new HttpsError('failed-precondition', 'Application is not pending (already ' + app.status + ').');
  }

  // Identity lock (2026-09-13 hardening): never approve based only on the
  // email stored in the application document. The Auth uid is the
  // authoritative applicant identity -- re-fetch it live and require the
  // account to still exist, be verified, and have the SAME email it applied
  // with. If the applicant has since changed their Auth email, refuse
  // outright rather than silently approving a different email than the one
  // that was actually reviewed.
  let authUser;
  try {
    authUser = await getAuth().getUser(app.uid);
  } catch (e) {
    throw new HttpsError('not-found', 'The applicant\'s account no longer exists.');
  }
  if (!authUser.email) throw new HttpsError('failed-precondition', 'The applicant\'s account has no email on file.');
  if (!authUser.emailVerified) throw new HttpsError('failed-precondition', 'The applicant has not verified their email yet.');
  const authEmail = authUser.email.trim().toLowerCase();
  if (authEmail !== app.emailLower) {
    throw new HttpsError('failed-precondition', 'The applicant\'s email has changed since they applied (applied as ' + app.emailLower + ', now ' + authEmail + '). Refusing to approve automatically.');
  }

  const selected = await resolveCanonicalAgencyPackages(requestedPackageIds);

  // Atomicity (2026-09-13 hardening): users/{email} activation,
  // agency_packages/{email} assignment, agency_applications status, and the
  // audit record must all succeed together -- never a partial state where
  // an agency gains access but its package assignment (or vice versa)
  // silently failed. Re-checks PENDING status inside the transaction to
  // guard against a double-approve race between two managers.
  const now = FieldValue.serverTimestamp();
  const auditRef = db.collection('agency_application_audit').doc();
  const userRef = db.collection('users').doc(authEmail);
  await db.runTransaction(async (tx) => {
    // Both reads happen before any write, as Firestore transactions require.
    const freshAppSnap = await tx.get(appRef);
    const existingUserSnap = await tx.get(userRef);
    if (!freshAppSnap.exists || freshAppSnap.data().status !== 'PENDING_APPROVAL') {
      throw new HttpsError('failed-precondition', 'Application is no longer pending.');
    }
    // Identity-collision hardening (2026-09-13): refuse to overwrite ANY
    // existing users/{email} document -- admin/manager/staff/agency alike.
    // Checked INSIDE the transaction (not as a separate pre-check) so there
    // is no race window between check and write: e.g. a document could be
    // created by an entirely unrelated action between an outside check and
    // this transaction's own commit. A refusal here leaves the application
    // untouched (still PENDING_APPROVAL) and creates no agency_packages doc
    // and no audit record claiming APPROVED -- this whole transaction
    // throws and nothing it would have written lands.
    if (existingUserSnap.exists) {
      throw new HttpsError('already-exists', 'A user account already exists for this email -- refusing to overwrite an existing identity.');
    }
    tx.set(userRef, {
      email: authEmail, name: app.agencyName, company: app.agencyName,
      role: 'agency', accountStatus: 'ACTIVE', uid: app.uid, commission: 0,
    }, { merge: true });
    tx.set(db.collection('agency_packages').doc(authEmail), {
      email: authEmail, packages: selected,
    }, { merge: true });
    tx.set(appRef, {
      status: 'APPROVED', approvedAt: now, approvedBy: approverEmail,
      approvedPackageIds: selected.map((p) => p.id),
    }, { merge: true });
    tx.set(auditRef, {
      actorUid: request.auth.uid, actorRole: role, actorEmail: approverEmail,
      agencyUid: app.uid, agencyEmail: authEmail, action: 'APPROVED',
      timestamp: now, details: { packageIds: selected.map((p) => p.id) },
    });
  });
  return { status: 'APPROVED', packageCount: selected.length };
});

exports.rejectAgencyApplication = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role, email: approverEmail } = await callerRole(request);
  requireManagerLike(role);
  const applicationId = String((request.data || {}).applicationId || '');
  const reason = String((request.data || {}).reason || '').trim().slice(0, 1000);
  if (!applicationId) throw new HttpsError('invalid-argument', 'applicationId required.');

  const appRef = db.collection('agency_applications').doc(applicationId);
  const now = FieldValue.serverTimestamp();
  const auditRef = db.collection('agency_application_audit').doc();
  let agencyUid = null, agencyEmail = null;
  await db.runTransaction(async (tx) => {
    const appSnap = await tx.get(appRef);
    if (!appSnap.exists) throw new HttpsError('not-found', 'Application not found.');
    const app = appSnap.data();
    if (app.status !== 'PENDING_APPROVAL') {
      throw new HttpsError('failed-precondition', 'Application is not pending (already ' + app.status + ').');
    }
    agencyUid = app.uid; agencyEmail = app.emailLower;
    tx.set(appRef, { status: 'REJECTED', rejectedAt: now, rejectedBy: approverEmail, rejectionReason: reason || null }, { merge: true });
    tx.set(auditRef, {
      actorUid: request.auth.uid, actorRole: role, actorEmail: approverEmail,
      agencyUid: app.uid, agencyEmail: app.emailLower, action: 'REJECTED',
      timestamp: now, details: { reason: reason || null },
    });
  });
  return { status: 'REJECTED' };
});

// Reconsideration path: staff may flip a REJECTED application back to
// PENDING_APPROVAL without any special-cased second precondition on
// Approve/Reject's own (deliberately simple) PENDING_APPROVAL-only guards.
// No v1 UI lets an applicant trigger this themselves (see submit's own
// REJECTED handling above).
exports.resetAgencyApplicationToPending = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role, email: actorEmail } = await callerRole(request);
  requireManagerLike(role);
  const applicationId = String((request.data || {}).applicationId || '');
  if (!applicationId) throw new HttpsError('invalid-argument', 'applicationId required.');

  const appRef = db.collection('agency_applications').doc(applicationId);
  const now = FieldValue.serverTimestamp();
  const auditRef = db.collection('agency_application_audit').doc();
  await db.runTransaction(async (tx) => {
    const appSnap = await tx.get(appRef);
    if (!appSnap.exists) throw new HttpsError('not-found', 'Application not found.');
    const app = appSnap.data();
    if (app.status !== 'REJECTED') throw new HttpsError('failed-precondition', 'Only a rejected application can be reset to pending.');
    tx.set(appRef, { status: 'PENDING_APPROVAL', rejectedAt: null, rejectedBy: null, rejectionReason: null }, { merge: true });
    tx.set(auditRef, {
      actorUid: request.auth.uid, actorRole: role, actorEmail: actorEmail,
      agencyUid: app.uid, agencyEmail: app.emailLower, action: 'RESET_TO_PENDING',
      timestamp: now, details: {},
    });
  });
  return { status: 'PENDING_APPROVAL' };
});

exports.suspendAgencyAccount = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role, email: actorEmail } = await callerRole(request);
  requireManagerLike(role);
  const email = String((request.data || {}).email || '').toLowerCase();
  if (!email) throw new HttpsError('invalid-argument', 'email required.');
  const userRef = db.collection('users').doc(email);
  const now = FieldValue.serverTimestamp();
  const auditRef = db.collection('agency_application_audit').doc();
  let agencyUid = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists || snap.data().role !== 'agency') throw new HttpsError('not-found', 'Agency account not found.');
    agencyUid = snap.data().uid || null;
    tx.set(userRef, { accountStatus: 'SUSPENDED' }, { merge: true });
    tx.set(auditRef, {
      actorUid: request.auth.uid, actorRole: role, actorEmail: actorEmail,
      agencyUid, agencyEmail: email, action: 'SUSPENDED',
      timestamp: now, details: {},
    });
  });
  return { accountStatus: 'SUSPENDED' };
});

exports.reactivateAgencyAccount = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role, email: actorEmail } = await callerRole(request);
  requireManagerLike(role);
  const email = String((request.data || {}).email || '').toLowerCase();
  if (!email) throw new HttpsError('invalid-argument', 'email required.');
  const userRef = db.collection('users').doc(email);
  const now = FieldValue.serverTimestamp();
  const auditRef = db.collection('agency_application_audit').doc();
  let agencyUid = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists || snap.data().role !== 'agency') throw new HttpsError('not-found', 'Agency account not found.');
    agencyUid = snap.data().uid || null;
    tx.set(userRef, { accountStatus: 'ACTIVE' }, { merge: true });
    tx.set(auditRef, {
      actorUid: request.auth.uid, actorRole: role, actorEmail: actorEmail,
      agencyUid, agencyEmail: email, action: 'REACTIVATED',
      timestamp: now, details: {},
    });
  });
  return { accountStatus: 'ACTIVE' };
});

// Manager-capable write path for agency_packages/{email}, added ALONGSIDE
// (never replacing) the existing admin-hardcoded #m-agency-pkgs modal in
// vilu-unified.html, whose client-side write goes straight to Firestore
// under the isAdmin()-only agency_packages rule and is left completely
// untouched. This callable exists because that rule doesn't work for a
// Manager at all today -- same Admin-SDK-bypass pattern
// bridgeLegacyPartnerHotels already uses for accommodation_properties.
exports.setAgencyPackages = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role, email: actorEmail } = await callerRole(request);
  requireManagerLike(role);
  const email = String((request.data || {}).email || '').toLowerCase();
  const packageIds = Array.isArray((request.data || {}).packageIds) ? (request.data || {}).packageIds.map(String) : [];
  if (!email) throw new HttpsError('invalid-argument', 'email required.');

  const userSnap = await db.collection('users').doc(email).get();
  if (!userSnap.exists || userSnap.data().role !== 'agency') throw new HttpsError('not-found', 'Agency account not found.');
  const selected = await resolveCanonicalAgencyPackages(packageIds);

  const now = FieldValue.serverTimestamp();
  const auditRef = db.collection('agency_application_audit').doc();
  await db.runTransaction(async (tx) => {
    tx.set(db.collection('agency_packages').doc(email), { email, packages: selected }, { merge: true });
    tx.set(auditRef, {
      actorUid: request.auth.uid, actorRole: role, actorEmail: actorEmail,
      agencyUid: userSnap.data().uid || null, agencyEmail: email, action: 'PACKAGES_SET',
      timestamp: now, details: { packageIds: selected.map((p) => p.id) },
    });
  });
  return { packageCount: selected.length };
});

exports.approveAgencyHoldRequest = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role, email } = await callerRole(request);
  requireStaffLike(role);
  const requestId = String((request.data || {}).requestId || '');
  if (!requestId) throw new HttpsError('invalid-argument', 'requestId required.');
  const reqRef = db.collection('block_requests').doc(requestId);

  const settingsSnap = await db.collection('website_content').doc('agency_booking_settings').get();
  const defaultHoldHours = (settingsSnap.exists && Number(settingsSnap.data().defaultHoldHours)) || 24;

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(reqRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Hold request not found.');
    const req = snap.data();
    if (req.requestType !== 'AGENCY_HOLD') throw new HttpsError('failed-precondition', 'Not an agency hold request.');
    if (req.status !== 'PENDING') throw new HttpsError('failed-precondition', 'Request is not pending (already ' + req.status + ').');

    const available = await agencyHoldAvailable(tx, req.roomId, req.arrivalDate, req.departureDate);
    if (!available) {
      // Do NOT create a block, do NOT change status -- the request stays
      // PENDING so staff can reject it and ask the agency to resubmit
      // (Part 9). Nothing is written here at all.
      return { availabilityChanged: true };
    }

    const now = new Date();
    const approvedHoldUntil = new Date(now.getTime() + defaultHoldHours * 3600 * 1000).toISOString();
    const blockId = 'BL' + Date.now() + '-' + req.roomId;
    tx.set(db.collection('blocks').doc(blockId), {
      id: blockId, room_id: req.roomId, from_date: req.arrivalDate, to_date: req.departureDate, reason: 'Agency Hold',
    });
    tx.set(reqRef, {
      status: 'APPROVED', approvedAt: now.toISOString(), approvedBy: email,
      approvedHoldUntil, blockId,
    }, { merge: true });
    return { approvedHoldUntil, blockId, roomId: req.roomId };
  });
});

exports.rejectAgencyHoldRequest = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role, email } = await callerRole(request);
  requireStaffLike(role);
  const requestId = String((request.data || {}).requestId || '');
  if (!requestId) throw new HttpsError('invalid-argument', 'requestId required.');
  const reqRef = db.collection('block_requests').doc(requestId);
  const snap = await reqRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Hold request not found.');
  const req = snap.data();
  if (req.requestType !== 'AGENCY_HOLD') throw new HttpsError('failed-precondition', 'Not an agency hold request.');
  if (req.status !== 'PENDING') throw new HttpsError('failed-precondition', 'Request is not pending (already ' + req.status + ').');
  await reqRef.set({ status: 'REJECTED', approvedAt: new Date().toISOString(), approvedBy: email }, { merge: true });
  return { status: 'REJECTED' };
});

// Admin/Manager manually ending an APPROVED hold early (Part 14). Chose
// CANCELLED over inventing a 6th "RELEASED" status -- Part 3's own status
// enum only lists PENDING/APPROVED/REJECTED/EXPIRED/CANCELLED, and
// CANCELLED already reads naturally as "ended before its normal course"
// for either an early manual release or (potentially, later) an agency-
// initiated cancellation. Deleting the block is idempotent -- if it's
// already gone for any reason, that's treated as success, not an error.
exports.releaseAgencyHoldRequest = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role, email } = await callerRole(request);
  requireStaffLike(role);
  const requestId = String((request.data || {}).requestId || '');
  if (!requestId) throw new HttpsError('invalid-argument', 'requestId required.');
  const reqRef = db.collection('block_requests').doc(requestId);
  const snap = await reqRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Hold request not found.');
  const req = snap.data();
  if (req.requestType !== 'AGENCY_HOLD') throw new HttpsError('failed-precondition', 'Not an agency hold request.');
  if (req.status !== 'APPROVED') throw new HttpsError('failed-precondition', 'Request is not an active approved hold.');
  if (req.blockId) {
    try { await db.collection('blocks').doc(req.blockId).delete(); } catch (e) { /* already gone -- fine */ }
  }
  await reqRef.set({ status: 'CANCELLED', releasedAt: new Date().toISOString(), releasedBy: email }, { merge: true });
  return { status: 'CANCELLED' };
});

// Scheduled sweep, same pattern/timezone convention as nightlyReconcile
// above. Every 15 minutes rather than once nightly -- holds are only
// 1-168 hours long (see the admin-configurable defaultHoldHours setting),
// so a nightly-only sweep would leave an expired hold blocking real
// inventory for up to a day. Two equality filters (requestType, status)
// keep this a plain, automatically-indexed query -- the approvedHoldUntil
// comparison is done in memory across the (small, single-property) result
// set rather than as a third Firestore filter, avoiding any need for a
// manually-deployed composite index.
//
// Idempotency (Part 27 — "function runs twice, block removed once safely,
// no error/duplicate side effects"): each request is handled in its own
// transaction that re-reads the request fresh and no-ops if it's no longer
// APPROVED (already handled by this same sweep, a concurrent run, or a
// manual release) -- and one request's failure is caught and skipped so it
// never aborts the sweep for the rest.
exports.expireAgencyHoldRequests = onSchedule({ schedule: '*/15 * * * *', timeZone: 'Indian/Maldives' }, async () => {
  const nowIso = new Date().toISOString();
  const snap = await db.collection('block_requests')
    .where('requestType', '==', 'AGENCY_HOLD')
    .where('status', '==', 'APPROVED')
    .get();
  const due = snap.docs.filter((doc) => (doc.data().approvedHoldUntil || '') <= nowIso);
  for (const doc of due) {
    const reqRef = doc.ref;
    try {
      await db.runTransaction(async (tx) => {
        const freshSnap = await tx.get(reqRef);
        if (!freshSnap.exists || freshSnap.data().status !== 'APPROVED') return; // already handled
        const req = freshSnap.data();
        if (req.blockId) tx.delete(db.collection('blocks').doc(req.blockId));
        tx.set(reqRef, { status: 'EXPIRED', expiredAt: new Date().toISOString() }, { merge: true });
      });
    } catch (e) {
      // One bad request must never abort the sweep for the rest.
    }
  }
});

// ── Agency Sales Workflow Phase F: Booking Request → Vilu Confirmation →
// Canonical Reservation ──────────────────────────────────────────────────
// A NEW collection, agency_booking_requests, separate from agency_quotes/
// block_requests/reservations (per explicit instruction) -- an agency
// submits confirmed guest intent (a direct, rules-gated client write, same
// shape as Phase E's hold-request submission); only Vilu's confirmation,
// through confirmAgencyBookingRequest below, ever creates a real
// reservation. The old direct-create path (submitAgencyBooking() in
// vilu-agency-portal.html, writing straight to `reservations` with
// status:'Confirmed') is retired once this flow is proven -- see the
// firestore.rules comment above reservations' create rule for the cutover.
//
// Why confirmation must be a callable and not a client write: exactly the
// same reasoning as approveAgencyHoldRequest -- confirming creates REAL
// inventory state and must recheck availability at the moment of
// confirmation, never trust whatever was true when the quote was finalized
// or the request was sent. Reject/request-change create no inventory state
// themselves, but are still callables (not a rules-gated client update) so
// "agency cannot self-decide her own request" is enforced in one place,
// the same choice Phase E made for release/reject even though those aren't
// transactional either.
exports.confirmAgencyBookingRequest = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role, email } = await callerRole(request);
  requireStaffLike(role);
  const requestId = String((request.data || {}).requestId || '');
  if (!requestId) throw new HttpsError('invalid-argument', 'requestId required.');
  const reqRef = db.collection('agency_booking_requests').doc(requestId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(reqRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Booking request not found.');
    const bReq = snap.data();

    // Duplicate-confirm protection (Part 29): a second click (or a retried
    // network call) after the first confirm already succeeded must never
    // create a second reservation -- hand back the SAME reservationId
    // instead of erroring or re-running the whole transaction.
    if (bReq.status === 'CONFIRMED') {
      return { reservationId: bReq.reservationId, alreadyConfirmed: true };
    }
    if (bReq.status !== 'PENDING' && bReq.status !== 'CHANGE_REQUESTED') {
      throw new HttpsError('failed-precondition', 'Request is not awaiting confirmation (already ' + bReq.status + ').');
    }

    // Re-validate the linked quote server-side (Part 12/13) -- never trust
    // the booking request's own snapshot of "this quote is finalized and
    // mine", even though the client already checked this at submit time.
    if (!bReq.quoteId) throw new HttpsError('failed-precondition', 'Booking request has no linked quotation.');
    const quoteSnap = await tx.get(db.collection('agency_quotes').doc(bReq.quoteId));
    if (!quoteSnap.exists) throw new HttpsError('not-found', 'Linked quotation not found.');
    const quote = quoteSnap.data();
    if (quote.agencyId !== bReq.agencyId) throw new HttpsError('failed-precondition', 'Quotation ownership mismatch.');
    if (quote.status !== 'FINALIZED') throw new HttpsError('failed-precondition', 'Linked quotation is not finalized.');

    // Validate the linked hold, if any (Part 14) -- must still belong to
    // this same agency/room/dates and still be an active, unexpired
    // approval. An invalid/expired/foreign/mismatched hold is silently
    // ignored, not an error: Part 6 says a hold is optional, so
    // confirmation just falls back to a plain availability recheck for the
    // room instead of failing the whole confirmation over a stale hold
    // reference.
    let hold = null;
    if (bReq.holdRequestId) {
      const holdSnap = await tx.get(db.collection('block_requests').doc(bReq.holdRequestId));
      if (holdSnap.exists) {
        const h = holdSnap.data();
        const nowIso = new Date().toISOString();
        if (h.requestType === 'AGENCY_HOLD' && h.status === 'APPROVED' && h.agencyId === bReq.agencyId
          && h.roomId === bReq.requestedRoomId && h.arrivalDate === bReq.arrivalDate && h.departureDate === bReq.departureDate
          && (h.approvedHoldUntil || '') > nowIso) {
          hold = { ref: holdSnap.ref, data: h };
        }
      }
    }

    // Availability recheck (Part 13) -- never trust that the quote existed,
    // the hold existed, or availability was checked earlier. Excludes the
    // linked hold's own block (if validated above) so consuming it doesn't
    // read as a conflict against itself.
    const available = await agencyHoldAvailable(tx, bReq.requestedRoomId, bReq.arrivalDate, bReq.departureDate, hold ? hold.data.blockId : undefined);
    if (!available) {
      // Do NOT create a reservation, do NOT change status -- the request
      // stays PENDING/CHANGE_REQUESTED so staff can reject it or ask the
      // agency to pick another room/date (Part 13: "remain actionable, not
      // half-confirmed").
      return { availabilityChanged: true };
    }

    // ── Create the canonical reservation. This is written inline rather
    // than via writeReservationTx() (used by publicBooking/OTA ingestion)
    // because that helper opens its OWN separate transaction -- it can't be
    // nested inside this one, and hold consumption + reservation creation
    // must be one critical section (Part 14) so no gap exists between
    // releasing the hold's block and the room actually becoming occupied.
    const resId = 'ABK' + Date.now();
    const newAvailRef = db.collection('room_availability').doc(bReq.requestedRoomId);
    const newAvailSnap = await tx.get(newAvailRef);
    const newBookings = ((newAvailSnap.exists && newAvailSnap.data().bookings) || []).filter((b) => b.id !== resId);
    const clash = newBookings.some((b) => bReq.arrivalDate < b.to && bReq.departureDate > b.from);
    if (clash) {
      // Extremely unlikely given agencyHoldAvailable() above ran inside this
      // same transaction against the same snapshot, but guards against any
      // future drift between the two checks rather than trusting "already
      // checked" blindly.
      return { availabilityChanged: true };
    }
    newBookings.push({ id: resId, from: bReq.arrivalDate, to: bReq.departureDate });

    const now = new Date().toISOString();
    // Price/package snapshot (Part 17/19/20): copied verbatim from the
    // booking request (itself a snapshot of the finalized quote at send
    // time) -- never re-derived from the quote or catalog again, so a later
    // rate/package edit can never alter an already-confirmed reservation.
    // agencyGuestSellingTotal is stored as its own field, NOT folded into
    // hotel revenue accounting -- `rate` mirrors it for display continuity
    // with every other reservation source, but paymentCollector is what
    // future settlement logic (Phase J, not built here) must key off.
    const reservationFields = {
      id: resId, room_id: bReq.requestedRoomId,
      guest_name: bReq.guestName, guest_email: bReq.guestEmail || '', guest_phone: bReq.guestPhone || '',
      check_in: bReq.arrivalDate, check_out: bReq.departureDate,
      adults: bReq.adults, children: bReq.children || 0,
      rate: bReq.agencyGuestSellingTotal || 0, status: 'Confirmed', source: 'Agency',
      notes: '[' + (bReq.packageName || 'Agency booking') + ']',
      agencyId: bReq.agencyId, agencyEmail: bReq.agencyEmail, agencyName: bReq.agencyName,
      agencyBookingRequestId: requestId, agencyQuoteId: bReq.quoteId || null, agencyQuoteReference: bReq.quoteReference || null,
      quoteType: bReq.quoteType || null, packageName: bReq.packageName || null, packageSnapshot: bReq.packageSnapshot || null,
      guestIncludes: bReq.guestIncludes || [], guestActivities: bReq.guestActivities || [],
      currency: bReq.currency || 'USD',
      viluNetTotal: bReq.viluNetTotal || 0, agencyGuestSellingTotal: bReq.agencyGuestSellingTotal || 0,
      agencyEarnings: bReq.agencyEarnings || 0, paymentCollector: bReq.paymentCollector || 'UNDECIDED',
      created_at: now, updated_at: now, created_via: 'confirmAgencyBookingRequest',
    };
    tx.set(db.collection('reservations').doc(resId), reservationFields, { merge: true });
    tx.set(newAvailRef, { bookings: newBookings }, { merge: true });

    // Agency Sales Workflow Phase J (2026-09-11): one settlement record per
    // confirmed agency reservation, created atomically in the SAME
    // transaction that creates the reservation itself -- deterministic id
    // (== resId), so a double-confirm (already guarded above by the
    // status!=='PENDING'/'CHANGE_REQUESTED' check) can never produce a
    // second one. See buildAgencySettlementFields()'s own comment for the
    // HOTEL_TO_AGENCY/AGENCY_TO_HOTEL direction logic.
    tx.set(db.collection('agency_settlements').doc(resId), buildAgencySettlementFields(reservationFields, resId));

    // Consume the linked hold (Part 14): its block must be removed inside
    // this SAME transaction so it never leaves a leftover conflict against
    // the reservation just created for the exact same room/dates. Reuses
    // the exact CANCELLED/releasedAt/releasedBy shape releaseAgencyHoldRequest
    // already uses for a manual release -- from the hold's own lifecycle
    // perspective, being consumed by its own booking is just another way it
    // ended before/at its normal expiry, not a 6th status value.
    if (hold) {
      if (hold.data.blockId) tx.delete(db.collection('blocks').doc(hold.data.blockId));
      tx.set(hold.ref, { status: 'CANCELLED', releasedAt: now, releasedBy: email, consumedByReservationId: resId }, { merge: true });
    }

    tx.set(reqRef, {
      status: 'CONFIRMED', confirmedAt: now, confirmedBy: email, reservationId: resId, assignedRoomId: bReq.requestedRoomId,
    }, { merge: true });

    return { reservationId: resId, roomId: bReq.requestedRoomId };
  });
});

exports.rejectAgencyBookingRequest = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role, email } = await callerRole(request);
  requireStaffLike(role);
  const requestId = String((request.data || {}).requestId || '');
  const reason = String((request.data || {}).reason || '').slice(0, 500);
  if (!requestId) throw new HttpsError('invalid-argument', 'requestId required.');
  const reqRef = db.collection('agency_booking_requests').doc(requestId);
  const snap = await reqRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Booking request not found.');
  const bReq = snap.data();
  if (bReq.status !== 'PENDING' && bReq.status !== 'CHANGE_REQUESTED') {
    throw new HttpsError('failed-precondition', 'Request cannot be rejected (already ' + bReq.status + ').');
  }
  const now = new Date().toISOString();

  // Part 11: release a linked active hold on rejection -- chosen behavior
  // is to always release it, since there is no longer a guest booking this
  // hold could turn into, and no operational reason found to keep the room
  // withheld from other sales once its one intended booking is rejected.
  if (bReq.holdRequestId) {
    const holdRef = db.collection('block_requests').doc(bReq.holdRequestId);
    const holdSnap = await holdRef.get();
    if (holdSnap.exists && holdSnap.data().status === 'APPROVED') {
      const h = holdSnap.data();
      if (h.blockId) { try { await db.collection('blocks').doc(h.blockId).delete(); } catch (e) { /* already gone -- fine */ } }
      await holdRef.set({ status: 'CANCELLED', releasedAt: now, releasedBy: email }, { merge: true });
    }
  }
  await reqRef.set({ status: 'REJECTED', rejectionReason: reason, updatedAt: now, rejectedBy: email }, { merge: true });
  return { status: 'REJECTED' };
});

exports.requestChangeAgencyBookingRequest = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role, email } = await callerRole(request);
  requireStaffLike(role);
  const requestId = String((request.data || {}).requestId || '');
  const note = String((request.data || {}).note || '').trim().slice(0, 500);
  if (!requestId) throw new HttpsError('invalid-argument', 'requestId required.');
  if (!note) throw new HttpsError('invalid-argument', 'A message for the agency is required.');
  const reqRef = db.collection('agency_booking_requests').doc(requestId);
  const snap = await reqRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Booking request not found.');
  const bReq = snap.data();
  if (bReq.status !== 'PENDING') {
    throw new HttpsError('failed-precondition', 'Request is not pending (already ' + bReq.status + ').');
  }
  // Deliberately does NOT touch a linked hold -- the guest may still
  // complete this exact booking after the agency revises it, so the hold
  // should keep running its own normal course (stay active until it's
  // separately confirmed-against, released, or expires), not be released
  // just because Vilu asked a clarifying question.
  await reqRef.set({ status: 'CHANGE_REQUESTED', changeRequestNote: note, updatedAt: new Date().toISOString(), changeRequestedBy: email }, { merge: true });
  return { status: 'CHANGE_REQUESTED' };
});

// ── Agency Sales Workflow Phase G: printable guest-safe Booking
// Confirmation ─────────────────────────────────────────────────────────
// Read-only. This is the hard server-side allowlist Part 15 asks for --
// defense in depth beyond the print renderer itself: even if a future
// change to the client template accidentally tried to render an internal
// field, that field was never sent to the browser in the first place.
//
// Source of truth (Part 1): agency_booking_requests.status must be
// CONFIRMED AND its linked reservations/{reservationId} doc must still
// have status:'Confirmed' -- not just trusting the booking request's own
// (possibly stale) CONFIRMED flag. Audited the current cancellation
// architecture (Part 19) before writing this: this codebase's canonical
// cancel path is Admin/Staff editing a reservation's own `status` field to
// 'Cancelled' directly (see vilu-unified.html's reservation-detail editor)
// -- nothing in Phase F links a later cancellation back onto
// agency_booking_requests, and Phase G is explicitly told not to invent
// that sync. So this function re-reads the live reservation status on
// every call instead: a since-cancelled reservation is refused here even
// though its booking request doc still literally says CONFIRMED, without
// adding any new cancellation feature.
//
// guestMessage is the one field pulled from the finalized quote rather
// than the booking request snapshot -- Phase F's booking request schema
// doesn't carry it, but the quote's own guestMessage is the SAME dedicated
// guest-facing note field Phase B's buildGuestQuotationHTML() already
// treats as guest-safe, and a FINALIZED quote is locked (agency_quotes'
// own update rule refuses agency edits once FINALIZED), so reading it here
// is exactly as immutable as reading the booking request snapshot itself
// (Part 7). No other quote field is read.
function agencyBookingConfirmationPayload(bReq, reservationId) {
  return {
    bookingReference: reservationId,
    quoteReference: bReq.quoteReference || null,
    guestName: bReq.guestName || '',
    arrivalDate: bReq.arrivalDate || '',
    departureDate: bReq.departureDate || '',
    nights: bReq.nights || 0,
    adults: bReq.adults || 0,
    children: bReq.children || 0,
    roomCategory: bReq.roomCategory || '',
    packageName: bReq.packageName || '',
    guestIncludes: Array.isArray(bReq.guestIncludes) ? bReq.guestIncludes : [],
    guestActivities: Array.isArray(bReq.guestActivities) ? bReq.guestActivities : [],
    guestMessage: '', // filled in by the caller from the linked quote, if any
    currency: bReq.currency || 'USD',
    agencyGuestSellingTotal: bReq.agencyGuestSellingTotal || 0,
    agencyName: bReq.agencyName || '',
    agencyEmail: bReq.agencyEmail || '',
  };
}

// ── Multi-Property Availability (Part 16/17): partner accommodation
// booking confirmation ──────────────────────────────────────────────────
// A partner-property booking is NEVER written into `reservations` -- that
// collection is Vilu's own physical-room inventory (Part 23), and there is
// no VR01-VR06-shaped room to assign a partner stay into. This is a
// separate, deliberately much simpler request/confirm record: the agency
// creates it directly (rules-gated client write, same shape as
// agency_booking_requests' own create rule), and only Vilu staff can move
// it to PARTNER_CONFIRMED/PARTNER_REJECTED -- an agency has no way to
// verify a partner's real-world confirmation itself, so it must never be
// able to self-confirm (Part 17).
exports.confirmAccommodationBookingRequest = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role, email } = await callerRole(request);
  requireStaffLike(role);
  const requestId = String((request.data || {}).requestId || '');
  if (!requestId) throw new HttpsError('invalid-argument', 'requestId required.');
  const reqRef = db.collection('accommodation_booking_requests').doc(requestId);
  const snap = await reqRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Booking request not found.');
  if (snap.data().status !== 'AVAILABILITY_REQUESTED') throw new HttpsError('failed-precondition', 'Request is not pending.');
  const now = new Date().toISOString();
  await reqRef.set({ status: 'PARTNER_CONFIRMED', confirmedAt: now, confirmedBy: email }, { merge: true });
  return { status: 'PARTNER_CONFIRMED' };
});

exports.rejectAccommodationBookingRequest = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role, email } = await callerRole(request);
  requireStaffLike(role);
  const requestId = String((request.data || {}).requestId || '');
  const reason = String((request.data || {}).reason || '').slice(0, 500);
  if (!requestId) throw new HttpsError('invalid-argument', 'requestId required.');
  const reqRef = db.collection('accommodation_booking_requests').doc(requestId);
  const snap = await reqRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Booking request not found.');
  if (snap.data().status !== 'AVAILABILITY_REQUESTED') throw new HttpsError('failed-precondition', 'Request is not pending.');
  const now = new Date().toISOString();
  await reqRef.set({ status: 'PARTNER_REJECTED', rejectionReason: reason, rejectedAt: now, rejectedBy: email }, { merge: true });
  return { status: 'PARTNER_REJECTED' };
});

exports.getAgencyBookingConfirmationData = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role } = await callerRole(request);
  if (role !== 'agency') throw new HttpsError('permission-denied', 'Agency access only.');
  const requestId = String((request.data || {}).requestId || '');
  if (!requestId) throw new HttpsError('invalid-argument', 'requestId required.');

  const reqSnap = await db.collection('agency_booking_requests').doc(requestId).get();
  if (!reqSnap.exists) throw new HttpsError('not-found', 'Booking request not found.');
  const bReq = reqSnap.data();
  if (bReq.agencyId !== request.auth.uid) throw new HttpsError('permission-denied', 'Not your booking request.');
  if (bReq.status !== 'CONFIRMED' || !bReq.reservationId) {
    throw new HttpsError('failed-precondition', 'This booking request is not confirmed.');
  }

  const resSnap = await db.collection('reservations').doc(bReq.reservationId).get();
  if (!resSnap.exists) throw new HttpsError('not-found', 'The confirmed reservation could not be found.');
  const res = resSnap.data();
  if (res.agencyId !== request.auth.uid) throw new HttpsError('permission-denied', 'Not your reservation.');
  if (res.status !== 'Confirmed') {
    throw new HttpsError('failed-precondition', 'This reservation is no longer confirmed.');
  }

  const payload = agencyBookingConfirmationPayload(bReq, bReq.reservationId);
  if (bReq.quoteId) {
    try {
      const quoteSnap = await db.collection('agency_quotes').doc(bReq.quoteId).get();
      if (quoteSnap.exists && quoteSnap.data().agencyId === request.auth.uid) {
        payload.guestMessage = String(quoteSnap.data().guestMessage || '');
      }
    } catch (e) { /* guestMessage is optional -- confirmation still renders without it */ }
  }
  return payload;
});

// ── Agency Sales Workflow Phase H: own-guest search ─────────────────────
// Firestore has no substring-search primitive, and this property's scale
// (six rooms) doesn't justify an external search service -- the task
// explicitly rules that out. The accepted tradeoff here is bounded
// server-side retrieval of THIS agency's own records (never the whole
// collection, never a client-supplied agencyId -- always
// request.auth.uid, same trust boundary as every other Phase C-G
// callable) followed by in-memory case-insensitive substring matching.
// Direct/OTA/other-agency guests are never fetched in the first place --
// there is no "search everything then filter" step to get wrong.
const AGENCY_SEARCH_MAX_PER_SOURCE = 200;
const AGENCY_SEARCH_MAX_RESULTS = 50;

function normalizeForSearch(s) {
  return String(s || '').toLowerCase().trim();
}

exports.searchAgencyGuests = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role } = await callerRole(request);
  if (role !== 'agency') throw new HttpsError('permission-denied', 'Agency access only.');
  const agencyId = request.auth.uid; // never trusted from the client
  const query = normalizeForSearch((request.data || {}).query);
  if (query.length < 2) return { results: [] };

  const [resSnap, reqSnap, quoteSnap] = await Promise.all([
    db.collection('reservations').where('agencyId', '==', agencyId).limit(AGENCY_SEARCH_MAX_PER_SOURCE).get(),
    db.collection('agency_booking_requests').where('agencyId', '==', agencyId).limit(AGENCY_SEARCH_MAX_PER_SOURCE).get(),
    db.collection('agency_quotes').where('agencyId', '==', agencyId).limit(AGENCY_SEARCH_MAX_PER_SOURCE).get(),
  ]);

  // Part 12/17: a confirmed reservation already represents that booking --
  // its own booking request, and the quote it came from, must not also
  // surface as separate results for the same real trip.
  const supersededRequestIds = new Set();
  const supersededQuoteIds = new Set(reqSnap.docs.map((d) => d.data().quoteId).filter(Boolean));

  const results = [];
  resSnap.docs.forEach((doc) => {
    const r = doc.data();
    const hay = normalizeForSearch(r.guest_name) + ' ' + normalizeForSearch(doc.id) + ' ' + normalizeForSearch(r.agencyQuoteReference);
    if (r.agencyBookingRequestId) supersededRequestIds.add(r.agencyBookingRequestId);
    if (!hay.includes(query)) return;
    results.push({
      type: 'RESERVATION', guestName: r.guest_name || '', reference: doc.id, requestId: r.agencyBookingRequestId || null,
      quoteReference: r.agencyQuoteReference || null, arrivalDate: r.check_in || null, departureDate: r.check_out || null, status: r.status || '',
    });
  });
  reqSnap.docs.forEach((doc) => {
    if (supersededRequestIds.has(doc.id)) return;
    const r = doc.data();
    const hay = normalizeForSearch(r.guestName) + ' ' + normalizeForSearch(doc.id) + ' ' + normalizeForSearch(r.quoteReference);
    if (!hay.includes(query)) return;
    results.push({
      type: 'BOOKING_REQUEST', guestName: r.guestName || '', reference: doc.id, requestId: doc.id,
      quoteReference: r.quoteReference || null, arrivalDate: r.arrivalDate || null, departureDate: r.departureDate || null, status: r.status || '',
    });
  });
  quoteSnap.docs.forEach((doc) => {
    if (supersededQuoteIds.has(doc.id)) return;
    const q = doc.data();
    const hay = normalizeForSearch(q.guestName) + ' ' + normalizeForSearch(doc.id);
    if (!hay.includes(query)) return;
    results.push({
      type: 'QUOTE', guestName: q.guestName || '', reference: doc.id, requestId: null,
      quoteReference: doc.id, arrivalDate: q.arrivalDate || null, departureDate: q.departureDate || null, status: q.status || '',
    });
  });

  return { results: results.slice(0, AGENCY_SEARCH_MAX_RESULTS) };
});

// ── Agency Sales Workflow Phase I: own-reservation-list projection ──────
// I-17 audit finding, fixed here: `reservations` is ONE shared schema
// across Direct/OTA/Agency sources, and PMS staff write fields onto it
// (internal_note -- explicitly staff-only by design, see
// reservation_note_history's own noteType gating -- and notes, which can
// carry Cloudbeds-imported internal notes, balance-due figures, guest
// address, and appended staff-note blocks) that were never meant for the
// owning agency to see. Firestore rules can only allow or deny a WHOLE
// document, never redact individual fields -- so as long as
// firestore.rules granted an agency a direct read of her own reservation
// (agencyId==auth.uid), every one of those fields was downloaded to her
// browser the moment Phase H's My Bookings list or the Phase D calendar's
// own-booking lookup ran a plain client query, even though neither ever
// rendered them. This callable is the fix, the same shape as
// getAgencyBookingConfirmationData/searchAgencyGuests: an explicit safe
// projection, nothing else. firestore.rules' reservations read rule is
// tightened in the same commit to remove the agency's direct-read branch
// entirely -- this callable is now the ONLY path an agency's own
// reservation data can reach the browser through.
exports.getMyAgencyBookings = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role } = await callerRole(request);
  if (role !== 'agency') throw new HttpsError('permission-denied', 'Agency access only.');
  const agencyId = request.auth.uid; // never trusted from the client

  const snap = await db.collection('reservations').where('agencyId', '==', agencyId).get();
  const reservations = snap.docs.map((doc) => {
    const r = doc.data();
    return {
      id: doc.id, room_id: r.room_id || null,
      guest_name: r.guest_name || '', check_in: r.check_in || null, check_out: r.check_out || null,
      adults: r.adults || 0, children: r.children || 0, status: r.status || '',
      agencyBookingRequestId: r.agencyBookingRequestId || null,
      packageName: r.packageName || '', agencyGuestSellingTotal: r.agencyGuestSellingTotal || 0, currency: r.currency || 'USD',
    };
  });
  return { reservations };
});

// ── Agency Sales Workflow Phase J: Agency Earnings & Settlement Ledger ──
// This is NOT the retired Package Manager Commission field (Phase A) --
// the commercial model is per-reservation, built entirely from the
// immutable snapshot every confirmed agency reservation already carries
// (viluNetTotal/agencyGuestSellingTotal/agencyEarnings/paymentCollector,
// Phase F). Two directions, never conflated:
//   HOTEL_TO_AGENCY (paymentCollector=='HOTEL'): the hotel collected the
//     guest's money, so Vilu owes the agency its earnings (amountDue =
//     agencyEarnings).
//   AGENCY_TO_HOTEL (paymentCollector=='AGENCY'): the agency collected the
//     guest's money, so the agency owes Vilu its net cost (amountDue =
//     viluNetTotal).
// paymentCollector=='UNDECIDED' produces a settlement with direction=null,
// amountDue=null -- it exists (so nothing is silently missing, Part
// 17/28), but every payment action refuses to run against it until an
// operational decision is made; this phase does not build a path to
// retroactively set paymentCollector, since that field is an immutable
// part of the confirmed booking's own commercial snapshot.
const AGENCY_SETTLEMENT_STATUSES = ['NOT_YET_PAYABLE', 'PAYABLE', 'PAYMENT_SENT', 'RECEIVED', 'DISPUTED', 'DATA_INCOMPLETE'];

// J-2 audit finding, applied: this codebase's canonical reservation status
// values (confirmed by grep across vilu-unified.html) are Confirmed/
// Checked in/Checked out/Cancelled/Pending -- no "No Show" state exists
// anywhere, so none is invented here. "Checked in" is the real, already-
// staff-controlled arrival action this phase integrates with (via
// settlementEligibilityOnReservation below) rather than guessing
// eligibility from arrivalDate alone -- a Confirmed reservation whose
// arrival date has simply passed, with no actual check-in, stays
// NOT_YET_PAYABLE forever, exactly matching J-18's required behavior.
function isCheckedInStatus(status) { return status === 'Checked in' || status === 'Checked out'; }

// J-4: every amount here is copied verbatim from the reservation doc at
// creation time -- never re-read from the quote/catalog/exchange rate
// afterward, so a later rate change can never move an existing
// settlement's numbers (Part 20).
function buildAgencySettlementFields(r, reservationId) {
  const now = new Date().toISOString();
  const hasCompleteData = (r.paymentCollector === 'HOTEL' || r.paymentCollector === 'AGENCY')
    && Number.isFinite(r.viluNetTotal) && Number.isFinite(r.agencyGuestSellingTotal) && Number.isFinite(r.agencyEarnings);
  let direction = null, amountDue = null;
  if (r.paymentCollector === 'HOTEL') { direction = 'HOTEL_TO_AGENCY'; amountDue = r.agencyEarnings || 0; }
  else if (r.paymentCollector === 'AGENCY') { direction = 'AGENCY_TO_HOTEL'; amountDue = r.viluNetTotal || 0; }
  // J-23: a historical/legacy agency reservation missing this snapshot
  // (never possible through confirmAgencyBookingRequest itself, but
  // reachable if Admin manually created a source:'Agency' reservation
  // outside the quote/booking-request flow) gets DATA_INCOMPLETE rather
  // than a fabricated amount.
  return {
    settlementId: reservationId, reservationId,
    agencyId: r.agencyId || null, agencyEmail: r.agencyEmail || null, agencyName: r.agencyName || null,
    bookingReference: reservationId, quoteReference: r.agencyQuoteReference || null,
    guestName: r.guest_name || '', arrivalDate: r.check_in || null, departureDate: r.check_out || null,
    currency: r.currency || 'USD', paymentCollector: r.paymentCollector || 'UNDECIDED',
    viluNetTotal: Number.isFinite(r.viluNetTotal) ? r.viluNetTotal : null,
    agencyGuestSellingTotal: Number.isFinite(r.agencyGuestSellingTotal) ? r.agencyGuestSellingTotal : null,
    agencyEarnings: Number.isFinite(r.agencyEarnings) ? r.agencyEarnings : null,
    direction, amountDue,
    status: hasCompleteData ? 'NOT_YET_PAYABLE' : 'DATA_INCOMPLETE',
    createdAt: now, updatedAt: now,
    payableAt: null, paymentSentAt: null, paymentSentBy: null,
    paymentMethod: null, paymentReference: null, paymentNote: null, paymentInitiatedBy: null,
    receivedAt: null, receivedConfirmedBy: null, receivedConfirmedByAgency: false,
    disputedAt: null, disputeReason: null,
  };
}

// J-2/J-5/J-18: the automatic eligibility trigger. Reacts to the SAME
// staff-controlled status field every other reservation-status change
// already goes through (vilu-unified.html's reservation editor) -- no new
// UI action was built, per the task's own "integrate with the actual
// existing arrival/check-in action" preference. Idempotent: re-reads the
// settlement fresh inside its own transaction and no-ops unless it's still
// exactly NOT_YET_PAYABLE, so a duplicate trigger delivery (a normal
// Cloud Functions possibility) or an unrelated field-only edit that
// happens to re-save 'Checked in' can never re-fire the transition twice
// or fight a payment workflow already in progress.
exports.settlementEligibilityOnReservation = onDocumentWritten('reservations/{id}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  if (!after || !after.agencyId) return;
  const justBecameCheckedIn = isCheckedInStatus(after.status) && !(before && isCheckedInStatus(before.status));
  if (!justBecameCheckedIn) return;
  const settlementRef = db.collection('agency_settlements').doc(event.params.id);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(settlementRef);
    if (!snap.exists || snap.data().status !== 'NOT_YET_PAYABLE') return;
    tx.set(settlementRef, { status: 'PAYABLE', payableAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, { merge: true });
  });
});

async function loadSettlementForAction(tx, settlementId) {
  const ref = db.collection('agency_settlements').doc(settlementId);
  const snap = await tx.get(ref);
  if (!snap.exists) throw new HttpsError('not-found', 'Settlement not found.');
  return { ref, data: snap.data() };
}
function requireAgencyOwnerOrThrow(role, settlement, uid) {
  if (role !== 'agency' || settlement.agencyId !== uid) throw new HttpsError('permission-denied', 'Not your settlement.');
}

// J-8/J-11: the SENDER records they sent payment. Direction determines who
// that is -- HOTEL_TO_AGENCY: Vilu (staff-like); AGENCY_TO_HOTEL: the
// owning agency. paymentInitiatedBy records which, so a later reader never
// has to re-derive "who was supposed to send this" from direction alone.
exports.markAgencySettlementPaymentSent = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role, email } = await callerRole(request);
  const settlementId = String((request.data || {}).settlementId || '');
  const method = String((request.data || {}).method || '').trim().slice(0, 80);
  const reference = String((request.data || {}).reference || '').trim().slice(0, 160);
  const note = String((request.data || {}).note || '').trim().slice(0, 500);
  if (!settlementId) throw new HttpsError('invalid-argument', 'settlementId required.');
  if (!method) throw new HttpsError('invalid-argument', 'Payment method is required.');

  return db.runTransaction(async (tx) => {
    const { ref, data: s } = await loadSettlementForAction(tx, settlementId);
    if (s.status !== 'PAYABLE') throw new HttpsError('failed-precondition', 'Settlement is not payable (currently ' + s.status + ').');
    let paymentInitiatedBy;
    if (s.direction === 'HOTEL_TO_AGENCY') { requireStaffLike(role); paymentInitiatedBy = 'HOTEL'; }
    else if (s.direction === 'AGENCY_TO_HOTEL') { requireAgencyOwnerOrThrow(role, s, request.auth.uid); paymentInitiatedBy = 'AGENCY'; }
    else throw new HttpsError('failed-precondition', 'Settlement direction is undecided (paymentCollector was never set) -- cannot mark payment sent.');

    const now = new Date().toISOString();
    tx.set(ref, {
      status: 'PAYMENT_SENT', paymentSentAt: now, paymentSentBy: email,
      paymentMethod: method, paymentReference: reference || null, paymentNote: note || null, paymentInitiatedBy,
      updatedAt: now,
    }, { merge: true });
    tx.set(db.collection('agency_settlement_audit').doc(), {
      settlementId, reservationId: s.reservationId, agencyId: s.agencyId,
      fromStatus: 'PAYABLE', toStatus: 'PAYMENT_SENT', actorUid: request.auth.uid, actorRole: role, timestamp: now,
      paymentMethod: method, paymentReference: reference || null, reason: null,
    });
    return { status: 'PAYMENT_SENT' };
  });
});

// J-9/J-11: the RECEIVER confirms. Direction-aware mirror of the function
// above -- HOTEL_TO_AGENCY: the agency confirms receipt; AGENCY_TO_HOTEL:
// Vilu/staff confirms receipt. receivedConfirmedByAgency (Part 3's own
// suggested field name) is true only for the former.
exports.confirmAgencySettlementReceived = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role, email } = await callerRole(request);
  const settlementId = String((request.data || {}).settlementId || '');
  if (!settlementId) throw new HttpsError('invalid-argument', 'settlementId required.');

  return db.runTransaction(async (tx) => {
    const { ref, data: s } = await loadSettlementForAction(tx, settlementId);
    if (s.status !== 'PAYMENT_SENT') throw new HttpsError('failed-precondition', 'No payment is awaiting confirmation (currently ' + s.status + ').');
    let receivedConfirmedByAgency = false;
    if (s.direction === 'HOTEL_TO_AGENCY') { requireAgencyOwnerOrThrow(role, s, request.auth.uid); receivedConfirmedByAgency = true; }
    else if (s.direction === 'AGENCY_TO_HOTEL') { requireStaffLike(role); }
    else throw new HttpsError('failed-precondition', 'Settlement direction is undecided.');

    const now = new Date().toISOString();
    tx.set(ref, { status: 'RECEIVED', receivedAt: now, receivedConfirmedBy: email, receivedConfirmedByAgency, updatedAt: now }, { merge: true });
    tx.set(db.collection('agency_settlement_audit').doc(), {
      settlementId, reservationId: s.reservationId, agencyId: s.agencyId,
      fromStatus: 'PAYMENT_SENT', toStatus: 'RECEIVED', actorUid: request.auth.uid, actorRole: role, timestamp: now,
      paymentMethod: null, paymentReference: null, reason: null,
    });
    return { status: 'RECEIVED' };
  });
});

// J-10: only the same party who would otherwise confirm receipt may
// dispute non-receipt -- prior payment-sent information (method/
// reference/note) is preserved via merge, never overwritten (Part 10:
// "Do not delete/rewrite history").
exports.disputeAgencySettlement = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role, email } = await callerRole(request);
  const settlementId = String((request.data || {}).settlementId || '');
  const reason = String((request.data || {}).reason || '').trim().slice(0, 500);
  if (!settlementId) throw new HttpsError('invalid-argument', 'settlementId required.');
  if (!reason) throw new HttpsError('invalid-argument', 'A reason is required.');

  return db.runTransaction(async (tx) => {
    const { ref, data: s } = await loadSettlementForAction(tx, settlementId);
    if (s.status !== 'PAYMENT_SENT') throw new HttpsError('failed-precondition', 'Only a payment awaiting confirmation can be disputed (currently ' + s.status + ').');
    if (s.direction === 'HOTEL_TO_AGENCY') requireAgencyOwnerOrThrow(role, s, request.auth.uid);
    else if (s.direction === 'AGENCY_TO_HOTEL') requireStaffLike(role);
    else throw new HttpsError('failed-precondition', 'Settlement direction is undecided.');

    const now = new Date().toISOString();
    tx.set(ref, { status: 'DISPUTED', disputedAt: now, disputeReason: reason, updatedAt: now }, { merge: true });
    tx.set(db.collection('agency_settlement_audit').doc(), {
      settlementId, reservationId: s.reservationId, agencyId: s.agencyId,
      fromStatus: 'PAYMENT_SENT', toStatus: 'DISPUTED', actorUid: request.auth.uid, actorRole: role, timestamp: now,
      paymentMethod: null, paymentReference: null, reason,
    });
    return { status: 'DISPUTED' };
  });
});

// J-17: Admin-controlled dispute resolution -- the only path back out of
// DISPUTED, deliberately narrow (either the payment really was received,
// or it goes back to awaiting confirmation), never an arbitrary status
// jump.
exports.resolveAgencySettlementDispute = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const { role, email } = await callerRole(request);
  requireStaffLike(role);
  const settlementId = String((request.data || {}).settlementId || '');
  const resolution = String((request.data || {}).resolution || '');
  if (!settlementId) throw new HttpsError('invalid-argument', 'settlementId required.');
  if (resolution !== 'RECEIVED' && resolution !== 'PAYMENT_SENT') throw new HttpsError('invalid-argument', 'resolution must be RECEIVED or PAYMENT_SENT.');

  return db.runTransaction(async (tx) => {
    const { ref, data: s } = await loadSettlementForAction(tx, settlementId);
    if (s.status !== 'DISPUTED') throw new HttpsError('failed-precondition', 'Settlement is not disputed (currently ' + s.status + ').');
    const now = new Date().toISOString();
    const update = { status: resolution, updatedAt: now };
    if (resolution === 'RECEIVED') { update.receivedAt = now; update.receivedConfirmedBy = email; update.receivedConfirmedByAgency = false; }
    tx.set(ref, update, { merge: true });
    tx.set(db.collection('agency_settlement_audit').doc(), {
      settlementId, reservationId: s.reservationId, agencyId: s.agencyId,
      fromStatus: 'DISPUTED', toStatus: resolution, actorUid: request.auth.uid, actorRole: role, timestamp: now,
      paymentMethod: null, paymentReference: null, reason: 'Dispute resolved by ' + email,
    });
    return { status: resolution };
  });
});

// J-22/J-23: safe maintenance action for confirmed agency reservations
// that predate this phase (or were created outside the normal quote ->
// booking-request -> confirm flow, e.g. an Admin-built direct agency
// reservation). dryRun (default true) only PREVIEWS what would be
// created -- never writes -- so Admin can review before the real run.
// Never modifies an EXISTING settlement's amounts, only creates ones that
// are genuinely missing (Part 22: "Do not modify amounts on existing
// settlements").
exports.reconcileMissingAgencySettlements = onCall({ region: 'us-central1', maxInstances: 5 }, async (request) => {
  const { role } = await callerRole(request);
  requireStaffLike(role);
  const dryRun = (request.data || {}).dryRun !== false;

  const snap = await db.collection('reservations').where('source', '==', 'Agency').get();
  const missing = [];
  for (const doc of snap.docs) {
    const r = doc.data();
    if (!r.agencyId) continue;
    if (r.status !== 'Confirmed' && !isCheckedInStatus(r.status)) continue;
    const settlementSnap = await db.collection('agency_settlements').doc(doc.id).get();
    if (settlementSnap.exists) continue;
    missing.push({ reservationId: doc.id, guestName: r.guest_name || '', agencyName: r.agencyName || '', arrivalDate: r.check_in || null });
    if (!dryRun) {
      const fields = buildAgencySettlementFields(r, doc.id);
      if (isCheckedInStatus(r.status) && fields.status === 'NOT_YET_PAYABLE') {
        fields.status = 'PAYABLE';
        fields.payableAt = new Date().toISOString();
      }
      await db.collection('agency_settlements').doc(doc.id).set(fields);
    }
  }
  return { dryRun, count: missing.length, missing: missing.slice(0, 100) };
});
