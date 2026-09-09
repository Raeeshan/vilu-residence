// Channel-aware OTA payment normalization — unit tests (Beds24
// pre-integration stage). Pure logic only, no Firestore, no network, no
// live reservation touched.
//   node test/ota-payment.test.js
const assert = require('assert');
const path = require('path');
const F = (p) => require(path.join(__dirname, '..', 'functions', 'lib', p));
const { normalizeOtaPayment, surchargeEligibleAmount, reconcileOwedAmount, PAYMENT_MODELS, PAYMENT_STATUSES } = F('ota-payment');
const { computeCancellationCharge, computeNoShowCharge, INITIAL_OTA_ROOM_TYPES } = F('ota-room-types');
const { buildFields, describeOtaPayment } = F('ingest');

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 8).join('\n     ')); } }

(async () => {
  await test('this harness never touches Firestore or the network, and never handles raw card data (self-check)', () => {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'functions', 'lib', 'ota-payment.js'), 'utf8');
    assert.ok(!/require\(['"]firebase|\bfetch\(|\bhttps?:\/\/\S/i.test(src), 'ota-payment.js must stay pure/no network');
    assert.ok(!/\bpan\b|cvc|cvv|card_number|cardNumber/i.test(src), 'ota-payment.js must never reference raw PCI-sensitive card data');
  });

  // ── Step 13, case 1: Booking.com property collect ──
  await test('1. Booking.com property collect: total=500, OTA collected=0, due at property=500', () => {
    const p = normalizeOtaPayment({ commercial: { currency: 'USD', gross_total: 500, payment_model: 'property_collect' } });
    assert.strictEqual(p.payment_model, 'property_collect');
    assert.strictEqual(p.booking_total, 500);
    assert.strictEqual(p.amount_collected_by_ota, 0);
    assert.strictEqual(p.amount_due_at_property, 500);
    assert.strictEqual(p.payment_status, 'payable_at_property');
  });

  // ── case 2: Booking.com/OTA collect ──
  await test('2. Booking.com OTA collect: total=500, OTA collected=500, due=0', () => {
    const p = normalizeOtaPayment({ commercial: { currency: 'USD', gross_total: 500, payment_model: 'ota_collect' } });
    assert.strictEqual(p.payment_model, 'ota_collect');
    assert.strictEqual(p.amount_collected_by_ota, 500);
    assert.strictEqual(p.amount_due_at_property, 0);
    assert.strictEqual(p.payment_status, 'paid_to_ota');
  });

  // ── case 3: Expedia Collect ──
  await test('3. Expedia Collect: total=500, collected by Expedia=500, due=0', () => {
    const p = normalizeOtaPayment({ commercial: { currency: 'USD', gross_total: 500, payment_model: 'ota_collect' } });
    assert.strictEqual(p.amount_collected_by_ota, 500);
    assert.strictEqual(p.amount_due_at_property, 0);
  });

  // ── case 4: Expedia Property Collect ──
  await test('4. Expedia Property Collect: total=500, OTA collected=0, due=500', () => {
    const p = normalizeOtaPayment({ commercial: { currency: 'USD', gross_total: 500, payment_model: 'property_collect' } });
    assert.strictEqual(p.amount_collected_by_ota, 0);
    assert.strictEqual(p.amount_due_at_property, 500);
  });

  // ── case 5: Agoda prepaid ──
  await test('5. Agoda prepaid: total=500, OTA collected=500, due=0', () => {
    const p = normalizeOtaPayment({ commercial: { currency: 'USD', gross_total: 500, payment_model: 'ota_collect' } });
    assert.strictEqual(p.amount_collected_by_ota, 500);
    assert.strictEqual(p.amount_due_at_property, 0);
  });

  // ── case 6: partial prepayment ──
  await test('6. Partial prepayment: total=500, collected=200, due=300', () => {
    const p = normalizeOtaPayment({ commercial: { currency: 'USD', gross_total: 500, payment_model: 'partial_prepayment', prepayment_amount: 200 } });
    assert.strictEqual(p.payment_model, 'partial_prepayment');
    assert.strictEqual(p.amount_collected_by_ota, 200);
    assert.strictEqual(p.amount_due_at_property, 300);
    assert.strictEqual(p.payment_status, 'partially_paid');
  });

  // ── case 7: virtual card must NOT trigger Vilu's 3.5% guest-card surcharge ──
  await test('7. Virtual card: settled, $0 due at property, and ineligible for Vilu\'s 3.5% surcharge', () => {
    const p = normalizeOtaPayment({ commercial: { currency: 'USD', gross_total: 500, payment_model: 'virtual_card', virtual_card: { available: true, amount: 500, activation_date: '2026-10-09' } } });
    assert.strictEqual(p.payment_model, 'virtual_card');
    assert.strictEqual(p.amount_due_at_property, 0);
    assert.strictEqual(p.payment_status, 'settled');
    assert.strictEqual(p.virtual_card_available, true);
    assert.strictEqual(p.virtual_card_amount, 500);
    assert.strictEqual(p.virtual_card_activation_date, '2026-10-09');
    assert.strictEqual(surchargeEligibleAmount(p), 0, 'virtual-card settlement must never be eligible for Vilu\'s own card surcharge');
  });

  // ── case 8: unknown payment model ──
  await test('8. Unknown payment model: review_required, does NOT assume full amount due', () => {
    const p = normalizeOtaPayment({ commercial: { currency: 'USD', gross_total: 500 } }); // no payment_model supplied
    assert.strictEqual(p.payment_model, 'unknown');
    assert.strictEqual(p.payment_status, 'review_required');
    assert.strictEqual(p.amount_due_at_property, null, 'must NOT assume amount_due_at_property = booking_total for an unknown model');
    assert.strictEqual(p.amount_collected_by_ota, null);
  });

  await test('8b. An unrecognized/garbage payment_model string is treated exactly like no model at all', () => {
    const p = normalizeOtaPayment({ commercial: { currency: 'USD', gross_total: 500, payment_model: 'some_future_channel_model_not_yet_supported' } });
    assert.strictEqual(p.payment_model, 'unknown');
    assert.strictEqual(p.payment_status, 'review_required');
  });

  // ── case 9 & 10: cancellation / no-show after OTA already collected -- no duplicate charge ──
  await test('9. Cancellation after OTA already collected: no duplicate charge', () => {
    const policy = INITIAL_OTA_ROOM_TYPES.double.cancellation_policy;
    const owed = computeCancellationCharge({ policy, daysBeforeArrival: 5, totalBookingValue: 500 }); // 100% tier = $500 owed
    const normalized = normalizeOtaPayment({ commercial: { currency: 'USD', gross_total: 500, payment_model: 'ota_collect' } });
    const reconciled = reconcileOwedAmount({ owedAmount: owed.chargeAmount, normalized });
    assert.strictEqual(owed.chargeAmount, 500);
    assert.strictEqual(reconciled.amountStillOwed, 0, 'the OTA already collected the full amount -- Vilu must not charge it again');
    assert.strictEqual(reconciled.needsReview, false);
  });

  await test('10. No-show after OTA already collected: no duplicate charge', () => {
    const policy = INITIAL_OTA_ROOM_TYPES.double.cancellation_policy;
    const owed = computeNoShowCharge({ policy, totalBookingValue: 500 }); // 100% = $500 owed
    const normalized = normalizeOtaPayment({ commercial: { currency: 'USD', gross_total: 500, payment_model: 'ota_collect' } });
    const reconciled = reconcileOwedAmount({ owedAmount: owed.chargeAmount, normalized });
    assert.strictEqual(reconciled.amountStillOwed, 0);
  });

  await test('9b. Cancellation on a property-collect reservation: the full owed amount is still due (nothing collected yet)', () => {
    const policy = INITIAL_OTA_ROOM_TYPES.double.cancellation_policy;
    const owed = computeCancellationCharge({ policy, daysBeforeArrival: 20, totalBookingValue: 500 }); // 50% tier = $250
    const normalized = normalizeOtaPayment({ commercial: { currency: 'USD', gross_total: 500, payment_model: 'property_collect' } });
    const reconciled = reconcileOwedAmount({ owedAmount: owed.chargeAmount, normalized });
    assert.strictEqual(owed.chargeAmount, 250);
    assert.strictEqual(reconciled.amountStillOwed, 250, 'property never collected anything, so the full owed 50% is still due');
  });

  await test('9c. Cancellation partially covered by a prepayment: only the shortfall is still owed', () => {
    const policy = INITIAL_OTA_ROOM_TYPES.double.cancellation_policy;
    const owed = computeCancellationCharge({ policy, daysBeforeArrival: 5, totalBookingValue: 500 }); // 100% tier = $500
    const normalized = normalizeOtaPayment({ commercial: { currency: 'USD', gross_total: 500, payment_model: 'partial_prepayment', prepayment_amount: 200 } });
    const reconciled = reconcileOwedAmount({ owedAmount: owed.chargeAmount, normalized });
    assert.strictEqual(reconciled.amountStillOwed, 300, '$500 owed minus the $200 already prepaid = $300 still due');
  });

  await test('9d. Cancellation/no-show reconciliation refuses to guess when the payment model is unknown', () => {
    const policy = INITIAL_OTA_ROOM_TYPES.double.cancellation_policy;
    const owed = computeCancellationCharge({ policy, daysBeforeArrival: 5, totalBookingValue: 500 });
    const normalized = normalizeOtaPayment({ commercial: { currency: 'USD', gross_total: 500 } }); // unknown model
    const reconciled = reconcileOwedAmount({ owedAmount: owed.chargeAmount, normalized });
    assert.strictEqual(reconciled.amountStillOwed, null);
    assert.strictEqual(reconciled.needsReview, true);
  });

  // ── case 11 & 12: 3.5% surcharge only applies to what Vilu itself processes by card ──
  await test('11. Remaining balance paid at Vilu by cash: no 3.5% (surcharge is a card-only concept, applied by the PMS at collection time)', () => {
    const normalized = normalizeOtaPayment({ commercial: { currency: 'USD', gross_total: 500, payment_model: 'partial_prepayment', prepayment_amount: 200 } });
    const eligible = surchargeEligibleAmount(normalized);
    assert.strictEqual(eligible, 300, 'the $300 due at property is the amount eligible IF Vilu processes it by card -- cash collection of the same $300 simply never invokes the surcharge at all');
  });

  await test('12. Remaining balance paid at Vilu by card: 3.5% applies only to the balance Vilu actually processes, never the OTA-collected portion', () => {
    const normalized = normalizeOtaPayment({ commercial: { currency: 'USD', gross_total: 500, payment_model: 'partial_prepayment', prepayment_amount: 200 } });
    const eligible = surchargeEligibleAmount(normalized);
    const surcharge = +(eligible * 0.035).toFixed(2);
    assert.strictEqual(eligible, 300);
    assert.strictEqual(surcharge, 10.5, '3.5% of the $300 due-at-property balance only, never the $200 OTA already collected');
  });

  await test('12b. surchargeEligibleAmount is 0 for ota_collect (nothing left for Vilu to ever process by card)', () => {
    const normalized = normalizeOtaPayment({ commercial: { currency: 'USD', gross_total: 500, payment_model: 'ota_collect' } });
    assert.strictEqual(surchargeEligibleAmount(normalized), 0);
  });

  await test('12c. surchargeEligibleAmount is 0 (not a guess) when the payment model is unknown', () => {
    const normalized = normalizeOtaPayment({ commercial: { currency: 'USD', gross_total: 500 } });
    assert.strictEqual(surchargeEligibleAmount(normalized), 0, 'an unknown model must never be treated as eligible for a surcharge Vilu cannot confirm it will actually process');
  });

  // ── Step 11: authoritative_total flag ──
  await test('the normalized payment flags an OTA-sourced total as authoritative (never re-add a 3rd-guest supplement on top of it)', () => {
    const p = normalizeOtaPayment({ commercial: { currency: 'USD', gross_total: 500, payment_model: 'ota_collect' } });
    assert.strictEqual(p.authoritative_total, true);
    const p2 = normalizeOtaPayment({ commercial: {} });
    assert.strictEqual(p2.authoritative_total, false);
  });

  // ── Currency / rounding ──
  await test('payment_currency is reused directly from commercial.currency, never invented or hardcoded', () => {
    const p = normalizeOtaPayment({ commercial: { currency: 'EUR', gross_total: 400, payment_model: 'property_collect' } });
    assert.strictEqual(p.payment_currency, 'EUR');
  });

  await test('partial_prepayment amounts round to 2 decimals cleanly', () => {
    const p = normalizeOtaPayment({ commercial: { currency: 'USD', gross_total: 333.33, payment_model: 'partial_prepayment', prepayment_amount: 111.11 } });
    assert.strictEqual(p.amount_due_at_property, 222.22);
  });

  await test('the module exposes exactly the documented enums, nothing invented', () => {
    assert.deepStrictEqual(PAYMENT_MODELS, ['property_collect', 'ota_collect', 'virtual_card', 'partial_prepayment', 'unknown']);
    assert.deepStrictEqual(PAYMENT_STATUSES, ['unpaid', 'partially_paid', 'paid_to_ota', 'payable_at_property', 'settled', 'review_required']);
  });

  // ── ingest.js wiring: buildFields() actually persists the normalized payment ──
  await test('buildFields() persists the normalized channel-aware payment fields onto the Firestore reservation doc', () => {
    const booking = {
      external_id: 'BDC1', revision: '1', status: 'new', channel: 'Booking.com', channel_reservation_id: 'REF1', booking_date: '2026-09-01T00:00:00Z',
      guest: { first: 'Jane', last: 'Doe', email: 'jane@example.com', phone: '+1', country: 'US' },
      commercial: { currency: 'USD', gross_total: 500, net_total: 470, tax_total: 30, commission: 75, paid: 0, balance: 500, rate_includes_tax: true, payment_model: 'property_collect' },
      units: [{ room_type: 'DOUBLE', check_in: '2026-12-01', check_out: '2026-12-03', adults: 2, children: 0, nightly_rate: 90 }],
    };
    const fields = buildFields(booking, booking.units[0], 0, 'mock', 'VR03', '2026-09-09T00:00:00Z');
    assert.strictEqual(fields.ota_payment_model, 'property_collect');
    assert.strictEqual(fields.ota_payment_status, 'payable_at_property');
    assert.strictEqual(fields.ota_amount_collected, 0);
    assert.strictEqual(fields.ota_amount_due_at_property, 500);
    // pre-existing Stage 8 fields must be completely unaffected (additive change)
    assert.strictEqual(fields.ota_gross_total, 500);
    assert.strictEqual(fields.ota_paid, 0);
    assert.strictEqual(fields.ota_balance, 500);
    assert.ok(fields.pay.includes('property collect'));
    assert.ok(fields.pay.includes('due at property USD500'));
  });

  await test('buildFields() marks an unknown payment model for staff review in the pay summary, without asserting a false due amount', () => {
    const booking = {
      external_id: 'BDC2', revision: '1', status: 'new', channel: 'Booking.com',
      guest: { first: 'John', last: 'Smith' },
      commercial: { currency: 'USD', gross_total: 500 }, // no payment_model supplied
      units: [{ room_type: 'DOUBLE', check_in: '2026-12-01', check_out: '2026-12-02', adults: 2, children: 0, nightly_rate: 90 }],
    };
    const fields = buildFields(booking, booking.units[0], 0, 'mock', 'VR03', '2026-09-09T00:00:00Z');
    assert.strictEqual(fields.ota_payment_model, 'unknown');
    assert.strictEqual(fields.ota_amount_due_at_property, null);
    assert.ok(fields.pay.includes('REVIEW REQUIRED'));
  });

  await test('describeOtaPayment() never includes a raw card number/reference in a way that looks like PCI data', () => {
    const p = normalizeOtaPayment({ commercial: { currency: 'USD', gross_total: 500, payment_model: 'virtual_card', virtual_card: { available: true, amount: 500 } } });
    const summary = describeOtaPayment('mock', p);
    assert.ok(!/\d{12,}/.test(summary), 'must never contain a long digit run resembling a card number');
  });

  console.log('\n' + passed + '/' + (passed + failed) + ' ota-payment assertions passed');
  process.exit(failed ? 1 : 0);
})();
