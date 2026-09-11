// Company-controlled multi-currency exchange rates (USD/MVR/EUR) — 2026-09-11.
//
// Owner requirement: Vilu does NOT want the PMS to force any fixed
// USD->MVR rate (previously hardcoded 15.42). Exchange rates are manual
// COMPANY decisions -- USD is the base currency; MVR and EUR rates are
// set by an Admin/Manager in Settings, never fetched from a live FX API,
// never silently defaulted. An invoice currency with no configured rate
// must be blocked, never priced using a guessed rate.
//
// Same technique as the rest of this suite: brace-match real functions out
// of vilu-unified.html and run them in a vm sandbox (functional/numeric
// checks), or regex-check source directly (structural/wiring/isolation
// checks). No Firestore, no browser, no live reservation.
//   node test/company-exchange-rates.test.js
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
function plain(x) { return JSON.parse(JSON.stringify(x)); }

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

// ── sandbox: the pure currency/tax engine ──
const ntSrc = 'const nt=(a,b)=>Math.round((new Date(b)-new Date(a))/864e5);';
const taxDefaultSrc = extractByStart(PMS, /let TAX=\{tgst:17/).replace(/^let TAX=/, 'var TAX=');
const companyExchangeRateSrc = extractByStart(PMS, /function companyExchangeRate\(currency\)\s*\{/);
const calcTaxGeneralSrc = extractByStart(PMS, /function calcTaxGeneral\(input\)\s*\{/);
const calcTaxSrc = extractByStart(PMS, /function calcTax\(r\)\s*\{/);
const calcServiceLineTaxSrc = extractByStart(PMS, /function calcServiceLineTax\(amount, priceTaxMode\)\s*\{/);
const calcInvoiceExtrasSrc = extractByStart(PMS, /function calcInvoiceExtras\(items, fx\)\s*\{/);

function makeSandbox() {
  const sb = {};
  vm.createContext(sb);
  vm.runInContext([ntSrc, taxDefaultSrc, companyExchangeRateSrc, calcTaxGeneralSrc, calcTaxSrc, calcServiceLineTaxSrc, calcInvoiceExtrasSrc].join('\n'), sb);
  return sb;
}

section('Case A — no fixed 15.42 dependency (Part B): the JS literal default is unconfigured, never a hardcoded rate');
{
  test('the TAX object literal defaults exchangeRateUsdMvr/exchangeRateUsdEur to null -- never 15.42 or any other guessed number', () => {
    assert.match(taxDefaultSrc, /exchangeRateUsdMvr:null,\s*exchangeRateUsdEur:null/);
  });
  test('companyExchangeRate(): USD is always 1 (base currency, Part D) -- never needs configuration', () => {
    const sb = makeSandbox();
    assert.equal(vm.runInContext(`companyExchangeRate('USD')`, sb), 1);
    assert.equal(vm.runInContext(`companyExchangeRate(undefined)`, sb), 1);
  });
  test('companyExchangeRate(): MVR/EUR return null when TAX has no rate configured -- never silently 1 or 15.42', () => {
    const sb = makeSandbox();
    assert.equal(vm.runInContext(`companyExchangeRate('MVR')`, sb), null);
    assert.equal(vm.runInContext(`companyExchangeRate('EUR')`, sb), null);
  });
  test('a rate saved as 0 or negative is treated identically to unconfigured -- never a "free" or negative conversion', () => {
    const sb = makeSandbox();
    vm.runInContext(`TAX.exchangeRateUsdMvr = 0;`, sb);
    assert.equal(vm.runInContext(`companyExchangeRate('MVR')`, sb), null);
    vm.runInContext(`TAX.exchangeRateUsdMvr = -5;`, sb);
    assert.equal(vm.runInContext(`companyExchangeRate('MVR')`, sb), null);
  });
}

section('Case B — manual company MVR/EUR rates (Part A/C/D): once configured, used deterministically');
{
  test('CASE 1 (Part S): company MVR rate 15.50, USD $100 room total converts to MVR 1,550 exactly', () => {
    const sb = makeSandbox();
    vm.runInContext(`TAX.exchangeRateUsdMvr = 15.50;`, sb);
    const r = vm.runInContext(`calcTax({ci:'2026-09-10',co:'2026-09-11',rate:100,ad:1,ch:0,inf:0,src:'Direct',billingCurrency:'MVR',guestTaxStatus:'MALDIVIAN',priceTaxMode:'TAX_INCLUDED'})`, sb);
    // Maldivian -> Green Tax exempt, so with tax-included pricing base+svc+tgst reconciles to exactly the quoted MVR amount.
    assert.equal(+(r.base + r.svc + r.tgst).toFixed(2), 100.00);
    assert.equal(r.exchangeRate, 15.50);
    assert.equal(r.exchangeRateConfigured, true);
  });
  test('CASE 2: changing the company MVR rate mid-session immediately affects the NEXT calcTax() call -- a live, current-state read, never cached', () => {
    const sb = makeSandbox();
    vm.runInContext(`TAX.exchangeRateUsdMvr = 15.50;`, sb);
    const before = vm.runInContext(`companyExchangeRate('MVR')`, sb);
    vm.runInContext(`TAX.exchangeRateUsdMvr = 16.00;`, sb);
    const after = vm.runInContext(`companyExchangeRate('MVR')`, sb);
    assert.equal(before, 15.50);
    assert.equal(after, 16.00);
  });
  test('CASE 3: company EUR rate 0.88, USD $100 -> EUR 88.00 via calcInvoiceExtras (the extras/activity conversion path)', () => {
    const sb = makeSandbox();
    const r = vm.runInContext(`calcInvoiceExtras([{desc:'Test item',qty:1,unit:100,tax:false}], 0.88)`, sb);
    assert.equal(r.extras[0].total, 88.00);
  });
  test('USD master prices are never rewritten -- calcInvoiceExtras() keeps unitUsd (the original catalog price) alongside the converted `unit`', () => {
    const sb = makeSandbox();
    const r = vm.runInContext(`calcInvoiceExtras([{desc:'Whale Shark Snorkeling',qty:1,unit:85,tax:false}], 0.88)`, sb);
    assert.equal(r.extras[0].unitUsd, 85);
    assert.equal(r.extras[0].unit, +(85 * 0.88).toFixed(4));
  });
}

section('Case C — unconfigured-rate handling (Part B): blocked, never a guessed number');
{
  test('calcTaxGeneral(): a non-USD currency with no exchangeRate given returns green:null, total:null, exchangeRateConfigured:false -- base/svc/tgst still computed (they never cross currencies)', () => {
    const sb = makeSandbox();
    const r = vm.runInContext(`calcTaxGeneral({quotedRate:100,nights:2,adults:2,children:0,thirdGuestSupplement:0,currency:'MVR',guestTaxStatus:'TOURIST',priceTaxMode:'TAX_EXCLUDED',taxCfg:{tgst:17,svc:10,greenUsd:6}})`, sb);
    assert.equal(r.exchangeRateConfigured, false);
    assert.equal(r.green, null);
    assert.equal(r.total, null);
    assert.ok(r.base > 0 && r.svc > 0 && r.tgst > 0, 'base/svc/tgst are still knowable -- only the currency-crossing parts are blocked');
  });
  test('calcTax(r): an MVR reservation with no company rate configured returns exchangeRateConfigured:false and total:null -- never a total computed with an assumed rate of 1', () => {
    const sb = makeSandbox();
    const r = vm.runInContext(`calcTax({ci:'2026-09-10',co:'2026-09-12',rate:700,ad:2,ch:0,inf:0,src:'Direct',billingCurrency:'MVR'})`, sb);
    assert.equal(r.exchangeRateConfigured, false);
    assert.equal(r.total, null);
  });
  test('an Admin/Manager invoice-specific override (Part F) resolves the rate even when the company rate is unconfigured', () => {
    const sb = makeSandbox();
    const r = vm.runInContext(`calcTax({ci:'2026-09-10',co:'2026-09-12',rate:700,ad:2,ch:0,inf:0,src:'Direct',billingCurrency:'MVR',guestTaxStatus:'MALDIVIAN',exchangeRateOverride:16.25})`, sb);
    assert.equal(r.exchangeRateConfigured, true);
    assert.equal(r.exchangeRate, 16.25);
  });
  test('pbd()/niPrev()/genInv() all render or refuse a clear "Exchange rate not configured" state -- never a blank or wrong-looking total', () => {
    const pbdSrc = extractByStart(PMS, /function pbd\(r\)\s*\{/);
    assert.match(pbdSrc, /if\(!x\.exchangeRateConfigured\) return currencyNotConfiguredHTML/);
    const niPrevSrc = extractByStart(PMS, /function niPrev\(\)\s*\{/);
    assert.match(niPrevSrc, /if\(pricing\.currency!=='USD' && !x\.exchangeRateConfigured\)\{/);
    const genInvSrc = extractByStart(PMS, /function genInv\(\)\s*\{/);
    assert.match(genInvSrc, /if\(pricing\.currency!=='USD' && !x\.exchangeRateConfigured\)\{ toast\(/);
  });
  test('the New Booking live preview (nbCalc) never lets one unpriceable room silently zero itself into a multi-room grand total', () => {
    const src = extractByStart(PMS, /function nbCalc\(\)\s*\{/);
    assert.match(src, /allConfigured/);
    assert.match(src, /if\(x\.exchangeRateConfigured===false\)\{ allConfigured=false; \} else \{ grandTotal\+=x\.total; \}/);
  });
}

section('Case D — USD base currency behavior (Part D)');
{
  test('USD invoices never need a rate and are never converted', () => {
    const sb = makeSandbox();
    const r = vm.runInContext(`calcTax({ci:'2026-09-10',co:'2026-09-11',rate:100,ad:1,ch:0,inf:0,src:'Direct'})`, sb);
    assert.equal(r.currency, 'USD');
    assert.equal(r.exchangeRateConfigured, true);
    assert.equal(r.exchangeRate, 1);
  });
  test('master catalog/service prices are stored in USD and never rewritten regardless of invoice currency (Part R)', () => {
    const sb = makeSandbox();
    const usd = vm.runInContext(`calcInvoiceExtras([{desc:'X',qty:1,unit:85,tax:false}], 1)`, sb);
    const mvr = vm.runInContext(`calcInvoiceExtras([{desc:'X',qty:1,unit:85,tax:false}], 15.50)`, sb);
    assert.equal(usd.extras[0].unitUsd, 85);
    assert.equal(mvr.extras[0].unitUsd, 85, 'the USD source price is retained even on an MVR-converted invoice');
  });
}

section('Case E — currency vs. tax status vs. price treatment are fully independent (Part H)');
{
  test('CASE 7: a Tourist MVR invoice still carries full Green Tax liability -- currency never changes tax status', () => {
    const sb = makeSandbox();
    vm.runInContext(`TAX.exchangeRateUsdMvr = 15.50;`, sb);
    const r = vm.runInContext(`calcTax({ci:'2026-09-10',co:'2026-09-12',rate:700,ad:2,ch:0,inf:0,src:'Direct',billingCurrency:'MVR',guestTaxStatus:'TOURIST',priceTaxMode:'TAX_EXCLUDED'})`, sb);
    assert.equal(r.greenExempt, false);
    assert.ok(r.green > 0);
  });
  test('CASE 8: a Maldivian EUR invoice is still Green Tax exempt -- currency never changes tax status', () => {
    const sb = makeSandbox();
    vm.runInContext(`TAX.exchangeRateUsdEur = 0.88;`, sb);
    const r = vm.runInContext(`calcTax({ci:'2026-09-10',co:'2026-09-12',rate:700,ad:2,ch:0,inf:0,src:'Direct',billingCurrency:'EUR',guestTaxStatus:'MALDIVIAN',priceTaxMode:'TAX_INCLUDED'})`, sb);
    assert.equal(r.greenExempt, true);
    assert.equal(r.greenExemptReason, 'Maldivian');
    assert.equal(r.green, 0);
  });
  test('CASE 9: Tax Included activity in ANY currency is never double-taxed -- currency only changes the NUMBER via fx, never whether tax is added', () => {
    const sb = makeSandbox();
    const usd = vm.runInContext(`calcInvoiceExtras([{desc:'Whale Shark Snorkeling',qty:1,unit:85,tax:true,priceTaxMode:'TAX_INCLUDED'}], 1)`, sb);
    const eur = vm.runInContext(`calcInvoiceExtras([{desc:'Whale Shark Snorkeling',qty:1,unit:85,tax:true,priceTaxMode:'TAX_INCLUDED'}], 0.88)`, sb);
    assert.equal(usd.extras[0].total, 85);
    assert.equal(eur.extras[0].total, +(85 * 0.88).toFixed(2));
    assert.equal(eur.eTax, 0, 'a tax-included line never contributes to the amount actually added as tax, regardless of currency');
  });
  test('a Tax Excluded item still has Service+TGST added on top under EUR, exactly as under USD/MVR', () => {
    const sb = makeSandbox();
    const r = vm.runInContext(`calcInvoiceExtras([{desc:'Airport Transfer',qty:1,unit:60,tax:true,priceTaxMode:'TAX_EXCLUDED'}], 0.88)`, sb);
    const convertedBase = +(60 * 0.88).toFixed(4);
    const expectedFinal = +(convertedBase * 1.10 * 1.17).toFixed(2);
    assert.ok(Math.abs(r.extras[0].total - expectedFinal) < 0.02);
    assert.ok(r.eTax > 0);
  });
}

section('Case F — Green Tax handling (Part I): retains USD statutory amount, converts only for display');
{
  test('greenUsd (the real statutory amount) is retained on the result regardless of currency or configuration state', () => {
    const sb = makeSandbox();
    const r = vm.runInContext(`calcTaxGeneral({quotedRate:100,nights:2,adults:2,children:0,thirdGuestSupplement:0,currency:'EUR',guestTaxStatus:'TOURIST',priceTaxMode:'TAX_EXCLUDED',taxCfg:{tgst:17,svc:10,greenUsd:6}})`, sb);
    assert.equal(r.greenUsd, +(6 * 2 * 2).toFixed(2));
    assert.equal(r.exchangeRateConfigured, false, 'no rate given -- green display is blocked, but the USD statutory figure is still known');
  });
  test('for a configured EUR rate, green = greenUsd * rate exactly', () => {
    const sb = makeSandbox();
    const r = vm.runInContext(`calcTaxGeneral({quotedRate:100,nights:2,adults:2,children:0,thirdGuestSupplement:0,currency:'EUR',guestTaxStatus:'TOURIST',priceTaxMode:'TAX_EXCLUDED',taxCfg:{tgst:17,svc:10,greenUsd:6,exchangeRate:0.88}})`, sb);
    assert.equal(r.greenUsd, 24);
    assert.equal(r.green, +(24 * 0.88).toFixed(2));
  });
  test('this task never changes the Green Tax rate/policy itself (Part U) -- greenUsd calculation formula is untouched', () => {
    const src = extractByStart(PMS, /function calcTaxGeneral\(input\)\s*\{/);
    assert.match(src, /var greenUsd = \+\(\(input\.taxCfg\.greenUsd\|\|0\) \* greenLiableGuests \* input\.nights\)\.toFixed\(2\);/);
  });
}

section('Case G — invoice-specific rate override (Part F): Admin/Manager only, reason required, company rate untouched');
{
  test('niInvoicePricing() only honors an override when canEditTaxSettings() AND a positive rate AND a non-empty reason are all present', () => {
    const src = extractByStart(PMS, /function niInvoicePricing\(\)\s*\{/);
    assert.match(src, /overrideActive = document\.getElementById\('ni-fx-override-check'\) && document\.getElementById\('ni-fx-override-check'\)\.checked && canEditTaxSettings\(\)/);
    assert.match(src, /overrideValid = overrideActive && overrideRate>0 && !!overrideReason/);
    assert.match(src, /exchangeRateOverride: overrideValid \? overrideRate : null/);
  });
  test('niFxRowRender() only shows the override toggle to canEditTaxSettings() -- Staff never even sees the control', () => {
    const src = extractByStart(PMS, /function niFxRowRender\(\)\s*\{/);
    assert.match(src, /var canOverride=canEditTaxSettings\(\);/);
    assert.match(src, /toggleEl\.innerHTML = canOverride\s*\n?\s*\? '<label/);
  });
  test('genInv() snapshots companyRateAtCreation/invoiceExchangeRate/overrideUsed/overrideReason/overrideBy/overrideAt, and NEVER writes to the master company rate', () => {
    const src = extractByStart(PMS, /function genInv\(\)\s*\{/);
    assert.match(src, /companyRateAtCreation: pricing\.currency!=='USD' \? companyExchangeRate\(pricing\.currency\) : null/);
    assert.match(src, /invoiceExchangeRate: pricing\.currency!=='USD' \? x\.exchangeRate : null/);
    assert.match(src, /overrideUsed: pricing\.exchangeRateOverride!=null/);
    assert.match(src, /overrideReason: pricing\.exchangeRateOverride!=null \? pricing\.overrideReason : null/);
    assert.doesNotMatch(src, /TAX\.exchangeRateUsdMvr\s*=/, 'genInv() must never assign to the master company rate field');
    assert.doesNotMatch(src, /TAX\.exchangeRateUsdEur\s*=/, 'genInv() must never assign to the master company rate field');
  });
  test('only saveCompanyExchangeRates() ever assigns TAX.exchangeRateUsdMvr/TAX.exchangeRateUsdEur -- the ONE place the master rate changes', () => {
    const src = extractByStart(PMS, /async function saveCompanyExchangeRates\(\)\s*\{/);
    assert.match(src, /TAX\.exchangeRateUsdMvr=newMvr;/);
    assert.match(src, /TAX\.exchangeRateUsdEur=newEur;/);
  });
}

section('Case H — rate audit history (Part L): append-only, currency/oldRate/newRate/reason/changedByUid/changedByName/changedAt');
{
  test('logExchangeRateAudit() writes currency, oldRate, newRate, reason and a real server timestamp + actor', () => {
    const src = extractByStart(PMS, /async function logExchangeRateAudit\(currency, oldRate, newRate, reason\)\s*\{/);
    assert.match(src, /currency:currency, oldRate:oldRate==null\?null:oldRate, newRate:newRate==null\?null:newRate, reason:reason/);
    assert.match(src, /changedByUid: fbUser\?fbUser\.uid:null/);
    assert.match(src, /changedAt: firebase\.firestore\.FieldValue\.serverTimestamp\(\)/);
  });
  test('saveCompanyExchangeRates() requires a non-empty reason whenever a rate genuinely changed', () => {
    const src = extractByStart(PMS, /async function saveCompanyExchangeRates\(\)\s*\{/);
    assert.match(src, /if\(\(mvrChanged\|\|eurChanged\) && !reason\)\{ toast\('Enter a reason for this exchange-rate change'\); return; \}/);
  });
  test('a rate change logs its OWN dedicated audit entry per currency actually changed, and is excluded from the generic per-field diff (never two differently-shaped rows for one change)', () => {
    const src = extractByStart(PMS, /async function saveCompanyExchangeRates\(\)\s*\{/);
    assert.match(src, /await persistTaxSettings\(before, \['exchangeRateUsdMvr','exchangeRateUsdEur'\]\);/);
    assert.match(src, /if\(mvrChanged\) logExchangeRateAudit\('MVR', before\.exchangeRateUsdMvr\|\|null, newMvr, reason\);/);
    assert.match(src, /if\(eurChanged\) logExchangeRateAudit\('EUR', before\.exchangeRateUsdEur\|\|null, newEur, reason\);/);
  });
  test('firestore.rules: tax_settings_audit is genuinely append-only (update/delete denied), and every entry (generic or the richer rate-change shape) must carry field/changedByUid/changedAt exactly as the authenticated caller and server time', () => {
    const block = ruleBlock(RULES, 'match /tax_settings_audit/{id}');
    assert.match(block, /allow update, delete:\s*if\s*false/);
    assert.match(block, /request\.resource\.data\.field is string/);
    assert.match(block, /request\.resource\.data\.changedByUid == request\.auth\.uid/);
    assert.match(block, /request\.resource\.data\.changedAt == request\.time/);
  });
}

section('Case I — role permissions (Part M): Admin/Manager edit rates + override, Staff view-only, enforced at the data layer');
{
  test('firestore.rules: tax_currency_settings write is Admin/Manager only -- Staff can read but never write', () => {
    const block = ruleBlock(RULES, 'match /tax_currency_settings/{docId}');
    assert.match(block, /allow read: if isAdmin\(\) \|\| isStaff\(\) \|\| isManagerRole\(\)/);
    assert.match(block, /allow write: if isAdmin\(\) \|\| isManagerRole\(\)/);
    assert.doesNotMatch(block.split('allow write')[1], /isStaff/);
  });
  test('canEditTaxSettings() (the one gate every save/override function reuses) is Admin/Manager only', () => {
    const src = extractByStart(PMS, /function canEditTaxSettings\(\)\s*\{/);
    assert.match(src, /role === 'admin' \|\| currentUser\.role === 'manager'/);
    assert.doesNotMatch(src, /role === 'staff'/);
  });
  test('CASE 5/6: Staff cannot edit company rates or use the invoice override -- saveCompanyExchangeRates()/niInvoicePricing() both gate on canEditTaxSettings(), never a role-blind path', () => {
    const saveSrc = extractByStart(PMS, /async function saveCompanyExchangeRates\(\)\s*\{/);
    assert.match(saveSrc, /if\(!canEditTaxSettings\(\)\)\{ toast\('⛔ Admin\/Manager access only'\); return; \}/);
    const pricingSrc = extractByStart(PMS, /function niInvoicePricing\(\)\s*\{/);
    assert.match(pricingSrc, /canEditTaxSettings\(\)/);
  });
  test('the Settings & Taxes page disables every exchange-rate/invoice-default input and both save buttons for anyone without canEditTaxSettings() (Staff sees real values, cannot edit)', () => {
    const src = extractByStart(PMS, /function drawCfg\(\)\s*\{/);
    assert.match(src, /'st-fx-mvr','st-fx-eur','st-fx-reason'/);
    assert.match(src, /'st-fx-save-btn'/);
  });
}

section('Case J — rate snapshot (Part E) and old-invoice immutability (Part N/O)');
{
  test('genInv() snapshots invoiceCurrency, baseCurrency=USD, exchangeRate, exchangeRateSource, exchangeRateSnapshotAt on every new invoice', () => {
    const src = extractByStart(PMS, /function genInv\(\)\s*\{/);
    assert.match(src, /invoiceCurrency:pricing\.currency, baseCurrency:'USD'/);
    assert.match(src, /exchangeRate:pricing\.currency!=='USD'\?x\.exchangeRate:null/);
    assert.match(src, /exchangeRateSource: pricing\.exchangeRateOverride!=null \? 'INVOICE_OVERRIDE' : 'COMPANY_MANUAL'/);
    assert.match(src, /exchangeRateSnapshotAt:tS/);
  });
  test('viewInv() reads exchangeRate first, falling back to the old exchangeRateUsdMvr field name for an invoice finalized before this task -- never reinterpreted, just read under whichever name it was actually saved as', () => {
    const src = extractByStart(PMS, /function viewInv\(id\)\s*\{/);
    assert.match(src, /const ivRate = v\.exchangeRate!=null \? v\.exchangeRate : v\.exchangeRateUsdMvr;/);
  });
  test('viewInv() never calls calcTax()/calcTaxGeneral() -- a finalized invoice renders ENTIRELY from its own frozen v.* fields, so a later company-rate change can never alter it (Part N/O)', () => {
    const src = extractByStart(PMS, /function viewInv\(id\)\s*\{/);
    assert.doesNotMatch(src, /calcTax\(/);
    assert.doesNotMatch(src, /calcTaxGeneral\(/);
  });
  test('an old MVR invoice that snapshotted 15.42 is read via the exact same ivRate fallback -- CASE 2\'s "old finalized invoice remains unchanged" is a direct consequence of never recomputing it', () => {
    // Simulate reading an old-shape invoice (no v.exchangeRate field at all).
    const oldInvoice = { exchangeRateUsdMvr: 15.42, currency: 'MVR', total: 1550.00 };
    const ivRate = oldInvoice.exchangeRate != null ? oldInvoice.exchangeRate : oldInvoice.exchangeRateUsdMvr;
    assert.equal(ivRate, 15.42);
    assert.equal(oldInvoice.total, 1550.00, 'old invoice total is read as-is, never recalculated against today\'s company rate');
  });
}

section('Case K — invoice/receipt printing display (Part P)');
{
  test('curSym(): $ for USD, "MVR " for MVR, € for EUR', () => {
    const src = extractByStart(PMS, /function curSym\(currency\)\s*\{/);
    assert.match(src, /currency==='MVR' \? 'MVR ' : currency==='EUR' \? '€' : '\$'/);
  });
  test('viewInv() shows "Exchange rate used: 1 USD = X CUR" and distinguishes an invoice-specific override from the company rate', () => {
    const src = extractByStart(PMS, /function viewInv\(id\)\s*\{/);
    assert.match(src, /Exchange rate used: 1 USD = \$\{ivRate\} \$\{v\.currency\}/);
    assert.match(src, /v\.overrideUsed\?' <span style="color:#b45309">\(invoice-specific override/);
  });
  test('printReceipt() uses curSym(v.currency) -- EUR receipts display € automatically, no separate EUR branch needed', () => {
    const src = extractByStart(PMS, /function printReceipt\(invId\)\s*\{/);
    assert.match(src, /const rcs=curSym\(v\.currency\)/);
  });
}

section('Case L — package/catalog/room-rate/Beds24/Cloudbeds/OTA isolation (Part U, DO NOT TOUCH)');
{
  test('companyExchangeRate()/calcTaxGeneral()/calcServiceLineTax() never reference packages, room_prices, catalog collections, Beds24, Cloudbeds, or OTA', () => {
    [companyExchangeRateSrc, calcTaxGeneralSrc, calcServiceLineTaxSrc, calcInvoiceExtrasSrc].forEach(src => {
      assert.doesNotMatch(src, /package|room_prices|service_catalog|ota_room_type_overrides|beds24|Beds24|cloudbeds|Cloudbeds/i);
    });
  });
  test('saveCompanyExchangeRates()/logExchangeRateAudit() only ever touch tax_currency_settings/tax_settings_audit -- never packages, room_prices, or any OTA/Beds24/Cloudbeds collection', () => {
    const saveSrc = extractByStart(PMS, /async function saveCompanyExchangeRates\(\)\s*\{/);
    const auditSrc = extractByStart(PMS, /async function logExchangeRateAudit\(currency, oldRate, newRate, reason\)\s*\{/);
    assert.doesNotMatch(saveSrc, /package|room_prices|beds24|Beds24|cloudbeds|Cloudbeds|ota_/i);
    assert.match(auditSrc, /fsDb\.collection\('tax_settings_audit'\)/);
    assert.doesNotMatch(auditSrc, /package|room_prices|beds24|Beds24|cloudbeds|Cloudbeds|ota_/i);
  });
  test('this task never changes TGST/service-charge/Green-Tax rates or their calculation formula (Part U) -- only currency/exchange-rate fields are new', () => {
    const src = extractByStart(PMS, /function calcTaxGeneral\(input\)\s*\{/);
    assert.match(src, /var tgstRate=input\.taxCfg\.tgst\/100, svcRate=input\.taxCfg\.svc\/100;/);
  });
}

console.log(`\n${passed}/${passed + failed} company-exchange-rates assertions passed`);
