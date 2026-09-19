'use strict';
// Outbound availability engine (Stage 6): derives sellable inventory per room
// type per date from the physical truth and writes the canonical internal
// payload to availability_outbound/{room_type_code} + an ota_pushes log
// entry. NOT connected to any channel manager -- this function NEVER calls
// Beds24 or any other channel-manager API itself (result is always recorded
// as 'not_connected'). The real Beds24 push path is exclusively
// enqueueBeds24Sync() (functions-core/index.js) -> the ota_pushes
// beds24_calendar_push job -> beds24OutboundWorker (functions-beds24/
// index.js), which is the ONLY place that checks ota_config's granular
// flags and job_intent before ever calling the Beds24 API.
//
// Phase B24-2A.1, Section F: this function previously accepted an optional
// `pushAdapter` parameter that, if ever supplied, would call
// pushAdapter.pushAvailability(payload) DIRECTLY -- completely bypassing
// enqueueBeds24Sync, job_intent, otaFeatureEnabled, and the property/room
// guards, with zero test coverage of that branch. No production or test
// call site ever actually supplied it (functions-core, the only real
// caller, is architecturally secret-free and could never construct a
// working Beds24Adapter to pass here in the first place), but an unused,
// untested bypass capability is still a real risk -- removed entirely
// rather than left dormant. This function can now NEVER reach Beds24, by
// construction, regardless of what any future caller passes in.
const crypto = require('crypto');
const { buildRoomTypes, computeSellable, toOutboundPayload, addDays } = require('./inventory');

const HORIZON_DAYS = 365; // event-driven window
const FULL_HORIZON_DAYS = 730; // nightly reconciliation window

async function syncAvailability({ store, roomsDocs, from, days, trigger, now }) {
  const nowIso = now || new Date().toISOString();
  const start = from || nowIso.slice(0, 10);
  const to = addDays(start, days || HORIZON_DAYS);
  const roomTypes = buildRoomTypes(roomsDocs);
  const reservations = (await store.list('reservations')).map((d) => Object.assign({ id: d._id || d.id }, d));
  const blocks = (await store.list('blocks')).map((d) => Object.assign({ id: d._id || d.id }, d));
  const sellable = computeSellable({ roomTypes, reservations, blocks, from: start, to });
  const payload = toOutboundPayload(sellable, nowIso);
  const changed = [];
  for (const code of Object.keys(payload.room_types)) {
    const prev = await store.get('availability_outbound', code);
    const next = payload.room_types[code];
    const diffDates = Object.keys(next.dates).filter((d) => !prev || !prev.dates || !prev.dates[d] || prev.dates[d].available !== next.dates[d].available);
    if (diffDates.length || !prev) {
      await store.set('availability_outbound', code, Object.assign({}, next, { generated_at: nowIso, trigger: trigger || 'manual', dirty_dates: diffDates }), { merge: false });
      changed.push({ code, dates: diffDates.length });
    }
  }
  const pushResult = 'not_connected'; // this function never calls Beds24 itself -- see the file header comment
  // Doc ID must be unique per attempt even when two calls share the same
  // millisecond (concurrent triggers, retries, or fast-clock test loops) --
  // a timestamp-only ID silently overwrote the earlier audit entry instead of
  // creating a new one. The timestamp prefix is kept for readability/sorting;
  // the random suffix is what guarantees uniqueness.
  const pushId = 'avail_' + nowIso.replace(/[^0-9]/g, '') + '_' + crypto.randomBytes(9).toString('base64url');
  await store.set('ota_pushes', pushId, { type: 'availability', trigger: trigger || 'manual', at: nowIso, window: { from: start, to }, changed, result: pushResult, error_reason: pushResult.startsWith('push_failed') ? pushResult : null, retry_count: 0 });
  return { payload, changed, pushResult, errors: roomTypes.errors };
}

module.exports = { syncAvailability, HORIZON_DAYS, FULL_HORIZON_DAYS };
