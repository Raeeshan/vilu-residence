// D1 — cross-provider OTA booking identity / deduplication. Runs entirely in
// memory (MemoryStore + MockAdapter), no network, no Firebase, no production
// data touched. Exercises ota-booking-identity.js through the real
// ingestEvent() entry point (functions/lib/ingest.js), the same integration
// point production traffic goes through.
//   node test/ota-cross-provider-identity.test.js
const assert = require('assert');
const path = require('path');
const F = (p) => require(path.join(__dirname, '..', 'functions', 'lib', p));
const { MemoryStore } = F('store-memory');
const { MockAdapter } = F('adapters');
const { ingestEvent } = F('ingest');
const { PHYSICAL_ROOMS } = F('inventory');
const { getAlias, ALIAS_COLLECTION } = F('ota-booking-identity');

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 10).join('\n     ')); } }

async function fresh() { const store = new MemoryStore(); const adapter = new MockAdapter(); for (const r of PHYSICAL_ROOMS) await store.set('rooms', r.id, { id: r.id, name: r.name, type: r.type }); return { store, adapter }; }
async function activeDocs(store) { return (await store.list('reservations')).filter((r) => r.status !== 'Cancelled' && r.status !== 'Checked out'); }

// Seeds a reservation doc matching the REAL Cloudbeds-migrated schema
// (confirmed against live Firestore documents 2026-09-22 -- see the D1
// build report's identifier matrix). `ota_ref` is the field Cloudbeds
// migration populates for Booking.com/Agoda-sourced docs; omit it entirely
// to reproduce the real, proven gap on the two existing Expedia docs
// (BK21814-0, BK01278-0), which carry no such field.
async function seedMigrated(store, id, { room_id, check_in, check_out, source, ota_ref, guest_name, status }) {
  await store.set('reservations', id, {
    id, room_id, check_in, check_out, source, channel: source,
    status: status || 'Confirmed', adults: 2, children: 0,
    guest_name: guest_name || 'Test Guest',
    ota_ref: ota_ref, // undefined -> field genuinely absent, matching BK21814-0/BK01278-0
    migrated_from: ota_ref ? 'cloudbeds' : undefined,
    notes: ota_ref ? '' : 'Cloudbeds Reservation ID: 0000000000000 | Cloudbeds Source: ' + source,
  }, { merge: true });
}

// A Beds24-shaped booking as MockAdapter/ingestEvent already expect it (see
// ota-core.test.js's own booking() fixture for the established convention) --
// always exactly one unit, matching normalizeBeds24Booking()'s proven,
// never-multi-unit real output.
function beds24Booking(over) {
  return Object.assign({
    external_id: 'BEDS-1', revision: '2026-09-22T10:00:00Z', status: 'confirmed', channel: 'Booking.com',
    channel_reservation_id: '6163768410', booking_date: '2026-09-22T09:00:00Z',
    guest: { first: 'Real', last: 'Guest', email: 'g@example.com', phone: '+1', country: 'DE' },
    notes: '', special_requests: '', meal_plan: '',
    commercial: { currency: 'USD', gross_total: 200, net_total: 150, tax_total: 50, commission: 0, paid: 0, balance: 200, rate_includes_tax: true },
    units: [{ room_type: 'Deluxe Family Room', check_in: '2026-09-24', check_out: '2026-09-29', adults: 1, children: 0, nightly_rate: 43.33 }],
  }, over || {});
}
function ev(over) { return Object.assign({ channel_manager: 'beds24', external_id: 'BEDS-1', type: 'new', revision: '2026-09-22T10:00:00Z' }, over || {}); }

(async () => {
  // ── A. Booking.com existing multi-room reservation ────────────────────
  await test('A. multi-room Booking.com reservation already in the PMS (6881168090781/-2, real doc ids, real shared ota_ref) -- a NEW Beds24 booking for the first room LINKS the existing group, no new doc, no conflict', async () => {
    const { store, adapter } = await fresh();
    await seedMigrated(store, '6881168090781', { room_id: 'VR01', check_in: '2026-09-24', check_out: '2026-09-29', source: 'Booking.com', ota_ref: '6163768410', guest_name: 'Stefan Gesicki' });
    await seedMigrated(store, '6881168090781-2', { room_id: 'VR02', check_in: '2026-09-24', check_out: '2026-09-29', source: 'Booking.com', ota_ref: '6163768410', guest_name: 'Stefan Gesicki' });
    adapter.put(beds24Booking({ external_id: 'BEDS-1001' }));
    const r = await ingestEvent({ store, adapter, event: ev({ external_id: 'BEDS-1001' }) });
    assert.strictEqual(r.result, 'modified', 'linking an existing reservation is a modification, never a create');
    assert.deepStrictEqual(r.docs, ['6881168090781'], 'the first Beds24 booking for this group claims the first unclaimed unit, deterministically');
    assert.strictEqual((await activeDocs(store)).length, 2, 'still exactly 2 active reservations -- no 3rd/duplicate doc created');
    const alias = await getAlias(store, 'beds24', 'BEDS-1001');
    assert.ok(alias, 'an alias must be persisted for this Beds24 external id');
    assert.strictEqual(alias.pms_reservation_id, '6881168090781');
    assert.strictEqual((await store.list('ota_conflicts')).length, 0, 'no conflict raised');

    // second room of the SAME group, a different Beds24 booking id, same reference
    adapter.put(beds24Booking({ external_id: 'BEDS-1002' }));
    const r2 = await ingestEvent({ store, adapter, event: ev({ external_id: 'BEDS-1002', revision: '2026-09-22T10:00:01Z' }) });
    assert.strictEqual(r2.result, 'modified');
    assert.deepStrictEqual(r2.docs, ['6881168090781-2'], 'the second Beds24 booking for the same reference claims the OTHER group member, never the same one twice');
    assert.strictEqual((await activeDocs(store)).length, 2, 'still exactly 2 -- the whole group linked, no duplicate created for either room');

    // a THIRD, distinct Beds24 id under the same reference has no unclaimed unit left
    adapter.put(beds24Booking({ external_id: 'BEDS-1003' }));
    const r3 = await ingestEvent({ store, adapter, event: ev({ external_id: 'BEDS-1003', revision: '2026-09-22T10:00:02Z' }) });
    assert.strictEqual(r3.result, 'conflict');
    const cf = await store.list('ota_conflicts'); assert.strictEqual(cf.length, 1); assert.strictEqual(cf[0].reason, 'multi_room_match_ambiguous');
    assert.strictEqual((await activeDocs(store)).length, 2, 'never force-created a 3rd doc for an unexpected extra booking under the same reference');
  });

  // ── B/C. Expedia existing reservations -- AFTER the backfill populates ota_ref ──
  await test('B. Expedia reservation BK21814-0, AFTER backfill populates ota_ref -- a new Beds24 booking with the matching Expedia reference LINKS it (Tier 1), no duplicate', async () => {
    const { store, adapter } = await fresh();
    await seedMigrated(store, 'BK21814-0', { room_id: 'VR05', check_in: '2026-10-06', check_out: '2026-10-08', source: 'Expedia', ota_ref: 'EXP-REF-21814', guest_name: 'ISE Taichi' });
    adapter.put(beds24Booking({ external_id: 'BEDS-2001', channel: 'Expedia', channel_reservation_id: 'EXP-REF-21814', units: [{ room_type: 'Double Room', check_in: '2026-10-06', check_out: '2026-10-08', adults: 2, children: 0 }] }));
    const r = await ingestEvent({ store, adapter, event: ev({ external_id: 'BEDS-2001' }) });
    assert.strictEqual(r.result, 'modified'); assert.deepStrictEqual(r.docs, ['BK21814-0']);
    assert.strictEqual((await activeDocs(store)).length, 1, 'no duplicate created');
  });
  await test('C. Expedia reservation BK01278-0, AFTER backfill populates ota_ref -- same expectation', async () => {
    const { store, adapter } = await fresh();
    await seedMigrated(store, 'BK01278-0', { room_id: 'VR04', check_in: '2026-10-06', check_out: '2026-10-08', source: 'Expedia', ota_ref: 'EXP-REF-01278', guest_name: 'ISE MARIKO' });
    adapter.put(beds24Booking({ external_id: 'BEDS-2002', channel: 'Expedia', channel_reservation_id: 'EXP-REF-01278', units: [{ room_type: 'Double Room', check_in: '2026-10-06', check_out: '2026-10-08', adults: 2, children: 0 }] }));
    const r = await ingestEvent({ store, adapter, event: ev({ external_id: 'BEDS-2002' }) });
    assert.strictEqual(r.result, 'modified'); assert.deepStrictEqual(r.docs, ['BK01278-0']);
    assert.strictEqual((await activeDocs(store)).length, 1);
  });

  // ── D. Genuinely new booking ──────────────────────────────────────────
  await test('D. genuinely new Booking.com booking, no PMS match at all -> normal creation, not a link', async () => {
    const { store, adapter } = await fresh();
    adapter.put(beds24Booking({ external_id: 'BEDS-3001', channel_reservation_id: 'BDC-BRAND-NEW' }));
    const r = await ingestEvent({ store, adapter, event: ev({ external_id: 'BEDS-3001' }) });
    assert.strictEqual(r.result, 'created');
    assert.strictEqual((await activeDocs(store)).length, 1);
    assert.strictEqual((await store.get('reservations', 'OTA-beds24-BEDS-3001')).id, 'OTA-beds24-BEDS-3001', 'a genuinely new booking still uses the normal OTA-<cm>-<id> doc id');
  });

  // ── E. Reference collision across two unrelated PMS reservations ─────
  await test('E. the exact same upstream reference value happens to appear on two UNRELATED existing reservations (different stay dates) -> QUARANTINE, no write to either', async () => {
    const { store, adapter } = await fresh();
    await seedMigrated(store, 'COLLIDE-A', { room_id: 'VR01', check_in: '2026-11-01', check_out: '2026-11-05', source: 'Booking.com', ota_ref: 'DUPLICATE-REF' });
    await seedMigrated(store, 'COLLIDE-B', { room_id: 'VR03', check_in: '2027-01-10', check_out: '2027-01-12', source: 'Booking.com', ota_ref: 'DUPLICATE-REF' });
    const beforeA = JSON.stringify(await store.get('reservations', 'COLLIDE-A'));
    const beforeB = JSON.stringify(await store.get('reservations', 'COLLIDE-B'));
    adapter.put(beds24Booking({ external_id: 'BEDS-4001', channel_reservation_id: 'DUPLICATE-REF' }));
    const r = await ingestEvent({ store, adapter, event: ev({ external_id: 'BEDS-4001' }) });
    assert.strictEqual(r.result, 'conflict');
    const cf = await store.list('ota_conflicts'); assert.strictEqual(cf.length, 1); assert.strictEqual(cf[0].reason, 'upstream_reference_collision');
    assert.strictEqual(JSON.stringify(await store.get('reservations', 'COLLIDE-A')), beforeA, 'COLLIDE-A untouched');
    assert.strictEqual(JSON.stringify(await store.get('reservations', 'COLLIDE-B')), beforeB, 'COLLIDE-B untouched');
    assert.strictEqual((await activeDocs(store)).length, 2, 'no new reservation created either');
  });

  // ── F. No reference, exactly one structural candidate ────────────────
  await test('F. no upstream reference available, exactly ONE existing reservation matches structurally (channel + exact dates + room type) -> documented design: AUTO-LINKS', async () => {
    const { store, adapter } = await fresh();
    await seedMigrated(store, 'BK21814-0', { room_id: 'VR05', check_in: '2026-10-06', check_out: '2026-10-08', source: 'Expedia', guest_name: 'ISE Taichi' }); // no ota_ref -- the real, proven gap
    adapter.put(beds24Booking({ external_id: 'BEDS-5001', channel: 'Expedia', channel_reservation_id: '', units: [{ room_type: 'Double Room', check_in: '2026-10-06', check_out: '2026-10-08', adults: 2, children: 0 }] }));
    const r = await ingestEvent({ store, adapter, event: ev({ external_id: 'BEDS-5001' }) });
    assert.strictEqual(r.result, 'modified', 'auto-linked, not created');
    assert.deepStrictEqual(r.docs, ['BK21814-0']);
    assert.strictEqual((await activeDocs(store)).length, 1, 'no duplicate created');
    const alias = await getAlias(store, 'beds24', 'BEDS-5001');
    assert.strictEqual(alias.match_method, 'structural');
  });

  // ── G. No reference, two structural candidates -- the REAL scenario ──
  await test('G. no upstream reference, TWO existing reservations match structurally -- the exact real BK21814-0/BK01278-0 situation (same channel, same dates, same room type, different physical rooms Beds24 cannot distinguish) -> QUARANTINE', async () => {
    const { store, adapter } = await fresh();
    await seedMigrated(store, 'BK21814-0', { room_id: 'VR05', check_in: '2026-10-06', check_out: '2026-10-08', source: 'Expedia', guest_name: 'ISE Taichi' });
    await seedMigrated(store, 'BK01278-0', { room_id: 'VR04', check_in: '2026-10-06', check_out: '2026-10-08', source: 'Expedia', guest_name: 'ISE MARIKO' });
    adapter.put(beds24Booking({ external_id: 'BEDS-5002', channel: 'Expedia', channel_reservation_id: '', units: [{ room_type: 'Double Room', check_in: '2026-10-06', check_out: '2026-10-08', adults: 2, children: 0 }] }));
    const r = await ingestEvent({ store, adapter, event: ev({ external_id: 'BEDS-5002' }) });
    assert.strictEqual(r.result, 'conflict');
    const cf = await store.list('ota_conflicts'); assert.strictEqual(cf.length, 1); assert.strictEqual(cf[0].reason, 'existing_booking_match_ambiguous');
    assert.strictEqual((await store.get('reservations', 'BK21814-0')).room_id, 'VR05', 'untouched');
    assert.strictEqual((await store.get('reservations', 'BK01278-0')).room_id, 'VR04', 'untouched');
    assert.strictEqual((await activeDocs(store)).length, 2, 'no duplicate/3rd doc created');
  });

  // ── H. Linked booking cancellation ────────────────────────────────────
  await test('H. a linked booking is later cancelled at Beds24 -> the SAME PMS reservation is cancelled, no duplicate, alias preserved', async () => {
    const { store, adapter } = await fresh();
    await seedMigrated(store, '6881168090781', { room_id: 'VR01', check_in: '2026-09-24', check_out: '2026-09-29', source: 'Booking.com', ota_ref: '6163768410' });
    adapter.put(beds24Booking({ external_id: 'BEDS-1001' }));
    await ingestEvent({ store, adapter, event: ev({ external_id: 'BEDS-1001' }) });
    adapter.put(beds24Booking({ external_id: 'BEDS-1001', status: 'cancelled', revision: '2026-09-22T11:00:00Z' }));
    const r = await ingestEvent({ store, adapter, event: ev({ external_id: 'BEDS-1001', type: 'cancel', revision: '2026-09-22T11:00:00Z' }) });
    assert.strictEqual(r.result, 'cancelled'); assert.deepStrictEqual(r.docs, ['6881168090781']);
    assert.strictEqual((await store.get('reservations', '6881168090781')).status, 'Cancelled');
    assert.strictEqual((await activeDocs(store)).length, 0);
  });

  // ── I. Linked booking date modification ───────────────────────────────
  await test('I. a linked booking\'s dates change at Beds24 -> the SAME PMS reservation/group is updated, never re-created', async () => {
    const { store, adapter } = await fresh();
    await seedMigrated(store, '6881168090781', { room_id: 'VR01', check_in: '2026-09-24', check_out: '2026-09-29', source: 'Booking.com', ota_ref: '6163768410' });
    adapter.put(beds24Booking({ external_id: 'BEDS-1001' }));
    await ingestEvent({ store, adapter, event: ev({ external_id: 'BEDS-1001' }) });
    adapter.put(beds24Booking({ external_id: 'BEDS-1001', revision: '2026-09-22T11:00:00Z', units: [{ room_type: 'Deluxe Family Room', check_in: '2026-09-25', check_out: '2026-09-30', adults: 1, children: 0, nightly_rate: 43.33 }] }));
    const r = await ingestEvent({ store, adapter, event: ev({ external_id: 'BEDS-1001', type: 'modify', revision: '2026-09-22T11:00:00Z' }) });
    assert.strictEqual(r.result, 'modified'); assert.deepStrictEqual(r.docs, ['6881168090781']);
    const d = await store.get('reservations', '6881168090781');
    assert.strictEqual(d.check_in, '2026-09-25'); assert.strictEqual(d.check_out, '2026-09-30');
    assert.strictEqual((await activeDocs(store)).length, 1, 'still one reservation, not two');
  });

  // ── J. Linked multi-room modification keeps group intact ─────────────
  await test('J. one room of an already-linked multi-room group is modified -> that unit updates, the sibling unit is untouched, group stays 2 docs', async () => {
    const { store, adapter } = await fresh();
    await seedMigrated(store, '6881168090781', { room_id: 'VR01', check_in: '2026-09-24', check_out: '2026-09-29', source: 'Booking.com', ota_ref: '6163768410' });
    await seedMigrated(store, '6881168090781-2', { room_id: 'VR02', check_in: '2026-09-24', check_out: '2026-09-29', source: 'Booking.com', ota_ref: '6163768410' });
    adapter.put(beds24Booking({ external_id: 'BEDS-1001' }));
    await ingestEvent({ store, adapter, event: ev({ external_id: 'BEDS-1001' }) });
    adapter.put(beds24Booking({ external_id: 'BEDS-1002' }));
    await ingestEvent({ store, adapter, event: ev({ external_id: 'BEDS-1002', revision: '2026-09-22T10:00:01Z' }) });
    const before2 = JSON.stringify(await store.get('reservations', '6881168090781-2'));
    adapter.put(beds24Booking({ external_id: 'BEDS-1001', revision: '2026-09-22T12:00:00Z', units: [{ room_type: 'Deluxe Family Room', check_in: '2026-09-24', check_out: '2026-10-01', adults: 1, children: 0 }] }));
    const r = await ingestEvent({ store, adapter, event: ev({ external_id: 'BEDS-1001', type: 'modify', revision: '2026-09-22T12:00:00Z' }) });
    assert.strictEqual(r.result, 'modified'); assert.deepStrictEqual(r.docs, ['6881168090781']);
    assert.strictEqual((await store.get('reservations', '6881168090781')).check_out, '2026-10-01');
    assert.strictEqual(JSON.stringify(await store.get('reservations', '6881168090781-2')), before2, 'the sibling unit is completely untouched');
    assert.strictEqual((await activeDocs(store)).length, 2);
  });

  // ── K. Idempotent replay ───────────────────────────────────────────────
  await test('K. the exact same linking event replayed twice -> idempotent, no duplicate, second call is a no-op duplicate result', async () => {
    const { store, adapter } = await fresh();
    await seedMigrated(store, '6881168090781', { room_id: 'VR01', check_in: '2026-09-24', check_out: '2026-09-29', source: 'Booking.com', ota_ref: '6163768410' });
    adapter.put(beds24Booking({ external_id: 'BEDS-1001' }));
    const r1 = await ingestEvent({ store, adapter, event: ev({ external_id: 'BEDS-1001' }) });
    assert.strictEqual(r1.result, 'modified');
    const r2 = await ingestEvent({ store, adapter, event: ev({ external_id: 'BEDS-1001' }) }); // identical event, same revision
    assert.strictEqual(r2.result, 'duplicate');
    assert.strictEqual((await activeDocs(store)).length, 1);
    assert.strictEqual((await store.list(ALIAS_COLLECTION)).length, 1, 'still exactly one alias, not re-created on replay');
  });

  // ── L. Same guest/dates, different OTA reference -> never merged ─────
  await test('L. an unrelated NEW booking shares the same guest name and dates as an existing reservation but carries a DIFFERENT, non-matching OTA reference -> never merged (guest name is never a matching key)', async () => {
    const { store, adapter } = await fresh();
    await seedMigrated(store, 'EXISTING-1', { room_id: 'VR01', check_in: '2026-12-01', check_out: '2026-12-05', source: 'Booking.com', ota_ref: 'REF-OLD', guest_name: 'Jane Doe' });
    adapter.put(beds24Booking({ external_id: 'BEDS-6001', channel_reservation_id: 'REF-TOTALLY-DIFFERENT' }));
    adapter.bookings.get('BEDS-6001').guest = { first: 'Jane', last: 'Doe' };
    adapter.bookings.get('BEDS-6001').units = [{ room_type: 'Deluxe Family Room', check_in: '2026-12-01', check_out: '2026-12-05', adults: 1, children: 0 }];
    const r = await ingestEvent({ store, adapter, event: ev({ external_id: 'BEDS-6001' }) });
    assert.strictEqual(r.result, 'created', 'a non-matching reference is present, so this is treated as genuinely new -- never falls back to guessing from the guest name');
    assert.strictEqual((await activeDocs(store)).length, 2, 'EXISTING-1 and a new, separate reservation -- never merged');
  });

  // ── M. Agoda new booking after live cutover -- unaffected ────────────
  await test('M. a brand-new Agoda booking (the channel already live on Beds24) with no PMS match -> normal new-booking path, completely unaffected by the identity layer', async () => {
    const { store, adapter } = await fresh();
    adapter.put(beds24Booking({ external_id: 'BEDS-7001', channel: 'Agoda', channel_reservation_id: 'AGD-REF-NEW' }));
    const r = await ingestEvent({ store, adapter, event: ev({ external_id: 'BEDS-7001' }) });
    assert.strictEqual(r.result, 'created');
    assert.strictEqual((await activeDocs(store)).length, 1);
  });

  // ── Honest current-state gap (no fabrication): TODAY, without backfill,
  // the real BK21814-0/BK01278-0 have no ota_ref, so an incoming Beds24
  // Expedia booking WITH a real (non-empty) upstream reference cannot find
  // them via Tier 1 (nothing stored matches it) -- it is correctly treated
  // as new, not silently merged. This is exactly why Section 10's backfill
  // is required before cutover, and is asserted here so a future change
  // that accidentally started guessing in this gap would be caught.
  await test('current-state gap: Expedia booking with a REAL upstream reference, before backfill, finds no PMS match via Tier 1 (reference present but unmatched) -> new, not linked, not merged via structural fallback', async () => {
    const { store, adapter } = await fresh();
    await seedMigrated(store, 'BK21814-0', { room_id: 'VR05', check_in: '2026-10-06', check_out: '2026-10-08', source: 'Expedia', guest_name: 'ISE Taichi' }); // no ota_ref, matching real production data today
    adapter.put(beds24Booking({ external_id: 'BEDS-8001', channel: 'Expedia', channel_reservation_id: 'REAL-EXPEDIA-ITINERARY-NUMBER', units: [{ room_type: 'Double Room', check_in: '2026-10-06', check_out: '2026-10-08', adults: 2, children: 0 }] }));
    const r = await ingestEvent({ store, adapter, event: ev({ external_id: 'BEDS-8001' }) });
    assert.strictEqual(r.result, 'created', 'a present-but-unmatched reference is treated as new, never silently falls through to structural guessing');
    assert.strictEqual((await activeDocs(store)).length, 2, 'BK21814-0 untouched, plus one genuinely new reservation -- proves the pre-backfill gap is safe (creates a parallel doc, never corrupts the existing one), just not yet deduplicated');
  });

  console.log('\n' + passed + '/' + (passed + failed) + ' ota-cross-provider-identity assertions passed');
  process.exit(failed ? 1 : 0);
})();
