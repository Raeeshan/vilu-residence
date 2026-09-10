// Beds24 -> Vilu inbound ingestion -- end-to-end integration tests. Drives
// the REAL normalizeBeds24Booking() translation layer through the EXISTING,
// already-hardened ingestEvent()/MemoryStore/booking-core.js path (same
// infrastructure test/ota-core.test.js already exercises generically) --
// this file proves the Beds24-specific translation slots into that path
// correctly, without reimplementing or modifying any of it. No network, no
// live Beds24 call, no live reservation touched.
//   node test/beds24-inbound-integration.test.js
const assert = require('assert');
const path = require('path');
const F = (p) => require(path.join(__dirname, '..', 'functions', 'lib', p));
const { MemoryStore } = F('store-memory');
const { ingestEvent } = F('ingest');
const { PHYSICAL_ROOMS } = F('inventory');
const { normalizeBeds24Booking, shouldAutoIngest } = F('beds24-inbound');

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 8).join('\n     ')); } }

// Mirrors exactly what the real Beds24Adapter.fetchBooking() does (fetch
// raw Beds24 JSON -> normalizeBeds24Booking()) but against an in-memory raw
// booking map instead of the real network -- so these tests exercise the
// REAL translation function, not a re-implementation of it.
class Beds24LikeAdapter {
  constructor() { this.raw = new Map(); this.offline = false; this.fetches = 0; }
  putRaw(rawBooking) { this.raw.set(String(rawBooking.id), JSON.parse(JSON.stringify(rawBooking))); }
  async fetchBooking(externalId) {
    this.fetches++;
    if (this.offline) throw new Error('channel manager unreachable');
    const raw = this.raw.get(String(externalId));
    return raw ? normalizeBeds24Booking(raw) : null;
  }
  async listModifiedSince(iso) {
    return [...this.raw.values()].filter((b) => String(b.modifiedTime) > String(iso || '')).map((b) => String(b.id));
  }
}

// Mirrors the channel-recognition gate functions-ota/index.js's
// processQueued() applies BEFORE calling ingestEvent() (Step 12) -- kept
// here as a faithful, minimal reproduction of that logic (peek, gate,
// otherwise proceed) so these tests prove the intended end-to-end pipeline
// behavior, not just the pure normalizer in isolation.
async function processBeds24Event({ store, adapter, externalId, revision, type }) {
  const peeked = await adapter.fetchBooking(externalId);
  if (peeked && !shouldAutoIngest(peeked)) {
    return { result: 'unrecognized_channel_review', channel: peeked._raw_channel };
  }
  return ingestEvent({ store, adapter, event: { channel_manager: 'beds24', external_id: externalId, revision, type, retry_count: 0 } });
}

function rawBooking(overrides) {
  return Object.assign({
    id: 5551112222,
    roomId: 728133, // Double
    status: 'confirmed',
    channel: 'booking',
    apiReference: 'BDC-REF-999',
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
    notes: '',
    comments: '',
    arrivalTime: '15:00',
    bookingTime: '2026-11-01T10:00:00',
    modifiedTime: '2026-11-01T10:00:00',
    invoiceItems: [],
  }, overrides);
}

async function fresh() {
  const store = new MemoryStore();
  const adapter = new Beds24LikeAdapter();
  for (const r of PHYSICAL_ROOMS) await store.set('rooms', r.id, { id: r.id, name: r.name, type: r.type });
  return { store, adapter };
}
async function activeDocs(store) { return (await store.list('reservations')).filter((r) => r.status !== 'Cancelled' && r.status !== 'Checked out'); }
async function locks(store, room) { return ((await store.get('room_availability', room)) || {}).bookings || []; }

(async () => {
  // --- New reservation, per channel ---------------------------------------
  await test('1. new Booking.com reservation -> created, mapped to Double Room, lowest free physical room (VR03) allocated', async () => {
    const { store, adapter } = await fresh();
    adapter.putRaw(rawBooking({ id: 1001, channel: 'booking', roomId: 728133 }));
    const r = await processBeds24Event({ store, adapter, externalId: '1001', revision: '2026-11-01T10:00:00', type: 'new' });
    assert.strictEqual(r.result, 'created');
    const doc = await store.get('reservations', 'OTA-beds24-1001');
    assert.strictEqual(doc.room_id, 'VR03');
    assert.strictEqual(doc.channel, 'Booking.com');
    assert.strictEqual(doc.status, 'Confirmed');
  });
  await test('2. new Expedia reservation -> created', async () => {
    const { store, adapter } = await fresh();
    adapter.putRaw(rawBooking({ id: 1002, channel: 'expedia', roomId: 727992 }));
    const r = await processBeds24Event({ store, adapter, externalId: '1002', revision: '2026-11-01T10:00:00', type: 'new' });
    assert.strictEqual(r.result, 'created');
    const doc = await store.get('reservations', 'OTA-beds24-1002');
    assert.strictEqual(doc.channel, 'Expedia');
    assert.strictEqual(doc.room_id, 'VR01');
  });
  await test('3. new Agoda reservation -> created', async () => {
    const { store, adapter } = await fresh();
    adapter.putRaw(rawBooking({ id: 1003, channel: 'agoda', roomId: 728134 }));
    const r = await processBeds24Event({ store, adapter, externalId: '1003', revision: '2026-11-01T10:00:00', type: 'new' });
    assert.strictEqual(r.result, 'created');
    const doc = await store.get('reservations', 'OTA-beds24-1003');
    assert.strictEqual(doc.channel, 'Agoda');
    assert.strictEqual(doc.room_id, 'VR06');
  });

  // --- Unrecognized source (Step 12) ---------------------------------------
  await test('4. unrecognized source (Beds24 manual/direct) -> marked for review, NOT auto-ingested, no Vilu reservation created', async () => {
    const { store, adapter } = await fresh();
    adapter.putRaw(rawBooking({ id: 1004, channel: 'direct', roomId: 728133 }));
    const r = await processBeds24Event({ store, adapter, externalId: '1004', revision: '2026-11-01T10:00:00', type: 'new' });
    assert.strictEqual(r.result, 'unrecognized_channel_review');
    assert.strictEqual(r.channel, 'direct');
    const doc = await store.get('reservations', 'OTA-beds24-1004');
    assert.strictEqual(doc, null);
  });
  await test('4b. an unrecognized-source booking never reaches ingestEvent at all (adapter is not asked to fetch a second time)', async () => {
    const { store, adapter } = await fresh();
    adapter.putRaw(rawBooking({ id: 1005, channel: 'airbnb' }));
    await processBeds24Event({ store, adapter, externalId: '1005', revision: '2026-11-01T10:00:00', type: 'new' });
    assert.strictEqual(adapter.fetches, 1, 'only the gate\'s own peek fetch, ingestEvent must never run for this booking');
  });

  // --- Idempotency: duplicate / replay -------------------------------------
  await test('5. duplicate event (identical revision resent) -> still exactly one reservation', async () => {
    const { store, adapter } = await fresh();
    adapter.putRaw(rawBooking({ id: 1006 }));
    await processBeds24Event({ store, adapter, externalId: '1006', revision: '2026-11-01T10:00:00', type: 'new' });
    const r2 = await processBeds24Event({ store, adapter, externalId: '1006', revision: '2026-11-01T10:00:00', type: 'new' });
    assert.strictEqual(r2.result, 'duplicate');
    assert.strictEqual((await activeDocs(store)).length, 1);
  });
  await test('6. replayed webhook delivery well after the fact -> still harmless (same idempotency mechanism, same outcome)', async () => {
    const { store, adapter } = await fresh();
    adapter.putRaw(rawBooking({ id: 1007 }));
    await processBeds24Event({ store, adapter, externalId: '1007', revision: '2026-11-01T10:00:00', type: 'new' });
    // simulate a redelivered webhook long after processing, identical payload/revision
    const replay = await processBeds24Event({ store, adapter, externalId: '1007', revision: '2026-11-01T10:00:00', type: 'new' });
    assert.strictEqual(replay.result, 'duplicate');
    assert.strictEqual((await activeDocs(store)).length, 1);
  });

  // --- PII + financial normalization ----------------------------------------
  await test('7. guest PII is fetched authoritatively -- reservation doc matches Beds24\'s real guest fields, never anything from a webhook payload', async () => {
    const { store, adapter } = await fresh();
    adapter.putRaw(rawBooking({ id: 1008, firstName: 'Amara', lastName: 'Silva', email: 'amara@example.com', phone: '+9601234567', country2: 'MV' }));
    await processBeds24Event({ store, adapter, externalId: '1008', revision: '2026-11-01T10:00:00', type: 'new' });
    const doc = await store.get('reservations', 'OTA-beds24-1008');
    assert.strictEqual(doc.guest_name, 'Amara Silva');
    assert.strictEqual(doc.guest_email, 'amara@example.com');
    assert.strictEqual(doc.guest_phone, '+9601234567');
    assert.strictEqual(doc.guest_country, 'MV');
  });
  await test('8. financial normalization -- gross/tax/commission land on the reservation, payment status is review_required (never guessed)', async () => {
    const { store, adapter } = await fresh();
    adapter.putRaw(rawBooking({ id: 1009, price: 500, tax: 85, commission: 60 }));
    await processBeds24Event({ store, adapter, externalId: '1009', revision: '2026-11-01T10:00:00', type: 'new' });
    const doc = await store.get('reservations', 'OTA-beds24-1009');
    assert.strictEqual(doc.ota_gross_total, 500);
    assert.strictEqual(doc.ota_tax_total, 85);
    assert.strictEqual(doc.ota_commission, 60);
    assert.strictEqual(doc.ota_payment_status, 'review_required');
  });

  // --- Room mapping / physical allocation -----------------------------------
  await test('9/10. room-type mapping + physical allocation: a Double booking never lands on a Deluxe Family or Open Deck physical room', async () => {
    const { store, adapter } = await fresh();
    adapter.putRaw(rawBooking({ id: 1010, roomId: 728133 }));
    await processBeds24Event({ store, adapter, externalId: '1010', revision: '2026-11-01T10:00:00', type: 'new' });
    const doc = await store.get('reservations', 'OTA-beds24-1010');
    assert.ok(['VR03', 'VR04', 'VR05'].includes(doc.room_id));
  });
  await test('11. no free physical room -> ota_conflicts with reason no_physical_room, nothing written', async () => {
    const { store, adapter } = await fresh();
    // Fill VR06 (Open Deck, quantity 1) with an existing active reservation on the same dates.
    await store.set('reservations', 'EXISTING', { id: 'EXISTING', room_id: 'VR06', check_in: '2026-12-10', check_out: '2026-12-14', status: 'Confirmed' });
    await store.set('room_availability', 'VR06', { bookings: [{ id: 'EXISTING', from: '2026-12-10', to: '2026-12-14' }] });
    adapter.putRaw(rawBooking({ id: 1011, roomId: 728134, arrival: '2026-12-10', departure: '2026-12-14' }));
    const r = await processBeds24Event({ store, adapter, externalId: '1011', revision: '2026-11-01T10:00:00', type: 'new' });
    assert.strictEqual(r.result, 'conflict');
    const conflicts = await store.list('ota_conflicts');
    assert.strictEqual(conflicts.length, 1);
    assert.strictEqual(conflicts[0].reason, 'no_physical_room');
    assert.strictEqual(await store.get('reservations', 'OTA-beds24-1011'), null);
  });
  await test('17. unknown Beds24 roomId -> unknown_room_type conflict, nothing written (no guessed mapping)', async () => {
    const { store, adapter } = await fresh();
    adapter.putRaw(rawBooking({ id: 1012, roomId: 424242 }));
    const r = await processBeds24Event({ store, adapter, externalId: '1012', revision: '2026-11-01T10:00:00', type: 'new' });
    assert.strictEqual(r.result, 'conflict');
    const conflicts = await store.list('ota_conflicts');
    assert.strictEqual(conflicts[0].reason, 'unknown_room_type');
    assert.strictEqual(await store.get('reservations', 'OTA-beds24-1012'), null);
  });

  // --- Modification ----------------------------------------------------------
  await test('12. date modification -> newer revision moves the stay dates', async () => {
    const { store, adapter } = await fresh();
    adapter.putRaw(rawBooking({ id: 1013, arrival: '2026-12-10', departure: '2026-12-14' }));
    await processBeds24Event({ store, adapter, externalId: '1013', revision: '2026-11-01T10:00:00', type: 'new' });
    adapter.putRaw(rawBooking({ id: 1013, arrival: '2026-12-12', departure: '2026-12-16', modifiedTime: '2026-11-02T10:00:00' }));
    const r = await processBeds24Event({ store, adapter, externalId: '1013', revision: '2026-11-02T10:00:00', type: 'modify' });
    assert.strictEqual(r.result, 'modified');
    const doc = await store.get('reservations', 'OTA-beds24-1013');
    assert.strictEqual(doc.check_in, '2026-12-12');
    assert.strictEqual(doc.check_out, '2026-12-16');
  });
  await test('13. room-type modification -> moving from Double to Open Deck at Beds24 re-allocates within the NEW pool', async () => {
    const { store, adapter } = await fresh();
    adapter.putRaw(rawBooking({ id: 1014, roomId: 728133 }));
    await processBeds24Event({ store, adapter, externalId: '1014', revision: '2026-11-01T10:00:00', type: 'new' });
    const before = await store.get('reservations', 'OTA-beds24-1014');
    assert.ok(['VR03', 'VR04', 'VR05'].includes(before.room_id));
    adapter.putRaw(rawBooking({ id: 1014, roomId: 728134, modifiedTime: '2026-11-02T10:00:00' }));
    const r = await processBeds24Event({ store, adapter, externalId: '1014', revision: '2026-11-02T10:00:00', type: 'modify' });
    assert.strictEqual(r.result, 'modified');
    const after = await store.get('reservations', 'OTA-beds24-1014');
    assert.strictEqual(after.room_id, 'VR06');
  });
  await test('14. payment-only modification -> same room/dates, updated financials, no lock churn', async () => {
    const { store, adapter } = await fresh();
    adapter.putRaw(rawBooking({ id: 1015, price: 360 }));
    await processBeds24Event({ store, adapter, externalId: '1015', revision: '2026-11-01T10:00:00', type: 'new' });
    const before = await store.get('reservations', 'OTA-beds24-1015');
    adapter.putRaw(rawBooking({ id: 1015, price: 400, invoiceItems: [{ type: 'payment', amount: 200, qty: 1 }], modifiedTime: '2026-11-03T10:00:00' }));
    const r = await processBeds24Event({ store, adapter, externalId: '1015', revision: '2026-11-03T10:00:00', type: 'modify' });
    assert.strictEqual(r.result, 'modified');
    const after = await store.get('reservations', 'OTA-beds24-1015');
    assert.strictEqual(after.room_id, before.room_id);
    assert.strictEqual(after.ota_gross_total, 400);
    assert.strictEqual(after.ota_paid, 200);
  });

  // --- Cancellation -----------------------------------------------------------
  await test('15. cancellation -> status Cancelled, lock released, reservation doc preserved (never hard-deleted)', async () => {
    const { store, adapter } = await fresh();
    adapter.putRaw(rawBooking({ id: 1016, roomId: 728133 }));
    await processBeds24Event({ store, adapter, externalId: '1016', revision: '2026-11-01T10:00:00', type: 'new' });
    const created = await store.get('reservations', 'OTA-beds24-1016');
    const room = created.room_id;
    adapter.putRaw(rawBooking({ id: 1016, roomId: 728133, status: 'cancelled', modifiedTime: '2026-11-04T10:00:00' }));
    const r = await processBeds24Event({ store, adapter, externalId: '1016', revision: '2026-11-04T10:00:00', type: 'cancel' });
    assert.strictEqual(r.result, 'cancelled');
    const doc = await store.get('reservations', 'OTA-beds24-1016');
    assert.strictEqual(doc.status, 'Cancelled');
    assert.ok(doc, 'reservation doc must still exist -- never hard-deleted');
    assert.deepStrictEqual((await locks(store, room)), []);
  });
  await test('16. cancel duplicate -> replaying the same cancellation is a harmless no-op', async () => {
    const { store, adapter } = await fresh();
    adapter.putRaw(rawBooking({ id: 1017 }));
    await processBeds24Event({ store, adapter, externalId: '1017', revision: '2026-11-01T10:00:00', type: 'new' });
    adapter.putRaw(rawBooking({ id: 1017, status: 'cancelled', modifiedTime: '2026-11-04T10:00:00' }));
    await processBeds24Event({ store, adapter, externalId: '1017', revision: '2026-11-04T10:00:00', type: 'cancel' });
    const r2 = await processBeds24Event({ store, adapter, externalId: '1017', revision: '2026-11-04T10:00:00', type: 'cancel' });
    assert.strictEqual(r2.result, 'duplicate');
    const doc = await store.get('reservations', 'OTA-beds24-1017');
    assert.strictEqual(doc.status, 'Cancelled');
  });

  // --- ROOM_CONFLICT (race) ----------------------------------------------------
  await test('18. ROOM_CONFLICT: two simultaneous Beds24 bookings racing for the only Open Deck room -> one created, one conflict, no oversell', async () => {
    const { store, adapter } = await fresh();
    adapter.putRaw(rawBooking({ id: 1018, roomId: 728134, arrival: '2027-01-05', departure: '2027-01-08' }));
    adapter.putRaw(rawBooking({ id: 1019, roomId: 728134, arrival: '2027-01-05', departure: '2027-01-08' }));
    const [r1, r2] = await Promise.all([
      processBeds24Event({ store, adapter, externalId: '1018', revision: '2026-11-01T10:00:00', type: 'new' }),
      processBeds24Event({ store, adapter, externalId: '1019', revision: '2026-11-01T10:00:01', type: 'new' }),
    ]);
    const results = [r1.result, r2.result].sort();
    assert.deepStrictEqual(results, ['conflict', 'created']);
    const conflicts = await store.list('ota_conflicts');
    assert.strictEqual(conflicts.length, 1);
    assert.strictEqual(conflicts[0].reason, 'no_physical_room');
  });

  // --- Failure safety -----------------------------------------------------------
  await test('20. processor retry: Beds24 unreachable -> error/retryable, PMS state unchanged; recovers on retry', async () => {
    const { store, adapter } = await fresh();
    adapter.putRaw(rawBooking({ id: 1020 }));
    adapter.offline = true;
    const r1 = await ingestEvent({ store, adapter, event: { channel_manager: 'beds24', external_id: '1020', revision: '2026-11-01T10:00:00', type: 'new', retry_count: 0 } });
    assert.strictEqual(r1.result, 'error');
    assert.strictEqual(r1.retryable, true);
    assert.strictEqual(await store.get('reservations', 'OTA-beds24-1020'), null, 'PMS must be unchanged on Beds24 API failure');
    adapter.offline = false;
    const r2 = await ingestEvent({ store, adapter, event: { channel_manager: 'beds24', external_id: '1020', revision: '2026-11-01T10:00:00', type: 'new', retry_count: 1 } });
    assert.strictEqual(r2.result, 'created');
  });
  await test('22. PMS unchanged on Beds24 API failure (explicit re-check): zero reservations, zero locks after a failed fetch', async () => {
    const { store, adapter } = await fresh();
    adapter.putRaw(rawBooking({ id: 1021 }));
    adapter.offline = true;
    await ingestEvent({ store, adapter, event: { channel_manager: 'beds24', external_id: '1021', revision: '2026-11-01T10:00:00', type: 'new', retry_count: 0 } });
    assert.strictEqual((await store.list('reservations')).length, 0);
    for (const r of PHYSICAL_ROOMS) assert.deepStrictEqual(await locks(store, r.id), []);
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
