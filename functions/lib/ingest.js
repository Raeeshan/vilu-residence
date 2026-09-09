'use strict';
// Idempotent OTA ingestion core (Stages 3, 4, 5, 9) — pure orchestration over
// a store + a channel-manager adapter, so the sandbox harness can drive it
// without any external API.
//
// Idempotency key  = channel_manager + ':' + external_id (+ revision)
// Vilu doc id      = OTA-<channel_manager>-<external_id>[-<n>]   (one doc per room unit)
// Authoritative    = adapter.fetchBooking(external_id) (webhook = trigger only)
// Ordering         = channel_revision compare; older/equal revision never overwrites
// Failure          = ota_conflicts record + sync_status, never a forced write
const { buildRoomTypes, freeRoomsForStay, isActiveStatus } = require('./inventory');
const { writeReservationTx, RoomConflictError } = require('./booking-core');

const OTA_EVENT_TYPES = ['new', 'modify', 'cancel', 'unknown'];

function docIdFor(cm, externalId, unitIndex) {
  const base = 'OTA-' + cm + '-' + String(externalId);
  return unitIndex > 0 ? base + '-' + (unitIndex + 1) : base;
}

function revisionOf(v) { return v === undefined || v === null ? '' : String(v); }
function newerOrEqual(stored, incoming) { return revisionOf(stored) >= revisionOf(incoming); } // ISO timestamps / numeric strings compare lexically

function mapStatus(cmStatus) {
  const s = String(cmStatus || '').toLowerCase();
  if (/cancel|no_show|noshow|black|declin/.test(s)) return 'Cancelled';
  if (/checked_in|inhouse|in_house/.test(s)) return 'Checked in';
  if (/checked_out|departed/.test(s)) return 'Checked out';
  return 'Confirmed';
}

// Canonical booking shape expected from every adapter (Beds24, Channex, mock):
// { external_id, revision, status, channel, channel_reservation_id, booking_date,
//   guest:{first,last,email,phone,country}, notes, special_requests, meal_plan, arrival_info,
//   commercial:{currency, gross_total, net_total, tax_total, commission, paid, balance, rate_includes_tax},
//   units:[{ room_type, check_in, check_out, adults, children, child_ages, nightly_rate }] }
function buildFields(booking, unit, unitIndex, cm, roomId, nowIso) {
  const g = booking.guest || {};
  const c = booking.commercial || {};
  const nights = Math.round((Date.parse(unit.check_out + 'T12:00:00Z') - Date.parse(unit.check_in + 'T12:00:00Z')) / 864e5);
  const noteParts = [];
  noteParts.push('[' + cm + '] external id ' + booking.external_id + (booking.channel_reservation_id ? ' · ' + (booking.channel || 'channel') + ' ref ' + booking.channel_reservation_id : '') + ' · revision ' + revisionOf(booking.revision) + (booking.units.length > 1 ? ' · unit ' + (unitIndex + 1) + ' of ' + booking.units.length : ''));
  if (booking.special_requests) noteParts.push('[Special requests] ' + booking.special_requests);
  if (booking.notes) noteParts.push('[Channel notes] ' + booking.notes);
  if (booking.meal_plan) noteParts.push('[Meal plan] ' + booking.meal_plan);
  if (booking.arrival_info) noteParts.push('[Arrival] ' + booking.arrival_info);
  if (unit.child_ages && unit.child_ages.length) noteParts.push('[Child ages] ' + unit.child_ages.join(', '));
  return {
    id: docIdFor(cm, booking.external_id, unitIndex),
    room_id: roomId,
    room_type_requested: unit.room_type,
    guest_name: ((g.first || '') + ' ' + (g.last || '')).trim(),
    guest_email: g.email || '', guest_phone: g.phone || '', guest_country: g.country || '',
    check_in: unit.check_in, check_out: unit.check_out,
    adults: Number(unit.adults) || 1, children: Number(unit.children) || 0,
    child_ages: unit.child_ages || [],
    rate: typeof unit.nightly_rate === 'number' ? unit.nightly_rate : 0,
    status: mapStatus(booking.status),
    source: booking.channel || 'OTA',
    channel: booking.channel || 'unknown',
    channel_manager: cm,
    external_id: String(booking.external_id),
    channel_reservation_id: booking.channel_reservation_id ? String(booking.channel_reservation_id) : '',
    channel_revision: revisionOf(booking.revision),
    sync_status: 'synced',
    // Stage 8 — structured commercial fields, only what the channel supplied
    ota_currency: c.currency || '', ota_gross_total: c.gross_total ?? null, ota_net_total: c.net_total ?? null,
    ota_tax_total: c.tax_total ?? null, ota_commission: c.commission ?? null, ota_paid: c.paid ?? null, ota_balance: c.balance ?? null,
    rate_includes_tax: typeof c.rate_includes_tax === 'boolean' ? c.rate_includes_tax : null,
    meal_plan: booking.meal_plan || '',
    notes: noteParts.join('\n\n'),
    pay: c.gross_total != null ? (cm + ' ' + (c.currency || '') + ' total ' + c.gross_total + ' · paid ' + (c.paid ?? '-') + ' · balance ' + (c.balance ?? '-')) : '',
    created_at: booking.booking_date || nowIso,
    updated_at: nowIso,
    nights,
  };
}

async function logEvent(store, rec) {
  const id = rec.channel_manager + '_' + rec.external_id + '_' + revisionOf(rec.revision).replace(/[^A-Za-z0-9]/g, '') + '_' + rec.received_at.replace(/[^0-9]/g, '');
  await store.set('ota_events', id, rec, { merge: true });
  return id;
}

async function raiseConflict(store, rec) {
  const id = rec.channel_manager + '_' + rec.external_id + '_' + (rec.unit_index || 0) + '_' + rec.at.replace(/[^0-9]/g, '');
  await store.set('ota_conflicts', id, Object.assign({ open: true }, rec));
  return id;
}

// Processes one inbound event. Returns {result, docs, conflicts, event_id}.
// results: created | modified | cancelled | duplicate | stale | noop | conflict | not_found | error
async function ingestEvent({ store, adapter, roomsDocs, event, now }) {
  const nowIso = now || new Date().toISOString();
  const cm = event.channel_manager;
  const externalId = String(event.external_id);
  const evType = OTA_EVENT_TYPES.includes(event.type) ? event.type : 'unknown';
  const base = { channel_manager: cm, external_id: externalId, event_type: evType, revision: revisionOf(event.revision), received_at: nowIso, retry_count: event.retry_count || 0 };

  // 1. authoritative re-read (webhook payload is only a trigger)
  let booking;
  try { booking = await adapter.fetchBooking(externalId); } catch (e) {
    const eventId = await logEvent(store, Object.assign(base, { result: 'error', error_reason: 'adapter_fetch_failed: ' + e.message }));
    return { result: 'error', event_id: eventId, retryable: true };
  }
  if (!booking) {
    const eventId = await logEvent(store, Object.assign(base, { result: 'not_found', error_reason: 'booking not found at channel manager' }));
    return { result: 'not_found', event_id: eventId };
  }
  base.revision = revisionOf(booking.revision);
  base.channel = booking.channel || '';

  const roomTypes = buildRoomTypes(roomsDocs);
  const units = booking.units || [];
  const docIds = units.map((_, i) => docIdFor(cm, externalId, i));
  const status = mapStatus(booking.status);
  const conflicts = [];

  // 2. everything else inside ONE transaction per unit family: read existing docs, compare revision
  const outcome = await store.runTransaction(async (tx) => {
    const existing = [];
    for (const id of docIds) existing.push(await tx.get('reservations', id));
    // also pick up units from an earlier revision that had MORE rooms
    const extra = [];
    for (let i = docIds.length; i < docIds.length + 6; i++) { const d = await tx.get('reservations', docIdFor(cm, externalId, i)); if (d) extra.push({ id: docIdFor(cm, externalId, i), data: d }); else break; }
    const stored = existing.find((d) => d && d.channel_revision !== undefined);
    if (stored && newerOrEqual(stored.channel_revision, booking.revision)) {
      return { result: revisionOf(stored.channel_revision) === revisionOf(booking.revision) ? 'duplicate' : 'stale', docs: docIds.filter((_, i) => existing[i]) };
    }
    return { result: 'proceed', existing, extra };
  });
  if (outcome.result !== 'proceed') {
    const eventId = await logEvent(store, Object.assign(base, { result: outcome.result, vilu_reservation_ids: outcome.docs }));
    return { result: outcome.result, event_id: eventId, docs: outcome.docs };
  }

  // 3. cancellation: release every unit (idempotent)
  if (status === 'Cancelled') {
    const touched = [];
    for (let i = 0; i < docIds.length; i++) {
      const ex = outcome.existing[i];
      if (!ex) continue; // never create a cancelled reservation
      const fields = Object.assign({}, ex, { status: 'Cancelled', channel_revision: revisionOf(booking.revision), sync_status: 'synced', updated_at: nowIso, cancelled_at: nowIso, notes: (ex.notes || '') + '\n\n[' + cm + '] cancelled at channel, revision ' + revisionOf(booking.revision) });
      await writeReservationTx(store, docIds[i], fields);
      touched.push(docIds[i]);
    }
    for (const e of outcome.extra) { await writeReservationTx(store, e.id, Object.assign({}, e.data, { status: 'Cancelled', channel_revision: revisionOf(booking.revision), updated_at: nowIso })); touched.push(e.id); }
    const eventId = await logEvent(store, Object.assign(base, { result: touched.length ? 'cancelled' : 'noop', vilu_reservation_ids: touched }));
    return { result: touched.length ? 'cancelled' : 'noop', event_id: eventId, docs: touched };
  }

  // 4. new / modification: per unit, keep or (re)assign a physical room transactionally
  const written = [];
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    const ex = outcome.existing[i];
    if (!roomTypes.types[unit.room_type]) {
      const cid = await raiseConflict(store, Object.assign({}, base, { unit_index: i, reason: 'unknown_room_type', detail: 'room type "' + unit.room_type + '" is not mapped to any physical room', at: nowIso, vilu_reservation_id: ex ? docIds[i] : null }));
      conflicts.push(cid); continue;
    }
    const unchanged = ex && isActiveStatus(ex.status) && ex.room_id && ex.check_in === unit.check_in && ex.check_out === unit.check_out && ex.room_type_requested === unit.room_type;
    // candidate order: current room first (if still eligible), then lowest room id
    const reservations = await store.list('reservations');
    const blocks = await store.list('blocks');
    const candidates = unchanged ? [ex.room_id] : freeRoomsForStay({ roomTypes, type: unit.room_type, checkIn: unit.check_in, checkOut: unit.check_out, reservations, blocks, excludeReservationIds: [docIds[i]], preferred: ex && ex.room_id });
    let done = false, lastErr = null;
    for (const room of candidates) {
      const fields = buildFields(booking, unit, i, cm, room, nowIso);
      if (ex && ex.created_at) fields.created_at = ex.created_at;
      try {
        await writeReservationTx(store, docIds[i], fields, { oldRoomId: ex && ex.room_id });
        written.push({ id: docIds[i], room, moved: !!(ex && ex.room_id && ex.room_id !== room) });
        done = true; break;
      } catch (e) {
        if (e.code === 'ROOM_CONFLICT') { lastErr = e; continue; } // race: someone took it — try the next room
        throw e;
      }
    }
    if (!done) {
      // full diagnostics: every eligible room of the type and why it is unavailable
      const eligible = roomTypes.types[unit.room_type] || [];
      const why = eligible.map((room) => {
        const r = reservations.find((x) => x.room_id === room && x.status !== 'Cancelled' && x.status !== 'Checked out' && (x._id || x.id) !== docIds[i] && x.check_in < unit.check_out && x.check_out > unit.check_in);
        const b = blocks.find((x) => x.room_id === room && x.from_date < unit.check_out && x.to_date > unit.check_in);
        return room + ': ' + (r ? 'reservation ' + (r._id || r.id) + ' ' + r.check_in + '→' + r.check_out : b ? 'block ' + (b._id || b.id) + ' ' + b.from_date + '→' + b.to_date + ' (' + (b.reason || '') + ')' : (candidates.includes(room) ? 'lost race (' + (lastErr && lastErr.detail ? JSON.stringify(lastErr.detail) : 'ROOM_CONFLICT') + ')' : 'unavailable'));
      });
      const cid = await raiseConflict(store, Object.assign({}, base, { unit_index: i, reason: 'no_physical_room', detail: 'no free ' + unit.room_type + ' for ' + unit.check_in + ' → ' + unit.check_out + '; eligible rooms: ' + why.join(' | '), at: nowIso, vilu_reservation_id: ex ? docIds[i] : null, requested: { room_type: unit.room_type, check_in: unit.check_in, check_out: unit.check_out, adults: unit.adults, children: unit.children }, guest_name: ((booking.guest || {}).first || '') + ' ' + ((booking.guest || {}).last || ''), channel: booking.channel || '' }));
      conflicts.push(cid);
      if (ex) await store.set('reservations', docIds[i], { sync_status: 'conflict', updated_at: nowIso }, { merge: true }); // keep the old stay untouched
    }
  }
  // units dropped by the modification (e.g. 2 rooms → 1)
  for (const e of outcome.extra) { await writeReservationTx(store, e.id, Object.assign({}, e.data, { status: 'Cancelled', channel_revision: revisionOf(booking.revision), updated_at: nowIso, notes: (e.data.notes || '') + '\n\n[' + cm + '] unit removed by modification' })); written.push({ id: e.id, cancelled: true }); }

  const isNew = !outcome.existing.some(Boolean);
  const result = conflicts.length ? 'conflict' : (isNew ? 'created' : (written.length ? 'modified' : 'noop'));
  const eventId = await logEvent(store, Object.assign(base, { result, vilu_reservation_ids: written.map((w) => w.id), conflict_ids: conflicts }));
  return { result, event_id: eventId, docs: written.map((w) => w.id), written, conflicts };
}

module.exports = { ingestEvent, docIdFor, mapStatus, buildFields, newerOrEqual };
