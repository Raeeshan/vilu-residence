const {onDocumentCreated} = require('firebase-functions/v2/firestore');
const {initializeApp} = require('firebase-admin/app');
const {getFirestore, FieldValue} = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

// Same half-open interval overlap test the client uses (vilu-unified.html,
// hasBlockConflict()/the New Booking conflict check): two stays only
// conflict if one starts before the other ends AND ends after the other
// starts, so a checkout on the same day as another check-in is NOT a
// conflict (that's the normal same-day turnover case).
function datesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

// Mirrors the "active" definition reconcileAllRooms() uses client-side:
// Cancelled and Checked out reservations no longer hold the room, so they
// can never be the reason a new reservation gets blocked.
function isActive(status) {
  return status !== 'Cancelled' && status !== 'Checked out';
}

// Server-side backstop for the one thing Firestore rules cannot express:
// "does this new reservation's date range overlap any other active
// reservation for the same room". The client's writeReservation() atomic
// transaction is the primary defense and already prevents this for every
// booking made through the app; this trigger only ever fires for the case
// that matters here — a raw API write that bypassed that transaction
// entirely. It runs after the write commits (onCreate), so it never blocks
// or slows down the booking flow itself.
exports.blockDoubleBooking = onDocumentCreated('reservations/{reservationId}', async (event) => {
  const snap = event.data;
  if (!snap) return;
  const data = snap.data();
  const newId = event.params.reservationId;

  if (!data || !isActive(data.status)) return;
  const roomId = data.room_id;
  const checkIn = data.check_in;
  const checkOut = data.check_out;
  if (!roomId || !checkIn || !checkOut) return;

  const sameRoomSnap = await db.collection('reservations')
    .where('room_id', '==', roomId)
    .get();

  // Cold starts mean this trigger can run late enough that BOTH conflicting
  // docs already exist by the time either invocation queries the room — so
  // "am I the new one" can't be decided by execution order (that's a race:
  // whichever invocation happens to run first would wrongly cancel itself,
  // which could be the legitimate original booking rather than the
  // intruder). Firestore's own createTime is the one clock both invocations
  // agree on regardless of when they actually execute.
  const myCreateMs = snap.createTime.toMillis();

  let conflict = null;
  sameRoomSnap.forEach((doc) => {
    if (conflict || doc.id === newId) return;
    const other = doc.data();
    if (!other || !isActive(other.status)) return;
    if (!other.check_in || !other.check_out) return;
    if (!datesOverlap(checkIn, checkOut, other.check_in, other.check_out)) return;

    const otherCreateMs = doc.createTime.toMillis();
    const amTheLaterOne = myCreateMs > otherCreateMs ||
      (myCreateMs === otherCreateMs && newId > doc.id);
    if (amTheLaterOne) {
      conflict = {id: doc.id, check_in: other.check_in, check_out: other.check_out};
    }
  });

  if (!conflict) return;

  // Neutralize the newly-created doc rather than hard-deleting it — keeps
  // the evidence in place (guest details, source, timestamps) for staff to
  // review, exactly like a normal cancellation, just server-initiated.
  await snap.ref.update({
    status: 'Cancelled',
    autoBlockedReason: 'double_booking_detected_by_server',
    autoBlockedAt: FieldValue.serverTimestamp(),
    autoBlockedConflictId: conflict.id,
  });

  const message = 'Reservation ' + newId + ' for room ' + roomId + ' (' + checkIn +
    ' to ' + checkOut + ') overlapped existing reservation ' + conflict.id + ' (' +
    conflict.check_in + ' to ' + conflict.check_out + ') and was auto-cancelled by ' +
    'the server-side double-booking guard.';

  await db.collection('reconciliation_log').add({
    type: 'double_booking_blocked',
    roomId: roomId,
    reservationId: newId,
    conflictingReservationId: conflict.id,
    check_in: checkIn,
    check_out: checkOut,
    source: data.source || null,
    agencyId: data.agencyId || null,
    timestamp: new Date().toISOString(),
    triggeredBy: 'blockDoubleBooking',
    message: message,
  });

  console.warn(message);
});
