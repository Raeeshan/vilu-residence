// Calendar reservation pricing cleanup + Simple guest bill split — 2026-09-10.
//
// Covers: removal of the confusing inline "Rate ($/night)"/"Save rate"
// quick-editor from Calendar's normal drawer view, replaced by a read-only
// Accommodation summary sourced from the existing calcTax() (no new
// calculation); the reservation-specific price override moved under Edit
// booking & dates, gated Admin/Manager-only with a required reason and an
// audit trail (priceAdjustments); confirmation that Bulk Price Manager/
// public rates never retroactively reprice an existing reservation;
// isolation from Beds24/Cloudbeds/OTA/package pricing. And: the guest
// identity model (lead guest's real name + generic "Guest N" fallback,
// never fabricated); the "Who pays?" charge assignment (Shared/Guest N/
// Split equally); deterministic no-remainder-mismatch equal-split rounding;
// discount-before-split; per-guest folio balances; guest-scoped invoicing
// (Whole room / Guest N) that never double-invoices or duplicates a charge;
// partial payment settling only that guest's own share; backward-
// compatible defaults for historical folio charges with no payer field.
//
// Same technique the rest of this suite uses: brace-match real functions
// out of vilu-unified.html and run pure ones in a vm sandbox, regex-check
// DOM-coupled ones directly against source. No Firestore, no browser, no
// live reservation.
//   node test/guest-bill-split.test.js
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

// Sandbox with every pure helper the split/charge math needs, wired up
// exactly like the real file (each extracted verbatim, none reimplemented).
function buildMathSandbox() {
  const ctx = { console, TAX: { svc: 10, tgst: 17, thirdGuest: 20, childDiscountPercent: 50, green: 6, bed: 0 } };
  vm.createContext(ctx);
  const fns = [
    /function chargeGrossAmount\(ch\)\s*\{/,
    /function chargeDiscountAmount\(ch\)\s*\{/,
    /function chargeFinalAmount\(ch\)\s*\{/,
    /function reservationGuestCount\(r\)\s*\{/,
    /function reservationGuestLabels\(r\)\s*\{/,
    /function guestLabelFor\(r,guestKey\)\s*\{/,
    /function splitCentsDeterministic\(totalAmount,n\)\s*\{/,
    /function chargeSplitAllocations\(ch,r\)\s*\{/,
    /function chargeAmountForGuest\(ch,r,guestKey\)\s*\{/,
    /function chargeTaxInclusiveEstimate\(amt\)\s*\{/,
    /function chargeAmountForGuestTaxInclusive\(ch,r,guestKey\)\s*\{/,
  ];
  fns.forEach(re => vm.runInContext(extractByStart(PMS, re), ctx));
  return ctx;
}

section('Case A — guest identity model (Part 5, no fabrication)');
{
  const ctx = buildMathSandbox();
  test('a 1-guest reservation yields exactly one label: the lead guest\'s real name', () => {
    ctx.r = { fn: 'Raeeshan', ad: 1, ch: 0 };
    const labels = vm.runInContext('reservationGuestLabels(r)', ctx);
    assert.deepEqual(plain(labels.map(l => l.label)), ['Raeeshan']);
    assert.deepEqual(plain(labels.map(l => l.key)), ['guest1']);
  });
  test('a 3-guest reservation (2 adults + 1 child): lead guest\'s real name for guest 1, generic "Guest N" for the rest -- never fabricated names for guests the system has no data on', () => {
    ctx.r = { fn: 'Raeeshan', ad: 2, ch: 1 };
    const labels = vm.runInContext('reservationGuestLabels(r)', ctx);
    assert.deepEqual(plain(labels.map(l => l.label)), ['Raeeshan', 'Guest 2', 'Guest 3']);
  });
  test('infants are excluded from the guest count (consistent with the existing PER_PAX default elsewhere)', () => {
    ctx.r = { fn: 'Ahmed', ad: 2, ch: 0, inf: 2 };
    assert.equal(vm.runInContext('reservationGuestCount(r)', ctx), 2);
  });
  test('a reservation with no lead guest name on file still gets a real "Guest 1" fallback, never an empty/undefined label', () => {
    ctx.r = { fn: '', ad: 2, ch: 0 };
    const labels = vm.runInContext('reservationGuestLabels(r)', ctx);
    assert.deepEqual(plain(labels.map(l => l.label)), ['Guest 1', 'Guest 2']);
  });
  test('guestLabelFor() resolves a stored guestKey back to the current display label', () => {
    ctx.r = { fn: 'Ali', ad: 2, ch: 0 };
    assert.equal(vm.runInContext(`guestLabelFor(r,'guest2')`, ctx), 'Guest 2');
    assert.equal(vm.runInContext(`guestLabelFor(r,'guest1')`, ctx), 'Ali');
  });
}

section('Case B — Shared / Guest-specific / Split-equally charge math (Steps 7-9)');
{
  const ctx = buildMathSandbox();
  test('Shared charge (the default): chargeAmountForGuest ignores payer entirely for the whole-room scope, and returns 0 for every individual guest scope (never appears in a single guest\'s bill)', () => {
    ctx.r = { fn: 'A', ad: 2, ch: 0 };
    ctx.ch = { price: 18, pax: 2, payerType: 'shared' };
    assert.equal(vm.runInContext(`chargeAmountForGuest(ch,r,'whole')`, ctx), 36);
    assert.equal(vm.runInContext(`chargeAmountForGuest(ch,r,'guest1')`, ctx), 0);
    assert.equal(vm.runInContext(`chargeAmountForGuest(ch,r,'guest2')`, ctx), 0);
  });
  test('Guest-specific charge (Manta Ray Tour, 2 pax x $50 = $100, assigned to Guest 1): the whole $100 belongs to Guest 1, $0 to Guest 2, never duplicated as two charges', () => {
    ctx.r = { fn: 'A', ad: 2, ch: 0 };
    ctx.ch = { price: 50, pax: 2, payerType: 'guest', payerGuestKey: 'guest1' };
    assert.equal(vm.runInContext(`chargeAmountForGuest(ch,r,'guest1')`, ctx), 100);
    assert.equal(vm.runInContext(`chargeAmountForGuest(ch,r,'guest2')`, ctx), 0);
    assert.equal(vm.runInContext(`chargeAmountForGuest(ch,r,'whole')`, ctx), 100);
  });
  test('Split-equally, 3 guests, $90 final: exactly $30/$30/$30, one canonical charge -- chargeSplitAllocations never fabricates extra line items', () => {
    ctx.r = { fn: 'A', ad: 3, ch: 0 };
    ctx.ch = { price: 90, pax: 1, payerType: 'split' };
    const allocs = vm.runInContext('chargeSplitAllocations(ch,r)', ctx);
    assert.equal(allocs.length, 3);
    assert.deepEqual(plain(allocs.map(a => a.amount)), [30, 30, 30]);
    assert.equal(allocs.reduce((s, a) => s + a.amount, 0), 90);
  });
}

section('Case C — deterministic rounding, no cent mismatch (Step 11)');
{
  const ctx = buildMathSandbox();
  test('$100 split 3 ways: $33.34 / $33.33 / $33.33 -- sums EXACTLY to $100, first guest absorbs the leftover cent (task\'s own worked example)', () => {
    ctx.r = { fn: 'A', ad: 3, ch: 0 };
    ctx.ch = { price: 100, pax: 1, payerType: 'split' };
    const allocs = vm.runInContext('chargeSplitAllocations(ch,r)', ctx);
    assert.deepEqual(plain(allocs.map(a => a.amount)), [33.34, 33.33, 33.33]);
    assert.equal(+allocs.reduce((s, a) => s + a.amount, 0).toFixed(2), 100);
  });
  test('$90 split 2 ways: exactly $45/$45, no remainder to distribute', () => {
    ctx.r = { fn: 'A', ad: 2, ch: 0 };
    ctx.ch = { price: 90, pax: 1, payerType: 'split' };
    const allocs = vm.runInContext('chargeSplitAllocations(ch,r)', ctx);
    assert.deepEqual(plain(allocs.map(a => a.amount)), [45, 45]);
  });
  test('an awkward split ($10.01 across 3 guests) never mismatches by a cent either', () => {
    ctx.r = { fn: 'A', ad: 3, ch: 0 };
    ctx.ch = { price: 10.01, pax: 1, payerType: 'split' };
    const allocs = vm.runInContext('chargeSplitAllocations(ch,r)', ctx);
    assert.equal(+allocs.reduce((s, a) => s + a.amount, 0).toFixed(2), 10.01);
  });
}

section('Case D — discount applied BEFORE split (Step 10)');
{
  const ctx = buildMathSandbox();
  test('Dinner $100 gross, 10% discount = -$10, final $90, split 3 ways = $30/$30/$30 -- the split works off the FINAL amount, never the pre-discount gross', () => {
    ctx.r = { fn: 'A', ad: 3, ch: 0 };
    ctx.ch = { price: 100, pax: 1, discountType: 'percent', discountValue: 10, payerType: 'split' };
    const final = vm.runInContext('chargeFinalAmount(ch)', ctx);
    assert.equal(final, 90);
    const allocs = vm.runInContext('chargeSplitAllocations(ch,r)', ctx);
    assert.deepEqual(plain(allocs.map(a => a.amount)), [30, 30, 30]);
  });
}

section('Case E — "Who pays?" UI wiring (Steps 6-9)');
{
  test('the charge editor only shows the Who-pays picker when the reservation genuinely has more than one guest (a solo guest would make Shared/Guest 1 the same person -- pointless clutter)', () => {
    const src = extractByStart(PMS, /function folioRenderChargeEditor\(instanceId\)\s*\{/);
    assert.match(src, /guestLabels\.length>1/);
    assert.match(src, /Who pays\?/);
  });
  test('folioSetPayer() records payerType and, only for a specific-guest assignment, the guestKey -- Split/Shared never carry a stray guestKey', () => {
    const src = extractByStart(PMS, /function folioSetPayer\(instanceId,payerType,guestKey\)\s*\{/);
    assert.match(src, /st\.payerGuestKey=payerType==='guest'\?guestKey:null;/);
  });
  test('folioAddCatalogCharge() defaults payerType to \'shared\' when nothing was explicitly chosen (Step 7)', () => {
    const src = extractByStart(PMS, /function folioAddCatalogCharge\(instanceId\)\s*\{/);
    assert.match(src, /payerType:st\.payerType\|\|'shared'/);
  });
  test('the custom-item (uncatalogued) form gets the SAME Who-pays picker, not a second implementation', () => {
    const src = extractByStart(PMS, /function buildAddChargeFormHTML\(resId,instanceId\)\s*\{/);
    assert.match(src, /fc-payer-/);
    const addSrc = extractByStart(PMS, /async function addFolioCharge\(resId,instanceId\)\s*\{/);
    assert.match(addSrc, /fc-payer-/);
  });
}

section('Case F — folio display (Part 12) and backward compatibility (Part 17)');
{
  test('renderFolioChargesById() shows "Who pays" for a guest-assigned or split charge, but adds NOTHING extra for a Shared one (unchanged rendering for every pre-existing charge)', () => {
    const src = extractByStart(PMS, /function renderFolioChargesById\(resId,instanceId\)\s*\{/);
    assert.match(src, /var payerType=ch\.payerType\|\|'shared';/);
    assert.match(src, /payerType==='guest'/);
    assert.match(src, /payerType==='split'/);
  });
  test('a charge with no payerType field at all (every historical charge added before this feature existed) defaults to \'shared\' wherever payer is read -- no destructive migration, no rewritten historical data', () => {
    const renderSrc = extractByStart(PMS, /function renderFolioChargesById\(resId,instanceId\)\s*\{/);
    assert.match(renderSrc, /ch\.payerType\|\|'shared'/);
    const amountSrc = extractByStart(PMS, /function chargeAmountForGuest\(ch,r,guestKey\)\s*\{/);
    assert.match(amountSrc, /ch\.payerType\|\|'shared'/);
    const eligSrc = extractByStart(PMS, /function uninvoicedChargesForPayer\(resId,payerScope\)\s*\{/);
    assert.match(eligSrc, /ch\.payerType\|\|'shared'/);
  });
}

section('Case G — guest-scoped invoicing: Whole room / Guest N (Steps 13-15)');
{
  test('openCreateInvoice() offers an "Invoice for" scope picker only when the reservation has more than one guest, defaulting to Whole room', () => {
    const src = extractByStart(PMS, /function openCreateInvoice\(resId,payerScope\)\s*\{/);
    assert.match(src, /payerScope=payerScope\|\|'whole';/);
    assert.match(src, /guestLabels\.length>1/);
    assert.match(src, /Invoice for/);
  });
  test('a guest-specific "Invoice for" scope never includes Shared charges (Step 14 -- no automatic division of shared charges into a single guest\'s invoice)', () => {
    const src = extractByStart(PMS, /function uninvoicedChargesForPayer\(resId,payerScope\)\s*\{/);
    // the guest-scope branch (after the whole/null early return) explicitly excludes shared
    const guestBranch = src.slice(src.indexOf("if(!payerScope||payerScope==='whole')"));
    assert.match(guestBranch, /if\(payerType==='shared'\) return false;/);
  });
  test('Room accommodation is never included in a guest-specific invoice -- the "Include room charge" checkbox itself is hidden for anything but Whole Room (Step 15)', () => {
    const openCreateSrc = extractByStart(PMS, /function openCreateInvoice\(resId,payerScope\)\s*\{/);
    assert.match(openCreateSrc, /if\(payerScope==='whole'\)\{[\s\S]{0,400}ci-include-room/);
    const submitSrc = extractByStart(PMS, /function submitCreateInvoice\(resId,payerScope\)\s*\{/);
    assert.match(submitSrc, /includeRoom=payerScope==='whole'&&/);
    const openIMSrc = extractByStart(PMS, /function openIM\(resId, opts\)\s*\{/);
    assert.match(openIMSrc, /invPayerScope!=='whole' \? false/);
  });
  test('genInv() marks a Whole Room invoice\'s charges via the existing ch.invoiceId (unchanged), and a guest-scoped invoice via a SEPARATE ch.guestInvoiced[guestKey] entry -- the charge itself is never mutated in a way that blocks its OTHER guests\' shares (or a split\'s remaining shares) from still being invoiced later', () => {
    const src = extractByStart(PMS, /function genInv\(\)\s*\{/);
    assert.match(src, /if\(invPayerScope==='whole'\)\{ ch\.invoiceId=v\.id; \}/);
    assert.match(src, /ch\.guestInvoiced=ch\.guestInvoiced\|\|\{\}; ch\.guestInvoiced\[invPayerScope\]=v\.id;/);
    assert.match(src, /payerScope:invPayerScope/);
  });
  test('no duplicate invoices: once a guest\'s portion of a charge is invoiced (ch.guestInvoiced[guestKey] set), that SAME guest-scope query excludes it from being offered again', () => {
    const src = extractByStart(PMS, /function uninvoicedChargesForPayer\(resId,payerScope\)\s*\{/);
    assert.match(src, /if\(ch\.guestInvoiced && ch\.guestInvoiced\[payerScope\]\) return false;/);
  });
  test('a Whole Room invoice stops sweeping up a charge once ANY guest has invoiced part of it -- prevents double-invoicing that guest\'s already-covered portion', () => {
    const src = extractByStart(PMS, /function uninvoicedChargesForPayer\(resId,payerScope\)\s*\{/);
    const wholeBranch = src.slice(0, src.indexOf("return folio.charges.filter(function(ch){\n    var payerType"));
    assert.match(wholeBranch, /ch\.guestInvoiced && Object\.keys\(ch\.guestInvoiced\)\.some/);
  });
}

section('Case H — partial payment settles only that guest\'s own share (Step 16)');
{
  test('folioGuestBalance() sums only THIS guest\'s charged amount (their real invoices\' totals + a tax-inclusive estimate of anything not yet invoiced) and only invoices actually scoped to them (v.payerScope===guestKey) -- a whole-room payment or another guest\'s invoice payment never appears here', () => {
    const src = extractByStart(PMS, /function folioGuestBalance\(resId,guestKey\)\s*\{/);
    assert.match(src, /chargeAmountForGuestTaxInclusive\(ch,r,guestKey\)/);
    assert.match(src, /v\.payerScope===guestKey/);
  });
  test('recordInvoicePayment() only marks a charge\'s whole-charge .paid flag true for a Whole Room invoice -- a guest-scoped invoice reaching Fully Paid never marks the underlying (possibly split) charge as paid for everyone', () => {
    const src = extractByStart(PMS, /function recordInvoicePayment\(invId\)\s*\{/);
    assert.match(src, /if\(v\.pay==='Fully paid'&&v\.resId&&\(!v\.payerScope\|\|v\.payerScope==='whole'\)\)\{/);
  });
}

section('Case I — Calendar pricing cleanup: no more editable generic Rate field (Steps 1-4)');
{
  test('the old inline "Rate ($/night)" / "Save rate" quick-editor (detSaveRate, #det-rate-inp, #det-rate-row) is gone from the normal Calendar drawer view', () => {
    assert.doesNotMatch(PMS, /function detSaveRate/);
    assert.doesNotMatch(PMS, /det-rate-inp/);
    assert.doesNotMatch(PMS, /det-rate-row/);
  });
  test('the drawer now shows a read-only "Accommodation" summary sourced from the SAME calcTax(r) already used everywhere else -- no new/duplicate pricing calculation invented', () => {
    const src = extractByStart(PMS, /function _showDetLegacy\(id\)\s*\{/);
    assert.match(src, /const x=calcTax\(r\)/);
    assert.match(src, />Accommodation</);
    assert.match(src, /Booked rate/);
    assert.match(src, /Total accommodation/);
  });
  test('canAdjustRoomPrice() is Admin/Manager only, same authority level as folio discounts', () => {
    const src = extractByStart(PMS, /function canAdjustRoomPrice\(\)\s*\{/);
    assert.match(src, /role === 'admin'/);
    assert.match(src, /role === 'manager'/);
    assert.doesNotMatch(src, /role === 'staff'/);
  });
  test('the reservation-price-adjustment control now lives under Edit booking & dates (a link from the read-only summary, Admin/Manager only), not a standalone Calendar shortcut', () => {
    const src = extractByStart(PMS, /function _showDetLegacy\(id\)\s*\{/);
    assert.match(src, /canAdjustRoomPrice\(\)\?`<div[\s\S]{0,200}openEdit/);
  });
}

section('Case J — reservation price override: Admin/Manager gated, reason required, audit trail, never a silent staff change (Step 3)');
{
  test('saveEdit() only treats ed-rate as a deliberate override when it genuinely differs from the room/dates\' own natural rate -- an ordinary room/date change (where the rate is expected to change) is never blocked or gated', () => {
    const src = extractByStart(PMS, /async function saveEdit\(\)\s*\{/);
    assert.match(src, /const naturalRate=\(isVR\(rn\)\?getDateRangeRate\(rn,ci,co\):getR\(rn\)\?\.rate\)\|\|r\.rate;/);
    assert.match(src, /if\(customRate>0 && Math\.abs\(customRate-naturalRate\)>0\.005\)\{/);
  });
  test('a Staff user\'s deliberate override attempt is silently ignored (falls back to the natural/standard rate) rather than blocking the rest of their edit (dates/room/guests still save)', () => {
    const src = extractByStart(PMS, /async function saveEdit\(\)\s*\{/);
    assert.match(src, /if\(!canAdjustRoomPrice\(\)\)\{[\s\S]{0,250}rate=naturalRate;/);
  });
  test('an Admin/Manager override without a reason also falls back to the natural rate -- reason is genuinely required, not just requested', () => {
    const src = extractByStart(PMS, /async function saveEdit\(\)\s*\{/);
    assert.match(src, /if\(!reason\|\|!reason\.trim\(\)\)\{[\s\S]{0,150}rate=naturalRate;/);
  });
  test('a valid Admin/Manager override with a reason records a full audit-trail entry: old rate, new rate, reason, who, when', () => {
    const src = extractByStart(PMS, /async function saveEdit\(\)\s*\{/);
    assert.match(src, /priceAdjustment=\{oldRate:r\.rate,newRate:customRate,reason:reason\.trim\(\),changedBy:currentUser\?currentUser\.name:'Admin',changedAt:Date\.now\(\)\};/);
    assert.match(src, /updated\.priceAdjustments=\(r\.priceAdjustments\|\|\[\]\)\.concat\(\[priceAdjustment\]\);/);
  });
}

section('Case K — existing booked price is preserved; public/OTA/package pricing isolation (Step 4, DO NOT TOUCH)');
{
  test('calcTax() reads r.rate directly (a value snapshotted on the reservation at booking time) -- it never live-looks-up room_prices/category rates for an EXISTING reservation, so a future Bulk Price Manager change can never retroactively reprice one', () => {
    const src = extractByStart(PMS, /function calcTax\(r\)\s*\{/);
    // USD/MVR billing (2026-09-10): the actual base=rate*nights+supplement
    // arithmetic now lives in calcTaxGeneral() (quotedRate*nights+...),
    // called with quotedRate defaulting straight from r.rate -- calcTax()
    // itself still reads r.rate directly, never a live pricing lookup.
    assert.match(src, /const quotedRate = r\.quotedRate!=null \? r\.quotedRate : r\.rate;/);
    assert.doesNotMatch(src, /room_prices/);
    assert.doesNotMatch(src, /getDateRangeRate/);
    const generalSrc = extractByStart(PMS, /function calcTaxGeneral\(input\)\s*\{/);
    assert.match(generalSrc, /var roomAndSupplement = \+\(input\.quotedRate\*input\.nights \+ \(input\.thirdGuestSupplement\|\|0\)\)\.toFixed\(2\);/);
    assert.doesNotMatch(generalSrc, /room_prices/);
    assert.doesNotMatch(generalSrc, /getDateRangeRate/);
  });
  test('priceAdjustments only ever mutates r.rate and r.priceAdjustments on ONE reservation -- never room_prices, ota_room_type_overrides, packages, or agency_packages', () => {
    const src = extractByStart(PMS, /async function saveEdit\(\)\s*\{/);
    assert.doesNotMatch(src, /room_prices/);
    assert.doesNotMatch(src, /ota_room_type_overrides/);
    assert.doesNotMatch(src, /collection\('packages'\)/);
    assert.doesNotMatch(src, /agency_packages/);
  });
  test('none of the new guest-split functions reference Beds24, Cloudbeds, OTA collections, or package pricing', () => {
    const fns = ['reservationGuestLabels', 'chargeSplitAllocations', 'chargeAmountForGuest', 'uninvoicedChargesForPayer', 'folioGuestBalance', 'folioSetPayer']
      .map(fn => extractByStart(PMS, new RegExp('function ' + fn + '\\([^)]*\\)\\s*\\{'))).join('\n');
    assert.doesNotMatch(fns, /beds24/i);
    assert.doesNotMatch(fns, /ota_/i);
    assert.doesNotMatch(fns, /\bPKGS\b/);
    assert.doesNotMatch(fns, /room_prices/);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
