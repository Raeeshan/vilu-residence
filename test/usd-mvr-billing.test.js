// USD/MVR dual-currency billing + tax-inclusive/exclusive pricing +
// local/guest tax status — 2026-09-11.
//
// Integrates into the EXISTING canonical tax engine (calcTax/calcTaxGeneral)
// and the EXISTING single Create Invoice flow -- never a second "Local
// Invoice" system. Covers: the pure calcTaxGeneral() engine (currency,
// guest tax status, tax-inclusive reverse-calculation, Green Tax
// exemption/currency-conversion); calcTax()'s exact backward compatibility
// for reservations with none of the new fields; Firestore rules for
// tax_currency_settings/tax_settings_audit (Admin/Manager only, append-
// only audit); invoice snapshot immutability; package/room-price/Beds24/
// Cloudbeds/OTA isolation.
//
// Same technique as the rest of this suite: brace-match real functions out
// of vilu-unified.html and run them in a vm sandbox (functional/numeric
// checks), or regex-check source directly (structural/wiring checks). No
// Firestore, no browser, no live reservation.
//   node test/usd-mvr-billing.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }

const PMS = read('vilu-unified.html');
const RULES = read('firestore.rules');

function extractByStart(src, startRegex) {
  const m = src.match(startRegex);
  if (!m) throw new Error('pattern not found: ' + startRegex);
  let i = src.indexOf('{', m.index) + 1, depth = 1;
  while (depth > 0 && i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return src.slice(m.index, i);
}
function ruleBlock(src, matchStr) {
  const idx = src.indexOf(matchStr);
  if (idx === -1) throw new Error('rule block not found: ' + matchStr);
  return src.slice(idx, src.indexOf('\n    }', idx));
}

// ── sandbox: calcTaxGeneral() + calcTax() with their real dependency chain ──
const ntSrc = 'const nt=(a,b)=>Math.round((new Date(b)-new Date(a))/864e5);';
const calcTaxGeneralSrc = extractByStart(PMS, /function calcTaxGeneral\(input\)\s*\{/);
const calcTaxSrc = extractByStart(PMS, /function calcTax\(r\)\s*\{/);
const taxDefaultSrc = extractByStart(PMS, /let TAX=\{tgst:17/).replace(/^let TAX=/, 'var TAX=');
// Company Exchange Rates upgrade (2026-09-11): calcTax() now resolves its
// own exchange rate via companyExchangeRate() (never a hardcoded default),
// so any sandbox loading calcTax() must load this dependency too.
const companyExchangeRateSrc = extractByStart(PMS, /function companyExchangeRate\(currency\)\s*\{/);
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext([ntSrc, taxDefaultSrc, companyExchangeRateSrc, calcTaxGeneralSrc, calcTaxSrc].join('\n'), sandbox);
const { calcTaxGeneral, calcTax } = sandbox;

// Company Exchange Rates upgrade (2026-09-11): calcTaxGeneral()'s taxCfg
// now takes a currency-agnostic `exchangeRate` (the caller already
// resolved which currency it's for) instead of the MVR-only
// `exchangeRateUsdMvr` -- same 15.42 test value, new field name.
const DEFAULT_CFG = { tgst: 17, svc: 10, greenUsd: 6, exchangeRate: 15.42 };

section('Case A — calcTaxGeneral(): pure engine, currency/guest-status/tax-mode aware');
{
  test('CASE 1 (task Part W): Maldivian, MVR, 700/night, TAX_INCLUDED, 2 nights, 2 adults -> quoted room total remains EXACTLY MVR 1,400, Green Tax 0', () => {
    const r = calcTaxGeneral({ quotedRate: 700, nights: 2, adults: 2, children: 0, thirdGuestSupplement: 0, currency: 'MVR', guestTaxStatus: 'MALDIVIAN', priceTaxMode: 'TAX_INCLUDED', taxCfg: DEFAULT_CFG });
    assert.equal(+(r.base + r.svc + r.tgst).toFixed(2), 1400.00, 'base+svc+tgst must reconcile to EXACTLY the quoted inclusive amount');
    assert.equal(r.green, 0);
    assert.equal(r.greenExempt, true);
    assert.equal(r.greenExemptReason, 'Maldivian');
    assert.equal(r.total, 1400.00);
  });
  test('CASE 2 (task Part W): Maldivian, MVR, 700/night, TAX_EXCLUDED, 2 nights, 2 adults -> taxes added on top per canonical order, Green Tax 0, total > 1,400', () => {
    const r = calcTaxGeneral({ quotedRate: 700, nights: 2, adults: 2, children: 0, thirdGuestSupplement: 0, currency: 'MVR', guestTaxStatus: 'MALDIVIAN', priceTaxMode: 'TAX_EXCLUDED', taxCfg: DEFAULT_CFG });
    assert.equal(r.base, 1400.00);
    assert.equal(r.svc, 140.00); // 10% of base
    assert.equal(r.tgst, 261.80); // 17% of (base+svc) = 17% of 1540
    assert.equal(r.green, 0);
    assert.equal(r.total, 1801.80);
    assert.ok(r.total > 1400, 'tax-excluded total must exceed the MVR 700/night quoted subtotal');
  });
  test('CASE 3: Resident permit holder, MVR, TAX_INCLUDED -> Green Tax 0, correct exemption reason', () => {
    const r = calcTaxGeneral({ quotedRate: 700, nights: 2, adults: 2, children: 0, thirdGuestSupplement: 0, currency: 'MVR', guestTaxStatus: 'RESIDENT_PERMIT', priceTaxMode: 'TAX_INCLUDED', taxCfg: DEFAULT_CFG });
    assert.equal(r.green, 0);
    assert.equal(r.greenExempt, true);
    assert.equal(r.greenExemptReason, 'Resident permit holder');
    assert.equal(r.total, 1400.00);
  });
  test('CASE 4: Tourist, MVR -> TGST applies, Green Tax applies, original USD statutory amount retained, MVR display uses the snapshotted exchange rate', () => {
    const r = calcTaxGeneral({ quotedRate: 700, nights: 2, adults: 2, children: 0, thirdGuestSupplement: 0, currency: 'MVR', guestTaxStatus: 'TOURIST', priceTaxMode: 'TAX_EXCLUDED', taxCfg: DEFAULT_CFG });
    assert.equal(r.greenExempt, false);
    assert.equal(r.greenExemptReason, null);
    assert.equal(r.greenUsd, +(6 * 2 * 2).toFixed(2)); // $6 x 2 guests x 2 nights = $24 -- the retained statutory USD amount
    assert.equal(r.green, +(24 * 15.42).toFixed(2)); // converted for THIS invoice's MVR display/total using the snapshotted rate
    assert.equal(r.total, +(r.base + r.svc + r.tgst + r.green).toFixed(2));
  });
  test('CASE 5: Tourist, USD -> existing canonical USD behavior (Green Tax in USD 1:1, no conversion)', () => {
    const r = calcTaxGeneral({ quotedRate: 80, nights: 3, adults: 2, children: 0, thirdGuestSupplement: 0, currency: 'USD', guestTaxStatus: 'TOURIST', priceTaxMode: 'TAX_EXCLUDED', taxCfg: DEFAULT_CFG });
    assert.equal(r.greenUsd, r.green, 'USD invoices: green === greenUsd, no currency conversion applied');
    assert.equal(r.green, +(6 * 2 * 3).toFixed(2));
  });
  test('Green Tax is a separate, additive statutory line even under TAX_INCLUDED -- "tax included" never silently absorbs it (Part K)', () => {
    const inclusive = calcTaxGeneral({ quotedRate: 700, nights: 1, adults: 2, children: 0, thirdGuestSupplement: 0, currency: 'MVR', guestTaxStatus: 'TOURIST', priceTaxMode: 'TAX_INCLUDED', taxCfg: DEFAULT_CFG });
    assert.equal(+(inclusive.base + inclusive.svc + inclusive.tgst).toFixed(2), 700.00, 'the quoted inclusive amount reconciles to base+service+TGST only');
    assert.ok(inclusive.green > 0, 'Green Tax must still be added on top for a liable Tourist, even in tax-included mode');
    assert.ok(inclusive.total > 700, 'total must exceed the quoted inclusive amount once Green Tax is added');
  });
  test('TGST is never applied on top of Green Tax (Part E) -- green is additive to base+svc+tgst, not part of the base TGST is computed on', () => {
    const r = calcTaxGeneral({ quotedRate: 100, nights: 1, adults: 2, children: 0, thirdGuestSupplement: 0, currency: 'USD', guestTaxStatus: 'TOURIST', priceTaxMode: 'TAX_EXCLUDED', taxCfg: DEFAULT_CFG });
    const expectedTgst = +((r.base + r.svc) * 0.17).toFixed(2);
    assert.equal(r.tgst, expectedTgst, 'TGST must be computed on (base+service) only, never on base+service+green');
  });
  test('service charge and TGST rates are the SAME regardless of currency (Part H) -- no invented "MVR TGST"', () => {
    const usd = calcTaxGeneral({ quotedRate: 100, nights: 1, adults: 2, children: 0, thirdGuestSupplement: 0, currency: 'USD', guestTaxStatus: 'TOURIST', priceTaxMode: 'TAX_EXCLUDED', taxCfg: DEFAULT_CFG });
    const mvr = calcTaxGeneral({ quotedRate: 100, nights: 1, adults: 2, children: 0, thirdGuestSupplement: 0, currency: 'MVR', guestTaxStatus: 'TOURIST', priceTaxMode: 'TAX_EXCLUDED', taxCfg: DEFAULT_CFG });
    // same base -> same svc/tgst numerically (currency is just a label on the same commercial amount here, both quoted 100 in their own currency)
    assert.equal(usd.svc, mvr.svc);
    assert.equal(usd.tgst, mvr.tgst);
  });
}

section('Case B — calcTax(r) backward compatibility (Part U, CRITICAL): a reservation with none of the new fields is unaffected');
{
  test('a reservation with no billingCurrency/guestTaxStatus/priceTaxMode defaults to USD/Tourist/Tax-Excluded -- the exact historical behavior', () => {
    const r = calcTax({ ci: '2026-09-10', co: '2026-09-13', rate: 80, ad: 2, ch: 0, inf: 0, src: 'Direct' });
    assert.equal(r.currency, 'USD');
    assert.equal(r.guestTaxStatus, 'TOURIST');
    assert.equal(r.priceTaxMode, 'TAX_EXCLUDED');
    // exact historical formula: base = n*rate (+ supplement), svc = base*10%, tgst = (base+svc)*17%, green = 6*gp*n
    assert.equal(r.base, 240.00); // 3 nights x $80
    assert.equal(r.svc, 24.00);
    assert.equal(r.tgst, +((240 + 24) * 0.17).toFixed(2));
    assert.equal(r.green, +(6 * 2 * 3).toFixed(2));
    assert.equal(r.total, +(r.base + r.svc + r.tgst + r.green + r.bed).toFixed(2));
  });
  test('CASE 6: a child under 2 (infant) on a Tourist reservation is excluded from Green Tax entirely, same as before this task', () => {
    const withInfant = calcTax({ ci: '2026-09-10', co: '2026-09-12', rate: 80, ad: 2, ch: 0, inf: 1, src: 'Direct' });
    const withoutInfant = calcTax({ ci: '2026-09-10', co: '2026-09-12', rate: 80, ad: 2, ch: 0, inf: 0, src: 'Direct' });
    assert.equal(withInfant.green, withoutInfant.green, 'an infant must never add to the Green Tax liable headcount');
    assert.equal(withInfant.gp, 2, 'gp (Green-Tax-liable guest count) excludes infants entirely');
  });
  test('a reservation explicitly tagged USD/Tourist/Tax-Excluded produces IDENTICAL output to one with the fields omitted', () => {
    const base = { ci: '2026-09-10', co: '2026-09-14', rate: 90, ad: 2, ch: 1, inf: 0, src: 'Direct' };
    const implicit = calcTax(base);
    const explicit = calcTax(Object.assign({}, base, { billingCurrency: 'USD', guestTaxStatus: 'TOURIST', priceTaxMode: 'TAX_EXCLUDED' }));
    assert.deepEqual(JSON.parse(JSON.stringify(implicit)), JSON.parse(JSON.stringify(explicit)));
  });
  test('quotedRate, when set, is used instead of r.rate -- but r.rate remains the single field every other part of the app reads (no parallel rate field)', () => {
    const withQuoted = calcTax({ ci: '2026-09-10', co: '2026-09-11', rate: 80, quotedRate: 700, ad: 2, ch: 0, inf: 0, src: 'Direct', billingCurrency: 'MVR', guestTaxStatus: 'MALDIVIAN', priceTaxMode: 'TAX_INCLUDED' });
    assert.equal(+(withQuoted.base + withQuoted.svc + withQuoted.tgst).toFixed(2), 700.00);
  });
}

section('Case C — USD/MVR billing settings: Firestore rules (Admin/Manager only, append-only audit)');
{
  test('tax_currency_settings write is Admin/Manager only -- Staff cannot edit tax/currency configuration (Part Q)', () => {
    const block = ruleBlock(RULES, 'match /tax_currency_settings/{docId}');
    assert.match(block, /allow write:\s*if\s*isAdmin\(\) \|\| isManagerRole\(\)/);
    assert.doesNotMatch(block, /allow write:[^;]*isStaff/);
  });
  test('tax_currency_settings read is open to Staff too -- they can see the current rate/mode, just never change it', () => {
    const block = ruleBlock(RULES, 'match /tax_currency_settings/{docId}');
    assert.match(block, /allow read:\s*if\s*isAdmin\(\) \|\| isStaff\(\) \|\| isManagerRole\(\)/);
  });
  test('tax_settings_audit is genuinely append-only (update/delete denied) and requires a real, unspoofable server timestamp + actor', () => {
    const block = ruleBlock(RULES, 'match /tax_settings_audit/{id}');
    assert.match(block, /allow update, delete:\s*if\s*false/);
    assert.match(block, /request\.resource\.data\.changedByUid == request\.auth\.uid/);
    assert.match(block, /request\.resource\.data\.changedAt == request\.time/);
  });
  test('canEditTaxSettings() = Admin/Manager only, matching the rules exactly', () => {
    const src = extractByStart(PMS, /function canEditTaxSettings\(\)\s*\{/);
    assert.match(src, /role === 'admin'/);
    assert.match(src, /role === 'manager'/);
    assert.doesNotMatch(src, /role === 'staff'/);
  });
  test('saveTax()/resetTax()/saveCompanyExchangeRates()/saveInvoiceDefaults() all gate on canEditTaxSettings() before mutating TAX', () => {
    // Company Exchange Rates upgrade (2026-09-11): saveMvrSettings() split
    // into a dedicated rate-editing save (saveCompanyExchangeRates(),
    // async -- it awaits persistTaxSettings()) and a separate invoice-
    // default-mode save (saveInvoiceDefaults()), per Part K's "keep
    // government tax and commercial exchange rates conceptually separate".
    ['saveTax', 'resetTax', 'saveInvoiceDefaults'].forEach(fn => {
      const src = extractByStart(PMS, new RegExp('function ' + fn + '\\(\\)\\s*\\{'));
      assert.match(src, /canEditTaxSettings\(\)/, fn + '() must check canEditTaxSettings()');
    });
    const asyncSrc = extractByStart(PMS, /async function saveCompanyExchangeRates\(\)\s*\{/);
    assert.match(asyncSrc, /canEditTaxSettings\(\)/, 'saveCompanyExchangeRates() must check canEditTaxSettings()');
  });
  test('persistTaxSettings() writes one audit entry per CHANGED field only, diffed against the before-snapshot -- not a wall of unchanged-value noise', () => {
    // Company Exchange Rates upgrade (2026-09-11): now takes an optional
    // `skipFields` second argument (so saveCompanyExchangeRates() can
    // suppress the generic per-field entry for the two rate fields it
    // already logs its own richer audit for) -- the per-field diff itself
    // is unchanged.
    const src = extractByStart(PMS, /async function persistTaxSettings\(before, skipFields\)\s*\{/);
    assert.match(src, /if\(before\[field\] !== TAX\[field\]\) logTaxSettingsAudit/);
  });
}

section('Case D — settings-change effect scope: NEW invoices/bookings only, historical records untouched (Part I/Part W Case 7-8)');
{
  test('genInv() snapshots tgstRate/serviceChargeRate/greenTaxRateUsd/exchangeRate onto the invoice -- never re-reads TAX live on reopen', () => {
    // Company Exchange Rates upgrade (2026-09-11): the canonical field is
    // now `exchangeRate` (any non-USD currency, resolved via x.exchangeRate
    // -- already company-rate-or-override-resolved by calcTax()), not the
    // MVR-only `exchangeRateUsdMvr` -- that field is still written too,
    // purely for backward-compatible reading, never as the source of truth.
    const src = extractByStart(PMS, /function genInv\(\)\s*\{/);
    assert.match(src, /tgstRate:TAX\.tgst, serviceChargeRate:TAX\.svc, greenTaxRateUsd:TAX\.green/);
    assert.match(src, /exchangeRate:pricing\.currency!=='USD'\?x\.exchangeRate:null/);
    assert.match(src, /exchangeRateUsdMvr:pricing\.currency==='MVR'\?x\.exchangeRate:null/);
  });
  test('viewInv() renders a finalized invoice entirely from its own stored v.* fields -- it never calls calcTax()/calcTaxGeneral() again, so a later TAX/exchange-rate change can never alter an old invoice\'s total', () => {
    const src = extractByStart(PMS, /function viewInv\(id\)\s*\{/);
    assert.doesNotMatch(src, /calcTax\(/);
    assert.doesNotMatch(src, /calcTaxGeneral\(/);
    assert.match(src, /\$\{v\.total\.toFixed\(2\)\}/);
  });
  test('a NEW booking\'s currency defaults to the CURRENT TAX.usdDefaultPriceMode/mvrDefaultPriceMode at selection time (nbCurrencyChanged) -- an old reservation\'s own priceTaxMode, once set, is never touched by a later default-mode change', () => {
    const src = extractByStart(PMS, /function nbCurrencyChanged\(\)\s*\{/);
    assert.match(src, /TAX\.mvrDefaultPriceMode/);
    assert.match(src, /TAX\.usdDefaultPriceMode/);
    // submitNB() writes priceTaxMode from the form's current value ONCE, at creation -- never a live reference to TAX that could drift later
    const submitSrc = extractByStart(PMS, /async function submitNB\(\)\s*\{/);
    assert.match(submitSrc, /priceTaxMode:pricing\.priceTaxMode/);
  });
}

section('Case E — invoice data snapshot (Part P): enough to reproduce the invoice exactly, forever');
{
  const src = extractByStart(PMS, /function genInv\(\)\s*\{/);
  test('the invoice object stores currency, guestTaxStatus, priceTaxMode', () => {
    assert.match(src, /currency:pricing\.currency, guestTaxStatus:pricing\.guestTaxStatus, priceTaxMode:pricing\.priceTaxMode/);
  });
  test('the invoice object stores greenTaxUsd (the retained original statutory USD amount) and greenTaxExempt/greenTaxExemptReason', () => {
    assert.match(src, /greenTaxUsd:includeRoom\?x\.greenUsd:0, greenTaxExempt:x\.greenExempt, greenTaxExemptReason:x\.greenExemptReason\|\|null/);
  });
  test('the invoice object stores exchangeRateSnapshotAt alongside exchangeRateUsdMvr', () => {
    assert.match(src, /exchangeRateSnapshotAt:tS/);
  });
  test('the full TAX object is still also snapshotted onto v.tax (pre-existing pattern, unchanged) -- belt-and-suspenders historical fidelity', () => {
    assert.match(src, /tax:\{\.\.\.TAX\}/);
  });
}

section('Case F — printed invoice/receipt currency and tax-mode clarity (Part S)');
{
  test('viewInv() shows the currency and tax-included/excluded statement prominently, and Green Tax exemption reason when applicable', () => {
    const src = extractByStart(PMS, /function viewInv\(id\)\s*\{/);
    assert.match(src, /\$\{v\.currency\|\|'USD'\}/);
    assert.match(src, /Price includes service charge \+ TGST/);
    assert.match(src, /Exempt — /);
  });
  test('printReceipt() uses the SAME invoice currency, never a re-conversion or a different currency than what was actually paid', () => {
    const src = extractByStart(PMS, /function printReceipt\(invId\)\s*\{/);
    assert.match(src, /const rcs=curSym\(v\.currency\)/);
  });
  test('curSym() returns $ for USD (including undefined/legacy invoices), "MVR " for MVR, and (Company Exchange Rates upgrade, 2026-09-11) € for EUR', () => {
    const src = extractByStart(PMS, /function curSym\(currency\)\s*\{/);
    assert.match(src, /currency==='MVR'\s*\?\s*'MVR '\s*:\s*currency==='EUR'\s*\?\s*'€'\s*:\s*'\$'/);
  });
}

section('Case G — payment currency (Part T): payment stays in the invoice\'s own currency, no accidental cross-currency subtraction');
{
  test('recordInvoicePayment()\'s prompt explicitly states the invoice currency -- never ambiguous which currency a typed number means', () => {
    const src = extractByStart(PMS, /function recordInvoicePayment\(invId\)\s*\{/);
    assert.match(src, /Record payment amount in '\+\(v\.currency\|\|'USD'\)/);
  });
}

section('Case H — package/room-price/Beds24/Cloudbeds/OTA isolation (DO NOT TOUCH)');
{
  test('calcTaxGeneral()/calcTax() never functionally reference packages, room_prices, ota_room_type_overrides, or the Beds24 bridge/Cloudbeds', () => {
    // calcTax()'s own pre-existing comment mentions "Beds24-ingested
    // reservation" as context for the unrelated, already-established
    // r.channel_manager guard -- that's prose, not a functional coupling.
    // Strip comments before checking for an actual reference (a real
    // collection name, function call, or constant).
    [calcTaxGeneralSrc, calcTaxSrc].forEach(src => {
      const codeOnly = src.replace(/\/\/.*$/gm, '');
      assert.doesNotMatch(codeOnly, /\bpackages\b/);
      assert.doesNotMatch(codeOnly, /room_prices/);
      assert.doesNotMatch(codeOnly, /ota_room_type_overrides/);
      assert.doesNotMatch(codeOnly, /BEDS24_ROOM_MAP|beds24-bridge|Beds24Api/);
      assert.doesNotMatch(codeOnly, /[Cc]loudbeds/);
    });
  });
  test('tax_currency_settings/tax_settings_audit rules never reference packages, room_prices, Beds24, Cloudbeds, or any OTA collection', () => {
    const blocks = [ruleBlock(RULES, 'match /tax_currency_settings/{docId}'), ruleBlock(RULES, 'match /tax_settings_audit/{id}')];
    blocks.forEach(block => {
      assert.doesNotMatch(block, /packages/);
      assert.doesNotMatch(block, /room_prices/);
      assert.doesNotMatch(block, /[Bb]eds24/);
      assert.doesNotMatch(block, /ota_/);
    });
  });
  test('Fixed Price Catalog prices are never rewritten for an MVR invoice -- extras carry unitUsd (the untouched catalog price) alongside the converted display unit', () => {
    // Create Invoice live-preview task (2026-09-11): this mapping moved from
    // inline in genInv() into the shared calcInvoiceExtras() helper (now
    // also used by niPrev()'s live preview) -- genInv() still gets it via
    // that call, unchanged in substance.
    const genInvSrc = extractByStart(PMS, /function genInv\(\)\s*\{/);
    assert.match(genInvSrc, /calcInvoiceExtras\(invItems,\s*fx\)/);
    const extrasSrc = extractByStart(PMS, /function calcInvoiceExtras\(items, fx\)\s*\{/);
    assert.match(extrasSrc, /unitUsd:i\.unit/);
  });
}

console.log(`\n${passed}/${passed + failed} usd-mvr-billing assertions passed`);
if (failed) { console.log('\nFAILED'); process.exit(1); } else { console.log('\nALL TESTS PASSED'); }
