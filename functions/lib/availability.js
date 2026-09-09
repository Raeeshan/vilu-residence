'use strict';
// Outbound availability engine (Stage 6): derives sellable inventory per room
// type per date from the physical truth and writes the canonical internal
// payload to availability_outbound/{room_type_code} + an ota_pushes log
// entry. NOT connected to any channel manager: `pushAdapter` is optional and
// absent in this stage (result recorded as 'not_connected').
const { buildRoomTypes, computeSellable, toOutboundPayload, addDays } = require('./inventory');

const HORIZON_DAYS = 365; // event-driven window
const FULL_HORIZON_DAYS = 730; // nightly reconciliation window

async function syncAvailability({ store, roomsDocs, from, days, trigger, pushAdapter, now }) {
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
  let pushResult = 'not_connected';
  if (pushAdapter && changed.length) {
    try { await pushAdapter.pushAvailability(payload); pushResult = 'pushed'; } catch (e) { pushResult = 'push_failed: ' + e.message; }
  }
  await store.set('ota_pushes', 'avail_' + nowIso.replace(/[^0-9]/g, ''), { type: 'availability', trigger: trigger || 'manual', at: nowIso, window: { from: start, to }, changed, result: pushResult, error_reason: pushResult.startsWith('push_failed') ? pushResult : null, retry_count: 0 });
  return { payload, changed, pushResult, errors: roomTypes.errors };
}

module.exports = { syncAvailability, HORIZON_DAYS, FULL_HORIZON_DAYS };
