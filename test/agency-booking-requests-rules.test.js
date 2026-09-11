// Agency Sales Workflow — Phase F: Booking Request -> Vilu Confirmation ->
// Canonical Reservation, proven for real against the Firestore emulator +
// the actual Cloud Functions (via firebase-functions-test), same pattern
// as Phases C/D/E.
//
// Run via:
//   firebase emulators:exec --only firestore "node test/agency-booking-requests-rules.test.js"
//
// NOTE (Part 26): the direct-reservation-create-denied attack test at the
// bottom of this file only passes once firestore.rules' agency direct
// reservation-create branch has been removed (the final cutover step of
// this phase). Until then it is EXPECTED to fail -- that failure is itself
// the proof the old permission still existed, and is reported as such.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');

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
const ADMIN_EMAIL = 'viluresidence@gmail.com';

function baseBookingRequest(overrides) {
  return Object.assign({
    id: 'ABR-000001',
    agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL, agencyName: 'Agency A',
    quoteId: 'VQ-AGENCYA-2026-000001', quoteReference: 'VQ-AGENCYA-2026-000001',
    guestName: 'QA Guest', guestEmail: '', guestPhone: '',
    arrivalDate: '2027-04-01', departureDate: '2027-04-03', nights: 2,
    adults: 2, children: 0,
    roomCategory: 'Deluxe Family Room', requestedRoomId: 'VR01', assignedRoomId: null,
    quoteType: 'ASSIGNED_PACKAGE', packageName: 'QA Package',
    packageSnapshot: { quoteType: 'ASSIGNED_PACKAGE', packageId: 'PKG1', selectedComponents: null, childDiscountPct: 0 },
    guestIncludes: ['Airport transfer'], guestActivities: [],
    currency: 'USD',
    viluNetTotal: 400, agencyGuestSellingTotal: 600, agencyEarnings: 200, paymentCollector: 'HOTEL',
    holdRequestId: null, holdBlockId: null,
    status: 'PENDING',
    createdAt: '2026-09-11T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z',
    confirmedAt: null, confirmedBy: null, reservationId: null,
    rejectionReason: null, changeRequestNote: null,
  }, overrides || {});
}

function baseFinalizedQuote(overrides) {
  return Object.assign({
    quoteId: 'VQ-AGENCYA-2026-000001', agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL, agencyName: 'Agency A',
    guestName: 'QA Guest', arrivalDate: '2027-04-01', departureDate: '2027-04-03', adults: 2, children: 0, nights: 2,
    currency: 'USD', quoteType: 'ASSIGNED_PACKAGE',
    packageId: 'PKG1', packageName: 'QA Package',
    guestIncludes: ['Airport transfer'], guestActivities: [], guestMessage: '',
    selectedComponents: [],
    viluNetTotal: 400, agencyGuestSellingTotal: 600, agencyEarnings: 200, paymentCollector: 'HOTEL',
    exchangeRate: 1, exchangeRateSource: null, exchangeRateSnapshotAt: null,
    status: 'FINALIZED', createdAt: '2026-09-11T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z', finalizedAt: '2026-09-11T00:00:00.000Z',
  }, overrides || {});
}

(async () => {
  // ── PART 1: firestore.rules -- create-time anti-spoofing + ownership ──
  const testEnv = await initializeTestEnvironment({
    projectId: 'vilu-residence-abr-rules-test',
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
  });
  const agencyA = testEnv.authenticatedContext(AGENCY_A_UID, { email: AGENCY_A_EMAIL });
  const agencyB = testEnv.authenticatedContext(AGENCY_B_UID, { email: AGENCY_B_EMAIL });
  const admin = testEnv.authenticatedContext('admin-uid', { email: ADMIN_EMAIL });

  section('firestore.rules: Part 25 -- agency create/read/update/delete boundaries');
  await test('Agency A can create her own PENDING booking request', async () => {
    await assertSucceeds(agencyA.firestore().collection('agency_booking_requests').doc('ABR-A1').set(baseBookingRequest({ id: 'ABR-A1' })));
  });
  await test('Agency A CANNOT spoof agencyId to Agency B\'s uid', async () => {
    await assertFails(agencyA.firestore().collection('agency_booking_requests').doc('ABR-SPOOF').set(baseBookingRequest({ id: 'ABR-SPOOF', agencyId: AGENCY_B_UID })));
  });
  await test('Agency A CANNOT self-create a request that already claims status:CONFIRMED', async () => {
    await assertFails(agencyA.firestore().collection('agency_booking_requests').doc('ABR-FAKE1').set(baseBookingRequest({ id: 'ABR-FAKE1', status: 'CONFIRMED' })));
  });
  await test('Agency A CANNOT self-create a request with a fabricated reservationId', async () => {
    await assertFails(agencyA.firestore().collection('agency_booking_requests').doc('ABR-FAKE2').set(baseBookingRequest({ id: 'ABR-FAKE2', reservationId: 'ABK-FAKE' })));
  });
  await test('Agency A CANNOT self-create a request with fabricated confirmedAt/confirmedBy', async () => {
    await assertFails(agencyA.firestore().collection('agency_booking_requests').doc('ABR-FAKE3').set(baseBookingRequest({ id: 'ABR-FAKE3', confirmedAt: '2026-01-01T00:00:00.000Z', confirmedBy: 'admin@fake.com' })));
  });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('agency_booking_requests').doc('ABR-A-SEED').set(baseBookingRequest({ id: 'ABR-A-SEED' }));
    await ctx.firestore().collection('agency_booking_requests').doc('ABR-B-SEED').set(baseBookingRequest({
      id: 'ABR-B-SEED', agencyId: AGENCY_B_UID, agencyEmail: AGENCY_B_EMAIL, agencyName: 'Agency B', guestName: 'Agency B Guest',
    }));
  });

  await test('Agency A CANNOT read Agency B\'s booking request (Part 27: cannot view guest/price/quote/hold)', async () => {
    await assertFails(agencyA.firestore().collection('agency_booking_requests').doc('ABR-B-SEED').get());
  });
  await test('Agency A CAN read her own booking request', async () => {
    await assertSucceeds(agencyA.firestore().collection('agency_booking_requests').doc('ABR-A-SEED').get());
  });
  await test('Agency A CANNOT confirm her own request directly (update is admin/staff/manager only)', async () => {
    await assertFails(agencyA.firestore().collection('agency_booking_requests').doc('ABR-A-SEED').set(
      baseBookingRequest({ id: 'ABR-A-SEED', status: 'CONFIRMED', reservationId: 'ABK-SELF' }), { merge: true }
    ));
  });
  await test('Agency A CANNOT edit Agency B\'s request (confirm/reject/edit) even trying an update call', async () => {
    await assertFails(agencyA.firestore().collection('agency_booking_requests').doc('ABR-B-SEED').set({ status: 'REJECTED' }, { merge: true }));
  });
  await test('Agency A CANNOT delete her own request', async () => {
    await assertFails(agencyA.firestore().collection('agency_booking_requests').doc('ABR-A-SEED').delete());
  });
  await test('Admin CAN update any booking request (the trusted path Cloud Functions use, via the Admin SDK, bypasses this anyway)', async () => {
    await assertSucceeds(admin.firestore().collection('agency_booking_requests').doc('ABR-A-SEED').set({ status: 'REJECTED' }, { merge: true }));
  });

  await testEnv.cleanup();
  console.log(`\n${passed}/${passed + failed} rules-only assertions passed so far`);

  // ── PART 2: the actual Cloud Functions, run for real ──
  section('Cloud Functions: confirm/reject/request-change (real Firestore emulator)');
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  process.env.GCLOUD_PROJECT = 'vilu-residence';
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'vilu-residence' });

  const functionsTest = require('firebase-functions-test')({ projectId: 'vilu-residence' });
  const myFunctions = require('../functions-core/index.js');
  const path = require('node:path');
  const firebaseAdminFirestorePath = require.resolve('firebase-admin/firestore', { paths: [path.join(__dirname, '..', 'functions-core')] });
  const { getFirestore } = require(firebaseAdminFirestorePath);
  const db = getFirestore();

  const confirmWrapped = functionsTest.wrap(myFunctions.confirmAgencyBookingRequest);
  const rejectWrapped = functionsTest.wrap(myFunctions.rejectAgencyBookingRequest);
  const changeWrapped = functionsTest.wrap(myFunctions.requestChangeAgencyBookingRequest);
  const approveHoldWrapped = functionsTest.wrap(myFunctions.approveAgencyHoldRequest);

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
  await db.collection('users').doc('staffer@example.com').set({ email: 'staffer@example.com', role: 'staff' });
  await db.collection('website_content').doc('agency_booking_settings').set({ flightSurcharge: 110, extraNightRate: 40, defaultHoldHours: 24 });

  section('Happy path: admin confirms a valid request -> real canonical reservation');
  let confirmedReqId, confirmedResId;
  await test('confirming a PENDING request with a genuinely free room creates a real reservation, marks CONFIRMED, stores reservationId', async () => {
    await db.collection('room_availability').doc('VR01').set({ bookings: [] });
    await db.collection('agency_quotes').doc('VQ-HAPPY-1').set(baseFinalizedQuote({ quoteId: 'VQ-HAPPY-1' }));
    confirmedReqId = 'ABR-HAPPY-1';
    await db.collection('agency_booking_requests').doc(confirmedReqId).set(baseBookingRequest({
      id: confirmedReqId, quoteId: 'VQ-HAPPY-1', quoteReference: 'VQ-HAPPY-1', requestedRoomId: 'VR01', arrivalDate: '2027-05-01', departureDate: '2027-05-04',
    }));
    const result = await callAs(confirmWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: confirmedReqId });
    assert.ok(result.reservationId);
    confirmedResId = result.reservationId;

    const reqSnap = await db.collection('agency_booking_requests').doc(confirmedReqId).get();
    assert.equal(reqSnap.data().status, 'CONFIRMED');
    assert.equal(reqSnap.data().reservationId, confirmedResId);
    assert.equal(reqSnap.data().confirmedBy, ADMIN_EMAIL);

    const resSnap = await db.collection('reservations').doc(confirmedResId).get();
    assert.ok(resSnap.exists);
    const r = resSnap.data();
    assert.equal(r.room_id, 'VR01');
    assert.equal(r.source, 'Agency');
    assert.equal(r.status, 'Confirmed');
    assert.equal(r.agencyId, AGENCY_A_UID);
    assert.equal(r.agencyBookingRequestId, confirmedReqId);
    assert.equal(r.agencyQuoteId, 'VQ-HAPPY-1');
    assert.equal(r.check_in, '2027-05-01');
    assert.equal(r.check_out, '2027-05-04');
    assert.equal(r.adults, 2);
    assert.equal(r.viluNetTotal, 400);
    assert.equal(r.agencyGuestSellingTotal, 600);
    assert.equal(r.agencyEarnings, 200);
    assert.equal(r.paymentCollector, 'HOTEL');
  });
  await test('the reservation reduced availability -- room_availability now shows this booking\'s dates', async () => {
    const availSnap = await db.collection('room_availability').doc('VR01').get();
    const bookings = availSnap.data().bookings || [];
    assert.ok(bookings.some((b) => b.id === confirmedResId && b.from === '2027-05-01' && b.to === '2027-05-04'));
  });

  section('Rejection: no reservation created');
  await test('rejecting a PENDING request sets REJECTED with reason and creates no reservation', async () => {
    await db.collection('room_availability').doc('VR02').set({ bookings: [] });
    await db.collection('agency_quotes').doc('VQ-REJECT-1').set(baseFinalizedQuote({ quoteId: 'VQ-REJECT-1' }));
    const reqId = 'ABR-REJECT-1';
    await db.collection('agency_booking_requests').doc(reqId).set(baseBookingRequest({ id: reqId, quoteId: 'VQ-REJECT-1', quoteReference: 'VQ-REJECT-1', requestedRoomId: 'VR02' }));
    await callAs(rejectWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: reqId, reason: 'Guest changed plans' });
    const reqSnap = await db.collection('agency_booking_requests').doc(reqId).get();
    assert.equal(reqSnap.data().status, 'REJECTED');
    assert.equal(reqSnap.data().rejectionReason, 'Guest changed plans');
    const resSnap = await db.collection('reservations').where('agencyBookingRequestId', '==', reqId).get();
    assert.equal(resSnap.size, 0);
  });

  section('Part 11: rejection releases a linked active hold');
  await test('rejecting a request with a linked APPROVED hold deletes the hold\'s block and marks the hold CANCELLED', async () => {
    await db.collection('room_availability').doc('VR03').set({ bookings: [] });
    await db.collection('agency_quotes').doc('VQ-REJHOLD-1').set(baseFinalizedQuote({ quoteId: 'VQ-REJHOLD-1' }));
    const holdReqId = 'BR-REJHOLD-1';
    await db.collection('block_requests').doc(holdReqId).set({
      id: holdReqId, requestType: 'AGENCY_HOLD', agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL, agencyName: 'Agency A',
      quoteId: 'VQ-REJHOLD-1', quoteReference: 'VQ-REJHOLD-1', guestName: 'QA Guest', roomId: 'VR03', roomCategory: 'Double Room',
      arrivalDate: '2027-06-01', departureDate: '2027-06-03', requestedHoldHours: 24, requestedHoldUntil: null,
      status: 'PENDING', approvedAt: null, approvedBy: null, approvedHoldUntil: null, blockId: null,
      createdAt: '2026-09-11T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z',
    });
    const approveResult = await callAs(approveHoldWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: holdReqId });
    const blockId = approveResult.blockId;
    assert.ok(blockId);

    const bookingReqId = 'ABR-REJHOLD-1';
    await db.collection('agency_booking_requests').doc(bookingReqId).set(baseBookingRequest({
      id: bookingReqId, quoteId: 'VQ-REJHOLD-1', quoteReference: 'VQ-REJHOLD-1', requestedRoomId: 'VR03', roomCategory: 'Double Room',
      arrivalDate: '2027-06-01', departureDate: '2027-06-03', holdRequestId: holdReqId, holdBlockId: blockId,
    }));
    await callAs(rejectWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: bookingReqId, reason: 'Not needed' });

    const holdSnap = await db.collection('block_requests').doc(holdReqId).get();
    assert.equal(holdSnap.data().status, 'CANCELLED');
    const blockSnap = await db.collection('blocks').doc(blockId).get();
    assert.equal(blockSnap.exists, false);
  });

  section('Part 10: request change -- no reservation, note stored, hold left untouched');
  await test('requesting a change sets CHANGE_REQUESTED with the note and creates no reservation', async () => {
    await db.collection('room_availability').doc('VR04').set({ bookings: [] });
    await db.collection('agency_quotes').doc('VQ-CHANGE-1').set(baseFinalizedQuote({ quoteId: 'VQ-CHANGE-1' }));
    const reqId = 'ABR-CHANGE-1';
    await db.collection('agency_booking_requests').doc(reqId).set(baseBookingRequest({ id: reqId, quoteId: 'VQ-CHANGE-1', quoteReference: 'VQ-CHANGE-1', requestedRoomId: 'VR04' }));
    await callAs(changeWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: reqId, note: 'Please confirm domestic flight time' });
    const reqSnap = await db.collection('agency_booking_requests').doc(reqId).get();
    assert.equal(reqSnap.data().status, 'CHANGE_REQUESTED');
    assert.equal(reqSnap.data().changeRequestNote, 'Please confirm domestic flight time');
    const resSnap = await db.collection('reservations').where('agencyBookingRequestId', '==', reqId).get();
    assert.equal(resSnap.size, 0);
  });
  await test('requestChangeAgencyBookingRequest requires a non-empty note', async () => {
    const reqId = 'ABR-CHANGE-NOTE-1';
    await db.collection('agency_booking_requests').doc(reqId).set(baseBookingRequest({ id: reqId, requestedRoomId: 'VR04' }));
    await expectCode(callAs(changeWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: reqId, note: '' }), 'invalid-argument');
  });
  await test('a CHANGE_REQUESTED request can still be confirmed afterward (agency resubmitted the same request, no re-send flow needed)', async () => {
    const reqId = 'ABR-CHANGE-1';
    const result = await callAs(confirmWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: reqId });
    assert.ok(result.reservationId);
  });

  section('Part 29: duplicate confirm protection -- idempotent');
  await test('confirming an already-CONFIRMED request returns the SAME reservationId, does not error, creates no second reservation', async () => {
    const result = await callAs(confirmWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: confirmedReqId });
    assert.equal(result.alreadyConfirmed, true);
    assert.equal(result.reservationId, confirmedResId);
    const resSnap = await db.collection('reservations').where('agencyBookingRequestId', '==', confirmedReqId).get();
    assert.equal(resSnap.size, 1);
  });

  section('Part 30: availability race -- confirm rechecks and fails cleanly if the room was taken meanwhile');
  await test('room becomes unavailable between request and confirm -> confirm is rejected, no reservation created, request stays PENDING', async () => {
    await db.collection('room_availability').doc('VR05').set({ bookings: [] });
    await db.collection('agency_quotes').doc('VQ-RACE-1').set(baseFinalizedQuote({ quoteId: 'VQ-RACE-1' }));
    const reqId = 'ABR-RACE-1';
    await db.collection('agency_booking_requests').doc(reqId).set(baseBookingRequest({
      id: reqId, quoteId: 'VQ-RACE-1', quoteReference: 'VQ-RACE-1', requestedRoomId: 'VR05', arrivalDate: '2027-07-01', departureDate: '2027-07-04',
    }));
    // Someone else books VR05 for an overlapping range in the meantime.
    await db.collection('room_availability').doc('VR05').set({ bookings: [{ id: 'RES-RACE', from: '2027-07-02', to: '2027-07-05' }] });

    const result = await callAs(confirmWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: reqId });
    assert.equal(result.availabilityChanged, true);

    const reqSnap = await db.collection('agency_booking_requests').doc(reqId).get();
    assert.equal(reqSnap.data().status, 'PENDING');
    assert.equal(reqSnap.data().reservationId, null);
    const resSnap = await db.collection('reservations').where('agencyBookingRequestId', '==', reqId).get();
    assert.equal(resSnap.size, 0);
  });

  section('Part 31: hold + confirm -- one canonical reservation, linked hold safely consumed, no leftover block');
  let holdConvertBlockId, holdConvertReqId, holdConvertHoldReqId;
  await test('booking request references an APPROVED active hold for the same agency/room/dates -> confirm succeeds, uses the held room', async () => {
    await db.collection('room_availability').doc('VR06').set({ bookings: [] });
    await db.collection('agency_quotes').doc('VQ-HOLD-1').set(baseFinalizedQuote({ quoteId: 'VQ-HOLD-1' }));
    holdConvertHoldReqId = 'BR-HOLDCONV-1';
    await db.collection('block_requests').doc(holdConvertHoldReqId).set({
      id: holdConvertHoldReqId, requestType: 'AGENCY_HOLD', agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL, agencyName: 'Agency A',
      quoteId: 'VQ-HOLD-1', quoteReference: 'VQ-HOLD-1', guestName: 'QA Guest', roomId: 'VR06', roomCategory: 'Deluxe Family Room with Open Deck',
      arrivalDate: '2027-08-01', departureDate: '2027-08-03', requestedHoldHours: 24, requestedHoldUntil: null,
      status: 'PENDING', approvedAt: null, approvedBy: null, approvedHoldUntil: null, blockId: null,
      createdAt: '2026-09-11T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z',
    });
    const approveResult = await callAs(approveHoldWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: holdConvertHoldReqId });
    holdConvertBlockId = approveResult.blockId;
    assert.ok(holdConvertBlockId);

    holdConvertReqId = 'ABR-HOLDCONV-1';
    await db.collection('agency_booking_requests').doc(holdConvertReqId).set(baseBookingRequest({
      id: holdConvertReqId, quoteId: 'VQ-HOLD-1', quoteReference: 'VQ-HOLD-1', requestedRoomId: 'VR06', roomCategory: 'Deluxe Family Room with Open Deck',
      arrivalDate: '2027-08-01', departureDate: '2027-08-03', holdRequestId: holdConvertHoldReqId, holdBlockId: holdConvertBlockId,
    }));

    // Without the excludeBlockId fix, this confirm would see the hold's own
    // block as a conflict and wrongly report availabilityChanged -- this
    // assertion is the real proof Part 14's exclusion logic works.
    const result = await callAs(confirmWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: holdConvertReqId });
    assert.ok(result.reservationId, 'expected a reservation to be created using the held room, got: ' + JSON.stringify(result));
  });
  await test('the hold\'s block is gone (consumed, not leftover) and the hold request is CANCELLED with the reservation id recorded', async () => {
    const blockSnap = await db.collection('blocks').doc(holdConvertBlockId).get();
    assert.equal(blockSnap.exists, false);
    const holdSnap = await db.collection('block_requests').doc(holdConvertHoldReqId).get();
    assert.equal(holdSnap.data().status, 'CANCELLED');
    assert.ok(holdSnap.data().consumedByReservationId);
  });
  await test('exactly one reservation exists for this booking request (no duplicate occupancy)', async () => {
    const resSnap = await db.collection('reservations').where('agencyBookingRequestId', '==', holdConvertReqId).get();
    assert.equal(resSnap.size, 1);
  });
  await test('a hold that has since EXPIRED is silently ignored at confirm time (falls back to a plain availability recheck) rather than blocking confirmation', async () => {
    await db.collection('room_availability').doc('VR01').set({ bookings: [] });
    await db.collection('agency_quotes').doc('VQ-EXPHOLD-1').set(baseFinalizedQuote({ quoteId: 'VQ-EXPHOLD-1' }));
    const expiredHoldId = 'BR-EXPHOLD-1';
    await db.collection('block_requests').doc(expiredHoldId).set({
      id: expiredHoldId, requestType: 'AGENCY_HOLD', agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL, agencyName: 'Agency A',
      quoteId: 'VQ-EXPHOLD-1', quoteReference: 'VQ-EXPHOLD-1', guestName: 'QA Guest', roomId: 'VR01', roomCategory: 'Deluxe Family Room',
      arrivalDate: '2027-09-01', departureDate: '2027-09-03', status: 'EXPIRED',
      approvedAt: '2026-09-10T00:00:00.000Z', approvedBy: ADMIN_EMAIL, approvedHoldUntil: '2026-09-10T12:00:00.000Z', blockId: null,
      expiredAt: '2026-09-10T12:00:00.000Z', createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-10T12:00:00.000Z',
    });
    const reqId = 'ABR-EXPHOLD-1';
    await db.collection('agency_booking_requests').doc(reqId).set(baseBookingRequest({
      id: reqId, quoteId: 'VQ-EXPHOLD-1', quoteReference: 'VQ-EXPHOLD-1', requestedRoomId: 'VR01',
      arrivalDate: '2027-09-01', departureDate: '2027-09-03', holdRequestId: expiredHoldId, holdBlockId: null,
    }));
    const result = await callAs(confirmWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: reqId });
    assert.ok(result.reservationId, 'expired hold must not block a normal confirmation, got: ' + JSON.stringify(result));
  });

  section('Part 27/36: cross-agency + authorization adversarial checks on the Cloud Functions themselves');
  await test('an agency caller cannot call confirmAgencyBookingRequest at all', async () => {
    await db.collection('room_availability').doc('VR02').set({ bookings: [] });
    const reqId = 'ABR-AGENCY-TRY-CONFIRM';
    await db.collection('agency_booking_requests').doc(reqId).set(baseBookingRequest({ id: reqId, requestedRoomId: 'VR02' }));
    await expectCode(callAs(confirmWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { requestId: reqId }), 'permission-denied');
  });
  await test('Agency A cannot use confirmAgencyBookingRequest to act on Agency B\'s request either (still permission-denied before any ownership check runs)', async () => {
    const reqId = 'ABR-CROSS-TRY';
    await db.collection('agency_booking_requests').doc(reqId).set(baseBookingRequest({ id: reqId, agencyId: AGENCY_B_UID, agencyEmail: AGENCY_B_EMAIL, requestedRoomId: 'VR02' }));
    await expectCode(callAs(confirmWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { requestId: reqId }), 'permission-denied');
  });
  await test('a staff caller CAN call confirmAgencyBookingRequest (staff-like, not admin-only)', async () => {
    await db.collection('room_availability').doc('VR02').set({ bookings: [] });
    await db.collection('agency_quotes').doc('VQ-STAFF-1').set(baseFinalizedQuote({ quoteId: 'VQ-STAFF-1' }));
    const reqId = 'ABR-STAFF-CONFIRM';
    await db.collection('agency_booking_requests').doc(reqId).set(baseBookingRequest({ id: reqId, quoteId: 'VQ-STAFF-1', quoteReference: 'VQ-STAFF-1', requestedRoomId: 'VR02' }));
    const result = await callAs(confirmWrapped, 'staff-uid', 'staffer@example.com', { requestId: reqId });
    assert.ok(result.reservationId);
  });
  await test('an unauthenticated caller cannot call confirmAgencyBookingRequest', async () => {
    const reqId = 'ABR-ANON-TRY';
    await db.collection('agency_booking_requests').doc(reqId).set(baseBookingRequest({ id: reqId, requestedRoomId: 'VR01' }));
    try {
      await confirmWrapped({ data: { requestId: reqId } });
      assert.fail('expected rejection for no auth context');
    } catch (e) {
      assert.equal(e.code, 'unauthenticated');
    }
  });
  await test('confirming a REJECTED request is rejected (failed-precondition), not silently re-processed', async () => {
    const reqId = 'ABR-REJECT-1'; // rejected earlier in this run
    await expectCode(callAs(confirmWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: reqId }), 'failed-precondition');
  });
  await test('confirming rejects a request whose linked quote is NOT finalized (defense in depth, Part 12/13)', async () => {
    await db.collection('room_availability').doc('VR03').set({ bookings: [] });
    await db.collection('agency_quotes').doc('VQ-DRAFT-1').set(baseFinalizedQuote({ quoteId: 'VQ-DRAFT-1', status: 'DRAFT' }));
    const reqId = 'ABR-DRAFT-QUOTE-1';
    await db.collection('agency_booking_requests').doc(reqId).set(baseBookingRequest({ id: reqId, quoteId: 'VQ-DRAFT-1', quoteReference: 'VQ-DRAFT-1', requestedRoomId: 'VR03' }));
    await expectCode(callAs(confirmWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: reqId }), 'failed-precondition');
  });
  await test('confirming rejects a request whose linked quote belongs to a DIFFERENT agency (ownership mismatch, Part 12)', async () => {
    await db.collection('room_availability').doc('VR03').set({ bookings: [] });
    await db.collection('agency_quotes').doc('VQ-OWNERMISMATCH-1').set(baseFinalizedQuote({ quoteId: 'VQ-OWNERMISMATCH-1', agencyId: AGENCY_B_UID, agencyEmail: AGENCY_B_EMAIL }));
    const reqId = 'ABR-OWNERMISMATCH-1';
    await db.collection('agency_booking_requests').doc(reqId).set(baseBookingRequest({ id: reqId, quoteId: 'VQ-OWNERMISMATCH-1', quoteReference: 'VQ-OWNERMISMATCH-1', requestedRoomId: 'VR03' }));
    await expectCode(callAs(confirmWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: reqId }), 'failed-precondition');
  });

  functionsTest.cleanup();
  console.log(`\n${passed}/${passed + failed} agency-booking-requests-rules (emulator + Cloud Functions) assertions passed so far`);

  // ── PART 26: direct reservation-create attack, proven against the CURRENT
  // deployed-shape firestore.rules on disk. Passes once the cutover (removing
  // the agency direct-create branch from reservations' create rule) has
  // happened; expected to FAIL before that, which is itself the proof the
  // old permission still existed at that point in the phase. ──
  section('Part 26: direct reservation-create attack (reservations.doc().set() bypassing the whole Booking Request flow)');
  const testEnv2 = await initializeTestEnvironment({
    projectId: 'vilu-residence-abr-attack-test',
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
  });
  // isAgency() in firestore.rules resolves role via get(/users/{email}) --
  // without this seed doc, that get() throws on a nonexistent document and
  // the write is denied for the WRONG reason (a rules evaluation error, not
  // the specific agency-source permission this test exists to prove).
  await testEnv2.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('users').doc(AGENCY_A_EMAIL).set({ email: AGENCY_A_EMAIL, role: 'agency', name: 'Agency A' });
  });
  const agencyA2 = testEnv2.authenticatedContext(AGENCY_A_UID, { email: AGENCY_A_EMAIL });
  await test('Agency A directly creating reservations/{fakeId} with source:Agency, agencyId: own uid is DENIED', async () => {
    await assertFails(agencyA2.firestore().collection('reservations').doc('FAKE-DIRECT-1').set({
      id: 'FAKE-DIRECT-1', room_id: 'VR01', check_in: '2027-10-01', check_out: '2027-10-03',
      status: 'Confirmed', source: 'Agency', agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL,
      guest_name: 'Attack Guest', adults: 2, children: 0, rate: 999,
    }));
  });
  await testEnv2.cleanup();

  console.log(`\n${passed}/${passed + failed} agency-booking-requests-rules total assertions passed`);
  if (failed > 0) process.exitCode = 1;
})().catch((e) => {
  console.error('agency-booking-requests-rules.test.js crashed:', e);
  process.exitCode = 1;
});
