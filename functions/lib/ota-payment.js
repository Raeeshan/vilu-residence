'use strict';
// Channel-aware OTA payment normalization (Beds24 pre-integration stage).
// Pure functions -- no Firestore, no network, no card credentials ever
// touched (see the module-level self-check test in
// test/ota-payment.test.js). Undeployed: consumed by functions/lib/ingest.js
// (the sandbox/test copy), never by anything the "ota" Cloud Functions
// codebase (functions-ota/) actually runs yet.
//
// ── Why this module exists (2026-09-09 pass) ──
// The owner's explicit correction: OTA bookings must NOT be modeled as a
// single universal "pay at property" policy. A Booking.com/Expedia/Agoda
// reservation's real settlement is CHANNEL-SPECIFIC and RESERVATION-
// SPECIFIC -- the reservation/channel data itself is authoritative, never
// the channel's name alone. See docs/ai/BEDS24_PRE_INTEGRATION_STAGE.md §10
// for the primary-source research this is built on (Beds24's own Expedia/
// Booking.com/Agoda mapping documentation).
//
// ── Field audit (Step 1) — what already existed before this module ──
// ingest.js's canonical booking shape already carries a `commercial` object
// (`{currency, gross_total, net_total, tax_total, commission, paid, balance,
// rate_includes_tax}`, Stage 8) persisted to Firestore as `ota_currency` /
// `ota_gross_total` / `ota_net_total` / `ota_tax_total` / `ota_commission` /
// `ota_paid` / `ota_balance` / `rate_includes_tax`. These are REUSED as-is
// here (gross_total -> booking_total, currency -> payment_currency) --
// never duplicated under a new name. `paid`/`balance` are kept exactly as
// the channel reports them (a simple "how much has been settled so far"
// figure) precisely BECAUSE they do not distinguish WHO holds responsibility
// for the remainder -- that distinction is the genuine gap this module
// fills, never invented by relabelling paid/balance as if they already
// answered it. The direct-booking `Reservation.pay` field in
// vilu-unified.html (free text/'Unpaid'/'Deposit paid'/'Fully paid') is
// untouched -- it is a direct-only concept and out of scope here.
const PAYMENT_MODELS = ['property_collect', 'ota_collect', 'virtual_card', 'partial_prepayment', 'unknown'];
const PAYMENT_STATUSES = ['unpaid', 'partially_paid', 'paid_to_ota', 'payable_at_property', 'settled', 'review_required'];

function round2(n) {
  return n == null ? null : +n.toFixed(2);
}

// Normalizes one reservation's channel-reported commercial data into the
// canonical Vilu payment structure. `commercial` is the SAME object
// ingest.js's canonical booking shape already carries (gross_total, paid,
// balance, ...), optionally extended by the adapter with whatever
// settlement detail it could actually determine for that specific
// reservation: `payment_model` (one of PAYMENT_MODELS, when known),
// `prepayment_amount`, `virtual_card: {available, amount, activation_date}`,
// `payment_reference`. Nothing here ever calls an OTA/Beds24 API -- it only
// reshapes data already handed to it.
//
// Never assumes amount_due_at_property = booking_total just because the
// model is unknown (Step 3) -- an unrecognized model always produces
// payment_status='review_required' with both amounts left null, forcing a
// human to resolve it rather than risking either a missed charge (if the
// OTA actually collected it) or a silent under-collection (if the property
// really is owed the full amount).
function normalizeOtaPayment({ commercial }) {
  const c = commercial || {};
  const currency = c.currency || null;
  const bookingTotal = typeof c.gross_total === 'number' ? c.gross_total : null;
  const reportedModel = PAYMENT_MODELS.includes(c.payment_model) ? c.payment_model : null;

  const virtualCard = {
    available: !!(c.virtual_card && c.virtual_card.available),
    amount: c.virtual_card && typeof c.virtual_card.amount === 'number' ? c.virtual_card.amount : null,
    activationDate: (c.virtual_card && c.virtual_card.activation_date) || null,
  };

  let model, status, amountCollectedByOta, amountDueAtProperty, prepaymentAmount, propertyCollectAmount;

  if (reportedModel === 'property_collect') {
    model = 'property_collect';
    amountCollectedByOta = 0;
    amountDueAtProperty = bookingTotal;
    prepaymentAmount = 0;
    propertyCollectAmount = bookingTotal;
    status = bookingTotal != null ? 'payable_at_property' : 'review_required';
  } else if (reportedModel === 'ota_collect') {
    model = 'ota_collect';
    amountCollectedByOta = bookingTotal;
    amountDueAtProperty = 0;
    prepaymentAmount = bookingTotal;
    propertyCollectAmount = 0;
    status = bookingTotal != null ? 'paid_to_ota' : 'review_required';
  } else if (reportedModel === 'virtual_card') {
    // The card itself is never stored here (see the module header) -- only
    // the amount/availability/activation date the adapter already resolved.
    model = 'virtual_card';
    const vcAmount = virtualCard.amount != null ? virtualCard.amount : bookingTotal;
    amountCollectedByOta = vcAmount;
    amountDueAtProperty = 0;
    prepaymentAmount = vcAmount;
    propertyCollectAmount = 0;
    status = vcAmount != null ? 'settled' : 'review_required';
  } else if (reportedModel === 'partial_prepayment') {
    model = 'partial_prepayment';
    const prepay = typeof c.prepayment_amount === 'number' ? c.prepayment_amount : null;
    prepaymentAmount = prepay;
    amountCollectedByOta = prepay;
    amountDueAtProperty = (bookingTotal != null && prepay != null) ? round2(bookingTotal - prepay) : null;
    propertyCollectAmount = amountDueAtProperty;
    if (prepay == null || bookingTotal == null) status = 'review_required';
    else if (amountDueAtProperty === 0) status = 'settled';
    else if (prepay > 0) status = 'partially_paid';
    else status = 'payable_at_property';
  } else {
    model = 'unknown';
    status = 'review_required';
    amountCollectedByOta = null;
    amountDueAtProperty = null;
    prepaymentAmount = null;
    propertyCollectAmount = null;
  }

  return {
    payment_model: model,
    payment_status: status,
    payment_currency: currency,
    booking_total: bookingTotal,
    amount_collected_by_ota: amountCollectedByOta,
    amount_due_at_property: amountDueAtProperty,
    prepayment_amount: prepaymentAmount,
    property_collect_amount: propertyCollectAmount,
    virtual_card_available: virtualCard.available,
    virtual_card_amount: virtualCard.amount,
    virtual_card_activation_date: virtualCard.activationDate,
    ota_payment_reference: c.payment_reference || null,
    // Step 11: the channel's own gross_total already reflects whatever
    // occupancy pricing (including any 3rd-guest/child supplement) the OTA
    // itself charged -- this flag exists purely as a self-documenting
    // reminder for any future PMS/display code never to add Vilu's own
    // third_guest_supplement on top of an OTA-sourced total. See
    // calcTax()'s channel_manager guard in vilu-unified.html.
    authoritative_total: bookingTotal != null,
  };
}

// Step 8: the 3.5% card-processing surcharge is an owner-approved DIRECT/
// property-collection fee -- it must never apply to money an OTA already
// collected (ota_collect), a virtual-card settlement (never Vilu's own card
// transaction), or the collected portion of a partial prepayment. It is
// only ever eligible on the genuine amount_due_at_property, i.e. the money
// Vilu itself would actually process. This function does not charge
// anything -- it only reports what portion, if any, the surcharge could
// ever legally apply to; the PMS decides cash vs. card at collection time.
function surchargeEligibleAmount(normalized) {
  if (!normalized) return 0;
  if (normalized.payment_model === 'virtual_card' || normalized.payment_model === 'ota_collect') return 0;
  return normalized.amount_due_at_property || 0;
}

// Step 10: reconciles an OWED amount (from computeCancellationCharge() or
// computeNoShowCharge() in ota-room-types.js) against what the OTA has
// ALREADY collected for this reservation, so Vilu never charges the same
// money twice. If the payment model couldn't be determined
// (payment_status='review_required') this deliberately refuses to guess --
// amountStillOwed comes back null with needsReview:true, exactly like an
// unknown payment model itself, rather than assuming either "nothing left
// to collect" or "the full amount is still due".
function reconcileOwedAmount({ owedAmount, normalized }) {
  if (owedAmount == null) return { amountStillOwed: null, needsReview: true };
  if (!normalized || normalized.payment_status === 'review_required' || normalized.amount_collected_by_ota == null) {
    return { amountStillOwed: null, needsReview: true };
  }
  const alreadyCollected = normalized.amount_collected_by_ota || 0;
  return { amountStillOwed: round2(Math.max(0, owedAmount - alreadyCollected)), needsReview: false };
}

module.exports = {
  PAYMENT_MODELS,
  PAYMENT_STATUSES,
  normalizeOtaPayment,
  surchargeEligibleAmount,
  reconcileOwedAmount,
};
