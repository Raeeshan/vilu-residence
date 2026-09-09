// OTA room-type commercial model — unit tests (Beds24 pre-integration stage).
// Pure logic only, no Firestore, no network, no live reservation touched.
//   node test/ota-room-types.test.js
const assert = require('assert');
const path = require('path');
const F = (p) => require(path.join(__dirname, '..', 'functions', 'lib', p));
const { ROOM_TYPE_ID_TO_CODE, CODE_TO_ROOM_TYPE_ID, INITIAL_OTA_ROOM_TYPES, computeOtaTypePayload, pendingOccupancyModel, pendingChildPricingModel } = F('ota-room-types');
const { PHYSICAL_ROOMS, ROOM_TYPE_CODES } = F('inventory');

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 8).join('\n     ')); } }

(async () => {
  await test('canonical room_type_id set matches the three owner-approved types, no more no less', () => {
    assert.deepStrictEqual(Object.keys(INITIAL_OTA_ROOM_TYPES).sort(), ['deluxe_family', 'double', 'open_deck']);
  });

  await test('room_type_id <-> existing UPPERCASE ROOM_TYPE_CODES mapping is a true bijection onto inventory.js', () => {
    assert.deepStrictEqual(new Set(Object.values(ROOM_TYPE_ID_TO_CODE)), new Set(Object.values(ROOM_TYPE_CODES)));
    for (const [id, code] of Object.entries(ROOM_TYPE_ID_TO_CODE)) assert.strictEqual(CODE_TO_ROOM_TYPE_ID[code], id);
  });

  await test('every OTA type physical_rooms list matches PHYSICAL_ROOMS exactly (no room invented, none dropped, none double-counted)', () => {
    const grouped = {};
    for (const r of PHYSICAL_ROOMS) { const code = ROOM_TYPE_CODES[r.type]; (grouped[code] = grouped[code] || []).push(r.id); }
    for (const [id, cfg] of Object.entries(INITIAL_OTA_ROOM_TYPES)) {
      const code = ROOM_TYPE_ID_TO_CODE[id];
      assert.deepStrictEqual(cfg.physical_rooms.slice().sort(), grouped[code].slice().sort(), id);
    }
    const allConfigured = Object.values(INITIAL_OTA_ROOM_TYPES).flatMap((c) => c.physical_rooms);
    assert.deepStrictEqual(allConfigured.slice().sort(), PHYSICAL_ROOMS.map((r) => r.id).slice().sort(), 'every physical room appears in exactly one OTA type');
  });

  await test('owner-locked base rates: Deluxe Family $80, Double $90, Open Deck $90 -- distinct from underlying physical PMS rates', () => {
    assert.strictEqual(INITIAL_OTA_ROOM_TYPES.deluxe_family.base_rate, 80);
    assert.strictEqual(INITIAL_OTA_ROOM_TYPES.double.base_rate, 90);
    assert.strictEqual(INITIAL_OTA_ROOM_TYPES.open_deck.base_rate, 90);
    // the Double OTA rate ($90) is deliberately NOT equal to VR03/VR04's physical PMS rate ($85) -- this
    // is the owner's resolution of the VR03/VR04 vs VR05 rate split documented in the preparation stage.
  });

  await test('owner-locked initial restrictions applied to all three types: min_stay=1, no CTA/CTD, no availability buffer', () => {
    for (const cfg of Object.values(INITIAL_OTA_ROOM_TYPES)) {
      assert.strictEqual(cfg.min_stay, 1, cfg.room_type_id);
      assert.strictEqual(cfg.max_stay, null, cfg.room_type_id);
      assert.strictEqual(cfg.closed_to_arrival, false, cfg.room_type_id);
      assert.strictEqual(cfg.closed_to_departure, false, cfg.room_type_id);
      assert.strictEqual(cfg.availability_buffer, 0, cfg.room_type_id);
      assert.strictEqual(cfg.currency, 'USD', cfg.room_type_id);
      assert.strictEqual(cfg.tax_mode, 'net_of_tax', cfg.room_type_id);
      assert.strictEqual(cfg.enabled, false, cfg.room_type_id + ' must stay disabled until a channel manager is connected');
    }
  });

  await test('owner-locked booking window and same-day cutoff applied to all three types', () => {
    for (const cfg of Object.values(INITIAL_OTA_ROOM_TYPES)) {
      assert.strictEqual(cfg.booking_window_days, 365, cfg.room_type_id);
      assert.deepStrictEqual(cfg.same_day_cutoff, { time: '12:00', timezone: 'Indian/Maldives' }, cfg.room_type_id);
    }
  });

  await test('occupancy/child pricing schema is capable but every leaf value stays owner_pending/null, never derived from old extra-bed logic', () => {
    for (const cfg of Object.values(INITIAL_OTA_ROOM_TYPES)) {
      assert.strictEqual(cfg.occupancy_model.status, 'owner_pending', cfg.room_type_id);
      for (const field of ['base_occupancy', 'single_occupancy_rate', 'extra_adult_rate']) {
        assert.strictEqual(cfg.occupancy_model[field], null, cfg.room_type_id + '.occupancy_model.' + field);
      }
      assert.strictEqual(cfg.child_pricing_model.status, 'owner_pending', cfg.room_type_id);
      for (const field of ['age_bands', 'child_supplement', 'infant_rules']) {
        assert.strictEqual(cfg.child_pricing_model[field], null, cfg.room_type_id + '.child_pricing_model.' + field);
      }
    }
  });

  await test('cancellation policy stays owner_pending, never reusing an old assumption', () => {
    for (const cfg of Object.values(INITIAL_OTA_ROOM_TYPES)) {
      assert.strictEqual(cfg.cancellation_policy_status, 'owner_pending', cfg.room_type_id);
    }
  });

  await test('meal plan intent is Breakfast Included (matches current product); no live OTA mapping created', () => {
    for (const cfg of Object.values(INITIAL_OTA_ROOM_TYPES)) {
      assert.strictEqual(cfg.meal_plan_mapping.intent, 'breakfast_included', cfg.room_type_id);
      assert.strictEqual(cfg.meal_plan_mapping.ota_mapping, null, cfg.room_type_id);
    }
  });

  await test('unresolved owner-pending fields are explicit null, never invented', () => {
    for (const cfg of Object.values(INITIAL_OTA_ROOM_TYPES)) {
      assert.strictEqual(cfg.commission, null, cfg.room_type_id + '.commission');
    }
  });

  await test('pendingOccupancyModel/pendingChildPricingModel helpers produce fresh, independent objects (no shared mutable reference across room types)', () => {
    const a = pendingOccupancyModel();
    const b = pendingOccupancyModel();
    assert.notStrictEqual(a, b);
    assert.deepStrictEqual(a, b);
    const c = pendingChildPricingModel();
    const d = pendingChildPricingModel();
    assert.notStrictEqual(c, d);
    assert.deepStrictEqual(c, d);
  });

  await test('computeOtaTypePayload: normal availability -> numAvail passes through unchanged, stopSell false', () => {
    const out = computeOtaTypePayload({ config: INITIAL_OTA_ROOM_TYPES.double, override: null, sellableAvailable: 2, sellableTotal: 3 });
    assert.strictEqual(out.numAvail, 2);
    assert.strictEqual(out.totalUnits, 3);
    assert.strictEqual(out.rate, 90);
    assert.strictEqual(out.stopSell, false);
    assert.strictEqual(out.minStay, 1);
  });

  await test('computeOtaTypePayload: sellableAvailable=0 -> stopSell true, numAvail 0 (canonical stop-sell rule)', () => {
    const out = computeOtaTypePayload({ config: INITIAL_OTA_ROOM_TYPES.open_deck, override: null, sellableAvailable: 0, sellableTotal: 1 });
    assert.strictEqual(out.stopSell, true);
    assert.strictEqual(out.numAvail, 0);
  });

  await test('computeOtaTypePayload: manual_stop_sell override forces stopSell true even with real availability', () => {
    const cfg = Object.assign({}, INITIAL_OTA_ROOM_TYPES.deluxe_family, { manual_stop_sell: true });
    const out = computeOtaTypePayload({ config: cfg, override: null, sellableAvailable: 2, sellableTotal: 2 });
    assert.strictEqual(out.stopSell, true);
    assert.strictEqual(out.numAvail, 0, 'a forced stop-sell must never advertise numAvail > 0');
  });

  await test('computeOtaTypePayload: availability_buffer subtracts from numAvail but never goes negative', () => {
    const cfg = Object.assign({}, INITIAL_OTA_ROOM_TYPES.double, { availability_buffer: 1 });
    const out = computeOtaTypePayload({ config: cfg, override: null, sellableAvailable: 1, sellableTotal: 3 });
    assert.strictEqual(out.numAvail, 0);
    assert.strictEqual(out.stopSell, true);
    const out2 = computeOtaTypePayload({ config: cfg, override: null, sellableAvailable: 0, sellableTotal: 3 });
    assert.strictEqual(out2.numAvail, 0, 'buffer must not underflow below zero');
  });

  await test('computeOtaTypePayload: a date-level override replaces rate/minStay/maxStay/CTA/CTD without touching the base config', () => {
    const before = JSON.stringify(INITIAL_OTA_ROOM_TYPES.double);
    const out = computeOtaTypePayload({ config: INITIAL_OTA_ROOM_TYPES.double, override: { rate: 110, minStay: 3, cta: true }, sellableAvailable: 3, sellableTotal: 3 });
    assert.strictEqual(out.rate, 110);
    assert.strictEqual(out.minStay, 3);
    assert.strictEqual(out.closedToArrival, true);
    assert.strictEqual(out.closedToDeparture, false, 'fields not present in the override must fall back to the base config');
    assert.strictEqual(JSON.stringify(INITIAL_OTA_ROOM_TYPES.double), before, 'the base config object itself must never be mutated');
  });

  await test('computeOtaTypePayload: an explicit override maxStay of null is honoured (not silently replaced by config)', () => {
    const cfg = Object.assign({}, INITIAL_OTA_ROOM_TYPES.deluxe_family, { max_stay: 30 });
    const out = computeOtaTypePayload({ config: cfg, override: { maxStay: null }, sellableAvailable: 1, sellableTotal: 2 });
    assert.strictEqual(out.maxStay, null);
  });

  await test('this harness never touches Firestore or the network (self-check)', () => {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'functions', 'lib', 'ota-room-types.js'), 'utf8');
    assert.ok(!/require\(['"]firebase|\bfetch\(|\bhttps?:\/\/\S/i.test(src), 'ota-room-types.js must stay pure/no network');
  });

  console.log('\n' + passed + '/' + (passed + failed) + ' ota-room-types assertions passed');
  process.exit(failed ? 1 : 0);
})();
