'use strict';
// Fail-closed granular Beds24/OTA sync feature flags (Phase B24-2A).
// Canonical copy -- mirrored verbatim into functions-core/lib/,
// functions-ota/lib/, functions-beds24/lib/ (same convention as
// beds24-bridge.js / store-firestore.js / ota-room-types.js).
//
// Single choke point for every "is this specific external-facing behavior
// currently authorized" decision. Replaces the single all-purpose
// ota_config/channel_manager.enabled check that previously gated outbound
// availability, outbound rates, inbound webhook, inbound polling, and
// inbound processing all at once (the B24-1B finding that motivated this
// split -- see docs/ai/BEDS24_PRE_INTEGRATION_STAGE.md).
//
// Schema (ota_config/channel_manager):
//   provider: string                        -- e.g. "beds24"
//   enabled: boolean                        -- MASTER switch; anything other
//                                               than the literal boolean
//                                               true disables every feature
//                                               below regardless of that
//                                               feature's own value
//   outbound_availability_enabled: boolean  -- may push numAvail ONLY
//   outbound_rates_enabled: boolean         -- may push price1 ONLY
//   outbound_channel_rates_enabled: boolean -- may push a per-channel price
//                                               slot (price2/price3/...)
//                                               ONLY, via job_intent
//                                               'channel_rate' (PMS-driven
//                                               multi-slot OTA rates pass).
//                                               Deliberately SEPARATE from
//                                               outbound_rates_enabled
//                                               (which governs price1 only)
//                                               so Booking.com's price3 push
//                                               can never be silently
//                                               authorized by the existing
//                                               Direct/Agent rate flag, or
//                                               vice versa -- true channel
//                                               isolation at the flag level,
//                                               not just at the payload
//                                               level.
//   outbound_restrictions_enabled: boolean  -- may push override/minStay/
//                                               maxStay ONLY (Phase B24-2A.1:
//                                               split out of outbound_rates_
//                                               enabled after auditing
//                                               beds24RateChangeSync's actual
//                                               watched fields -- min_stay/
//                                               max_stay/closed_to_arrival/
//                                               closed_to_departure/
//                                               manual_stop_sell are
//                                               restriction concerns, not
//                                               rate concerns, per Beds24's
//                                               own calendar schema)
//   inbound_webhook_enabled: boolean        -- may enqueue a real booking from
//                                               an authenticated webhook call
//   inbound_polling_enabled: boolean        -- may call the channel manager to
//                                               look for modified bookings
//   inbound_processing_enabled: boolean     -- may turn a queued item into a
//                                               PMS reservation create/modify/
//                                               cancel
//
// FAIL-CLOSED SEMANTICS (verified by test/ota-feature-flags.test.js):
//   1. cfg.enabled !== true (missing, false, "true" the string, 1, etc.)
//      => every feature disabled, regardless of that feature's own flag.
//   2. A missing/undefined specific flag => that feature disabled.
//   3. Only the strict boolean true authorizes a feature -- any other
//      truthy value does not.
//   4. The current production doc `{enabled:false, provider:"beds24"}` (no
//      granular keys at all) remains fully disabled after this ships.
//   5. `{enabled:true}` with every granular flag missing/false authorizes
//      nothing.
function otaFeatureEnabled(cfg, feature) {
  if (!cfg || cfg.enabled !== true) return false;
  return cfg[feature] === true;
}

// Canonical mapping from an outbound job's declared intent to the granular
// flag that authorizes it. Deliberately NOT exhaustive/greedy (no
// default/fallback branch): an intent absent from this map is, by
// definition, unknown and must fail closed in the caller (see
// beds24OutboundWorker) -- a future new intent value must be added here
// deliberately before anything can ever process it.
//
// Phase B24-2A.1: the previous 'override' intent name is RETIRED. Source
// audit of beds24OverrideChangeSync (it watches ota_room_type_overrides'
// per-date `overrides[date]` map, which resolveRate() in beds24-bridge.js
// treats purely as a RATE value, never a restriction) proved it was
// actually a rate concern despite its name -- it now enqueues intent
// 'rate', not a separate intent. 'restriction' is the new, distinct intent
// for the genuinely restriction-shaped fields (min_stay/max_stay/
// closed_to_arrival/closed_to_departure/manual_stop_sell), which
// beds24RateChangeSync now enqueues separately from its own 'rate' jobs.
// Phase R6 (PMS-driven multi-slot OTA rates): 'channel_rate' added as a
// FOURTH, independent intent -- never folded into 'rate' (which stays
// exactly what it always was: price1 only, driven by
// ota_room_types.base_rate). A job with job_intent 'channel_rate' also
// always carries a `channel` field (see buildBeds24PushRecord); which price
// slot that channel targets is CHANNEL_PRICING_RULES' concern
// (channel-pricing.js), never this map's.
const OUTBOUND_JOB_INTENT_FLAG = Object.freeze({
  availability: 'outbound_availability_enabled',
  rate: 'outbound_rates_enabled',
  restriction: 'outbound_restrictions_enabled',
  channel_rate: 'outbound_channel_rates_enabled',
});

const OTA_CONFIG_DEFAULTS = Object.freeze({
  enabled: false,
  outbound_availability_enabled: false,
  outbound_rates_enabled: false,
  outbound_restrictions_enabled: false,
  outbound_channel_rates_enabled: false,
  inbound_webhook_enabled: false,
  inbound_polling_enabled: false,
  inbound_processing_enabled: false,
});

module.exports = { otaFeatureEnabled, OUTBOUND_JOB_INTENT_FLAG, OTA_CONFIG_DEFAULTS };
