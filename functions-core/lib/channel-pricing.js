'use strict';
// Deployment copy for the "core" Functions codebase -- kept in sync with
// functions/lib/channel-pricing.js (the canonical copy the test harness
// imports). Required by functions-core/index.js's beds24ChannelRateSync
// trigger, which only needs pmsManagedChannels() (to know which channels to
// enqueue a job for) -- this codebase never calls the Beds24 API itself and
// never computes an actual rate value; that happens in functions-beds24's
// worker at push time, re-reading live state, same as every other job
// intent in this codebase.
//
// Vilu PMS canonical seasonal base-rate calendar + per-channel OTA pricing
// rules (PMS-driven multi-slot OTA rates pass).
//
// Three genuinely different rate concepts now coexist in this codebase --
// keeping them apart is the entire point of this module:
//   ota_room_types.base_rate       -- the EXISTING flat Direct/Agent rate
//                                      ($80/$90/$90), already live, already
//                                      feeding Beds24 price1 via
//                                      beds24RateChangeSync. NEVER read or
//                                      written by anything in this file.
//   Beds24 "Agoda 60" UI rule       -- Beds24 price2, still owned entirely
//                                      inside Beds24's own UI today (Phase
//                                      R8: deliberately not migrated yet).
//   canonical seasonal base rate    -- what THIS module owns: the real
//                                      Cloudbeds-verified seasonal schedule
//                                      ($60/$130/$75/$130/$120 across 5
//                                      date intervals, identical across all
//                                      3 room types, directly verified
//                                      against production Cloudbeds Base
//                                      Rates on 2026-09-22 -- not derived
//                                      from Beds24's own 80/90/90 track,
//                                      which is a different number entirely).
//
// Booking.com's price (Beds24 price3, live-proven via an authenticated
// GET /inventory/rooms/calendar read against production Beds24 on
// 2026-09-22 -- observed price3 values 66/143/82.5/143/132 matched this
// module's canonical schedule x 1.10 exactly, on the exact expected dates,
// for room 727992) is calculated FROM the canonical schedule via a
// per-channel rule, never entered by hand per season.
//
// Pure functions only -- no Firestore, no network -- same convention as
// inventory.js / ota-room-types.js / beds24-bridge.js. The Firestore-backed
// "live overrides the bundled default" read (matching roomTypeConfig()'s own
// existing pattern in functions-beds24/index.js) lives in the caller
// (functions-core/index.js's trigger, functions-beds24/index.js's worker),
// never here.
const { addDays } = require('./inventory');

// ---------------------------------------------------------------------------
// Canonical seasonal base-rate calendar (bundled default / fallback --
// mirrors INITIAL_OTA_ROOM_TYPES' own role in ota-room-types.js). Keyed by
// the same room_type_id space CODE_TO_ROOM_TYPE_ID/ROOM_TYPE_ID_TO_CODE use
// in ota-room-types.js (deluxe_family/double/open_deck), NOT the uppercase
// BEDS24_ROOM_MAP codes -- callers translate at the boundary exactly like
// roomTypeConfig() already does, never a second numbering scheme invented
// here.
function verifiedIntervals() {
  // from/to inclusive ISO dates. Every date from 2026-09-23 through
  // 2028-08-31 is covered by exactly one interval -- see
  // validateIntervalCoverage() below and its dedicated test, which asserts
  // there is neither a gap nor an overlap anywhere in this exact list.
  return Object.freeze([
    Object.freeze({ from: '2026-09-23', to: '2026-12-01', rate: 60 }),
    Object.freeze({ from: '2026-12-02', to: '2026-12-20', rate: 130 }),
    Object.freeze({ from: '2026-12-21', to: '2026-12-31', rate: 75 }),
    Object.freeze({ from: '2027-01-01', to: '2027-04-30', rate: 130 }),
    Object.freeze({ from: '2027-05-01', to: '2028-08-31', rate: 120 }),
  ]);
}
const INITIAL_CANONICAL_RATES = Object.freeze({
  deluxe_family: Object.freeze({ room_type_id: 'deluxe_family', intervals: verifiedIntervals() }),
  double: Object.freeze({ room_type_id: 'double', intervals: verifiedIntervals() }),
  open_deck: Object.freeze({ room_type_id: 'open_deck', intervals: verifiedIntervals() }),
});

// ---------------------------------------------------------------------------
// Per-channel OTA pricing rules. `beds24_price_slot` is the live-proven
// Beds24 calendar field this channel's price is written to (price1/2/3...);
// `enabled` + `managed_by_pms` gate whether THIS module is currently allowed
// to compute/push a value for that channel at all -- Phase R8 requires
// Agoda (price2) and Direct/Agent (price1) to stay completely untouched by
// this pass, so both are present in the schema (for future migration, per
// the owner's own "must support Expedia/Airbnb/other OTAs without
// hardcoding channel names throughout the worker" requirement) but disabled
// today. Booking.com is the only channel this module is authorized to
// compute for right now.
const CHANNEL_PRICING_RULES = Object.freeze({
  booking: Object.freeze({
    channel: 'booking',
    beds24_price_slot: 3,
    pricing_mode: 'percentage',
    percentage_adjustment: 10,
    fixed_adjustment: 0,
    enabled: true,
    managed_by_pms: true,
  }),
  agoda: Object.freeze({
    channel: 'agoda',
    beds24_price_slot: 2,
    pricing_mode: 'percentage',
    percentage_adjustment: 0,
    fixed_adjustment: 0,
    enabled: false, // Phase R8: NOT migrated -- Beds24's own "Agoda 60" UI rule stays the live source of price2. Do not flip this without a dedicated migration pass.
    managed_by_pms: false,
  }),
  direct: Object.freeze({
    channel: 'direct',
    beds24_price_slot: 1,
    pricing_mode: 'percentage',
    percentage_adjustment: 0,
    fixed_adjustment: 0,
    enabled: false, // price1 stays owned by ota_room_types.base_rate -> beds24RateChangeSync. This entry exists only so the schema is genuinely multi-channel, not Booking.com-only; it must never actually drive a push while managed_by_pms is false.
    managed_by_pms: false,
  }),
});

// Only channels both enabled AND explicitly marked managed_by_pms may ever
// have a job built for them -- two independent booleans, not one, so a
// future "enabled for reads/preview" state can exist without silently
// authorizing an outbound push (Phase R8's exact isolation requirement).
function pmsManagedChannels() {
  return Object.keys(CHANNEL_PRICING_RULES).filter((k) => CHANNEL_PRICING_RULES[k].enabled && CHANNEL_PRICING_RULES[k].managed_by_pms);
}

// ---------------------------------------------------------------------------
// Interval lookup. Plain ISO YYYY-MM-DD string comparison is lexicographic-
// correct for this format -- no Date parsing, no timezone ambiguity. Returns
// null (never throws) when no interval covers the date, so a caller can
// treat "missing_rate_dates" the same way generateInventorySeed() already
// does elsewhere in this codebase, rather than this function inventing its
// own error-handling convention.
function resolveCanonicalRate({ intervals, date }) {
  if (!intervals || !date) return null;
  for (const iv of intervals) {
    if (date >= iv.from && date <= iv.to) return iv.rate;
  }
  return null;
}

// Fail-closed coverage check (Phase R7's "no gaps, no overlaps" requirement,
// promoted into a reusable function instead of a one-off manual check).
// Intervals need not already be sorted. Returns an array of problems (empty
// = fully covered, no overlaps) -- never throws, so a caller can decide
// whether a gap is fatal or just worth logging.
function validateIntervalCoverage(intervals) {
  const problems = [];
  if (!intervals || !intervals.length) return [{ reason: 'no intervals supplied' }];
  const sorted = intervals.slice().sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].from > sorted[i].to) problems.push({ reason: 'interval from > to', interval: sorted[i] });
  }
  for (let i = 1; i < sorted.length; i++) {
    const prevTo = sorted[i - 1].to, curFrom = sorted[i].from;
    const expectedNext = addDays(prevTo, 1);
    if (curFrom < expectedNext) problems.push({ reason: 'overlap', between: [sorted[i - 1], sorted[i]] });
    else if (curFrom > expectedNext) problems.push({ reason: 'gap', between: [sorted[i - 1], sorted[i]] });
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Money-safe channel-rate calculation (Phase R3). Integer-cents arithmetic
// throughout -- never a raw floating-point multiply -- so 60*1.10 can never
// land on 65.99999999999999 or 66.00000000000001. `Math.round` at the one
// point real rounding is needed (after scaling to cents) is exact for every
// value this schedule actually produces (60/130/75/130/120 x 1.10 all land
// on an exact whole number of cents; a future schedule/percentage that
// didn't would still round to the nearest cent here, which is the correct
// financial behavior, not a bug).
function calculateChannelRate({ baseRate, rule }) {
  if (baseRate == null || !Number.isFinite(baseRate)) throw new Error('channel-pricing: baseRate must be a finite number, got ' + baseRate);
  if (!rule) throw new Error('channel-pricing: rule is required');
  const baseCents = Math.round(baseRate * 100);
  let resultCents;
  if (rule.pricing_mode === 'percentage') {
    resultCents = Math.round((baseCents * (100 + (rule.percentage_adjustment || 0))) / 100);
  } else if (rule.pricing_mode === 'fixed') {
    resultCents = baseCents + Math.round((rule.fixed_adjustment || 0) * 100);
  } else {
    throw new Error('channel-pricing: unknown pricing_mode "' + rule.pricing_mode + '"');
  }
  return resultCents / 100;
}

// Combines interval lookup + calculation for one date. Returns null (never
// throws) when the date isn't covered, matching resolveCanonicalRate()'s own
// convention, so a caller building a multi-date payload can collect
// "invalid" entries the same way buildDifferentialPayload() already does
// elsewhere rather than aborting the whole batch on the first miss.
function computeChannelRateForDate({ intervals, date, rule }) {
  const baseRate = resolveCanonicalRate({ intervals, date });
  if (baseRate == null) return null;
  const rate = calculateChannelRate({ baseRate, rule });
  return { date, baseRate, rate, slot: rule.beds24_price_slot, channel: rule.channel };
}

module.exports = {
  INITIAL_CANONICAL_RATES,
  CHANNEL_PRICING_RULES,
  pmsManagedChannels,
  resolveCanonicalRate,
  validateIntervalCoverage,
  calculateChannelRate,
  computeChannelRateForDate,
};
