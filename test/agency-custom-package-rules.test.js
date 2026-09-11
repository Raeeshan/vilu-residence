// Agency Sales Workflow — Phase C: emulator-backed security + rate-integrity
// proof for Custom Package quotes.
//
// Two things are proven here against REAL infrastructure, not just regex:
// 1. firestore.rules genuinely blocks a client from writing a CUSTOM_PACKAGE
//    agency_quotes doc directly (the gap that would otherwise make
//    submitAgencyCustomQuote's server-side validation pointless).
// 2. submitAgencyCustomQuote itself -- run for real, against the Firestore
//    emulator via the Admin SDK -- resolves rates from the canonical
//    source and ignores/rejects anything the "client" tries to spoof.
//
// Run via:
//   firebase emulators:exec --only firestore,functions "node test/agency-custom-package-rules.test.js"
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

function baseQuote(overrides) {
  return Object.assign({
    quoteId: 'VQ-TEST-2026-000001', agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL, agencyName: 'Agency A',
    guestName: 'QA Guest', arrivalDate: '2026-12-01', departureDate: '2026-12-08', adults: 2, children: 0,
    currency: 'USD', quoteType: 'ASSIGNED_PACKAGE', packageId: 'PKGQA1', packageName: 'QA Package',
    selectedComponents: [], viluNetTotal: 1200, agencyGuestSellingTotal: 1450,
    exchangeRate: 1, exchangeRateSource: null, exchangeRateSnapshotAt: null,
    status: 'DRAFT', createdAt: '2026-09-11T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z',
  }, overrides || {});
}

(async () => {
  // ── PART 1: firestore.rules -- direct client write of a CUSTOM_PACKAGE
  // quote must fail, exactly the gap that would defeat the Cloud Function. ──
  const testEnv = await initializeTestEnvironment({
    projectId: 'vilu-residence-rules-test',
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
  });
  const agencyA = testEnv.authenticatedContext(AGENCY_A_UID, { email: AGENCY_A_EMAIL });
  const admin = testEnv.authenticatedContext('admin-uid', { email: ADMIN_EMAIL });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('users').doc(AGENCY_A_EMAIL).set({ email: AGENCY_A_EMAIL, role: 'agency', name: 'Agency A' });
  });

  section('firestore.rules: the critical gap this phase closes');
  await test('Agency A CANNOT create a CUSTOM_PACKAGE quote directly via the client SDK (must go through the Cloud Function)', async () => {
    await assertFails(agencyA.firestore().collection('agency_quotes').doc('VQ-SPOOF-1').set(
      baseQuote({ quoteId: 'VQ-SPOOF-1', quoteType: 'CUSTOM_PACKAGE', viluNetTotal: 1, agencyGuestSellingTotal: 5000 })
    ));
  });
  await test('Agency A can STILL create an ASSIGNED_PACKAGE quote directly (Phase B behavior unaffected)', async () => {
    await assertSucceeds(agencyA.firestore().collection('agency_quotes').doc('VQ-ASSIGNED-1').set(
      baseQuote({ quoteId: 'VQ-ASSIGNED-1', quoteType: 'ASSIGNED_PACKAGE' })
    ));
  });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('agency_quotes').doc('VQ-CUSTOM-SEED').set(baseQuote({ quoteId: 'VQ-CUSTOM-SEED', quoteType: 'CUSTOM_PACKAGE', status: 'DRAFT' }));
  });
  await test('Agency A CANNOT update an existing CUSTOM_PACKAGE quote directly either, even her own', async () => {
    await assertFails(agencyA.firestore().collection('agency_quotes').doc('VQ-CUSTOM-SEED').set(
      baseQuote({ quoteId: 'VQ-CUSTOM-SEED', quoteType: 'CUSTOM_PACKAGE', status: 'DRAFT', agencyGuestSellingTotal: 99999 })
    ));
  });
  await test('Admin CAN still directly write a CUSTOM_PACKAGE quote (trusted role, unrestricted)', async () => {
    await assertSucceeds(admin.firestore().collection('agency_quotes').doc('VQ-CUSTOM-SEED').set(
      baseQuote({ quoteId: 'VQ-CUSTOM-SEED', quoteType: 'CUSTOM_PACKAGE', status: 'DRAFT' })
    ));
  });

  section('firestore.rules: service_catalog agency-visibility (Part 18)');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection('service_catalog').doc('CAT-APPROVED').set({ name: 'Whale Shark Snorkeling', category: 'TRIPS_ACTIVITIES', unitType: 'PER_PAX', basePrice: 85, active: true, visibleToAgencies: 'all' });
    await db.collection('service_catalog').doc('CAT-NOT-APPROVED').set({ name: 'Staff-Only Add-on', category: 'OTHER_SERVICE', unitType: 'PER_ITEM', basePrice: 999, active: true });
    await db.collection('service_catalog').doc('CAT-INACTIVE').set({ name: 'Retired Activity', category: 'TRIPS_ACTIVITIES', unitType: 'PER_PAX', basePrice: 50, active: false, visibleToAgencies: 'all' });
  });
  await test('Agency A CAN read a catalog item explicitly approved for agencies', async () => {
    await assertSucceeds(agencyA.firestore().collection('service_catalog').doc('CAT-APPROVED').get());
  });
  await test('Agency A CANNOT read a catalog item with no visibleToAgencies field at all (nothing is visible by default)', async () => {
    await assertFails(agencyA.firestore().collection('service_catalog').doc('CAT-NOT-APPROVED').get());
  });
  await test('Agency A CANNOT read an approved-but-inactive catalog item', async () => {
    await assertFails(agencyA.firestore().collection('service_catalog').doc('CAT-INACTIVE').get());
  });
  await test('Unauthenticated caller cannot read any catalog item, even an approved one', async () => {
    const anon = testEnv.unauthenticatedContext();
    await assertFails(anon.firestore().collection('service_catalog').doc('CAT-APPROVED').get());
  });

  await testEnv.cleanup();

  console.log(`\n${passed}/${passed + failed} rules-only assertions passed so far`);

  // ── PART 2: submitAgencyCustomQuote -- run for real against the emulator ──
  section('submitAgencyCustomQuote: rate integrity (Cloud Function, real Firestore emulator)');
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  process.env.GCLOUD_PROJECT = 'vilu-residence';
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'vilu-residence' });

  const functionsTest = require('firebase-functions-test')({ projectId: 'vilu-residence' });
  const myFunctions = require('../functions-core/index.js');
  // MUST resolve to the SAME firebase-admin module instance functions-core
  // itself used to call initializeApp() -- the repo root has its own
  // separate copy of firebase-admin (a transitive dep of firebase-functions-
  // test), and Node treats that as a completely different module with its
  // own app registry, so a plain require('firebase-admin/firestore') here
  // would see "no default app" even though functions-core already
  // initialized one, just in ITS copy of the library. require.resolve's
  // `paths` option (not a raw relative path, which would bypass firebase-
  // admin's package.json "exports" map entirely) finds the right one.
  const path = require('node:path');
  const firebaseAdminFirestorePath = require.resolve('firebase-admin/firestore', { paths: [path.join(__dirname, '..', 'functions-core')] });
  const { getFirestore } = require(firebaseAdminFirestorePath);
  const db = getFirestore();
  const wrapped = functionsTest.wrap(myFunctions.submitAgencyCustomQuote);

  // Clear anything the rules-unit-testing pass above might have left in a
  // DIFFERENT emulator project namespace -- this Admin SDK connection uses
  // 'vilu-residence' specifically, a clean slate for this section.
  await db.collection('users').doc(AGENCY_A_EMAIL).set({ email: AGENCY_A_EMAIL, role: 'agency', name: 'Agency A' });
  await db.collection('users').doc(AGENCY_B_EMAIL).set({ email: AGENCY_B_EMAIL, role: 'agency', name: 'Agency B' });
  await db.collection('service_catalog').doc('CAT-WHALE').set({ name: 'Whale Shark Snorkeling', category: 'TRIPS_ACTIVITIES', unitType: 'PER_PAX', basePrice: 85, active: true, visibleToAgencies: 'all' });
  await db.collection('service_catalog').doc('CAT-HIDDEN').set({ name: 'Not Agency Approved', category: 'OTHER_SERVICE', unitType: 'PER_ITEM', basePrice: 500, active: true });
  await db.collection('agency_packages').doc(AGENCY_A_EMAIL).set({ email: AGENCY_A_EMAIL, packages: [{ id: 'PKG-A1', name: 'Maldives Dream Bliss', agencyPricePerRoom: 595, nights: 7, active: true }] });
  await db.collection('agency_packages').doc(AGENCY_B_EMAIL).set({ email: AGENCY_B_EMAIL, packages: [{ id: 'PKG-B1', name: 'Agency B Only Package', agencyPricePerRoom: 700, nights: 5, active: true }] });
  await db.collection('website_content').doc('agency_booking_settings').set({ extraNightRate: 40, flightSurcharge: 110 });

  // wrapped() invokes the raw v2 handler directly (bypassing the HTTPS
  // transport layer), so it resolves to whatever the handler itself
  // returns/throws -- the handler returns the quote object directly, and
  // throws real HttpsError instances (with a `.code`) on failure. This is
  // different from the client SDK's httpsCallable(), which wraps a
  // successful response in `.data` -- there is no such wrapping here.
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

  await test('Agency A gets the REAL rate ($85) even if she sends a spoofed viluUnitRate:1 for the same component', async () => {
    const result = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, {
      guestName: 'Rate Spoof Test', arrivalDate: '2027-01-01', departureDate: '2027-01-03', adults: 2, children: 0, currency: 'USD',
      agencyGuestSellingTotal: 500, status: 'DRAFT',
      selectedComponents: [{ sourceType: 'catalog', sourceId: 'CAT-WHALE', quantity: 2, viluUnitRate: 1, name: 'FAKE NAME' }],
    });
    assert.equal(result.viluNetTotal, 170); // 85 * 2, NOT 1 * 2
    assert.equal(result.selectedComponents[0].viluUnitRate, 85);
    assert.equal(result.selectedComponents[0].name, 'Whale Shark Snorkeling'); // real name, not the spoofed one
    assert.equal(result.agencyEarnings, 500 - 170);
  });

  await test('Agency A requesting a NOT-approved-for-agencies catalog item is rejected server-side', async () => {
    await expectCode(callAs(AGENCY_A_UID, AGENCY_A_EMAIL, {
      guestName: 'X', arrivalDate: '2027-01-01', departureDate: '2027-01-03', adults: 1, children: 0, currency: 'USD',
      agencyGuestSellingTotal: 100, status: 'DRAFT',
      selectedComponents: [{ sourceType: 'catalog', sourceId: 'CAT-HIDDEN', quantity: 1 }],
    }), 'permission-denied');
  });

  await test('Agency A CANNOT use Agency B\'s own assigned package as a component (cross-agency package access)', async () => {
    await expectCode(callAs(AGENCY_A_UID, AGENCY_A_EMAIL, {
      guestName: 'X', arrivalDate: '2027-01-01', departureDate: '2027-01-03', adults: 1, children: 0, currency: 'USD',
      agencyGuestSellingTotal: 100, status: 'DRAFT',
      selectedComponents: [{ sourceType: 'agency_package', sourceId: 'PKG-B1', quantity: 1 }],
    }), 'not-found');
  });

  await test('Agency A CAN use her own assigned package as a component, at its real rate', async () => {
    const result = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, {
      guestName: 'X', arrivalDate: '2027-01-01', departureDate: '2027-01-08', adults: 2, children: 0, currency: 'USD',
      agencyGuestSellingTotal: 1500, status: 'DRAFT',
      selectedComponents: [{ sourceType: 'agency_package', sourceId: 'PKG-A1', quantity: 2 }],
    });
    assert.equal(result.viluNetTotal, 1190); // 595 * 2
  });

  await test('Global settings (extra night / domestic flight) resolve to the real, current rate -- not whatever the client sends', async () => {
    const result = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, {
      guestName: 'X', arrivalDate: '2027-01-01', departureDate: '2027-01-03', adults: 2, children: 0, currency: 'USD',
      agencyGuestSellingTotal: 500, status: 'DRAFT',
      selectedComponents: [{ sourceType: 'global_setting', sourceId: 'flightSurcharge', quantity: 2, viluUnitRate: 1 }],
    });
    assert.equal(result.viluNetTotal, 220); // 110 * 2
  });

  let quoteAId;
  await test('a saved quote can be edited by its OWN agency while still DRAFT', async () => {
    const created = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, {
      guestName: 'Edit Test', arrivalDate: '2027-02-01', departureDate: '2027-02-03', adults: 1, children: 0, currency: 'USD',
      agencyGuestSellingTotal: 200, status: 'DRAFT',
      selectedComponents: [{ sourceType: 'catalog', sourceId: 'CAT-WHALE', quantity: 1 }],
    });
    quoteAId = created.quoteId;
    assert.ok(quoteAId, 'expected a quoteId to come back from the create call');
    const edited = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, {
      quoteId: quoteAId, guestName: 'Edit Test Updated', arrivalDate: '2027-02-01', departureDate: '2027-02-03', adults: 1, children: 0, currency: 'USD',
      agencyGuestSellingTotal: 250, status: 'DRAFT',
      selectedComponents: [{ sourceType: 'catalog', sourceId: 'CAT-WHALE', quantity: 1 }],
    });
    assert.equal(edited.guestName, 'Edit Test Updated');
    assert.equal(edited.quoteId, quoteAId); // same doc, not a new one
  });

  await test('Agency B CANNOT edit Agency A\'s quote by id', async () => {
    await expectCode(callAs(AGENCY_B_UID, AGENCY_B_EMAIL, {
      quoteId: quoteAId, guestName: 'Hijacked', arrivalDate: '2027-02-01', departureDate: '2027-02-03', adults: 1, children: 0, currency: 'USD',
      agencyGuestSellingTotal: 1, status: 'DRAFT',
      selectedComponents: [{ sourceType: 'catalog', sourceId: 'CAT-WHALE', quantity: 1 }],
    }), 'permission-denied');
  });

  let finalizedQuoteId;
  await test('finalizing locks the quote server-side too', async () => {
    const finalized = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, {
      quoteId: quoteAId, guestName: 'Edit Test Updated', arrivalDate: '2027-02-01', departureDate: '2027-02-03', adults: 1, children: 0, currency: 'USD',
      agencyGuestSellingTotal: 250, status: 'FINALIZED',
      selectedComponents: [{ sourceType: 'catalog', sourceId: 'CAT-WHALE', quantity: 1 }],
    });
    finalizedQuoteId = finalized.quoteId;
    assert.equal(finalized.status, 'FINALIZED');
  });
  await test('Agency A CANNOT edit her own quote anymore after it was finalized (server-side, independent of the client UI hiding the buttons)', async () => {
    await expectCode(callAs(AGENCY_A_UID, AGENCY_A_EMAIL, {
      quoteId: finalizedQuoteId, guestName: 'Sneaky edit', arrivalDate: '2027-02-01', departureDate: '2027-02-03', adults: 1, children: 0, currency: 'USD',
      agencyGuestSellingTotal: 99999, status: 'FINALIZED',
      selectedComponents: [{ sourceType: 'catalog', sourceId: 'CAT-WHALE', quantity: 1 }],
    }), 'failed-precondition');
  });

  await test('a non-agency caller (no users/{email}.role==agency doc) is rejected outright', async () => {
    await db.collection('users').doc('notanagency@example.com').set({ email: 'notanagency@example.com', role: 'staff' });
    await expectCode(callAs('random-uid', 'notanagency@example.com', {
      guestName: 'X', arrivalDate: '2027-01-01', departureDate: '2027-01-03', adults: 1, children: 0, currency: 'USD',
      agencyGuestSellingTotal: 100, status: 'DRAFT',
      selectedComponents: [{ sourceType: 'catalog', sourceId: 'CAT-WHALE', quantity: 1 }],
    }), 'permission-denied');
  });

  functionsTest.cleanup();

  console.log(`\n${passed}/${passed + failed} agency-custom-package-rules (emulator + Cloud Function) assertions passed`);
  if (failed > 0) process.exitCode = 1;
})().catch((e) => {
  console.error('agency-custom-package-rules.test.js crashed:', e);
  process.exitCode = 1;
});
