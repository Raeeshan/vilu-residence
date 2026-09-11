// Agency Sales Workflow — Phase G: printable guest-safe Booking
// Confirmation, proven for real against the Firestore emulator + the
// actual getAgencyBookingConfirmationData Cloud Function (via
// firebase-functions-test), same pattern as Phases C-F.
//
// Run via:
//   firebase emulators:exec --only firestore "node test/agency-booking-confirmation-rules.test.js"
const assert = require('node:assert/strict');

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
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  process.env.GCLOUD_PROJECT = 'vilu-residence';
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'vilu-residence' });

  const functionsTest = require('firebase-functions-test')({ projectId: 'vilu-residence' });
  const myFunctions = require('../functions-core/index.js');
  const path = require('node:path');
  const firebaseAdminFirestorePath = require.resolve('firebase-admin/firestore', { paths: [path.join(__dirname, '..', 'functions-core')] });
  const { getFirestore } = require(firebaseAdminFirestorePath);
  const db = getFirestore();

  const getConfirmationWrapped = functionsTest.wrap(myFunctions.getAgencyBookingConfirmationData);

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

  await db.collection('users').doc(AGENCY_A_EMAIL).set({ email: AGENCY_A_EMAIL, role: 'agency', name: 'Sunset Travel Agency' });
  await db.collection('users').doc(AGENCY_B_EMAIL).set({ email: AGENCY_B_EMAIL, role: 'agency', name: 'Agency B' });

  // ── Synthetic confirmed booking, containing every kind of internal field
  // the task's Part 24 privacy test asks for, planted directly on the
  // source documents the callable reads -- proving the ALLOWLIST itself
  // keeps them out, not merely that this test forgot to seed them. ──
  async function seedConfirmedBooking(overrides) {
    const o = Object.assign({
      requestId: 'ABR-CONF-1', reservationId: 'ABK-CONF-1', quoteId: 'VQ-CONF-1',
      agencyId: AGENCY_A_UID, agencyEmail: AGENCY_A_EMAIL, agencyName: 'Sunset Travel Agency',
      resStatus: 'Confirmed', reqStatus: 'CONFIRMED',
    }, overrides || {});

    await db.collection('agency_quotes').doc(o.quoteId).set({
      quoteId: o.quoteId, agencyId: o.agencyId, agencyEmail: o.agencyEmail, agencyName: o.agencyName,
      guestName: 'Jane Traveler', arrivalDate: '2027-04-01', departureDate: '2027-04-04', adults: 2, children: 1, nights: 3,
      currency: 'USD', quoteType: 'ASSIGNED_PACKAGE', packageId: 'PKG1', packageName: 'Maamigili Island Escape',
      guestIncludes: ['Airport transfer', 'Daily breakfast'], guestActivities: ['Whale Shark Snorkeling'],
      guestMessage: 'Guest requested a late check-out if possible.',
      selectedComponents: [], viluNetTotal: 1200, agencyGuestSellingTotal: 1450, agencyEarnings: 250, paymentCollector: 'HOTEL',
      status: 'FINALIZED', createdAt: '2026-09-11T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z', finalizedAt: '2026-09-11T00:00:00.000Z',
    });

    await db.collection('agency_booking_requests').doc(o.requestId).set({
      id: o.requestId, agencyId: o.agencyId, agencyEmail: o.agencyEmail, agencyName: o.agencyName,
      quoteId: o.quoteId, quoteReference: o.quoteId,
      guestName: 'Jane Traveler', guestEmail: 'jane.private@example.com', guestPhone: '+960-777-0000',
      arrivalDate: '2027-04-01', departureDate: '2027-04-04', nights: 3, adults: 2, children: 1,
      roomCategory: 'Deluxe Family Room', requestedRoomId: 'VR01', assignedRoomId: 'VR01',
      quoteType: 'ASSIGNED_PACKAGE', packageName: 'Maamigili Island Escape',
      packageSnapshot: { quoteType: 'ASSIGNED_PACKAGE', packageId: 'PKG1', selectedComponents: null, childDiscountPct: 0 },
      guestIncludes: ['Airport transfer', 'Daily breakfast'], guestActivities: ['Whale Shark Snorkeling'],
      currency: 'USD',
      viluNetTotal: 1200, agencyGuestSellingTotal: 1450, agencyEarnings: 250, paymentCollector: 'HOTEL',
      holdRequestId: null, holdBlockId: null,
      status: o.reqStatus, createdAt: '2026-09-11T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z',
      confirmedAt: '2026-09-11T01:00:00.000Z', confirmedBy: 'viluresidence@gmail.com', reservationId: o.reservationId,
      rejectionReason: null, changeRequestNote: null,
    });

    await db.collection('reservations').doc(o.reservationId).set({
      id: o.reservationId, room_id: 'VR01',
      guest_name: 'Jane Traveler', guest_email: 'jane.private@example.com', guest_phone: '+960-777-0000',
      check_in: '2027-04-01', check_out: '2027-04-04', adults: 2, children: 1,
      rate: 1450, status: o.resStatus, source: 'Agency',
      notes: '[Maamigili Island Escape]',
      agencyId: o.agencyId, agencyEmail: o.agencyEmail, agencyName: o.agencyName,
      agencyBookingRequestId: o.requestId, agencyQuoteId: o.quoteId, agencyQuoteReference: o.quoteId,
      quoteType: 'ASSIGNED_PACKAGE', packageName: 'Maamigili Island Escape',
      packageSnapshot: { quoteType: 'ASSIGNED_PACKAGE', packageId: 'PKG1', selectedComponents: [
        { name: 'Deluxe Family Room', category: 'ACCOMMODATION_BASE', viluUnitRate: 90, quantity: 3, viluLineTotal: 270 },
        { name: 'Whale Shark Snorkeling', category: 'TRIPS_ACTIVITIES', viluUnitRate: 72, quantity: 2, viluLineTotal: 144 },
      ], childDiscountPct: 0 },
      guestIncludes: ['Airport transfer', 'Daily breakfast'], guestActivities: ['Whale Shark Snorkeling'],
      currency: 'USD',
      viluNetTotal: 1200, agencyGuestSellingTotal: 1450, agencyEarnings: 250, paymentCollector: 'HOTEL',
      roomInternalRate: 90, extraNightInternalRate: 40, domesticFlightInternalRate: 110,
      adminNote: 'VIP repeat guest -- upgrade if room available (internal only)',
      internalReservationNote: 'Staff: verify passport copy on arrival',
      created_at: '2026-09-11T01:00:00.000Z', updated_at: '2026-09-11T01:00:00.000Z', created_via: 'confirmAgencyBookingRequest',
    });
  }

  section('Part 24: privacy -- the confirmation payload contains the agreed total and guest content, never internal fields');
  await test('seed a synthetic CONFIRMED booking with every kind of internal field planted on the source documents', async () => {
    await seedConfirmedBooking({});
  });
  let payload;
  await test('Agency A fetches her own confirmation successfully', async () => {
    const result = await callAs(getConfirmationWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { requestId: 'ABR-CONF-1' });
    payload = result;
  });
  await test('the payload contains the agreed selling total (1450), guest name, dates, package, inclusions, and booking reference', () => {
    const json = JSON.stringify(payload);
    assert.match(json, /1450/);
    assert.equal(payload.guestName, 'Jane Traveler');
    assert.equal(payload.arrivalDate, '2027-04-01');
    assert.equal(payload.departureDate, '2027-04-04');
    assert.equal(payload.packageName, 'Maamigili Island Escape');
    assert.ok(payload.guestIncludes.includes('Airport transfer'));
    assert.equal(payload.bookingReference, 'ABK-CONF-1');
  });
  await test('the payload does NOT contain viluNetTotal (1200), agencyEarnings (250), paymentCollector, commission, margin, internal rate labels, component internal prices, admin note, or internal reservation note', () => {
    const json = JSON.stringify(payload);
    // Numeric checks are exact-value, not bare "contains the digit 1" style
    // checks, to avoid false positives from unrelated numbers (dates,
    // counts, nights) elsewhere in the payload.
    assert.doesNotMatch(json, /"viluNetTotal"/);
    assert.doesNotMatch(json, /"agencyEarnings"/);
    assert.doesNotMatch(json, /"paymentCollector"/);
    assert.doesNotMatch(json, /\b1200\b/); // viluNetTotal's value
    assert.doesNotMatch(json, /\b250\b/); // agencyEarnings' value
    assert.doesNotMatch(json, /commission/i);
    assert.doesNotMatch(json, /margin/i);
    assert.doesNotMatch(json, /roomInternalRate|extraNightInternalRate|domesticFlightInternalRate/i);
    assert.doesNotMatch(json, /viluUnitRate|viluLineTotal/);
    assert.doesNotMatch(json, /VIP repeat guest|upgrade if room available/); // adminNote content
    assert.doesNotMatch(json, /verify passport copy/); // internalReservationNote content
    assert.doesNotMatch(json, /jane\.private@example\.com|\+960-777-0000/); // guest's own private contact fields, per the task's own explicit safe-object example (which omits them)
  });

  section('Part 25: ownership -- cross-agency access is denied, unauthenticated is denied');
  await test('Agency A can fetch/print her own confirmation (already proven above)', async () => {
    assert.ok(payload);
  });
  await test('Agency B CANNOT fetch Agency A\'s confirmation', async () => {
    await expectCode(callAs(getConfirmationWrapped, AGENCY_B_UID, AGENCY_B_EMAIL, { requestId: 'ABR-CONF-1' }), 'permission-denied');
  });
  await test('Agency A CANNOT fetch a confirmation that does not exist / belongs to Agency B', async () => {
    await seedConfirmedBooking({ requestId: 'ABR-CONF-B1', reservationId: 'ABK-CONF-B1', quoteId: 'VQ-CONF-B1', agencyId: AGENCY_B_UID, agencyEmail: AGENCY_B_EMAIL, agencyName: 'Agency B' });
    await expectCode(callAs(getConfirmationWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { requestId: 'ABR-CONF-B1' }), 'permission-denied');
  });
  await test('an unauthenticated caller cannot fetch either confirmation', async () => {
    try {
      await getConfirmationWrapped({ data: { requestId: 'ABR-CONF-1' } });
      assert.fail('expected rejection for no auth context');
    } catch (e) {
      assert.equal(e.code, 'unauthenticated');
    }
  });
  await test('a non-agency (e.g. staff) caller is refused -- Phase G is Agency Portal only', async () => {
    await db.collection('users').doc('staffer@example.com').set({ email: 'staffer@example.com', role: 'staff' });
    await expectCode(callAs(getConfirmationWrapped, 'staff-uid', 'staffer@example.com', { requestId: 'ABR-CONF-1' }), 'permission-denied');
  });

  section('Part 26: snapshot stability -- confirmation does not change when live rates/settings change later');
  await test('changing the agency package rate, service catalog rate, and exchange rate AFTER confirmation does not affect the re-fetched confirmation', async () => {
    await db.collection('agency_packages').doc(AGENCY_A_EMAIL).set({ packages: [{ id: 'PKG1', name: 'Maamigili Island Escape', agencyPricePerRoom: 9999, active: true }] });
    await db.collection('service_catalog').doc('whale-shark').set({ name: 'Whale Shark Snorkeling', category: 'TRIPS_ACTIVITIES', basePrice: 9999, unitType: 'PER_ITEM', active: true, visibleToAgencies: 'all' });
    await db.collection('website_content').doc('agency_booking_settings').set({ flightSurcharge: 9999, extraNightRate: 9999, defaultHoldHours: 24 });

    const result = await callAs(getConfirmationWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { requestId: 'ABR-CONF-1' });
    assert.equal(result.agencyGuestSellingTotal, 1450);
    assert.deepEqual(result.guestIncludes, ['Airport transfer', 'Daily breakfast']);
    assert.deepEqual(result.guestActivities, ['Whale Shark Snorkeling']);
    assert.equal(result.packageName, 'Maamigili Island Escape');
    const json = JSON.stringify(result);
    assert.doesNotMatch(json, /9999/);
  });

  section('Part 19 (audit applied): a since-cancelled reservation is refused, not served as CONFIRMED');
  await test('the booking request still literally says CONFIRMED, but the live reservation was cancelled -- the callable refuses rather than trusting the stale flag', async () => {
    await seedConfirmedBooking({ requestId: 'ABR-CANCELLED-1', reservationId: 'ABK-CANCELLED-1', quoteId: 'VQ-CANCELLED-1', resStatus: 'Cancelled' });
    await expectCode(callAs(getConfirmationWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { requestId: 'ABR-CANCELLED-1' }), 'failed-precondition');
  });
  await test('a PENDING booking request (not yet confirmed) is refused', async () => {
    await seedConfirmedBooking({ requestId: 'ABR-PENDING-1', reservationId: 'ABK-PENDING-1', quoteId: 'VQ-PENDING-1', reqStatus: 'PENDING' });
    await expectCode(callAs(getConfirmationWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { requestId: 'ABR-PENDING-1' }), 'failed-precondition');
  });

  section('Part 27: read-only -- zero inventory/accounting writes from this phase\'s function');
  await test('calling getAgencyBookingConfirmationData creates 0 reservations, 0 blocks, 0 booking requests, 0 folios, 0 invoices, 0 settlement records', async () => {
    const before = await Promise.all(['reservations', 'blocks', 'agency_booking_requests', 'folios', 'invoices'].map((c) => db.collection(c).get()));
    const beforeCounts = before.map((s) => s.size);
    await callAs(getConfirmationWrapped, AGENCY_A_UID, AGENCY_A_EMAIL, { requestId: 'ABR-CONF-1' });
    const after = await Promise.all(['reservations', 'blocks', 'agency_booking_requests', 'folios', 'invoices'].map((c) => db.collection(c).get()));
    const afterCounts = after.map((s) => s.size);
    assert.deepEqual(afterCounts, beforeCounts, 'a read-only confirmation fetch must never change any collection\'s document count');
    const settlementsSnap = await db.collection('settlements').get().catch(() => ({ size: 0 }));
    assert.equal(settlementsSnap.size, 0);
  });

  functionsTest.cleanup();
  console.log(`\n${passed}/${passed + failed} agency-booking-confirmation-rules (emulator + Cloud Function) assertions passed`);
  if (failed > 0) process.exitCode = 1;
})().catch((e) => {
  console.error('agency-booking-confirmation-rules.test.js crashed:', e);
  process.exitCode = 1;
});
