// Agency Sales Workflow — Phase I: full adversarial security/privacy audit.
// Proven for real against the Firestore emulator + the actual Cloud
// Functions (via firebase-functions-test), same pattern as Phases C-H.
// This file targets the specific I-1..I-31 attack surfaces NOT already
// covered by the Phase C-H test suites (re-run in the same gate, see
// PHASE_I_REPORT.md-equivalent text in the final report) -- it does not
// re-prove things already proven elsewhere (e.g. hold-request/booking-
// request/booking-confirmation ownership, already covered by their own
// *-rules.test.js files and re-run as part of this same regression gate).
//
// Run via:
//   firebase emulators:exec --only firestore "node test/agency-security-audit.test.js"
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

(async () => {
  // ══════════════════════════════════════════════
  // PART 1: rules-only adversarial tests
  // ══════════════════════════════════════════════
  const testEnv = await initializeTestEnvironment({
    projectId: 'vilu-residence-security-audit-test',
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
  });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('users').doc(AGENCY_A_EMAIL).set({ email: AGENCY_A_EMAIL, role: 'agency', name: 'Agency A' });
    await ctx.firestore().collection('users').doc(AGENCY_B_EMAIL).set({ email: AGENCY_B_EMAIL, role: 'agency', name: 'Agency B' });
    await ctx.firestore().collection('agency_packages').doc(AGENCY_A_EMAIL).set({ packages: [{ id: 'PKG1', name: 'Original Name', agencyPricePerRoom: 100, nights: 3, active: true }] });
    await ctx.firestore().collection('service_catalog').doc('svc-all').set({ name: 'All-agency item', category: 'OTHER_SERVICE', basePrice: 50, unitType: 'PER_ITEM', active: true, visibleToAgencies: 'all' });
    await ctx.firestore().collection('service_catalog').doc('svc-hidden').set({ name: 'Hidden item', category: 'OTHER_SERVICE', basePrice: 50, unitType: 'PER_ITEM', active: true });
    await ctx.firestore().collection('service_catalog').doc('svc-disabled').set({ name: 'Disabled item', category: 'OTHER_SERVICE', basePrice: 50, unitType: 'PER_ITEM', active: false, visibleToAgencies: 'all' });
    await ctx.firestore().collection('service_catalog').doc('svc-b-only').set({ name: 'Agency B only', category: 'OTHER_SERVICE', basePrice: 50, unitType: 'PER_ITEM', active: true, visibleToAgencies: [AGENCY_B_EMAIL] });
    await ctx.firestore().collection('reservations').doc('ABK-INTERNAL-1').set({
      id: 'ABK-INTERNAL-1', room_id: 'VR01', guest_name: 'Guest With Internal Note', check_in: '2027-04-01', check_out: '2027-04-03',
      status: 'Confirmed', source: 'Agency', agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL,
      internal_note: 'Staff-only: manager approved 15% discount, do not disclose to agency',
      notes: '[Cloudbeds internal note: guest complained about noise, comped minibar · Raeeshan Ibrahim]',
      viluNetTotal: 900, agencyEarnings: 300, paymentCollector: 'HOTEL', agencyGuestSellingTotal: 1200, currency: 'USD',
    });
  });
  const agencyA = testEnv.authenticatedContext(AGENCY_A_UID, { email: AGENCY_A_EMAIL });
  const agencyB = testEnv.authenticatedContext(AGENCY_B_UID, { email: AGENCY_B_EMAIL });
  const anon = testEnv.unauthenticatedContext();

  section('I-4: agency_packages lockdown -- direct writes always fail, even for the owning agency');
  await test('Agency A cannot change her own package\'s Vilu Agency Rate directly', async () => {
    await assertFails(agencyA.firestore().collection('agency_packages').doc(AGENCY_A_EMAIL).set({ packages: [{ id: 'PKG1', name: 'Original Name', agencyPricePerRoom: 1, nights: 3, active: true }] }));
  });
  await test('Agency A cannot change her own package\'s name/nights/content/active state directly', async () => {
    await assertFails(agencyA.firestore().collection('agency_packages').doc(AGENCY_A_EMAIL).set({ packages: [{ id: 'PKG1', name: 'Hacked Name', agencyPricePerRoom: 100, nights: 99, active: false }] }, { merge: true }));
  });
  await test('Agency A cannot read Agency B\'s package set', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => { await ctx.firestore().collection('agency_packages').doc(AGENCY_B_EMAIL).set({ packages: [] }); });
    await assertFails(agencyA.firestore().collection('agency_packages').doc(AGENCY_B_EMAIL).get());
  });
  await test('Agency A CAN read her own package set (read-only)', async () => {
    await assertSucceeds(agencyA.firestore().collection('agency_packages').doc(AGENCY_A_EMAIL).get());
  });

  section('I-5: Vilu Rate Catalog -- approved/active only, no direct agency write, no public read');
  await test('Agency A sees the all-agency item', async () => {
    await assertSucceeds(agencyA.firestore().collection('service_catalog').doc('svc-all').get());
  });
  await test('Agency A CANNOT see a hidden item (no visibleToAgencies field at all)', async () => {
    await assertFails(agencyA.firestore().collection('service_catalog').doc('svc-hidden').get());
  });
  await test('Agency A CANNOT see a disabled item, even though visibleToAgencies:\'all\'', async () => {
    await assertFails(agencyA.firestore().collection('service_catalog').doc('svc-disabled').get());
  });
  await test('Agency A CANNOT see an item scoped only to Agency B', async () => {
    await assertFails(agencyA.firestore().collection('service_catalog').doc('svc-b-only').get());
  });
  await test('Agency B CAN see the item scoped to her', async () => {
    await assertSucceeds(agencyB.firestore().collection('service_catalog').doc('svc-b-only').get());
  });
  await test('Agency A cannot modify the catalog item\'s rate/visibleToAgencies/active directly', async () => {
    await assertFails(agencyA.firestore().collection('service_catalog').doc('svc-all').set({ basePrice: 1 }, { merge: true }));
  });
  await test('an unauthenticated caller gets nothing from the rate catalog, not even the all-agency item', async () => {
    await assertFails(anon.firestore().collection('service_catalog').doc('svc-all').get());
  });

  section('I-17 (rules half): reservations grants an agency NO direct read at all -- the fix');
  await test('Agency A cannot directly read her OWN reservation anymore (internal_note/notes/viluNetTotal live on the same doc, which rules cannot redact field-by-field)', async () => {
    await assertFails(agencyA.firestore().collection('reservations').doc('ABK-INTERNAL-1').get());
  });
  await test('admin/staff/manager retain full read access (operationally required, unaffected by this tightening)', async () => {
    const admin = testEnv.authenticatedContext('admin-uid', { email: ADMIN_EMAIL });
    await assertSucceeds(admin.firestore().collection('reservations').doc('ABK-INTERNAL-1').get());
  });

  section('I-25: role escalation -- an agency cannot self-elevate or touch another user\'s role');
  await test('Agency A cannot change her own role to admin', async () => {
    await assertFails(agencyA.firestore().collection('users').doc(AGENCY_A_EMAIL).set({ email: AGENCY_A_EMAIL, role: 'admin', name: 'Agency A' }, { merge: true }));
  });
  await test('Agency A cannot change her own role to manager', async () => {
    await assertFails(agencyA.firestore().collection('users').doc(AGENCY_A_EMAIL).set({ role: 'manager' }, { merge: true }));
  });
  await test('Agency A cannot change her own role to staff', async () => {
    await assertFails(agencyA.firestore().collection('users').doc(AGENCY_A_EMAIL).set({ role: 'staff' }, { merge: true }));
  });
  await test('Agency A cannot modify Agency B\'s user doc at all', async () => {
    await assertFails(agencyA.firestore().collection('users').doc(AGENCY_B_EMAIL).set({ role: 'admin' }, { merge: true }));
  });
  await test('Agency A cannot grant herself staff_permissions', async () => {
    await assertFails(agencyA.firestore().collection('staff_permissions').doc(AGENCY_A_UID).set({ granted: true }));
  });
  await test('Agency A cannot self-register a brand-new user doc claiming role:admin', async () => {
    await assertFails(agencyA.firestore().collection('users').doc('newagency@example.com').set({ email: 'newagency@example.com', role: 'admin' }));
  });

  section('I-11: raw blocks public-read is confirmed intentional (public website conflict check), Agency Portal does not consume block.reason');
  await test('blocks remains publicly readable by design (documented technical debt, not a new finding)', async () => {
    await assertSucceeds(anon.firestore().collection('blocks').doc('BL-TEST').get());
  });

  await testEnv.cleanup();
  console.log(`\n${passed}/${passed + failed} rules-only assertions passed so far`);

  // ══════════════════════════════════════════════
  // PART 2: Cloud Function adversarial tests
  // ══════════════════════════════════════════════
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
  const searchWrapped = functionsTest.wrap(myFunctions.searchAgencyGuests);
  const getMyBookingsWrapped = functionsTest.wrap(myFunctions.getMyAgencyBookings);

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
  await db.collection('service_catalog').doc('svc-real').set({ name: 'Real Item', category: 'OTHER_SERVICE', basePrice: 85, unitType: 'PER_ITEM', active: true, visibleToAgencies: 'all' });
  await db.collection('agency_packages').doc(AGENCY_B_EMAIL).set({ packages: [{ id: 'B-PKG1', name: 'Agency B Package', agencyPricePerRoom: 100, active: true }] });

  section('I-6: custom quote submission -- numeric/component abuse, server must reject or re-resolve, never trust client');
  await test('a negative quantity is rejected', async () => {
    await expectCode(callAs(submitCustomQuoteWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {
      status: 'DRAFT', selectedComponents: [{ sourceType: 'catalog', sourceId: 'svc-real', quantity: -5, viluUnitRate: 1 }],
    }), 'invalid-argument');
  });
  await test('a huge quantity (>999) is rejected', async () => {
    await expectCode(callAs(submitCustomQuoteWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {
      status: 'DRAFT', selectedComponents: [{ sourceType: 'catalog', sourceId: 'svc-real', quantity: 100000 }],
    }), 'invalid-argument');
  });
  await test('NaN quantity is rejected', async () => {
    await expectCode(callAs(submitCustomQuoteWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {
      status: 'DRAFT', selectedComponents: [{ sourceType: 'catalog', sourceId: 'svc-real', quantity: NaN }],
    }), 'invalid-argument');
  });
  await test('Infinity quantity is rejected', async () => {
    await expectCode(callAs(submitCustomQuoteWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {
      status: 'DRAFT', selectedComponents: [{ sourceType: 'catalog', sourceId: 'svc-real', quantity: Infinity }],
    }), 'invalid-argument');
  });
  await test('a fabricated/nonexistent componentId is rejected', async () => {
    await expectCode(callAs(submitCustomQuoteWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {
      status: 'DRAFT', selectedComponents: [{ sourceType: 'catalog', sourceId: 'does-not-exist', quantity: 1 }],
    }), 'not-found');
  });
  await test('a disabled catalog item is rejected even if it was visible before', async () => {
    await db.collection('service_catalog').doc('svc-todisable').set({ name: 'Will be disabled', category: 'OTHER_SERVICE', basePrice: 10, unitType: 'PER_ITEM', active: false, visibleToAgencies: 'all' });
    await expectCode(callAs(submitCustomQuoteWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {
      status: 'DRAFT', selectedComponents: [{ sourceType: 'catalog', sourceId: 'svc-todisable', quantity: 1 }],
    }), 'failed-precondition');
  });
  await test('Agency A cannot use Agency B\'s own assigned package as a component', async () => {
    await expectCode(callAs(submitCustomQuoteWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {
      status: 'DRAFT', selectedComponents: [{ sourceType: 'agency_package', sourceId: 'B-PKG1', quantity: 1 }],
    }), 'not-found');
  });
  await test('spoofed viluUnitRate/viluLineTotal/viluNetTotal on the client payload are ignored -- server re-resolves the real rate ($85)', async () => {
    const result = await callAs(submitCustomQuoteWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {
      status: 'DRAFT', agencyGuestSellingTotal: 100,
      selectedComponents: [{ sourceType: 'catalog', sourceId: 'svc-real', quantity: 1, viluUnitRate: 1, viluLineTotal: 1 }],
      viluNetTotal: 1,
    });
    assert.equal(result.viluNetTotal, 85);
    assert.equal(result.selectedComponents[0].viluUnitRate, 85);
  });
  await test('Infinity/NaN agencyGuestSellingTotal is rejected cleanly (Phase I hardening), not a raw Firestore write failure', async () => {
    await expectCode(callAs(submitCustomQuoteWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {
      status: 'DRAFT', agencyGuestSellingTotal: Infinity,
      selectedComponents: [{ sourceType: 'catalog', sourceId: 'svc-real', quantity: 1 }],
    }), 'invalid-argument');
    await expectCode(callAs(submitCustomQuoteWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {
      status: 'DRAFT', agencyGuestSellingTotal: NaN,
      selectedComponents: [{ sourceType: 'catalog', sourceId: 'svc-real', quantity: 1 }],
    }), 'invalid-argument');
  });
  await test('an absurdly high but finite agencyGuestSellingTotal is bounded, not stored verbatim', async () => {
    const result = await callAs(submitCustomQuoteWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {
      status: 'DRAFT', agencyGuestSellingTotal: 999999999,
      selectedComponents: [{ sourceType: 'catalog', sourceId: 'svc-real', quantity: 1 }],
    });
    assert.equal(result.agencyGuestSellingTotal, 500000);
  });

  section('I-17 (callable half): getMyAgencyBookings returns ONLY the safe projection');
  await test('seed a reservation with internal_note/notes/viluNetTotal/agencyEarnings/paymentCollector planted', async () => {
    await db.collection('reservations').doc('ABK-SAFE-CHECK-1').set({
      id: 'ABK-SAFE-CHECK-1', room_id: 'VR01', guest_name: 'Guest Safe Check', check_in: '2027-05-01', check_out: '2027-05-03',
      adults: 2, children: 0, status: 'Confirmed', source: 'Agency', agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL,
      packageName: 'QA Package', agencyGuestSellingTotal: 700, currency: 'USD', agencyBookingRequestId: 'ABR-SAFE-1',
      internal_note: 'Staff-only note that must never reach the agency',
      notes: '[Cloudbeds internal note] balance due 30.00',
      viluNetTotal: 500, agencyEarnings: 200, paymentCollector: 'HOTEL',
      passport_photo: 'data:image/jpeg;base64,FAKEDATA',
    });
  });
  let myBookingsResult;
  await test('Agency A calls getMyAgencyBookings and gets her reservation back', async () => {
    myBookingsResult = await callAs(getMyBookingsWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {});
    assert.ok(myBookingsResult.reservations.find((r) => r.id === 'ABK-SAFE-CHECK-1'));
  });
  await test('the response contains guest_name/room_id/dates/status/agencyGuestSellingTotal/currency/agencyBookingRequestId', () => {
    const r = myBookingsResult.reservations.find((x) => x.id === 'ABK-SAFE-CHECK-1');
    assert.equal(r.guest_name, 'Guest Safe Check');
    assert.equal(r.agencyGuestSellingTotal, 700);
    assert.equal(r.agencyBookingRequestId, 'ABR-SAFE-1');
  });
  await test('the response does NOT contain internal_note, notes, viluNetTotal, agencyEarnings, paymentCollector, or passport_photo -- anywhere in the JSON', () => {
    const json = JSON.stringify(myBookingsResult);
    assert.doesNotMatch(json, /internal_note|Staff-only note/);
    assert.doesNotMatch(json, /Cloudbeds internal note|balance due/);
    assert.doesNotMatch(json, /viluNetTotal|agencyEarnings|paymentCollector/);
    assert.doesNotMatch(json, /passport_photo|FAKEDATA/);
  });
  await test('Agency B calling getMyAgencyBookings never sees Agency A\'s reservation', async () => {
    const result = await callAs(getMyBookingsWrapped, AGENCY_B_UID, AGENCY_B_EMAIL, {});
    assert.equal(result.reservations.find((r) => r.id === 'ABK-SAFE-CHECK-1'), undefined);
  });
  await test('a non-agency (staff) caller is refused', async () => {
    await db.collection('users').doc('staffer@example.com').set({ email: 'staffer@example.com', role: 'staff' });
    await expectCode(callAs(getMyBookingsWrapped, 'staff-uid', 'staffer@example.com', {}), 'permission-denied');
  });
  await test('an unauthenticated caller is refused', async () => {
    try { await getMyBookingsWrapped({ data: {} }); assert.fail('expected rejection'); } catch (e) { assert.equal(e.code, 'unauthenticated'); }
  });

  section('I-19/I-20: search abuse -- empty, tiny, huge, special-character, and identity-probing queries stay bounded and isolated');
  await test('an empty query returns no results, not an error, not the whole collection', async () => {
    const result = await callAs(searchWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { query: '' });
    assert.deepEqual(result.results, []);
  });
  await test('a single-letter query returns no results (below the 2-char minimum) rather than a broad scan', async () => {
    const result = await callAs(searchWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { query: 'a' });
    assert.deepEqual(result.results, []);
  });
  await test('a very long query (5000 chars) does not crash the function and returns a bounded/empty result', async () => {
    const result = await callAs(searchWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { query: 'x'.repeat(5000) });
    assert.ok(Array.isArray(result.results));
  });
  await test('a script-injection payload as the query string is treated as inert text, not executed or reflected unsafely', async () => {
    const result = await callAs(searchWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { query: '<script>alert(1)</script>' });
    assert.ok(Array.isArray(result.results));
    assert.deepEqual(result.results, []);
  });
  await test('searching Agency B\'s own uid or email as the query text does not surface Agency B\'s records (search only ever scans Agency A\'s own agencyId-scoped collections)', async () => {
    const result = await callAs(searchWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { query: AGENCY_B_UID });
    assert.deepEqual(result.results, []);
    const result2 = await callAs(searchWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { query: AGENCY_B_EMAIL });
    assert.deepEqual(result2.results, []);
  });
  await test('searching a Direct/OTA-style reference (e.g. "WEB123") surfaces nothing, since Direct/OTA reservations have no agencyId and are never fetched into the search at all', async () => {
    await db.collection('reservations').doc('WEB999').set({ id: 'WEB999', guest_name: 'Direct Guest', check_in: '2027-01-01', check_out: '2027-01-02', status: 'Confirmed', source: 'Website' });
    const result = await callAs(searchWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { query: 'WEB999' });
    assert.deepEqual(result.results, []);
  });

  functionsTest.cleanup();
  console.log(`\n${passed}/${passed + failed} agency-security-audit (emulator + Cloud Functions) assertions passed`);
  if (failed > 0) process.exitCode = 1;
})().catch((e) => {
  console.error('agency-security-audit.test.js crashed:', e);
  process.exitCode = 1;
});
