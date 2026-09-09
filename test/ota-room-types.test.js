// OTA room-type commercial model — unit tests (Beds24 pre-integration stage).
// Pure logic only, no Firestore, no network, no live reservation touched.
//   node test/ota-room-types.test.js
const assert = require('assert');
const path = require('path');
const F = (p) => require(path.join(__dirname, '..', 'functions', 'lib', p));
const { ROOM_TYPE_ID_TO_CODE, CODE_TO_ROOM_TYPE_ID, INITIAL_OTA_ROOM_TYPES, computeOtaTypePayload, computeOccupancyRate, computeThirdGuestSupplement, classifyGuestAge, ageAtCheckIn, daysBeforeArrival, computeCancellationCharge, computeNoShowCharge, approvedChildPricing } = F('ota-room-types');
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

  await test('occupancy policy is owner-approved: base_occupancy=2, third_guest_supplement=$20/night, applies without an extra bed', () => {
    for (const cfg of Object.values(INITIAL_OTA_ROOM_TYPES)) {
      assert.strictEqual(cfg.base_occupancy, 2, cfg.room_type_id);
      assert.deepStrictEqual(cfg.third_guest_supplement, { amount: 20, currency: 'USD', period: 'per_night', applies_without_extra_bed: true }, cfg.room_type_id);
    }
  });

  await test('infant/child/adult age policy is owner-approved: infant <2 free, child 2-11 = 50% discount, adult from 12', () => {
    for (const cfg of Object.values(INITIAL_OTA_ROOM_TYPES)) {
      assert.deepStrictEqual(cfg.infant_policy, { free_under_age: 2 }, cfg.room_type_id);
      assert.strictEqual(cfg.child_pricing.status, 'approved', cfg.room_type_id);
      assert.deepStrictEqual(cfg.child_pricing.infant, { min_age: 0, max_age_exclusive: 2, discount_percent: 100 }, cfg.room_type_id);
      assert.deepStrictEqual(cfg.child_pricing.child, { min_age: 2, max_age_exclusive: 12, discount_percent: 50 }, cfg.room_type_id);
      assert.strictEqual(cfg.child_pricing.adult_from_age, 12, cfg.room_type_id);
    }
  });

  await test('payment policy is owner-approved: pay at property, cash USD/EUR (no hardcoded exchange rate), card +3.5%, no online prepayment', () => {
    for (const cfg of Object.values(INITIAL_OTA_ROOM_TYPES)) {
      assert.deepStrictEqual(cfg.payment_policy, {
        timing: 'pay_at_property',
        cash_currencies: ['USD', 'EUR'],
        card_surcharge_percent: 3.5,
        online_prepayment_default: false,
      }, cfg.room_type_id);
    }
  });

  await test('cancellation policy is owner-approved and tiered: free 30+ days, 50% at 15-29 days, 100% at 0-14 days; no-show is now approved at 100%', () => {
    for (const cfg of Object.values(INITIAL_OTA_ROOM_TYPES)) {
      const cp = cfg.cancellation_policy;
      assert.strictEqual(cp.status, 'approved', cfg.room_type_id);
      assert.strictEqual(cp.free_from_days_before_arrival, 30, cfg.room_type_id);
      assert.deepStrictEqual(cp.tiers, [
        { from_days_before_arrival: 15, to_days_before_arrival: 29, charge_percent: 50 },
        { from_days_before_arrival: 0, to_days_before_arrival: 14, charge_percent: 100 },
      ], cfg.room_type_id);
      assert.deepStrictEqual(cp.no_show, { status: 'approved', charge_percent: 100 }, cfg.room_type_id);
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

  await test('approvedChildPricing() produces fresh, independent objects (no shared mutable reference across room types)', () => {
    const a = approvedChildPricing();
    const b = approvedChildPricing();
    assert.notStrictEqual(a, b);
    assert.deepStrictEqual(a, b);
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

  // ── Step 4: occupancy pricing tests ──
  await test('computeOccupancyRate: Deluxe Family $80 -- 1 and 2 guests = base rate, 3 guests = base + $20', () => {
    const cfg = INITIAL_OTA_ROOM_TYPES.deluxe_family;
    assert.strictEqual(computeOccupancyRate({ config: cfg, guestCount: 1 }).rate, 80);
    assert.strictEqual(computeOccupancyRate({ config: cfg, guestCount: 2 }).rate, 80);
    assert.strictEqual(computeOccupancyRate({ config: cfg, guestCount: 3 }).rate, 100);
  });

  await test('computeOccupancyRate: Double $90 -- 1 and 2 guests = base rate, 3 guests = base + $20', () => {
    const cfg = INITIAL_OTA_ROOM_TYPES.double;
    assert.strictEqual(computeOccupancyRate({ config: cfg, guestCount: 1 }).rate, 90);
    assert.strictEqual(computeOccupancyRate({ config: cfg, guestCount: 2 }).rate, 90);
    assert.strictEqual(computeOccupancyRate({ config: cfg, guestCount: 3 }).rate, 110);
  });

  await test('computeOccupancyRate: Open Deck $90 -- 1 and 2 guests = base rate, 3 guests = base + $20', () => {
    const cfg = INITIAL_OTA_ROOM_TYPES.open_deck;
    assert.strictEqual(computeOccupancyRate({ config: cfg, guestCount: 1 }).rate, 90);
    assert.strictEqual(computeOccupancyRate({ config: cfg, guestCount: 2 }).rate, 90);
    assert.strictEqual(computeOccupancyRate({ config: cfg, guestCount: 3 }).rate, 110);
  });

  await test('5 nights / Double / 3 guests = $550 before taxes/fees (matches the PMS fix\'s own worked example exactly)', () => {
    const out = computeOccupancyRate({ config: INITIAL_OTA_ROOM_TYPES.double, guestCount: 3 });
    assert.strictEqual(out.rate * 5, 550);
  });

  await test('computeOccupancyRate is capped at exactly one $20 supplement regardless of an over-capacity guest count', () => {
    const cfg = INITIAL_OTA_ROOM_TYPES.double;
    assert.strictEqual(computeOccupancyRate({ config: cfg, guestCount: 4 }).thirdGuestSupplement, 20);
    assert.strictEqual(computeOccupancyRate({ config: cfg, guestCount: 5 }).thirdGuestSupplement, 20);
  });

  // ── Step 4: extra-bed-requested must never change the charge (no double charge) ──
  await test('extra_bed_requested has no effect on the rate -- computeOccupancyRate does not even accept it as a parameter, by design', () => {
    const cfg = INITIAL_OTA_ROOM_TYPES.double;
    const withoutBed = computeOccupancyRate({ config: cfg, guestCount: 3, extraBedRequested: false });
    const withBed = computeOccupancyRate({ config: cfg, guestCount: 3, extraBedRequested: true });
    assert.strictEqual(withoutBed.rate, withBed.rate);
    assert.strictEqual(withBed.rate, 110);
  });

  // ── Step 3: cancellation calculation tests (date-only, Maldives-safe) ──
  await test('daysBeforeArrival: pure date-only day-count, no timezone/DST drift', () => {
    assert.strictEqual(daysBeforeArrival('2026-10-31', '2026-10-01'), 30);
    assert.strictEqual(daysBeforeArrival('2026-10-01', '2026-10-01'), 0);
    assert.strictEqual(daysBeforeArrival('2026-09-30', '2026-10-01'), -1);
  });

  await test('cancellation boundaries: 31 and 30 days = 0%, 29 and 15 days = 50%, 14 and 1 day = 100%, same-day = 100%', () => {
    const policy = INITIAL_OTA_ROOM_TYPES.double.cancellation_policy;
    const cases = [
      [31, 0], [30, 0],
      [29, 50], [15, 50],
      [14, 100], [1, 100], [0, 100],
    ];
    for (const [days, pct] of cases) {
      const out = computeCancellationCharge({ policy, daysBeforeArrival: days, totalBookingValue: null });
      assert.strictEqual(out.chargePercent, pct, `${days} days before arrival should be ${pct}%`);
    }
  });

  await test('cancellation charge amount is computed against the real total booking value, for multiple totals', () => {
    const policy = INITIAL_OTA_ROOM_TYPES.double.cancellation_policy;
    assert.strictEqual(computeCancellationCharge({ policy, daysBeforeArrival: 31, totalBookingValue: 550 }).chargeAmount, 0);
    assert.strictEqual(computeCancellationCharge({ policy, daysBeforeArrival: 20, totalBookingValue: 550 }).chargeAmount, 275);
    assert.strictEqual(computeCancellationCharge({ policy, daysBeforeArrival: 5, totalBookingValue: 550 }).chargeAmount, 550);
    assert.strictEqual(computeCancellationCharge({ policy, daysBeforeArrival: 20, totalBookingValue: 900.5 }).chargeAmount, 450.25);
  });

  await test('computeCancellationCharge never resolves a no-show, even now that no_show is approved -- it is a distinct event handled by computeNoShowCharge only', () => {
    const policy = INITIAL_OTA_ROOM_TYPES.double.cancellation_policy;
    assert.strictEqual(policy.no_show.status, 'approved');
    // the function itself has no branch that reads policy.no_show at all --
    // asserting its full source never references it is the strongest
    // "never conflated with a pre-arrival cancellation" guarantee available
    // to a static test.
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'functions', 'lib', 'ota-room-types.js'), 'utf8');
    const start = src.indexOf('function computeCancellationCharge');
    let i = src.indexOf('{', start) + 1, depth = 1;
    while (depth > 0 && i < src.length) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++; }
    const fnBody = src.slice(start, i); // brace-matched to the function's own closing '}' -- excludes any comment on the NEXT function
    assert.ok(!fnBody.includes('no_show'), 'computeCancellationCharge must never read/infer a no-show charge');
  });

  // ── Step 8 / owner-approved no-show ──
  await test('computeNoShowCharge: approved 100% no-show charge, computed against the real total booking value', () => {
    const policy = INITIAL_OTA_ROOM_TYPES.double.cancellation_policy;
    const out = computeNoShowCharge({ policy, totalBookingValue: 550 });
    assert.strictEqual(out.chargePercent, 100);
    assert.strictEqual(out.chargeAmount, 550);
  });

  await test('computeNoShowCharge throws rather than silently charging if no_show is ever reverted to owner_pending', () => {
    const policy = { no_show: { status: 'owner_pending' } };
    assert.throws(() => computeNoShowCharge({ policy, totalBookingValue: 550 }), /not approved/);
  });

  // ── Step 4: age boundary tests ──
  await test('classifyGuestAge boundaries: age 0 and 1 = infant, age 2 and 11 = child, age 12 and 13 = adult', () => {
    const cp = INITIAL_OTA_ROOM_TYPES.double.child_pricing;
    assert.strictEqual(classifyGuestAge(0, cp), 'infant');
    assert.strictEqual(classifyGuestAge(1, cp), 'infant');
    assert.strictEqual(classifyGuestAge(2, cp), 'child');
    assert.strictEqual(classifyGuestAge(11, cp), 'child');
    assert.strictEqual(classifyGuestAge(12, cp), 'adult');
    assert.strictEqual(classifyGuestAge(13, cp), 'adult');
  });

  await test('ageAtCheckIn: age is computed as of the check-in date, not today and not the booking date', () => {
    // Turns 12 exactly on the check-in date -> already 12 (adult), not 11.
    assert.strictEqual(ageAtCheckIn('2014-09-09', '2026-09-09'), 12);
    // Birthday is one day AFTER check-in -> still 11 (child) at check-in.
    assert.strictEqual(ageAtCheckIn('2014-09-10', '2026-09-09'), 11);
    // Booking made today (2026-09-09) for a future stay -- age must reflect
    // the age AT ARRIVAL, not the age today: a child born 2024-08-01 is 2
    // today, but will have turned 2 well before a 2027-01-15 check-in and
    // must still resolve to 2 (child), not be miscounted as an infant by
    // using "today" instead of the real check-in date.
    assert.strictEqual(ageAtCheckIn('2024-08-01', '2027-01-15'), 2);
  });

  await test('computeThirdGuestSupplement: adult (no age given) = full $20, never invents a discount for an unknown age', () => {
    const out = computeThirdGuestSupplement({ config: INITIAL_OTA_ROOM_TYPES.double });
    assert.strictEqual(out.amount, 20);
    assert.strictEqual(out.category, 'adult');
  });

  await test('computeThirdGuestSupplement: child age 2-11 = 50% of $20 = $10', () => {
    const cfg = INITIAL_OTA_ROOM_TYPES.double;
    assert.strictEqual(computeThirdGuestSupplement({ config: cfg, thirdGuestAge: 2 }).amount, 10);
    assert.strictEqual(computeThirdGuestSupplement({ config: cfg, thirdGuestAge: 11 }).amount, 10);
  });

  await test('computeThirdGuestSupplement: infant under 2 = $0 (100% discount)', () => {
    const cfg = INITIAL_OTA_ROOM_TYPES.double;
    assert.strictEqual(computeThirdGuestSupplement({ config: cfg, thirdGuestAge: 0 }).amount, 0);
    assert.strictEqual(computeThirdGuestSupplement({ config: cfg, thirdGuestAge: 1 }).amount, 0);
  });

  await test('computeThirdGuestSupplement: age 12 = adult pricing, full $20 -- not the child discount', () => {
    const out = computeThirdGuestSupplement({ config: INITIAL_OTA_ROOM_TYPES.double, thirdGuestAge: 12 });
    assert.strictEqual(out.amount, 20);
    assert.strictEqual(out.category, 'adult');
  });

  // ── Step 3: occupancy examples, Double $90/night ──
  await test('Double $90: 2 adults = $90 before taxes/fees', () => {
    assert.strictEqual(computeOccupancyRate({ config: INITIAL_OTA_ROOM_TYPES.double, guestCount: 2 }).rate, 90);
  });
  await test('Double $90: 2 adults + 1 adult = $110 before taxes/fees', () => {
    const out = computeOccupancyRate({ config: INITIAL_OTA_ROOM_TYPES.double, guestCount: 3, thirdGuestAge: 30 });
    assert.strictEqual(out.rate, 110);
  });
  await test('Double $90: 2 adults + 1 child age 11 = $100 before taxes/fees', () => {
    const out = computeOccupancyRate({ config: INITIAL_OTA_ROOM_TYPES.double, guestCount: 3, thirdGuestAge: 11 });
    assert.strictEqual(out.rate, 100);
  });
  await test('Double $90: 2 adults + 1 child age 2 = $100 before taxes/fees', () => {
    const out = computeOccupancyRate({ config: INITIAL_OTA_ROOM_TYPES.double, guestCount: 3, thirdGuestAge: 2 });
    assert.strictEqual(out.rate, 100);
  });
  await test('Double $90: 2 adults + 1 infant age 1 = $90 before taxes/fees', () => {
    const out = computeOccupancyRate({ config: INITIAL_OTA_ROOM_TYPES.double, guestCount: 3, thirdGuestAge: 1 });
    assert.strictEqual(out.rate, 90);
  });
  await test('Double $90: 3rd guest age 12 = adult pricing = $110 before taxes/fees', () => {
    const out = computeOccupancyRate({ config: INITIAL_OTA_ROOM_TYPES.double, guestCount: 3, thirdGuestAge: 12 });
    assert.strictEqual(out.rate, 110);
  });

  await test('this harness never touches Firestore or the network (self-check)', () => {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'functions', 'lib', 'ota-room-types.js'), 'utf8');
    assert.ok(!/require\(['"]firebase|\bfetch\(|\bhttps?:\/\/\S/i.test(src), 'ota-room-types.js must stay pure/no network');
  });

  console.log('\n' + passed + '/' + (passed + failed) + ' ota-room-types assertions passed');
  process.exit(failed ? 1 : 0);
})();
