// Beds24 -> Vilu inbound booking normalization -- unit tests. Pure logic
// only, no network, no live Beds24 call, no live reservation touched.
//   node test/beds24-inbound.test.js
const assert = require('assert');
const path = require('path');
const F = (p) => require(path.join(__dirname, '..', 'functions', 'lib', p));
const { RECOGNIZED_CHANNELS, normalizeBeds24Booking, shouldAutoIngest } = F('beds24-inbound');
const { normalizeOtaPayment } = F('ota-payment');

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 8).join('\n     ')); } }

// A realistic raw Beds24 /bookings response object, matching the confirmed
// live OpenAPI schema fields exactly (id, roomId, arrival, departure,
// numAdult, numChild, firstName, lastName, email, phone, status, channel,
// apiReference, price, tax, commission, deposit, notes, comments,
// arrivalTime, bookingTime, modifiedTime, invoiceItems[]).
function rawBooking(overrides) {
  return Object.assign({
    id: 9988776655,
    propertyId: 352964,
    roomId: 728133, // Double
    unitId: null,
    status: 'confirmed',
    channel: 'booking',
    apiReference: 'BDC-REF-123',
    arrival: '2026-12-10',
    departure: '2026-12-14',
    numAdult: 2,
    numChild: 0,
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    phone: '+1234567890',
    country2: 'US',
    price: 360,
    tax: 61.2,
    commission: 43.2,
    deposit: 0,
    notes: 'Guest requested late check-in',
    comments: 'Anniversary trip',
    arrivalTime: '15:00',
    bookingTime: '2026-11-01T10:00:00',
    modifiedTime: '2026-11-01T10:00:00',
    invoiceItems: [],
  }, overrides);
}

(async () => {
  await test('RECOGNIZED_CHANNELS is exactly Booking.com/Expedia/Agoda -- the owner-locked integration scope', () => {
    assert.deepStrictEqual(RECOGNIZED_CHANNELS, { booking: 'Booking.com', expedia: 'Expedia', agoda: 'Agoda' });
  });

  await test('normalizeBeds24Booking: a Booking.com reservation normalizes to canonical channel "Booking.com" and is auto-ingestible', () => {
    const n = normalizeBeds24Booking(rawBooking({ channel: 'booking' }));
    assert.strictEqual(n.channel, 'Booking.com');
    assert.strictEqual(n._raw_channel, 'booking');
    assert.strictEqual(shouldAutoIngest(n), true);
  });
  await test('normalizeBeds24Booking: an Expedia reservation normalizes correctly', () => {
    const n = normalizeBeds24Booking(rawBooking({ channel: 'expedia' }));
    assert.strictEqual(n.channel, 'Expedia');
    assert.strictEqual(shouldAutoIngest(n), true);
  });
  await test('normalizeBeds24Booking: an Agoda reservation normalizes correctly', () => {
    const n = normalizeBeds24Booking(rawBooking({ channel: 'agoda' }));
    assert.strictEqual(n.channel, 'Agoda');
    assert.strictEqual(shouldAutoIngest(n), true);
  });
  await test('normalizeBeds24Booking: an unrecognized channel (direct/airbnb/etc) is NOT auto-ingestible, and the raw channel is preserved for audit', () => {
    const direct = normalizeBeds24Booking(rawBooking({ channel: 'direct' }));
    assert.strictEqual(shouldAutoIngest(direct), false);
    assert.strictEqual(direct._raw_channel, 'direct');
    assert.strictEqual(direct.channel, 'direct', 'the raw value is kept for display, never silently relabeled as a recognized OTA');

    const airbnb = normalizeBeds24Booking(rawBooking({ channel: 'airbnb' }));
    assert.strictEqual(shouldAutoIngest(airbnb), false);
  });
  await test('shouldAutoIngest: null/undefined booking is never auto-ingestible', () => {
    assert.strictEqual(shouldAutoIngest(null), false);
    assert.strictEqual(shouldAutoIngest(undefined), false);
  });

  await test('normalizeBeds24Booking: known Beds24 roomId 728133 maps to the exact Vilu display name "Double Room"', () => {
    const n = normalizeBeds24Booking(rawBooking({ roomId: 728133 }));
    assert.strictEqual(n.units[0].room_type, 'Double Room');
  });
  await test('normalizeBeds24Booking: known Beds24 roomId 727992 maps to "Deluxe Family Room"', () => {
    const n = normalizeBeds24Booking(rawBooking({ roomId: 727992 }));
    assert.strictEqual(n.units[0].room_type, 'Deluxe Family Room');
  });
  await test('normalizeBeds24Booking: known Beds24 roomId 728134 maps to "Deluxe Family Room with Open Deck"', () => {
    const n = normalizeBeds24Booking(rawBooking({ roomId: 728134 }));
    assert.strictEqual(n.units[0].room_type, 'Deluxe Family Room with Open Deck');
  });
  await test('normalizeBeds24Booking: an UNKNOWN Beds24 roomId produces a deliberately-invalid room_type sentinel, never a guessed mapping', () => {
    const n = normalizeBeds24Booking(rawBooking({ roomId: 999999 }));
    assert.strictEqual(n.units[0].room_type, 'UNMAPPED_BEDS24_ROOM_999999');
  });

  await test('normalizeBeds24Booking: guest PII is fetched authoritatively from the Beds24 booking object, never invented', () => {
    const n = normalizeBeds24Booking(rawBooking({ firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phone: '+1234567890', country2: 'US' }));
    assert.deepStrictEqual(n.guest, { first: 'Jane', last: 'Doe', email: 'jane@example.com', phone: '+1234567890', country: 'US' });
  });
  await test('normalizeBeds24Booking: dates/adults/children pass through exactly as Beds24 reports them', () => {
    const n = normalizeBeds24Booking(rawBooking({ arrival: '2026-12-10', departure: '2026-12-14', numAdult: 3, numChild: 1 }));
    assert.strictEqual(n.units[0].check_in, '2026-12-10');
    assert.strictEqual(n.units[0].check_out, '2026-12-14');
    assert.strictEqual(n.units[0].adults, 3);
    assert.strictEqual(n.units[0].children, 1);
  });

  await test('normalizeBeds24Booking: revision is Beds24 modifiedTime (ISO, lexically comparable, matching ingest.js newerOrEqual)', () => {
    const n = normalizeBeds24Booking(rawBooking({ modifiedTime: '2026-11-05T12:00:00' }));
    assert.strictEqual(n.revision, '2026-11-05T12:00:00');
  });

  await test('normalizeBeds24Booking + normalizeOtaPayment: commission/gross/tax pass through, payment_model stays undetermined (never guessed) -> review_required', () => {
    const n = normalizeBeds24Booking(rawBooking({ price: 360, tax: 61.2, commission: 43.2, invoiceItems: [] }));
    assert.strictEqual(n.commercial.gross_total, 360);
    assert.strictEqual(n.commercial.tax_total, 61.2);
    assert.strictEqual(n.commercial.commission, 43.2);
    const normalizedPayment = normalizeOtaPayment({ commercial: n.commercial });
    assert.strictEqual(normalizedPayment.payment_model, 'unknown');
    assert.strictEqual(normalizedPayment.payment_status, 'review_required');
  });
  await test('normalizeBeds24Booking: paid amount is summed from invoiceItems of type "payment" only, never "charge"', () => {
    const n = normalizeBeds24Booking(rawBooking({
      price: 360,
      invoiceItems: [
        { type: 'charge', amount: 360, qty: 1 },
        { type: 'payment', amount: 100, qty: 1 },
        { type: 'payment', amount: 50, qty: 1 },
      ],
    }));
    assert.strictEqual(n.commercial.paid, 150);
    assert.strictEqual(n.commercial.balance, 210);
  });
  await test('normalizeBeds24Booking: never fabricates virtual-card data or a PCI-unsafe field -- virtual_card.available stays false with no amount/activation unless real data exists', () => {
    const n = normalizeBeds24Booking(rawBooking({}));
    assert.deepStrictEqual(n.commercial.virtual_card, { available: false, amount: null, activation_date: null });
    assert.strictEqual(JSON.stringify(n).toLowerCase().includes('cvc'), false);
    assert.strictEqual(JSON.stringify(n).toLowerCase().includes('pan'), false);
  });
  await test('normalizeBeds24Booking: currency is the property\'s configured USD, never invented per booking (Beds24 has no per-booking currency field)', () => {
    const n = normalizeBeds24Booking(rawBooking({}));
    assert.strictEqual(n.commercial.currency, 'USD');
  });

  await test('normalizeBeds24Booking: meal_plan stays null (honest gap) rather than guessed', () => {
    const n = normalizeBeds24Booking(rawBooking({}));
    assert.strictEqual(n.meal_plan, null);
  });

  await test('normalizeBeds24Booking: status passes through raw for ingest.js\'s own mapStatus() to interpret -- never re-mapped here', () => {
    const cancelled = normalizeBeds24Booking(rawBooking({ status: 'cancelled' }));
    assert.strictEqual(cancelled.status, 'cancelled');
  });

  await test('normalizeBeds24Booking: external_id is always a string (Beds24 IDs are integers on the wire)', () => {
    const n = normalizeBeds24Booking(rawBooking({ id: 123456 }));
    assert.strictEqual(n.external_id, '123456');
    assert.strictEqual(typeof n.external_id, 'string');
  });

  await test('normalizeBeds24Booking: returns null for a falsy input (Beds24 has no such booking)', () => {
    assert.strictEqual(normalizeBeds24Booking(null), null);
    assert.strictEqual(normalizeBeds24Booking(undefined), null);
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
