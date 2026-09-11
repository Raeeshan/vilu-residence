// Create Invoice — real-time live calculator — 2026-09-11.
//
// Task: every billing-relevant control in the Create Invoice modal (m-inv)
// must recompute the visible Price Breakdown BEFORE finalization, using the
// SAME canonical engine Finalize itself uses (calcTax/calcTaxGeneral, plus
// the new calcInvoiceExtras() this task extracted so niPrev() and genInv()
// can never diverge). Finalize only snapshots what was already on screen.
//
// Two techniques, same as the rest of this suite:
//   (1) structural/regex checks on the real PMS source -- every enumerated
//       control actually wires to niPrev() (or the canonical extras/total
//       math), and no preview-triggering path writes to Firestore/RES/INV.
//   (2) functional checks -- calcInvoiceExtras() and invDiscountAmount()'s
//       capping, brace-matched out of vilu-unified.html and run in a vm
//       sandbox against real numbers, including a case engineered to prove
//       the OLD "sum first, round once" formula would have landed a cent
//       away from the NEW "round per line, then sum" formula.
//   node test/create-invoice-live-preview.test.js
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
function plain(x) { return JSON.parse(JSON.stringify(x)); } // cross-realm vm-sandbox objects fail deepEqual's prototype check

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

// ── sandbox: calcInvoiceExtras() + invDiscountAmount(), real bodies ──
const taxDefaultSrc = extractByStart(PMS, /let TAX=\{tgst:17/).replace(/^let TAX=/, 'var TAX=');
const calcServiceLineTaxSrc = extractByStart(PMS, /function calcServiceLineTax\(amount, priceTaxMode\)\s*\{/);
const calcInvoiceExtrasSrc = extractByStart(PMS, /function calcInvoiceExtras\(items, fx\)\s*\{/);
const invDiscountAmountSrc = extractByStart(PMS, /function invDiscountAmount\(roomTotal, eT\)\s*\{/);

// invDiscountAmount() reads document.getElementById('ni-disctype'/'ni-disc')
// -- a minimal stub, not a real DOM, exactly like the rest of this app's
// controls it reads (value only).
function makeSandbox(discType, discVal) {
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
  vm.runInContext([taxDefaultSrc, calcServiceLineTaxSrc, calcInvoiceExtrasSrc, invDiscountAmountSrc].join('\n'), sandbox);
  return sandbox;
}

section('Case A — calcInvoiceExtras(): the ONE canonical extras engine niPrev() and genInv() both call');
{
  test('empty invItems -> all-zero, no throw', () => {
    const sb = makeSandbox('fixed', 0);
    const r = vm.runInContext('calcInvoiceExtras([], 1)', sb);
    assert.deepEqual(plain(r), { extras: [], eSubtotal: 0, eTax: 0, eT: 0 });
  });

  test('a blank-description item is excluded from the financial totals (matches genInv()\'s own filter -- a still-being-typed row never inflates the live total)', () => {
    const sb = makeSandbox('fixed', 0);
    const r = vm.runInContext('calcInvoiceExtras([{desc:"",qty:1,unit:50,tax:true}], 1)', sb);
    assert.equal(r.extras.length, 0);
    assert.equal(r.eSubtotal, 0);
  });

  test('USD, single taxed item, qty 2 @ $50 (no priceTaxMode -> falls back TAX_EXCLUDED) -> subtotal 100, Service $10 then TGST 17% of $110 = $18.70, eT 128.70', () => {
    // Catalog tax-treatment upgrade (2026-09-11) corrected this engine from
    // a flat (svc+tgst)/100=27% shortcut to the canonical compound
    // Base->Service->TGST-on-(base+service) order (1.10 x 1.17 = 1.287),
    // matching calcTaxGeneral()'s own room-charge formula.
    const sb = makeSandbox('fixed', 0);
    const r = vm.runInContext('calcInvoiceExtras([{desc:"Snorkel",qty:2,unit:50,tax:true}], 1)', sb);
    assert.equal(r.eSubtotal, 100);
    assert.equal(r.eTax, 28.70);
    assert.equal(r.eT, 128.70);
  });

  test('an untaxed item contributes to eSubtotal but not eTax', () => {
    const sb = makeSandbox('fixed', 0);
    const r = vm.runInContext('calcInvoiceExtras([{desc:"Gift",qty:1,unit:20,tax:false}], 1)', sb);
    assert.equal(r.eSubtotal, 20);
    assert.equal(r.eTax, 0);
    assert.equal(r.eT, 20);
  });

  test('MVR conversion (fx=15.42): USD catalog price is converted for THIS invoice only, unitUsd retained unconverted', () => {
    const sb = makeSandbox('fixed', 0);
    const r = vm.runInContext('calcInvoiceExtras([{desc:"Transfer",qty:1,unit:10,tax:true}], 15.42)', sb);
    assert.equal(r.extras[0].unit, 154.2);
    assert.equal(r.extras[0].unitUsd, 10);
    assert.equal(r.eSubtotal, 154.2);
  });

  test('PROOF this fix matters: per-item rounding (new, correct) vs sum-then-round (old, buggy) diverge by a cent for a realistic 3-item MVR invoice', () => {
    const sb = makeSandbox('fixed', 0);
    const items = [
      { desc: 'Snorkel trip', qty: 3, unit: 1, tax: true },
      { desc: 'Airport transfer', qty: 1, unit: 1, tax: true },
      { desc: 'Spa treatment', qty: 2, unit: 3.13, tax: true }
    ];
    const fx = 15.42;
    const r = vm.runInContext(`calcInvoiceExtras(${JSON.stringify(items)}, ${fx})`, sb);
    // New (correct) behaviour: sum of the ALREADY-ROUNDED per-line tax figures.
    const perLineTaxSum = +r.extras.reduce((s, e) => s + e.taxAmt, 0).toFixed(2);
    assert.equal(r.eTax, perLineTaxSum, 'eTax must equal the sum of the rounded per-line tax amounts (what genInv() now also computes)');
    // Old (buggy) formula niPrev() used to run: sum ALL items' subtotals
    // into one lump first, then tax that lump ONCE -- isolate that
    // rounding-ORDER bug from the separate flat-27%-vs-compound-1.287x
    // formula correction (Catalog Tax-Treatment Upgrade, 2026-09-11) by
    // reapplying the SAME (new, correct) calcServiceLineTax() formula, just
    // to the aggregate instead of per-line.
    const aggregateSubtotal = +r.extras.reduce((s, e) => s + e.subtotal, 0).toFixed(2);
    const aggregateTax = vm.runInContext(`calcServiceLineTax(${aggregateSubtotal}, 'TAX_EXCLUDED')`, sb);
    const oldStyleAggregateTax = +(aggregateTax.svc + aggregateTax.tgst).toFixed(2);
    assert.notEqual(oldStyleAggregateTax, r.eTax, 'taxing the aggregate subtotal once must land on a DIFFERENT cent value than summing the rounded per-line tax amounts -- proving preview and finalize really could disagree before per-line rounding was introduced');
  });

  test('genInv() calls the SAME calcInvoiceExtras() helper as niPrev() -- not a second, hand-rolled formula', () => {
    const genInvSrc = extractByStart(PMS, /function genInv\(\)\s*\{/);
    assert.match(genInvSrc, /calcInvoiceExtras\(invItems,\s*fx\)/);
    const niPrevSrc = extractByStart(PMS, /function niPrev\(\)\s*\{/);
    assert.match(niPrevSrc, /calcInvoiceExtras\(invItems,\s*fx\)/);
  });
}

section('Case B — invDiscountAmount(): live discount clamping + instant "capped" validation flag (Step 13)');
{
  test('normal in-range fixed discount is not capped', () => {
    const sb = makeSandbox('fixed', 20);
    const r = vm.runInContext('invDiscountAmount(80, 20)', sb); // base=100
    assert.equal(r.amount, 20);
    assert.equal(r.capped, false);
  });

  test('fixed discount exceeding the subtotal is capped to the subtotal and flagged', () => {
    const sb = makeSandbox('fixed', 500);
    const r = vm.runInContext('invDiscountAmount(80, 20)', sb); // base=100
    assert.equal(r.amount, 100);
    assert.equal(r.capped, true);
  });

  test('percent discount over 100% is capped to the full base and flagged', () => {
    const sb = makeSandbox('percent', 150);
    const r = vm.runInContext('invDiscountAmount(80, 20)', sb); // base=100
    assert.equal(r.amount, 100);
    assert.equal(r.capped, true);
  });

  test('negative discount input clamps to 0 and is flagged (never a discount that INCREASES the total)', () => {
    const sb = makeSandbox('fixed', -50);
    const r = vm.runInContext('invDiscountAmount(80, 20)', sb);
    assert.equal(r.amount, 0);
    assert.equal(r.capped, true);
  });

  test('a percent discount with >2 decimals of rounding (but genuinely in range) is NOT falsely flagged as capped', () => {
    // base=99.99, 50% -> 49.995, which toFixed(2) rounds -- must not trip `capped`
    // since the raw amount (49.995) never actually exceeded [0, 99.99].
    const sb = makeSandbox('percent', 50);
    const r = vm.runInContext('invDiscountAmount(60, 39.99)', sb); // base=99.99
    assert.equal(r.capped, false);
  });
}

section('Case C — wiring audit: every enumerated live-preview control actually calls niPrev()');
{
  test('ni-currency / ni-taxstatus / ni-taxmode selects call niPrev() on change', () => {
    assert.match(PMS, /id="ni-currency"\s+onchange="niPrev\(\)"/);
    assert.match(PMS, /id="ni-taxstatus"\s+onchange="niPrev\(\)"/);
    assert.match(PMS, /id="ni-taxmode"\s+onchange="niPrev\(\)"/);
  });

  test('invoice discount type/value call niPrev() live -- value on every keystroke (oninput), not just on blur', () => {
    assert.match(PMS, /id="ni-disctype"\s+onchange="niPrev\(\)"/);
    assert.match(PMS, /id="ni-disc"[^>]*oninput="niPrev\(\)"/);
  });

  test('catalog item picker (invPickItem) and the custom-item fallback (invAddBlank) both refresh the live preview immediately after adding a line', () => {
    const invPickItemSrc = extractByStart(PMS, /function invPickItem\(itemId\)\s*\{/);
    assert.match(invPickItemSrc, /renderInvItems\(\);niPrev\(\);/);
    const invAddBlankSrc = extractByStart(PMS, /function invAddBlank\(catKey\)\s*\{/);
    assert.match(invAddBlankSrc, /renderInvItems\(\);niPrev\(\);/);
  });

  test('updateInvItem() and removeInvItem() (quantity/unit/tax edits, line removal) refresh the live preview', () => {
    const updateInvItemSrc = extractByStart(PMS, /function updateInvItem\(id,field,val\)\s*\{/);
    assert.match(updateInvItemSrc, /niPrev\(\)/);
    const removeInvItemSrc = extractByStart(PMS, /function removeInvItem\(id\)\s*\{/);
    assert.match(removeInvItemSrc, /niPrev\(\)/);
  });

  test('every inline row control rendered by renderInvItems() (qty, unit price, tax checkbox, delete ✕) calls niPrev() in its own onchange/onclick -- not just on save', () => {
    const renderInvItemsSrc = extractByStart(PMS, /function renderInvItems\(\)\s*\{/);
    const rowHandlers = renderInvItemsSrc.match(/on(?:change|click)="[^"]*"/g) || [];
    assert.ok(rowHandlers.length >= 4, 'expected qty/unit/tax/delete row handlers, found ' + rowHandlers.length);
    rowHandlers.forEach(h => assert.match(h, /niPrev\(\)/, 'row handler missing niPrev(): ' + h));
  });

  test('the reservation picker and the "include room charge" toggle are wired through the global delegated change listener', () => {
    assert.match(PMS, /addEventListener\('change',e=>\{if\(e\.target\.id==='ni-res'\|\|e\.target\.id==='ni-include-room'\)niPrev\(\);\}\)/);
  });

  test('openIM() renders the live preview immediately on open (no stale panel from a previous invoice)', () => {
    const openIMSrc = extractByStart(PMS, /function openIM\(resId, opts\)\s*\{/);
    assert.match(openIMSrc, /niPrev\(\);/);
  });
}

section('Case D — no database writes during preview (Step 16)');
{
  test('niPrev() never touches Firestore, RES, FOLIOS, or INV -- it only reads state and writes #ni-prev.innerHTML', () => {
    const niPrevSrc = extractByStart(PMS, /function niPrev\(\)\s*\{/);
    assert.doesNotMatch(niPrevSrc, /syncInvoiceToFirestore|syncFolioToFirestore|\.set\(|\.update\(|\.add\(|INV\.(push|unshift)|RES\.push/);
  });

  test('calcInvoiceExtras() is a pure function -- no DOM access, no persistence, safe to call on every keystroke', () => {
    assert.doesNotMatch(calcInvoiceExtrasSrc, /document\.|Firestore|INV\.|RES\.|FOLIOS\./);
  });

  test('only genInv() (Finalize) calls syncInvoiceToFirestore() -- niPrev() never does', () => {
    const genInvSrc = extractByStart(PMS, /function genInv\(\)\s*\{/);
    assert.match(genInvSrc, /syncInvoiceToFirestore\(v\)/);
  });
}

section('Case E — preview and finalize share the exact same total formula (Step 17: no surprise total on Finalize)');
{
  test('niPrev() and genInv() both compute total as +(roomTotal+eT-<discount>).toFixed(2) from the same ext.eT / calcTax(rForInvoice).total inputs', () => {
    const niPrevSrc = extractByStart(PMS, /function niPrev\(\)\s*\{/);
    const genInvSrc = extractByStart(PMS, /function genInv\(\)\s*\{/);
    assert.match(niPrevSrc, /const total=\+\(roomTotal\+ext\.eT-d\.amount\)\.toFixed\(2\);/);
    assert.match(genInvSrc, /const total=\+\(roomTotal\+eT-disc\)\.toFixed\(2\);/);
    // genInv()'s eT/disc are ext.eT and d.amount under different local names --
    // confirmed by Case A's "same helper" test and Case B's shared invDiscountAmount().
    assert.match(genInvSrc, /const eT=ext\.eT;/);
    assert.match(genInvSrc, /const disc=d\.amount;/);
  });

  test('both niPrev() and genInv() build rForInvoice from the SAME niInvoicePricing() selects and pass it into the SAME calcTax() -- the room portion can never diverge either', () => {
    const niPrevSrc = extractByStart(PMS, /function niPrev\(\)\s*\{/);
    const genInvSrc = extractByStart(PMS, /function genInv\(\)\s*\{/);
    [niPrevSrc, genInvSrc].forEach(src => {
      assert.match(src, /const pricing=niInvoicePricing\(\);/);
      assert.match(src, /billingCurrency:pricing\.currency,guestTaxStatus:pricing\.guestTaxStatus,priceTaxMode:pricing\.priceTaxMode/);
      assert.match(src, /calcTax\(rForInvoice\)/);
    });
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
