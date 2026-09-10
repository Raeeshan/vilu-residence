// Final financial integrity correction — 2026-09-10.
//
// Fixes two integrity gaps left after the Simple Guest Bill Split task:
//
// (1) folioGuestBalance()/folioSummary() compared a pre-tax "allocated/
//     chargesTotal" figure against a tax-inclusive "paid" figure (sourced
//     from real invoices, which always include tax) -- so a fully-settled
//     guest or room could show a nonzero (often negative) balance. Fixed
//     by making "Charged" invoice-aware: once a charge/room is genuinely
//     invoiced, its contribution comes from that REAL invoice's own exact
//     total (v.total); only genuinely uninvoiced charges get an ESTIMATED
//     tax-inclusive figure (chargeTaxInclusiveEstimate, the same formula
//     genInv() itself uses). Vilu's tax policy is completely unchanged.
//
// (2) Reservation price-adjustment history (priceAdjustments) was only
//     ever persisted to localStorage -- not durable. Fixed with a new,
//     append-only Firestore collection (reservation_price_adjustments),
//     written in the SAME transaction as the reservation's rate change
//     (writeReservation()'s existing runTransaction), Admin/Manager-only
//     enforced by firestore.rules (not just the UI), server timestamp
//     (FieldValue.serverTimestamp(), verified by rules against
//     request.time -- never a trusted browser clock).
//
// Same technique the rest of this suite uses: brace-match real functions
// out of vilu-unified.html and run pure ones in a vm sandbox, regex-check
// DOM-coupled/rules-coupled ones directly against source. No Firestore, no
// browser, no live reservation.
//   node test/financial-integrity.test.js
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

function buildFullSandbox() {
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
    /function chargeUninvoicedTaxInclusiveRemainder\(ch,r\)\s*\{/,
    /function uninvoicedChargesForPayer\(resId,payerScope\)\s*\{/,
    /function folioSummary\(resId\)\s*\{/,
    /function folioGuestBalance\(resId,guestKey\)\s*\{/,
  ];
  fns.forEach(re => vm.runInContext(extractByStart(PMS, re), ctx));
  const ntMatch = PMS.match(/const nt=\([^)]*\)=>[^;]+;/);
  vm.runInContext('var ' + ntMatch[0].slice('const '.length), ctx);
  vm.runInContext(extractByStart(PMS, /function calcTax\(r\)\s*\{/), ctx);
  return ctx;
}

section('Case A — root cause: one canonical, tax-inclusive money basis (Step 1/2)');
{
  test('chargeTaxInclusiveEstimate() uses the EXACT same formula genInv() applies to real invoice items (subtotal * (TAX.svc+TAX.tgst)/100, added to the subtotal) -- no second, independently-invented tax formula', () => {
    const genInvSrc = extractByStart(PMS, /function genInv\(\)\s*\{/);
    assert.match(genInvSrc, /taxAmt=i\.tax\?\+\(subtotal\*\(TAX\.svc\+TAX\.tgst\)\/100\)\.toFixed\(2\):0/);
    const estSrc = extractByStart(PMS, /function chargeTaxInclusiveEstimate\(amt\)\s*\{/);
    assert.match(estSrc, /amt\*\(TAX\.svc\+TAX\.tgst\)\/100/);
  });
  test('folioSummary()/folioGuestBalance() source "Charged" from the REAL invoice total (v.total) for anything already invoiced -- never recomputed -- and only ESTIMATE tax for what is genuinely still uninvoiced', () => {
    const summarySrc = extractByStart(PMS, /function folioSummary\(resId\)\s*\{/);
    assert.match(summarySrc, /invoicedTotal=\+invoicesForRes\.reduce\(function\(s,v\)\{return s\+\(v\.total\|\|0\);\},0\)/);
    // folioSummary() sums chargeUninvoicedTaxInclusiveRemainder() over every
    // charge -- deliberately NOT uninvoicedChargesForPayer('whole') (that
    // one answers "is this charge eligible for a brand-new Whole Room
    // invoice", which correctly excludes a charge entirely once ANY guest
    // has invoiced part of it; the aggregate BALANCE must still count the
    // other guests' still-open shares of that same charge).
    assert.match(summarySrc, /folio\.charges\.reduce\(function\(s,ch\)\{return s\+chargeUninvoicedTaxInclusiveRemainder\(ch,r\);\},0\)/);
    const guestSrc = extractByStart(PMS, /function folioGuestBalance\(resId,guestKey\)\s*\{/);
    assert.match(guestSrc, /invoicedTotal=\+invoicesForGuest\.reduce\(function\(s,v\)\{return s\+\(v\.total\|\|0\);\},0\)/);
    assert.match(guestSrc, /uninvoicedChargesForPayer\(resId,guestKey\)/);
  });
  test('chargeUninvoicedTaxInclusiveRemainder() correctly handles a split charge PARTIALLY invoiced to one guest -- the other guests\' still-open shares are still counted, never silently dropped from the whole-reservation balance', () => {
    const src = extractByStart(PMS, /function chargeUninvoicedTaxInclusiveRemainder\(ch,r\)\s*\{/);
    assert.match(src, /if\(ch\.invoiceId\) return 0;/);
    assert.match(src, /alreadyInvoiced\?s:s\+chargeAmountForGuestTaxInclusive\(ch,r,g\.key\)/);
  });
  test('splitCentsDeterministic() is the ONE shared integer-cents allocator, reused by both the pre-tax guest split (chargeSplitAllocations) and the tax-inclusive balance estimate (chargeAmountForGuestTaxInclusive) -- never two independent split formulas', () => {
    const splitSrc = extractByStart(PMS, /function chargeSplitAllocations\(ch,r\)\s*\{/);
    assert.match(splitSrc, /splitCentsDeterministic\(chargeFinalAmount\(ch\),labels\.length\)/);
    const taxSplitSrc = extractByStart(PMS, /function chargeAmountForGuestTaxInclusive\(ch,r,guestKey\)\s*\{/);
    assert.match(taxSplitSrc, /splitCentsDeterministic\(chargeTaxInclusiveEstimate\(chargeFinalAmount\(ch\)\),labels\.length\)/);
    const centsSrc = extractByStart(PMS, /function splitCentsDeterministic\(totalAmount,n\)\s*\{/);
    assert.match(centsSrc, /Math\.round\(totalAmount\*100\)/); // integer cents, per Step 2
  });
}

section('Case B — guest fully paid = exactly $0.00 (Step 4)');
{
  const ctx = buildFullSandbox();
  test('a guest\'s invoice total = $21.06, paid in full: balance = exactly $0.00 (never -$3.06/-$0.01/$0.01)', () => {
    ctx.r = { fn: 'A', ad: 3, ch: 0 };
    ctx.RES = [{ id: 'R1', fn: 'A', ad: 3, ch: 0, rn: 'VR01', ci: '2026-10-01', co: '2026-10-02', rate: 90 }];
    ctx.FOLIOS = { R1: { charges: [] } }; // everything already invoiced -- nothing left uninvoiced
    ctx.INV = [{ id: 'INV-1', resId: 'R1', status: 'active', payerScope: 'guest1', total: 21.06, paidAmount: 21.06 }];
    const gb = vm.runInContext(`folioGuestBalance('R1','guest1')`, ctx);
    assert.equal(gb.charged, 21.06);
    assert.equal(gb.paid, 21.06);
    assert.equal(gb.balance, 0);
  });
  test('a split charge PARTIALLY invoiced to one guest: the whole-reservation balance still counts the OTHER guests\' still-open shares -- caught live during this task\'s own QA (folioSummary() was silently dropping them entirely once any single guest invoiced their portion)', () => {
    ctx.RES = [{ id: 'R5', fn: 'Lead', ad: 3, ch: 0, rn: 'VR01', ci: '2026-10-01', co: '2026-10-02', rate: 0 }];
    const dinner = { id: 1, cat: 'Food & Beverage', price: 18, qty: 3, payerType: 'split' };
    ctx.FOLIOS = { R5: { charges: [dinner] } };
    ctx.dinner = dinner;
    const wholeTaxInclusive = vm.runInContext('chargeTaxInclusiveEstimate(chargeFinalAmount(dinner))', ctx);
    const guest1Share = vm.runInContext(`chargeAmountForGuestTaxInclusive(dinner,RES[0],'guest1')`, ctx);
    // ad:3 (gp>2) still carries a nonzero 3rd-guest supplement + Green Tax
    // even with rate:0 -- calcTax() itself, unchanged, still applies both
    // regardless of the nightly rate, so the room contributes its own real
    // (nonzero) total here too, exactly as it would live.
    const roomTotal = vm.runInContext(`calcTax(RES[0]).total`, ctx);
    dinner.guestInvoiced = { guest1: 'INV-9' }; // ONLY guest1's share has been invoiced so far
    ctx.INV = [{ id: 'INV-9', resId: 'R5', status: 'active', payerScope: 'guest1', total: guest1Share, paidAmount: guest1Share }];
    const sum = vm.runInContext(`folioSummary('R5')`, ctx);
    // chargesTotal must be guest1's real invoice total, PLUS guest2/3's
    // still-uninvoiced tax-inclusive shares, PLUS the (not yet invoiced)
    // room -- not just guest1's invoice total alone, which would silently
    // make guest2/3's money (and the room) disappear from the whole-
    // reservation view.
    const guest2and3Remainder = +(wholeTaxInclusive - guest1Share).toFixed(2);
    assert.equal(sum.chargesTotal, +(guest1Share + guest2and3Remainder + roomTotal).toFixed(2));
    assert.ok(sum.balance > 0, 'guest2/3 (and the room) still owe their shares -- balance must not be zero or negative');
  });
}

section('Case C — whole room fully paid = exactly $0.00 (Step 4)');
{
  const ctx = buildFullSandbox();
  test('a whole-room invoice covering everything (room + all extras), paid in full: balance = exactly $0.00', () => {
    ctx.RES = [{ id: 'R2', fn: 'A', ad: 1, ch: 0, rn: 'VR01', ci: '2026-10-01', co: '2026-10-02', rate: 90 }];
    ctx.FOLIOS = { R2: { charges: [{ id: 1, cat: 'Food & Beverage', price: 18, qty: 2, invoiceId: 'INV-2' }] } };
    ctx.INV = [{ id: 'INV-2', resId: 'R2', status: 'active', includeRoom: true, total: 150.00, paidAmount: 150.00 }];
    const sum = vm.runInContext(`folioSummary('R2')`, ctx);
    assert.equal(sum.balance, 0);
  });
}

section('Case D — partial payment (Step 5)');
{
  const ctx = buildFullSandbox();
  test('invoice $100, paid $40: balance $60 -- reflected identically whether read from the invoice or the guest/room folio', () => {
    ctx.RES = [{ id: 'R3', fn: 'A', ad: 1, ch: 0, rn: 'VR01', ci: '2026-10-01', co: '2026-10-02', rate: 0 }];
    ctx.FOLIOS = { R3: { charges: [] } };
    ctx.INV = [{ id: 'INV-3', resId: 'R3', status: 'active', payerScope: 'guest1', total: 100, paidAmount: 40 }];
    const gb = vm.runInContext(`folioGuestBalance('R3','guest1')`, ctx);
    assert.equal(gb.charged, 100);
    assert.equal(gb.paid, 40);
    assert.equal(gb.balance, 60);
  });
}

section('Case E — 2-way and 3-way tax-inclusive split allocation, deterministic rounding (Step 3/11)');
{
  const ctx = buildFullSandbox();
  test('tax-inclusive total $100/3 (a whole-charge final of ~$78.74 pre-tax) reconciles exactly across 3 guests -- no cent mismatch', () => {
    ctx.r = { fn: 'A', ad: 3, ch: 0 };
    // Pick a pre-tax final amount whose tax-inclusive total is exactly $100.00
    const preTax = +(100 / 1.27).toFixed(2);
    ctx.ch = { price: preTax, pax: 1, payerType: 'split' };
    const g1 = vm.runInContext(`chargeAmountForGuestTaxInclusive(ch,r,'guest1')`, ctx);
    const g2 = vm.runInContext(`chargeAmountForGuestTaxInclusive(ch,r,'guest2')`, ctx);
    const g3 = vm.runInContext(`chargeAmountForGuestTaxInclusive(ch,r,'guest3')`, ctx);
    const wholeTaxInclusive = vm.runInContext(`chargeTaxInclusiveEstimate(chargeFinalAmount(ch))`, ctx);
    assert.equal(+(g1 + g2 + g3).toFixed(2), wholeTaxInclusive);
  });
  test('2-way tax-inclusive split of a $90 pre-tax charge ($114.30 tax-inclusive) is exactly $57.15/$57.15, no remainder', () => {
    ctx.r = { fn: 'A', ad: 2, ch: 0 };
    ctx.ch = { price: 90, pax: 1, payerType: 'split' };
    const g1 = vm.runInContext(`chargeAmountForGuestTaxInclusive(ch,r,'guest1')`, ctx);
    const g2 = vm.runInContext(`chargeAmountForGuestTaxInclusive(ch,r,'guest2')`, ctx);
    assert.equal(g1, 57.15);
    assert.equal(g2, 57.15);
  });
}

section('Case F — discount + split + tax composition (Step 3/10)');
{
  const ctx = buildFullSandbox();
  test('$100 gross, 10% discount = $90 final, THEN taxed and split 3 ways -- discount is applied before tax, tax before split, matching genInv()\'s own ordering', () => {
    ctx.r = { fn: 'A', ad: 3, ch: 0 };
    ctx.ch = { price: 100, pax: 1, discountType: 'percent', discountValue: 10, payerType: 'split' };
    const final = vm.runInContext('chargeFinalAmount(ch)', ctx);
    assert.equal(final, 90); // discount applied first
    const taxInclusive = vm.runInContext('chargeTaxInclusiveEstimate(chargeFinalAmount(ch))', ctx);
    assert.equal(taxInclusive, 114.30); // 90 * 1.27, tax on the DISCOUNTED amount, never the pre-discount gross
    const g1 = vm.runInContext(`chargeAmountForGuestTaxInclusive(ch,r,'guest1')`, ctx);
    const g2 = vm.runInContext(`chargeAmountForGuestTaxInclusive(ch,r,'guest2')`, ctx);
    const g3 = vm.runInContext(`chargeAmountForGuestTaxInclusive(ch,r,'guest3')`, ctx);
    assert.equal(+(g1 + g2 + g3).toFixed(2), taxInclusive); // splits sum exactly to the taxed, discounted total
  });
}

section('Case G — invoice-level discount and no double tax (Step 13)');
{
  test('the invoice-level discount (ni-disc) is still subtracted AFTER extra-charge tax (unchanged ordering, audited not guessed) -- this task does not touch Vilu\'s tax policy', () => {
    const niPrevSrc = extractByStart(PMS, /function niPrev\(\)\s*\{/);
    const eTaxIdx = niPrevSrc.indexOf('eTax');
    const discIdx = niPrevSrc.indexOf('invDiscountAmount');
    assert.ok(eTaxIdx !== -1 && discIdx !== -1 && eTaxIdx < discIdx, 'extra tax must still be computed before the invoice discount call');
  });
  test('no double tax: a charge\'s tax is computed exactly once -- either by the real invoice (genInv()\'s own per-item formula) once invoiced, or by chargeTaxInclusiveEstimate() as an estimate before invoicing, never both contributing to the same "Charged" total simultaneously', () => {
    // chargeUninvoicedTaxInclusiveRemainder() (fed into folioSummary()'s
    // tax-inclusive ESTIMATE) itself returns 0 for any charge already
    // carrying an invoiceId -- so an invoiced charge's tax is never
    // estimated a second time on top of its real invoice's contribution.
    const remainderSrc = extractByStart(PMS, /function chargeUninvoicedTaxInclusiveRemainder\(ch,r\)\s*\{/);
    assert.match(remainderSrc, /if\(ch\.invoiceId\) return 0;/);
    const summarySrc = extractByStart(PMS, /function folioSummary\(resId\)\s*\{/);
    assert.match(summarySrc, /chargeUninvoicedTaxInclusiveRemainder\(ch,r\)/);
  });
}

section('Case H — durable price-adjustment audit trail: storage, atomicity, actor consistency (Step 6/7/9)');
{
  test('writeReservation() writes the reservation update AND the price-adjustment audit record in the SAME Firestore transaction -- either both commit or neither does (Step 9)', () => {
    const src = extractByStart(PMS, /async function writeReservation\(docId, fields, opts\)\s*\{/);
    const transactionStart = src.indexOf('await fsDb.runTransaction');
    const auditTransactionSetIdx = src.indexOf('transaction.set(priceAdjRef,');
    assert.ok(transactionStart !== -1 && auditTransactionSetIdx !== -1 && auditTransactionSetIdx > transactionStart, 'transaction.set(priceAdjRef,...) must appear inside runTransaction, after it starts');
    assert.match(src, /transaction\.set\(resRef, fields, \{ merge: true \}\);/); // the reservation write itself, same transaction
  });
  test('the audit record uses FieldValue.serverTimestamp() for changedAt -- never Date.now() or a client Date (Step 7: canonical server time, not a trusted browser clock)', () => {
    const src = extractByStart(PMS, /async function writeReservation\(docId, fields, opts\)\s*\{/);
    assert.match(src, /changedAt: firebase\.firestore\.FieldValue\.serverTimestamp\(\)/);
  });
  test('changedByUid comes from the real Firebase Auth session (firebase.auth().currentUser.uid), never from currentUser (which carries no uid) -- so the audit trail always records a genuine, verifiable actor', () => {
    const src = extractByStart(PMS, /async function saveEdit\(\)\s*\{/);
    assert.match(src, /changedByUid:firebase\.auth\(\)\.currentUser\?firebase\.auth\(\)\.currentUser\.uid:null/);
  });
  test('firestore.rules requires changedAt to equal request.time (the server-authoritative commit time) -- a client cannot spoof this field even if it tried, not just a client-side convention', () => {
    const idx = RULES.indexOf('match /reservation_price_adjustments/{id}');
    assert.ok(idx !== -1, 'reservation_price_adjustments rule block not found');
    const block = RULES.slice(idx, RULES.indexOf('\n    }', idx));
    assert.match(block, /request\.resource\.data\.changedAt == request\.time/);
  });
  test('the audit collection is genuinely append-only at the rules level: update and delete are both denied unconditionally', () => {
    const idx = RULES.indexOf('match /reservation_price_adjustments/{id}');
    const block = RULES.slice(idx, RULES.indexOf('\n    }', idx));
    assert.match(block, /allow update, delete: if false;/);
  });
  test('a NEW price adjustment concatenates onto the existing client-local array (never overwrites prior entries) -- the durable Firestore record is likewise a fresh document per adjustment (fsDb.collection(...).doc(), an auto-id), never overwriting a previous one', () => {
    const src = extractByStart(PMS, /async function saveEdit\(\)\s*\{/);
    assert.match(src, /updated\.priceAdjustments=\(r\.priceAdjustments\|\|\[\]\)\.concat\(\[priceAdjustment\]\);/);
    const writeSrc = extractByStart(PMS, /async function writeReservation\(docId, fields, opts\)\s*\{/);
    assert.match(writeSrc, /var priceAdjRef = priceAdjustment \? fsDb\.collection\('reservation_price_adjustments'\)\.doc\(\) : null;/);
  });
}

section('Case I — price-adjustment permissions: Admin allowed, Manager allowed, Staff denied at the data layer (Step 8)');
{
  test('firestore.rules create rule requires isAdmin() || isManagerRole() -- isStaff() alone is never sufficient, enforced server-side not just by hiding the UI control', () => {
    const idx = RULES.indexOf('match /reservation_price_adjustments/{id}');
    const block = RULES.slice(idx, RULES.indexOf('\n    }', idx));
    assert.match(block, /allow create: if \(isAdmin\(\) \|\| isManagerRole\(\)\)/);
    // isStaff() must not appear as an alternative in the create condition
    const createClause = block.slice(block.indexOf('allow create:'), block.indexOf('allow update'));
    assert.doesNotMatch(createClause, /isStaff\(\)/);
  });
  test('a rogue write attempting to forge changedByUid as someone else is rejected -- the rule requires it to equal the authenticated caller', () => {
    const idx = RULES.indexOf('match /reservation_price_adjustments/{id}');
    const block = RULES.slice(idx, RULES.indexOf('\n    }', idx));
    assert.match(block, /request\.resource\.data\.changedByUid == request\.auth\.uid/);
  });
  test('canAdjustRoomPrice() (the client-side gate feeding this whole flow) is Admin/Manager only, matching the server-side rule exactly -- Staff never even attempts to construct a priceAdjustment payload', () => {
    const src = extractByStart(PMS, /function canAdjustRoomPrice\(\)\s*\{/);
    assert.match(src, /role === 'admin'/);
    assert.match(src, /role === 'manager'/);
    assert.doesNotMatch(src, /role === 'staff'/);
  });
}

section('Case J — public rate and package isolation (Step 10, DO NOT TOUCH)');
{
  test('the reservation_price_adjustments rule block never references room_prices, ota_room_type_overrides, packages, agency_packages, or any OTA/Beds24 collection', () => {
    const idx = RULES.indexOf('match /reservation_price_adjustments/{id}');
    const block = RULES.slice(idx, RULES.indexOf('\n    }', idx));
    assert.doesNotMatch(block, /room_prices/);
    assert.doesNotMatch(block, /ota_/i);
    assert.doesNotMatch(block, /packages/);
    assert.doesNotMatch(block, /beds24/i);
  });
  test('writeReservation()\'s price-adjustment write only ever touches reservations/{docId} and reservation_price_adjustments/{autoId} -- never room_prices, ota_room_type_overrides, or packages', () => {
    const src = extractByStart(PMS, /async function writeReservation\(docId, fields, opts\)\s*\{/);
    assert.doesNotMatch(src, /room_prices/);
    assert.doesNotMatch(src, /ota_room_type_overrides/);
    assert.doesNotMatch(src, /collection\('packages'\)/);
  });
  test('none of the new financial-basis functions (folioSummary, folioGuestBalance, chargeTaxInclusiveEstimate, chargeAmountForGuestTaxInclusive) reference Beds24, Cloudbeds, OTA collections, room_prices, or package pricing', () => {
    const fns = ['folioSummary', 'folioGuestBalance', 'chargeTaxInclusiveEstimate', 'chargeAmountForGuestTaxInclusive']
      .map(fn => extractByStart(PMS, new RegExp('function ' + fn + '\\([^)]*\\)\\s*\\{'))).join('\n');
    assert.doesNotMatch(fns, /beds24/i);
    assert.doesNotMatch(fns, /ota_/i);
    assert.doesNotMatch(fns, /room_prices/);
    assert.doesNotMatch(fns, /\bPKGS\b/);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
