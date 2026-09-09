'use strict';
// Deployment copy for the "ota" Functions codebase — kept in sync with
// functions/lib/booking-core.js and functions-core/lib/booking-core.js.
// Server-side equivalent of writeReservation() in vilu-unified.html /
// vilu-website.html: reservation doc + room_availability lock in ONE
// transaction, ROOM_CONFLICT on any overlap with the room's lock or a block.
// Used by publicBooking (Stage 0 fix) and by the OTA ingestion core (Stage 3/4).
const { overlaps, isActiveStatus } = require('./inventory');

class RoomConflictError extends Error {
  constructor(detail) { super('ROOM_CONFLICT'); this.code = 'ROOM_CONFLICT'; this.detail = detail || null; }
}

async function blockConflict(store, roomId, checkIn, checkOut) {
  const blocks = await store.query('blocks', 'room_id', roomId);
  const hit = blocks.find((b) => overlaps(checkIn, checkOut, b.from_date, b.to_date));
  return hit ? { id: hit._id || hit.id, from: hit.from_date, to: hit.to_date, reason: hit.reason || '' } : null;
}

// Writes `fields` as reservations/{docId} and updates the lock docs. Mirrors
// the client transaction exactly (same filter/overlap/merge semantics) so the
// two never drift. Throws RoomConflictError; never force-writes.
async function writeReservationTx(store, docId, fields, opts) {
  opts = opts || {};
  const roomId = fields.room_id;
  const oldRoomId = opts.oldRoomId && opts.oldRoomId !== roomId ? opts.oldRoomId : null;
  const active = isActiveStatus(fields.status);
  if (active) {
    const blk = await blockConflict(store, roomId, fields.check_in, fields.check_out);
    if (blk) throw new RoomConflictError({ type: 'block', block: blk, room: roomId });
  }
  return store.runTransaction(async (tx) => {
    const newAvail = (await tx.get('room_availability', roomId)) || {};
    const oldAvail = oldRoomId ? ((await tx.get('room_availability', oldRoomId)) || {}) : null;
    const newBookings = (newAvail.bookings || []).filter((b) => b.id !== docId);
    if (active) {
      const clash = newBookings.find((b) => fields.check_in < b.to && fields.check_out > b.from);
      if (clash) throw new RoomConflictError({ type: 'reservation', room: roomId, conflicting: clash });
      newBookings.push({ id: docId, from: fields.check_in, to: fields.check_out });
    }
    tx.set('reservations', docId, fields, { merge: true });
    tx.set('room_availability', roomId, { bookings: newBookings }, { merge: true });
    if (oldRoomId) {
      const oldBookings = (oldAvail.bookings || []).filter((b) => b.id !== docId);
      tx.set('room_availability', oldRoomId, { bookings: oldBookings }, { merge: true });
    }
    return { docId, roomId, oldRoomId };
  });
}

module.exports = { writeReservationTx, blockConflict, RoomConflictError };
