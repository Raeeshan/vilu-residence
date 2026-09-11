// Agency Sales Workflow — Phase A: agency_quotes security rules.
//
// This is the one place in the whole test suite that runs against a REAL
// Firestore Rules engine (the Firebase emulator) instead of asserting rule
// TEXT with regex -- regex proves the string is present, not that Firestore
// actually evaluates it the way we think. For a brand-new, security-critical
// collection whose whole point is "Agency A can never touch Agency B's
// quote," that distinction matters enough to justify the emulator.
//
// Requires the Firestore emulator (already configured in firebase.json).
// Run via:
//   firebase emulators:exec --only firestore "node test/agency-quotes-rules.test.js"
// (a plain `node test/agency-quotes-rules.test.js` without the emulator
// running will fail every test with a connection error -- that's expected,
// not a rules bug.)
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
const ADMIN_EMAIL = 'viluresidence@gmail.com';

function baseQuote(overrides) {
  return Object.assign({
    quoteId: 'VQ-TESTQA-2026-000001',
    agencyId: AGENCY_A_UID,
    agencyEmail: 'agencya@example.com',
    agencyName: 'Agency A',
    guestName: 'QA Test Guest',
    arrivalDate: '2026-12-01',
    departureDate: '2026-12-08',
    adults: 2,
    children: 0,
    currency: 'USD',
    quoteType: 'ASSIGNED_PACKAGE',
    packageId: 'PKGQA1',
    packageName: 'QA Test Package',
    selectedComponents: [],
    viluNetTotal: 1200,
    agencyGuestSellingTotal: 1450,
    exchangeRate: 1,
    exchangeRateSource: null,
    exchangeRateSnapshotAt: null,
    status: 'DRAFT',
    createdAt: '2026-09-11T00:00:00.000Z',
    updatedAt: '2026-09-11T00:00:00.000Z',
  }, overrides || {});
}

(async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: 'vilu-residence-rules-test',
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
  });

  const agencyA = testEnv.authenticatedContext(AGENCY_A_UID, { email: 'agencya@example.com' });
  const agencyB = testEnv.authenticatedContext(AGENCY_B_UID, { email: 'agencyb@example.com' });
  const admin = testEnv.authenticatedContext('admin-uid', { email: ADMIN_EMAIL });
  const anon = testEnv.unauthenticatedContext();

  // Seed users/{email} docs so isAgency()/isAdmin()'s internal get() calls
  // resolve roles the same way production does -- rules-internal get()
  // bypasses security rules entirely, so this can be written directly via
  // the admin SDK context without needing its own allow-write path tested.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection('users').doc('agencya@example.com').set({ email: 'agencya@example.com', role: 'agency', name: 'Agency A' });
    await db.collection('users').doc('agencyb@example.com').set({ email: 'agencyb@example.com', role: 'agency', name: 'Agency B' });
  });

  section('Agency A: create own quote');
  await test('Agency A can create a quote with agencyId == her own uid', async () => {
    await assertSucceeds(agencyA.firestore().collection('agency_quotes').doc('VQ-A-1').set(baseQuote({ quoteId: 'VQ-A-1', agencyId: AGENCY_A_UID })));
  });
  await test('Agency A CANNOT create a quote claiming to belong to Agency B', async () => {
    await assertFails(agencyA.firestore().collection('agency_quotes').doc('VQ-A-FAKE').set(baseQuote({ quoteId: 'VQ-A-FAKE', agencyId: AGENCY_B_UID })));
  });
  await test('Unauthenticated caller cannot create any quote', async () => {
    await assertFails(anon.firestore().collection('agency_quotes').doc('VQ-ANON').set(baseQuote({ quoteId: 'VQ-ANON', agencyId: AGENCY_A_UID })));
  });

  // Seed a DRAFT and a FINALIZED quote for Agency A, and one for Agency B,
  // bypassing rules (this is seeding test fixtures, not testing create).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection('agency_quotes').doc('VQ-A-DRAFT').set(baseQuote({ quoteId: 'VQ-A-DRAFT', agencyId: AGENCY_A_UID, status: 'DRAFT' }));
    await db.collection('agency_quotes').doc('VQ-A-FINAL').set(baseQuote({ quoteId: 'VQ-A-FINAL', agencyId: AGENCY_A_UID, status: 'FINALIZED' }));
    await db.collection('agency_quotes').doc('VQ-B-DRAFT').set(baseQuote({ quoteId: 'VQ-B-DRAFT', agencyId: AGENCY_B_UID, agencyEmail: 'agencyb@example.com', agencyName: 'Agency B', status: 'DRAFT' }));
  });

  section('Read ownership');
  await test('Agency A can read her own quote', async () => {
    await assertSucceeds(agencyA.firestore().collection('agency_quotes').doc('VQ-A-DRAFT').get());
  });
  await test('Agency A CANNOT read Agency B\'s quote', async () => {
    await assertFails(agencyA.firestore().collection('agency_quotes').doc('VQ-B-DRAFT').get());
  });
  await test('Agency B CANNOT read Agency A\'s quote', async () => {
    await assertFails(agencyB.firestore().collection('agency_quotes').doc('VQ-A-DRAFT').get());
  });
  await test('Admin can read any agency\'s quote', async () => {
    await assertSucceeds(admin.firestore().collection('agency_quotes').doc('VQ-B-DRAFT').get());
  });
  await test('Unauthenticated caller cannot read any quote', async () => {
    await assertFails(anon.firestore().collection('agency_quotes').doc('VQ-A-DRAFT').get());
  });
  await test('No broad collection listing for a non-admin agency (only owned docs are reachable one at a time via rules, not a where-less list)', async () => {
    await assertFails(agencyA.firestore().collection('agency_quotes').get());
  });

  section('DRAFT update behavior');
  await test('Agency A can update her own DRAFT quote (e.g. change the selling total)', async () => {
    await assertSucceeds(agencyA.firestore().collection('agency_quotes').doc('VQ-A-DRAFT').set(
      baseQuote({ quoteId: 'VQ-A-DRAFT', agencyId: AGENCY_A_UID, status: 'DRAFT', agencyGuestSellingTotal: 1500 })
    ));
  });
  await test('Agency A CANNOT update Agency B\'s DRAFT quote', async () => {
    await assertFails(agencyA.firestore().collection('agency_quotes').doc('VQ-B-DRAFT').set(
      baseQuote({ quoteId: 'VQ-B-DRAFT', agencyId: AGENCY_B_UID, agencyEmail: 'agencyb@example.com', status: 'DRAFT', agencyGuestSellingTotal: 999 })
    ));
  });

  section('agencyId immutability');
  await test('Agency A CANNOT reassign her own quote to a different agencyId', async () => {
    await assertFails(agencyA.firestore().collection('agency_quotes').doc('VQ-A-DRAFT').set(
      baseQuote({ quoteId: 'VQ-A-DRAFT', agencyId: AGENCY_B_UID, status: 'DRAFT' })
    ));
  });

  section('FINALIZED protection');
  await test('Agency A CANNOT rewrite her own FINALIZED quote', async () => {
    await assertFails(agencyA.firestore().collection('agency_quotes').doc('VQ-A-FINAL').set(
      baseQuote({ quoteId: 'VQ-A-FINAL', agencyId: AGENCY_A_UID, status: 'FINALIZED', agencyGuestSellingTotal: 5000 })
    ));
  });
  await test('Admin CAN update a FINALIZED quote (e.g. to move it into a later workflow status)', async () => {
    await assertSucceeds(admin.firestore().collection('agency_quotes').doc('VQ-A-FINAL').set(
      baseQuote({ quoteId: 'VQ-A-FINAL', agencyId: AGENCY_A_UID, status: 'FINALIZED' })
    ));
  });

  section('Delete is fully disabled');
  await test('Agency A cannot delete her own quote', async () => {
    await assertFails(agencyA.firestore().collection('agency_quotes').doc('VQ-A-DRAFT').delete());
  });
  await test('Admin cannot delete a quote either (audit trail preserved, matches block_requests convention)', async () => {
    await assertFails(admin.firestore().collection('agency_quotes').doc('VQ-A-DRAFT').delete());
  });

  await testEnv.cleanup();

  console.log(`\n${passed}/${passed + failed} agency-quotes-rules (emulator) assertions passed`);
  if (failed > 0) process.exitCode = 1;
})().catch((e) => {
  console.error('agency-quotes-rules.test.js crashed:', e);
  process.exitCode = 1;
});
