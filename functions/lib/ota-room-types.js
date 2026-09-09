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

// Owner-approved initial values (2026-09-09). Every field the owner has not
// yet decided is explicit null/pending, never invented.
const INITIAL_OTA_ROOM_TYPES = {
  deluxe_family: {
    room_type_id: 'deluxe_family',
    display_name: 'Deluxe Family Room',
    physical_rooms: ['VR01', 'VR02'],
    base_rate: 80,
    currency: 'USD',
    min_stay: 1,
    max_stay: null, // no explicit maximum initially
    closed_to_arrival: false,
    closed_to_departure: false,
    manual_stop_sell: false, // staff override; canonical stopSell also considers numAvail (see computeOtaTypePayload)
    availability_buffer: 0,
    booking_window_days: null, // OWNER POLICY PENDING
    same_day_cutoff: null, // OWNER POLICY PENDING
    tax_mode: 'net_of_tax', // owner-locked: published rate excludes TGST/service/Green Tax
    occupancy_model: null, // OWNER POLICY PENDING
    child_pricing_model: null, // OWNER POLICY PENDING
    commission: null, // not modelled yet
    cancellation_policy: null, // OWNER POLICY PENDING
    meal_plan_mapping: null, // not defined yet
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
    booking_window_days: null,
    same_day_cutoff: null,
    tax_mode: 'net_of_tax',
    occupancy_model: null,
    child_pricing_model: null,
    commission: null,
    cancellation_policy: null,
    meal_plan_mapping: null,
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
    booking_window_days: null,
    same_day_cutoff: null,
    tax_mode: 'net_of_tax',
    occupancy_model: null,
    child_pricing_model: null,
    commission: null,
    cancellation_policy: null,
    meal_plan_mapping: null,
    enabled: false,
  },
};

// Merges (config, a date-level override, and the real physical numAvail for
// that date) into the canonical outbound OTA payload for one room type/date.
// `sellableAvailable` and `sellableTotal` come from the existing
// computeSellable()/toOutboundPayload() derivation in inventory.js /
// availability.js -- this function never recomputes physical occupancy
// itself, so the physical-room lock stays the single conflict authority.
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

module.exports = { ROOM_TYPE_ID_TO_CODE, CODE_TO_ROOM_TYPE_ID, INITIAL_OTA_ROOM_TYPES, computeOtaTypePayload };
