// Multi-Property Availability & Hotel Selection in Quotes -- proven for
// real against the Firestore emulator + the actual Cloud Functions, same
// pattern as the other -rules suites in this repo.
//
// Run via:
//   firebase emulators:exec --only firestore "node test/multi-property-availability-rules.test.js"
const assert = require('node:assert/strict');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');

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
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  process.env.GCLOUD_PROJECT = 'vilu-residence';
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'vilu-residence' });

  const functionsTest = require('firebase-functions-test')({ projectId: 'vilu-residence' });
  const myFunctions = require('../functions-core/index.js');
  const path = require('node:path');
  const firebaseAdminFirestorePath = require.resolve('firebase-admin/firestore', { paths: [path.join(__dirname, '..', 'functions-core')] });
  const { getFirestore } = require(firebaseAdminFirestorePath);
  const db = getFirestore();

  const getPropertiesWrapped = functionsTest.wrap(myFunctions.getAgencyProperties);
  const getRoomTypesWrapped = functionsTest.wrap(myFunctions.getAgencyPropertyRoomTypes);
  const getAvailWrapped = functionsTest.wrap(myFunctions.getAgencyAvailability);
  const submitCustomQuoteWrapped = functionsTest.wrap(myFunctions.submitAgencyCustomQuote);
  const confirmAccWrapped = functionsTest.wrap(myFunctions.confirmAccommodationBookingRequest);
  const rejectAccWrapped = functionsTest.wrap(myFunctions.rejectAccommodationBookingRequest);

  function quoteIdWithRateForRules(){ return 'VQ-RULES-TEST'; }
  let _testEnv = null;
  async function getTestEnvForRules(){
    if(_testEnv) return _testEnv;
    const rules = require('node:fs').readFileSync('firestore.rules', 'utf8');
    _testEnv = await initializeTestEnvironment({ projectId: 'vilu-residence', firestore: { rules, host: '127.0.0.1', port: 8080 } });
    return _testEnv;
  }

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

  async function seedUser(email, role) {
    await db.collection('users').doc(email).set({ email, role, name: email.split('@')[0] }, { merge: true });
  }
  async function seedProperty(id, overrides) {
    await db.collection('accommodation_properties').doc(id).set(Object.assign({
      propertyName: 'Test Partner ' + id, propertyType: 'Guesthouse', location: 'Test Island',
      availabilityMode: 'MANUAL_INVENTORY', displayOrder: 10, active: true, visibleToAgencies: true,
      notesInternal: 'private contract notes', isVilu: false,
    }, overrides || {}));
  }
  async function seedRoomType(propertyId, rtId, overrides) {
    await db.collection('accommodation_properties').doc(propertyId).collection('room_types').doc(rtId).set(Object.assign({
      roomTypeName: 'Standard Room', capacity: 2, agencyRate: 100, currency: 'USD', active: true, visibleToAgencies: true,
    }, overrides || {}));
  }

  await seedUser(AGENCY_A_EMAIL, 'agency');
  await seedUser(AGENCY_B_EMAIL, 'agency');
  await seedUser('staff@example.com', 'staff');

  section('Part 1/11/19: getAgencyProperties -- Vilu always first, only approved partners visible');
  {
    await seedProperty('PARTNER_OK', {});
    await seedProperty('PARTNER_INACTIVE', { active: false, visibleToAgencies: true });
    await seedProperty('PARTNER_HIDDEN', { active: true, visibleToAgencies: false });

    await test('Vilu Residence is always first, synthesized, never a stored doc', async () => {
      const r = await callAs(getPropertiesWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {});
      assert.equal(r.properties[0].propertyId, 'VILU');
      assert.equal(r.properties[0].isVilu, true);
      const viluDoc = await db.collection('accommodation_properties').doc('VILU').get();
      assert.equal(viluDoc.exists, false, 'Vilu must never be a Firestore doc in this collection');
    });
    await test('only the active + visibleToAgencies partner is returned; inactive and hidden partners are excluded', async () => {
      const r = await callAs(getPropertiesWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {});
      const ids = r.properties.map((p) => p.propertyId);
      assert.ok(ids.includes('PARTNER_OK'));
      assert.ok(!ids.includes('PARTNER_INACTIVE'));
      assert.ok(!ids.includes('PARTNER_HIDDEN'));
    });
    // Hotel-selection live-bug investigation (2026-09-12): production-shaped
    // documents can have active/visibleToAgencies typed as a string or
    // number if Vilu staff ever hand-edited a doc directly in the Firebase
    // console (the PMS admin UI itself always sends a real boolean, but
    // nothing stops a direct console edit) -- a strict `.where(...,'==',true)`
    // query would silently exclude such a property forever, with no error
    // anywhere. This proves the loose-but-still-safe isFlagOn() tolerance.
    await seedProperty('PARTNER_STRINGFLAGS', { active: 'true', visibleToAgencies: 'true' });
    await seedProperty('PARTNER_NUMFLAGS', { active: 1, visibleToAgencies: 1 });
    // Written directly (not via seedProperty, whose own defaults would
    // silently re-add `active: true`) so `active` is genuinely absent.
    await db.collection('accommodation_properties').doc('PARTNER_MISSINGFLAG').set({
      propertyName: 'Test Partner PARTNER_MISSINGFLAG', propertyType: 'Guesthouse', location: 'Test Island',
      availabilityMode: 'MANUAL_INVENTORY', displayOrder: 10, visibleToAgencies: true, isVilu: false,
    });
    await seedProperty('PARTNER_FALSESTRING', { active: 'false', visibleToAgencies: true }); // must stay excluded
    await test('a property with active/visibleToAgencies typed as the STRING "true" is still returned, not silently hidden', async () => {
      const r = await callAs(getPropertiesWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {});
      const ids = r.properties.map((p) => p.propertyId);
      assert.ok(ids.includes('PARTNER_STRINGFLAGS'), 'a hand-typed string "true" must not be silently excluded');
    });
    await test('a property with active/visibleToAgencies typed as the NUMBER 1 is still returned', async () => {
      const r = await callAs(getPropertiesWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {});
      const ids = r.properties.map((p) => p.propertyId);
      assert.ok(ids.includes('PARTNER_NUMFLAGS'), 'a hand-typed 1 must not be silently excluded');
    });
    await test('a property with the active field missing entirely stays excluded (never defaults to visible)', async () => {
      const r = await callAs(getPropertiesWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {});
      const ids = r.properties.map((p) => p.propertyId);
      assert.ok(!ids.includes('PARTNER_MISSINGFLAG'), 'a missing field must never be treated as true -- this is tolerance, not a security loosening');
    });
    await test('a property with active explicitly "false" (string) stays excluded -- the tolerance only widens what counts as true, never what counts as false', async () => {
      const r = await callAs(getPropertiesWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {});
      const ids = r.properties.map((p) => p.propertyId);
      assert.ok(!ids.includes('PARTNER_FALSESTRING'));
    });
    await test('the response never includes notesInternal or any other internal-only field', async () => {
      const r = await callAs(getPropertiesWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {});
      const json = JSON.stringify(r);
      assert.doesNotMatch(json, /notesInternal|private contract notes/);
    });
    await test('a staff/admin caller is refused (this callable is agency-only, matching getAgencyAvailability)', async () => {
      await expectCode(callAs(getPropertiesWrapped, 'staff-uid', 'staff@example.com', {}), 'permission-denied');
    });
    await test('an unauthenticated caller is refused', async () => {
      await expectCode(getPropertiesWrapped({ data: {} }), 'unauthenticated');
    });
  }

  section('Part 11: getAgencyPropertyRoomTypes -- only active + visible room types, never internal fields');
  {
    await seedRoomType('PARTNER_OK', 'RT_OK', {});
    await seedRoomType('PARTNER_OK', 'RT_INACTIVE', { active: false });
    await seedRoomType('PARTNER_OK', 'RT_NORATE', { agencyRate: null });
    await seedRoomType('PARTNER_OK', 'RT_STRINGFLAG', { active: 'true', visibleToAgencies: 'true' });

    await test('a room type with active/visibleToAgencies typed as the string "true" is still returned (same tolerance as getAgencyProperties)', async () => {
      const r = await callAs(getRoomTypesWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { propertyId: 'PARTNER_OK' });
      const ids = r.roomTypes.map((rt) => rt.roomTypeId);
      assert.ok(ids.includes('RT_STRINGFLAG'));
    });
    await test('only active + visible room types are returned', async () => {
      const r = await callAs(getRoomTypesWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { propertyId: 'PARTNER_OK' });
      const ids = r.roomTypes.map((rt) => rt.roomTypeId);
      assert.ok(ids.includes('RT_OK'));
      assert.ok(ids.includes('RT_NORATE'));
      assert.ok(!ids.includes('RT_INACTIVE'));
    });
    await test('a room type with no agencyRate configured returns agencyRate: null ("Rate on request"), never a guessed number', async () => {
      const r = await callAs(getRoomTypesWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { propertyId: 'PARTNER_OK' });
      const rt = r.roomTypes.find((x) => x.roomTypeId === 'RT_NORATE');
      assert.equal(rt.agencyRate, null);
    });
    await test('an inactive/hidden property refuses room-type listing outright', async () => {
      await expectCode(callAs(getRoomTypesWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { propertyId: 'PARTNER_HIDDEN' }), 'not-found');
    });
    await test('VILU is rejected -- room types are only ever a partner-property concept', async () => {
      await expectCode(callAs(getRoomTypesWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { propertyId: 'VILU' }), 'invalid-argument');
    });
  }

  section('Part 3/10/18: getAgencyAvailability({propertyId}) -- MANUAL_INVENTORY and ON_REQUEST, never a fake AVAILABLE state');
  {
    await db.collection('accommodation_properties').doc('PARTNER_OK').collection('room_types').doc('RT_OK')
      .collection('manual_availability').doc('data').set({ blockedDates: { '2028-06-05': true } });

    await test('a date not in blockedDates shows AVAILABLE; a date in blockedDates shows BLOCKED', async () => {
      const r = await callAs(getAvailWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { propertyId: 'PARTNER_OK', startDate: '2028-06-01', endDate: '2028-06-10' });
      const byDate = {}; r.days.forEach((d) => { if (d.roomTypeId === 'RT_OK') byDate[d.date] = d.state; });
      assert.equal(byDate['2028-06-04'], 'AVAILABLE');
      assert.equal(byDate['2028-06-05'], 'BLOCKED');
    });
    await test('no ownReservations/guest data ever appears for a partner property (Part 10/17: no per-guest tracking at all)', async () => {
      const r = await callAs(getAvailWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { propertyId: 'PARTNER_OK', startDate: '2028-06-01', endDate: '2028-06-05' });
      assert.deepEqual(r.ownReservations, {});
    });
    await test('roomTypes in the response include agencyRate but never any internal field', async () => {
      const r = await callAs(getAvailWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { propertyId: 'PARTNER_OK', startDate: '2028-06-01', endDate: '2028-06-03' });
      const rt = r.roomTypes.find((x) => x.roomTypeId === 'RT_OK');
      assert.equal(rt.agencyRate, 100);
      assert.doesNotMatch(JSON.stringify(r), /notesInternal/);
    });

    await seedProperty('PARTNER_ONREQ', { availabilityMode: 'ON_REQUEST' });
    await seedRoomType('PARTNER_ONREQ', 'RT_ONREQ', { agencyRate: null });
    await test('ON_REQUEST property: EVERY date is ON_REQUEST, never AVAILABLE, regardless of any manual data', async () => {
      const r = await callAs(getAvailWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { propertyId: 'PARTNER_ONREQ', startDate: '2028-06-01', endDate: '2028-06-05' });
      assert.ok(r.days.length > 0);
      assert.ok(r.days.every((d) => d.state === 'ON_REQUEST'));
    });
    await test('a property that is inactive or not visible to agencies refuses availability entirely', async () => {
      await expectCode(callAs(getAvailWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { propertyId: 'PARTNER_HIDDEN', startDate: '2028-06-01', endDate: '2028-06-03' }), 'permission-denied');
    });
    await test('omitting propertyId (or passing VILU explicitly) is completely unaffected -- identical to the pre-existing Vilu-only behavior', async () => {
      const r1 = await callAs(getAvailWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { startDate: '2028-06-01', endDate: '2028-06-03' });
      const r2 = await callAs(getAvailWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { propertyId: 'VILU', startDate: '2028-06-01', endDate: '2028-06-03' });
      assert.deepEqual(r1.rooms, r2.rooms);
      assert.equal(r1.days.length, r2.days.length);
    });
    await test('the same 90-day cap applies to a partner propertyId request (server bound, not a new unbounded path)', async () => {
      await expectCode(callAs(getAvailWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { propertyId: 'PARTNER_OK', startDate: '2028-01-01', endDate: '2028-06-01' }), 'invalid-argument');
    });
  }

  section('Part 11-14: submitAgencyCustomQuote -- accommodation resolution, rate authority, missing-rate block');
  {
    let quoteIdWithRate, quoteIdNoRate;
    await test('a Vilu (default) custom quote is completely unaffected by this feature -- no accommodation fields change its total', async () => {
      const r = await callAs(submitCustomQuoteWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {
        guestName: 'MP Guest', arrivalDate: '2028-07-01', departureDate: '2028-07-03', adults: 2,
        selectedComponents: [{ sourceType: 'global_setting', sourceId: 'extraNightRate', quantity: 1 }],
        status: 'DRAFT',
      });
      assert.equal(r.accommodationIsVilu, true);
      assert.equal(r.accommodationPropertyId, 'VILU');
      assert.equal(r.viluNetTotal, 40); // extraNightRate default, no accommodation line added
    });
    await test('selecting a partner property + room type WITH a configured rate adds rate*nights as a real, separate, server-computed line', async () => {
      const r = await callAs(submitCustomQuoteWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {
        guestName: 'MP Guest 2', arrivalDate: '2028-07-01', departureDate: '2028-07-03', adults: 2,
        selectedComponents: [{ sourceType: 'global_setting', sourceId: 'extraNightRate', quantity: 1 }],
        accommodationPropertyId: 'PARTNER_OK', accommodationRoomTypeId: 'RT_OK',
        status: 'DRAFT',
      });
      quoteIdWithRate = r.quoteId;
      assert.equal(r.accommodationIsVilu, false);
      assert.equal(r.accommodationRateSnapshot, 100);
      assert.equal(r.accommodationTotal, 200); // 100/night * 2 nights
      assert.equal(r.viluNetTotal, 240); // 40 (extraNightRate) + 200 (accommodation)
    });
    await test('a spoofed client-supplied rate/name is never trusted -- only sourceId/propertyId/roomTypeId are read, the server re-resolves everything', async () => {
      const src = require('fs').readFileSync('functions-core/index.js', 'utf8');
      const fnStart = src.indexOf('async function resolveAccommodationSelection');
      const fnSlice = src.slice(fnStart, src.indexOf('\n}', fnStart));
      assert.doesNotMatch(fnSlice, /d\.accommodationRate|d\.rate\b|d\.propertyName|d\.roomTypeName/);
    });
    await test('a DRAFT quote with a partner property that has NO configured rate is allowed (still just a draft)', async () => {
      const r = await callAs(submitCustomQuoteWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {
        guestName: 'MP Guest 3', arrivalDate: '2028-07-01', departureDate: '2028-07-03', adults: 2,
        selectedComponents: [{ sourceType: 'global_setting', sourceId: 'extraNightRate', quantity: 1 }],
        accommodationPropertyId: 'PARTNER_OK', accommodationRoomTypeId: 'RT_NORATE',
        agencyGuestSellingTotal: 500,
        status: 'DRAFT',
      });
      quoteIdNoRate = r.quoteId;
      assert.equal(r.accommodationRateSnapshot, null);
      assert.equal(r.accommodationTotal, 0);
    });
    await test('FINALIZING a quote with a partner property that has NO configured rate is BLOCKED server-side -- never a fake total', async () => {
      await expectCode(callAs(submitCustomQuoteWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {
        quoteId: quoteIdNoRate,
        guestName: 'MP Guest 3', arrivalDate: '2028-07-01', departureDate: '2028-07-03', adults: 2,
        selectedComponents: [{ sourceType: 'global_setting', sourceId: 'extraNightRate', quantity: 1 }],
        accommodationPropertyId: 'PARTNER_OK', accommodationRoomTypeId: 'RT_NORATE',
        agencyGuestSellingTotal: 500,
        status: 'FINALIZED',
      }), 'failed-precondition');
    });
    await test('an inactive/hidden partner property is rejected outright, even for a DRAFT', async () => {
      await expectCode(callAs(submitCustomQuoteWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {
        guestName: 'MP Guest 4', arrivalDate: '2028-07-01', departureDate: '2028-07-03', adults: 2,
        selectedComponents: [{ sourceType: 'global_setting', sourceId: 'extraNightRate', quantity: 1 }],
        accommodationPropertyId: 'PARTNER_HIDDEN', accommodationRoomTypeId: 'RT_OK',
        status: 'DRAFT',
      }), 'invalid-argument');
    });
    await test('the finalized quote snapshots propertyName/roomTypeName/rate/currency/availabilityMode -- stable even if the property is edited later (Part 14)', async () => {
      const finalized = await callAs(submitCustomQuoteWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, {
        quoteId: quoteIdWithRate,
        guestName: 'MP Guest 2', arrivalDate: '2028-07-01', departureDate: '2028-07-03', adults: 2,
        selectedComponents: [{ sourceType: 'global_setting', sourceId: 'extraNightRate', quantity: 1 }],
        accommodationPropertyId: 'PARTNER_OK', accommodationRoomTypeId: 'RT_OK',
        agencyGuestSellingTotal: 500,
        status: 'FINALIZED',
      });
      assert.equal(finalized.accommodationPropertyName, 'Test Partner PARTNER_OK');
      assert.equal(finalized.accommodationRoomTypeName, 'Standard Room');
      await db.collection('accommodation_properties').doc('PARTNER_OK').set({ propertyName: 'Renamed Later' }, { merge: true });
      const reread = await db.collection('agency_quotes').doc(quoteIdWithRate).get();
      assert.equal(reread.data().accommodationPropertyName, 'Test Partner PARTNER_OK', 'a finalized quote must never reflect a later rename');
      await db.collection('accommodation_properties').doc('PARTNER_OK').set({ propertyName: 'Test Partner PARTNER_OK' }, { merge: true }); // restore
    });
  }

  section('Part 16/17/24: accommodation_booking_requests -- rules-gated create, staff-only confirm/reject, cross-agency isolation');
  {
    let reqId;
    await test('an agency can create her own AVAILABILITY_REQUESTED request directly (rules-gated write)', async () => {
      const ref = db.collection('accommodation_booking_requests').doc();
      reqId = ref.id;
      const { assertSucceeds } = require('@firebase/rules-unit-testing');
      const env = await getTestEnvForRules();
      const agencyDb = env.authenticatedContext(AGENCY_A_UID, { email: AGENCY_A_EMAIL }).firestore();
      await assertSucceeds(agencyDb.collection('accommodation_booking_requests').doc(reqId).set({
        agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL, agencyName: 'Agency A',
        quoteId: quoteIdWithRateForRules(), quoteReference: 'Q1',
        guestName: 'Guest', arrivalDate: '2028-07-01', departureDate: '2028-07-03', nights: 2,
        adults: 2, children: 0,
        propertyId: 'PARTNER_OK', propertyName: 'Test Partner PARTNER_OK', roomTypeId: 'RT_OK', roomTypeName: 'Standard Room',
        accommodationRateSnapshot: 100, accommodationCurrency: 'USD', availabilityMode: 'MANUAL_INVENTORY',
        currency: 'USD', agencyGuestSellingTotal: 500,
        status: 'AVAILABILITY_REQUESTED',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        confirmedAt: null, confirmedBy: null, rejectedAt: null, rejectedBy: null, rejectionReason: null,
      }));
    });
    await test('an agency cannot self-write status: PARTNER_CONFIRMED at create time', async () => {
      const { assertFails } = require('@firebase/rules-unit-testing');
      const env = await getTestEnvForRules();
      const agencyDb = env.authenticatedContext(AGENCY_A_UID, { email: AGENCY_A_EMAIL }).firestore();
      await assertFails(agencyDb.collection('accommodation_booking_requests').doc().set({
        agencyId: AGENCY_A_UID, status: 'PARTNER_CONFIRMED',
      }));
    });
    await test('Agency B cannot read Agency A\'s accommodation_booking_requests doc', async () => {
      const { assertFails } = require('@firebase/rules-unit-testing');
      const env = await getTestEnvForRules();
      const bDb = env.authenticatedContext(AGENCY_B_UID, { email: AGENCY_B_EMAIL }).firestore();
      await assertFails(bDb.collection('accommodation_booking_requests').doc(reqId).get());
    });
    await test('an agency caller cannot call confirmAccommodationBookingRequest/rejectAccommodationBookingRequest at all', async () => {
      await expectCode(callAs(confirmAccWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { requestId: reqId }), 'permission-denied');
      await expectCode(callAs(rejectAccWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { requestId: reqId }), 'permission-denied');
    });
    await test('staff can confirm a pending request', async () => {
      const r = await callAs(confirmAccWrapped, 'staff-uid', 'staff@example.com', { requestId: reqId });
      assert.equal(r.status, 'PARTNER_CONFIRMED');
    });
    await test('confirming an already-decided request is rejected (failed-precondition), not silently re-processed', async () => {
      await expectCode(callAs(confirmAccWrapped, 'staff-uid', 'staff@example.com', { requestId: reqId }), 'failed-precondition');
    });
  }

  section('Part 21/24: accommodation_properties rules -- admin/staff/manager write, agency read only when active+visible');
  {
    await test('an agency cannot write accommodation_properties directly', async () => {
      const { assertFails } = require('@firebase/rules-unit-testing');
      const env = await getTestEnvForRules();
      const agencyDb = env.authenticatedContext(AGENCY_A_UID, { email: AGENCY_A_EMAIL }).firestore();
      await assertFails(agencyDb.collection('accommodation_properties').doc('HACK').set({ propertyName: 'x', active: true, visibleToAgencies: true }));
    });
    await test('an agency cannot read an inactive/hidden property document directly either (belt and braces alongside the callables\' own filtering)', async () => {
      const { assertFails } = require('@firebase/rules-unit-testing');
      const env = await getTestEnvForRules();
      const agencyDb = env.authenticatedContext(AGENCY_A_UID, { email: AGENCY_A_EMAIL }).firestore();
      await assertFails(agencyDb.collection('accommodation_properties').doc('PARTNER_HIDDEN').get());
    });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (_testEnv) await _testEnv.cleanup();
  if (failed) process.exit(1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
