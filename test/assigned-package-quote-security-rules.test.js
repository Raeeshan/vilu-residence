// AGENCY_QUOTES CREATE-RULE HARDENING — Assigned Package quote security.
//
// Proves (against a real Firestore emulator + the real Cloud Function, not
// just regex) that submitAgencyAssignedPackageQuote is now the ONLY way an
// ASSIGNED_PACKAGE quote is ever created, edited, or finalized, and that it
// never trusts a client-supplied commercial field: agencyId, viluNetTotal,
// agencyEarnings, package/property/room-type rate, rate snapshots, server
// timestamps, and FINALIZED status are all either re-derived server-side or
// rejected outright when spoofed. Supersedes
// test/assigned-package-partner-pricing-rules.test.js (deleted -- that file
// tested the old finalize-only function and the old rules carve-out, both
// retired by this hardening).
//
// Run via:
//   firebase emulators:exec --only firestore "node test/assigned-package-quote-security.test.js"
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
  // ── PART 1: the exact exploit this task's own audit proved BEFORE any
  // fix -- kept here as a live regression guard, not just a one-off log.
  // (Full before/after documentation is in the session's own report; this
  // is the permanent automated version of that same proof.) ──
  const testEnv = await initializeTestEnvironment({
    projectId: 'vilu-residence-rules-test',
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
  });
  const agencyA = testEnv.authenticatedContext(AGENCY_A_UID, { email: AGENCY_A_EMAIL });

  section('Regression guard: the exact pre-hardening exploits stay blocked');
  await test('creating a quote pre-FINALIZED with agencyId spoofed to Agency B and fake commercial fields is refused', async () => {
    await assertFails(agencyA.firestore().collection('agency_quotes').doc('VQ-EXPLOIT-REGRESSION').set({
      quoteId: 'VQ-EXPLOIT-REGRESSION', agencyId: AGENCY_B_UID, agencyEmail: AGENCY_B_EMAIL, quoteType: 'ASSIGNED_PACKAGE',
      status: 'FINALIZED', viluNetTotal: 1, agencyEarnings: 9999, agencyGuestSellingTotal: 10000,
      packageId: 'FAKE', accommodationPropertyId: 'FAKE', accommodationRoomTypeId: 'FAKE',
      createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z', finalizedAt: '2020-01-01T00:00:00.000Z',
    }));
  });
  await testEnv.cleanup();
  console.log(`\n${passed}/${passed + failed} regression-guard assertions passed so far`);

  // ── PART 2: submitAgencyAssignedPackageQuote -- run for real against the
  // emulator ──
  section('submitAgencyAssignedPackageQuote: server-authoritative create/edit/finalize (Cloud Function, real Firestore emulator)');
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  process.env.GCLOUD_PROJECT = 'vilu-residence';
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'vilu-residence' });

  const functionsTest = require('firebase-functions-test')({ projectId: 'vilu-residence' });
  const myFunctions = require('../functions-core/index.js');
  const path = require('node:path');
  const firebaseAdminFirestorePath = require.resolve('firebase-admin/firestore', { paths: [path.join(__dirname, '..', 'functions-core')] });
  const { getFirestore } = require(firebaseAdminFirestorePath);
  const db = getFirestore();
  const wrapped = functionsTest.wrap(myFunctions.submitAgencyAssignedPackageQuote);

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
  await db.collection('agency_packages').doc(AGENCY_A_EMAIL).set({
    email: AGENCY_A_EMAIL,
    packages: [
      {
        id: 'PKG-A1', name: 'QA Assigned Package', agencyPricePerRoom: 200, nights: 5, childDiscountPct: 0, active: true,
        includes: ['Breakfast — $10'], activities: ['Snorkeling — $20'],
        partnerRates: { PARTNER1: { agencyPricePerRoom: 150, currency: 'USD' } },
      },
      { id: 'PKG-A2-INACTIVE', name: 'QA Retired Package', agencyPricePerRoom: 999, nights: 3, active: false },
    ],
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
  function draftPayload(overrides) {
    return Object.assign({
      packageId: 'PKG-A1', guestName: 'QA Guest', arrivalDate: '2027-01-01', departureDate: '2027-01-06',
      adults: 2, children: 0, currency: 'USD', guestMessage: '', agencyGuestSellingTotal: 800,
      accommodationPropertyId: 'VILU', accommodationRoomTypeId: null, status: 'DRAFT',
    }, overrides || {});
  }

  section('Legitimate happy paths');
  let viluQuoteId;
  await test('a legitimate DRAFT assigned-package quote (Vilu) saves correctly, viluNetTotal computed server-side from the real package rate ($200 x 2 = $400)', async () => {
    const result = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload());
    viluQuoteId = result.quoteId;
    assert.equal(result.viluNetTotal, 400);
    assert.equal(result.agencyEarnings, 400); // 800 - 400
    assert.equal(result.status, 'DRAFT');
    assert.deepEqual(result.guestIncludes, ['Breakfast']);
    assert.deepEqual(result.guestActivities, ['Snorkeling']);
  });
  await test('finalizing that same draft locks it, keeping the same server-computed total', async () => {
    const result = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload({ quoteId: viluQuoteId, status: 'FINALIZED' }));
    assert.equal(result.status, 'FINALIZED');
    assert.equal(result.viluNetTotal, 400);
    assert.ok(result.finalizedAt);
  });
  await test('a legitimate assigned-package quote against a partner property uses the ADMIN-APPROVED override ($150/person x 2 = $300), never the Vilu rate ($200) or the room type\'s own agencyRate ($999)', async () => {
    const result = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload({
      accommodationPropertyId: 'PARTNER1', accommodationRoomTypeId: 'RT1', status: 'FINALIZED',
    }));
    assert.equal(result.viluNetTotal, 300);
    assert.equal(result.accommodationIsVilu, false);
    assert.equal(result.accommodationRateSnapshot, 150);
  });

  section('Vilu Net / earnings / ownership spoofing is ignored, not merely rejected');
  await test('a client-supplied viluNetTotal/agencyEarnings is silently ignored -- the server always recomputes from the real package rate', async () => {
    const result = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload({ viluNetTotal: 1, agencyEarnings: 9999 }));
    assert.equal(result.viluNetTotal, 400);
    assert.equal(result.agencyEarnings, 400);
  });
  await test('a client-supplied agencyId is impossible to send in the first place -- the server always derives agencyId from request.auth.uid, never from request.data', async () => {
    const result = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload({ agencyId: AGENCY_B_UID }));
    assert.equal(result.agencyId, AGENCY_A_UID);
  });
  await test('a client-supplied accommodationRateSnapshot/accommodationCurrency is ignored -- the server always re-derives them from resolveAssignedPackageRate(), here the real Vilu package rate ($200), never the spoofed value', async () => {
    const result = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload({ accommodationRateSnapshot: 1, accommodationCurrency: 'FAKE' }));
    assert.equal(result.accommodationRateSnapshot, 200);
    assert.equal(result.accommodationCurrency, 'USD');
  });
  await test('a client-supplied createdAt/updatedAt/finalizedAt is ignored -- the server always sets its own timestamps', async () => {
    const result = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload({ createdAt: '2000-01-01T00:00:00.000Z', finalizedAt: '2000-01-01T00:00:00.000Z' }));
    assert.notEqual(result.createdAt, '2000-01-01T00:00:00.000Z');
  });

  section('FINALIZED-on-create: skipping the DRAFT step entirely still enforces full validation, never a shortcut around it');
  await test('requesting status:FINALIZED on the very first call for a brand-new quote still requires guest name + dates', async () => {
    await expectCode(callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload({ guestName: '', status: 'FINALIZED' })), 'invalid-argument');
  });
  await test('requesting status:FINALIZED on the very first call still requires a positive selling price', async () => {
    await expectCode(callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload({ agencyGuestSellingTotal: 0, status: 'FINALIZED' })), 'invalid-argument');
  });
  await test('requesting status:FINALIZED on the very first call for a partner property with no configured rate is blocked, never a guessed/fallback total', async () => {
    await expectCode(callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload({
      accommodationPropertyId: 'PARTNER-NORATE', accommodationRoomTypeId: 'RT2', status: 'FINALIZED',
    })), 'failed-precondition');
  });

  section('Package identity spoofing');
  await test('a fake/nonexistent packageId is rejected outright', async () => {
    await expectCode(callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload({ packageId: 'FAKE-PACKAGE-ID' })), 'not-found');
  });
  await test('an unassigned/inactive package is rejected outright', async () => {
    await expectCode(callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload({ packageId: 'PKG-A2-INACTIVE' })), 'failed-precondition');
  });
  await test('Agency A cannot use Agency B\'s own package (cross-agency package access)', async () => {
    await expectCode(callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload({ packageId: 'PKG-B1' })), 'not-found');
  });

  section('Partner-property rate spoofing');
  await test('missing partner rate remains "Rate on request" and blocks finalization, even though the room type itself has its own (irrelevant) agencyRate', async () => {
    const draft = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload({ accommodationPropertyId: 'PARTNER-NORATE', accommodationRoomTypeId: 'RT2' }));
    assert.equal(draft.accommodationRateSnapshot, null, 'a DRAFT with no configured rate must show null/"Rate on request", never the room type\'s own agencyRate');
    await expectCode(callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload({
      quoteId: draft.quoteId, accommodationPropertyId: 'PARTNER-NORATE', accommodationRoomTypeId: 'RT2', status: 'FINALIZED',
    })), 'failed-precondition');
  });
  await test('a fake/nonexistent propertyId is rejected outright by resolveAccommodationSelection', async () => {
    await expectCode(callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload({ accommodationPropertyId: 'FAKE-PROPERTY', accommodationRoomTypeId: 'RT1' })), 'invalid-argument');
  });
  await test('a fake/nonexistent roomTypeId for a real property is rejected outright', async () => {
    await expectCode(callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload({ accommodationPropertyId: 'PARTNER1', accommodationRoomTypeId: 'FAKE-ROOMTYPE' })), 'invalid-argument');
  });

  section('DRAFT editing and trusted-field mutation on an existing quote');
  let editableQuoteId;
  await test('an agency can edit her own DRAFT (change dates/adults/selling price) through the same function', async () => {
    const created = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload({ adults: 2 }));
    editableQuoteId = created.quoteId;
    const edited = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload({ quoteId: editableQuoteId, adults: 4, agencyGuestSellingTotal: 1500 }));
    assert.equal(edited.adults, 4);
    assert.equal(edited.viluNetTotal, 800); // 200 * 4
    assert.equal(edited.agencyGuestSellingTotal, 1500);
  });
  await test('editing that same DRAFT with spoofed trusted fields (viluNetTotal/agencyEarnings/status) still only lets the legitimate fields (adults/dates/etc) through', async () => {
    const edited = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload({
      quoteId: editableQuoteId, adults: 3, viluNetTotal: 1, agencyEarnings: 99999,
    }));
    assert.equal(edited.adults, 3);
    assert.equal(edited.viluNetTotal, 600); // 200 * 3, never the spoofed 1
    assert.equal(edited.status, 'DRAFT');
  });

  section('FINALIZED immutability and cross-agency access');
  await test('a FINALIZED quote can never be edited/re-finalized again through this function', async () => {
    const finalized = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload({ quoteId: editableQuoteId, status: 'FINALIZED' }));
    assert.equal(finalized.status, 'FINALIZED');
    await expectCode(callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload({ quoteId: editableQuoteId, agencyGuestSellingTotal: 1 })), 'failed-precondition');
  });
  await test('Agency B cannot edit/finalize Agency A\'s quote by id', async () => {
    await expectCode(callAs(AGENCY_B_UID, AGENCY_B_EMAIL, draftPayload({ quoteId: viluQuoteId, packageId: 'PKG-B1' })), 'permission-denied');
  });
  await test('a non-agency caller is refused outright', async () => {
    await db.collection('users').doc('staffperson2@example.com').set({ email: 'staffperson2@example.com', role: 'staff' });
    await expectCode(callAs('staff-uid-2', 'staffperson2@example.com', draftPayload()), 'permission-denied');
  });

  section('Invalid guest selling price');
  await test('a negative selling price is clamped to 0, never a negative stored value', async () => {
    const result = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload({ agencyGuestSellingTotal: -500 }));
    assert.equal(result.agencyGuestSellingTotal, 0);
  });
  await test('a NaN selling price is rejected cleanly, not stored as NaN', async () => {
    await expectCode(callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload({ agencyGuestSellingTotal: 'not-a-number' })), 'invalid-argument');
  });
  await test('an Infinity selling price is rejected cleanly', async () => {
    await expectCode(callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload({ agencyGuestSellingTotal: Infinity })), 'invalid-argument');
  });
  await test('an absurdly high but finite selling price is bounded, not stored verbatim', async () => {
    const result = await callAs(AGENCY_A_UID, AGENCY_A_EMAIL, draftPayload({ agencyGuestSellingTotal: 999999999 }));
    assert.equal(result.agencyGuestSellingTotal, 500000);
  });

  console.log(`\n${passed}/${passed + failed} assigned-package-quote-security (emulator + Cloud Function) assertions passed`);
})().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
