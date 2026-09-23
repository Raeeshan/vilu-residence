// canonical_room_rates security rules (PMS-driven multi-slot OTA rates,
// Phase R6/R11 final pre-deploy review, Gate A).
//
// Runs against a REAL Firestore Rules engine (the emulator), not a regex
// check of the rules text -- for a collection that drives a live push to
// Booking.com, "the string 'canDiscount()' appears in firestore.rules" is
// not proof that Firestore actually enforces it the way we think. Same
// technique as test/agency-quotes-rules.test.js.
//
// Required policy (owner-specified): Admin/Manager read+write; an
// ordinary authenticated user with neither role, and an unauthenticated
// caller, both denied read and write. Reuses canDiscount() -- the SAME
// Admin-or-Manager combinator firestore.rules already defines for folio
// discount authority -- no new authorization model invented.
//
// Requires the Firestore emulator (already configured in firebase.json).
// Run via:
//   firebase emulators:exec --only firestore,auth "node test/canonical-room-rates-rules.test.js"
const fs = require('node:fs');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}

const ADMIN_EMAIL = 'viluresidence@gmail.com';

function baseDoc(overrides) {
  return Object.assign({
    intervals: [{ from: '2026-09-23', to: '2026-12-01', rate: 60 }],
    updated_at: '2026-09-23T00:00:00.000Z',
    updated_by: 'test@example.com',
  }, overrides || {});
}

(async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: 'vilu-residence-rules-test',
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
  });

  const admin = testEnv.authenticatedContext('admin-uid', { email: ADMIN_EMAIL });
  const manager = testEnv.authenticatedContext('manager-uid', { email: 'manager@example.com' });
  const ordinaryStaff = testEnv.authenticatedContext('staff-uid', { email: 'staff@example.com' }); // authenticated, but no users/{email} role doc and no staff_permissions doc -- an "ordinary/non-authorized" caller
  const anon = testEnv.unauthenticatedContext();

  // Seed the manager's role doc so isManagerRole()'s internal get() call
  // resolves the same way production does. This bypasses security rules
  // entirely (test fixture setup, not the write being tested).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection('users').doc('manager@example.com').set({ email: 'manager@example.com', role: 'manager', name: 'Test Manager' });
    // Deliberately do NOT seed a users/ doc or a staff_permissions doc for
    // staff@example.com -- that absence is exactly what makes this caller
    // "ordinary/non-authorized" for this collection.
  });

  section('Gate A — write');

  await test('Admin CAN write canonical_room_rates', async () => {
    await assertSucceeds(admin.firestore().collection('canonical_room_rates').doc('deluxe_family').set(baseDoc()));
  });
  await test('Manager CAN write canonical_room_rates', async () => {
    await assertSucceeds(manager.firestore().collection('canonical_room_rates').doc('double').set(baseDoc()));
  });
  await test('An ordinary authenticated user (no admin/manager/staff role) CANNOT write canonical_room_rates', async () => {
    await assertFails(ordinaryStaff.firestore().collection('canonical_room_rates').doc('open_deck').set(baseDoc()));
  });
  await test('Unauthenticated caller CANNOT write canonical_room_rates', async () => {
    await assertFails(anon.firestore().collection('canonical_room_rates').doc('deluxe_family').set(baseDoc()));
  });

  section('Gate A — read');

  // Seed one doc per room type directly (bypassing rules) so the read
  // tests below exercise ONLY the read rule, not the write rule.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection('canonical_room_rates').doc('deluxe_family').set(baseDoc());
  });

  await test('Admin CAN read canonical_room_rates', async () => {
    await assertSucceeds(admin.firestore().collection('canonical_room_rates').doc('deluxe_family').get());
  });
  await test('Manager CAN read canonical_room_rates', async () => {
    await assertSucceeds(manager.firestore().collection('canonical_room_rates').doc('deluxe_family').get());
  });
  await test('An ordinary authenticated user (no admin/manager/staff role) CANNOT read canonical_room_rates', async () => {
    await assertFails(ordinaryStaff.firestore().collection('canonical_room_rates').doc('deluxe_family').get());
  });
  await test('Unauthenticated caller CANNOT read canonical_room_rates', async () => {
    await assertFails(anon.firestore().collection('canonical_room_rates').doc('deluxe_family').get());
  });

  await testEnv.cleanup();

  console.log(`\n${passed}/${passed + failed} canonical-room-rates-rules (emulator) assertions passed`);
  if (failed > 0) process.exitCode = 1;
})().catch((e) => {
  console.error('canonical-room-rates-rules.test.js crashed:', e);
  process.exitCode = 1;
});
