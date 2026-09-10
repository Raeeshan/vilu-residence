'use strict';
// Beds24 -> Vilu canonical booking normalization (inbound continuous-sync
// pass). Pure function -- no network, no Firestore -- converts one raw
// Beds24 GET /bookings API object into the EXACT canonical shape
// functions/lib/ingest.js's ingestEvent()/buildFields() already expect (see
// that file's own header comment for the contract, confirmed against its
// real source before writing this). This is the only place Beds24's inbound
// field names are translated -- ingest.js itself is never touched or
// reimplemented, matching how beds24-bridge.js is the only translation
// point for the outbound direction.
const { viluRoomTypeForBeds24RoomId } = require('./beds24-bridge');

// Owner-locked integration scope: only these three channels are recognized
// OTAs for auto-ingestion. Every other real Beds24 channel value (direct,
// airbnb, ical imports, vrbo, ...) is valid on Beds24's side but is NOT one
// this integration auto-ingests into production Vilu -- see
// shouldAutoIngest() below, which is the actual gate the processor must
// check before calling ingestEvent(). canonical `channel` is set either way
// for audit/display; only shouldAutoIngest() decides whether to proceed.
const RECOGNIZED_CHANNELS = Object.freeze({
  booking: 'Booking.com',
  expedia: 'Expedia',
  agoda: 'Agoda',
});

function sumInvoiceItems(invoiceItems, type) {
  return (invoiceItems || [])
    .filter((i) => i.type === type)
    .reduce((sum, i) => sum + (Number(i.amount) || 0) * (i.qty != null ? Number(i.qty) : 1), 0);
}

// Beds24's booking object carries no per-booking currency field (confirmed
// against the live OpenAPI spec -- currency is a PROPERTY-level setting,
// already established as USD for property 352964). Never invented
// per-booking; always the one real configured value.
const PROPERTY_CURRENCY = 'USD';

// raw: one object from Beds24 GET /bookings response's `data[]` array
// (confirmed schema: id, roomId, arrival, departure, numAdult, numChild,
// firstName, lastName, email, phone, mobile, country, country2, status,
// channel, apiReference, price, tax, commission, deposit, notes, comments,
// arrivalTime, bookingTime, modifiedTime, invoiceItems[]).
function normalizeBeds24Booking(raw) {
  if (!raw) return null;
  const canonicalChannel = RECOGNIZED_CHANNELS[raw.channel] || null;
  const roomType = viluRoomTypeForBeds24RoomId(raw.roomId);
  const paid = sumInvoiceItems(raw.invoiceItems, 'payment');
  const grossTotal = raw.price != null ? Number(raw.price) : null;

  return {
    external_id: String(raw.id),
    revision: raw.modifiedTime || raw.bookingTime || null,
    status: raw.status || 'confirmed',
    channel: canonicalChannel || raw.channel || 'unknown',
    channel_reservation_id: raw.apiReference || String(raw.id),
    booking_date: raw.bookingTime || null,
    guest: {
      first: raw.firstName || '',
      last: raw.lastName || '',
      email: raw.email || '',
      phone: raw.phone || raw.mobile || '',
      country: raw.country2 || raw.country || '',
    },
    notes: raw.notes || '',
    special_requests: raw.comments || '',
    // Beds24's booking object has no meal-plan field -- rate plans/offers
    // are a separate, unexplored API surface. Left unmapped rather than
    // invented; documented as a known gap in the build report.
    meal_plan: null,
    arrival_info: raw.arrivalTime || '',
    commercial: {
      currency: PROPERTY_CURRENCY,
      gross_total: grossTotal,
      net_total: grossTotal != null && raw.tax != null ? +(grossTotal - Number(raw.tax)).toFixed(2) : grossTotal,
      tax_total: raw.tax != null ? Number(raw.tax) : null,
      commission: raw.commission != null ? Number(raw.commission) : null,
      paid,
      balance: grossTotal != null ? +(grossTotal - paid).toFixed(2) : null,
      rate_includes_tax: false,
      // payment_model is intentionally left undefined: Beds24's booking
      // object has no explicit "who collects this payment" classification,
      // and ota-payment.js's normalizeOtaPayment() already refuses to
      // guess -- an undefined model correctly resolves to
      // payment_model:'unknown', payment_status:'review_required',
      // surfacing every Beds24-sourced booking's payment for manual staff
      // reconciliation rather than silently miscategorizing who is owed
      // what.
      payment_model: undefined,
      prepayment_amount: raw.deposit != null ? Number(raw.deposit) : null,
      virtual_card: { available: false, amount: null, activation_date: null },
      payment_reference: raw.apiReference || null,
    },
    units: [
      {
        // A deliberately-unmapped sentinel when roomType is null: this is
        // NOT a valid Vilu display name, so inventory.js's own
        // buildRoomTypes()-derived lookup fails naturally and ingest.js's
        // EXISTING "unknown_room_type" conflict path (already tested)
        // takes over -- no new unknown-room-id handling was invented here.
        room_type: roomType || ('UNMAPPED_BEDS24_ROOM_' + raw.roomId),
        check_in: raw.arrival,
        check_out: raw.departure,
        adults: raw.numAdult != null ? raw.numAdult : 2,
        children: raw.numChild || 0,
        child_ages: null,
        nightly_rate: null,
      },
    ],
    // Not part of ingest.js's documented canonical shape -- read only by
    // the processor's channel gate (shouldAutoIngest below), never by
    // ingestEvent()/buildFields() itself.
    _raw_channel: raw.channel || null,
    _channel_recognized: !!canonicalChannel,
  };
}

// Step 12 gate: a Beds24 manual/direct booking (or any channel this
// integration hasn't been asked to support) is a real, valid Beds24
// booking -- just not one auto-ingested into production Vilu. The caller
// (the processor) must check this BEFORE calling ingestEvent().
function shouldAutoIngest(canonicalBooking) {
  return !!(canonicalBooking && canonicalBooking._channel_recognized);
}

module.exports = { RECOGNIZED_CHANNELS, normalizeBeds24Booking, shouldAutoIngest };
