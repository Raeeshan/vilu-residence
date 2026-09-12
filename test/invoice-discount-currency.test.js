// Post-completion hardening, item 1 -- invoice fixed-discount currency bug.
//
// Root cause (confirmed by direct read of the source, not guesswork):
// invDiscountAmount() already subtracted the raw entered number directly
// from the invoice's own already-converted currency total (roomTotal+eT),
// NEVER re-converting it -- so the math was always "enter the discount in
// whatever currency this invoice is in." The actual bug was purely the
// input's own label, which read a hardcoded "$ Fixed" no matter what
// currency was selected, so a staff member on an MVR/EUR invoice would
// type a number believing it was USD and have it applied as MVR/EUR
// instead (a ~15x error on MVR, since 1 USD ~= 15.42 MVR).
//
// The fix (niDiscLabelRewrite(), wired into niCurrencyChanged()/openIM()/
// the disctype select's own onchange) only rewrites the label text and adds
// a hint -- invDiscountAmount()/genInv()/the saved invoice snapshot/reload/
// print path are UNCHANGED, since they were already currency-correct. This
// suite proves both halves: the label now matches the currency, and the
// underlying math (which never changed) is correct in every currency,
// including percentage discounts, capping, and rounding.
//
//   node test/invoice-discount-currency.test.js
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

const curSymSrc = extractByStart(PMS, /function curSym\(currency\)\s*\{/);
const invDiscountAmountSrc = extractByStart(PMS, /function invDiscountAmount\(roomTotal, eT\)\s*\{/);
const niDiscLabelRewriteSrc = extractByStart(PMS, /function niDiscLabelRewrite\(\)\s*\{/);

section('Structural: the label fix is actually wired up, math untouched');

test('niDiscLabelRewrite() exists and rewrites the fixed-option text via curSym(), never a hardcoded "$"', () => {
  assert.match(niDiscLabelRewriteSrc, /curSym\(currency\)/);
});

test('niCurrencyChanged() calls niDiscLabelRewrite() on every currency switch', () => {
  const src = extractByStart(PMS, /function niCurrencyChanged\(\)\s*\{/);
  assert.match(src, /niDiscLabelRewrite\(\)/);
});

test('the discount-type select itself re-renders the label when switched between Fixed/Percentage', () => {
  assert.match(PMS, /id="ni-disctype"\s+onchange="niDiscLabelRewrite\(\);niPrev\(\)"/);
});

test('openIM() (invoice builder open) rewrites the label for a fresh invoice, not just on later currency changes', () => {
  const src = extractByStart(PMS, /function openIM\(resId, opts\)\s*\{/);
  assert.match(src, /niDiscLabelRewrite\(\)/);
});

test('invDiscountAmount() itself was NOT touched by this fix: it still reads the raw ni-disc value with zero currency conversion', () => {
  assert.doesNotMatch(invDiscountAmountSrc, /fx|exchangeRate|companyExchangeRate/);
});

test('genInv() still stores discType/discValue/disc/currency on the saved invoice snapshot (pre-existing, unchanged by this fix)', () => {
  const src = extractByStart(PMS, /function genInv\(\)\s*\{/);
  assert.match(src, /discType:d\.type,\s*discValue:d\.value/);
  assert.match(src, /currency:pricing\.currency/);
});

test('the printed/reopened invoice view prints the discount using the SAME currency symbol (ivCs) as everything else on that invoice -- never a hardcoded "$"', () => {
  const detIdx = PMS.indexOf('const ivCs');
  assert.ok(detIdx > -1, 'expected an ivCs derivation near the invoice detail view');
  // The invoice detail template embeds a large base64 logo image between
  // ivCs's own declaration and the discount row further down -- a wide
  // slice is needed to actually reach it.
  const nearby = PMS.slice(detIdx, detIdx + 20000);
  assert.match(nearby, /Invoice discount[\s\S]*?-\$\{ivCs\}\$\{\(\+v\.disc/);
});

test('percentage-discount behavior is untouched by this task (still base*discval/100, never converted/relabeled)', () => {
  assert.match(invDiscountAmountSrc, /disctype==='percent'\?base\*discval\/100:discval/);
});

section('Functional: niDiscLabelRewrite() actually shows the right currency label');

function makeLabelSandbox(currency, disctype) {
  const state = {
    'ni-disctype-fixed-opt': { textContent: '$ Fixed' },
    'ni-disc-hint': { textContent: '' },
    'ni-currency': { value: currency },
    'ni-disctype': { value: disctype || 'fixed' },
  };
  const sandbox = {
    document: { getElementById: (id) => state[id] || null },
  };
  vm.createContext(sandbox);
  vm.runInContext([curSymSrc, niDiscLabelRewriteSrc].join('\n'), sandbox);
  return { sandbox, state };
}

test('USD invoice -> Fixed option reads "$ Fixed"', () => {
  const { sandbox, state } = makeLabelSandbox('USD');
  vm.runInContext('niDiscLabelRewrite()', sandbox);
  assert.equal(state['ni-disctype-fixed-opt'].textContent, '$ Fixed');
  assert.match(state['ni-disc-hint'].textContent, /USD/);
});

test('MVR invoice -> Fixed option reads "MVR Fixed", never "$ Fixed"', () => {
  const { sandbox, state } = makeLabelSandbox('MVR');
  vm.runInContext('niDiscLabelRewrite()', sandbox);
  assert.equal(state['ni-disctype-fixed-opt'].textContent, 'MVR Fixed');
  assert.match(state['ni-disc-hint'].textContent, /MVR/);
});

test('EUR invoice -> Fixed option reads "€ Fixed"', () => {
  const { sandbox, state } = makeLabelSandbox('EUR');
  vm.runInContext('niDiscLabelRewrite()', sandbox);
  assert.equal(state['ni-disctype-fixed-opt'].textContent, '€ Fixed');
});

test('percentage mode shows no "entered in <currency>" hint (nothing to disambiguate for a %)', () => {
  const { sandbox, state } = makeLabelSandbox('MVR', 'percent');
  vm.runInContext('niDiscLabelRewrite()', sandbox);
  assert.equal(state['ni-disc-hint'].textContent, '');
});

section('Functional: invDiscountAmount() math is correct in every currency (already-correct behavior, now correctly labeled)');

function makeDiscSandbox(discType, discVal) {
  const sandbox = {
    document: {
      getElementById(id) {
        if (id === 'ni-disctype') return { value: discType };
        if (id === 'ni-disc') return { value: discVal };
        return null;
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(invDiscountAmountSrc, sandbox);
  return sandbox;
}

test('USD invoice, fixed discount 20 on a $150 base -> exactly $20 off (never re-converted)', () => {
  const sb = makeDiscSandbox('fixed', '20');
  const r = vm.runInContext('invDiscountAmount(100, 50)', sb); // base = 150
  assert.equal(r.amount, 20);
  assert.equal(r.capped, false);
});

test('EUR invoice, fixed discount 20 on a €150 base -> exactly €20 off (same raw-subtraction math, now correctly labeled "€ Fixed")', () => {
  const sb = makeDiscSandbox('fixed', '20');
  const r = vm.runInContext('invDiscountAmount(100, 50)', sb);
  assert.equal(r.amount, 20, 'the number entered while EUR is selected must come off as 20 EUR, not a USD-converted figure');
});

test('MVR invoice, fixed discount 308 on a MVR 1542 base -> exactly MVR 308 off (this is the exact scenario the audit flagged: staff must be able to type the real MVR amount and have it applied literally)', () => {
  const sb = makeDiscSandbox('fixed', '308');
  const r = vm.runInContext('invDiscountAmount(1000, 542)', sb); // base = 1542
  assert.equal(r.amount, 308);
  assert.equal(r.capped, false);
});

test('fixed discount cannot exceed the invoice subtotal -- capped, never negative total, `capped` flag set', () => {
  const sb = makeDiscSandbox('fixed', '999999');
  const r = vm.runInContext('invDiscountAmount(50, 20)', sb); // base = 70
  assert.equal(r.amount, 70);
  assert.equal(r.capped, true);
});

test('percentage discount: 25% of a $200 base -> $50 off, in ANY currency (percent is currency-agnostic by design, untouched by this fix)', () => {
  const sb = makeDiscSandbox('percent', '25');
  const r = vm.runInContext('invDiscountAmount(150, 50)', sb); // base = 200
  assert.equal(r.amount, 50);
  assert.equal(r.capped, false);
});

test('percentage over 100 is capped at the full base, `capped` flag set', () => {
  const sb = makeDiscSandbox('percent', '150');
  const r = vm.runInContext('invDiscountAmount(100, 0)', sb);
  assert.equal(r.amount, 100);
  assert.equal(r.capped, true);
});

test('rounding: fixed discount with a fractional base rounds to 2dp, matching the printed invoice', () => {
  const sb = makeDiscSandbox('fixed', '33.335');
  const r = vm.runInContext('invDiscountAmount(100, 0)', sb);
  assert.equal(r.amount, 33.34);
});

test('switching currency before saving: the same raw ni-disc value is reinterpreted under the NEW currency, never silently converted from the old one', () => {
  // Staff types "40" while MVR is selected (intending 40 MVR), then
  // switches to EUR before finalizing -- invDiscountAmount() has no memory
  // of "was MVR a moment ago"; it always applies the CURRENT raw number to
  // the CURRENT (already-converted) base, exactly like every other field
  // in this invoice builder. This is intentional: the value only ever
  // means "N units of whatever currency is selected right now."
  const sb = makeDiscSandbox('fixed', '40');
  const mvrBase = vm.runInContext('invDiscountAmount(1000, 542)', sb); // pretend base was MVR
  const eurBase = vm.runInContext('invDiscountAmount(60, 30)', sb); // now EUR, base=90
  assert.equal(mvrBase.amount, 40);
  assert.equal(eurBase.amount, 40, 'same raw value, now applied as 40 EUR against the EUR base -- no stale conversion carried over');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
