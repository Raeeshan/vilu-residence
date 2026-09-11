// Agency Sales Workflow — Phase E: Temporary Room Hold, proven for real
// against the Firestore emulator + the actual Cloud Functions (via
// firebase-functions-test), same pattern as Phases C/D.
//
// Run via:
//   firebase emulators:exec --only firestore "node test/agency-hold-requests-rules.test.js"
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

function baseHoldRequest(overrides) {
  return Object.assign({
    id: 'BR-000001', requestType: 'AGENCY_HOLD',
    agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL, agencyName: 'Agency A',
    quoteId: null, quoteReference: null,
    guestName: 'QA Guest', roomId: 'VR01', roomCategory: 'Deluxe Family Room',
    arrivalDate: '2027-04-01', departureDate: '2027-04-03',
    requestedHoldHours: 24, requestedHoldUntil: null,
    status: 'PENDING',
    approvedAt: null, approvedBy: null, approvedHoldUntil: null, blockId: null,
    createdAt: '2026-09-11T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z',
  }, overrides || {});
}

(async () => {
  // ── PART 1: firestore.rules -- create-time anti-spoofing + ownership ──
  const testEnv = await initializeTestEnvironment({
    projectId: 'vilu-residence-rules-test',
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
  });
  const agencyA = testEnv.authenticatedContext(AGENCY_A_UID, { email: AGENCY_A_EMAIL });
  const agencyB = testEnv.authenticatedContext(AGENCY_B_UID, { email: AGENCY_B_EMAIL });
  const admin = testEnv.authenticatedContext('admin-uid', { email: ADMIN_EMAIL });

  section('firestore.rules: Part 29 -- agency create/read/update/delete boundaries');
  await test('Agency A can create her own PENDING hold request', async () => {
    await assertSucceeds(agencyA.firestore().collection('block_requests').doc('BR-A1').set(baseHoldRequest({ id: 'BR-A1' })));
  });
  await test('Agency A CANNOT spoof agencyId to Agency B\'s uid', async () => {
    await assertFails(agencyA.firestore().collection('block_requests').doc('BR-SPOOF').set(baseHoldRequest({ id: 'BR-SPOOF', agencyId: AGENCY_B_UID })));
  });
  await test('Agency A CANNOT self-create a request that already claims status:APPROVED', async () => {
    await assertFails(agencyA.firestore().collection('block_requests').doc('BR-FAKE1').set(baseHoldRequest({ id: 'BR-FAKE1', status: 'APPROVED' })));
  });
  await test('Agency A CANNOT self-create a request with a fabricated blockId', async () => {
    await assertFails(agencyA.firestore().collection('block_requests').doc('BR-FAKE2').set(baseHoldRequest({ id: 'BR-FAKE2', blockId: 'BL-FAKE' })));
  });
  await test('Agency A CANNOT self-create a request with fabricated approvedAt/approvedBy/approvedHoldUntil', async () => {
    await assertFails(agencyA.firestore().collection('block_requests').doc('BR-FAKE3').set(baseHoldRequest({ id: 'BR-FAKE3', approvedAt: '2026-01-01T00:00:00.000Z', approvedBy: 'admin@fake.com', approvedHoldUntil: '2099-01-01T00:00:00.000Z' })));
  });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('block_requests').doc('BR-A-SEED').set(baseHoldRequest({ id: 'BR-A-SEED' }));
    await ctx.firestore().collection('block_requests').doc('BR-B-SEED').set(baseHoldRequest({ id: 'BR-B-SEED', agencyId: AGENCY_B_UID, agencyEmail: AGENCY_B_EMAIL, agencyName: 'Agency B', guestName: 'Agency B Guest' }));
  });

  await test('Agency A CANNOT read Agency B\'s hold request', async () => {
    await assertFails(agencyA.firestore().collection('block_requests').doc('BR-B-SEED').get());
  });
  await test('Agency A CAN read her own hold request', async () => {
    await assertSucceeds(agencyA.firestore().collection('block_requests').doc('BR-A-SEED').get());
  });
  await test('Agency A CANNOT approve her own request directly (update is admin/staff/manager only)', async () => {
    await assertFails(agencyA.firestore().collection('block_requests').doc('BR-A-SEED').set(
      baseHoldRequest({ id: 'BR-A-SEED', status: 'APPROVED', approvedHoldUntil: '2099-01-01T00:00:00.000Z', blockId: 'BL-SELF' }), { merge: true }
    ));
  });
  await test('Agency A CANNOT extend/alter her own request in any way after creation (no self-cancel/self-edit path exists)', async () => {
    await assertFails(agencyA.firestore().collection('block_requests').doc('BR-A-SEED').set(
      baseHoldRequest({ id: 'BR-A-SEED', guestName: 'Edited Name' }), { merge: true }
    ));
  });
  await test('Agency A CANNOT delete her own request', async () => {
    await assertFails(agencyA.firestore().collection('block_requests').doc('BR-A-SEED').delete());
  });
  await test('Admin CAN update any hold request (the trusted path Cloud Functions use, via the Admin SDK, bypasses this anyway)', async () => {
    await assertSucceeds(admin.firestore().collection('block_requests').doc('BR-A-SEED').set({ status: 'REJECTED' }, { merge: true }));
  });

  await testEnv.cleanup();
  console.log(`\n${passed}/${passed + failed} rules-only assertions passed so far`);

  // ── PART 2: the actual Cloud Functions, run for real ──
  section('Cloud Functions: approve/reject/release/expire (real Firestore emulator)');
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  process.env.GCLOUD_PROJECT = 'vilu-residence';
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'vilu-residence' });

  const functionsTest = require('firebase-functions-test')({ projectId: 'vilu-residence' });
  const myFunctions = require('../functions-core/index.js');
  const path = require('node:path');
  const firebaseAdminFirestorePath = require.resolve('firebase-admin/firestore', { paths: [path.join(__dirname, '..', 'functions-core')] });
  const { getFirestore } = require(firebaseAdminFirestorePath);
  const db = getFirestore();

  const approveWrapped = functionsTest.wrap(myFunctions.approveAgencyHoldRequest);
  const rejectWrapped = functionsTest.wrap(myFunctions.rejectAgencyHoldRequest);
  const releaseWrapped = functionsTest.wrap(myFunctions.releaseAgencyHoldRequest);
  const expireWrapped = functionsTest.wrap(myFunctions.expireAgencyHoldRequests);

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

  section('Part 26: availability race -- approval rechecks and fails cleanly if the room was taken meanwhile');
  await test('Agency A requests a hold for a free room; before approval another reservation lands there; approve is rejected, no block created, request stays PENDING', async () => {
    await db.collection('room_availability').doc('VR01').set({ bookings: [] });
    const reqId = 'BR-RACE-1';
    await db.collection('block_requests').doc(reqId).set(baseHoldRequest({ id: reqId, roomId: 'VR01', arrivalDate: '2027-05-01', departureDate: '2027-05-04' }));
    // Someone else books VR01 for an overlapping range in the meantime.
    await db.collection('room_availability').doc('VR01').set({ bookings: [{ id: 'RES-RACE', from: '2027-05-02', to: '2027-05-05' }] });

    const result = await callAs(approveWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: reqId });
    assert.equal(result.availabilityChanged, true);

    const reqSnap = await db.collection('block_requests').doc(reqId).get();
    assert.equal(reqSnap.data().status, 'PENDING'); // unchanged
    assert.equal(reqSnap.data().blockId, null);
    const blocksSnap = await db.collection('blocks').where('room_id', '==', 'VR01').get();
    assert.equal(blocksSnap.size, 0); // no block was created
  });

  section('Approval (happy path): creates a real block, sets approvedHoldUntil/blockId, generic reason');
  let approvedReqId, approvedBlockId;
  await test('Agency A requests a hold for a genuinely free room; admin approves; a real block is created with reason "Agency Hold" (never agency/guest identity)', async () => {
    await db.collection('room_availability').doc('VR02').set({ bookings: [] });
    approvedReqId = 'BR-APPROVE-1';
    await db.collection('block_requests').doc(approvedReqId).set(baseHoldRequest({
      id: approvedReqId, roomId: 'VR02', guestName: 'Approve Test Guest', arrivalDate: '2027-05-10', departureDate: '2027-05-12',
    }));
    const result = await callAs(approveWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: approvedReqId });
    assert.ok(result.approvedHoldUntil);
    assert.ok(result.blockId);
    approvedBlockId = result.blockId;

    const reqSnap = await db.collection('block_requests').doc(approvedReqId).get();
    assert.equal(reqSnap.data().status, 'APPROVED');
    assert.equal(reqSnap.data().blockId, approvedBlockId);
    assert.equal(reqSnap.data().approvedBy, ADMIN_EMAIL);

    const blockSnap = await db.collection('blocks').doc(approvedBlockId).get();
    assert.ok(blockSnap.exists);
    assert.equal(blockSnap.data().reason, 'Agency Hold');
    assert.doesNotMatch(JSON.stringify(blockSnap.data()), /Approve Test Guest|Agency A/);
  });
  await test('approvedHoldUntil is computed from the GLOBAL defaultHoldHours (24h), not the client-requested value', async () => {
    const reqSnap = await db.collection('block_requests').doc(approvedReqId).get();
    const approvedAt = new Date(reqSnap.data().approvedAt).getTime();
    const holdUntil = new Date(reqSnap.data().approvedHoldUntil).getTime();
    const hoursDiff = (holdUntil - approvedAt) / 3600000;
    assert.ok(Math.abs(hoursDiff - 24) < 0.01, 'expected ~24h hold, got ' + hoursDiff + 'h');
  });

  section('Rejection: no block created');
  await test('rejecting a PENDING request sets REJECTED and creates no block', async () => {
    await db.collection('room_availability').doc('VR03').set({ bookings: [] });
    const reqId = 'BR-REJECT-1';
    await db.collection('block_requests').doc(reqId).set(baseHoldRequest({ id: reqId, roomId: 'VR03' }));
    await callAs(rejectWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: reqId });
    const reqSnap = await db.collection('block_requests').doc(reqId).get();
    assert.equal(reqSnap.data().status, 'REJECTED');
    const blocksSnap = await db.collection('blocks').where('room_id', '==', 'VR03').get();
    assert.equal(blocksSnap.size, 0);
  });

  section('Manual release: releases the block, preserves history (CANCELLED, not deleted)');
  await test('releasing an APPROVED hold deletes its block and marks CANCELLED, the request document itself is preserved', async () => {
    const result = await callAs(releaseWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: approvedReqId });
    assert.equal(result.status, 'CANCELLED');
    const reqSnap = await db.collection('block_requests').doc(approvedReqId).get();
    assert.ok(reqSnap.exists, 'the request document must still exist (audit history preserved)');
    assert.equal(reqSnap.data().status, 'CANCELLED');
    const blockSnap = await db.collection('blocks').doc(approvedBlockId).get();
    assert.equal(blockSnap.exists, false);
  });

  section('Part 27: scheduled expiry -- idempotent, runs twice safely');
  let expireReqId, expireBlockId;
  await test('an APPROVED hold whose approvedHoldUntil is already in the past gets released by the sweep', async () => {
    await db.collection('room_availability').doc('VR04').set({ bookings: [] });
    expireReqId = 'BR-EXPIRE-1';
    expireBlockId = 'BL-EXPIRE-TEST';
    const pastIso = new Date(Date.now() - 3600000).toISOString(); // 1h ago
    await db.collection('blocks').doc(expireBlockId).set({ id: expireBlockId, room_id: 'VR04', from_date: '2027-06-01', to_date: '2027-06-03', reason: 'Agency Hold' });
    await db.collection('block_requests').doc(expireReqId).set(baseHoldRequest({
      id: expireReqId, roomId: 'VR04', status: 'APPROVED', approvedAt: pastIso, approvedBy: ADMIN_EMAIL, approvedHoldUntil: pastIso, blockId: expireBlockId,
    }));
    await expireWrapped({});
    const reqSnap = await db.collection('block_requests').doc(expireReqId).get();
    assert.equal(reqSnap.data().status, 'EXPIRED');
    const blockSnap = await db.collection('blocks').doc(expireBlockId).get();
    assert.equal(blockSnap.exists, false);
  });
  await test('running the sweep AGAIN on the same (already-EXPIRED) request is a safe no-op -- no error, no duplicate side effects', async () => {
    await assert.doesNotReject(expireWrapped({}));
    const reqSnap = await db.collection('block_requests').doc(expireReqId).get();
    assert.equal(reqSnap.data().status, 'EXPIRED'); // still EXPIRED, unchanged
  });
  await test('a hold whose approvedHoldUntil is still in the future is left untouched by the sweep', async () => {
    await db.collection('room_availability').doc('VR05').set({ bookings: [] });
    const futureReqId = 'BR-FUTURE-1', futureBlockId = 'BL-FUTURE-TEST';
    const futureIso = new Date(Date.now() + 3600000 * 48).toISOString();
    await db.collection('blocks').doc(futureBlockId).set({ id: futureBlockId, room_id: 'VR05', from_date: '2027-07-01', to_date: '2027-07-03', reason: 'Agency Hold' });
    await db.collection('block_requests').doc(futureReqId).set(baseHoldRequest({
      id: futureReqId, roomId: 'VR05', status: 'APPROVED', approvedHoldUntil: futureIso, blockId: futureBlockId,
    }));
    await expireWrapped({});
    const reqSnap = await db.collection('block_requests').doc(futureReqId).get();
    assert.equal(reqSnap.data().status, 'APPROVED'); // untouched
    const blockSnap = await db.collection('blocks').doc(futureBlockId).get();
    assert.equal(blockSnap.exists, true); // still there
  });

  section('Part 30/31: authorization adversarial checks on the Cloud Functions themselves');
  await test('an agency caller cannot call approveAgencyHoldRequest at all', async () => {
    const reqId = 'BR-AGENCY-TRY-APPROVE';
    await db.collection('block_requests').doc(reqId).set(baseHoldRequest({ id: reqId, roomId: 'VR06' }));
    await expectCode(callAs(approveWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { requestId: reqId }), 'permission-denied');
  });
  await test('a staff caller CAN call approveAgencyHoldRequest (staff-like, not admin-only)', async () => {
    await db.collection('room_availability').doc('VR06').set({ bookings: [] });
    const reqId = 'BR-STAFF-APPROVE';
    await db.collection('block_requests').doc(reqId).set(baseHoldRequest({ id: reqId, roomId: 'VR06' }));
    const result = await callAs(approveWrapped, 'staff-uid', 'staffer@example.com', { requestId: reqId });
    assert.ok(result.blockId);
  });
  await test('an unauthenticated caller cannot call approveAgencyHoldRequest', async () => {
    const reqId = 'BR-ANON-TRY';
    await db.collection('block_requests').doc(reqId).set(baseHoldRequest({ id: reqId, roomId: 'VR01' }));
    try {
      await approveWrapped({ data: { requestId: reqId } });
      assert.fail('expected rejection for no auth context');
    } catch (e) {
      assert.equal(e.code, 'unauthenticated');
    }
  });
  await test('approving an already-decided request is rejected (failed-precondition), not silently re-approved', async () => {
    await expectCode(callAs(approveWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: expireReqId }), 'failed-precondition');
  });
  await test('approving a non-AGENCY_HOLD (legacy-shape) block_request is rejected', async () => {
    const legacyId = 'BR-LEGACY-1';
    await db.collection('block_requests').doc(legacyId).set({ id: legacyId, agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL, agencyName: 'Agency A', rooms: ['VR01'], ci: '2027-08-01', co: '2027-08-03', note: '', status: 'pending', createdAt: new Date().toISOString(), decidedAt: null, decidedBy: null });
    await expectCode(callAs(approveWrapped, 'admin-uid', ADMIN_EMAIL, { requestId: legacyId }), 'failed-precondition');
  });

  section('Part 28: privacy -- Agency A cannot glean Agency B\'s hold details via the functions either');
  await test('Agency B\'s hold request details never leak through any of these functions\' return values to Agency A (the functions never take a foreign agency\'s requestId and hand back data -- the caller must already own the request via the same requestId-lookup, and role checks block agency callers from these functions entirely)', async () => {
    // Already proven structurally: agency callers get permission-denied
    // before any data lookup happens (see the "agency caller cannot call
    // approveAgencyHoldRequest" test above) -- reconfirm the read-rule
    // boundary (Part 28's calendar-level concern) is unaffected by anything
    // in this phase, using the emulator's own rules re-check.
    const testEnv2 = await initializeTestEnvironment({ projectId: 'vilu-residence-rules-test-2', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } });
    const a2 = testEnv2.authenticatedContext(AGENCY_A_UID, { email: AGENCY_A_EMAIL });
    await testEnv2.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection('block_requests').doc('BR-B-PRIVACY').set(baseHoldRequest({ id: 'BR-B-PRIVACY', agencyId: AGENCY_B_UID, agencyEmail: AGENCY_B_EMAIL, agencyName: 'Agency B', guestName: 'Agency B Private Guest' }));
    });
    await assertFails(a2.firestore().collection('block_requests').doc('BR-B-PRIVACY').get());
    await testEnv2.cleanup();
  });

  functionsTest.cleanup();

  console.log(`\n${passed}/${passed + failed} agency-hold-requests-rules (emulator + Cloud Functions) assertions passed`);
  if (failed > 0) process.exitCode = 1;
})().catch((e) => {
  console.error('agency-hold-requests-rules.test.js crashed:', e);
  process.exitCode = 1;
});
