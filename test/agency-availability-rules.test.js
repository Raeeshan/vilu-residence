// Agency Sales Workflow — Phase D: getAgencyAvailability() proven for real
// against the Firestore emulator + the actual Cloud Function (via
// firebase-functions-test), exactly like submitAgencyCustomQuote in Phase C.
//
// This is the privacy proof Parts 29-31 demand: synthetic Direct/Agency A/
// Agency B data, asserted on the RAW RESPONSE (JSON.stringify'd) never
// containing anyone else's guest name, agency identity, block reason, or
// any other private field -- not "the UI doesn't show it", the field
// itself must never leave the server for a booking this agency doesn't own.
//
// Run via:
//   firebase emulators:exec --only firestore "node test/agency-availability-rules.test.js"
const assert = require('node:assert/strict');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}

const AGENCY_A_UID = 'agencyA-uid';
const AGENCY_B_UID = 'agencyB-uid';
const AGENCY_A_EMAIL = 'agencya@example.com';
const AGENCY_B_EMAIL = 'agencyb@example.com';

(async () => {
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  process.env.GCLOUD_PROJECT = 'vilu-residence';
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'vilu-residence' });

  const functionsTest = require('firebase-functions-test')({ projectId: 'vilu-residence' });
  const myFunctions = require('../functions-core/index.js');
  // Same module-instance gotcha as Phase C's test -- must resolve firebase-
  // admin/firestore through functions-core's OWN node_modules, not the repo
  // root's separate copy (a transitive dep of firebase-functions-test),
  // otherwise getFirestore() here sees "no default app" even though
  // functions-core already called initializeApp() in its copy of the SDK.
  const path = require('node:path');
  const firebaseAdminFirestorePath = require.resolve('firebase-admin/firestore', { paths: [path.join(__dirname, '..', 'functions-core')] });
  const { getFirestore } = require(firebaseAdminFirestorePath);
  const db = getFirestore();
  const wrapped = functionsTest.wrap(myFunctions.getAgencyAvailability);

  function callAs(uid, email, data) {
    return wrapped({ data, auth: { uid, token: { email } } });
  }
  async function expectCode(promise, expectedCode) {
    try {
      await promise;
      assert.fail('expected the call to be rejected with code ' + expectedCode + ', but it succeeded');
    } catch (e) {
      assert.equal(e.code, expectedCode, 'wrong error code: got "' + e.code + '" ("' + e.message + '")');
    }
  }

  // ── Seed synthetic data (Part 29) ──
  await db.collection('users').doc(AGENCY_A_EMAIL).set({ email: AGENCY_A_EMAIL, role: 'agency', name: 'Agency A' });
  await db.collection('users').doc(AGENCY_B_EMAIL).set({ email: AGENCY_B_EMAIL, role: 'agency', name: 'Agency B' });
  await db.collection('users').doc('staffer@example.com').set({ email: 'staffer@example.com', role: 'staff' });

  const RANGE_START = '2027-03-01';
  const RANGE_END = '2027-03-15'; // exclusive

  // VR01: a direct (non-agency, OTA-less) guest -- source:'Website'/'Direct', no agencyId at all.
  await db.collection('reservations').doc('RES-DIRECT').set({
    room_id: 'VR01', check_in: '2027-03-02', check_out: '2027-03-05', status: 'Confirmed',
    source: 'Website', guest_name: 'Direct Guest D', guest_email: 'directguestd@example.com', guest_phone: '+960-DIRECT',
    adults: 2, children: 0,
  });
  // VR02: Agency A's OWN reservation.
  await db.collection('reservations').doc('RES-AGENCY-A').set({
    room_id: 'VR02', check_in: '2027-03-03', check_out: '2027-03-06', status: 'Confirmed',
    source: 'Agency', agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL,
    guest_name: 'Agency A Guest', guest_email: 'agencyaguest@example.com', guest_phone: '+960-AAAA',
    adults: 1, children: 1,
  });
  // VR03: Agency B's OWN reservation -- Agency A must never see any of this.
  await db.collection('reservations').doc('RES-AGENCY-B').set({
    room_id: 'VR03', check_in: '2027-03-04', check_out: '2027-03-07', status: 'Confirmed',
    source: 'Agency', agencyId: AGENCY_B_UID, agencyEmail: AGENCY_B_EMAIL,
    guest_name: 'Agency B Guest', guest_email: 'agencybguest@example.com', guest_phone: '+960-BBBB',
    adults: 2, children: 0,
  });
  // VR04: a manual maintenance block with a private internal reason.
  await db.collection('blocks').doc('BLK-MAINT').set({
    room_id: 'VR04', from_date: '2027-03-05', to_date: '2027-03-08', reason: 'Maintenance - AC repair, contractor Ahmed',
  });
  // VR05: an approved Agency B hold -- reason carries the exact leak shape
  // approveBlockRequest() produces ("Agency: <name> — <note>").
  await db.collection('blocks').doc('BLK-AGENCYB-HOLD').set({
    room_id: 'VR05', from_date: '2027-03-06', to_date: '2027-03-09', reason: 'Agency: Agency B Travel — VIP group, do not disturb',
  });
  // VR06 stays fully free the whole window.

  // Keep room_availability consistent with the reservations above (Part 16:
  // "verify it is fully consistent... before making it the sole source" --
  // this test seeds it explicitly rather than assuming a trigger populated it,
  // since availabilityOnReservation is a separate trigger not exercised here).
  await db.collection('room_availability').doc('VR01').set({ bookings: [{ id: 'RES-DIRECT', from: '2027-03-02', to: '2027-03-05' }] });
  await db.collection('room_availability').doc('VR02').set({ bookings: [{ id: 'RES-AGENCY-A', from: '2027-03-03', to: '2027-03-06' }] });
  await db.collection('room_availability').doc('VR03').set({ bookings: [{ id: 'RES-AGENCY-B', from: '2027-03-04', to: '2027-03-07' }] });
  await db.collection('room_availability').doc('VR04').set({ bookings: [] });
  await db.collection('room_availability').doc('VR05').set({ bookings: [] });
  await db.collection('room_availability').doc('VR06').set({ bookings: [] });

  section('Privacy (Part 29): what Agency A CAN and CANNOT see');
  const resultA = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, { startDate: RANGE_START, endDate: RANGE_END });
  const rawA = JSON.stringify(resultA);

  await test('VR01 (direct guest) shows OCCUPIED with no ownReservationId', async () => {
    const cell = resultA.days.find(d => d.roomId === 'VR01' && d.date === '2027-03-03');
    assert.equal(cell.state, 'OCCUPIED');
    assert.equal(cell.ownReservationId, undefined);
  });
  await test('VR02 (Agency A\'s own) shows OCCUPIED WITH ownReservationId, and the own-reservation map has the real guest name', async () => {
    const cell = resultA.days.find(d => d.roomId === 'VR02' && d.date === '2027-03-04');
    assert.equal(cell.state, 'OCCUPIED');
    assert.equal(cell.ownReservationId, 'RES-AGENCY-A');
    assert.equal(resultA.ownReservations['RES-AGENCY-A'].guestName, 'Agency A Guest');
  });
  await test('VR03 (Agency B\'s own) shows OCCUPIED with no ownReservationId', async () => {
    const cell = resultA.days.find(d => d.roomId === 'VR03' && d.date === '2027-03-05');
    assert.equal(cell.state, 'OCCUPIED');
    assert.equal(cell.ownReservationId, undefined);
  });
  await test('VR04/VR05 (blocks) show BLOCKED', async () => {
    assert.equal(resultA.days.find(d => d.roomId === 'VR04' && d.date === '2027-03-06').state, 'BLOCKED');
    assert.equal(resultA.days.find(d => d.roomId === 'VR05' && d.date === '2027-03-07').state, 'BLOCKED');
  });
  await test('VR06 (nothing booked) shows AVAILABLE throughout', async () => {
    assert.ok(resultA.days.filter(d => d.roomId === 'VR06').every(d => d.state === 'AVAILABLE'));
  });

  await test('the raw response NEVER contains Direct Guest D\'s name, email, or phone', async () => {
    assert.doesNotMatch(rawA, /Direct Guest D/);
    assert.doesNotMatch(rawA, /directguestd@example\.com/);
    assert.doesNotMatch(rawA, /\+960-DIRECT/);
  });
  await test('the raw response NEVER contains Agency B\'s guest name, email, phone, or agency identity', async () => {
    assert.doesNotMatch(rawA, /Agency B Guest/);
    assert.doesNotMatch(rawA, /agencybguest@example\.com/);
    assert.doesNotMatch(rawA, /\+960-BBBB/);
    assert.doesNotMatch(rawA, /Agency B Travel/);
    assert.doesNotMatch(rawA, /agencyb@example\.com/);
    assert.doesNotMatch(rawA, new RegExp(AGENCY_B_UID));
  });
  await test('the raw response NEVER contains any block\'s internal reason text, for a block owned by anyone (including this agency\'s own approved hold, if any)', async () => {
    assert.doesNotMatch(rawA, /Maintenance/);
    assert.doesNotMatch(rawA, /AC repair/);
    assert.doesNotMatch(rawA, /VIP group/);
    assert.doesNotMatch(rawA, /do not disturb/);
    assert.doesNotMatch(rawA, /\breason\b/i);
  });
  await test('the raw response never contains pricing/source/notes/folio/document fields', async () => {
    assert.doesNotMatch(rawA, /source/i);
    assert.doesNotMatch(rawA, /pricePerRoom|agencyPricePerRoom/);
    assert.doesNotMatch(rawA, /folio|passport|payment/i);
  });

  section('Symmetry: Agency B sees the mirror image');
  const resultB = await callAs(AGENCY_B_UID, AGENCY_B_EMAIL, { startDate: RANGE_START, endDate: RANGE_END });
  const rawB = JSON.stringify(resultB);
  await test('Agency B sees her OWN reservation enriched, and never sees Agency A\'s guest name', async () => {
    const cell = resultB.days.find(d => d.roomId === 'VR03' && d.date === '2027-03-05');
    assert.equal(cell.ownReservationId, 'RES-AGENCY-B');
    assert.equal(resultB.ownReservations['RES-AGENCY-B'].guestName, 'Agency B Guest');
    assert.doesNotMatch(rawB, /Agency A Guest/);
    assert.doesNotMatch(rawB, new RegExp(AGENCY_A_UID));
  });

  section('Adversarial security (Part 31)');
  await test('Agency A supplying agencyId: Agency B\'s uid in request.data is silently ignored -- she still only gets HER OWN reservations enriched, not Agency B\'s', async () => {
    const spoofed = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, { startDate: RANGE_START, endDate: RANGE_END, agencyId: AGENCY_B_UID });
    assert.equal(spoofed.ownReservations['RES-AGENCY-B'], undefined);
    assert.ok(spoofed.ownReservations['RES-AGENCY-A']);
  });
  await test('an excessively large date range is rejected server-side', async () => {
    await expectCode(callAs(AGENCY_A_UID, AGENCY_A_EMAIL, { startDate: '2027-01-01', endDate: '2027-12-01' }), 'invalid-argument');
  });
  await test('endDate before/equal to startDate is rejected', async () => {
    await expectCode(callAs(AGENCY_A_UID, AGENCY_A_EMAIL, { startDate: '2027-03-10', endDate: '2027-03-10' }), 'invalid-argument');
  });
  await test('malformed date strings are rejected', async () => {
    await expectCode(callAs(AGENCY_A_UID, AGENCY_A_EMAIL, { startDate: '3/1/2027', endDate: '2027-03-15' }), 'invalid-argument');
  });
  await test('an unauthenticated caller is rejected', async () => {
    try {
      await wrapped({ data: { startDate: RANGE_START, endDate: RANGE_END } });
      assert.fail('expected rejection for no auth context');
    } catch (e) {
      assert.equal(e.code, 'unauthenticated');
    }
  });
  await test('a staff caller is rejected -- Part 3/17: "Authenticated agency only", not staff/admin', async () => {
    await expectCode(callAs('staff-uid', 'staffer@example.com', { startDate: RANGE_START, endDate: RANGE_END }), 'permission-denied');
  });

  section('Correctness (Part 30): overlap semantics match the canonical half-open convention');
  await test('the night of check-OUT is free, not occupied (half-open interval: [check_in, check_out))', async () => {
    // RES-AGENCY-A occupies VR02 2027-03-03..2027-03-06 (exclusive) -- the
    // 6th itself must be AVAILABLE.
    const checkoutDayCell = resultA.days.find(d => d.roomId === 'VR02' && d.date === '2027-03-06');
    assert.equal(checkoutDayCell.state, 'AVAILABLE');
  });
  await test('the night of check-IN is occupied', async () => {
    const checkinDayCell = resultA.days.find(d => d.roomId === 'VR02' && d.date === '2027-03-03');
    assert.equal(checkinDayCell.state, 'OCCUPIED');
  });
  await test('back-to-back bookings on the same room (B check-in == A check-out) produce no gap and no false conflict', async () => {
    await db.collection('room_availability').doc('VR06').set({ bookings: [
      { id: 'BACK-1', from: '2027-03-08', to: '2027-03-10' },
      { id: 'BACK-2', from: '2027-03-10', to: '2027-03-12' },
    ] });
    const r = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, { startDate: RANGE_START, endDate: RANGE_END });
    assert.equal(r.days.find(d => d.roomId === 'VR06' && d.date === '2027-03-09').state, 'OCCUPIED'); // BACK-1
    assert.equal(r.days.find(d => d.roomId === 'VR06' && d.date === '2027-03-10').state, 'OCCUPIED'); // BACK-2 starts exactly here
    assert.equal(r.days.find(d => d.roomId === 'VR06' && d.date === '2027-03-11').state, 'OCCUPIED'); // BACK-2
    assert.equal(r.days.find(d => d.roomId === 'VR06' && d.date === '2027-03-12').state, 'AVAILABLE'); // BACK-2's own checkout day
    // Reset VR06 for any later assertion in this file.
    await db.collection('room_availability').doc('VR06').set({ bookings: [] });
  });

  functionsTest.cleanup();

  console.log(`\n${passed}/${passed + failed} agency-availability-rules (emulator + Cloud Function) assertions passed`);
  if (failed > 0) process.exitCode = 1;
})().catch((e) => {
  console.error('agency-availability-rules.test.js crashed:', e);
  process.exitCode = 1;
});
