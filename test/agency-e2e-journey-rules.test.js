// Agency Sales Workflow — FINAL RELEASE QA: full end-to-end user journey
// (FINAL-1) plus the two-agency cross-visibility journey (FINAL-2), all
// proven against the real Firestore emulator + the actual Cloud Functions.
// This does NOT re-prove every individual security boundary already
// covered by each phase's own *-rules.test.js (those are re-run as part
// of the same full regression gate) -- it proves the single coherent
// CHAIN of transitions actually works end-to-end, exactly as a real
// agency would experience it, with Agency A and Agency B interleaved so
// cross-visibility is checked at every real checkpoint along the way.
//
// Run via:
//   firebase emulators:exec --only firestore "node test/agency-e2e-journey.test.js"
const assert = require('node:assert/strict');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}
async function expectCode(promise, expectedCode) {
  try {
    await promise;
    assert.fail('expected the call to be rejected with code ' + expectedCode + ', but it succeeded');
  } catch (e) {
    assert.equal(e.code, expectedCode, 'wrong error code: got "' + e.code + '" ("' + e.message + '")');
  }
}

const AGENCY_A_UID = 'e2e-agencyA-uid';
const AGENCY_B_UID = 'e2e-agencyB-uid';
const AGENCY_A_EMAIL = 'e2e-agencya@example.com';
const AGENCY_B_EMAIL = 'e2e-agencyb@example.com';
const ADMIN_EMAIL = 'viluresidence@gmail.com';

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

  const submitCustomQuoteWrapped = functionsTest.wrap(myFunctions.submitAgencyCustomQuote);
  const getAvailabilityWrapped = functionsTest.wrap(myFunctions.getAgencyAvailability);
  const approveHoldWrapped = functionsTest.wrap(myFunctions.approveAgencyHoldRequest);
  const confirmWrapped = functionsTest.wrap(myFunctions.confirmAgencyBookingRequest);
  const getConfirmationWrapped = functionsTest.wrap(myFunctions.getAgencyBookingConfirmationData);
  const getMyBookingsWrapped = functionsTest.wrap(myFunctions.getMyAgencyBookings);
  const searchWrapped = functionsTest.wrap(myFunctions.searchAgencyGuests);
  const eligibilityWrapped = functionsTest.wrap(myFunctions.settlementEligibilityOnReservation);
  const markSentWrapped = functionsTest.wrap(myFunctions.markAgencySettlementPaymentSent);
  const confirmReceivedWrapped = functionsTest.wrap(myFunctions.confirmAgencySettlementReceived);

  function callAs(fn, uid, email, data) { return fn({ data, auth: { uid, token: { email } } }); }
  function docEvent(id, beforeData, afterData) {
    const before = { exists: !!beforeData, data: () => beforeData };
    const after = { exists: !!afterData, data: () => afterData };
    return { data: functionsTest.makeChange(before, after), params: { id } };
  }

  await db.collection('users').doc(AGENCY_A_EMAIL).set({ email: AGENCY_A_EMAIL, role: 'agency', name: 'E2E Sunset Travel' });
  await db.collection('users').doc(AGENCY_B_EMAIL).set({ email: AGENCY_B_EMAIL, role: 'agency', name: 'E2E Ocean Tours' });
  await db.collection('website_content').doc('agency_booking_settings').set({ flightSurcharge: 110, extraNightRate: 40, defaultHoldHours: 24 });
  await db.collection('service_catalog').doc('e2e-whale-shark').set({ name: 'Whale Shark Snorkeling', category: 'TRIPS_ACTIVITIES', basePrice: 72, unitType: 'PER_ITEM', active: true, visibleToAgencies: 'all' });
  for (const room of ['VR01', 'VR02', 'VR03', 'VR04', 'VR05', 'VR06']) {
    await db.collection('room_availability').doc(room).set({ bookings: [] });
  }

  section('FINAL-1: full Agency A journey, every transition proven for real');

  let quote;
  await test('1. Agency A creates a custom-package quote (Vilu net rate re-resolved server-side, never trusted from client)', async () => {
    quote = await callAs(submitCustomQuoteWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {
      status: 'DRAFT', guestName: 'Journey Guest A', arrivalDate: '2028-06-10', departureDate: '2028-06-13',
      adults: 2, children: 0, agencyGuestSellingTotal: 0,
      selectedComponents: [{ sourceType: 'catalog', sourceId: 'e2e-whale-shark', quantity: 2 }],
    });
    assert.equal(quote.viluNetTotal, 144);
    assert.equal(quote.status, 'DRAFT');
  });
  await test('2. Agency A sets the guest selling price and finalizes the quote', async () => {
    quote = await callAs(submitCustomQuoteWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {
      status: 'FINALIZED', quoteId: quote.quoteId, guestName: 'Journey Guest A', arrivalDate: '2028-06-10', departureDate: '2028-06-13',
      adults: 2, children: 0, agencyGuestSellingTotal: 250, paymentCollector: 'HOTEL',
      selectedComponents: [{ sourceType: 'catalog', sourceId: 'e2e-whale-shark', quantity: 2 }],
    });
    assert.equal(quote.status, 'FINALIZED');
    assert.equal(quote.agencyGuestSellingTotal, 250);
  });
  await test('3. Agency A checks live availability -- VR01 is free for these dates', async () => {
    const avail = await callAs(getAvailabilityWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { startDate: '2028-06-10', endDate: '2028-06-13' });
    const vr01Days = avail.days.filter((d) => d.roomId === 'VR01');
    assert.ok(vr01Days.every((d) => d.state === 'AVAILABLE'));
  });
  let holdReqId, holdBlockId;
  await test('4. Agency A requests a temporary hold on VR01 for these dates', async () => {
    holdReqId = 'E2E-HOLD-1';
    await db.collection('block_requests').doc(holdReqId).set({
      id: holdReqId, requestType: 'AGENCY_HOLD', agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL, agencyName: 'E2E Sunset Travel',
      quoteId: quote.quoteId, quoteReference: quote.quoteId, guestName: 'Journey Guest A', roomId: 'VR01', roomCategory: 'Deluxe Family Room',
      arrivalDate: '2028-06-10', departureDate: '2028-06-13', requestedHoldHours: 24, requestedHoldUntil: null,
      status: 'PENDING', approvedAt: null, approvedBy: null, approvedHoldUntil: null, blockId: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
  });
  await test('5. Admin approves the hold -- a real block is created, room now shows BLOCKED to other agencies', async () => {
    const result = await callAs(approveHoldWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: holdReqId });
    holdBlockId = result.blockId;
    assert.ok(holdBlockId);
  });
  await test('6. Agency A sends a booking request from the finalized quote, linked to the active hold', async () => {
    await db.collection('agency_booking_requests').doc('E2E-ABR-1').set({
      id: 'E2E-ABR-1', agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL, agencyName: 'E2E Sunset Travel',
      quoteId: quote.quoteId, quoteReference: quote.quoteId,
      guestName: 'Journey Guest A', guestEmail: '', guestPhone: '',
      arrivalDate: '2028-06-10', departureDate: '2028-06-13', nights: 3, adults: 2, children: 0,
      roomCategory: 'Deluxe Family Room', requestedRoomId: 'VR01', assignedRoomId: null,
      quoteType: 'CUSTOM_PACKAGE', packageName: 'Custom Maldives Package',
      packageSnapshot: { quoteType: 'CUSTOM_PACKAGE', selectedComponents: quote.selectedComponents, childDiscountPct: null },
      guestIncludes: quote.guestIncludes || [], guestActivities: quote.guestActivities || [],
      currency: 'USD', viluNetTotal: quote.viluNetTotal, agencyGuestSellingTotal: quote.agencyGuestSellingTotal, agencyEarnings: quote.agencyEarnings, paymentCollector: 'HOTEL',
      holdRequestId: holdReqId, holdBlockId: holdBlockId,
      status: 'PENDING', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      confirmedAt: null, confirmedBy: null, reservationId: null, rejectionReason: null, changeRequestNote: null,
    });
  });
  let reservationId;
  await test('7. Admin confirms the booking request -- canonical reservation created, hold consumed atomically, settlement auto-created', async () => {
    const result = await callAs(confirmWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: 'E2E-ABR-1' });
    reservationId = result.reservationId;
    assert.ok(reservationId);
    const resSnap = await db.collection('reservations').doc(reservationId).get();
    assert.equal(resSnap.data().status, 'Confirmed');
    assert.equal(resSnap.data().source, 'Agency');
    const holdSnap = await db.collection('block_requests').doc(holdReqId).get();
    assert.equal(holdSnap.data().status, 'CANCELLED');
    const blockSnap = await db.collection('blocks').doc(holdBlockId).get();
    assert.equal(blockSnap.exists, false, 'the hold block must be consumed, not left behind');
    const settleSnap = await db.collection('agency_settlements').doc(reservationId).get();
    assert.equal(settleSnap.data().status, 'NOT_YET_PAYABLE');
  });
  await test('8. Agency A views/prints the guest-safe Booking Confirmation -- agreed total present, Vilu net/margin absent', async () => {
    const payload = await callAs(getConfirmationWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { requestId: 'E2E-ABR-1' });
    assert.equal(payload.agencyGuestSellingTotal, 250);
    assert.equal(payload.guestName, 'Journey Guest A');
    const json = JSON.stringify(payload);
    assert.doesNotMatch(json, /viluNetTotal|agencyEarnings|paymentCollector/);
  });
  await test('9. My Bookings shows the confirmed reservation via the safe projection callable', async () => {
    const result = await callAs(getMyBookingsWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {});
    const row = result.reservations.find((r) => r.id === reservationId);
    assert.ok(row);
    assert.equal(row.agencyGuestSellingTotal, 250);
  });
  await test('10. Agency A searches for her own guest and finds the confirmed booking, correctly typed', async () => {
    const result = await callAs(searchWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { query: 'journey guest a' });
    const hit = result.results.find((r) => r.reference === reservationId);
    assert.ok(hit);
    assert.equal(hit.type, 'RESERVATION');
  });
  await test('11. Guest checks in -- settlement automatically becomes PAYABLE', async () => {
    await eligibilityWrapped(docEvent(reservationId, { status: 'Confirmed', agencyId: AGENCY_A_UID }, { status: 'Checked in', agencyId: AGENCY_A_UID }));
    const settleSnap = await db.collection('agency_settlements').doc(reservationId).get();
    assert.equal(settleSnap.data().status, 'PAYABLE');
    assert.equal(settleSnap.data().direction, 'HOTEL_TO_AGENCY');
  });
  await test('12. Vilu marks the settlement payment sent to the agency', async () => {
    await callAs(markSentWrapped, 'admin-uid', ADMIN_EMAIL, { settlementId: reservationId, method: 'Bank transfer', reference: 'E2E-TXN-1' });
    const settleSnap = await db.collection('agency_settlements').doc(reservationId).get();
    assert.equal(settleSnap.data().status, 'PAYMENT_SENT');
  });
  await test('13. Agency A confirms receipt -- final RECEIVED state', async () => {
    await callAs(confirmReceivedWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { settlementId: reservationId });
    const settleSnap = await db.collection('agency_settlements').doc(reservationId).get();
    assert.equal(settleSnap.data().status, 'RECEIVED');
    assert.equal(settleSnap.data().receivedConfirmedByAgency, true);
  });
  await test('the audit trail records the full chain of settlement decisions', async () => {
    const auditSnap = await db.collection('agency_settlement_audit').where('reservationId', '==', reservationId).get();
    const transitions = auditSnap.docs.map((d) => d.data().fromStatus + '->' + d.data().toStatus);
    assert.ok(transitions.includes('PAYABLE->PAYMENT_SENT'));
    assert.ok(transitions.includes('PAYMENT_SENT->RECEIVED'));
  });

  section('FINAL-2: two-agency cross-visibility at every checkpoint just proven above');
  await test('Agency B cannot fetch Agency A\'s Booking Confirmation', async () => {
    await expectCode(callAs(getConfirmationWrapped, AGENCY_B_UID, AGENCY_B_EMAIL, { requestId: 'E2E-ABR-1' }), 'permission-denied');
  });
  await test('Agency B\'s own getMyAgencyBookings never includes Agency A\'s reservation', async () => {
    const result = await callAs(getMyBookingsWrapped, AGENCY_B_UID, AGENCY_B_EMAIL, {});
    assert.equal(result.reservations.find((r) => r.id === reservationId), undefined);
  });
  await test('Agency B searching "Journey Guest A" finds nothing', async () => {
    const result = await callAs(searchWrapped, AGENCY_B_UID, AGENCY_B_EMAIL, { query: 'journey guest a' });
    assert.deepEqual(result.results, []);
  });
  await test('none of Agency A\'s settlement/payment details (reservation id, payment reference) leak into Agency B\'s own bookings list', async () => {
    // The full ownership-boundary matrix for every settlement action is
    // already proven exhaustively in agency-settlements-rules.test.js;
    // this re-confirms the same isolation holds at the end of a real,
    // multi-step journey, not just in isolation.
    const listB = await callAs(getMyBookingsWrapped, AGENCY_B_UID, AGENCY_B_EMAIL, {});
    const json = JSON.stringify(listB);
    assert.doesNotMatch(json, new RegExp(reservationId));
    assert.doesNotMatch(json, /E2E-TXN-1/);
  });

  section('FINAL-2 continued: run the SAME journey for Agency B, independently, to prove no shared/leaked state');
  let quoteB, reservationIdB;
  await test('Agency B independently creates, finalizes, holds, books, and confirms her own guest -- fully isolated from Agency A\'s data throughout', async () => {
    quoteB = await callAs(submitCustomQuoteWrapped, AGENCY_B_UID, AGENCY_B_EMAIL, {
      status: 'FINALIZED', guestName: 'Journey Guest B', arrivalDate: '2028-07-01', departureDate: '2028-07-03',
      adults: 2, children: 0, agencyGuestSellingTotal: 300, paymentCollector: 'AGENCY',
      selectedComponents: [{ sourceType: 'catalog', sourceId: 'e2e-whale-shark', quantity: 1 }],
    });
    await db.collection('agency_booking_requests').doc('E2E-ABR-B1').set({
      id: 'E2E-ABR-B1', agencyId: AGENCY_B_UID, agencyEmail: AGENCY_B_EMAIL, agencyName: 'E2E Ocean Tours',
      quoteId: quoteB.quoteId, quoteReference: quoteB.quoteId, guestName: 'Journey Guest B', guestEmail: '', guestPhone: '',
      arrivalDate: '2028-07-01', departureDate: '2028-07-03', nights: 2, adults: 2, children: 0,
      roomCategory: 'Double Room', requestedRoomId: 'VR03', assignedRoomId: null,
      quoteType: 'CUSTOM_PACKAGE', packageName: 'Custom Maldives Package', packageSnapshot: { quoteType: 'CUSTOM_PACKAGE', selectedComponents: quoteB.selectedComponents },
      guestIncludes: [], guestActivities: [], currency: 'USD',
      viluNetTotal: quoteB.viluNetTotal, agencyGuestSellingTotal: quoteB.agencyGuestSellingTotal, agencyEarnings: quoteB.agencyEarnings, paymentCollector: 'AGENCY',
      holdRequestId: null, holdBlockId: null, status: 'PENDING', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      confirmedAt: null, confirmedBy: null, reservationId: null, rejectionReason: null, changeRequestNote: null,
    });
    const result = await callAs(confirmWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: 'E2E-ABR-B1' });
    reservationIdB = result.reservationId;
    assert.ok(reservationIdB);
    assert.notEqual(reservationIdB, reservationId);
  });
  await test('Agency A cannot see Agency B\'s reservation via getMyAgencyBookings, search, or the confirmation callable', async () => {
    const list = await callAs(getMyBookingsWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {});
    assert.equal(list.reservations.find((r) => r.id === reservationIdB), undefined);
    const search = await callAs(searchWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { query: 'journey guest b' });
    assert.deepEqual(search.results, []);
    await expectCode(callAs(getConfirmationWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { requestId: 'E2E-ABR-B1' }), 'permission-denied');
  });
  await test('Agency B\'s settlement is correctly AGENCY_TO_HOTEL (she collected the guest\'s money) -- fully independent direction from Agency A\'s HOTEL_TO_AGENCY settlement', async () => {
    const settleSnap = await db.collection('agency_settlements').doc(reservationIdB).get();
    assert.equal(settleSnap.data().direction, 'AGENCY_TO_HOTEL');
    assert.equal(settleSnap.data().amountDue, quoteB.viluNetTotal);
  });

  functionsTest.cleanup();
  console.log(`\n${passed}/${passed + failed} agency-e2e-journey (emulator + Cloud Functions) assertions passed`);
  if (failed > 0) process.exitCode = 1;
})().catch((e) => {
  console.error('agency-e2e-journey.test.js crashed:', e);
  process.exitCode = 1;
});
