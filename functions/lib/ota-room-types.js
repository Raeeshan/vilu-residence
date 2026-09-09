'use strict';
// OTA room-type commercial model (Beds24 pre-integration stage). Pure
// functions — no Firestore, no network — same shape as inventory.js so the
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

// child_pricing is the one remaining pending policy leaf (2026-09-09 pass) --
// age 2+ pricing is explicitly not decided; never inferred from the old
// internal extra-bed/discount logic.
function pendingChildPricing() {
  return { status: 'owner_pending' };
}

// Owner-approved commercial policy (2026-09-09, OTA commercial-policy
// implementation pass, following the PMS third-guest pricing fix in commit
// ea921eb). Every field the owner has not yet decided stays explicit
// null/pending, never invented.
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
    // guests, a 3rd guest is a single flat per-night supplement that applies
    // whether or not a physical extra bed is requested, and there is never a
    // second, separate extra-bed charge for the same person.
    base_occupancy: 2,
    third_guest_supplement: { amount: 20, currency: 'USD', period: 'per_night', applies_without_extra_bed: true },
    infant_policy: { free_under_age: 2 }, // owner-approved
    child_pricing: pendingChildPricing(), // age 2+ still pending
    commission: null, // not modelled yet
    payment_policy: {
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
      no_show: { status: 'owner_pending' }, // never inferred as 100% -- explicitly pending
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
    child_pricing: pendingChildPricing(),
    commission: null,
    payment_policy: {
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
      no_show: { status: 'owner_pending' },
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
    child_pricing: pendingChildPricing(),
    commission: null,
    payment_policy: {
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
      no_show: { status: 'owner_pending' },
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

// Guest-count-aware per-night rate for one room type, mirroring the PMS fix
// (calcTax()/calcPrice() in vilu-unified.html, commit ea921eb) exactly:
// base_occupancy covers 2 guests, a 3rd guest adds exactly one flat
// third_guest_supplement charge regardless of extraBedRequested, capped at
// one supplement since every physical room's capacity tops out at 3 -- never
// a second, separate extra-bed charge for the same person. Infants never
// count toward guestCount here, matching the PMS's ad+ch (not +inf) rule.
function computeOccupancyRate({ config, guestCount }) {
  if (!config) throw new Error('computeOccupancyRate: config is required');
  const extraGuests = Math.min(1, Math.max(0, (guestCount || 0) - config.base_occupancy));
  const supplement = extraGuests * config.third_guest_supplement.amount;
  return {
    room_type_id: config.room_type_id,
    baseRate: config.base_rate,
    thirdGuestSupplement: supplement,
    rate: config.base_rate + supplement,
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
// Never infers a no-show charge: a no-show is a distinct event from a
// pre-arrival cancellation and policy.no_show.status stays 'owner_pending'
// until the owner decides it, so this function is never called for that case.
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

module.exports = {
  ROOM_TYPE_ID_TO_CODE,
  CODE_TO_ROOM_TYPE_ID,
  INITIAL_OTA_ROOM_TYPES,
  computeOtaTypePayload,
  computeOccupancyRate,
  daysBeforeArrival,
  computeCancellationCharge,
  pendingChildPricing,
};
