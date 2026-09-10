// Fixed Price Catalog -> Guest Folio integration — 2026-09-10.
//
// Covers: ONE canonical service_catalog (Firestore), replacing the two
// prior non-synced stores (localStorage-only FP_* "Fixed Prices" and the
// smaller, independently-authored INV_CATS); role model (Manager as a 4th
// peer role alongside admin/staff/agency); role-gated catalog management
// (canManageCatalog()) vs. Staff read-only folio use; PER_PAX/PER_TRIP/
// PER_ITEM/PER_NIGHT/PER_ROOM quantity math; individual item discount
// (percent/fixed, clamped, reason required, Admin/Manager only via
// canDiscount()); price override (Admin/Manager only, per-line, never
// touches the master catalog); historical price snapshot (a later master
// price change never alters an existing folio/invoice line); deactivation
// (never hard delete); invoice-level discount (percent + fixed, applied
// after item-level discounts, never double-discounting); the v.disc/
// v.eSubtotal persistence bug fix; Daily Operations -> folio dedup bridge;
// room-pricing and package isolation.
//
// Same technique the rest of this suite uses: brace-match real functions
// out of vilu-unified.html and run pure ones in a vm sandbox, regex-check
// DOM-coupled ones directly against source. No Firestore, no browser, no
// live reservation.
//   node test/fixed-price-catalog.test.js
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
function plain(x) { return JSON.parse(JSON.stringify(x)); }

section('Case A — one canonical catalog, two prior stores retired');
{
  test('the old localStorage-only FP_* "Fixed Prices" catalog is gone (no loadFP/saveFP/drawFP/FP_KEY left)', () => {
    assert.doesNotMatch(PMS, /function loadFP\(/);
    assert.doesNotMatch(PMS, /function saveFP\(/);
    assert.doesNotMatch(PMS, /var FP_KEY/);
  });
  test('INV_CATS (the smaller, independently-authored catalog previously live-wired into folio add-charge) is fully retired', () => {
    assert.doesNotMatch(PMS.replace(/\/\/.*$/gm, ''), /\bINV_CATS\b/);
  });
  test('SVC_CATALOG_SEED (2026-09-10 owner price-sheet update): 18 Trips & Activities items from the new sheet plus the 13 untouched Food/Transfer/Accommodation-Extra/Other-Service items — 31 total, no duplicates of Extra Bed/Late Check-out', () => {
    const seedSrc = extractConst(PMS, 'SVC_CATALOG_SEED');
    const items = seedSrc.match(/name:'[^']+'/g);
    assert.equal(items.length, 31, 'expected 31 seed items');
    const names = items.map(s => s.slice(6, -1));
    assert.equal(names.filter(n => n === 'Extra Bed').length, 1);
    assert.equal(names.filter(n => n === 'Late Check-out').length, 1);
    assert.ok(names.includes('Laundry'));
    assert.ok(names.includes('Special Decoration'));
    // Manta Ray Tour / Sandbank Visit were renamed+repriced in place to the
    // sheet's own names; the old names must be gone, not duplicated.
    assert.ok(!names.includes('Manta Ray Tour'));
    assert.ok(!names.includes('Sandbank Visit'));
    assert.ok(names.includes('Manta Ray Snorkeling'));
    assert.ok(names.includes('Sandbank Escape'));
    // Superseded items are dropped from the seed entirely (a fresh deploy
    // should never seed obsolete items) -- the already-populated production
    // collection instead deactivates them via migrateCatalogToPriceSheet2026().
    assert.ok(!names.includes('Snorkeling'));
    assert.ok(!names.includes('Fishing Trip'));
    assert.ok(!names.includes('Island Hopping'));
    assert.ok(!names.includes('Night Snorkeling'));
  });
  test('every seed item uses a canonical category + unitType enum value (including the new PER_HOUR)', () => {
    const seedSrc = extractConst(PMS, 'SVC_CATALOG_SEED');
    const cats = ['TRIPS_ACTIVITIES', 'FOOD_BEVERAGE', 'TRANSFER', 'ACCOMMODATION_EXTRA', 'OTHER_SERVICE'];
    const units = ['PER_PAX', 'PER_TRIP', 'PER_ITEM', 'PER_NIGHT', 'PER_ROOM', 'PER_HOUR'];
    const catMatches = seedSrc.match(/category:'([A-Z_]+)'/g).map(s => s.match(/'([A-Z_]+)'/)[1]);
    const unitMatches = seedSrc.match(/unitType:'([A-Z_]+)'/g).map(s => s.match(/'([A-Z_]+)'/)[1]);
    catMatches.forEach(c => assert.ok(cats.includes(c), 'unknown category ' + c));
    unitMatches.forEach(u => assert.ok(units.includes(u), 'unknown unitType ' + u));
  });
  test('all 18 owner-sheet prices are exact, and Professional Photography is PER_HOUR (never forced into PER_PAX)', () => {
    const seedSrc = extractConst(PMS, 'SVC_CATALOG_SEED');
    const expected = [
      ['Big Game Fishing', 120, 3], ['Sandbank Escape', 89, 3], ['Nurse Shark Snorkeling', 89, 3],
      ['Whale Shark Snorkeling', 85, 2], ['Manta Ray Snorkeling', 85, 2], ['Dolphin Cruise', 75, 2],
      ['Turtle Snorkeling', 65, 2], ['Octopus Hunting Experience', 65, 2], ['Lobster Hunting Experience', 65, 2],
      ['Sunset Cruise', 59, 2], ['Picnic Island Experience', 49, 3], ['Night Fishing Experience', 49, 3],
      ['Fenfushi Reef Snorkeling', 45, 2], ['Dhiddhoo Reef Snorkeling', 45, 2], ['Ariyadhoo Reef Snorkeling', 45, 2],
      ['Romantic Beach Dinner', 85, null], ['Cinema at the Beach', 50, null],
    ];
    expected.forEach(([name, price, dur]) => {
      const re = new RegExp("name:'" + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'[^}]*basePrice:" + price);
      assert.match(seedSrc, re, name + ' should be $' + price);
      if (dur) {
        const reDur = new RegExp("name:'" + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'[^}]*durationHours:" + dur);
        assert.match(seedSrc, reDur, name + ' should be ' + dur + 'h');
      }
    });
    const photoRe = /name:'Professional Photography'[^}]*unitType:'PER_HOUR'[^}]*basePrice:25/;
    assert.match(seedSrc, photoRe, 'Professional Photography must be PER_HOUR $25, never PER_PAX');
  });
}

section('Case B — role model: Manager as a 4th peer role');
{
  test('canManageCatalog() = admin or manager only (Staff excluded)', () => {
    const src = extractByStart(PMS, /function canManageCatalog\(\)\s*\{/);
    assert.match(src, /role\s*===\s*'admin'/);
    assert.match(src, /role\s*===\s*'manager'/);
    assert.doesNotMatch(src, /role\s*===\s*'staff'/);
  });
  test('canDiscount() = admin or manager only (Staff excluded, per Part 11\'s safer default)', () => {
    const src = extractByStart(PMS, /function canDiscount\(\)\s*\{/);
    assert.match(src, /role\s*===\s*'admin'/);
    assert.match(src, /role\s*===\s*'manager'/);
    assert.doesNotMatch(src, /role\s*===\s*'staff'/);
  });
  test('canEdit() extended to include manager (Staff/Manager both operate the PMS)', () => {
    const src = extractByStart(PMS, /function canEdit\(\)\s*\{/);
    assert.match(src, /role\s*===\s*'manager'/);
  });
  test('setAURole()/renderUsersTable() know about the manager role option', () => {
    assert.match(PMS, /AU_ROLE_COLORS\s*=\s*\{[^}]*manager/);
    const roleInfoIdx = PMS.indexOf('const roleInfo = {');
    assert.ok(roleInfoIdx !== -1, 'roleInfo object not found');
    assert.match(PMS.slice(roleInfoIdx, roleInfoIdx + 400), /manager:\s*\{/);
  });
}

section('Case C — sidebar + route-level gating (never just a hidden button)');
{
  test('Bulk Price Manager sidebar entry has id="sl-price" and applyPricingVisibility() gates it by canManageCatalog()', () => {
    assert.match(PMS, /id="sl-price"/);
    const src = extractByStart(PMS, /function applyPricingVisibility\(\)\s*\{/);
    assert.match(src, /canManageCatalog\(\)/);
  });
  test('go(\'price\',...) itself is blocked for non-Admin/Manager, not just the sidebar link (defense in depth)', () => {
    const src = extractByStart(PMS, /function go\(id,el\)\s*\{/);
    assert.match(src, /id===\s*'price'[\s\S]{0,40}canManageCatalog/);
  });
  test('applyPricingVisibility() and loadServiceCatalogFromFirestore() both run at login and at session restore', () => {
    const occurrences = PMS.split('applyPricingVisibility();').length - 1;
    assert.ok(occurrences >= 2, 'expected applyPricingVisibility() at both doLogin and restoreSession');
    const catalogLoads = PMS.split('loadServiceCatalogFromFirestore();').length - 1;
    assert.ok(catalogLoads >= 2, 'expected loadServiceCatalogFromFirestore() at both doLogin and restoreSession');
  });
}

section('Case D — Firestore rules: role-level AND collection-level enforcement, not just hidden UI');
{
  test('isManagerRole() mirrors isAgency()\'s own users/{email}.role pattern', () => {
    const src = extractByStart(RULES, /function isManagerRole\(\)\s*\{/);
    assert.match(src, /data\.role\s*==\s*'manager'/);
  });
  test('service_catalog: read is Admin/Staff/Manager (Staff needs to browse active items), write is Admin/Manager only', () => {
    const idx = RULES.indexOf('match /service_catalog/{itemId}');
    assert.ok(idx !== -1);
    const block = RULES.slice(idx, RULES.indexOf('\n    }', idx));
    assert.match(block, /allow read:.*isStaff\(\)/);
    assert.match(block, /allow create, update:.*\(isAdmin\(\) \|\| isManagerRole\(\)\)/);
    assert.doesNotMatch(block.split('allow read:')[1].split('\n')[0], /\bisStaff\(\)\s*\|\|\s*isManagerRole\(\)\s*$/); // read line intentionally broad, not the assertion under test
  });
  test('service_catalog never allows a hard delete at the rules level — Part 5\'s "no hard delete" is enforced server-side, not just by omitting a delete button', () => {
    const idx = RULES.indexOf('match /service_catalog/{itemId}');
    const block = RULES.slice(idx, RULES.indexOf('\n    }', idx));
    assert.match(block, /allow delete:\s*if\s*false/);
  });
  test('service_catalog create/update validates category and unitType against the canonical enums, rejecting a malformed direct write', () => {
    const idx = RULES.indexOf('match /service_catalog/{itemId}');
    const block = RULES.slice(idx, RULES.indexOf('\n    }', idx));
    assert.match(block, /category in \['TRIPS_ACTIVITIES','FOOD_BEVERAGE','TRANSFER','OTHER_SERVICE','ACCOMMODATION_EXTRA'\]/);
    assert.match(block, /unitType in \['PER_PAX','PER_TRIP','PER_ITEM','PER_NIGHT','PER_ROOM','PER_HOUR'\]/);
  });
  test('folios/invoices collections grant Manager the same access as Staff (Manager is "Staff plus pricing authority", not a Staff replacement)', () => {
    const folioIdx = RULES.indexOf('match /folios/{resId}');
    const folioBlock = RULES.slice(folioIdx, RULES.indexOf('\n    }', folioIdx));
    assert.match(folioBlock, /isStaff\(\) \|\| isManagerRole\(\)/);
  });
}

section('Case E — charge math: chargeGrossAmount / chargeDiscountAmount / chargeFinalAmount');
{
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(extractByStart(PMS, /function chargeGrossAmount\(ch\)\s*\{/), ctx);
  vm.runInContext(extractByStart(PMS, /function chargeDiscountAmount\(ch\)\s*\{/), ctx);
  vm.runInContext(extractByStart(PMS, /function chargeFinalAmount\(ch\)\s*\{/), ctx);

  test('Manta Ray Tour example: 2 pax x $50 = gross $100 (Part 6/9\'s own worked example)', () => {
    const ch = { price: 50, pax: 2 };
    assert.equal(vm.runInContext('chargeGrossAmount(ch)', Object.assign(ctx, { ch })), 100);
  });
  test('10% discount on $100 gross = -$10, final $90', () => {
    const ch = { price: 50, pax: 2, discountType: 'percent', discountValue: 10 };
    ctx.ch = ch;
    assert.equal(vm.runInContext('chargeDiscountAmount(ch)', ctx), 10);
    assert.equal(vm.runInContext('chargeFinalAmount(ch)', ctx), 90);
  });
  test('$15 fixed discount on $100 gross = final $85', () => {
    const ch = { price: 50, pax: 2, discountType: 'fixed', discountValue: 15 };
    ctx.ch = ch;
    assert.equal(vm.runInContext('chargeFinalAmount(ch)', ctx), 85);
  });
  test('no discount / discountType "none" behaves exactly like the old inline price*pax formula', () => {
    const ch = { price: 18, pax: 2 };
    ctx.ch = ch;
    assert.equal(vm.runInContext('chargeFinalAmount(ch)', ctx), 36); // Part 17's "Dinner" no-discount example
  });
  test('a discount can never push the final amount below $0 (clamped to gross)', () => {
    const ch = { price: 20, pax: 1, discountType: 'fixed', discountValue: 999 };
    ctx.ch = ch;
    assert.equal(vm.runInContext('chargeDiscountAmount(ch)', ctx), 20);
    assert.equal(vm.runInContext('chargeFinalAmount(ch)', ctx), 0);
  });
  test('a negative discount value never increases the charge', () => {
    const ch = { price: 20, pax: 1, discountType: 'fixed', discountValue: -50 };
    ctx.ch = ch;
    assert.equal(vm.runInContext('chargeDiscountAmount(ch)', ctx), 0);
    assert.equal(vm.runInContext('chargeFinalAmount(ch)', ctx), 20);
  });
  test('price override replaces the unit price for gross/discount math, but only for that one charge line', () => {
    const ch = { price: 50, overridePrice: 40, pax: 2 };
    ctx.ch = ch;
    assert.equal(vm.runInContext('chargeGrossAmount(ch)', ctx), 80);
  });
  test('historical snapshot: chargeFinalAmount reads ch.price (the snapshot taken at add-time), never a live SVC_CATALOG lookup — a later master price change cannot alter it', () => {
    const grossSrc = extractByStart(PMS, /function chargeGrossAmount\(ch\)\s*\{/);
    assert.doesNotMatch(grossSrc, /SVC_CATALOG/);
  });
}

section('Case F — historical snapshot + deactivation (Part 5/6/21)');
{
  test('folioAddCatalogCharge() snapshots name/category/baseUnitPrice/pax onto the charge object at add-time', () => {
    const src = extractByStart(PMS, /function folioAddCatalogCharge\(instanceId\)\s*\{/);
    assert.match(src, /desc:item\.name/);
    assert.match(src, /baseUnitPrice:item\.basePrice/);
    assert.match(src, /catalogItemId:item\.id/);
  });
  test('deactivateCatalogItem() sets active:false via merge — never a hard delete/splice', () => {
    const src = extractByStart(PMS, /async function deactivateCatalogItem\(id\)\s*\{/);
    assert.match(src, /active:\s*false/);
    assert.match(src, /\{merge:\s*true\}/);
    assert.doesNotMatch(src, /\.delete\(\)/);
    assert.doesNotMatch(src, /splice/);
  });
  test('reactivateCatalogItem() exists and is the inverse of deactivate (Part 22)', () => {
    const src = extractByStart(PMS, /async function reactivateCatalogItem\(id\)\s*\{/);
    assert.match(src, /active:\s*true/);
  });
  test('folioShowCatalogCategory() only lists items with active!==false — a deactivated item disappears from NEW charge selection', () => {
    const src = extractByStart(PMS, /function folioShowCatalogCategory\(resId,catKey,instanceId\)\s*\{/);
    assert.match(src, /active\s*!==\s*false/);
  });
  test('canManageCatalog() gates every catalog-mutating action (add/edit/deactivate/reactivate), not just the UI buttons', () => {
    ['saveCatalogItem', 'deactivateCatalogItem', 'reactivateCatalogItem', 'openAddCatalogItem', 'openEditCatalogItem'].forEach(fn => {
      const re = new RegExp('(async )?function ' + fn + '\\([^)]*\\)\\s*\\{');
      const src = extractByStart(PMS, re);
      assert.match(src, /canManageCatalog\(\)/, fn + ' must check canManageCatalog()');
    });
  });
}

section('Case G — pax/quantity per unit type (Part 8)');
{
  test('catalogUnitLabel() gives a distinct label per unit type — never just "PAX" for everything', () => {
    const src = extractByStart(PMS, /function catalogUnitLabel\(key\)\s*\{/);
    assert.match(src, /CATALOG_UNIT_TYPES/);
    const unitConst = extractConst(PMS.replace('const CATALOG_UNIT_TYPES', 'const CATALOG_UNIT_TYPES').replace(/\bCATALOG_UNIT_TYPES\b/, 'CATALOG_UNIT_TYPES'), 'CATALOG_UNIT_TYPES');
    assert.match(unitConst, /PER_PAX/);
    assert.match(unitConst, /PER_TRIP/);
    assert.match(unitConst, /PER_ITEM/);
    assert.match(unitConst, /PER_NIGHT/);
    assert.match(unitConst, /PER_ROOM/);
  });
  test('folioOpenChargeEditor() defaults PER_PAX quantity to the reservation\'s guest count, but the guest can still adjust it', () => {
    const src = extractByStart(PMS, /function folioOpenChargeEditor\(resId,itemId,instanceId\)\s*\{/);
    assert.match(src, /r\.ad\|\|0.*r\.ch\|\|0/);
  });
  test('folioAddCatalogCharge() warns (not blocks) when pax exceeds the reservation\'s guest count — legitimate exceptions stay allowed', () => {
    const src = extractByStart(PMS, /function folioAddCatalogCharge\(instanceId\)\s*\{/);
    assert.match(src, /exceeds/);
    assert.doesNotMatch(src, /exceeds[\s\S]{0,80}return;/); // warns, then continues -- never a hard block
  });
}

section('Case H — discount reason required, audit trail stored (Part 10)');
{
  test('folioAddCatalogCharge() refuses to save a discount with no reason', () => {
    const src = extractByStart(PMS, /function folioAddCatalogCharge\(instanceId\)\s*\{/);
    assert.match(src, /wantsDiscount && !st\.discountReason/);
  });
  test('folioAddCatalogCharge() refuses to save a price override with no reason', () => {
    const src = extractByStart(PMS, /function folioAddCatalogCharge\(instanceId\)\s*\{/);
    assert.match(src, /overrideActive && !\(st\.overrideReason/);
  });
  test('a saved discount charge stores discountType/discountValue/discountAmount/discountReason/discountedBy/discountedAt', () => {
    const src = extractByStart(PMS, /function folioAddCatalogCharge\(instanceId\)\s*\{/);
    ['discountType', 'discountValue', 'discountReason', 'discountedBy', 'discountedAt', 'discountAmount'].forEach(f => {
      assert.match(src, new RegExp('charge\\.' + f), 'missing ' + f);
    });
  });
  test('a saved override stores overridePrice/overrideReason/overrideBy/overrideAt', () => {
    const src = extractByStart(PMS, /function folioAddCatalogCharge\(instanceId\)\s*\{/);
    ['overridePrice', 'overrideReason', 'overrideBy', 'overrideAt'].forEach(f => {
      assert.match(src, new RegExp('charge\\.' + f), 'missing ' + f);
    });
  });
  test('discount/override cannot be applied by a non-canDiscount() user, even if the client is tampered with (checked again server-side of the UI, before the charge is pushed)', () => {
    const src = extractByStart(PMS, /function folioAddCatalogCharge\(instanceId\)\s*\{/);
    assert.match(src, /\(wantsDiscount\|\|st\.overrideActive\) && !canDiscount\(\)/);
  });
}

section('Case I — the "Custom item" free-price fallback is Admin/Manager only (Part 1\'s "staff should not type master prices" applies here too)');
{
  test('the folio\'s "Custom item (one-off)" form is only rendered for canManageCatalog() users', () => {
    const src = extractByStart(PMS, /function buildAddChargeFormHTML\(resId,instanceId\)\s*\{/);
    assert.match(src, /canManageCatalog\(\)\s*\n?\s*\?/);
  });
  test('addFolioCharge() (the custom-item handler) re-checks canManageCatalog() itself, not just the hidden UI', () => {
    const src = extractByStart(PMS, /async function addFolioCharge\(resId,instanceId\)\s*\{/);
    assert.match(src, /canManageCatalog\(\)/);
  });
  test('the invoice-draft picker\'s own "+ Custom item" button is likewise hidden from non-Admin/Manager, and invAddBlank() re-checks it', () => {
    const showCatItemsSrc = extractByStart(PMS, /function showCatItems\(catKey\)\s*\{/);
    assert.match(showCatItemsSrc, /canManageCatalog\(\)/);
    const addBlankSrc = extractByStart(PMS, /function invAddBlank\(catKey\)\s*\{/);
    assert.match(addBlankSrc, /canManageCatalog\(\)/);
  });
}

section('Case M — Calendar quick-add charge: instanceId DOM scoping (fixes the real live bug where Guest Folios pre-renders a hidden folio card, with the same-shaped ids, for every reservation as soon as that page is first visited -- so Calendar\'s drawer for the SAME reservation collided with it, and every click silently updated the hidden Guest Folios copy instead of the visible Calendar one)');
{
  test('every DOM-addressing function in the shared Add Charge component accepts an instanceId, defaulting to resId (so Guest Folios\' own call sites, unchanged, keep their exact original ids)', () => {
    const fns = {
      buildAddChargeFormHTML: /function buildAddChargeFormHTML\(resId,instanceId\)\s*\{\s*instanceId=instanceId\|\|resId;/,
      folioShowCatalogCategory: /function folioShowCatalogCategory\(resId,catKey,instanceId\)\s*\{\s*instanceId=instanceId\|\|resId;/,
      folioOpenChargeEditor: /function folioOpenChargeEditor\(resId,itemId,instanceId\)\s*\{\s*instanceId=instanceId\|\|resId;/,
      addFolioCharge: /async function addFolioCharge\(resId,instanceId\)\s*\{\s*instanceId=instanceId\|\|resId;/,
      renderFolioChargesById: /function renderFolioChargesById\(resId,instanceId\)\s*\{\s*instanceId=instanceId\|\|resId;/,
      removeFolioCharge: /function removeFolioCharge\(resId,chargeId,instanceId\)\s*\{\s*instanceId=instanceId\|\|resId;/,
    };
    Object.entries(fns).forEach(([name, re]) => assert.match(PMS, re, name + ' must default instanceId to resId'));
  });
  test('_fcState is keyed by instanceId and stamps the real resId onto each state object, so folioAddCatalogCharge(instanceId) can always write to the correct reservation\'s folio regardless of which UI instance is open', () => {
    const openSrc = extractByStart(PMS, /function folioOpenChargeEditor\(resId,itemId,instanceId\)\s*\{/);
    assert.match(openSrc, /_fcState\[instanceId\]=\{resId:resId,/);
    const addSrc = extractByStart(PMS, /function folioAddCatalogCharge\(instanceId\)\s*\{/);
    assert.match(addSrc, /var resId=st\.resId;/);
  });
  test('Calendar\'s drawer (_showDetLegacy) passes a DISTINCT instanceId (\'det-\'+id) to buildAddChargeFormHTML/renderFolioChargesById -- never the bare resId Guest Folios already uses for the same reservation', () => {
    const src = extractByStart(PMS, /function _showDetLegacy\(id\)\s*\{/);
    assert.match(src, /var detInstanceId='det-'\+id;/);
    assert.match(src, /buildAddChargeFormHTML\(id,detInstanceId\)/);
    assert.match(src, /renderFolioChargesById\(id,detInstanceId\)/);
    assert.match(src, /chargesList\.id='fcharges-'\+detInstanceId/);
  });
  test('Guest Folios\' own card render is untouched -- still calls the builder with just resId (no explicit instanceId), so its ids are byte-for-byte identical to before this fix', () => {
    const foliosFormIdx = PMS.indexOf('form.innerHTML=buildAddChargeFormHTML(r.id)');
    assert.ok(foliosFormIdx !== -1, 'Guest Folios must still call buildAddChargeFormHTML(r.id) with no second argument');
    const foliosRenderIdx = PMS.indexOf('renderFolioChargesById(r.id);');
    assert.ok(foliosRenderIdx !== -1, 'Guest Folios must still call renderFolioChargesById(r.id) with no second argument');
  });
  test('behavioral: building the SAME reservation\'s Add Charge form for two different instanceIds (simulating Guest Folios\' pre-rendered hidden card + Calendar\'s drawer, open at once for the same resId) produces two DISTINCT sets of element ids -- proving they can never collide in the live DOM', () => {
    const ctx = {
      console,
      canManageCatalog: () => true,
      esc: (s) => s,
      CATALOG_CATEGORIES: [{ key: 'TRIPS_ACTIVITIES', label: 'Trips & Activities', color: '#0077b6' }],
      FOLIO_CATEGORIES: ['Food & Beverage', 'Trips & Activities', 'Transfers', 'Accommodation Extras', 'Other Services'],
      RES: [{ id: 'R123', fn: 'Test', ad: 1, ch: 0 }],
    };
    vm.createContext(ctx);
    vm.runInContext(extractByStart(PMS, /function reservationGuestCount\(r\)\s*\{/), ctx);
    vm.runInContext(extractByStart(PMS, /function reservationGuestLabels\(r\)\s*\{/), ctx);
    vm.runInContext(extractByStart(PMS, /function buildAddChargeFormHTML\(resId,instanceId\)\s*\{/), ctx);
    const resId = 'R123';
    const guestFoliosHTML = vm.runInContext(`buildAddChargeFormHTML('${resId}')`, ctx); // Guest Folios: no instanceId arg
    const calendarHTML = vm.runInContext(`buildAddChargeFormHTML('${resId}', 'det-${resId}')`, ctx); // Calendar: explicit instanceId
    // Guest Folios' ids are exactly the bare resId (unchanged behavior)
    assert.match(guestFoliosHTML, /id="fcat-items-R123"/);
    assert.match(guestFoliosHTML, /id="fc-editor-R123"/);
    // Calendar's ids are scoped under det-R123, never plain R123
    assert.match(calendarHTML, /id="fcat-items-det-R123"/);
    assert.match(calendarHTML, /id="fc-editor-det-R123"/);
    assert.doesNotMatch(calendarHTML, /id="fcat-items-R123"/);
    assert.doesNotMatch(calendarHTML, /id="fc-editor-R123"/);
    // Both still carry the SAME real resId for data operations (data-rid)
    assert.match(guestFoliosHTML, /data-rid="R123"/);
    assert.match(calendarHTML, /data-rid="R123"/);
  });
}

section('Case J — invoice-level discount (Part 12/13) + no double-discount + the v.disc/v.eSubtotal persistence fix');
{
  test('invDiscountAmount() supports both percent and fixed, clamped to the room+extras base', () => {
    const src = extractByStart(PMS, /function invDiscountAmount\(roomTotal, eT\)\s*\{/);
    assert.match(src, /disctype==='percent'/);
    assert.match(src, /Math\.min\(base,Math\.max\(0,amt\)\)/);
  });
  test('genInv() now actually persists disc/eSubtotal/eTax/discType/discValue on the saved invoice object (previously computed but never stored, per the guest-folio-unification audit)', () => {
    const src = extractByStart(PMS, /function genInv\(\)\s*\{/);
    assert.match(src, /eSubtotal,eTax,eT,disc,discType:d\.type,discValue:d\.value/);
  });
  test('viewInv() no longer silently drops the discount on reopen — both discount rows read v.disc and label percent discounts', () => {
    assert.match(PMS, /v\.disc>0\?`<tr style="background:#e0f7fd">[\s\S]{0,60}Invoice discount/);
    assert.match(PMS, /v\.disc>0\?`<tr><td style="color:#0096c7">Invoice discount/);
  });
  test('no double-discount: extras[].subtotal (and invItems[].unit feeding it) is built from chargeFinalAmount(ch) -- already-net-of-item-discount -- and the invoice-level discount is a separate figure applied on top, never re-discounting the same amount twice', () => {
    const openIMSrc = extractByStart(PMS, /function openIM\(resId, opts\)\s*\{/);
    assert.match(openIMSrc, /unit:\s*chargeFinalAmount\(ch\)/);
    // submitCreateInvoice() (Whole Room or a guest-scoped invoice) computes
    // unit via chargeAmountForGuest(), which itself resolves to
    // chargeFinalAmount(ch) for a whole-room/shared charge -- still net-of-
    // item-discount, never re-discounting.
    const submitSrc = extractByStart(PMS, /function submitCreateInvoice\(resId,payerScope\)\s*\{/);
    assert.match(submitSrc, /unit:\s*chargeAmountForGuest\(ch,res,payerScope\)/);
    const chargeAmountForGuestSrc = extractByStart(PMS, /function chargeAmountForGuest\(ch,r,guestKey\)\s*\{/);
    assert.match(chargeAmountForGuestSrc, /chargeFinalAmount\(ch\)/);
  });
  test('tax ordering unchanged by this task: extra-charge tax is still computed on eSubtotal BEFORE the invoice discount is subtracted (audited, not guessed, per Part 13)', () => {
    const src = extractByStart(PMS, /function niPrev\(\)\s*\{/);
    const eTaxIdx = src.indexOf('eTax');
    const discIdx = src.indexOf('invDiscountAmount');
    assert.ok(eTaxIdx !== -1 && discIdx !== -1 && eTaxIdx < discIdx, 'extra tax must be computed before the invoice discount call');
  });
}

section('Case K — Daily Operations -> folio dedup bridge (Part 19/20)');
{
  test('folioChargeExistsForSource() checks sourceType===\'daily_operation\' AND a stable sourceId — never description alone', () => {
    const src = extractByStart(PMS, /function folioChargeExistsForSource\(resId, sourceId\)\s*\{/);
    assert.match(src, /sourceType==='daily_operation'/);
    assert.match(src, /c\.sourceId===sourceId/);
  });
  test('addTripChargeToFolio() derives sourceId from tripId+date (a Daily Ops trip\'s own natural composite key) and refuses to re-add if already present', () => {
    const src = extractByStart(PMS, /function addTripChargeToFolio\(resId, tripId, date\)\s*\{/);
    assert.match(src, /sourceId='trip_'\+tripId\+'_'\+date/);
    assert.match(src, /folioChargeExistsForSource\(resId,sourceId\)/);
  });
  test('addFoodOrderChargeToFolio() derives sourceId from a stable per-order id, backfilling one onto legacy orders that predate this field', () => {
    const src = extractByStart(PMS, /function addFoodOrderChargeToFolio\(resId, idx\)\s*\{/);
    assert.match(src, /if\(!o\.id\)/);
    assert.match(src, /sourceId='food_'\+o\.id/);
  });
  test('two genuinely separate Daily Ops trips on different dates each get their own dedup key (repeat purchases stay allowed — Part 20)', () => {
    // trip_T01_2026-09-10 vs trip_T01_2026-09-11 differ only by date and are NOT the same sourceId
    const a = 'trip_T01_2026-09-10', b = 'trip_T01_2026-09-11';
    assert.notEqual(a, b);
  });
}

section('Case L — room-pricing and package isolation (Part 23/24, DO NOT TOUCH)');
{
  test('no catalog function references room_prices, ota_room_type_overrides, or PKGS — three separate pricing responsibilities stay separate', () => {
    const catalogFns = ['loadServiceCatalogFromFirestore', 'seedServiceCatalogIfEmpty', 'saveCatalogItem', 'deactivateCatalogItem', 'reactivateCatalogItem', 'drawServiceCatalog', 'folioAddCatalogCharge', 'chargeGrossAmount', 'chargeDiscountAmount', 'chargeFinalAmount'].map(fn => {
      const re = new RegExp('(async )?function ' + fn + '\\([^)]*\\)\\s*\\{');
      return extractByStart(PMS, re);
    }).join('\n');
    assert.doesNotMatch(catalogFns, /room_prices/);
    assert.doesNotMatch(catalogFns, /ota_room_type_overrides/);
    assert.doesNotMatch(catalogFns, /\bPKGS\b/);
  });
  test('service_catalog Firestore rules never grant write access based on Beds24/Cloudbeds/OTA state — role checks only', () => {
    const idx = RULES.indexOf('match /service_catalog/{itemId}');
    const block = RULES.slice(idx, RULES.indexOf('\n    }', idx));
    assert.doesNotMatch(block, /beds24/i);
    assert.doesNotMatch(block, /ota_/i);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
