// Guest Folio + Calendar Folio unification — 2026-09-10.
//
// Covers: ONE canonical folio (FOLIOS, now Firestore-backed) shared by
// Calendar's reservation-detail folio and the Guest Folios page; room
// charge kept structurally separate from extras (calcTax(), never
// recomputed); the unified "Create Invoice" flow (All unpaid / Room only /
// per-category / Selected items) replacing the old duplicate "Generate
// invoice"/"Custom invoice" buttons; invoiced-item marking that prevents
// double-invoicing; payment recording against ONE invoice (never the whole
// reservation); balance calculation; void/restore; package-price isolation;
// print/receipt distinctness; "Open full folio" round-trip.
//
// Same technique the rest of this suite uses: brace-match real functions
// out of vilu-unified.html and run pure ones in a vm sandbox, regex-check
// DOM-coupled ones directly against source. No Firestore, no browser, no
// live reservation.
//   node test/guest-folio-unification.test.js
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
const SRULES = read('storage.rules');

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
function plain(x) { return JSON.parse(JSON.stringify(x)); } // cross-realm vm-sandbox objects fail deepEqual's prototype check
function extractConst(src, name) {
  const m = src.match(new RegExp('const ' + name + '\\s*='));
  if (!m) throw new Error(name + ' not found');
  const openIdx = src.indexOf('[', m.index);
  let i = openIdx + 1, depth = 1;
  while (depth > 0 && i < src.length) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') depth--;
    i++;
  }
  return src.slice(m.index, i);
}

section('Case A — canonical FOLIOS store: no duplicate charge stores between Calendar and Guest Folios');
{
  test('Calendar\'s folio section (_showDetLegacy) and Guest Folios (drawFolios) both call renderFolioChargesById() against the SAME global FOLIOS object -- never a second store (Calendar passes its own instanceId to avoid a DOM-id collision with Guest Folios\' pre-rendered card for the same reservation -- see the Calendar quick-add-charge fix -- but both still write/read the ONE FOLIOS[resId])', () => {
    assert.match(PMS, /var FOLIOS\s*=\s*loadFolios\(\)/);
    const calSrc = extractByStart(PMS, /function _showDetLegacy\(id\)\s*\{/);
    assert.match(calSrc, /renderFolioChargesById\(id,detInstanceId\)/);
    const foliosPageIdx = PMS.indexOf('// Render existing charges');
    assert.ok(foliosPageIdx !== -1);
    assert.match(PMS.slice(foliosPageIdx, foliosPageIdx + 100), /renderFolioChargesById\(r\.id\)/);
  });
  test('Calendar\'s folio section and Guest Folios both call the SAME buildAddChargeFormHTML() builder -- no near-duplicate HTML (Step 5)', () => {
    const calSrc = extractByStart(PMS, /function _showDetLegacy\(id\)\s*\{/);
    assert.match(calSrc, /buildAddChargeFormHTML\(id,detInstanceId\)/);
    const foliosFormIdx = PMS.indexOf('form.innerHTML=buildAddChargeFormHTML(r.id)');
    assert.ok(foliosFormIdx !== -1, 'Guest Folios card must also call buildAddChargeFormHTML()');
  });
  test('addFolioCharge() is the single write path for both screens -- both forms submit to it, and it syncs to Firestore (folios/{resId}), not just localStorage', () => {
    const src = extractByStart(PMS, /async function addFolioCharge\(resId,instanceId\)\s*\{/);
    assert.match(src, /FOLIOS\[resId\]\.charges\.push/);
    assert.match(src, /syncFolioToFirestore\(resId\)/);
    assert.match(PMS, /onclick="addFolioCharge\(this\.dataset\.rid,this\.dataset\.instance\)"/);
  });
  test('dead, orphaned detAddCharge()/detRemoveCharge() (a THIRD, divergent-shape write path found in the audit) have been removed', () => {
    assert.doesNotMatch(PMS, /function detAddCharge/);
    assert.doesNotMatch(PMS, /function detRemoveCharge/);
  });
}

section('Case B — Firestore backing (folios/{resId}, invoices/{invId}) — the real gap the audit found (localStorage-only folios, zero-persistence invoices)');
{
  test('syncFolioToFirestore() writes folios/{resId}, loadFoliosFromFirestore() reads it and migrates any local-only folio up on first load', () => {
    const syncSrc = extractByStart(PMS, /async function syncFolioToFirestore\(resId\)\s*\{/);
    assert.match(syncSrc, /fsDb\.collection\('folios'\)\.doc\(resId\)\.set/);
    const loadSrc = extractByStart(PMS, /async function loadFoliosFromFirestore\(\)\s*\{/);
    assert.match(loadSrc, /fsDb\.collection\('folios'\)\.get\(\)/);
    assert.match(loadSrc, /toMigrate/);
  });
  test('syncInvoiceToFirestore()/loadInvoicesFromFirestore() give INV real persistence, and IC (the invoice counter) is re-derived from the max existing invoice num on load -- never resets to 1000 and collides after a refresh', () => {
    const syncSrc = extractByStart(PMS, /async function syncInvoiceToFirestore\(v\)\s*\{/);
    assert.match(syncSrc, /fsDb\.collection\('invoices'\)\.doc\(v\.id\)\.set\(/);
    const loadSrc = extractByStart(PMS, /async function loadInvoicesFromFirestore\(\)\s*\{/);
    assert.match(loadSrc, /fsDb\.collection\('invoices'\)\.get\(\)/);
    assert.match(loadSrc, /IC\s*=\s*loaded\.reduce/);
  });
  test('loadAllFromSupabase() (the app\'s existing startup/refresh loader) now loads folios and invoices alongside reservations/blocks', () => {
    const src = extractByStart(PMS, /async function loadAllFromSupabase\(\)\s*\{/);
    assert.match(src, /await loadFoliosFromFirestore\(\);/);
    assert.match(src, /await loadInvoicesFromFirestore\(\);/);
  });
  test('firestore.rules defines folios/{resId} and invoices/{invId} with the same admin/staff(/manager)-only pattern as reservations -- never public, never agency-readable', () => {
    // Fixed Price Catalog Integration (2026-09-10) added Manager as a 4th
    // peer role with the same folios/invoices access as Staff -- these
    // collections stay admin/staff/manager-only, still never public/agency.
    assert.match(RULES, /match \/folios\/\{resId\}\s*\{\s*allow read: if isAdmin\(\) \|\| isStaff\(\) \|\| isManagerRole\(\);\s*allow write: if isAdmin\(\) \|\| isStaff\(\) \|\| isManagerRole\(\);\s*\}/);
    assert.match(RULES, /match \/invoices\/\{invId\}\s*\{\s*allow read: if isAdmin\(\) \|\| isStaff\(\) \|\| isManagerRole\(\);\s*allow write: if isAdmin\(\) \|\| isStaff\(\) \|\| isManagerRole\(\);\s*\}/);
  });
  test('live-QA bug (2026-09-10): syncFolioToFirestore()/syncInvoiceToFirestore() strip undefined field values before writing -- Firestore\'s SDK rejects a document containing one (caught live: genInv()\'s ref:r.ref is undefined for any reservation with no booking-reference code, which silently failed the Firestore sync for every such invoice until this fix)', () => {
    const folioSrc = extractByStart(PMS, /async function syncFolioToFirestore\(resId\)\s*\{/);
    assert.match(folioSrc, /stripUndefined\(/);
    const invSrc = extractByStart(PMS, /async function syncInvoiceToFirestore\(v\)\s*\{/);
    assert.match(invSrc, /stripUndefined\(v\)/);
    // Behavioral: the actual sanitizer really does drop an undefined field
    // rather than, say, turning it into the string "undefined".
    const stripSrc = extractByStart(PMS, /function stripUndefined\(obj\)\s*\{/);
    const box = {};
    vm.createContext(box);
    vm.runInContext(stripSrc, box);
    const cleaned = box.stripUndefined({ id: 'X', ref: undefined, total: 50 });
    assert.deepEqual(Object.keys(cleaned).sort(), ['id', 'total']);
  });
}

section('Case C — room charge kept structurally separate from extras (Step 4/20), package-price isolation');
{
  test('folioSummary() sources room ONLY from calcTax(r).total -- never recomputed, never influenced by folio extras', () => {
    const src = extractByStart(PMS, /function folioSummary\(resId\)\s*\{/);
    assert.match(src, /var room=r\?calcTax\(r\)\.total:0;/);
  });
  test('genInv() still calls the canonical calcTax(r) for the room line -- folio/invoice code never duplicates the room-pricing formula (audit Case 6 confirmed this was already correct and must stay that way)', () => {
    const src = extractByStart(PMS, /function genInv\(\)\s*\{/);
    assert.match(src, /const x=calcTax\(r\);/);
  });
  test('no folio/invoice function references packages/agency_packages or a package-total field -- a package reservation\'s room charge flows through the exact same calcTax(r.rate) path as any other reservation, per the audit\'s finding that no r.pkgId/pkgName is ever actually set', () => {
    const folioFns = [
      extractByStart(PMS, /async function addFolioCharge\(resId,instanceId\)\s*\{/),
      extractByStart(PMS, /function genInv\(\)\s*\{/),
      extractByStart(PMS, /function folioSummary\(resId\)\s*\{/),
    ].join('\n');
    assert.doesNotMatch(folioFns, /collection\('packages'\)/);
    assert.doesNotMatch(folioFns, /collection\('agency_packages'\)/);
    assert.doesNotMatch(folioFns, /pkgTotal|pkgId|pkgName/);
  });
}

section('Case D — canonical folio-item categories (Step 3), behavioral folioSummary() math');
{
  const vrSrc = extractConst(PMS, 'VR').replace(/^const /, 'var ');
  const calcTaxSrc = extractByStart(PMS, /function calcTax\(r\)\s*\{/);
  const ntMatch = PMS.match(/const nt=\([^)]*\)=>[^;]+;/);
  assert.ok(ntMatch, 'nt() helper not found');
  const ntSrc = 'var ' + ntMatch[0].slice('const '.length);
  const folioCatSrc = extractConst(PMS, 'FOLIO_CATEGORIES').replace(/^const /, 'var ') + ';';
  const folioSummarySrc = extractByStart(PMS, /function folioSummary\(resId\)\s*\{/);
  // Fixed Price Catalog Integration (2026-09-10): folioSummary() now sums
  // each charge via chargeFinalAmount(ch) instead of an inline
  // ch.price*(ch.pax||ch.qty||1), so the sandbox needs all three math
  // helpers defined before folioSummary() itself can run. Financial
  // integrity correction (2026-09-10): folioSummary() is now also
  // invoice-aware and tax-inclusive (see its own comment), so the sandbox
  // additionally needs uninvoicedChargesForPayer() and
  // chargeTaxInclusiveEstimate() defined first.
  const grossSrc = extractByStart(PMS, /function chargeGrossAmount\(ch\)\s*\{/);
  const discSrc = extractByStart(PMS, /function chargeDiscountAmount\(ch\)\s*\{/);
  const finalSrc = extractByStart(PMS, /function chargeFinalAmount\(ch\)\s*\{/);
  const uninvoicedSrc = extractByStart(PMS, /function uninvoicedChargesForPayer\(resId,payerScope\)\s*\{/);
  const taxEstSrc = extractByStart(PMS, /function chargeTaxInclusiveEstimate\(amt\)\s*\{/);
  const box = { TAX: { thirdGuest: 20, childDiscountPercent: 50, svc: 10, tgst: 17, green: 6, bed: 0 } };
  vm.createContext(box);
  vm.runInContext(['var TAX=' + JSON.stringify(box.TAX) + ';', vrSrc, folioCatSrc, ntSrc, calcTaxSrc, grossSrc, discSrc, finalSrc, uninvoicedSrc, taxEstSrc, folioSummarySrc].join('\n'), box);

  test('FOLIO_CATEGORIES is exactly the 5 non-room categories (Room is never a folio-item category, Payment/Credit is invoice-level, not a folio charge type; Accommodation Extras added alongside the Fixed Price Catalog Integration for catalog items like Extra Bed/Early Check-in)', () => {
    assert.deepEqual(plain(box.FOLIO_CATEGORIES), ['Food & Beverage', 'Trips & Activities', 'Transfers', 'Accommodation Extras', 'Other Services']);
  });
  test('folioSummary(): room + a tax-inclusive estimate of the uninvoiced extras sum exactly to chargesTotal (Financial integrity correction, 2026-09-10 -- chargesTotal is now tax-inclusive and invoice-aware, no longer a raw pre-tax sum), with zero paid/invoices the balance equals the full chargesTotal', () => {
    box.RES = [{ id: 'R1', rn: 'VR01', ci: '2026-09-10', co: '2026-09-12', ad: 2, ch: 0, rate: 100, src: 'Direct' }];
    box.FOLIOS = { R1: { charges: [
      { id: 1, cat: 'Food & Beverage', price: 20, qty: 1 },
      { id: 2, cat: 'Trips & Activities', price: 144, qty: 1 },
      { id: 3, cat: 'Transfers', price: 30, qty: 1 },
      { id: 4, cat: 'Other Services', price: 15, qty: 1 },
    ] } };
    box.INV = [];
    const sum = box.folioSummary('R1');
    // Category breakdown rows are still the raw, pre-tax display figures --
    // unchanged, informational only (Part 3's original intent).
    assert.equal(sum.food, 20); assert.equal(sum.activities, 144); assert.equal(sum.transfers, 30); assert.equal(sum.other, 15);
    const extrasTaxInclusive = +[20, 144, 30, 15].reduce((s, a) => s + box.chargeTaxInclusiveEstimate(a), 0).toFixed(2);
    assert.equal(sum.chargesTotal, +(sum.room + extrasTaxInclusive).toFixed(2));
    assert.equal(sum.paid, 0);
    assert.equal(sum.balance, sum.chargesTotal);
  });
  test('folioSummary(): an unrecognized/legacy category (e.g. old "Activity"/"Food" values from before this rebuild) safely falls into Other Services rather than vanishing from the total', () => {
    box.FOLIOS = { R1: { charges: [{ id: 5, cat: 'Activity', price: 50, qty: 1 }] } };
    const sum = box.folioSummary('R1');
    assert.equal(sum.other, 50);
    assert.equal(sum.activities, 0);
  });
  test('folioSummary(): paying ONE real invoice in full (its own exact tax-inclusive total, sourced from v.total -- never recomputed) never marks Room or Food paid, and that invoice\'s portion contributes net-zero to the remaining balance (Steps 12-13\'s mandatory example, extended for the Financial integrity correction)', () => {
    box.RES = [{ id: 'R2', rn: 'VR01', ci: '2026-09-10', co: '2026-09-15', ad: 2, ch: 0, rate: 100, src: 'Direct' }]; // 5 nights * 100 = 500 room
    const invoicedChargeTotal = box.chargeTaxInclusiveEstimate(150); // what a REAL invoice for this $150 charge actually totals, tax-inclusive
    box.FOLIOS = { R2: { charges: [
      { id: 10, cat: 'Trips & Activities', price: 150, qty: 1, invoiceId: 'INV-1001' },
      { id: 11, cat: 'Food & Beverage', price: 50, qty: 1 },
    ] } };
    box.INV = [{ id: 'INV-1001', resId: 'R2', status: 'active', total: invoicedChargeTotal, paidAmount: invoicedChargeTotal }];
    const sum = box.folioSummary('R2');
    assert.equal(sum.room, box.calcTax(box.RES[0]).total);
    assert.equal(sum.activities, 150);
    assert.equal(sum.food, 50);
    assert.equal(sum.paid, invoicedChargeTotal);
    const expected = +(invoicedChargeTotal + sum.room + box.chargeTaxInclusiveEstimate(50)).toFixed(2);
    assert.equal(sum.chargesTotal, expected);
    assert.equal(sum.balance, +(expected - invoicedChargeTotal).toFixed(2));
    assert.ok(sum.balance > 0, 'room + food must still show as unpaid balance');
  });
  test('folioSummary(): a fully-invoiced, fully-paid folio (nothing left uninvoiced) reconciles to EXACTLY $0.00 balance -- the negative-balance bug this task fixes, for the whole-room case', () => {
    box.RES = [{ id: 'R4', rn: 'VR01', ci: '2026-09-10', co: '2026-09-11', ad: 1, ch: 0, rate: 100, src: 'Direct' }];
    box.FOLIOS = { R4: { charges: [{ id: 20, cat: 'Food & Beverage', price: 18, qty: 3, invoiceId: 'INV-2001' }] } };
    const roomTotal = box.calcTax(box.RES[0]).total;
    const invTotal = +(roomTotal + box.chargeTaxInclusiveEstimate(54)).toFixed(2); // $18 x 3 pax = $54 final
    box.INV = [{ id: 'INV-2001', resId: 'R4', status: 'active', includeRoom: true, total: invTotal, paidAmount: invTotal }];
    const sum = box.folioSummary('R4');
    assert.equal(sum.balance, 0);
  });
  test('folioSummary(): a VOID invoice\'s paidAmount is excluded from "paid" -- voiding never leaves a phantom payment on the balance', () => {
    box.RES = [{ id: 'R3', rn: 'VR01', ci: '2026-09-10', co: '2026-09-11', ad: 2, ch: 0, rate: 100, src: 'Direct' }];
    box.FOLIOS = { R3: { charges: [] } };
    box.INV = [{ id: 'INV-1002', resId: 'R3', status: 'void', paidAmount: 100 }];
    const sum = box.folioSummary('R3');
    assert.equal(sum.paid, 0);
  });
}

section('Case E — unified "Create Invoice" (Steps 8-11): replaces the old duplicate Generate/Custom-invoice buttons');
{
  test('the old duplicate entry points (folioToInvoiceById, openPartialInvoice, generatePartialInvoice, piSelectAll, closePartialInv) no longer exist', () => {
    for (const name of ['folioToInvoiceById', 'openPartialInvoice', 'generatePartialInvoice', 'piSelectAll', 'closePartialInv']) {
      assert.doesNotMatch(PMS, new RegExp('function ' + name + '\\('), name + ' should have been replaced');
    }
  });
  test('Guest Folios and Calendar both wire their single "Create invoice" button to openCreateInvoice(), never two different functions', () => {
    assert.match(PMS, /onclick="openCreateInvoice\(this\.dataset\.rid\)"[^>]*><i class="ti ti-file-invoice"><\/i> Create invoice/);
    const calBtnRowIdx = PMS.indexOf("btnRow.innerHTML='<button data-rid=\"'+id+'\" onclick=\"openCreateInvoice");
    assert.ok(calBtnRowIdx !== -1, 'Calendar folio section button row must call openCreateInvoice');
  });
  test('openCreateInvoice() only lists UNINVOICED folio charges via uninvoicedChargesForPayer() (an item with .invoiceId already set is excluded), and offers all 6 Step-8 presets for the Whole Room scope: All unpaid, Room only, one per FOLIO_CATEGORIES, and Selected items (manual ticking)', () => {
    const src = extractByStart(PMS, /function openCreateInvoice\(resId,payerScope\)\s*\{/);
    assert.match(src, /uninvoicedChargesForPayer\(resId,payerScope\)/);
    assert.match(src, /ciSelectScope\(\\'all\\'\)/);
    assert.match(src, /ciSelectScope\(\\'room\\'\)/);
    assert.match(src, /FOLIO_CATEGORIES\.map/);
    // uninvoicedChargesForPayer() itself keeps the original !ch.invoiceId
    // exclusion for the Whole Room scope, unchanged.
    const filterSrc = extractByStart(PMS, /function uninvoicedChargesForPayer\(resId,payerScope\)\s*\{/);
    assert.match(filterSrc, /if\(ch\.invoiceId\) return false;/);
  });
  test('ciSelectScope(\'all\') checks every extra AND the room checkbox (Step 11: "All unpaid" is genuinely everything, one combined invoice); ciSelectScope(\'room\') unchecks every extra and checks only room (Step 10: Room only is its own distinct preset); a category scope checks only rows whose data-cat matches and leaves room untouched', () => {
    const src = extractByStart(PMS, /function ciSelectScope\(scope\)\s*\{/);
    assert.match(src, /scope==='all' \? true : scope==='room' \? false : !!\(row && row\.dataset\.cat===scope\)/);
    assert.match(src, /if\(roomChk && \(scope==='all' \|\| scope==='room'\)\) roomChk\.checked=true;/);
  });
  test('submitCreateInvoice() propagates each selected charge\'s id as chargeId into the invoice-modal draft items, and passes includeRoom through explicitly (never a separately-computed room line, which was the old double-charge bug)', () => {
    const src = extractByStart(PMS, /function submitCreateInvoice\(resId,payerScope\)\s*\{/);
    assert.match(src, /chargeId:\s*ch\.id/);
    assert.match(src, /openIM\(resId, \{items:items, includeRoom:includeRoom, payerScope:payerScope\}\)/);
  });
  test('openIM() with no opts (e.g. the Reservations-drawer\'s Invoice tab, or the Quick Bar) defaults to every UNINVOICED folio charge -- same duplicate-prevention guarantee as the scope picker', () => {
    const src = extractByStart(PMS, /function openIM\(resId, opts\)\s*\{/);
    assert.match(src, /folio\.charges\.filter\(function\(ch\)\{return !ch\.invoiceId;\}\)/);
    assert.match(src, /chargeId:ch\.id,/);
  });
}

section('Case F — the double-room-charge / naive-tax bug (audit Case 6/10) is fixed');
{
  test('niPrev() renders the room block via pbd(r)/calcTax(r) ONLY when includeRoom is checked -- when unchecked, no room total is shown or computed at all (never a second, separately-taxed room invItem)', () => {
    const src = extractByStart(PMS, /function niPrev\(\)\s*\{/);
    assert.match(src, /const includeRoom=document\.getElementById\('ni-include-room'\)/);
    assert.match(src, /const roomTotal=includeRoom\?x\.total:0;/);
    assert.match(src, /let html=includeRoom\?pbd\(r\):/);
  });
  test('genInv() zeroes base/svc/tgst/green when includeRoom is false -- an invoice that excludes the room genuinely never carries a room charge in its stored totals', () => {
    const src = extractByStart(PMS, /function genInv\(\)\s*\{/);
    assert.match(src, /base:includeRoom\?x\.base:0,svc:includeRoom\?x\.svc:0,tgst:includeRoom\?x\.tgst:0,green:includeRoom\?x\.green:0/);
    assert.match(src, /const roomTotal=includeRoom\?x\.total:0;/);
  });
  test('the invoice-modal HTML has exactly one room-charge control (#ni-include-room), and its change event re-runs niPrev() so the preview always reflects the toggle', () => {
    assert.match(PMS, /<input type="checkbox" id="ni-include-room" checked/);
    assert.match(PMS, /e\.target\.id==='ni-res'\|\|e\.target\.id==='ni-include-room'/);
  });
  test('viewInv() only renders the accommodation row when includeRoom!==false -- a room-excluded invoice\'s printed/viewed form never shows a room line either', () => {
    const src = extractByStart(PMS, /function viewInv\(id\)\s*\{/);
    assert.match(src, /\$\{v\.includeRoom!==false\?`<tr><td>\$\{v\.room\}/);
  });
}

section('Case G — invoiced-item marking prevents duplicate invoicing (Step 10/21)');
{
  test('genInv() marks every extra\'s source folio charge with .invoiceId = the new invoice id, so it can never be selected again by openCreateInvoice()/openIM()', () => {
    const src = extractByStart(PMS, /function genInv\(\)\s*\{/);
    assert.match(src, /ch\.invoiceId=v\.id;/);
  });
  test('removeFolioCharge() refuses to delete a charge that already has .invoiceId set -- staff must void the invoice first, so a charge on a printed invoice can never silently vanish from the folio', () => {
    const src = extractByStart(PMS, /function removeFolioCharge\(resId,chargeId,instanceId\)\s*\{/);
    assert.match(src, /if\(charge&&charge\.invoiceId\)\{ toast\(/);
  });
  test('voidInvoice() reverses the marking (deletes .invoiceId/.paid from every charge the voided invoice covered), making them invoiceable again -- an explicit, audited undo, never a silent one', () => {
    const src = extractByStart(PMS, /function voidInvoice\(invId\)\s*\{/);
    assert.match(src, /delete ch\.invoiceId;delete ch\.paid;/);
    assert.match(src, /v\.status='void';/);
  });
}

section('Case H — payment recording (Steps 12-13)');
{
  test('recordInvoicePayment() adds to ONE invoice\'s paidAmount/payments log and derives pay status from paidAmount vs total -- never a free-text status with no backing number', () => {
    const src = extractByStart(PMS, /function recordInvoicePayment\(invId\)\s*\{/);
    assert.match(src, /v\.paidAmount=\+\(\(v\.paidAmount\|\|0\)\+amt\)\.toFixed\(2\);/);
    assert.match(src, /v\.payments\.push\(/);
    assert.match(src, /v\.pay=v\.paidAmount>=v\.total-0\.01\?'Fully paid':'Partially paid';/);
  });
  test('recordInvoicePayment() rejects an amount exceeding the remaining balance -- a payment can never overshoot what is actually owed on that invoice', () => {
    const src = extractByStart(PMS, /function recordInvoicePayment\(invId\)\s*\{/);
    assert.match(src, /if\(amt>remaining\+0\.01\)\{toast\('Amount exceeds balance/);
  });
  test('only once an invoice reaches "Fully paid" are its covered folio charges marked .paid -- a partial payment never marks any charge paid; a guest-scoped invoice never marks the whole charge paid either (Simple guest bill split, Step 16)', () => {
    const src = extractByStart(PMS, /function recordInvoicePayment\(invId\)\s*\{/);
    assert.match(src, /if\(v\.pay==='Fully paid'&&v\.resId&&\(!v\.payerScope\|\|v\.payerScope==='whole'\)\)\{/);
    assert.match(src, /ch\.paid=true;/);
  });
}

section('Case I — void/restore, print/receipt document distinctness (Step 17)');
{
  test('voidInvoice() requires confirmation (showConfirm) before reversing -- never a one-click destructive action', () => {
    const src = extractByStart(PMS, /function voidInvoice\(invId\)\s*\{/);
    assert.match(src, /showConfirm\(\{/);
  });
  test('drawInv() visually distinguishes a void invoice (dimmed row, "Void" badge) instead of showing a misleading pay-status badge', () => {
    const src = extractByStart(PMS, /function drawInv\(\)\s*\{/);
    assert.match(src, /v\.status==='void'\?'opacity:\.5':''/);
    assert.match(src, /v\.status==='void'\?'<span class="bx er">Void<\/span>'/);
  });
  test('printFolio() (all charges + payment history), viewInv()\'s invoice print (that invoice\'s own line items only), and printReceipt() (payment proof only) are three distinct functions -- never one document type standing in for another', () => {
    assert.match(PMS, /function printFolio\(resId\)\s*\{/);
    assert.match(PMS, /function printReceipt\(invId\)\s*\{/);
    const receiptSrc = extractByStart(PMS, /function printReceipt\(invId\)\s*\{/);
    assert.doesNotMatch(receiptSrc, /extras/, 'a receipt must never list invoice line items, only payments');
    const folioSrc = extractByStart(PMS, /function printFolio\(resId\)\s*\{/);
    assert.match(folioSrc, /Payments/);
    assert.match(folioSrc, /Charges<\/h3>/);
  });
}

section('Case J — "Open full folio" (Step 15): Calendar → Guest Folios lands on the SAME reservation');
{
  test('openFullFolio() navigates to the folios section and expands the matching [data-folio-rid] card for the exact resId passed in -- never a generic "go to folios" with no target', () => {
    const src = extractByStart(PMS, /function openFullFolio\(resId\)\s*\{/);
    assert.match(src, /go\('folios',/);
    assert.match(src, /document\.querySelector\('\[data-folio-rid="'\+resId\+'"\]'\)/);
    assert.match(src, /hdrEl\.click\(\)/);
  });
  test('Calendar\'s folio section wires its "Open full folio" button to openFullFolio(id) with the SAME reservation id the drawer is currently showing', () => {
    const idx = PMS.indexOf("Open full folio");
    assert.ok(idx !== -1);
    const nearby = PMS.slice(Math.max(0, idx - 400), idx + 20);
    assert.match(nearby, /openFullFolio\(this\.dataset\.rid\)/);
  });
  test('the Reservations-drawer Invoice tab (rdRenderTab n===2 — previously showed NO folio items at all, per the audit) now also renders the same folioSummary() and offers "Open full folio"', () => {
    const idx = PMS.indexOf('} else if(n===2){');
    assert.ok(idx !== -1);
    const src = PMS.slice(idx, idx + 1600);
    assert.match(src, /renderFolioSummaryHTML\(sum,r\.id\)/);
    assert.match(src, /openFullFolio\(r\.id\)/);
  });
}

section('Case K — bill attachment (Step 6): reuses existing Storage infrastructure, admin-only limitation reported not hidden');
{
  test('uploadFolioBill() reuses the existing resizeImageToBlob()+fsStorage pattern already used for room photos -- not a new upload mechanism', () => {
    const src = extractByStart(PMS, /async function uploadFolioBill\(resId, chargeId, file\)\s*\{/);
    assert.match(src, /resizeImageToBlob\(file, 1600, 0\.85\)/);
    assert.match(src, /fsStorage\.ref\(path\)\.put\(blob/);
  });
  test('storage.rules adds folio-attachments/{resId}/{fileName} under the SAME isAdmin()+isValidImageUpload() gate as room-photos -- no new/weakened security architecture', () => {
    assert.match(SRULES, /match \/folio-attachments\/\{resId\}\/\{fileName\}\s*\{\s*allow read: if true;\s*allow write: if isAdmin\(\) && isValidImageUpload\(\);\s*\}/);
  });
  test('the admin-only limitation is explicitly documented in storage.rules\' own comment, not silently left for someone to discover later', () => {
    const idx = SRULES.indexOf('folio-attachments/{resId}/{fileName}');
    const commentBlock = SRULES.slice(Math.max(0, idx - 900), idx);
    assert.match(commentBlock, /ONLY that admin account can attach a\s*\n\s*\/\/ bill photo -- regular staff cannot/);
  });
  test('a folio charge with a billUrl renders a visible "Bill attached" link in renderFolioChargesById(), and an optional note renders in italics -- never silently dropped', () => {
    const src = extractByStart(PMS, /function renderFolioChargesById\(resId,instanceId\)\s*\{/);
    assert.match(src, /Bill attached ✓ View/);
    assert.match(src, /ch\.note/);
  });
}

console.log(`\n${passed}/${passed + failed} guest-folio-unification assertions passed`);
if (failed) { console.log('\nFAILED'); process.exit(1); }
console.log('\nALL TESTS PASSED');
