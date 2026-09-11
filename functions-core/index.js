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
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
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
  const agencyGuestSellingTotal = Math.max(0, Number(d.agencyGuestSellingTotal) || 0);
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
  const viluNetTotal = +componentsWithTotals.reduce((sum, c) => sum + c.viluLineTotal, 0).toFixed(2);
  const agencyEarnings = +(agencyGuestSellingTotal - viluNetTotal).toFixed(2);

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

  // agencyId is ALWAYS request.auth.uid -- never accepted from request.data,
  // so an agency can never ask "as if" it were a different agency (Part 17/31).
  const agencyId = request.auth.uid;

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
