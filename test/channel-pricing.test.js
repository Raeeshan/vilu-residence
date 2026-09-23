// PMS-driven multi-slot OTA rates -- unit tests. Pure logic only, no
// network, no live Beds24 write. Covers: canonical seasonal rate lookup,
// interval-coverage validation, money-safe channel-rate calculation,
// multi-slot payload isolation (Phase R4's "omitted slot untouched"
// requirement), differential-payload date compression, and the feature-flag
// wiring for the new 'channel_rate' job intent.
//   node test/channel-pricing.test.js
const assert = require('assert');
const path = require('path');
const F = (p) => require(path.join(__dirname, '..', 'functions', 'lib', p));
const {
  INITIAL_CANONICAL_RATES,
  CHANNEL_PRICING_RULES,
  pmsManagedChannels,
  resolveCanonicalRate,
  validateIntervalCoverage,
  calculateChannelRate,
  computeChannelRateForDate,
  shadowCompareChannelRate,
} = F('channel-pricing');
const {
  buildBeds24CalendarPayload,
  buildChannelRatePayload,
  compressChannelRateRanges,
  buildChannelRateDifferentialPayload,
  buildBeds24PushRecord,
} = F('beds24-bridge');
const { otaFeatureEnabled, OUTBOUND_JOB_INTENT_FLAG, OTA_CONFIG_DEFAULTS } = F('ota-feature-flags');

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 8).join('\n     ')); } }

const BOOKING_RULE = CHANNEL_PRICING_RULES.booking;
const DELUXE_INTERVALS = INITIAL_CANONICAL_RATES.deluxe_family.intervals;

// --- Canonical rate calendar -------------------------------------------------
test('INITIAL_CANONICAL_RATES has all 3 room types with the identical verified 5-interval schedule', () => {
  assert.deepStrictEqual(Object.keys(INITIAL_CANONICAL_RATES).sort(), ['deluxe_family', 'double', 'open_deck']);
  for (const id of Object.keys(INITIAL_CANONICAL_RATES)) {
    assert.deepStrictEqual(INITIAL_CANONICAL_RATES[id].intervals.map((i) => i.rate), [60, 130, 75, 130, 120]);
  }
});
test('INITIAL_CANONICAL_RATES is frozen at every level', () => {
  assert.ok(Object.isFrozen(INITIAL_CANONICAL_RATES));
  assert.ok(Object.isFrozen(INITIAL_CANONICAL_RATES.deluxe_family));
  assert.ok(Object.isFrozen(INITIAL_CANONICAL_RATES.deluxe_family.intervals));
  assert.ok(Object.isFrozen(INITIAL_CANONICAL_RATES.deluxe_family.intervals[0]));
});
test('validateIntervalCoverage: the real verified schedule has no gaps and no overlaps', () => {
  assert.deepStrictEqual(validateIntervalCoverage(DELUXE_INTERVALS), []);
});
test('validateIntervalCoverage: detects a gap', () => {
  const withGap = [{ from: '2026-01-01', to: '2026-01-10', rate: 100 }, { from: '2026-01-12', to: '2026-01-20', rate: 100 }];
  const problems = validateIntervalCoverage(withGap);
  assert.strictEqual(problems.length, 1);
  assert.strictEqual(problems[0].reason, 'gap');
});
test('validateIntervalCoverage: detects an overlap', () => {
  const withOverlap = [{ from: '2026-01-01', to: '2026-01-10', rate: 100 }, { from: '2026-01-09', to: '2026-01-20', rate: 100 }];
  const problems = validateIntervalCoverage(withOverlap);
  assert.strictEqual(problems.length, 1);
  assert.strictEqual(problems[0].reason, 'overlap');
});

// --- resolveCanonicalRate: exact boundary tests (Phase R7's own list) -------
test('resolveCanonicalRate: 2026-12-01 (last day of interval 1) = 60, 2026-12-02 (first day of interval 2) = 130', () => {
  assert.strictEqual(resolveCanonicalRate({ intervals: DELUXE_INTERVALS, date: '2026-12-01' }), 60);
  assert.strictEqual(resolveCanonicalRate({ intervals: DELUXE_INTERVALS, date: '2026-12-02' }), 130);
});
test('resolveCanonicalRate: 2026-12-20 (last day of interval 2) = 130, 2026-12-21 (first day of interval 3) = 75', () => {
  assert.strictEqual(resolveCanonicalRate({ intervals: DELUXE_INTERVALS, date: '2026-12-20' }), 130);
  assert.strictEqual(resolveCanonicalRate({ intervals: DELUXE_INTERVALS, date: '2026-12-21' }), 75);
});
test('resolveCanonicalRate: 2026-12-31 (last day of interval 3) = 75, 2027-01-01 (first day of interval 4) = 130', () => {
  assert.strictEqual(resolveCanonicalRate({ intervals: DELUXE_INTERVALS, date: '2026-12-31' }), 75);
  assert.strictEqual(resolveCanonicalRate({ intervals: DELUXE_INTERVALS, date: '2027-01-01' }), 130);
});
test('resolveCanonicalRate: 2027-04-30 (last day of interval 4) = 130, 2027-05-01 (first day of interval 5) = 120', () => {
  assert.strictEqual(resolveCanonicalRate({ intervals: DELUXE_INTERVALS, date: '2027-04-30' }), 130);
  assert.strictEqual(resolveCanonicalRate({ intervals: DELUXE_INTERVALS, date: '2027-05-01' }), 120);
});
test('resolveCanonicalRate: a date outside every interval returns null, never throws', () => {
  assert.strictEqual(resolveCanonicalRate({ intervals: DELUXE_INTERVALS, date: '2025-01-01' }), null);
  assert.strictEqual(resolveCanonicalRate({ intervals: DELUXE_INTERVALS, date: '2029-01-01' }), null);
});

// --- calculateChannelRate: money-safe +10%, exact required results ---------
test('calculateChannelRate: 60 -> 66.00 exactly (no floating-point drift)', () => {
  const r = calculateChannelRate({ baseRate: 60, rule: BOOKING_RULE });
  assert.strictEqual(r, 66);
  assert.strictEqual(Object.is(r, 65.99999999999999), false);
});
test('calculateChannelRate: 130 -> 143.00 exactly', () => {
  assert.strictEqual(calculateChannelRate({ baseRate: 130, rule: BOOKING_RULE }), 143);
});
test('calculateChannelRate: 75 -> 82.50 exactly', () => {
  assert.strictEqual(calculateChannelRate({ baseRate: 75, rule: BOOKING_RULE }), 82.5);
});
test('calculateChannelRate: 120 -> 132.00 exactly', () => {
  assert.strictEqual(calculateChannelRate({ baseRate: 120, rule: BOOKING_RULE }), 132);
});
test('calculateChannelRate: throws on a non-finite baseRate rather than silently computing NaN', () => {
  assert.throws(() => calculateChannelRate({ baseRate: null, rule: BOOKING_RULE }));
  assert.throws(() => calculateChannelRate({ baseRate: NaN, rule: BOOKING_RULE }));
});
test('calculateChannelRate: throws on an unknown pricing_mode', () => {
  assert.throws(() => calculateChannelRate({ baseRate: 60, rule: { pricing_mode: 'bogus' } }));
});
test('calculateChannelRate: fixed pricing_mode adds a flat amount', () => {
  const rule = { pricing_mode: 'fixed', fixed_adjustment: 5 };
  assert.strictEqual(calculateChannelRate({ baseRate: 60, rule }), 65);
});

// --- computeChannelRateForDate: full schedule, all 5 owner-specified windows -
test('computeChannelRateForDate: full Booking.com shadow schedule matches the owner-specified 66/143/82.50/143/132', () => {
  const cases = [
    ['2026-09-23', 60, 66], ['2026-11-01', 60, 66], ['2026-12-01', 60, 66],
    ['2026-12-02', 130, 143], ['2026-12-10', 130, 143], ['2026-12-20', 130, 143],
    ['2026-12-21', 75, 82.5], ['2026-12-25', 75, 82.5], ['2026-12-31', 75, 82.5],
    ['2027-01-01', 130, 143], ['2027-02-01', 130, 143], ['2027-04-30', 130, 143],
    ['2027-05-01', 120, 132], ['2027-06-01', 120, 132], ['2028-08-31', 120, 132],
  ];
  for (const [date, expectedBase, expectedRate] of cases) {
    const computed = computeChannelRateForDate({ intervals: DELUXE_INTERVALS, date, rule: BOOKING_RULE });
    assert.ok(computed, 'no result for ' + date);
    assert.strictEqual(computed.baseRate, expectedBase, date + ' baseRate');
    assert.strictEqual(computed.rate, expectedRate, date + ' rate');
    assert.strictEqual(computed.slot, 3, date + ' slot');
    assert.strictEqual(computed.channel, 'booking', date + ' channel');
  }
});
test('computeChannelRateForDate: returns null (never throws) for a date with no canonical interval', () => {
  assert.strictEqual(computeChannelRateForDate({ intervals: DELUXE_INTERVALS, date: '2025-06-01', rule: BOOKING_RULE }), null);
});

// --- Channel isolation: Agoda/Direct disabled, Booking.com the only PMS-managed channel ---
test('pmsManagedChannels: ONLY booking is enabled+managed_by_pms today (Phase R8 isolation)', () => {
  assert.deepStrictEqual(pmsManagedChannels(), ['booking']);
});
test('CHANNEL_PRICING_RULES.agoda and .direct exist (future-proofed schema) but are both disabled/not managed_by_pms', () => {
  assert.strictEqual(CHANNEL_PRICING_RULES.agoda.enabled, false);
  assert.strictEqual(CHANNEL_PRICING_RULES.agoda.managed_by_pms, false);
  assert.strictEqual(CHANNEL_PRICING_RULES.agoda.beds24_price_slot, 2);
  assert.strictEqual(CHANNEL_PRICING_RULES.direct.enabled, false);
  assert.strictEqual(CHANNEL_PRICING_RULES.direct.managed_by_pms, false);
  assert.strictEqual(CHANNEL_PRICING_RULES.direct.beds24_price_slot, 1);
});
test('CHANNEL_PRICING_RULES.booking targets slot 3 with a +10% percentage rule', () => {
  assert.strictEqual(BOOKING_RULE.beds24_price_slot, 3);
  assert.strictEqual(BOOKING_RULE.pricing_mode, 'percentage');
  assert.strictEqual(BOOKING_RULE.percentage_adjustment, 10);
  assert.strictEqual(BOOKING_RULE.enabled, true);
  assert.strictEqual(BOOKING_RULE.managed_by_pms, true);
});

// --- buildBeds24CalendarPayload: backward compatibility (Phase R4) ---------
test('buildBeds24CalendarPayload: omitting priceSlot still writes price1 exactly as before (zero regression)', () => {
  const p = buildBeds24CalendarPayload({ roomTypeCode: 'DELUXE_FAMILY', from: '2026-11-01', to: '2026-11-01', rate: 80, includeOverride: false });
  assert.strictEqual(p.calendar[0].price1, 80);
  assert.strictEqual('price2' in p.calendar[0], false);
  assert.strictEqual('price3' in p.calendar[0], false);
});
test('buildBeds24CalendarPayload: priceSlot:3 writes price3, never price1/price2', () => {
  const p = buildBeds24CalendarPayload({ roomTypeCode: 'DELUXE_FAMILY', from: '2026-11-01', to: '2026-11-01', rate: 66, priceSlot: 3, includeOverride: false });
  assert.strictEqual(p.calendar[0].price3, 66);
  assert.strictEqual('price1' in p.calendar[0], false);
  assert.strictEqual('price2' in p.calendar[0], false);
});
test('buildBeds24CalendarPayload: rejects an out-of-range priceSlot', () => {
  assert.throws(() => buildBeds24CalendarPayload({ roomTypeCode: 'DELUXE_FAMILY', from: '2026-11-01', to: '2026-11-01', rate: 66, priceSlot: 17 }));
  assert.throws(() => buildBeds24CalendarPayload({ roomTypeCode: 'DELUXE_FAMILY', from: '2026-11-01', to: '2026-11-01', rate: 66, priceSlot: 0 }));
});

// --- buildChannelRatePayload: structurally isolated (Phase R4's core requirement) ---
test('buildChannelRatePayload: emits ONLY the target price field -- no numAvail, minStay, maxStay, or override, ever', () => {
  const p = buildChannelRatePayload({ roomTypeCode: 'DELUXE_FAMILY', from: '2026-11-01', to: '2026-11-26', priceSlot: 3, rate: 66 });
  assert.deepStrictEqual(p, { roomId: 727992, calendar: [{ from: '2026-11-01', to: '2026-11-26', price3: 66 }] });
  assert.strictEqual(Object.keys(p.calendar[0]).sort().join(','), 'from,price3,to');
});
test('buildChannelRatePayload: rejects a non-finite rate and an out-of-range slot', () => {
  assert.throws(() => buildChannelRatePayload({ roomTypeCode: 'DELUXE_FAMILY', from: '2026-11-01', to: '2026-11-01', priceSlot: 3, rate: null }));
  assert.throws(() => buildChannelRatePayload({ roomTypeCode: 'DELUXE_FAMILY', from: '2026-11-01', to: '2026-11-01', priceSlot: 0, rate: 66 }));
});

// --- compressChannelRateRanges ------------------------------------------------
test('compressChannelRateRanges: merges consecutive equal-rate dates into one range, splits on a rate change', () => {
  const entries = [
    { date: '2026-11-01', rate: 66 }, { date: '2026-11-02', rate: 66 }, { date: '2026-11-03', rate: 66 },
    { date: '2026-11-04', rate: 143 }, { date: '2026-11-05', rate: 143 },
  ];
  assert.deepStrictEqual(compressChannelRateRanges(entries), [
    { from: '2026-11-01', to: '2026-11-03', rate: 66 },
    { from: '2026-11-04', to: '2026-11-05', rate: 143 },
  ]);
});
test('compressChannelRateRanges: a non-contiguous date gap starts a new range even if the rate is identical', () => {
  const entries = [{ date: '2026-11-01', rate: 66 }, { date: '2026-11-05', rate: 66 }];
  assert.deepStrictEqual(compressChannelRateRanges(entries), [
    { from: '2026-11-01', to: '2026-11-01', rate: 66 },
    { from: '2026-11-05', to: '2026-11-05', rate: 66 },
  ]);
});
test('compressChannelRateRanges: empty input returns empty output', () => {
  assert.deepStrictEqual(compressChannelRateRanges([]), []);
});

// --- buildChannelRateDifferentialPayload: full boundary-crossing scenario ---
test('buildChannelRateDifferentialPayload: a date range spanning all 5 intervals compresses into exactly 5 ranges with the exact expected prices', () => {
  const dates = [];
  const D = require(path.join(__dirname, '..', 'functions', 'lib', 'inventory'));
  for (let d = '2026-09-23'; d <= '2027-06-01'; d = D.addDays(d, 1)) dates.push(d);
  const built = buildChannelRateDifferentialPayload({ roomTypeCode: 'DELUXE_FAMILY', dates, canonicalIntervals: DELUXE_INTERVALS, rule: BOOKING_RULE });
  assert.deepStrictEqual(built.invalid, []);
  assert.strictEqual(built.grouped.length, 1);
  assert.strictEqual(built.grouped[0].roomId, 727992);
  const cal = built.grouped[0].calendar;
  assert.strictEqual(cal.length, 5, 'expected exactly 5 compressed ranges, one per canonical interval');
  assert.deepStrictEqual(cal.map((c) => c.price3), [66, 143, 82.5, 143, 132]);
  assert.strictEqual(cal[0].from, '2026-09-23'); assert.strictEqual(cal[0].to, '2026-12-01');
  assert.strictEqual(cal[1].from, '2026-12-02'); assert.strictEqual(cal[1].to, '2026-12-20');
  assert.strictEqual(cal[2].from, '2026-12-21'); assert.strictEqual(cal[2].to, '2026-12-31');
  assert.strictEqual(cal[3].from, '2027-01-01'); assert.strictEqual(cal[3].to, '2027-04-30');
  assert.strictEqual(cal[4].from, '2027-05-01'); assert.strictEqual(cal[4].to, '2027-06-01'); // truncated at the query window's end, not the full interval -- correct: this range is still open-ended in reality
  // Every entry carries ONLY price3 -- never price1/price2/numAvail/minStay/maxStay/override.
  for (const c of cal) assert.strictEqual(Object.keys(c).sort().join(','), 'from,price3,to');
});
test('buildChannelRateDifferentialPayload: a date outside every canonical interval is reported invalid and produces NO grouped payload at all (fail closed, never a partial push)', () => {
  const built = buildChannelRateDifferentialPayload({ roomTypeCode: 'DELUXE_FAMILY', dates: ['2026-11-01', '2025-01-01'], canonicalIntervals: DELUXE_INTERVALS, rule: BOOKING_RULE });
  assert.strictEqual(built.invalid.length, 1);
  assert.strictEqual(built.invalid[0].date, '2025-01-01');
  assert.deepStrictEqual(built.grouped, []);
});
test('buildChannelRateDifferentialPayload: works identically for all 3 room types (different Beds24 room ids, same schedule)', () => {
  const codes = [['DELUXE_FAMILY', 727992], ['DOUBLE', 728133], ['DELUXE_FAMILY_OPEN_DECK', 728134]];
  for (const [code, roomId] of codes) {
    const built = buildChannelRateDifferentialPayload({ roomTypeCode: code, dates: ['2026-12-25'], canonicalIntervals: DELUXE_INTERVALS, rule: BOOKING_RULE });
    assert.strictEqual(built.grouped[0].roomId, roomId);
    assert.strictEqual(built.grouped[0].calendar[0].price3, 82.5);
  }
});

// --- Feature flag wiring for the new 'channel_rate' intent ------------------
test('OUTBOUND_JOB_INTENT_FLAG.channel_rate maps to a NEW, independent flag -- never reuses outbound_rates_enabled', () => {
  assert.strictEqual(OUTBOUND_JOB_INTENT_FLAG.channel_rate, 'outbound_channel_rates_enabled');
  assert.notStrictEqual(OUTBOUND_JOB_INTENT_FLAG.channel_rate, OUTBOUND_JOB_INTENT_FLAG.rate);
});
test('OTA_CONFIG_DEFAULTS.outbound_channel_rates_enabled defaults to false (fail closed)', () => {
  assert.strictEqual(OTA_CONFIG_DEFAULTS.outbound_channel_rates_enabled, false);
});
test('otaFeatureEnabled: channel_rate stays disabled even if master enabled=true, until its own granular flag is explicitly true', () => {
  assert.strictEqual(otaFeatureEnabled({ enabled: true }, 'outbound_channel_rates_enabled'), false);
  assert.strictEqual(otaFeatureEnabled({ enabled: true, outbound_channel_rates_enabled: true }, 'outbound_channel_rates_enabled'), true);
  assert.strictEqual(otaFeatureEnabled({ enabled: false, outbound_channel_rates_enabled: true }, 'outbound_channel_rates_enabled'), false, 'master switch off must still disable it');
});
test('otaFeatureEnabled: turning channel_rate on does NOT also turn on outbound_rates_enabled (price1) or outbound_availability_enabled -- true isolation', () => {
  const cfg = { enabled: true, outbound_channel_rates_enabled: true };
  assert.strictEqual(otaFeatureEnabled(cfg, 'outbound_rates_enabled'), false);
  assert.strictEqual(otaFeatureEnabled(cfg, 'outbound_availability_enabled'), false);
  assert.strictEqual(otaFeatureEnabled(cfg, 'outbound_restrictions_enabled'), false);
});

// --- buildBeds24PushRecord: new `channel` field ------------------------------
test('buildBeds24PushRecord: channel_rate job carries job_intent + channel; every other intent leaves channel null', () => {
  const bookingJob = buildBeds24PushRecord({ roomTypeCode: 'DELUXE_FAMILY', dateRange: { affected_dates: ['2026-11-01'] }, payload: null, status: 'pending', trigger: 'canonical_room_rates:deluxe_family', jobIntent: 'channel_rate', channel: 'booking' });
  assert.strictEqual(bookingJob.record.job_intent, 'channel_rate');
  assert.strictEqual(bookingJob.record.channel, 'booking');
  const availJob = buildBeds24PushRecord({ roomTypeCode: 'DELUXE_FAMILY', dateRange: { affected_dates: ['2026-11-01'] }, payload: null, status: 'pending', trigger: 'reservation:x', jobIntent: 'availability' });
  assert.strictEqual(availJob.record.channel, null);
});

// --- Stale-update / recompute-at-execution-time protection (Phase R5) -------
test('buildChannelRateDifferentialPayload always recomputes from the CURRENT canonical intervals passed in -- never trusts a precomputed rate; three "generations" of the same date resolve to whatever intervals are supplied at call time', () => {
  const gen1 = [{ from: '2026-01-01', to: '2026-01-31', rate: 60 }];
  const gen2 = [{ from: '2026-01-01', to: '2026-01-31', rate: 70 }];
  const gen3 = [{ from: '2026-01-01', to: '2026-01-31', rate: 80 }];
  const r1 = buildChannelRateDifferentialPayload({ roomTypeCode: 'DELUXE_FAMILY', dates: ['2026-01-15'], canonicalIntervals: gen1, rule: BOOKING_RULE });
  const r2 = buildChannelRateDifferentialPayload({ roomTypeCode: 'DELUXE_FAMILY', dates: ['2026-01-15'], canonicalIntervals: gen2, rule: BOOKING_RULE });
  const r3 = buildChannelRateDifferentialPayload({ roomTypeCode: 'DELUXE_FAMILY', dates: ['2026-01-15'], canonicalIntervals: gen3, rule: BOOKING_RULE });
  // A "stale" job that only carries dates (never a captured rate) and is
  // executed AFTER gen3 is live must produce gen3's price -- exactly what
  // happens here because the worker always re-reads live intervals at
  // execution time (this function has no way to accept a stale rate at all,
  // which is the actual protection: there is no field for one).
  assert.strictEqual(r1.grouped[0].calendar[0].price3, 66);
  assert.strictEqual(r2.grouped[0].calendar[0].price3, 77);
  assert.strictEqual(r3.grouped[0].calendar[0].price3, 88);
});

// --- Shadow-mode / dry-run validation (Phase R7) ----------------------------
test('shadowCompareChannelRate: all observed values matching the canonical calculation -> allMatch true, zero mismatches', () => {
  const intervals = [{ from: '2026-01-01', to: '2026-01-31', rate: 60 }];
  const observed = { '2026-01-10': 66, '2026-01-20': 66 }; // 60 * 1.10 = 66, live-proven fingerprint
  const result = shadowCompareChannelRate({ intervals, rule: BOOKING_RULE, observed });
  assert.strictEqual(result.allMatch, true);
  assert.strictEqual(result.mismatches.length, 0);
  assert.strictEqual(result.rows.length, 2);
});
test('shadowCompareChannelRate: a wrong observed value is surfaced as a mismatch, never silently ignored', () => {
  const intervals = [{ from: '2026-01-01', to: '2026-01-31', rate: 60 }];
  const observed = { '2026-01-10': 66, '2026-01-20': 999 }; // 999 does not match the expected 66
  const result = shadowCompareChannelRate({ intervals, rule: BOOKING_RULE, observed });
  assert.strictEqual(result.allMatch, false);
  assert.strictEqual(result.mismatches.length, 1);
  assert.strictEqual(result.mismatches[0].date, '2026-01-20');
  assert.strictEqual(result.mismatches[0].expected, 66);
  assert.strictEqual(result.mismatches[0].observed, 999);
});
test('shadowCompareChannelRate: an observed date outside any canonical interval -> mismatch (expected null), never crashes', () => {
  const intervals = [{ from: '2026-01-01', to: '2026-01-31', rate: 60 }];
  const observed = { '2099-01-01': 66 };
  const result = shadowCompareChannelRate({ intervals, rule: BOOKING_RULE, observed });
  assert.strictEqual(result.allMatch, false);
  assert.strictEqual(result.mismatches[0].expected, null);
});
test('shadowCompareChannelRate: empty observed set -> allMatch false (nothing was actually verified, never a false-positive "all good")', () => {
  const intervals = [{ from: '2026-01-01', to: '2026-01-31', rate: 60 }];
  const result = shadowCompareChannelRate({ intervals, rule: BOOKING_RULE, observed: {} });
  assert.strictEqual(result.allMatch, false);
  assert.strictEqual(result.rows.length, 0);
});

// --- Gate 6 (final review pass): explicit out-of-order execution scenario --
// Models the exact scenario the owner's review posed: three writes to the
// canonical rate (base 60 at 12:00, 70 at 12:01, 80 at 12:02) enqueue three
// jobs (job1/job2/job3), but beds24OutboundWorker never executes them in
// enqueue order (Cloud Firestore triggers make no ordering guarantee, and
// retries can reorder further) -- so this simulates the worst case, job3
// executing FIRST, then job1, then job2, each one calling
// buildChannelRateDifferentialPayload fresh (exactly what
// functions-beds24/index.js's worker does inline, with zero intermediate
// caching of a rate value between canonicalRates() and this call -- see
// that file's job.job_intent === 'channel_rate' branch). Because no job
// object anywhere carries a captured rate (buildBeds24PushRecord's own
// schema has no such field), every execution -- regardless of which
// "logical job" it corresponds to or what order it runs in -- reads
// whatever is CURRENTLY live at ITS OWN execution instant. Once all 3
// writes have happened (12:02), every subsequent execution converges on
// base=80, so the LAST one to actually run always wins with the CURRENT
// value, never a stale 66/77 from an earlier job.
test('Gate 6: job3, job1, job2 executed out of order after base changed 60->70->80 -- every execution occurring after 12:02 resolves to the CURRENT base (80 -> price3 88), never an earlier job\'s captured rate', () => {
  const gen1 = [{ from: '2026-01-01', to: '2026-01-31', rate: 60 }]; // written 12:00, enqueues job1
  const gen2 = [{ from: '2026-01-01', to: '2026-01-31', rate: 70 }]; // written 12:01, enqueues job2
  const gen3 = [{ from: '2026-01-01', to: '2026-01-31', rate: 80 }]; // written 12:02, enqueues job3
  // Simulated execution order: job3 first, then job1, then job2 -- but ALL
  // THREE executions happen chronologically after 12:02, so live Firestore
  // state (modeled here as gen3, the last write) is gen3 for every single
  // one of them. A real stale-data bug would look like: job1 or job2
  // "remembering" 60 or 70 from when it was enqueued. This function has no
  // field to remember that in, so it can't.
  const executionOrder = ['job3', 'job1', 'job2'];
  const liveIntervalsAtEachExecution = gen3; // all 3 executions happen after the 12:02 write
  const results = executionOrder.map(() => buildChannelRateDifferentialPayload({ roomTypeCode: 'DELUXE_FAMILY', dates: ['2026-01-15'], canonicalIntervals: liveIntervalsAtEachExecution, rule: BOOKING_RULE }));
  for (const r of results) {
    assert.strictEqual(r.grouped[0].calendar[0].price3, 88, 'every execution, regardless of order, must resolve to the CURRENT base (80 * 1.10 = 88)');
  }
  // Negative control: confirm gen1/gen2 would have produced a DIFFERENT
  // (wrong) result, so this test would actually catch a real regression
  // rather than passing trivially.
  const wouldHaveBeenStale1 = buildChannelRateDifferentialPayload({ roomTypeCode: 'DELUXE_FAMILY', dates: ['2026-01-15'], canonicalIntervals: gen1, rule: BOOKING_RULE });
  const wouldHaveBeenStale2 = buildChannelRateDifferentialPayload({ roomTypeCode: 'DELUXE_FAMILY', dates: ['2026-01-15'], canonicalIntervals: gen2, rule: BOOKING_RULE });
  assert.notStrictEqual(wouldHaveBeenStale1.grouped[0].calendar[0].price3, 88);
  assert.notStrictEqual(wouldHaveBeenStale2.grouped[0].calendar[0].price3, 88);
});
test('Gate 6: buildBeds24PushRecord schema has NO field that could carry a captured rate -- this is the structural guarantee, not a convention that could be forgotten', () => {
  const record = buildBeds24PushRecord({ roomTypeCode: 'DELUXE_FAMILY', dateRange: { affected_dates: ['2026-01-15'] }, payload: null, status: 'pending', trigger: 'canonical_room_rates:deluxe_family', jobIntent: 'channel_rate', channel: 'booking' }).record;
  const fieldsThatCouldLeakAStaleRate = ['rate', 'base_rate', 'price', 'price3', 'canonical_rate', 'computed_rate'];
  for (const f of fieldsThatCouldLeakAStaleRate) {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(record, f), false, 'ota_pushes record must never carry a ' + f + ' field -- the rate must always be re-derived live at execution time');
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
