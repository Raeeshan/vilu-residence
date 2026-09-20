// Calendar / Block Rooms — "block-over-block should merge, not hard-reject"
// fix. Proven for real against the Firestore emulator + the actual Cloud
// Function (via firebase-functions-test), same pattern as
// test/agency-hold-requests-rules.test.js.
//
// Run via:
//   firebase emulators:exec --only firestore "node test/block-merge-rules.test.js"
const assert = require('node:assert/strict');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}

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

  const mergeWrapped = functionsTest.wrap(myFunctions.mergeBlockRoom);
  const availabilityOnBlockWrapped = functionsTest.wrap(myFunctions.availabilityOnBlock);

  // The Functions emulator (needed for real Firestore-event delivery to
  // onDocumentWritten triggers) fails to load in this environment (node
  // version mismatch, unrelated to this fix) -- same limitation already
  // accepted by test/agency-settlements-rules.test.js. Its own fix applies
  // here too: invoke the real exported trigger directly against the actual
  // before/after document states mergeBlockRoom produced, via
  // functionsTest.makeChange (a real Change instance -- see that file's own
  // comment for why a plain {before,after} object breaks the v2 wrapper).
  function docEvent(id, beforeData, afterData) {
    const before = { exists: !!beforeData, data: () => beforeData };
    const after = { exists: !!afterData, data: () => afterData };
    return { data: functionsTest.makeChange(before, after), params: { id } };
  }

  function callAs(fn, uid, email, data) {
    return fn({ data, auth: { uid, token: { email } } });
  }
  function callUnauth(fn, data) {
    return fn({ data, auth: null });
  }
  async function expectCode(promise, expectedCode) {
    try {
      await promise;
      assert.fail('expected the call to be rejected with code ' + expectedCode + ', but it succeeded');
    } catch (e) {
      assert.equal(e.code, expectedCode, 'wrong error code: got "' + e.code + '" ("' + e.message + '")');
    }
  }
  async function seedRoom(roomId, bookings) {
    await db.collection('room_availability').doc(roomId).set({ bookings: bookings || [] });
    const existing = await db.collection('blocks').where('room_id', '==', roomId).get();
    const batch = db.batch();
    existing.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  async function seedBlock(id, roomId, from, to, reason, notes) {
    const doc = { id, room_id: roomId, from_date: from, to_date: to, reason: reason || 'Cloudbeds Blocked Dates — migrated inventory' };
    if (notes) doc.notes = notes;
    await db.collection('blocks').doc(id).set(doc);
  }
  async function blocksOn(roomId) {
    const snap = await db.collection('blocks').where('room_id', '==', roomId).get();
    return snap.docs.map((d) => d.data()).sort((a, b) => (a.from_date < b.from_date ? -1 : 1));
  }

  await db.collection('users').doc('staffer@example.com').set({ email: 'staffer@example.com', role: 'staff' });
  await db.collection('users').doc('agency-a@example.com').set({ email: 'agency-a@example.com', role: 'agency' });

  section('Auth boundary');
  await test('unauthenticated caller cannot call mergeBlockRoom', async () => {
    await seedRoom('VR01');
    await expectCode(callUnauth(mergeWrapped, { room_id: 'VR01', from_date: '2027-01-01', to_date: '2027-01-03' }), 'unauthenticated');
  });
  await test('an agency caller cannot call mergeBlockRoom', async () => {
    await expectCode(callAs(mergeWrapped, 'agency-a-uid', 'agency-a@example.com', { room_id: 'VR01', from_date: '2027-01-01', to_date: '2027-01-03' }), 'permission-denied');
  });
  await test('a staff caller CAN call mergeBlockRoom (staff-like, not admin-only)', async () => {
    await seedRoom('VR01');
    const r = await callAs(mergeWrapped, 'staff-uid', 'staffer@example.com', { room_id: 'VR01', from_date: '2027-01-01', to_date: '2027-01-03' });
    assert.ok(r.blockId);
  });

  section('Input validation');
  await test('invalid room_id is rejected', async () => {
    await expectCode(callAs(mergeWrapped, 'admin-uid', ADMIN_EMAIL, { room_id: 'VR99', from_date: '2027-01-01', to_date: '2027-01-03' }), 'invalid-argument');
  });
  await test('to_date before/equal from_date is rejected', async () => {
    await expectCode(callAs(mergeWrapped, 'admin-uid', ADMIN_EMAIL, { room_id: 'VR01', from_date: '2027-01-05', to_date: '2027-01-03' }), 'invalid-argument');
    await expectCode(callAs(mergeWrapped, 'admin-uid', ADMIN_EMAIL, { room_id: 'VR01', from_date: '2027-01-05', to_date: '2027-01-05' }), 'invalid-argument');
  });

  section('1. Fresh block on completely free dates');
  await test('creates a brand-new block doc, correct fields, no merge', async () => {
    await seedRoom('VR02');
    const r = await callAs(mergeWrapped, 'admin-uid', ADMIN_EMAIL, { room_id: 'VR02', from_date: '2027-02-01', to_date: '2027-02-05', reason: 'Maintenance' });
    assert.equal(r.wasMerge, false);
    assert.equal(r.from_date, '2027-02-01');
    assert.equal(r.to_date, '2027-02-05');
    const blocks = await blocksOn('VR02');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].reason, 'Maintenance');
  });

  section('2. Block overlaps a Confirmed reservation -> rejected');
  await test('rejects with RESERVATION_CONFLICT and creates no block', async () => {
    await seedRoom('VR03', [{ id: 'RES-1', from: '2027-03-05', to: '2027-03-10' }]);
    await expectCode(callAs(mergeWrapped, 'admin-uid', ADMIN_EMAIL, { room_id: 'VR03', from_date: '2027-03-01', to_date: '2027-03-07' }), 'failed-precondition');
    const blocks = await blocksOn('VR03');
    assert.equal(blocks.length, 0);
  });
  await test('the rejection message names the exact conflicting reservation', async () => {
    try {
      await callAs(mergeWrapped, 'admin-uid', ADMIN_EMAIL, { room_id: 'VR03', from_date: '2027-03-01', to_date: '2027-03-07' });
      assert.fail('expected rejection');
    } catch (e) {
      assert.match(e.message, /RESERVATION_CONFLICT/);
      assert.match(e.message, /RES-1/);
      assert.match(e.message, /2027-03-05/);
    }
  });

  section('3. New block overlaps existing block on the LEFT edge');
  await test('merges into one interval spanning both', async () => {
    await seedRoom('VR04');
    await seedBlock('BL-L1', 'VR04', '2027-04-10', '2027-04-20', 'Cloudbeds Blocked Dates — migrated inventory');
    const r = await callAs(mergeWrapped, 'admin-uid', ADMIN_EMAIL, { room_id: 'VR04', from_date: '2027-04-05', to_date: '2027-04-15' });
    assert.equal(r.wasMerge, true);
    assert.equal(r.from_date, '2027-04-05');
    assert.equal(r.to_date, '2027-04-20');
    const blocks = await blocksOn('VR04');
    assert.equal(blocks.length, 1);
  });

  section('4. New block overlaps existing block on the RIGHT edge');
  await test('merges into one interval spanning both', async () => {
    await seedRoom('VR05');
    await seedBlock('BL-R1', 'VR05', '2027-05-10', '2027-05-20');
    const r = await callAs(mergeWrapped, 'admin-uid', ADMIN_EMAIL, { room_id: 'VR05', from_date: '2027-05-15', to_date: '2027-05-25' });
    assert.equal(r.from_date, '2027-05-10');
    assert.equal(r.to_date, '2027-05-25');
    const blocks = await blocksOn('VR05');
    assert.equal(blocks.length, 1);
  });

  section('5. New block fully CONTAINS an existing block');
  await test('the survivor becomes the wider requested range', async () => {
    await seedRoom('VR06');
    await seedBlock('BL-C1', 'VR06', '2027-06-10', '2027-06-12');
    const r = await callAs(mergeWrapped, 'admin-uid', ADMIN_EMAIL, { room_id: 'VR06', from_date: '2027-06-01', to_date: '2027-06-20' });
    assert.equal(r.from_date, '2027-06-01');
    assert.equal(r.to_date, '2027-06-20');
    const blocks = await blocksOn('VR06');
    assert.equal(blocks.length, 1);
  });

  section('6. New block fully CONTAINED inside an existing block');
  await test('the existing wider range is preserved, no shrinkage, no duplicate', async () => {
    await seedRoom('VR01');
    await seedBlock('BL-W1', 'VR01', '2027-07-01', '2027-07-31');
    const r = await callAs(mergeWrapped, 'admin-uid', ADMIN_EMAIL, { room_id: 'VR01', from_date: '2027-07-10', to_date: '2027-07-15' });
    assert.equal(r.from_date, '2027-07-01');
    assert.equal(r.to_date, '2027-07-31');
    const blocks = await blocksOn('VR01');
    assert.equal(blocks.length, 1);
  });

  section('7. New block TOUCHES an existing block exactly at the boundary (checkout-exclusive)');
  await test('a block ending exactly where another starts is treated as contiguous and merges', async () => {
    await seedRoom('VR02');
    await seedBlock('BL-T1', 'VR02', '2027-08-10', '2027-08-20');
    const r = await callAs(mergeWrapped, 'admin-uid', ADMIN_EMAIL, { room_id: 'VR02', from_date: '2027-08-01', to_date: '2027-08-10' });
    assert.equal(r.from_date, '2027-08-01');
    assert.equal(r.to_date, '2027-08-20');
    const blocks = await blocksOn('VR02');
    assert.equal(blocks.length, 1);
  });
  await test('a genuine one-night GAP between two blocks does NOT merge them', async () => {
    await seedRoom('VR03');
    await seedBlock('BL-G1', 'VR03', '2027-08-25', '2027-08-28');
    const r = await callAs(mergeWrapped, 'admin-uid', ADMIN_EMAIL, { room_id: 'VR03', from_date: '2027-08-10', to_date: '2027-08-15' });
    assert.equal(r.wasMerge, false);
    const blocks = await blocksOn('VR03');
    assert.equal(blocks.length, 2, 'the two blocks must stay separate across the real gap');
  });

  section('8. New block JOINS two separated-but-now-touching blocks');
  await test('a new range spanning the gap between two existing blocks collapses all three into one', async () => {
    await seedRoom('VR04');
    await seedBlock('BL-J1', 'VR04', '2027-09-01', '2027-09-05');
    await seedBlock('BL-J2', 'VR04', '2027-09-10', '2027-09-15');
    const r = await callAs(mergeWrapped, 'admin-uid', ADMIN_EMAIL, { room_id: 'VR04', from_date: '2027-09-05', to_date: '2027-09-10' });
    assert.equal(r.from_date, '2027-09-01');
    assert.equal(r.to_date, '2027-09-15');
    assert.equal(r.mergedBlockIds.length, 2);
    const blocks = await blocksOn('VR04');
    assert.equal(blocks.length, 1, 'exactly one surviving block after the 3-way collapse');
  });

  section('9. Multiple overlapping blocks collapse correctly (3+)');
  await test('three overlapping/adjacent existing blocks + one new range collapse into a single final interval, no orphans', async () => {
    await seedRoom('VR05');
    await seedBlock('BL-M1', 'VR05', '2027-10-01', '2027-10-05');
    await seedBlock('BL-M2', 'VR05', '2027-10-05', '2027-10-08');
    await seedBlock('BL-M3', 'VR05', '2027-10-20', '2027-10-25');
    const r = await callAs(mergeWrapped, 'admin-uid', ADMIN_EMAIL, { room_id: 'VR05', from_date: '2027-10-08', to_date: '2027-10-20' });
    assert.equal(r.from_date, '2027-10-01');
    assert.equal(r.to_date, '2027-10-25');
    const blocks = await blocksOn('VR05');
    assert.equal(blocks.length, 1, 'all four ranges must collapse into exactly one surviving block');
  });

  section('10. Cancelled reservation does not cause a false conflict');
  await test('a Cancelled reservation is absent from room_availability.bookings and never blocks the merge', async () => {
    // room_availability.bookings only ever contains ACTIVE reservations
    // (writeReservationTx filters by isActiveStatus) -- a genuinely
    // Cancelled reservation is never in this list, so seeding an EMPTY
    // bookings array for a room that "has" a Cancelled reservation
    // elsewhere in `reservations` correctly proves it causes no conflict.
    await seedRoom('VR06', []);
    await db.collection('reservations').doc('RES-CANCELLED-1').set({ room_id: 'VR06', check_in: '2027-11-05', check_out: '2027-11-10', status: 'Cancelled' });
    const r = await callAs(mergeWrapped, 'admin-uid', ADMIN_EMAIL, { room_id: 'VR06', from_date: '2027-11-01', to_date: '2027-11-12' });
    assert.equal(r.wasMerge, false);
    assert.equal(r.from_date, '2027-11-01');
    assert.equal(r.to_date, '2027-11-12');
  });

  section('11. Merged operation emits only the final availability recalculation');
  await test('the exact reported regression: one pre-existing block extended by one new range produces exactly one document write, hence exactly one ota_pushes job', async () => {
    await seedRoom('VR01');
    await seedBlock('BL-REG', 'VR01', '2027-01-03', '2027-01-17');
    const beforeBlockDoc = (await db.collection('blocks').doc('BL-REG').get()).data();
    const before = await db.collection('ota_pushes').get();
    const r = await callAs(mergeWrapped, 'admin-uid', ADMIN_EMAIL, { room_id: 'VR01', from_date: '2026-12-21', to_date: '2027-01-04' });
    assert.equal(r.from_date, '2026-12-21');
    assert.equal(r.to_date, '2027-01-17');
    // Common case (0 or 1 pre-existing matched block, as here) is exactly
    // ONE document write -- the survivor updated in place, nothing deleted.
    // The Functions emulator can't load in this environment (node version
    // mismatch, unrelated to this fix; same gap test/agency-settlements-
    // rules.test.js already works around), so real Firestore-to-trigger
    // event delivery can't be exercised live here -- instead, invoke the
    // actual exported availabilityOnBlock trigger directly against the
    // real before/after states mergeBlockRoom just committed, proving the
    // trigger's own one-write-in/one-push-out behavior for this case.
    assert.equal(r.mergedBlockIds.length, 1);
    assert.equal(r.blockId, 'BL-REG', 'the single matched block is updated in place, not replaced');
    const afterBlockDoc = (await db.collection('blocks').doc('BL-REG').get()).data();
    await availabilityOnBlockWrapped(docEvent('BL-REG', beforeBlockDoc, afterBlockDoc));
    const after = await db.collection('ota_pushes').get();
    const newDocs = after.docs.filter((d) => !before.docs.some((b) => b.id === d.id));
    const newPushJobs = newDocs.filter((d) => d.data().type === 'beds24_calendar_push');
    assert.equal(newPushJobs.length, 1, 'expected exactly one new beds24_calendar_push job for this single-block-extend merge, got ' + newPushJobs.length);
    assert.equal(newPushJobs[0].data().job_intent, 'availability');
  });

  section('12. No rate/restriction payload is ever generated by a block merge');
  await test('the one push job produced is availability-only -- no price1/override/minStay/maxStay anywhere in its payload', async () => {
    await seedRoom('VR02');
    const r = await callAs(mergeWrapped, 'admin-uid', ADMIN_EMAIL, { room_id: 'VR02', from_date: '2027-12-01', to_date: '2027-12-05' });
    const before = await db.collection('ota_pushes').get();
    const afterBlockDoc = (await db.collection('blocks').doc(r.blockId).get()).data();
    await availabilityOnBlockWrapped(docEvent(r.blockId, null, afterBlockDoc));
    const after = await db.collection('ota_pushes').get();
    const newDocs = after.docs.filter((d) => !before.docs.some((b) => b.id === d.id) && d.data().type === 'beds24_calendar_push');
    assert.ok(newDocs.length >= 1);
    newDocs.forEach((d) => {
      assert.equal(d.data().job_intent, 'availability');
      const payloadStr = JSON.stringify(d.data().payload || {});
      assert.doesNotMatch(payloadStr, /price1|override|minStay|maxStay/);
    });
  });

  section('13. Reason and notes handling');
  await test('an explicit caller-selected reason wins over the existing blocks\' reason', async () => {
    await seedRoom('VR03');
    await seedBlock('BL-RS1', 'VR03', '2028-01-10', '2028-01-15', 'Cloudbeds hold: Blocked by milan');
    const r = await callAs(mergeWrapped, 'admin-uid', ADMIN_EMAIL, { room_id: 'VR03', from_date: '2028-01-05', to_date: '2028-01-10', reason: 'Owner use' });
    assert.equal(r.reason, 'Owner use');
  });
  await test('with no explicit reason, a single matched block\'s existing reason is preserved (never silently overwritten to the generic default)', async () => {
    await seedRoom('VR04');
    await seedBlock('BL-RS2', 'VR04', '2028-02-10', '2028-02-15', 'Cloudbeds hold: Blocked by angelica');
    const r = await callAs(mergeWrapped, 'admin-uid', ADMIN_EMAIL, { room_id: 'VR04', from_date: '2028-02-05', to_date: '2028-02-10' });
    assert.equal(r.reason, 'Cloudbeds hold: Blocked by angelica');
  });
  await test('notes from the existing block and the new call are both preserved, not overwritten', async () => {
    await seedRoom('VR05');
    await seedBlock('BL-RS3', 'VR05', '2028-03-10', '2028-03-15', null, 'existing note about owner renovation');
    const r = await callAs(mergeWrapped, 'admin-uid', ADMIN_EMAIL, { room_id: 'VR05', from_date: '2028-03-05', to_date: '2028-03-10', notes: 'new note from this call' });
    assert.match(r.notes, /existing note about owner renovation/);
    assert.match(r.notes, /new note from this call/);
  });

  section('Regression test (exact scenario from the report)');
  await test('Room 101/VR01: existing block 2027-01-03 -> 2027-01-17, requested calendar block 2026-12-21 -> 2027-01-04 -> SUCCESS, final continuous 2026-12-21 -> 2027-01-17, no reservation conflict', async () => {
    await seedRoom('VR01');
    await seedBlock('BL-REPORTED', 'VR01', '2027-01-03', '2027-01-17', 'Cloudbeds hold: Blocked by angelica');
    const r = await callAs(mergeWrapped, 'admin-uid', ADMIN_EMAIL, { room_id: 'VR01', from_date: '2026-12-21', to_date: '2027-01-04' });
    assert.equal(r.wasMerge, true);
    assert.equal(r.from_date, '2026-12-21');
    assert.equal(r.to_date, '2027-01-17');
    const blocks = await blocksOn('VR01');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].from_date, '2026-12-21');
    assert.equal(blocks[0].to_date, '2027-01-17');
  });

  functionsTest.cleanup();

  console.log(`\n${passed}/${passed + failed} block-merge-rules (emulator + Cloud Function) assertions passed`);
  if (failed > 0) process.exitCode = 1;
})().catch((e) => {
  console.error('block-merge-rules.test.js crashed:', e);
  process.exitCode = 1;
});
