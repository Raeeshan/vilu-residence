// VILU AGENCY PORTAL — REAL PARTNER HOTEL SETUP + REMAINING MULTI-PROPERTY
// BUSINESS GAPS: emulator-backed proof for assigned-package partner
// pricing (Part 5/6).
//
// Two things are proven here against REAL infrastructure, not just regex:
// 1. firestore.rules genuinely blocks a direct client write that finalizes
//    an ASSIGNED_PACKAGE quote with a non-Vilu accommodationPropertyId --
//    the gap that would otherwise make finalizeAgencyAssignedPackageQuote's
//    server-side validation pointless -- while a Vilu-only finalize still
//    works exactly as it always has.
// 2. finalizeAgencyAssignedPackageQuote itself -- run for real, against the
//    Firestore emulator via the Admin SDK -- resolves the package's own
//    data and an admin-approved partner-property override server-side, and
//    refuses to finalize when no such override is configured.
//
// Run via:
//   firebase emulators:exec --only firestore "node test/assigned-package-partner-pricing-rules.test.js"
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

function baseQuote(overrides) {
  return Object.assign({
    quoteId: 'VQ-TEST-2026-000002', agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL, agencyName: 'Agency A',
    guestName: 'QA Guest', arrivalDate: '2026-12-01', departureDate: '2026-12-06', adults: 2, children: 0,
    currency: 'USD', quoteType: 'ASSIGNED_PACKAGE', packageId: 'PKG-QA-1', packageName: 'QA Package', nights: 5,
    accommodationPropertyId: 'VILU', accommodationRoomTypeId: null,
    viluNetTotal: 400, agencyGuestSellingTotal: 800,
    exchangeRate: 1, exchangeRateSource: null, exchangeRateSnapshotAt: null,
    status: 'DRAFT', createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z',
  }, overrides || {});
}

(async () => {
  // ── PART 1: firestore.rules -- direct-client finalize with a partner
  // property must fail; a Vilu-only finalize must still succeed. ──
  const testEnv = await initializeTestEnvironment({
    projectId: 'vilu-residence-rules-test',
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
  });
  const agencyA = testEnv.authenticatedContext(AGENCY_A_UID, { email: AGENCY_A_EMAIL });

  section('firestore.rules: the gap this task closes -- a partner-property finalize can no longer skip the server');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('agency_quotes').doc('VQ-VILU-DRAFT').set(baseQuote({ quoteId: 'VQ-VILU-DRAFT' }));
    await ctx.firestore().collection('agency_quotes').doc('VQ-PARTNER-DRAFT').set(baseQuote({ quoteId: 'VQ-PARTNER-DRAFT', accommodationPropertyId: 'PARTNER1' }));
  });
  await test('Agency A CANNOT directly finalize her own quote when accommodationPropertyId is a partner property', async () => {
    await assertFails(agencyA.firestore().collection('agency_quotes').doc('VQ-PARTNER-DRAFT').set(
      baseQuote({ quoteId: 'VQ-PARTNER-DRAFT', accommodationPropertyId: 'PARTNER1', status: 'FINALIZED', viluNetTotal: 1 })
    ));
  });
  await test('Agency A CAN still directly finalize her own quote when the accommodation is Vilu -- zero behavior change for the common case', async () => {
    await assertSucceeds(agencyA.firestore().collection('agency_quotes').doc('VQ-VILU-DRAFT').set(
      baseQuote({ quoteId: 'VQ-VILU-DRAFT', accommodationPropertyId: 'VILU', status: 'FINALIZED' })
    ));
  });
  await test('Agency A CAN still directly finalize a quote with no accommodationPropertyId field at all (pre-Phase-4 quote shape, treated the same as Vilu)', async () => {
    const q = baseQuote({ quoteId: 'VQ-NOFIELD-DRAFT', status: 'DRAFT' });
    delete q.accommodationPropertyId;
    await testEnv.withSecurityRulesDisabled(async (ctx) => { await ctx.firestore().collection('agency_quotes').doc('VQ-NOFIELD-DRAFT').set(q); });
    const finalized = baseQuote({ quoteId: 'VQ-NOFIELD-DRAFT', status: 'FINALIZED' });
    delete finalized.accommodationPropertyId;
    await assertSucceeds(agencyA.firestore().collection('agency_quotes').doc('VQ-NOFIELD-DRAFT').set(finalized));
  });

  await testEnv.cleanup();
  console.log(`\n${passed}/${passed + failed} rules-only assertions passed so far`);

  // ── PART 2: finalizeAgencyAssignedPackageQuote -- run for real against
  // the emulator ──
  section('finalizeAgencyAssignedPackageQuote: server-authoritative partner pricing (Cloud Function, real Firestore emulator)');
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  process.env.GCLOUD_PROJECT = 'vilu-residence';
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'vilu-residence' });

  const functionsTest = require('firebase-functions-test')({ projectId: 'vilu-residence' });
  const myFunctions = require('../functions-core/index.js');
  const path = require('node:path');
  const firebaseAdminFirestorePath = require.resolve('firebase-admin/firestore', { paths: [path.join(__dirname, '..', 'functions-core')] });
  const { getFirestore } = require(firebaseAdminFirestorePath);
  const db = getFirestore();
  const wrapped = functionsTest.wrap(myFunctions.finalizeAgencyAssignedPackageQuote);

  await db.collection('users').doc(AGENCY_A_EMAIL).set({ email: AGENCY_A_EMAIL, role: 'agency', name: 'Agency A' });
  await db.collection('users').doc(AGENCY_B_EMAIL).set({ email: AGENCY_B_EMAIL, role: 'agency', name: 'Agency B' });
  await db.collection('website_content').doc('agency_booking_settings').set({ extraNightRate: 40, flightSurcharge: 110 });
  await db.collection('accommodation_properties').doc('PARTNER1').set({
    propertyName: 'QA Partner Resort', propertyType: 'Resort', active: true, visibleToAgencies: true, availabilityMode: 'MANUAL_INVENTORY', displayOrder: 1, isVilu: false,
  });
  await db.collection('accommodation_properties').doc('PARTNER1').collection('room_types').doc('RT1').set({
    roomTypeName: 'Standard Room', capacity: 2, active: true, visibleToAgencies: true, agencyRate: 999, currency: 'USD',
  });
  await db.collection('accommodation_properties').doc('PARTNER-NORATE').set({
    propertyName: 'QA No-Override Resort', propertyType: 'Resort', active: true, visibleToAgencies: true, availabilityMode: 'MANUAL_INVENTORY', displayOrder: 2, isVilu: false,
  });
  await db.collection('accommodation_properties').doc('PARTNER-NORATE').collection('room_types').doc('RT2').set({
    roomTypeName: 'Deluxe Room', capacity: 2, active: true, visibleToAgencies: true, agencyRate: 500, currency: 'USD',
  });
  // PKG-A1: Vilu rate $200/person, 5 nights, no child discount. Approved
  // partner override for PARTNER1 at $150/person -- deliberately DIFFERENT
  // from both the Vilu rate ($200) and the room type's own agencyRate
  // ($999), so a test that accidentally fell back to either would be
  // caught immediately.
  await db.collection('agency_packages').doc(AGENCY_A_EMAIL).set({
    email: AGENCY_A_EMAIL,
    packages: [{
      id: 'PKG-A1', name: 'QA Assigned Package', agencyPricePerRoom: 200, nights: 5, childDiscountPct: 0, active: true,
      partnerRates: { PARTNER1: { agencyPricePerRoom: 150, currency: 'USD' } },
    }],
  });
  await db.collection('agency_packages').doc(AGENCY_B_EMAIL).set({
    email: AGENCY_B_EMAIL,
    packages: [{ id: 'PKG-B1', name: 'Agency B Only Package', agencyPricePerRoom: 300, nights: 5, active: true }],
  });

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
  async function seedQuote(id, overrides) {
    await db.collection('agency_quotes').doc(id).set(baseQuote(Object.assign({ quoteId: id, packageId: 'PKG-A1' }, overrides)));
  }

  await test('finalizing with the Vilu accommodation uses the package\'s own agencyPricePerRoom ($200 x 2 adults = $400) -- byte-identical to what the client already showed while drafting', async () => {
    await seedQuote('VQ-F-VILU', { accommodationPropertyId: 'VILU', accommodationRoomTypeId: null });
    const result = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, { quoteId: 'VQ-F-VILU' });
    assert.equal(result.viluNetTotal, 400);
    assert.equal(result.accommodationIsVilu, true);
    assert.equal(result.status, 'FINALIZED');
  });

  await test('finalizing with a partner property uses the ADMIN-APPROVED override ($150/person), never the Vilu rate ($200) and never the room type\'s own agencyRate ($999)', async () => {
    await seedQuote('VQ-F-PARTNER', { accommodationPropertyId: 'PARTNER1', accommodationRoomTypeId: 'RT1' });
    const result = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, { quoteId: 'VQ-F-PARTNER' });
    assert.equal(result.viluNetTotal, 300); // 150 * 2 adults
    assert.equal(result.accommodationIsVilu, false);
    assert.equal(result.accommodationPropertyName, 'QA Partner Resort');
    assert.equal(result.accommodationRateSnapshot, 150);
  });

  await test('finalizing with a partner property that has NO configured package override is BLOCKED (failed-precondition), never a guessed rate or a silent fallback to the Vilu price', async () => {
    await seedQuote('VQ-F-NORATE', { accommodationPropertyId: 'PARTNER-NORATE', accommodationRoomTypeId: 'RT2' });
    await expectCode(callAs(AGENCY_A_UID, AGENCY_A_EMAIL, { quoteId: 'VQ-F-NORATE' }), 'failed-precondition');
  });

  await test('a spoofed client-supplied accommodationPropertyId/roomTypeId on the finalize call itself is ignored -- the server reads the QUOTE DOC\'s own saved selection, not request.data', async () => {
    await seedQuote('VQ-F-IGNORE-SPOOF', { accommodationPropertyId: 'PARTNER1', accommodationRoomTypeId: 'RT1' });
    const result = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, { quoteId: 'VQ-F-IGNORE-SPOOF', accommodationPropertyId: 'VILU', viluNetTotal: 1 });
    assert.equal(result.accommodationPropertyId, 'PARTNER1', 'must resolve from the saved quote doc, not request.data');
    assert.equal(result.viluNetTotal, 300);
  });

  await test('Agency B CANNOT finalize Agency A\'s quote by id', async () => {
    await seedQuote('VQ-F-CROSSAGENCY', { accommodationPropertyId: 'VILU' });
    await expectCode(callAs(AGENCY_B_UID, AGENCY_B_EMAIL, { quoteId: 'VQ-F-CROSSAGENCY' }), 'permission-denied');
  });

  await test('a quote that is already FINALIZED cannot be finalized again', async () => {
    await seedQuote('VQ-F-ALREADYDONE', { accommodationPropertyId: 'VILU', status: 'FINALIZED' });
    await expectCode(callAs(AGENCY_A_UID, AGENCY_A_EMAIL, { quoteId: 'VQ-F-ALREADYDONE' }), 'failed-precondition');
  });

  await test('a CUSTOM_PACKAGE quote is rejected outright -- this function only ever finalizes ASSIGNED_PACKAGE', async () => {
    await seedQuote('VQ-F-WRONGTYPE', { accommodationPropertyId: 'VILU', quoteType: 'CUSTOM_PACKAGE' });
    await expectCode(callAs(AGENCY_A_UID, AGENCY_A_EMAIL, { quoteId: 'VQ-F-WRONGTYPE' }), 'invalid-argument');
  });

  await test('finalizing without a guest selling price entered yet is rejected, same guard as the existing client check', async () => {
    await seedQuote('VQ-F-NOPRICE', { accommodationPropertyId: 'VILU', agencyGuestSellingTotal: 0 });
    await expectCode(callAs(AGENCY_A_UID, AGENCY_A_EMAIL, { quoteId: 'VQ-F-NOPRICE' }), 'invalid-argument');
  });

  await test('a non-agency caller is rejected outright', async () => {
    await seedQuote('VQ-F-NONAGENCY', { accommodationPropertyId: 'VILU' });
    await db.collection('users').doc('staffperson@example.com').set({ email: 'staffperson@example.com', role: 'staff' });
    await expectCode(callAs('staff-uid', 'staffperson@example.com', { quoteId: 'VQ-F-NONAGENCY' }), 'permission-denied');
  });

  console.log(`\n${passed}/${passed + failed} assigned-package-partner-pricing-rules (emulator + Cloud Function) assertions passed`);
})().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
