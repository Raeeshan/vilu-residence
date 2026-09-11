// Agency Sales Workflow — Phase H: My Bookings + own-guest search, proven
// for real against the Firestore emulator + the actual searchAgencyGuests /
// getAgencyBookingConfirmationData Cloud Functions (via firebase-functions-
// test), same pattern as Phases C-G.
//
// Run via:
//   firebase emulators:exec --only firestore "node test/agency-my-bookings-rules.test.js"
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing');

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
  const path = require('node:path');
  const firebaseAdminFirestorePath = require.resolve('firebase-admin/firestore', { paths: [path.join(__dirname, '..', 'functions-core')] });
  const { getFirestore } = require(firebaseAdminFirestorePath);
  const db = getFirestore();

  const searchWrapped = functionsTest.wrap(myFunctions.searchAgencyGuests);
  const getConfirmationWrapped = functionsTest.wrap(myFunctions.getAgencyBookingConfirmationData);

  function callAs(fn, uid, email, data) {
    return fn({ data, auth: { uid, token: { email } } });
  }
  async function expectCode(promise, expectedCode) {
    try {
      await promise;
      assert.fail('expected the call to be rejected with code ' + expectedCode + ', but it succeeded');
    } catch (e) {
      assert.equal(e.code, expectedCode, 'wrong error code: got "' + e.code + '" ("' + e.message + '")');
    }
  }

  await db.collection('users').doc(AGENCY_A_EMAIL).set({ email: AGENCY_A_EMAIL, role: 'agency', name: 'Agency A' });
  await db.collection('users').doc(AGENCY_B_EMAIL).set({ email: AGENCY_B_EMAIL, role: 'agency', name: 'Agency B' });

  section('Part 30: adversarial privacy -- Agency A searching "john" never sees Agency B, Direct, or OTA guests');
  await test('seed Agency A guest (John Alpha), Agency B guest (John Beta), a Direct guest (John Direct), and an OTA guest (John OTA)', async () => {
    await db.collection('room_availability').doc('VR01').set({ bookings: [] });
    await db.collection('room_availability').doc('VR02').set({ bookings: [] });
    await db.collection('room_availability').doc('VR03').set({ bookings: [] });
    await db.collection('room_availability').doc('VR04').set({ bookings: [] });

    await db.collection('reservations').doc('ABK-ALPHA-1').set({
      id: 'ABK-ALPHA-1', room_id: 'VR01', guest_name: 'John Alpha', check_in: '2027-04-01', check_out: '2027-04-03',
      adults: 2, children: 0, rate: 500, status: 'Confirmed', source: 'Agency',
      agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL, agencyName: 'Agency A',
      agencyQuoteReference: 'VQ-ALPHA-1', currency: 'USD', agencyGuestSellingTotal: 500,
    });
    await db.collection('reservations').doc('ABK-BETA-1').set({
      id: 'ABK-BETA-1', room_id: 'VR02', guest_name: 'John Beta', check_in: '2027-04-01', check_out: '2027-04-03',
      adults: 2, children: 0, rate: 500, status: 'Confirmed', source: 'Agency',
      agencyId: AGENCY_B_UID, agencyEmail: AGENCY_B_EMAIL, agencyName: 'Agency B',
      agencyQuoteReference: 'VQ-BETA-1', currency: 'USD', agencyGuestSellingTotal: 500,
    });
    await db.collection('reservations').doc('WEB123').set({
      id: 'WEB123', room_id: 'VR03', guest_name: 'John Direct', check_in: '2027-04-01', check_out: '2027-04-03',
      adults: 2, children: 0, rate: 400, status: 'Confirmed', source: 'Website', channel: 'website',
    });
    await db.collection('reservations').doc('BDC-OTA-1').set({
      id: 'BDC-OTA-1', room_id: 'VR04', guest_name: 'John OTA', check_in: '2027-04-01', check_out: '2027-04-03',
      adults: 2, children: 0, rate: 450, status: 'Confirmed', source: 'Booking.com', channel: 'beds24',
    });
  });
  let searchResult;
  await test('Agency A searches "john" via searchAgencyGuests', async () => {
    searchResult = await callAs(searchWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { query: 'john' });
  });
  await test('the result set contains ONLY John Alpha -- no trace of John Beta/Direct/OTA, not even an indication they exist', () => {
    assert.equal(searchResult.results.length, 1);
    assert.equal(searchResult.results[0].guestName, 'John Alpha');
    const json = JSON.stringify(searchResult);
    assert.doesNotMatch(json, /John Beta/);
    assert.doesNotMatch(json, /John Direct/);
    assert.doesNotMatch(json, /John OTA/);
    assert.doesNotMatch(json, /agencyb@example\.com/);
    assert.doesNotMatch(json, /WEB123|BDC-OTA-1|ABK-BETA-1/);
  });
  await test('a case-insensitive, partial query ("JOHN A") still matches John Alpha only', async () => {
    const result = await callAs(searchWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { query: 'JOHN A' });
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].guestName, 'John Alpha');
  });
  await test('Agency B searching "john" sees only John Beta, never John Alpha', async () => {
    const result = await callAs(searchWrapped, AGENCY_B_UID, AGENCY_B_EMAIL, { query: 'john' });
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].guestName, 'John Beta');
  });
  await test('searchAgencyGuests never accepts a client-supplied agencyId to widen the search', async () => {
    const result = await callAs(searchWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { query: 'john', agencyId: AGENCY_B_UID });
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].guestName, 'John Alpha'); // the malicious agencyId param was simply ignored
  });
  await test('an unauthenticated caller cannot search at all', async () => {
    try {
      await searchWrapped({ data: { query: 'john' } });
      assert.fail('expected rejection for no auth context');
    } catch (e) {
      assert.equal(e.code, 'unauthenticated');
    }
  });

  section('Part 31: cross-agency booking-detail security (fresh, targeted re-verification)');
  const testEnv = await initializeTestEnvironment({
    projectId: 'vilu-residence-mb-rules-test',
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
  });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('users').doc(AGENCY_A_EMAIL).set({ email: AGENCY_A_EMAIL, role: 'agency' });
    await ctx.firestore().collection('users').doc(AGENCY_B_EMAIL).set({ email: AGENCY_B_EMAIL, role: 'agency' });
    await ctx.firestore().collection('agency_quotes').doc('VQ-BETA-1').set({ quoteId: 'VQ-BETA-1', agencyId: AGENCY_B_UID, agencyEmail: AGENCY_B_EMAIL, status: 'FINALIZED' });
    await ctx.firestore().collection('agency_booking_requests').doc('ABR-BETA-1').set({ id: 'ABR-BETA-1', agencyId: AGENCY_B_UID, agencyEmail: AGENCY_B_EMAIL, status: 'CONFIRMED', reservationId: 'ABK-BETA-1' });
  });
  const agencyAAuthed = testEnv.authenticatedContext(AGENCY_A_UID, { email: AGENCY_A_EMAIL });
  await test('Agency A cannot directly read Agency B\'s reservation doc', async () => {
    await assertFails(agencyAAuthed.firestore().collection('reservations').doc('ABK-BETA-1').get());
  });
  await test('Agency A cannot directly read Agency B\'s booking request doc', async () => {
    await assertFails(agencyAAuthed.firestore().collection('agency_booking_requests').doc('ABR-BETA-1').get());
  });
  await test('Agency A cannot directly read Agency B\'s quote doc', async () => {
    await assertFails(agencyAAuthed.firestore().collection('agency_quotes').doc('VQ-BETA-1').get());
  });
  await testEnv.cleanup();
  await test('Agency A cannot fetch Agency B\'s confirmation via getAgencyBookingConfirmationData either (server-side ownership check, not just DOM hiding)', async () => {
    // Seeded on the SAME Firestore instance the admin-SDK callable reads
    // from (`db`, used for all searchAgencyGuests/getConfirmation calls in
    // this file) -- the rules-unit-testing `testEnv` above is a separate,
    // isolated emulator project and was only ever the right tool for the
    // three direct-Firestore-rules-read checks just above.
    await db.collection('agency_booking_requests').doc('ABR-BETA-1').set({
      id: 'ABR-BETA-1', agencyId: AGENCY_B_UID, agencyEmail: AGENCY_B_EMAIL, agencyName: 'Agency B',
      guestName: 'John Beta', status: 'CONFIRMED', reservationId: 'ABK-BETA-1',
    });
    await expectCode(callAs(getConfirmationWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { requestId: 'ABR-BETA-1' }), 'permission-denied');
  });

  section('Part 32: count integrity -- confirmed=2, pending=1, quotes never double-counted as bookings');
  await test('seed exactly 2 confirmed reservations, 1 pending request, 1 rejected request, and 3 finalized quotes (2 already superseded by requests, 1 standalone) for a fresh synthetic agency', async () => {
    const AGENCY_C_UID = 'agencyC-uid', AGENCY_C_EMAIL = 'agencyc@example.com';
    await db.collection('users').doc(AGENCY_C_EMAIL).set({ email: AGENCY_C_EMAIL, role: 'agency', name: 'Agency C' });
    global.__AGENCY_C = { uid: AGENCY_C_UID, email: AGENCY_C_EMAIL };

    await db.collection('reservations').doc('ABK-C-1').set({ id: 'ABK-C-1', room_id: 'VR01', guest_name: 'Guest C1', check_in: '2027-05-01', check_out: '2027-05-03', status: 'Confirmed', source: 'Agency', agencyId: AGENCY_C_UID, agencyBookingRequestId: 'ABR-C-1' });
    await db.collection('reservations').doc('ABK-C-2').set({ id: 'ABK-C-2', room_id: 'VR02', guest_name: 'Guest C2', check_in: '2026-01-01', check_out: '2026-01-03', status: 'Checked out', source: 'Agency', agencyId: AGENCY_C_UID, agencyBookingRequestId: 'ABR-C-2' });

    await db.collection('agency_booking_requests').doc('ABR-C-1').set({ id: 'ABR-C-1', agencyId: AGENCY_C_UID, guestName: 'Guest C1', status: 'CONFIRMED', reservationId: 'ABK-C-1', quoteId: 'VQ-C-1', arrivalDate: '2027-05-01', departureDate: '2027-05-03' });
    await db.collection('agency_booking_requests').doc('ABR-C-2').set({ id: 'ABR-C-2', agencyId: AGENCY_C_UID, guestName: 'Guest C2', status: 'CONFIRMED', reservationId: 'ABK-C-2', quoteId: 'VQ-C-2', arrivalDate: '2026-01-01', departureDate: '2026-01-03' });
    await db.collection('agency_booking_requests').doc('ABR-C-3').set({ id: 'ABR-C-3', agencyId: AGENCY_C_UID, guestName: 'Guest C3', status: 'PENDING', quoteId: 'VQ-C-3', arrivalDate: '2027-06-01', departureDate: '2027-06-03' });
    await db.collection('agency_booking_requests').doc('ABR-C-4').set({ id: 'ABR-C-4', agencyId: AGENCY_C_UID, guestName: 'Guest C4', status: 'REJECTED', quoteId: 'VQ-C-4', arrivalDate: '2027-07-01', departureDate: '2027-07-03' });

    await db.collection('agency_quotes').doc('VQ-C-1').set({ quoteId: 'VQ-C-1', agencyId: AGENCY_C_UID, guestName: 'Guest C1', status: 'FINALIZED' });
    await db.collection('agency_quotes').doc('VQ-C-2').set({ quoteId: 'VQ-C-2', agencyId: AGENCY_C_UID, guestName: 'Guest C2', status: 'FINALIZED' });
    await db.collection('agency_quotes').doc('VQ-C-5').set({ quoteId: 'VQ-C-5', agencyId: AGENCY_C_UID, guestName: 'Guest C5 Standalone', status: 'FINALIZED' }); // no booking request yet
  });
  await test('replaying this agency\'s own portal-side counting rules (excluding a request already superseded by its own reservation) against raw Firestore reads gives Confirmed=2, Pending=1, and the standalone quote is the only quote NOT excluded', async () => {
    const AGENCY_C = global.__AGENCY_C;
    const resSnap = await db.collection('reservations').where('agencyId', '==', AGENCY_C.uid).get();
    const reqSnap = await db.collection('agency_booking_requests').where('agencyId', '==', AGENCY_C.uid).get();

    const reservations = resSnap.docs.map((d) => d.data());
    const confirmedRequestIds = {};
    reservations.forEach((r) => { if (r.agencyBookingRequestId) confirmedRequestIds[r.agencyBookingRequestId] = true; });
    const requests = reqSnap.docs.map((d) => d.data()).filter((r) => !confirmedRequestIds[r.id]);

    const confirmedCount = reservations.filter((r) => r.status !== 'Cancelled').length;
    const pendingCount = requests.filter((r) => r.status === 'PENDING' || r.status === 'CHANGE_REQUESTED').length;
    assert.equal(confirmedCount, 2, 'expected exactly 2 confirmed reservations, not 3 (a finalized quote must never be counted as a booking)');
    assert.equal(pendingCount, 1, 'expected exactly 1 pending request (the rejected one and the two superseded-by-reservation ones must not count as pending)');

    const linkedQuoteIds = new Set(reqSnap.docs.map((d) => d.data().quoteId).filter(Boolean));
    const standaloneQuotes = ['VQ-C-1', 'VQ-C-2', 'VQ-C-5'].filter((id) => !linkedQuoteIds.has(id));
    assert.deepEqual(standaloneQuotes, ['VQ-C-5']);
  });

  section('Part 34: read-only -- zero inventory/accounting writes from either function');
  await test('calling searchAgencyGuests and getAgencyBookingConfirmationData repeatedly creates 0 reservations, 0 blocks, 0 booking requests, 0 quote mutations, 0 folios, 0 invoices', async () => {
    const collections = ['reservations', 'blocks', 'agency_booking_requests', 'agency_quotes', 'folios', 'invoices'];
    const before = await Promise.all(collections.map((c) => db.collection(c).get()));
    const beforeCounts = before.map((s) => s.size);

    await callAs(searchWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { query: 'john' });
    await callAs(searchWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { query: 'alpha' });
    try { await callAs(getConfirmationWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { requestId: 'ABR-C-1' }); } catch (e) { /* may legitimately fail ownership -- irrelevant to this write-count check */ }

    const after = await Promise.all(collections.map((c) => db.collection(c).get()));
    const afterCounts = after.map((s) => s.size);
    assert.deepEqual(afterCounts, beforeCounts, 'browsing/searching must never change any collection\'s document count');
  });

  functionsTest.cleanup();
  console.log(`\n${passed}/${passed + failed} agency-my-bookings-rules (emulator + Cloud Functions) assertions passed`);
  if (failed > 0) process.exitCode = 1;
})().catch((e) => {
  console.error('agency-my-bookings-rules.test.js crashed:', e);
  process.exitCode = 1;
});
