// Fixed Price Catalog tax-treatment upgrade — 2026-09-11.
//
// Owner clarification: catalog/activity prices are normally entered as the
// FINAL selling price (Service Charge + TGST already inside). The PMS must
// stop adding tax again on top unless an item is explicitly marked
// TAX_EXCLUDED. Green Tax is untouched by this setting (reservation/guest-
// night based, computed only by calcTax()/calcTaxGeneral()).
//
// Same technique as the rest of this suite: brace-match real functions out
// of vilu-unified.html and run them in a vm sandbox (functional/numeric
// checks), or regex-check source directly (structural/wiring/isolation
// checks). No Firestore, no browser, no live reservation.
//   node test/catalog-tax-treatment.test.js
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

// ── sandbox: the pure calculation engine ──
const taxDefaultSrc = extractByStart(PMS, /let TAX=\{tgst:17/).replace(/^let TAX=/, 'var TAX=');
const catalogItemPriceTaxModeSrc = extractByStart(PMS, /function catalogItemPriceTaxMode\(item\)\s*\{/);
const calcServiceLineTaxSrc = extractByStart(PMS, /function calcServiceLineTax\(amount, priceTaxMode\)\s*\{/);
const calcInvoiceExtrasSrc = extractByStart(PMS, /function calcInvoiceExtras\(items, fx\)\s*\{/);
const chargeGrossAmountSrc = extractByStart(PMS, /function chargeGrossAmount\(ch\)\s*\{/);
const chargeDiscountAmountSrc = extractByStart(PMS, /function chargeDiscountAmount\(ch\)\s*\{/);
const chargeFinalAmountSrc = extractByStart(PMS, /function chargeFinalAmount\(ch\)\s*\{/);
const chargeTaxInclusiveEstimateSrc = extractByStart(PMS, /function chargeTaxInclusiveEstimate\(ch\)\s*\{/);

function makeSandbox() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext([
    taxDefaultSrc, catalogItemPriceTaxModeSrc, calcServiceLineTaxSrc, calcInvoiceExtrasSrc,
    chargeGrossAmountSrc, chargeDiscountAmountSrc, chargeFinalAmountSrc, chargeTaxInclusiveEstimateSrc
  ].join('\n'), sandbox);
  return sandbox;
}
const sb = makeSandbox();

const CURRENT_18_ACTIVITIES = [
  ['Big Game Fishing', 120], ['Sandbank Escape', 89], ['Nurse Shark Snorkeling', 89],
  ['Whale Shark Snorkeling', 85], ['Manta Ray Snorkeling', 85], ['Dolphin Cruise', 75],
  ['Turtle Snorkeling', 65], ['Octopus Hunting Experience', 65], ['Lobster Hunting Experience', 65],
  ['Sunset Cruise', 59], ['Picnic Island Experience', 49], ['Night Fishing Experience', 49],
  ['Fenfushi Reef Snorkeling', 45], ['Dhiddhoo Reef Snorkeling', 45], ['Ariyadhoo Reef Snorkeling', 45],
  ['Professional Photography', 25], ['Romantic Beach Dinner', 85], ['Cinema at the Beach', 50],
];

section('Case A — catalog data model (Part A): priceTaxMode field, safe fallback');
{
  test('catalogItemPriceTaxMode(): an item with an explicit priceTaxMode always wins, regardless of category', () => {
    const r = vm.runInContext(`catalogItemPriceTaxMode({category:'FOOD_BEVERAGE', priceTaxMode:'TAX_INCLUDED'})`, sb);
    assert.equal(r, 'TAX_INCLUDED');
  });
  test('catalogItemPriceTaxMode(): Trips & Activities with NO field yet falls back to TAX_INCLUDED (matches the owner\'s actual convention)', () => {
    const r = vm.runInContext(`catalogItemPriceTaxMode({category:'TRIPS_ACTIVITIES'})`, sb);
    assert.equal(r, 'TAX_INCLUDED');
  });
  test('catalogItemPriceTaxMode(): every OTHER category with no field yet falls back to TAX_EXCLUDED -- historical behavior preserved, never blindly changed (Part E)', () => {
    ['FOOD_BEVERAGE', 'TRANSFER', 'ACCOMMODATION_EXTRA', 'OTHER_SERVICE'].forEach(cat => {
      const r = vm.runInContext(`catalogItemPriceTaxMode({category:'${cat}'})`, sb);
      assert.equal(r, 'TAX_EXCLUDED', cat + ' should fall back to TAX_EXCLUDED');
    });
  });
  test('firestore.rules: service_catalog validates priceTaxMode only when present, backward-compatible with items that have none', () => {
    const block = ruleBlock(RULES, 'match /service_catalog/{itemId}');
    assert.match(block, /priceTaxMode in \['TAX_INCLUDED','TAX_EXCLUDED'\]/);
    assert.match(block, /!\('priceTaxMode' in request\.resource\.data\)/);
  });
}

section('Case B — Price Manager UI (Part C/D/Q)');
{
  test('catalog item editor has a "Price treatment" select with the two clear options (not the ambiguous "Taxes added")', () => {
    assert.match(PMS, /<label>Price treatment<\/label><select id="cim-taxmode"/);
    assert.match(PMS, /<option value="TAX_INCLUDED">Tax included<\/option>/);
    assert.match(PMS, /<option value="TAX_EXCLUDED">Tax excluded<\/option>/);
    assert.doesNotMatch(PMS, />Taxes added</);
  });
  test('cimUpdateTaxModeHint() spells out exactly what each option means', () => {
    const src = extractByStart(PMS, /function cimUpdateTaxModeHint\(\)\s*\{/);
    assert.match(src, /already includes Service Charge \+ TGST/);
    assert.match(src, /will be added on top/);
  });
  test('new Trips & Activities item defaults to Tax included (Part D); switching category in ADD mode updates the default, but never clobbers an item already being edited', () => {
    const src = extractByStart(PMS, /function cimCategoryChanged\(\)\s*\{/);
    assert.match(src, /if\(_catalogEditingId\) return;/);
    assert.match(src, /TRIPS_ACTIVITIES.*TAX_INCLUDED.*TAX_EXCLUDED/);
  });
  test('saveCatalogItem() persists priceTaxMode to Firestore and the in-memory SVC_CATALOG mirror', () => {
    const src = extractByStart(PMS, /async function saveCatalogItem\(\)\s*\{/);
    assert.match(src, /var priceTaxMode=document\.getElementById\('cim-taxmode'\)\.value;/);
    assert.match(src, /priceTaxMode:priceTaxMode/);
  });
  test('drawServiceCatalog() shows a compact "$X / unit · Tax included|excluded" badge per item, and an All/Included/Excluded filter (Part Q)', () => {
    const badgeSrc = extractByStart(PMS, /function catalogTaxModeBadge\(item\)\s*\{/);
    assert.match(badgeSrc, /Tax included/);
    assert.match(badgeSrc, /Tax excluded/);
    assert.match(PMS, /id="svc-cat-filter"/);
    assert.match(PMS, /setSvcCatFilter\('TAX_INCLUDED'\)/);
    assert.match(PMS, /setSvcCatFilter\('TAX_EXCLUDED'\)/);
  });
}

section('Case C — the 18 current activity prices migrate to TAX_INCLUDED, prices untouched (Part B/R)');
{
  const migrationSrc = extractByStart(PMS, /async function migrateCatalogAddPriceTaxMode2026\(\)\s*\{/);
  test('migration touches ONLY the named 18 current activities, matching the owner\'s exact list', () => {
    CURRENT_18_ACTIVITIES.forEach(([name]) => {
      assert.match(migrationSrc, new RegExp(`'${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`), `missing from migration list: ${name}`);
    });
    // Exactly 18 -- not more, not fewer.
    const listMatch = migrationSrc.match(/CURRENT_ACTIVITY_PRICES_2026\s*=\s*\[([\s\S]*?)\];/);
    const count = (listMatch[1].match(/'[^']+'/g) || []).length;
    assert.equal(count, 18);
  });
  test('migration sets ONLY priceTaxMode -- never basePrice/name/unitType (Part R: "do not alter unless required")', () => {
    assert.match(migrationSrc, /\.set\(\{priceTaxMode:'TAX_INCLUDED', updatedAt:now\}, \{merge:true\}\)/);
    assert.doesNotMatch(migrationSrc, /basePrice:/);
  });
  test('migration is idempotent -- an item already TAX_INCLUDED is skipped, not rewritten', () => {
    assert.match(migrationSrc, /if \(item\.priceTaxMode==='TAX_INCLUDED'\) \{ log\.alreadyDone\.push/);
  });
  test('migration is Admin/Manager gated, same authority as every other catalog-management action', () => {
    assert.match(migrationSrc, /if\(!canManageCatalog\(\)\)\{ console\.warn/);
  });
  test('the 4 already-inactive legacy items (Snorkeling, Fishing Trip, Island Hopping, Night Snorkeling) are never in the migration list -- they are historical, not current pricing', () => {
    ['Snorkeling', 'Fishing Trip', 'Island Hopping', 'Night Snorkeling'].forEach(name => {
      // Exact single-quoted match only (avoid matching inside comments/substrings of other names)
      const re = new RegExp(`'${name}'(?!\\s*Escape)`);
      // These must not appear as a bare list entry inside CURRENT_ACTIVITY_PRICES_2026
      const listMatch = migrationSrc.match(/CURRENT_ACTIVITY_PRICES_2026\s*=\s*\[([\s\S]*?)\];/)[1];
      assert.doesNotMatch(listMatch, new RegExp(`'${name}'`));
    });
  });
}

section('Case D — canonical per-line tax calculation (Part I/J): compound Base->Service->TGST-on-(base+service)');
{
  test('calcServiceLineTax is the SAME compounding order calcTaxGeneral() already uses for the room (1.10 x 1.17 = 1.287), not a flat 27% shortcut', () => {
    assert.match(calcServiceLineTaxSrc, /svc=\+\(base\*svcRate\)\.toFixed\(2\)/);
    assert.match(calcServiceLineTaxSrc, /tgst=\+\(\(base\+svc\)\*tgstRate\)\.toFixed\(2\)/);
    assert.doesNotMatch(calcServiceLineTaxSrc, /svc\+tgst.*100|\(TAX\.svc\+TAX\.tgst\)/);
  });
  test('PART I worked example: Whale Shark $85, Tax included -> base ~= $66.05, and base+svc+tgst reconciles to EXACTLY $85.00', () => {
    const r = vm.runInContext(`calcServiceLineTax(85, 'TAX_INCLUDED')`, sb);
    assert.equal(r.base, 66.05);
    assert.equal(+(r.base + r.svc + r.tgst).toFixed(2), 85.00);
    assert.equal(r.final, 85);
  });
  test('PART J worked example: Whale Shark $85, Tax excluded -> Service $8.50, TGST $15.90 (17% of $93.50), Final $109.40', () => {
    const r = vm.runInContext(`calcServiceLineTax(85, 'TAX_EXCLUDED')`, sb);
    assert.equal(r.base, 85);
    assert.equal(r.svc, 8.50);
    assert.equal(r.tgst, 15.90);
    assert.equal(r.final, 109.40);
  });
  test('$85 tax included = $85 final (never re-taxed)', () => {
    assert.equal(vm.runInContext(`calcServiceLineTax(85, 'TAX_INCLUDED').final`, sb), 85);
  });
  test('$85 tax excluded > $85 (tax genuinely added on top)', () => {
    assert.ok(vm.runInContext(`calcServiceLineTax(85, 'TAX_EXCLUDED').final`, sb) > 85);
  });
  test('missing/unknown priceTaxMode falls back to TAX_EXCLUDED math (historical safety, Part S)', () => {
    const withUndefined = vm.runInContext(`calcServiceLineTax(85, undefined)`, sb);
    const withExcluded = vm.runInContext(`calcServiceLineTax(85, 'TAX_EXCLUDED')`, sb);
    assert.deepEqual(plain(withUndefined), plain(withExcluded));
  });
}

section('Case E — calcInvoiceExtras(): per-line mode-aware, quantity, discount-ordering, USD/MVR, mixed invoice (Part K/L/N/O)');
{
  test('2 pax Whale Shark @ $85, Tax included -> line total remains EXACTLY $170 (not re-taxed for quantity)', () => {
    const r = vm.runInContext(`calcInvoiceExtras([{desc:'Whale Shark Snorkeling',qty:2,unit:85,tax:true,priceTaxMode:'TAX_INCLUDED'}], 1)`, sb);
    assert.equal(r.extras[0].total, 170);
    assert.equal(r.eT, 170);
  });
  test('2 pax Whale Shark @ $85, Tax excluded -> Service+TGST added on top, more than $170', () => {
    const r = vm.runInContext(`calcInvoiceExtras([{desc:'Whale Shark Snorkeling',qty:2,unit:85,tax:true,priceTaxMode:'TAX_EXCLUDED'}], 1)`, sb);
    assert.ok(r.extras[0].total > 170);
    assert.equal(r.extras[0].total, +(170 * 1.287).toFixed(2));
  });
  test('mixed-mode invoice (Part L): one Tax included line + one Tax excluded line -- each follows its own rule independently, invoice reconciles exactly', () => {
    const items = [
      { desc: 'Whale Shark Snorkeling', qty: 2, unit: 85, tax: true, priceTaxMode: 'TAX_INCLUDED' },
      { desc: 'Airport Transfer', qty: 1, unit: 60, tax: true, priceTaxMode: 'TAX_EXCLUDED' },
    ];
    const r = vm.runInContext(`calcInvoiceExtras(${JSON.stringify(items)}, 1)`, sb);
    const included = r.extras.find(e => e.priceTaxMode === 'TAX_INCLUDED');
    const excluded = r.extras.find(e => e.priceTaxMode === 'TAX_EXCLUDED');
    assert.equal(included.total, 170);
    assert.equal(excluded.total, +(60 * 1.287).toFixed(2));
    assert.equal(r.eT, +(included.total + excluded.total).toFixed(2));
  });
  test('discount ordering (Part N): entered price -> qty -> item-level discount -> THEN tax mode applied; never tax-then-discount-then-tax-again', () => {
    // calcInvoiceExtras itself has no per-item discount (that lives on
    // folio charges, tested in Case F) -- verify instead that its input IS
    // the post-fx, pre-tax subtotal, and tax is derived from that subtotal
    // exactly once, never reapplied to an already-taxed figure.
    const r = vm.runInContext(`calcInvoiceExtras([{desc:'X',qty:1,unit:100,tax:true,priceTaxMode:'TAX_EXCLUDED'}], 1)`, sb);
    const singlePass = vm.runInContext(`calcServiceLineTax(100, 'TAX_EXCLUDED')`, sb);
    assert.equal(r.extras[0].total, singlePass.final);
  });
  test('currency conversion (Part O): USD vs MVR changes the NUMBERS via fx, never whether a price is included/excluded', () => {
    const usd = vm.runInContext(`calcInvoiceExtras([{desc:'Whale Shark Snorkeling',qty:1,unit:85,tax:true,priceTaxMode:'TAX_INCLUDED'}], 1)`, sb);
    const mvr = vm.runInContext(`calcInvoiceExtras([{desc:'Whale Shark Snorkeling',qty:1,unit:85,tax:true,priceTaxMode:'TAX_INCLUDED'}], 15.42)`, sb);
    assert.equal(usd.extras[0].priceTaxMode, 'TAX_INCLUDED');
    assert.equal(mvr.extras[0].priceTaxMode, 'TAX_INCLUDED');
    assert.equal(usd.extras[0].unitUsd, 85);
    assert.equal(mvr.extras[0].unitUsd, 85);
    assert.notEqual(usd.extras[0].total, mvr.extras[0].total);
    assert.equal(mvr.extras[0].total, +(85 * 15.42).toFixed(2));
  });
  test('a Tax included line\'s decomposed Service/TGST are informational only -- never added into eTax (the amount actually charged on top)', () => {
    const r = vm.runInContext(`calcInvoiceExtras([{desc:'Whale Shark Snorkeling',qty:1,unit:85,tax:true,priceTaxMode:'TAX_INCLUDED'}], 1)`, sb);
    assert.equal(r.eTax, 0);
    assert.ok(r.extras[0].svcAmt > 0 && r.extras[0].tgstAmt > 0, 'decomposition should still be present for display');
  });
  test('a fully non-taxable line (tax:false) bypasses priceTaxMode entirely regardless of value -- pre-existing behavior preserved', () => {
    const r = vm.runInContext(`calcInvoiceExtras([{desc:'Cash advance repayment',qty:1,unit:50,tax:false,priceTaxMode:'TAX_INCLUDED'}], 1)`, sb);
    assert.equal(r.extras[0].total, 50);
    assert.equal(r.eTax, 0);
  });
  test('eSubtotal + eTax reconciles to eT even on a mixed invoice (additive invariant used by the invoice summary rows)', () => {
    const items = [
      { desc: 'Whale Shark Snorkeling', qty: 2, unit: 85, tax: true, priceTaxMode: 'TAX_INCLUDED' },
      { desc: 'Airport Transfer', qty: 1, unit: 60, tax: true, priceTaxMode: 'TAX_EXCLUDED' },
      { desc: 'Untaxed line', qty: 1, unit: 10, tax: false, priceTaxMode: 'TAX_EXCLUDED' },
    ];
    const r = vm.runInContext(`calcInvoiceExtras(${JSON.stringify(items)}, 1)`, sb);
    assert.equal(+(r.eSubtotal + r.eTax).toFixed(2), r.eT);
  });
}

section('Case F — folio charge: per-charge snapshot, immutability, discount ordering (Part F/G/N)');
{
  test('chargeTaxInclusiveEstimate(ch) uses the charge\'s OWN snapshotted priceTaxMode, falling back to TAX_EXCLUDED for a charge that predates this feature', () => {
    const included = vm.runInContext(`chargeTaxInclusiveEstimate({price:85, pax:1, priceTaxMode:'TAX_INCLUDED'})`, sb);
    const excluded = vm.runInContext(`chargeTaxInclusiveEstimate({price:85, pax:1, priceTaxMode:'TAX_EXCLUDED'})`, sb);
    const legacy = vm.runInContext(`chargeTaxInclusiveEstimate({price:85, pax:1})`, sb); // no priceTaxMode at all
    assert.equal(included, 85);
    assert.equal(excluded, 109.40);
    assert.equal(legacy, excluded, 'a pre-existing charge with no priceTaxMode must estimate exactly as it always has (Part S)');
  });
  test('discount is applied BEFORE tax mode, never after (Part N): a discounted Tax-excluded charge is taxed on the POST-discount amount only', () => {
    const ch = { price: 100, pax: 1, discountType: 'fixed', discountValue: 20, priceTaxMode: 'TAX_EXCLUDED' };
    const finalAmt = vm.runInContext(`chargeFinalAmount(${JSON.stringify(ch)})`, sb);
    assert.equal(finalAmt, 80); // discount already netted out
    const estimate = vm.runInContext(`chargeTaxInclusiveEstimate(${JSON.stringify(ch)})`, sb);
    assert.equal(estimate, +(80 * 1.287).toFixed(2));
  });
  test('discount on a Tax-included charge: discount applied once, then the discounted amount is decomposed (never double-discounted or double-taxed)', () => {
    const ch = { price: 85, pax: 2, discountType: 'percent', discountValue: 10, priceTaxMode: 'TAX_INCLUDED' };
    const finalAmt = vm.runInContext(`chargeFinalAmount(${JSON.stringify(ch)})`, sb); // 170 - 10% = 153
    assert.equal(finalAmt, 153);
    const estimate = vm.runInContext(`chargeTaxInclusiveEstimate(${JSON.stringify(ch)})`, sb);
    assert.equal(estimate, 153, 'tax-included discounted amount stays the final amount -- nothing added on top');
  });
  test('folioOpenChargeEditor() seeds the charge editor state from catalogItemPriceTaxMode(item) -- the catalog\'s own default, not a hardcoded guess', () => {
    const src = extractByStart(PMS, /function folioOpenChargeEditor\(resId,itemId,instanceId\)\s*\{/);
    assert.match(src, /priceTaxMode:catalogItemPriceTaxMode\(item\)/);
  });
  test('folioAddCatalogCharge() snapshots priceTaxMode onto the charge object once, and never re-reads SVC_CATALOG for it afterward (Part G immutability)', () => {
    const src = extractByStart(PMS, /function folioAddCatalogCharge\(instanceId\)\s*\{/);
    assert.match(src, /priceTaxMode:st\.priceTaxMode\|\|catalogDefaultMode/);
  });
  test('invPickItem() (Create Invoice modal) also snapshots the catalog\'s tax treatment at add-time', () => {
    const src = extractByStart(PMS, /function invPickItem\(itemId\)\s*\{/);
    assert.match(src, /priceTaxMode:catalogItemPriceTaxMode\(item\)/);
  });
  test('invAddBlank() (custom/uncatalogued line) defaults to TAX_EXCLUDED -- the safe historical default, since there is no catalog item to inherit from', () => {
    const src = extractByStart(PMS, /function invAddBlank\(catKey\)\s*\{/);
    assert.match(src, /priceTaxMode:'TAX_EXCLUDED'/);
  });
}

section('Case G — role permissions (Part H): Admin/Manager may override, Staff uses the catalog default only');
{
  test('folioSetPriceTaxMode() refuses to change the treatment for anyone without canDiscount() (Admin/Manager)', () => {
    const src = extractByStart(PMS, /function folioSetPriceTaxMode\(instanceId,val\)\s*\{/);
    assert.match(src, /if\(!canDiscount\(\)\)\{ toast\('⛔ Only Admin\/Manager can override price treatment'\); return; \}/);
  });
  test('folioAddCatalogCharge() re-confirms authority at commit time even if state was somehow set to a non-default value (defense in depth, same pattern as discount/override)', () => {
    const src = extractByStart(PMS, /function folioAddCatalogCharge\(instanceId\)\s*\{/);
    assert.match(src, /if\(st\.priceTaxMode!==catalogDefaultMode && !canDiscount\(\)\)\{ toast/);
  });
  test('updateInvItem() rejects a priceTaxMode change from anyone without canDiscount()', () => {
    const src = extractByStart(PMS, /function updateInvItem\(id,field,val\)\s*\{/);
    assert.match(src, /if\(field==='priceTaxMode' && !canDiscount\(\)\)/);
  });
  test('the Create Invoice item table only renders an editable Price Treatment select for canDiscount() -- Staff sees a read-only badge instead', () => {
    const src = extractByStart(PMS, /function renderInvItems\(\)\s*\{/);
    assert.match(src, /const canOverrideTaxMode=canDiscount\(\);/);
    assert.match(src, /if\(canOverrideTaxMode\)\{/);
    assert.match(src, /catalogTaxModeBadge\(\{priceTaxMode:mode\}\)/);
  });
  test('canDiscount() (the authority this whole override reuses) is Admin/Manager only -- both roles covered, Staff excluded', () => {
    const src = extractByStart(PMS, /function canDiscount\(\)\s*\{/);
    assert.match(src, /role === 'admin' \|\| currentUser\.role === 'manager'/);
  });
}

section('Case H — isolation (Part P/V): Green Tax, packages, room rates, Beds24, Cloudbeds, OTA untouched');
{
  test('calcServiceLineTax() never references Green Tax, guest tax status, or nights -- Green Tax stays reservation/guest-night based, computed only by calcTax()/calcTaxGeneral()', () => {
    assert.doesNotMatch(calcServiceLineTaxSrc, /green|Green|guestTaxStatus|nights/);
  });
  test('calcInvoiceExtras() never references green tax or guest tax status either -- fully isolated from the room-charge engine', () => {
    assert.doesNotMatch(calcInvoiceExtrasSrc, /green|Green|guestTaxStatus/);
  });
  test('the catalog tax-treatment functions never reference packages, room_prices, ota_room_type_overrides, Beds24, or Cloudbeds', () => {
    [catalogItemPriceTaxModeSrc, calcServiceLineTaxSrc, calcInvoiceExtrasSrc, chargeTaxInclusiveEstimateSrc].forEach(src => {
      assert.doesNotMatch(src, /package|room_prices|ota_room_type_overrides|beds24|Beds24|cloudbeds|Cloudbeds/i);
    });
  });
  test('the migration function touches ONLY service_catalog -- never packages, room_prices, or any OTA/Beds24/Cloudbeds collection', () => {
    assert.match(migrationSrcCheck(), /fsDb\.collection\('service_catalog'\)/);
    assert.doesNotMatch(migrationSrcCheck(), /package|room_prices|beds24|Beds24|cloudbeds|Cloudbeds|ota_/i);
  });
  function migrationSrcCheck(){ return extractByStart(PMS, /async function migrateCatalogAddPriceTaxMode2026\(\)\s*\{/); }
}

console.log(`\n${passed}/${passed + failed} catalog-tax-treatment assertions passed`);
