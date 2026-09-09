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
const { PHYSICAL_ROOMS, addDays, isActiveStatus, overlaps } = require('./lib/inventory');

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
const clean = (s, max) => String(s == null ? '' : s).replace(/[ -<>]/g, '').trim().slice(0, max || 200);
const DEFAULT_RATES = { VR01: 80, VR02: 80, VR03: 85, VR04: 85, VR05: 90, VR06: 90 };

async function serverRate(roomId, ci, co) {
  const room = await store.get('rooms', roomId);
  const base = room && typeof room.rate === 'number' ? room.rate : (DEFAULT_RATES[roomId] || 0);
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
async function runAvailability(trigger) {
  const r = await syncAvailability({ store, roomsDocs: await roomsDocs(), trigger });
  if (r.errors && r.errors.length) console.warn('room type mapping errors', r.errors);
  return r;
}
exports.availabilityOnReservation = onDocumentWritten('reservations/{id}', async (event) => {
  const b = event.data.before.exists ? event.data.before.data() : null, a = event.data.after.exists ? event.data.after.data() : null;
  const sig = (x) => x && [x.room_id, x.check_in, x.check_out, x.status].join('|');
  if (sig(b) === sig(a)) return; // notes/payment edits do not change inventory
  await runAvailability('reservation:' + event.params.id);
});
exports.availabilityOnBlock = onDocumentWritten('blocks/{id}', async (event) => { await runAvailability('block:' + event.params.id); });

// ── nightly reconciliation (Stage 10) ───────────────────────────────────────
exports.nightlyReconcile = onSchedule({ schedule: '30 3 * * *', timeZone: 'Indian/Maldives' }, async () => {
  await syncAvailability({ store, roomsDocs: await roomsDocs(), trigger: 'nightly', days: FULL_HORIZON_DAYS });
});
