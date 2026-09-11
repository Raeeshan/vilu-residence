// Agency Sales Workflow — Phase J: Agency Earnings & Settlement Ledger,
// proven for real against the Firestore emulator + the actual Cloud
// Functions (via firebase-functions-test), same pattern as Phases C-I.
//
// Run via:
//   firebase emulators:exec --only firestore "node test/agency-settlements-rules.test.js"
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
const ADMIN_EMAIL = 'viluresidence@gmail.com';

function baseBookingRequest(overrides) {
  return Object.assign({
    id: 'ABR-000001',
    agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL, agencyName: 'Agency A',
    quoteId: 'VQ-J-1', quoteReference: 'VQ-J-1',
    guestName: 'Settlement QA Guest', guestEmail: '', guestPhone: '',
    // A distinctive, far-future year (unlike most other phases' 2027
    // defaults) specifically to avoid any residual-data date-range
    // collision when this file runs chained after 8 other emulator test
    // files sharing the SAME emulator instance across the whole command.
    arrivalDate: '2028-04-01', departureDate: '2028-04-03', nights: 2,
    adults: 2, children: 0,
    roomCategory: 'Deluxe Family Room', requestedRoomId: 'VR01', assignedRoomId: null,
    quoteType: 'ASSIGNED_PACKAGE', packageName: 'QA Package',
    packageSnapshot: { quoteType: 'ASSIGNED_PACKAGE', packageId: 'PKG1', selectedComponents: null, childDiscountPct: 0 },
    guestIncludes: [], guestActivities: [],
    currency: 'USD',
    viluNetTotal: 400, agencyGuestSellingTotal: 600, agencyEarnings: 200, paymentCollector: 'HOTEL',
    holdRequestId: null, holdBlockId: null,
    status: 'PENDING',
    createdAt: '2026-09-11T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z',
    confirmedAt: null, confirmedBy: null, reservationId: null,
    rejectionReason: null, changeRequestNote: null,
  }, overrides || {});
}

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

  const confirmWrapped = functionsTest.wrap(myFunctions.confirmAgencyBookingRequest);
  const eligibilityWrapped = functionsTest.wrap(myFunctions.settlementEligibilityOnReservation);
  const markSentWrapped = functionsTest.wrap(myFunctions.markAgencySettlementPaymentSent);
  const confirmReceivedWrapped = functionsTest.wrap(myFunctions.confirmAgencySettlementReceived);
  const disputeWrapped = functionsTest.wrap(myFunctions.disputeAgencySettlement);
  const resolveDisputeWrapped = functionsTest.wrap(myFunctions.resolveAgencySettlementDispute);
  const reconcileWrapped = functionsTest.wrap(myFunctions.reconcileMissingAgencySettlements);

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
  // firebase-functions-test's wrap() for a v2 onDocumentWritten function
  // tries to Firestore-encode a plain {before,after} object handed to it
  // directly (it attempts to build a real mock DocumentSnapshot from
  // whatever's in event.data) -- which breaks on a function-valued
  // `.data()` property. The fix is functionsTest.makeChange(before,after),
  // which returns a real instance of firebase-functions' own Change class;
  // the library's merge logic special-cases that exact type as "already
  // fully-formed", skipping the encode attempt entirely. Change.fromObjects
  // just stores before/after verbatim (confirmed from firebase-functions'
  // own source), so plain {exists, data:()=>...} objects -- exactly what
  // the real handler expects -- pass through unchanged.
  function docEvent(id, beforeData, afterData) {
    const before = { exists: !!beforeData, data: () => beforeData };
    const after = { exists: !!afterData, data: () => afterData };
    return { data: functionsTest.makeChange(before, after), params: { id } };
  }

  // Baseline snapshot, taken before this file writes anything -- other
  // emulator test files in the same chained regression run reuse the same
  // literal 'agencyA-uid' convention for their own synthetic Agency A, so
  // an absolute count assumption would be chain-order-dependent. This file
  // creates exactly 6 reservations via confirmWrapped (ABR-J-1, -CANCEL,
  // -2, -2B, -3, -NOTYET) plus 1 manually-seeded legacy reservation
  // (LEGACY-AG-1) later -- the Part J-27 check below asserts the delta,
  // not an absolute number.
  const resCountAtStart = (await db.collection('reservations').where('agencyId', '==', AGENCY_A_UID).get()).size;

  await db.collection('users').doc(AGENCY_A_EMAIL).set({ email: AGENCY_A_EMAIL, role: 'agency', name: 'Agency A' });
  await db.collection('users').doc(AGENCY_B_EMAIL).set({ email: AGENCY_B_EMAIL, role: 'agency', name: 'Agency B' });
  await db.collection('website_content').doc('agency_booking_settings').set({ flightSurcharge: 110, extraNightRate: 40, defaultHoldHours: 24 });

  section('Part J-5/J-18: settlement auto-created NOT_YET_PAYABLE at confirmation, PAYABLE only after real check-in');
  let resId1, settleRef1;
  await test('confirming a HOTEL_TO_AGENCY booking request creates a settlement, status NOT_YET_PAYABLE, correct direction/amount', async () => {
    await db.collection('room_availability').doc('VR01').set({ bookings: [] });
    await db.collection('agency_quotes').doc('VQ-J-1').set({ quoteId: 'VQ-J-1', agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL, status: 'FINALIZED' });
    await db.collection('agency_booking_requests').doc('ABR-J-1').set(baseBookingRequest({ id: 'ABR-J-1' }));
    const result = await callAs(confirmWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: 'ABR-J-1' });
    resId1 = result.reservationId;
    settleRef1 = db.collection('agency_settlements').doc(resId1);
    const snap = await settleRef1.get();
    assert.ok(snap.exists);
    assert.equal(snap.data().status, 'NOT_YET_PAYABLE');
    assert.equal(snap.data().direction, 'HOTEL_TO_AGENCY');
    assert.equal(snap.data().amountDue, 200);
    assert.equal(snap.data().currency, 'USD');
  });
  await test('a Confirmed reservation whose arrival date has already passed, but is NOT checked in, stays NOT_YET_PAYABLE (never inferred from date alone)', async () => {
    const snap = await settleRef1.get();
    assert.equal(snap.data().status, 'NOT_YET_PAYABLE');
  });
  await test('a status change unrelated to check-in (e.g. Confirmed -> Confirmed re-save) does not trigger PAYABLE', async () => {
    const before = { status: 'Confirmed', agencyId: AGENCY_A_UID };
    const after = { status: 'Confirmed', agencyId: AGENCY_A_UID };
    await eligibilityWrapped(docEvent(resId1, before, after));
    const snap = await settleRef1.get();
    assert.equal(snap.data().status, 'NOT_YET_PAYABLE');
  });
  await test('a genuine transition into "Checked in" flips the settlement to PAYABLE', async () => {
    const before = { status: 'Confirmed', agencyId: AGENCY_A_UID };
    const after = { status: 'Checked in', agencyId: AGENCY_A_UID };
    await eligibilityWrapped(docEvent(resId1, before, after));
    const snap = await settleRef1.get();
    assert.equal(snap.data().status, 'PAYABLE');
    assert.ok(snap.data().payableAt);
  });
  await test('running the eligibility trigger again (duplicate delivery) is a safe no-op -- does not error or re-timestamp', async () => {
    const payableAtBefore = (await settleRef1.get()).data().payableAt;
    const before = { status: 'Confirmed', agencyId: AGENCY_A_UID };
    const after = { status: 'Checked in', agencyId: AGENCY_A_UID };
    await eligibilityWrapped(docEvent(resId1, before, after));
    const snap = await settleRef1.get();
    assert.equal(snap.data().status, 'PAYABLE');
    assert.equal(snap.data().payableAt, payableAtBefore);
  });

  section('Part J-18: a cancelled reservation never becomes payable');
  await test('a booking request confirmed then its reservation cancelled stays NOT_YET_PAYABLE, never transitions to PAYABLE via the eligibility trigger', async () => {
    await db.collection('room_availability').doc('VR02').set({ bookings: [] });
    await db.collection('agency_quotes').doc('VQ-J-CANCEL').set({ quoteId: 'VQ-J-CANCEL', agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL, status: 'FINALIZED' });
    await db.collection('agency_booking_requests').doc('ABR-J-CANCEL').set(baseBookingRequest({ id: 'ABR-J-CANCEL', quoteId: 'VQ-J-CANCEL', quoteReference: 'VQ-J-CANCEL', requestedRoomId: 'VR02' }));
    const result = await callAs(confirmWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: 'ABR-J-CANCEL' });
    const before = { status: 'Confirmed', agencyId: AGENCY_A_UID };
    const after = { status: 'Cancelled', agencyId: AGENCY_A_UID };
    await eligibilityWrapped(docEvent(result.reservationId, before, after));
    const snap = await db.collection('agency_settlements').doc(result.reservationId).get();
    assert.equal(snap.data().status, 'NOT_YET_PAYABLE');
  });

  section('Part J-21: duplicate confirm never creates a second settlement');
  await test('confirming the same request twice results in exactly one settlement document', async () => {
    await callAs(confirmWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: 'ABR-J-1' }); // already CONFIRMED, idempotent per Phase F
    const snap = await db.collection('agency_settlements').where('reservationId', '==', resId1).get();
    assert.equal(snap.size, 1);
  });

  section('Part J-8/J-9: HOTEL_TO_AGENCY flow -- Vilu marks sent, agency confirms received');
  await test('a non-staff (agency) caller cannot mark payment sent for a HOTEL_TO_AGENCY settlement', async () => {
    await expectCode(callAs(markSentWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { settlementId: resId1, method: 'Bank transfer' }), 'permission-denied');
  });
  await test('admin marks payment sent -> PAYMENT_SENT, method/reference stored', async () => {
    const result = await callAs(markSentWrapped, 'admin-uid', ADMIN_EMAIL, { settlementId: resId1, method: 'Bank transfer', reference: 'TXN123' });
    assert.equal(result.status, 'PAYMENT_SENT');
    const snap = await settleRef1.get();
    assert.equal(snap.data().paymentMethod, 'Bank transfer');
    assert.equal(snap.data().paymentReference, 'TXN123');
    assert.equal(snap.data().paymentInitiatedBy, 'HOTEL');
  });
  await test('Agency B cannot confirm receipt of Agency A\'s settlement', async () => {
    await expectCode(callAs(confirmReceivedWrapped, AGENCY_B_UID, AGENCY_B_EMAIL, { settlementId: resId1 }), 'permission-denied');
  });
  await test('admin/staff cannot confirm receipt on Agency A\'s behalf for a HOTEL_TO_AGENCY settlement (only the agency herself can)', async () => {
    await expectCode(callAs(confirmReceivedWrapped, 'admin-uid', ADMIN_EMAIL, { settlementId: resId1 }), 'permission-denied');
  });
  await test('Agency A confirms receipt -> RECEIVED, receivedConfirmedByAgency true', async () => {
    const result = await callAs(confirmReceivedWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { settlementId: resId1 });
    assert.equal(result.status, 'RECEIVED');
    const snap = await settleRef1.get();
    assert.equal(snap.data().receivedConfirmedByAgency, true);
  });
  await test('an audit trail entry exists for each transition (PAYABLE->PAYMENT_SENT, PAYMENT_SENT->RECEIVED)', async () => {
    const snap = await db.collection('agency_settlement_audit').where('settlementId', '==', resId1).get();
    const transitions = snap.docs.map((d) => d.data().fromStatus + '->' + d.data().toStatus);
    assert.ok(transitions.includes('PAYABLE->PAYMENT_SENT'));
    assert.ok(transitions.includes('PAYMENT_SENT->RECEIVED'));
  });

  section('Part J-10/J-17: dispute + admin resolution (HOTEL_TO_AGENCY)');
  let resId2, settleRef2;
  await test('set up a second settlement, mark payment sent, agency disputes it', async () => {
    await db.collection('room_availability').doc('VR03').set({ bookings: [] });
    await db.collection('agency_quotes').doc('VQ-J-2').set({ quoteId: 'VQ-J-2', agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL, status: 'FINALIZED' });
    await db.collection('agency_booking_requests').doc('ABR-J-2').set(baseBookingRequest({ id: 'ABR-J-2', quoteId: 'VQ-J-2', quoteReference: 'VQ-J-2', requestedRoomId: 'VR03' }));
    const result = await callAs(confirmWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: 'ABR-J-2' });
    resId2 = result.reservationId;
    settleRef2 = db.collection('agency_settlements').doc(resId2);
    await eligibilityWrapped(docEvent(resId2, { status: 'Confirmed', agencyId: AGENCY_A_UID }, { status: 'Checked in', agencyId: AGENCY_A_UID }));
    await callAs(markSentWrapped, 'admin-uid', ADMIN_EMAIL, { settlementId: resId2, method: 'Bank transfer' });
    await callAs(disputeWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { settlementId: resId2, reason: 'Never received this transfer' });
    const snap = await settleRef2.get();
    assert.equal(snap.data().status, 'DISPUTED');
    assert.equal(snap.data().disputeReason, 'Never received this transfer');
    assert.equal(snap.data().paymentMethod, 'Bank transfer'); // history preserved, not wiped
  });
  await test('an agency cannot resolve her own dispute (admin-only)', async () => {
    await expectCode(callAs(resolveDisputeWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { settlementId: resId2, resolution: 'RECEIVED' }), 'permission-denied');
  });
  await test('admin resolves the dispute as RECEIVED', async () => {
    const result = await callAs(resolveDisputeWrapped, 'admin-uid', ADMIN_EMAIL, { settlementId: resId2, resolution: 'RECEIVED' });
    assert.equal(result.status, 'RECEIVED');
  });
  await test('an invalid resolution value is rejected', async () => {
    await db.collection('room_availability').doc('VR04').set({ bookings: [] });
    await db.collection('agency_quotes').doc('VQ-J-2B').set({ quoteId: 'VQ-J-2B', agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL, status: 'FINALIZED' });
    await db.collection('agency_booking_requests').doc('ABR-J-2B').set(baseBookingRequest({ id: 'ABR-J-2B', quoteId: 'VQ-J-2B', quoteReference: 'VQ-J-2B', requestedRoomId: 'VR04' }));
    const r = await callAs(confirmWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: 'ABR-J-2B' });
    await eligibilityWrapped(docEvent(r.reservationId, { status: 'Confirmed', agencyId: AGENCY_A_UID }, { status: 'Checked in', agencyId: AGENCY_A_UID }));
    await callAs(markSentWrapped, 'admin-uid', ADMIN_EMAIL, { settlementId: r.reservationId, method: 'Cash' });
    await callAs(disputeWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { settlementId: r.reservationId, reason: 'test' });
    await expectCode(callAs(resolveDisputeWrapped, 'admin-uid', ADMIN_EMAIL, { settlementId: r.reservationId, resolution: 'BOGUS' }), 'invalid-argument');
  });

  section('Part J-11: AGENCY_TO_HOTEL flow -- agency marks sent, admin confirms received');
  let resId3, settleRef3;
  await test('confirm an AGENCY_TO_HOTEL booking, check in, agency marks payment sent to Vilu', async () => {
    await db.collection('room_availability').doc('VR05').set({ bookings: [] });
    await db.collection('agency_quotes').doc('VQ-J-3').set({ quoteId: 'VQ-J-3', agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL, status: 'FINALIZED' });
    await db.collection('agency_booking_requests').doc('ABR-J-3').set(baseBookingRequest({
      id: 'ABR-J-3', quoteId: 'VQ-J-3', quoteReference: 'VQ-J-3', requestedRoomId: 'VR05', paymentCollector: 'AGENCY',
    }));
    const result = await callAs(confirmWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: 'ABR-J-3' });
    resId3 = result.reservationId;
    settleRef3 = db.collection('agency_settlements').doc(resId3);
    const snap0 = await settleRef3.get();
    assert.equal(snap0.data().direction, 'AGENCY_TO_HOTEL');
    assert.equal(snap0.data().amountDue, 400); // viluNetTotal
    await eligibilityWrapped(docEvent(resId3, { status: 'Confirmed', agencyId: AGENCY_A_UID }, { status: 'Checked in', agencyId: AGENCY_A_UID }));
  });
  await test('admin/staff CANNOT mark payment sent for an AGENCY_TO_HOTEL settlement (that is the agency\'s action)', async () => {
    await expectCode(callAs(markSentWrapped, 'admin-uid', ADMIN_EMAIL, { settlementId: resId3, method: 'Bank transfer' }), 'permission-denied');
  });
  await test('Agency B cannot mark payment sent on Agency A\'s AGENCY_TO_HOTEL settlement', async () => {
    await expectCode(callAs(markSentWrapped, AGENCY_B_UID, AGENCY_B_EMAIL, { settlementId: resId3, method: 'Bank transfer' }), 'permission-denied');
  });
  await test('Agency A marks payment sent to Vilu -> PAYMENT_SENT, paymentInitiatedBy AGENCY', async () => {
    const result = await callAs(markSentWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { settlementId: resId3, method: 'Bank transfer', reference: 'AG-TXN-1' });
    assert.equal(result.status, 'PAYMENT_SENT');
    const snap = await settleRef3.get();
    assert.equal(snap.data().paymentInitiatedBy, 'AGENCY');
  });
  await test('the agency herself cannot confirm her own AGENCY_TO_HOTEL payment as received (only Vilu/staff can)', async () => {
    await expectCode(callAs(confirmReceivedWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { settlementId: resId3 }), 'permission-denied');
  });
  await test('admin confirms receipt -> RECEIVED, receivedConfirmedByAgency false', async () => {
    const result = await callAs(confirmReceivedWrapped, 'admin-uid', ADMIN_EMAIL, { settlementId: resId3 });
    assert.equal(result.status, 'RECEIVED');
    const snap = await settleRef3.get();
    assert.equal(snap.data().receivedConfirmedByAgency, false);
  });

  section('Part J-16: cross-agency security + amount/status-jump tampering');
  await test('Agency B cannot directly read Agency A\'s settlement', async () => {
    const testEnv = await initializeTestEnvironment({ projectId: 'vilu-residence-settlements-rules-test', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection('users').doc(AGENCY_B_EMAIL).set({ email: AGENCY_B_EMAIL, role: 'agency' });
      await ctx.firestore().collection('agency_settlements').doc('SETTLE-B-1').set({ settlementId: 'SETTLE-B-1', agencyId: AGENCY_B_UID, amountDue: 999 });
    });
    const agencyA = testEnv.authenticatedContext(AGENCY_A_UID, { email: AGENCY_A_EMAIL });
    await assertFails(agencyA.firestore().collection('agency_settlements').doc('SETTLE-B-1').get());
    await test('Agency A cannot directly create a settlement document at all', async () => {
      await assertFails(agencyA.firestore().collection('agency_settlements').doc('FAKE-1').set({ settlementId: 'FAKE-1', agencyId: AGENCY_A_UID, amountDue: 99999, status: 'RECEIVED' }));
    });
    await test('Agency A cannot directly edit her own settlement\'s amountDue via a client update', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => { await ctx.firestore().collection('agency_settlements').doc('SETTLE-A-EXIST').set({ settlementId: 'SETTLE-A-EXIST', agencyId: AGENCY_A_UID, amountDue: 200, status: 'PAYABLE' }); });
      await assertFails(agencyA.firestore().collection('agency_settlements').doc('SETTLE-A-EXIST').set({ amountDue: 99999 }, { merge: true }));
    });
    await testEnv.cleanup();
  });
  await test('confirming receipt on an already-RECEIVED settlement is rejected (no arbitrary status jump)', async () => {
    await expectCode(callAs(confirmReceivedWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { settlementId: resId1 }), 'failed-precondition');
  });
  await test('marking payment sent on a NOT_YET_PAYABLE settlement (not yet checked in) is rejected', async () => {
    await db.collection('room_availability').doc('VR06').set({ bookings: [] });
    await db.collection('agency_quotes').doc('VQ-J-NOTYET').set({ quoteId: 'VQ-J-NOTYET', agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL, status: 'FINALIZED' });
    await db.collection('agency_booking_requests').doc('ABR-J-NOTYET').set(baseBookingRequest({ id: 'ABR-J-NOTYET', quoteId: 'VQ-J-NOTYET', quoteReference: 'VQ-J-NOTYET', requestedRoomId: 'VR06' }));
    const r = await callAs(confirmWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: 'ABR-J-NOTYET' });
    await expectCode(callAs(markSentWrapped, 'admin-uid', ADMIN_EMAIL, { settlementId: r.reservationId, method: 'Cash' }), 'failed-precondition');
  });

  section('Part J-20: settlement amounts stay fixed even if the source quote\'s live fields were somehow altered later');
  await test('the settlement doc\'s viluNetTotal/agencyGuestSellingTotal/agencyEarnings are exactly what was true at confirmation time, unaffected by later unrelated writes', async () => {
    const snap = await settleRef1.get();
    assert.equal(snap.data().viluNetTotal, 400);
    assert.equal(snap.data().agencyGuestSellingTotal, 600);
    assert.equal(snap.data().agencyEarnings, 200);
    // The quote itself is FINALIZED and immutable (Phase A/C rule,
    // unrelated to this phase) -- nothing in Phase J re-reads it after
    // settlement creation, confirmed structurally in agency-settlements.test.js.
  });

  section('Part J-22/23: reconciliation -- dry run preview, real run creates only what\'s missing, incomplete data flagged not fabricated');
  await test('a manually-created legacy agency reservation missing the price snapshot is found by dry-run and, on real run, gets DATA_INCOMPLETE (never a guessed amount)', async () => {
    await db.collection('reservations').doc('LEGACY-AG-1').set({
      id: 'LEGACY-AG-1', room_id: 'VR01', guest_name: 'Legacy Guest', check_in: '2025-01-01', check_out: '2025-01-03',
      status: 'Checked out', source: 'Agency', agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL, agencyName: 'Agency A',
      // no paymentCollector/viluNetTotal/agencyGuestSellingTotal/agencyEarnings -- genuinely incomplete historical data
    });
    const preview = await callAs(reconcileWrapped, 'admin-uid', ADMIN_EMAIL, { dryRun: true });
    assert.ok(preview.missing.some((m) => m.reservationId === 'LEGACY-AG-1'));
    const beforeSnap = await db.collection('agency_settlements').doc('LEGACY-AG-1').get();
    assert.equal(beforeSnap.exists, false, 'dry run must not write anything');

    const real = await callAs(reconcileWrapped, 'admin-uid', ADMIN_EMAIL, { dryRun: false });
    assert.ok(real.count >= 1);
    const afterSnap = await db.collection('agency_settlements').doc('LEGACY-AG-1').get();
    assert.equal(afterSnap.data().status, 'DATA_INCOMPLETE');
    assert.equal(afterSnap.data().amountDue, null);
  });
  await test('running reconciliation again does not duplicate or overwrite the settlement just created', async () => {
    const before = await db.collection('agency_settlements').doc('LEGACY-AG-1').get();
    await callAs(reconcileWrapped, 'admin-uid', ADMIN_EMAIL, { dryRun: false });
    const after = await db.collection('agency_settlements').doc('LEGACY-AG-1').get();
    assert.deepEqual(after.data(), before.data());
  });
  await test('a non-staff caller cannot run reconciliation', async () => {
    await expectCode(callAs(reconcileWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { dryRun: true }), 'permission-denied');
  });

  section('Part J-27 (partial): full regression -- confirm no reservation/hold/availability side effects from settlement actions');
  await test('exactly this file\'s own 6 confirmWrapped-created reservations plus the 1 manually-seeded legacy reservation exist -- no settlement action (mark sent/confirm received/dispute/resolve/reconcile) created an extra one', async () => {
    const resCount = (await db.collection('reservations').where('agencyId', '==', AGENCY_A_UID).get()).size;
    assert.equal(resCount, resCountAtStart + 7, 'expected exactly 7 new reservations (6 via confirmWrapped + 1 manually-seeded LEGACY-AG-1) attributable to this file, got a delta of ' + (resCount - resCountAtStart));
  });

  functionsTest.cleanup();
  console.log(`\n${passed}/${passed + failed} agency-settlements-rules (emulator + Cloud Functions) assertions passed`);
  if (failed > 0) process.exitCode = 1;
})().catch((e) => {
  console.error('agency-settlements-rules.test.js crashed:', e);
  process.exitCode = 1;
});
