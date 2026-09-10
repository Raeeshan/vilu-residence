'use strict';
// Deployment copy for the "beds24" Functions codebase -- kept in sync with
// functions/lib/ota-room-types.js (the canonical copy the test harness
// imports). Required by ./beds24-bridge.js.
// OTA room-type commercial model. Pure functions — no Firestore, no network
// — same shape as inventory.js so the
// sandbox harness and, eventually, the ota codebase can both drive it.
//
// Three separate concepts, kept deliberately apart per the owner's
// instruction:
//   physical rooms        -- VR01-VR06, the only conflict authority (inventory.js)
//   OTA room types         -- the 3 sellable listings a channel manager sees
//   OTA commercial rules   -- rate/restrictions/tax mode attached to a type
//
// canonical room_type_id -> the existing UPPERCASE ROOM_TYPE_CODES in
// inventory.js (used by availability_outbound today) so this module can
// read/derive from that payload without inventing a second numbering scheme.
const ROOM_TYPE_ID_TO_CODE = {
  deluxe_family: 'DELUXE_FAMILY',
  double: 'DOUBLE',
  open_deck: 'DELUXE_FAMILY_OPEN_DECK',
};
const CODE_TO_ROOM_TYPE_ID = Object.fromEntries(Object.entries(ROOM_TYPE_ID_TO_CODE).map(([k, v]) => [v, k]));

// Owner-approved child/infant/adult age model (2026-09-09, guest-age policy
// pass). Shared by every room type via a single object reference below, and
// by classifyGuestAge()/computeThirdGuestSupplement() -- one canonical
// definition of the three age bands, never duplicated.
function approvedChildPricing() {
  return {
    status: 'approved',
    infant: { min_age: 0, max_age_exclusive: 2, discount_percent: 100 },
    child: { min_age: 2, max_age_exclusive: 12, discount_percent: 50 },
    adult_from_age: 12,
  };
}

// Owner-approved commercial policy (2026-09-09, OTA commercial-policy
// implementation pass, following the PMS third-guest pricing fix in commit
// ea921eb and the guest-age policy pass that followed it). Every field the
// owner has not yet decided stays explicit null/pending, never invented.
const INITIAL_OTA_ROOM_TYPES = {
  deluxe_family: {
    room_type_id: 'deluxe_family',
    display_name: 'Deluxe Family Room',
    physical_rooms: ['VR01', 'VR02'],
    base_rate: 80,
    currency: 'USD',
    min_stay: 1,
    max_stay: null, // no explicit maximum
    closed_to_arrival: false,
    closed_to_departure: false,
    manual_stop_sell: false, // staff override; canonical stopSell also considers numAvail (see computeOtaTypePayload)
    availability_buffer: 0,
    booking_window_days: 365, // owner-locked
    same_day_cutoff: { time: '12:00', timezone: 'Indian/Maldives' }, // owner-locked
    tax_mode: 'net_of_tax', // owner-locked: published rate excludes TGST/service/Green Tax; Green Tax stays a SEPARATE line, never folded in (see docs/ai/BEDS24_PRE_INTEGRATION_STAGE.md)
    // Occupancy pricing -- matches the PMS fix in commit ea921eb exactly
    // (calcTax()/calcPrice() in vilu-unified.html): base_occupancy covers 2
    // guests, a 3rd guest is a single flat per-night supplement (age-scaled
    // per child_pricing below) that applies whether or not a physical extra
    // bed is requested, and there is never a second, separate extra-bed
    // charge for the same person.
    base_occupancy: 2,
    third_guest_supplement: { amount: 20, currency: 'USD', period: 'per_night', applies_without_extra_bed: true },
    infant_policy: { free_under_age: 2 }, // owner-approved; kept alongside child_pricing.infant for the earlier, simpler "is this guest free" check
    child_pricing: approvedChildPricing(), // owner-approved 2026-09-09: infant <2 free, child 2-11 = 50% of the 3rd-guest supplement, adult from 12
    commission: null, // not modelled yet
    payment_policy: {
      // Step 14 (2026-09-09 channel-aware payment pass): this object governs
      // DIRECT/Vilu-website bookings ONLY. An OTA reservation's actual
      // settlement is reservation/channel-supplied and never read from here
      // -- see normalizeOtaPayment() in functions/lib/ota-payment.js, which
      // derives payment_model/payment_status per booking from the channel's
      // own commercial data, never from this room type's direct policy.
      scope: 'direct_booking_only',
      timing: 'pay_at_property',
      cash_currencies: ['USD', 'EUR'], // no hardcoded exchange rate -- cash is accepted at face value in either currency
      card_surcharge_percent: 3.5,
      online_prepayment_default: false, // never collect a deposit/prepayment/card details online
    },
    cancellation_policy: {
      status: 'approved',
      free_from_days_before_arrival: 30,
      tiers: [
        { from_days_before_arrival: 15, to_days_before_arrival: 29, charge_percent: 50 },
        { from_days_before_arrival: 0, to_days_before_arrival: 14, charge_percent: 100 },
      ],
      no_show: { status: 'approved', charge_percent: 100 }, // owner-approved 2026-09-09
    },
    meal_plan_mapping: { intent: 'breakfast_included', ota_mapping: null }, // matches the current Vilu product; no live OTA rate-plan mapping created yet
    enabled: false, // stays false until a channel manager is actually connected
  },
  double: {
    room_type_id: 'double',
    display_name: 'Double Room',
    physical_rooms: ['VR03', 'VR04', 'VR05'],
    base_rate: 90, // owner-locked OTA type rate -- distinct from the physical VR03/VR04 ($85) and VR05 ($90) PMS rates
    currency: 'USD',
    min_stay: 1,
    max_stay: null,
    closed_to_arrival: false,
    closed_to_departure: false,
    manual_stop_sell: false,
    availability_buffer: 0,
    booking_window_days: 365,
    same_day_cutoff: { time: '12:00', timezone: 'Indian/Maldives' },
    tax_mode: 'net_of_tax',
    base_occupancy: 2,
    third_guest_supplement: { amount: 20, currency: 'USD', period: 'per_night', applies_without_extra_bed: true },
    infant_policy: { free_under_age: 2 },
    child_pricing: approvedChildPricing(),
    commission: null,
    payment_policy: {
      // Step 14 (2026-09-09 channel-aware payment pass): this object governs
      // DIRECT/Vilu-website bookings ONLY. An OTA reservation's actual
      // settlement is reservation/channel-supplied and never read from here
      // -- see normalizeOtaPayment() in functions/lib/ota-payment.js, which
      // derives payment_model/payment_status per booking from the channel's
      // own commercial data, never from this room type's direct policy.
      scope: 'direct_booking_only',
      timing: 'pay_at_property',
      cash_currencies: ['USD', 'EUR'],
      card_surcharge_percent: 3.5,
      online_prepayment_default: false,
    },
    cancellation_policy: {
      status: 'approved',
      free_from_days_before_arrival: 30,
      tiers: [
        { from_days_before_arrival: 15, to_days_before_arrival: 29, charge_percent: 50 },
        { from_days_before_arrival: 0, to_days_before_arrival: 14, charge_percent: 100 },
      ],
      no_show: { status: 'approved', charge_percent: 100 },
    },
    meal_plan_mapping: { intent: 'breakfast_included', ota_mapping: null },
    enabled: false,
  },
  open_deck: {
    room_type_id: 'open_deck',
    display_name: 'Deluxe Family Room with Open Deck',
    physical_rooms: ['VR06'],
    base_rate: 90,
    currency: 'USD',
    min_stay: 1,
    max_stay: null,
    closed_to_arrival: false,
    closed_to_departure: false,
    manual_stop_sell: false,
    availability_buffer: 0,
    booking_window_days: 365,
    same_day_cutoff: { time: '12:00', timezone: 'Indian/Maldives' },
    tax_mode: 'net_of_tax',
    base_occupancy: 2,
    third_guest_supplement: { amount: 20, currency: 'USD', period: 'per_night', applies_without_extra_bed: true },
    infant_policy: { free_under_age: 2 },
    child_pricing: approvedChildPricing(),
    commission: null,
    payment_policy: {
      // Step 14 (2026-09-09 channel-aware payment pass): this object governs
      // DIRECT/Vilu-website bookings ONLY. An OTA reservation's actual
      // settlement is reservation/channel-supplied and never read from here
      // -- see normalizeOtaPayment() in functions/lib/ota-payment.js, which
      // derives payment_model/payment_status per booking from the channel's
      // own commercial data, never from this room type's direct policy.
      scope: 'direct_booking_only',
      timing: 'pay_at_property',
      cash_currencies: ['USD', 'EUR'],
      card_surcharge_percent: 3.5,
      online_prepayment_default: false,
    },
    cancellation_policy: {
      status: 'approved',
      free_from_days_before_arrival: 30,
      tiers: [
        { from_days_before_arrival: 15, to_days_before_arrival: 29, charge_percent: 50 },
        { from_days_before_arrival: 0, to_days_before_arrival: 14, charge_percent: 100 },
      ],
      no_show: { status: 'approved', charge_percent: 100 },
    },
    meal_plan_mapping: { intent: 'breakfast_included', ota_mapping: null },
    enabled: false,
  },
};

// Merges (config, a date-level override, and the real physical numAvail for
// that date) into the canonical outbound OTA payload for one room type/date.
// `sellableAvailable` and `sellableTotal` come from the existing
// computeSellable()/toOutboundPayload() derivation in inventory.js /
// availability.js -- this function never recomputes physical occupancy
// itself, so the physical-room lock stays the single conflict authority.
//
// Deliberately unaware of guest count / third_guest_supplement: an ARI rate
// push is per room-type/per-date, not per-booking, and (per the verified
// Beds24/Booking.com research in docs/ai/BEDS24_PRE_INTEGRATION_STAGE.md)
// occupancy-dependent fees are never pushed through this feed on either
// platform -- see computeOccupancyRate() below for the guest-count-aware
// calculation, kept as a separate pure function for exactly that reason.
function computeOtaTypePayload({ config, override, sellableAvailable, sellableTotal }) {
  if (!config) throw new Error('computeOtaTypePayload: config is required');
  const ov = override || {};
  const rate = ov.rate != null ? ov.rate : config.base_rate;
  const minStay = ov.minStay != null ? ov.minStay : config.min_stay;
  const maxStay = ov.maxStay !== undefined ? ov.maxStay : config.max_stay;
  const cta = ov.cta != null ? ov.cta : config.closed_to_arrival;
  const ctd = ov.ctd != null ? ov.ctd : config.closed_to_departure;
  const bufferedAvailable = Math.max(0, sellableAvailable - (config.availability_buffer || 0));
  const stopSell = !!config.manual_stop_sell || !!(ov.stopSell) || bufferedAvailable <= 0;
  return {
    room_type_id: config.room_type_id,
    currency: config.currency,
    rate,
    numAvail: stopSell ? 0 : bufferedAvailable,
    totalUnits: sellableTotal,
    minStay,
    maxStay,
    closedToArrival: cta,
    closedToDeparture: ctd,
    stopSell,
    tax_mode: config.tax_mode,
  };
}

// Age-at-stay: age is computed as of the CHECK-IN date, not "today" and not
// the booking date -- standard hospitality-industry practice, since a
// guest's applicable age band is whatever it will be when the stay begins.
// Both inputs are 'YYYY-MM-DD' calendar-date strings; this is pure
// year/month/day arithmetic (no Date.UTC/timestamp involved at all), so it
// carries no timezone or DST exposure to get wrong.
function ageAtCheckIn(dateOfBirthStr, checkInDateStr) {
  const [bY, bM, bD] = dateOfBirthStr.split('-').map(Number);
  const [ciY, ciM, ciD] = checkInDateStr.split('-').map(Number);
  let age = ciY - bY;
  if (ciM < bM || (ciM === bM && ciD < bD)) age--; // birthday hasn't occurred yet this check-in year
  return age;
}

// Classifies one guest's age into infant/child/adult using the room type's
// own child_pricing bands (min_age/max_age_exclusive/adult_from_age) --
// never a hardcoded 2/12, so a future per-type override would be honoured
// automatically. age 0-1 -> infant, 2-11 -> child, 12+ -> adult (today's
// owner-approved bands).
function classifyGuestAge(age, childPricing) {
  if (age < childPricing.infant.max_age_exclusive) return 'infant';
  if (age < childPricing.child.max_age_exclusive) return 'child';
  return 'adult';
}

// The 3rd-guest supplement for ONE additional guest of a given age,
// discounted per child_pricing's discount_percent for their category (100%
// off = free for an infant, 50% off for a child, 0% off/full rate for an
// adult). When thirdGuestAge is not supplied, this NEVER invents a discount
// -- it charges the full adult rate, since "unknown age" must never be
// silently assumed to qualify for a concession.
function computeThirdGuestSupplement({ config, thirdGuestAge }) {
  if (!config) throw new Error('computeThirdGuestSupplement: config is required');
  const full = config.third_guest_supplement.amount;
  if (thirdGuestAge == null) return { amount: full, category: 'adult' };
  const category = classifyGuestAge(thirdGuestAge, config.child_pricing);
  const discountPercent = category === 'adult' ? 0 : config.child_pricing[category].discount_percent;
  return { amount: +(full * (1 - discountPercent / 100)).toFixed(2), category };
}

// Guest-count-aware per-night rate for one room type, mirroring the PMS fix
// (calcTax()/calcPrice() in vilu-unified.html, commit ea921eb) exactly:
// base_occupancy covers 2 guests, a 3rd guest adds exactly one supplement
// (age-scaled via computeThirdGuestSupplement -- full for an adult, 50% for
// a child 2-11, free for an infant under 2) regardless of extraBedRequested,
// capped at one supplement since every physical room's capacity tops out at
// 3 -- never a second, separate extra-bed charge for the same person.
// Infants never count toward guestCount here, matching the PMS's ad+ch (not
// +inf) rule -- pass the 3rd guest's exact age via thirdGuestAge to get the
// correct child/infant discount; omitting it charges the full adult rate.
function computeOccupancyRate({ config, guestCount, thirdGuestAge }) {
  if (!config) throw new Error('computeOccupancyRate: config is required');
  const extraGuests = Math.min(1, Math.max(0, (guestCount || 0) - config.base_occupancy));
  const supplementResult = extraGuests > 0 ? computeThirdGuestSupplement({ config, thirdGuestAge }) : { amount: 0, category: null };
  return {
    room_type_id: config.room_type_id,
    baseRate: config.base_rate,
    thirdGuestSupplement: supplementResult.amount,
    thirdGuestCategory: supplementResult.category,
    rate: config.base_rate + supplementResult.amount,
    currency: config.currency,
  };
}

// Date-only day-count between two 'YYYY-MM-DD' calendar-date strings,
// computed via Date.UTC so it is immune to timezone offset and DST drift --
// Maldives has no DST, but this also means the local browser/server clock's
// own timezone can never skew the result, which is what "Maldives-safe"
// means here: the dates are treated as pure calendar dates, never as
// timestamps in any particular zone.
function daysBeforeArrival(checkInDateStr, nowDateStr) {
  // Date.UTC's month argument is 0-indexed (0=Jan) but the 'YYYY-MM-DD'
  // strings this takes are 1-indexed (01=Jan) -- must subtract 1, or every
  // date silently shifts forward one month.
  const [ciY, ciM, ciD] = checkInDateStr.split('-').map(Number);
  const [nowY, nowM, nowD] = nowDateStr.split('-').map(Number);
  const ci = Date.UTC(ciY, ciM - 1, ciD);
  const now = Date.UTC(nowY, nowM - 1, nowD);
  return Math.floor((ci - now) / 86400000);
}

// Resolves a cancellation charge from the owner-approved tiered policy.
// daysBeforeArrival must already be a date-only integer (see
// daysBeforeArrival() above) -- this function does no date math itself.
// This is exclusively for a pre-arrival cancellation; a guest who simply
// never shows up is a distinct event (discovered only after the stay's own
// check-in date has passed) with its own separate, now also owner-approved
// 100% charge -- see computeNoShowCharge() below, called directly by
// the caller rather than through this tier-lookup function, since "days
// before arrival" isn't a meaningful concept for an event that is only
// ever recognized on or after the arrival date itself.
function computeCancellationCharge({ policy, daysBeforeArrival: days, totalBookingValue }) {
  if (!policy) throw new Error('computeCancellationCharge: policy is required');
  if (days >= policy.free_from_days_before_arrival) {
    return { chargePercent: 0, chargeAmount: totalBookingValue != null ? 0 : null };
  }
  const tier = policy.tiers.find((t) => days >= t.from_days_before_arrival && days <= t.to_days_before_arrival);
  if (!tier) throw new Error('computeCancellationCharge: no tier matches daysBeforeArrival=' + days);
  const chargeAmount = totalBookingValue != null ? +(totalBookingValue * tier.charge_percent / 100).toFixed(2) : null;
  return { chargePercent: tier.charge_percent, chargeAmount };
}

// Resolves the no-show charge from the owner-approved policy.no_show leaf.
// Kept as its own tiny function (rather than inlined at call sites) so a
// future change to the no-show rule has exactly one place to change, and so
// a caller can never confuse "no_show.status !== 'approved'" (still
// pending, must not charge) with an approved 0% tier.
function computeNoShowCharge({ policy, totalBookingValue }) {
  if (!policy || !policy.no_show) throw new Error('computeNoShowCharge: policy.no_show is required');
  if (policy.no_show.status !== 'approved') {
    throw new Error('computeNoShowCharge: no_show policy is not approved (status=' + policy.no_show.status + ') -- must not charge');
  }
  const pct = policy.no_show.charge_percent;
  const chargeAmount = totalBookingValue != null ? +(totalBookingValue * pct / 100).toFixed(2) : null;
  return { chargePercent: pct, chargeAmount };
}

module.exports = {
  ROOM_TYPE_ID_TO_CODE,
  CODE_TO_ROOM_TYPE_ID,
  INITIAL_OTA_ROOM_TYPES,
  computeOtaTypePayload,
  computeOccupancyRate,
  computeThirdGuestSupplement,
  classifyGuestAge,
  ageAtCheckIn,
  daysBeforeArrival,
  computeCancellationCharge,
  computeNoShowCharge,
  approvedChildPricing,
};
