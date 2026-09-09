// OTA core sandbox harness (Stage 12) — runs entirely in memory, no network,
// no Firebase. Drives functions/lib/* through the MockAdapter + MemoryStore.
//   node test/ota-core.test.js
const assert = require('assert');
const path = require('path');
const F = (p) => require(path.join(__dirname, '..', 'functions', 'lib', p));
const { MemoryStore } = F('store-memory');
const { MockAdapter } = F('adapters');
const { ingestEvent } = F('ingest');
const { syncAvailability } = F('availability');
const { writeReservationTx, RoomConflictError } = F('booking-core');
const { buildRoomTypes, computeSellable, PHYSICAL_ROOMS } = F('inventory');

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 8).join('\n     ')); } }

function booking(over) {
  return Object.assign({ external_id: 'B1', revision: '2026-09-09T10:00:00Z', status: 'confirmed', channel: 'Booking.com', channel_reservation_id: '6163768410', booking_date: '2026-09-09T09:00:00Z',
    guest: { first: 'Test', last: 'Guest', email: 't@example.com', phone: '+000', country: 'DE' }, notes: '', special_requests: 'quiet room', meal_plan: 'Breakfast',
    commercial: { currency: 'USD', gross_total: 200, net_total: 150, tax_total: 50, commission: 30, paid: 0, balance: 200, rate_includes_tax: true },
    units: [{ room_type: 'Double Room', check_in: '2026-09-10', check_out: '2026-09-14', adults: 2, children: 0, nightly_rate: 37.5 }] }, over || {});
}
async function fresh() { const store = new MemoryStore(); const adapter = new MockAdapter(); for (const r of PHYSICAL_ROOMS) await store.set('rooms', r.id, { id: r.id, name: r.name, type: r.type }); return { store, adapter }; }
async function activeDocs(store) { return (await store.list('reservations')).filter((r) => r.status !== 'Cancelled' && r.status !== 'Checked out'); }
async function locks(store, room) { return ((await store.get('room_availability', room)) || {}).bookings || []; }
function ev(over) { return Object.assign({ channel_manager: 'mock', external_id: 'B1', type: 'new', revision: '2026-09-09T10:00:00Z' }, over || {}); }
async function assertNoOversell(store) { // physical invariant: no two active reservations overlap in one room, no lock without doc
  const act = await activeDocs(store);
  for (let i = 0; i < act.length; i++) for (let j = i + 1; j < act.length; j++) { const a = act[i], b = act[j]; if (a.room_id === b.room_id) assert(!(a.check_in < b.check_out && b.check_in < a.check_out), 'OVERSELL ' + a._id + '/' + b._id + ' in ' + a.room_id); }
  for (const r of PHYSICAL_ROOMS) { const l = await locks(store, r.id); for (const e of l) { const d = await store.get('reservations', e.id); assert(d && d.status !== 'Cancelled', 'dangling lock ' + e.id); assert(d.room_id === r.id, 'lock room mismatch ' + e.id); } }
}

(async () => {
  await test('room types derived from live-shaped rooms docs match VR01–VR06 grouping', async () => {
    const rt = buildRoomTypes(PHYSICAL_ROOMS.map((r) => ({ id: r.id, type: r.type })));
    assert.deepStrictEqual(rt.types, { 'Deluxe Family Room': ['VR01', 'VR02'], 'Double Room': ['VR03', 'VR04', 'VR05'], 'Deluxe Family Room with Open Deck': ['VR06'] });
    assert.deepStrictEqual(rt.errors, []);
    const bad = buildRoomTypes([{ id: 'VR05', type: 'Deluxe Family Room' }]); assert(bad.errors.length === 1 && /mismatch/.test(bad.errors[0]));
  });
  await test('sellable = rooms − active reservations − blocks, half-open, no double count', async () => {
    const rt = buildRoomTypes();
    const res = [{ id: 'A', room_id: 'VR03', check_in: '2026-10-01', check_out: '2026-10-03', status: 'Confirmed' }, { id: 'C', room_id: 'VR03', check_in: '2026-10-05', check_out: '2026-10-06', status: 'Cancelled' }];
    const blocks = [{ id: 'K', room_id: 'VR03', from_date: '2026-10-02', to_date: '2026-10-04' }, { id: 'K2', room_id: 'VR04', from_date: '2026-10-02', to_date: '2026-10-03' }];
    const s = computeSellable({ roomTypes: rt, reservations: res, blocks, from: '2026-10-01', to: '2026-10-06' });
    const dbl = (d) => s.find((x) => x.room_type === 'Double Room' && x.date === d).available;
    assert.strictEqual(dbl('2026-10-01'), 2); assert.strictEqual(dbl('2026-10-02'), 1); // VR03 res+block counted once, VR04 block
    assert.strictEqual(dbl('2026-10-03'), 2); assert.strictEqual(dbl('2026-10-04'), 3); assert.strictEqual(dbl('2026-10-05'), 3); // cancelled ignored; checkout day free
    assert.strictEqual(s.find((x) => x.room_type === 'Deluxe Family Room with Open Deck' && x.date === '2026-10-02').available, 1);
  });

  // 1 new
  let ctx = await fresh(); ctx.adapter.put(booking());
  await test('1. new OTA reservation → one doc, deterministic room (lowest free Double = VR03), lock written', async () => {
    const r = await ingestEvent({ store: ctx.store, adapter: ctx.adapter, event: ev() });
    assert.strictEqual(r.result, 'created'); assert.deepStrictEqual(r.docs, ['OTA-mock-B1']);
    const d = await ctx.store.get('reservations', 'OTA-mock-B1');
    assert.strictEqual(d.room_id, 'VR03'); assert.strictEqual(d.status, 'Confirmed'); assert.strictEqual(d.channel, 'Booking.com'); assert.strictEqual(d.external_id, 'B1'); assert.strictEqual(d.channel_reservation_id, '6163768410'); assert.strictEqual(d.channel_manager, 'mock'); assert.strictEqual(d.rate, 37.5); assert.strictEqual(d.ota_gross_total, 200); assert.strictEqual(d.rate_includes_tax, true); assert(/Special requests/.test(d.notes) && /Meal plan/.test(d.notes));
    assert.deepStrictEqual((await locks(ctx.store, 'VR03')).map((l) => l.id), ['OTA-mock-B1']);
    assert.strictEqual((await ctx.store.list('ota_events')).length, 1);
  });
  // 2 duplicate new
  await test('2. same NEW delivered twice → still one reservation, event logged as duplicate', async () => {
    const r = await ingestEvent({ store: ctx.store, adapter: ctx.adapter, event: ev() });
    assert.strictEqual(r.result, 'duplicate'); assert.strictEqual((await activeDocs(ctx.store)).length, 1);
    assert.strictEqual((await ctx.store.list('ota_events')).filter((e) => e.result === 'duplicate').length, 1);
  });
  // 3 modification (dates +1 day, keeps room)
  await test('3. modification → same doc updated, lock moved, room kept', async () => {
    ctx.adapter.put(booking({ revision: '2026-09-09T11:00:00Z', units: [{ room_type: 'Double Room', check_in: '2026-09-11', check_out: '2026-09-15', adults: 2, children: 0, nightly_rate: 37.5 }] }));
    const r = await ingestEvent({ store: ctx.store, adapter: ctx.adapter, event: ev({ type: 'modify', revision: '2026-09-09T11:00:00Z' }) });
    assert.strictEqual(r.result, 'modified'); const d = await ctx.store.get('reservations', 'OTA-mock-B1');
    assert.strictEqual(d.check_in, '2026-09-11'); assert.strictEqual(d.room_id, 'VR03'); assert.strictEqual(d.channel_revision, '2026-09-09T11:00:00Z');
    assert.deepStrictEqual(await locks(ctx.store, 'VR03'), [{ id: 'OTA-mock-B1', from: '2026-09-11', to: '2026-09-15' }]);
    assert.strictEqual((await activeDocs(ctx.store)).length, 1);
  });
  // 4 duplicate modification
  await test('4. same modification twice → duplicate, no change', async () => {
    const before = JSON.stringify(await ctx.store.get('reservations', 'OTA-mock-B1'));
    const r = await ingestEvent({ store: ctx.store, adapter: ctx.adapter, event: ev({ type: 'modify', revision: '2026-09-09T11:00:00Z' }) });
    assert.strictEqual(r.result, 'duplicate'); assert.strictEqual(JSON.stringify(await ctx.store.get('reservations', 'OTA-mock-B1')), before);
  });
  // 7 stale modification after newer version
  await test('7. older modification arriving after a newer one → stale, newer state kept', async () => {
    ctx.adapter.put(booking({ revision: '2026-09-09T10:30:00Z', units: [{ room_type: 'Double Room', check_in: '2026-09-01', check_out: '2026-09-02', adults: 2, children: 0 }] })); // pretend the CM served an old snapshot
    const r = await ingestEvent({ store: ctx.store, adapter: ctx.adapter, event: ev({ type: 'modify', revision: '2026-09-09T10:30:00Z' }) });
    assert.strictEqual(r.result, 'stale'); assert.strictEqual((await ctx.store.get('reservations', 'OTA-mock-B1')).check_in, '2026-09-11');
    ctx.adapter.put(booking({ revision: '2026-09-09T11:00:00Z', units: [{ room_type: 'Double Room', check_in: '2026-09-11', check_out: '2026-09-15', adults: 2, children: 0, nightly_rate: 37.5 }] }));
  });
  // 5 cancellation
  await test('5. cancellation → Cancelled, lock released', async () => {
    ctx.adapter.put(booking({ revision: '2026-09-09T12:00:00Z', status: 'cancelled', units: [{ room_type: 'Double Room', check_in: '2026-09-11', check_out: '2026-09-15', adults: 2, children: 0 }] }));
    const r = await ingestEvent({ store: ctx.store, adapter: ctx.adapter, event: ev({ type: 'cancel', revision: '2026-09-09T12:00:00Z' }) });
    assert.strictEqual(r.result, 'cancelled'); assert.strictEqual((await ctx.store.get('reservations', 'OTA-mock-B1')).status, 'Cancelled'); assert.deepStrictEqual(await locks(ctx.store, 'VR03'), []);
    await assertNoOversell(ctx.store);
  });
  // 6 duplicate cancellation
  await test('6. same cancellation twice → duplicate, nothing lost, nothing recreated', async () => {
    const r = await ingestEvent({ store: ctx.store, adapter: ctx.adapter, event: ev({ type: 'cancel', revision: '2026-09-09T12:00:00Z' }) });
    assert.strictEqual(r.result, 'duplicate'); assert.strictEqual((await activeDocs(ctx.store)).length, 0);
  });
  await test('13b. out-of-order: cancel arrives BEFORE the modify it superseded → modify is stale, stays cancelled', async () => {
    const r = await ingestEvent({ store: ctx.store, adapter: ctx.adapter, event: ev({ type: 'modify', revision: '2026-09-09T11:00:00Z' }) });
    assert(['stale','duplicate'].includes(r.result), 'got '+r.result); assert.strictEqual((await ctx.store.get('reservations', 'OTA-mock-B1')).status, 'Cancelled');
  });

  // 8 direct website booking + OTA arrival simultaneously for the last free room of a type
  await test('8. website booking and OTA booking race for the last Double → exactly one wins, the other conflicts, no oversell', async () => {
    const c = await fresh();
    // occupy VR03 and VR04 → only VR05 free for Double
    await writeReservationTx(c.store, 'X1', { id: 'X1', room_id: 'VR03', check_in: '2026-11-10', check_out: '2026-11-12', status: 'Confirmed', source: 'Direct' });
    await writeReservationTx(c.store, 'X2', { id: 'X2', room_id: 'VR04', check_in: '2026-11-10', check_out: '2026-11-12', status: 'Confirmed', source: 'Direct' });
    c.adapter.put(booking({ external_id: 'R1', units: [{ room_type: 'Double Room', check_in: '2026-11-10', check_out: '2026-11-12', adults: 2, children: 0 }] }));
    const web = writeReservationTx(c.store, 'WEB1', { id: 'WEB1', room_id: 'VR05', check_in: '2026-11-11', check_out: '2026-11-13', status: 'Pending', source: 'Website' }).then(() => 'ok', (e) => e.code);
    const ota = ingestEvent({ store: c.store, adapter: c.adapter, event: ev({ external_id: 'R1' }) });
    const [w, o] = await Promise.all([web, ota]);
    const winners = [w === 'ok' ? 'web' : null, o.result === 'created' ? 'ota' : null].filter(Boolean);
    assert.strictEqual(winners.length, 1, 'exactly one winner, got ' + JSON.stringify({ w, o: o.result }));
    if (o.result !== 'created') { assert.strictEqual(o.result, 'conflict'); const cf = await c.store.list('ota_conflicts'); assert.strictEqual(cf.length, 1); assert.strictEqual(cf[0].reason, 'no_physical_room'); }
    await assertNoOversell(c.store);
  });
  // 9 two OTAs sell the final room simultaneously
  await test('9. two OTA bookings for the final Double at the same moment → one created, one conflict record, no oversell', async () => {
    const c = await fresh();
    await writeReservationTx(c.store, 'X1', { id: 'X1', room_id: 'VR03', check_in: '2026-12-01', check_out: '2026-12-05', status: 'Confirmed', source: 'Direct' });
    await writeReservationTx(c.store, 'X2', { id: 'X2', room_id: 'VR04', check_in: '2026-12-01', check_out: '2026-12-05', status: 'Confirmed', source: 'Direct' });
    c.adapter.put(booking({ external_id: 'E1', channel: 'Expedia', units: [{ room_type: 'Double Room', check_in: '2026-12-02', check_out: '2026-12-04', adults: 2, children: 0 }] }));
    c.adapter.put(booking({ external_id: 'A1', channel: 'Agoda', units: [{ room_type: 'Double Room', check_in: '2026-12-03', check_out: '2026-12-05', adults: 2, children: 0 }] }));
    const [r1, r2] = await Promise.all([ingestEvent({ store: c.store, adapter: c.adapter, event: ev({ external_id: 'E1' }) }), ingestEvent({ store: c.store, adapter: c.adapter, event: ev({ external_id: 'A1' }) })]);
    assert.deepStrictEqual([r1.result, r2.result].sort(), ['conflict', 'created']);
    assert.strictEqual((await activeDocs(c.store)).length, 3); assert.strictEqual((await c.store.list('ota_conflicts')).length, 1);
    await assertNoOversell(c.store);
  });
  // 10 / 11 blocks
  await test('10. block created → availability engine drops the type by one; 11. block removed → restored', async () => {
    const c = await fresh();
    let s = await syncAvailability({ store: c.store, from: '2026-11-01', days: 3, trigger: 'test' });
    assert.strictEqual(s.payload.room_types.DOUBLE.dates['2026-11-01'].available, 3);
    await c.store.set('blocks', 'K1', { id: 'K1', room_id: 'VR05', from_date: '2026-11-01', to_date: '2026-11-02', reason: 'Maintenance' });
    s = await syncAvailability({ store: c.store, from: '2026-11-01', days: 3, trigger: 'block' });
    assert.strictEqual(s.payload.room_types.DOUBLE.dates['2026-11-01'].available, 2); assert.strictEqual(s.payload.room_types.DOUBLE.dates['2026-11-02'].available, 3);
    assert.deepStrictEqual(s.changed, [{ code: 'DOUBLE', dates: 1 }]);
    // an OTA booking for that room type on the blocked night must skip VR05
    c.adapter.put(booking({ external_id: 'K', units: [{ room_type: 'Double Room', check_in: '2026-11-01', check_out: '2026-11-02', adults: 1, children: 0 }] }));
    await ingestEvent({ store: c.store, adapter: c.adapter, event: ev({ external_id: 'K' }) });
    assert.strictEqual((await c.store.get('reservations', 'OTA-mock-K')).room_id, 'VR03');
    await c.store.delete('blocks', 'K1');
    s = await syncAvailability({ store: c.store, from: '2026-11-01', days: 3, trigger: 'block_removed' });
    assert.strictEqual(s.payload.room_types.DOUBLE.dates['2026-11-01'].available, 2); // VR05 back, VR03 now booked
    assert.strictEqual(s.pushResult, 'not_connected'); assert.strictEqual((await c.store.list('ota_pushes')).length, 3);
  });
  // 12 integration offline + 13 retry recovery
  await test('12. channel manager offline → event logged as retryable error, nothing written; 13. retry after recovery succeeds once', async () => {
    const c = await fresh(); c.adapter.put(booking({ external_id: 'O1' })); c.adapter.offline = true;
    const r = await ingestEvent({ store: c.store, adapter: c.adapter, event: ev({ external_id: 'O1' }) });
    assert.strictEqual(r.result, 'error'); assert.strictEqual(r.retryable, true); assert.strictEqual((await activeDocs(c.store)).length, 0);
    c.adapter.offline = false;
    const r2 = await ingestEvent({ store: c.store, adapter: c.adapter, event: ev({ external_id: 'O1', retry_count: 1 }) });
    assert.strictEqual(r2.result, 'created');
    const r3 = await ingestEvent({ store: c.store, adapter: c.adapter, event: ev({ external_id: 'O1', retry_count: 2 }) });
    assert.strictEqual(r3.result, 'duplicate'); assert.strictEqual((await activeDocs(c.store)).length, 1);
  });
  // 14 incorrect room-type mapping
  await test('14. unknown room type → conflict record, nothing written', async () => {
    const c = await fresh(); c.adapter.put(booking({ external_id: 'M1', units: [{ room_type: 'Presidential Suite', check_in: '2026-11-01', check_out: '2026-11-02', adults: 2, children: 0 }] }));
    const r = await ingestEvent({ store: c.store, adapter: c.adapter, event: ev({ external_id: 'M1' }) });
    assert.strictEqual(r.result, 'conflict'); assert.strictEqual((await activeDocs(c.store)).length, 0);
    const cf = await c.store.list('ota_conflicts'); assert.strictEqual(cf[0].reason, 'unknown_room_type');
  });
  // 15 no physical room available
  await test('15. type fully booked/blocked → no forced write, ota_conflict with diagnostics', async () => {
    const c = await fresh();
    await c.store.set('blocks', 'B6', { id: 'B6', room_id: 'VR06', from_date: '2026-11-01', to_date: '2026-11-30', reason: 'Cloudbeds block: "ok"' });
    c.adapter.put(booking({ external_id: 'N1', units: [{ room_type: 'Deluxe Family Room with Open Deck', check_in: '2026-11-05', check_out: '2026-11-08', adults: 2, children: 0 }] }));
    const r = await ingestEvent({ store: c.store, adapter: c.adapter, event: ev({ external_id: 'N1' }) });
    assert.strictEqual(r.result, 'conflict'); assert.strictEqual(await c.store.get('reservations', 'OTA-mock-N1'), null);
    const cf = (await c.store.list('ota_conflicts'))[0]; assert.strictEqual(cf.reason, 'no_physical_room'); assert(/VR06/.test(cf.detail)); assert.deepStrictEqual(cf.requested, { room_type: 'Deluxe Family Room with Open Deck', check_in: '2026-11-05', check_out: '2026-11-08', adults: 2, children: 0 });
  });
  // modification that needs a room move / a modification onto occupied dates
  await test('5b. modification onto occupied dates keeps the original stay and flags sync_status=conflict', async () => {
    const c = await fresh();
    c.adapter.put(booking({ external_id: 'D1', units: [{ room_type: 'Deluxe Family Room with Open Deck', check_in: '2026-11-01', check_out: '2026-11-03', adults: 2, children: 0 }] }));
    await ingestEvent({ store: c.store, adapter: c.adapter, event: ev({ external_id: 'D1' }) });
    await writeReservationTx(c.store, 'X9', { id: 'X9', room_id: 'VR06', check_in: '2026-11-03', check_out: '2026-11-06', status: 'Confirmed', source: 'Direct' });
    c.adapter.put(booking({ external_id: 'D1', revision: '2026-09-09T11:00:00Z', units: [{ room_type: 'Deluxe Family Room with Open Deck', check_in: '2026-11-01', check_out: '2026-11-05', adults: 2, children: 0 }] }));
    const r = await ingestEvent({ store: c.store, adapter: c.adapter, event: ev({ external_id: 'D1', type: 'modify', revision: '2026-09-09T11:00:00Z' }) });
    assert.strictEqual(r.result, 'conflict'); const d = await c.store.get('reservations', 'OTA-mock-D1');
    assert.strictEqual(d.check_out, '2026-11-03'); assert.strictEqual(d.sync_status, 'conflict'); await assertNoOversell(c.store);
  });
  await test('multi-room booking → one doc per unit (-2 suffix), reduced to one unit on modification cancels the dropped unit', async () => {
    const c = await fresh();
    c.adapter.put(booking({ external_id: 'MR', units: [{ room_type: 'Deluxe Family Room', check_in: '2026-11-01', check_out: '2026-11-03', adults: 1 }, { room_type: 'Deluxe Family Room', check_in: '2026-11-01', check_out: '2026-11-03', adults: 1, children: 1 }] }));
    const r = await ingestEvent({ store: c.store, adapter: c.adapter, event: ev({ external_id: 'MR' }) });
    assert.deepStrictEqual(r.docs, ['OTA-mock-MR', 'OTA-mock-MR-2']);
    assert.deepStrictEqual([(await c.store.get('reservations', 'OTA-mock-MR')).room_id, (await c.store.get('reservations', 'OTA-mock-MR-2')).room_id], ['VR01', 'VR02']);
    c.adapter.put(booking({ external_id: 'MR', revision: '2026-09-09T11:00:00Z', units: [{ room_type: 'Deluxe Family Room', check_in: '2026-11-01', check_out: '2026-11-03', adults: 1 }] }));
    await ingestEvent({ store: c.store, adapter: c.adapter, event: ev({ external_id: 'MR', type: 'modify', revision: '2026-09-09T11:00:00Z' }) });
    assert.strictEqual((await c.store.get('reservations', 'OTA-mock-MR-2')).status, 'Cancelled'); assert.deepStrictEqual(await locks(c.store, 'VR02'), []);
  });
  await test('booking-core: ROOM_CONFLICT on lock overlap and on block overlap; same-day turnover allowed', async () => {
    const c = await fresh();
    await writeReservationTx(c.store, 'A', { id: 'A', room_id: 'VR01', check_in: '2026-10-01', check_out: '2026-10-03', status: 'Confirmed' });
    await assert.rejects(writeReservationTx(c.store, 'B', { id: 'B', room_id: 'VR01', check_in: '2026-10-02', check_out: '2026-10-04', status: 'Confirmed' }), (e) => e instanceof RoomConflictError);
    await writeReservationTx(c.store, 'C', { id: 'C', room_id: 'VR01', check_in: '2026-10-03', check_out: '2026-10-04', status: 'Confirmed' });
    await c.store.set('blocks', 'Z', { id: 'Z', room_id: 'VR02', from_date: '2026-10-01', to_date: '2026-10-05' });
    await assert.rejects(writeReservationTx(c.store, 'D', { id: 'D', room_id: 'VR02', check_in: '2026-10-04', check_out: '2026-10-06', status: 'Confirmed' }), (e) => e.detail && e.detail.type === 'block');
    await writeReservationTx(c.store, 'E', { id: 'E', room_id: 'VR02', check_in: '2026-10-05', check_out: '2026-10-06', status: 'Confirmed' });
    await assertNoOversell(c.store);
  });

  console.log('\n' + passed + '/' + (passed + failed) + ' ota-core assertions passed');
  process.exit(failed ? 1 : 0);
})();
