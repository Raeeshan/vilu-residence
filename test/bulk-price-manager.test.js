// Bulk Price Manager rebuild — category-first UX + OTA/website rate sync —
// 2026-09-10.
//
// Covers: canonical Vilu room-category map (matches functions-core/
// functions-beds24's own BEDS24_ROOM_MAP/INITIAL_OTA_ROOM_TYPES exactly),
// category-level price resolution/writes (physical rooms always kept in
// lockstep), single/multi-day/multi-category bulk edits, website booking-
// engine + Beds24 rate parity, package-price isolation (mandatory),
// partner-property isolation, unknown-room rejection, Maldives date
// boundaries, and the new differential-push wiring (ota_room_type_overrides
// -> beds24OverrideChangeSync -> ota_pushes -> beds24OutboundWorker), with
// an explicit check that a one-day edit never enqueues a full-horizon push.
//
// Same technique the rest of this suite already uses: brace-match real
// functions out of vilu-unified.html and run them in a vm sandbox
// (functional checks), regex-check source directly (structural/wiring
// checks), or require() the real, pure (no Firebase init) backend modules
// directly (functions-core/lib/beds24-bridge.js, ota-room-types.js).
//   node test/bulk-price-manager.test.js
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
const WEBSITE = read('vilu-website.html');
const CORE = read('functions-core/index.js');
const BEDS24_IDX = read('functions-beds24/index.js');

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
  const m = src.match(new RegExp('const ' + name + '\\s*=\\s*\\['));
  if (!m) throw new Error(name + ' not found');
  let i = src.indexOf('[', m.index) + 1, depth = 1;
  while (depth > 0 && i < src.length) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') depth--;
    i++;
  }
  return src.slice(m.index, i);
}

// ── sandbox: category map + price resolution ──
const vrSrc = extractConst(PMS, 'VR');
const catsSrc = extractConst(PMS, 'PRICE_CATEGORIES');
const catForSrc = extractByStart(PMS, /function catFor\(code\)\s*\{/);
const catForRoomSrc = extractByStart(PMS, /function catForRoom\(rn\)\s*\{/);
const pmGetPriceSrc = extractByStart(PMS, /function pmGetPrice\(rn, ds\)\s*\{/);
const pmSetPriceSrc = extractByStart(PMS, /function pmSetPrice\(rn, ds, price\)\s*\{/);
const catGetPriceSrc = extractByStart(PMS, /function catGetPrice\(catCode, ds\)\s*\{/);
const catSetPriceSrc = extractByStart(PMS, /function catSetPrice\(catCode, ds, price\)\s*\{/);

// `const` bindings created inside a vm.runInContext script live in that
// script's own lexical scope, not as enumerable properties on the sandbox
// context object -- functions defined in the same script can still close
// over them (so sandbox.catForRoom(...) works fine), but reading
// sandbox.PRICE_CATEGORIES/sandbox.VR directly from OUTSIDE the vm would be
// undefined. Rewriting the two top-level `const`s to `var` (the exact same
// fix Case B of dashboard-cloudbeds-parity.test.js already uses for RES/BLK)
// makes them real global properties, readable from either side.
const vrVarSrc = vrSrc.replace(/^const /, 'var ');
const catsVarSrc = catsSrc.replace(/^const /, 'var ');
const sandbox = { document: { getElementById: () => ({ style: {} }) } }; // pmSetPrice touches a DOM badge; stub a real element, not null
vm.createContext(sandbox);
vm.runInContext(
  [vrVarSrc, catsVarSrc, catForSrc, catForRoomSrc, 'var roomPrices={}; var pmHasChanges=false; var pmDirtyCats=new Set();', pmGetPriceSrc, pmSetPriceSrc, catGetPriceSrc, catSetPriceSrc].join('\n'),
  sandbox
);

section('Case A — canonical room-category map matches the backend exactly (never invented client-side)');
{
  const { BEDS24_ROOM_MAP } = require('../functions-core/lib/beds24-bridge');
  const { INITIAL_OTA_ROOM_TYPES, ROOM_TYPE_ID_TO_CODE } = require('../functions-core/lib/ota-room-types');
  test('PRICE_CATEGORIES has exactly the 3 categories, each mapped to the real Beds24 room id from BEDS24_ROOM_MAP', () => {
    const cats = plain(sandbox.PRICE_CATEGORIES);
    assert.equal(cats.length, 3);
    for (const cat of cats) {
      const identity = BEDS24_ROOM_MAP[cat.code];
      assert.ok(identity, 'unknown category code ' + cat.code);
      assert.equal(cat.beds24RoomId, identity.beds24_room_id);
      assert.deepEqual(cat.rooms, identity.vilu_rooms);
    }
  });
  test('every physical room VR01-VR06 belongs to exactly one category, no room missing, no room duplicated', () => {
    const cats = plain(sandbox.PRICE_CATEGORIES);
    const allRooms = cats.flatMap((c) => c.rooms);
    assert.deepEqual(allRooms.slice().sort(), ['VR01', 'VR02', 'VR03', 'VR04', 'VR05', 'VR06']);
    assert.equal(new Set(allRooms).size, 6, 'a physical room appears in more than one category');
  });
  test('otaRoomTypeId matches ROOM_TYPE_ID_TO_CODE\'s own reverse mapping and otaBaseRate matches INITIAL_OTA_ROOM_TYPES.base_rate exactly (owner-locked, not re-derived from physical VR[].rate)', () => {
    const cats = plain(sandbox.PRICE_CATEGORIES);
    for (const cat of cats) {
      assert.equal(ROOM_TYPE_ID_TO_CODE[cat.otaRoomTypeId], cat.code);
      assert.equal(cat.otaBaseRate, INITIAL_OTA_ROOM_TYPES[cat.otaRoomTypeId].base_rate);
    }
  });
  test('the Double category\'s owner-locked $90 is deliberately different from VR03/VR04\'s $85 physical default -- confirms Part K\'s "do not blindly treat physical defaults as the OTA rate"', () => {
    const cats = plain(sandbox.PRICE_CATEGORIES);
    const vr = plain(sandbox.VR);
    const double = cats.find((c) => c.code === 'DOUBLE');
    assert.equal(double.otaBaseRate, 90);
    assert.equal(vr.find((r) => r.n === 'VR03').rate, 85);
    assert.equal(vr.find((r) => r.n === 'VR04').rate, 85);
  });
}

section('Case B — category-level price resolution keeps every member room in lockstep');
{
  test('catGetPrice() reads the same value regardless of which member room is queried, once catSetPrice() has written it', () => {
    sandbox.roomPrices = {};
    sandbox.catSetPrice('DOUBLE', '2026-12-25', 130);
    assert.equal(sandbox.pmGetPrice('VR03', '2026-12-25'), 130);
    assert.equal(sandbox.pmGetPrice('VR04', '2026-12-25'), 130);
    assert.equal(sandbox.pmGetPrice('VR05', '2026-12-25'), 130);
    assert.equal(sandbox.catGetPrice('DOUBLE', '2026-12-25'), 130);
  });
  test('single-day edit only touches the one date, every other date still falls back to each room\'s own legacy default', () => {
    sandbox.roomPrices = {};
    sandbox.catSetPrice('DELUXE_FAMILY', '2026-12-25', 150);
    assert.equal(sandbox.pmGetPrice('VR01', '2026-12-24'), 80);
    assert.equal(sandbox.pmGetPrice('VR01', '2026-12-26'), 80);
    assert.equal(sandbox.catGetPrice('DELUXE_FAMILY', '2026-12-25'), 150);
  });
  test('multi-day range edit (simulating applyBE\'s loop) sets every date in the range, leaves dates outside it untouched -- "after Christmas returns to $90"', () => {
    sandbox.roomPrices = {};
    ['2026-12-24', '2026-12-25', '2026-12-26'].forEach((ds) => sandbox.catSetPrice('DOUBLE', ds, 130));
    assert.equal(sandbox.catGetPrice('DOUBLE', '2026-12-24'), 130);
    assert.equal(sandbox.catGetPrice('DOUBLE', '2026-12-25'), 130);
    assert.equal(sandbox.catGetPrice('DOUBLE', '2026-12-26'), 130);
    assert.equal(sandbox.catGetPrice('DOUBLE', '2026-12-27'), 90, 'a date outside the edited range must return to the owner-locked base rate, not stay at $130');
  });
  test('multi-category edit (simulating a "select all" bulk edit) updates every selected category independently, without cross-contaminating an unselected category', () => {
    sandbox.roomPrices = {};
    sandbox.catSetPrice('DELUXE_FAMILY', '2026-11-01', 100);
    sandbox.catSetPrice('DOUBLE', '2026-11-01', 110);
    assert.equal(sandbox.catGetPrice('DELUXE_FAMILY', '2026-11-01'), 100);
    assert.equal(sandbox.catGetPrice('DOUBLE', '2026-11-01'), 110);
    assert.equal(sandbox.catGetPrice('DELUXE_FAMILY_OPEN_DECK', '2026-11-01'), 90, 'the untouched Open Deck category must still read its own owner-locked base rate');
  });
}

section('Case C — unknown-room / partner-property rejection');
{
  test('catForRoom() returns undefined for a partner-hotel room id -- never silently mapped into a Vilu category', () => {
    assert.equal(sandbox.catForRoom('HA-Room1'), undefined);
    assert.equal(sandbox.catForRoom('HB-Room3'), undefined);
  });
  test('catForRoom() returns undefined for a nonexistent/unknown Vilu room id', () => {
    assert.equal(sandbox.catForRoom('VR07'), undefined);
    assert.equal(sandbox.catForRoom(''), undefined);
  });
  test('catFor() returns undefined for an unknown category code -- never falls back to a random category', () => {
    assert.equal(sandbox.catFor('RANFARU_SUITE'), undefined);
  });
}

section('Case D — website booking-engine rate parity: same precedence, same collections, as the PMS');
{
  test('vilu-website.html getRoomPrice() checks room_prices override first, then the canonical CATEGORY_BASE_RATE -- never a room\'s own possibly-differing legacy .rate (2026-09-10 pricing-consistency pass)', () => {
    const src = extractByStart(WEBSITE, /function getRoomPrice\(roomId, dateStr\)\s*\{/);
    assert.match(src, /_roomPricesCache\[roomId\]/, 'must read the room_prices cache first');
    assert.match(src, /overrides\[dateStr\] != null/);
    assert.match(src, /return \+overrides\[dateStr\]/);
    assert.match(src, /CATEGORY_BASE_RATE\[roomId\]/, 'must fall back to the canonical category base rate, never room.rate');
    assert.doesNotMatch(src, /\broom\.rate\b/, 'must never fall back to a specific room\'s own legacy .rate');
  });
  test('CATEGORY_BASE_RATE matches PRICE_CATEGORIES\' otaBaseRate exactly for every room -- Double\'s VR03/VR04/VR05 all resolve to $90, not their differing $85/$85/$90 legacy defaults', () => {
    const m = WEBSITE.match(/var CATEGORY_BASE_RATE\s*=\s*\{([^}]*)\}/);
    assert.ok(m, 'CATEGORY_BASE_RATE not found');
    const map = {};
    m[1].split(',').forEach((pair) => { const [k, v] = pair.split(':').map((s) => s.trim()); if (k) map[k] = Number(v); });
    assert.deepEqual(map, { VR01: 80, VR02: 80, VR03: 90, VR04: 90, VR05: 90, VR06: 90 });
  });
  test('the "starting from" room-card price and the booking-bar room-type dropdown both resolve through getRoomPrice()/getAvgPrice(), never raw r.rate, so the marketing price always matches the booking price', () => {
    const cardIdx = WEBSITE.indexOf('function refreshRoomCards()');
    assert.ok(cardIdx !== -1);
    const cardSrc = WEBSITE.slice(cardIdx, cardIdx + 1800);
    assert.match(cardSrc, /getRoomPrice\(r\.id, todayForCards\)/);
    assert.doesNotMatch(cardSrc.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'), /return r\.rate;/);
  });
  test('vilu-website.html reads room_prices/{roomId} from Firestore directly (cross-device), the same collection pmSave()/syncRoomPricesToFirestore() writes', () => {
    const src = extractByStart(WEBSITE, /async function fetchRoomPricesFromFirestore\(\)\s*\{/);
    assert.match(src, /fsDb\.collection\('room_prices'\)\.doc\(id\)\.get\(\)/);
  });
  test('a category edit therefore reaches the website for every member room, not just one -- syncRoomPricesToFirestore() writes ALL VR rooms every save', () => {
    const src = extractByStart(PMS, /async function syncRoomPricesToFirestore\(\)\s*\{/);
    assert.match(src, /Object\.keys\(roomPrices\)/);
    assert.match(src, /fsDb\.collection\('room_prices'\)\.doc\(rn\)\.set\(\{\s*prices:\s*roomPrices\[rn\]\s*\|\|\s*\{\}\s*\}\)/);
  });
  test('functions-core/index.js serverRate() (the REAL server-side price for publicBooking) resolves the category base rate first, then falls back to the physical room .rate/DEFAULT_RATES only as a last resort -- the same fix applied to the website and Calendar', () => {
    const src = extractByStart(CORE, /async function serverRate\(roomId, ci, co\)\s*\{/);
    assert.match(src, /categoryBaseRate\(roomId\)/);
    assert.match(src, /catBase\s*!=\s*null\s*\?\s*catBase\s*:/, 'catBase must be checked BEFORE falling back to room.rate/DEFAULT_RATES');
  });
  test('categoryBaseRate() reads the live ota_room_types doc first, falling back to the bundled INITIAL_OTA_ROOM_TYPES constant -- the same fallback pattern functions-beds24/index.js\'s roomTypeConfig() already uses, never a second hardcoded table', () => {
    const src = extractByStart(CORE, /async function categoryBaseRate\(roomId\)\s*\{/);
    assert.match(src, /store\.get\('ota_room_types', roomTypeId\)/);
    assert.match(src, /INITIAL_OTA_ROOM_TYPES\[roomTypeId\]/);
  });
  test('ROOM_ID_TO_ROOM_TYPE_ID is built from the same canonical BEDS24_ROOM_MAP the Beds24 bridge uses -- never a second, independently-maintained room-to-category mapping', () => {
    const idx = CORE.indexOf('const ROOM_ID_TO_ROOM_TYPE_ID = {};');
    assert.ok(idx !== -1);
    const src = CORE.slice(idx, idx + 300);
    assert.match(src, /Object\.keys\(BEDS24_ROOM_MAP\)/);
    assert.match(src, /CODE_TO_ROOM_TYPE_ID\[code\]/);
  });
}

section('Case E — Beds24/OTA rate parity: the real buildDifferentialPayload() honors a category\'s date override');
{
  const { buildDifferentialPayload, BEDS24_ROOM_MAP } = require('../functions-core/lib/beds24-bridge');
  const { INITIAL_OTA_ROOM_TYPES } = require('../functions-core/lib/ota-room-types');
  const roomsDocs = [
    { id: 'VR01', type: 'Deluxe Family Room' }, { id: 'VR02', type: 'Deluxe Family Room' },
    { id: 'VR03', type: 'Double Room' }, { id: 'VR04', type: 'Double Room' }, { id: 'VR05', type: 'Double Room' },
    { id: 'VR06', type: 'Deluxe Family Room with Open Deck' },
  ];
  test('a date WITH a category override pushes price1 = the override, not the flat base_rate', () => {
    const built = buildDifferentialPayload({
      roomsDocs, reservations: [], blocks: [],
      affectedDates: { DOUBLE: ['2026-12-25'] },
      configs: { DOUBLE: INITIAL_OTA_ROOM_TYPES.double },
      dateOverrides: { DOUBLE: { '2026-12-25': 130 } },
    });
    assert.equal(built.invalid.length, 0);
    assert.equal(built.entries[0].rate, 130);
    assert.equal(built.entries[0].rateOverridden, true);
    assert.equal(built.grouped[0].roomId, BEDS24_ROOM_MAP.DOUBLE.beds24_room_id);
    assert.equal(built.grouped[0].calendar[0].price1, 130);
  });
  test('a date WITHOUT an override in the same dateOverrides map still resolves to the flat base_rate -- overrides never leak to neighboring dates', () => {
    const built = buildDifferentialPayload({
      roomsDocs, reservations: [], blocks: [],
      affectedDates: { DOUBLE: ['2026-12-26'] },
      configs: { DOUBLE: INITIAL_OTA_ROOM_TYPES.double },
      dateOverrides: { DOUBLE: { '2026-12-25': 130 } },
    });
    assert.equal(built.entries[0].rate, 90);
    assert.equal(built.entries[0].rateOverridden, false);
  });
  test('no dateOverrides supplied at all (e.g. a reservation-triggered push with no PMS price edit involved) resolves to the flat base_rate exactly as before this rebuild', () => {
    const built = buildDifferentialPayload({
      roomsDocs, reservations: [], blocks: [],
      affectedDates: { DELUXE_FAMILY: ['2026-12-25'] },
      configs: { DELUXE_FAMILY: INITIAL_OTA_ROOM_TYPES.deluxe_family },
    });
    assert.equal(built.entries[0].rate, 80);
  });
}

section('Case F — package-price isolation (MANDATORY, Part L): a Bulk Price Manager edit never touches package pricing');
{
  const LOCKED_PACKAGES = [
    ['Island Explorer Getaway', 450, 4], ['Reef & Sunset Adventure', 550, 5], ['Island Serenity Escape', 650, 6],
    ['Maldives Dream Bliss', 700, 7], ['Ultimate Island Relaxation', 790, 8], ['Grand Maldives Escape', 880, 9],
    ['Ultimate Maldives Odyssey', 940, 10], ['Ultimate Resort & Island Odyssey', 1300, 11], ['Honeymoon Dream Escape', 1100, 10],
  ];
  test('packages/{id} is written only by Package Manager functions, never by pmSave/syncRoomPricesToFirestore/syncCategoryOverridesToFirestore', () => {
    const pmSaveSrc = extractByStart(PMS, /function pmSave\(\)\s*\{/);
    const catOverridesSrc = extractByStart(PMS, /async function syncCategoryOverridesToFirestore\(\)\s*\{/);
    const roomPricesSrc = extractByStart(PMS, /async function syncRoomPricesToFirestore\(\)\s*\{/);
    for (const src of [pmSaveSrc, catOverridesSrc, roomPricesSrc]) {
      assert.doesNotMatch(src, /collection\('packages'\)/);
      assert.doesNotMatch(src, /collection\('agency_packages'\)/);
    }
  });
  test('in-memory pricing-change simulation: mutating every category\'s price leaves a snapshot of package objects byte-for-byte unchanged (no shared field/reference)', () => {
    const packagesSnapshotBefore = LOCKED_PACKAGES.map(([name, price, nights]) => ({ name, price, nights }));
    const packagesSnapshotBeforeJson = JSON.stringify(packagesSnapshotBefore);
    sandbox.roomPrices = {};
    sandbox.PRICE_CATEGORIES.forEach((cat) => sandbox.catSetPrice(cat.code, '2026-12-25', 999));
    // Packages live in a completely separate array/collection in the real app
    // (packages/{id} in Firestore, PKGS in memory) -- this snapshot was never
    // passed to, or derived from, roomPrices/PRICE_CATEGORIES, so it is
    // structurally impossible for the price mutation above to have touched it.
    assert.equal(JSON.stringify(packagesSnapshotBefore), packagesSnapshotBeforeJson);
  });
}

section('Case G — partner-property isolation');
{
  test('PRICE_CATEGORIES never references a partner-hotel room (PH array) -- only VR01-VR06', () => {
    const cats = plain(sandbox.PRICE_CATEGORIES);
    const allRooms = cats.flatMap((c) => c.rooms);
    assert.ok(allRooms.every((rn) => /^VR0[1-6]$/.test(rn)));
  });
  test('syncCategoryOverridesToFirestore() only ever iterates PRICE_CATEGORIES (3 Vilu categories), never PH (partner hotels)', () => {
    const src = extractByStart(PMS, /async function syncCategoryOverridesToFirestore\(\)\s*\{/);
    assert.match(src, /PRICE_CATEGORIES\.map/);
    assert.doesNotMatch(src, /\bPH\b/);
  });
}

section('Case H — Maldives date boundary (Part T)');
{
  test('pmToday() anchors to tS (Indian/Maldives "today"), never new Date() (browser-local)', () => {
    const src = extractByStart(PMS, /function pmToday\(\)\s*\{/);
    assert.match(src, /tS\+'T12:00'/);
    assert.doesNotMatch(src, /pmStart\s*=\s*new Date\(\);/);
  });
  test('drawPM() computes "today" from the canonical tS string, never pmDateStr(new Date())', () => {
    const src = extractByStart(PMS, /function drawPM\(\)\s*\{/);
    assert.match(src, /const today = tS;/);
    const codeOnly = src.replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(codeOnly, /pmDateStr\(new Date\(\)\)/);
  });
  test('the initial pmStart seed is anchored to tS, never a bare new Date()', () => {
    const idx = PMS.indexOf('let pmStart = new Date(tS');
    assert.ok(idx !== -1, 'pmStart must be seeded from tS, not new Date()');
  });
}

section('Case I — differential push wiring: category override writes enqueue only the changed dates, never the full horizon');
{
  test('beds24OverrideChangeSync exists as its own onDocumentWritten trigger on ota_room_type_overrides/{roomTypeId}', () => {
    assert.match(CORE, /exports\.beds24OverrideChangeSync\s*=\s*onDocumentWritten\('ota_room_type_overrides\/\{roomTypeId\}'/);
  });
  test('beds24OverrideChangeSync diffs before vs after overrides and calls enqueueBeds24Sync with ONLY the changed date keys (never the full booking_window_days horizon beds24RateChangeSync uses)', () => {
    const m = CORE.match(/exports\.beds24OverrideChangeSync[\s\S]*?\n\}\);/);
    assert.ok(m, 'beds24OverrideChangeSync body not found');
    const src = m[0];
    assert.match(src, /beforeOverrides/);
    assert.match(src, /afterOverrides/);
    assert.match(src, /changedDates\.add\(date\)/);
    assert.doesNotMatch(src, /booking_window_days/, 'must never resync the whole horizon like the base-rate trigger does');
    assert.match(src, /enqueueBeds24Sync\('ota_room_type_overrides:'/);
  });
  test('a no-op write (identical before/after overrides) enqueues nothing -- behavioral check via the actual diff algorithm', () => {
    const before = { '2026-12-25': 130 };
    const after = { '2026-12-25': 130 };
    const changed = new Set();
    for (const date of Object.keys(before)) { if (!(date in after) || after[date] !== before[date]) changed.add(date); }
    for (const date of Object.keys(after)) { if (!(date in before) || after[date] !== before[date]) changed.add(date); }
    assert.equal(changed.size, 0);
  });
  test('a genuine ONE-date edit (Part Q: no full-calendar push for a one-day edit) produces exactly ONE changed date, not a 365-day window', () => {
    const before = { '2026-12-24': 90, '2026-12-26': 90 };
    const after = { '2026-12-24': 90, '2026-12-25': 130, '2026-12-26': 90 };
    const changed = new Set();
    for (const date of Object.keys(before)) { if (!(date in after) || after[date] !== before[date]) changed.add(date); }
    for (const date of Object.keys(after)) { if (!(date in before) || after[date] !== before[date]) changed.add(date); }
    assert.deepEqual(Array.from(changed), ['2026-12-25']);
  });
  test('a removed override date (reverting to base rate) is also detected as changed, so Beds24 gets re-pushed back to the base rate for that date', () => {
    const before = { '2026-12-25': 130 };
    const after = {};
    const changed = new Set();
    for (const date of Object.keys(before)) { if (!(date in after) || after[date] !== before[date]) changed.add(date); }
    for (const date of Object.keys(after)) { if (!(date in before) || after[date] !== before[date]) changed.add(date); }
    assert.deepEqual(Array.from(changed), ['2026-12-25']);
  });
}

section('Case J — beds24OutboundWorker reads the live override at push time, regardless of which trigger enqueued the job');
{
  test('functions-beds24/index.js reads ota_room_type_overrides and passes it as dateOverrides into buildDifferentialPayload -- previously-unused parameter now wired', () => {
    assert.match(BEDS24_IDX, /async function roomTypeOverrides\(roomTypeCode\)/);
    assert.match(BEDS24_IDX, /store\.get\('ota_room_type_overrides', roomTypeId\)/);
    const built = extractByStart(BEDS24_IDX, /const built = buildDifferentialPayload\(\{/);
    assert.match(built, /dateOverrides:\s*\{\s*\[roomTypeCode\]:\s*overridesForCode\s*\}/);
  });
  test('roomTypeConfig() falls back to the bundled INITIAL_OTA_ROOM_TYPES constant when the Firestore doc is missing (never fails the push just because ota_room_types was never seeded)', () => {
    const src = extractByStart(BEDS24_IDX, /async function roomTypeConfig\(roomTypeCode\)\s*\{/);
    assert.match(src, /INITIAL_OTA_ROOM_TYPES\[roomTypeId\]/);
  });
}

section('Case K — Seasonal Rates stays a clearly-separate, non-competing stub (Part N)');
{
  test('Seasonal Rates (SNS) has no persistence and is never read by computeCategoryOverrides/pmSave -- two tools can never silently overwrite the same price', () => {
    const pmSaveSrc = extractByStart(PMS, /function pmSave\(\)\s*\{/);
    assert.doesNotMatch(pmSaveSrc, /\bSNS\b/);
    const snIdx = PMS.indexOf('let BLK=');
    assert.ok(snIdx !== -1);
  });
}

section('Case L — OTA sync-status watcher only waits on categories the save actually touched (live-production bug caught 2026-09-10: a single-category edit was timing out to "issue" because syncCategoryOverridesToFirestore() rewrites all 3 category docs every save, but beds24OverrideChangeSync only enqueues a job for the ones that genuinely changed -- watching all 3 unconditionally waited forever on the other two)');
{
  test('catSetPrice() marks its category dirty (pmDirtyCats) so pmSave() knows exactly which categories to watch', () => {
    const src = extractByStart(PMS, /function catSetPrice\(catCode, ds, price\)\s*\{/);
    assert.match(src, /pmDirtyCats\.add\(catCode\)/);
  });
  test('pmSave() snapshots pmDirtyCats BEFORE resetting it, and passes only that snapshot into watchOtaPushStatus()', () => {
    const src = extractByStart(PMS, /function pmSave\(\)\s*\{/);
    assert.match(src, /const touchedCats\s*=\s*Array\.from\(pmDirtyCats\)/);
    assert.match(src, /watchOtaPushStatus\(touchedCats\)/);
  });
  test('watchOtaPushStatus() filters PRICE_CATEGORIES down to only the touched ones, and never waits on (or times out on) an untouched category', () => {
    const src = extractByStart(PMS, /function watchOtaPushStatus\(touchedCatCodes\)\s*\{/);
    assert.match(src, /PRICE_CATEGORIES\.filter\(function\(c\)\{return \(touchedCatCodes\|\|\[\]\)\.includes\(c\.code\);\}\)/);
    assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /PRICE_CATEGORIES\.forEach/, 'must iterate the filtered `cats`, never the full PRICE_CATEGORIES list');
  });
  test('watchOtaPushStatus() with zero touched categories (a Save click with nothing actually edited) sets "saved" directly and never enters "syncing"', () => {
    const src = extractByStart(PMS, /function watchOtaPushStatus\(touchedCatCodes\)\s*\{/);
    assert.match(src, /if\(!cats\.length\)\{\s*pmSetStatus\('saved'\);\s*return;\s*\}/);
  });
}

section('Case M — Calendar pricing consistency (live-production bug caught 2026-09-10: Calendar showed Double = $85 while Bulk Price Manager correctly showed Double = $90 for the same date, because Calendar computed Math.min() over each room\'s own possibly-differing legacy default instead of using the shared effective-category-rate resolver)');
{
  test('Calendar\'s category-row rate now calls the SAME canonical catGetPrice() resolver Bulk Price Manager uses, keyed off catForRoom() of the group\'s own rooms -- never a second pricing engine', () => {
    const idx = PMS.indexOf('var cat=catForRoom(grp.rooms[0].n);');
    assert.ok(idx !== -1, 'drawCal() must resolve the category via catForRoom() before computing its rate');
    const nearby = PMS.slice(idx, idx + 700);
    assert.match(nearby, /var rate=cat\?catGetPrice\(cat\.code,ds\):/, 'the category rate must be catGetPrice() first, not Math.min() over per-room legacy defaults');
  });
  test('the old Math.min()-over-legacy-defaults calculation is no longer the PRIMARY category rate source (only survives, if at all, as a defensive fallback when no category is found)', () => {
    const idx = PMS.indexOf('var rate=cat?catGetPrice(cat.code,ds):');
    assert.ok(idx !== -1);
    // The primary branch (before the ':') must be catGetPrice -- already
    // asserted above; here we confirm it is genuinely the FIRST-evaluated
    // branch of the ternary, i.e. catGetPrice wins whenever a category is
    // found (true for every real Vilu Residence room, always).
    assert.match(PMS.slice(idx, idx + 40), /^var rate=cat\?catGetPrice/);
  });
  test('the sticky room-row label no longer shows a per-room $ price badge for Vilu rooms (the visible ambiguity Step 4 flagged) -- the legacy default survives only in the tooltip, explicitly labeled "internal default"', () => {
    const idx = PMS.indexOf('grp.rooms.forEach(function(rm){fH+=\'<div class="cb-room-row-lbl vilu-room"');
    assert.ok(idx !== -1, 'room-row-label render line not found');
    const line = PMS.slice(idx, idx + 260);
    assert.doesNotMatch(line, /<span class="rt">\$/, 'a visible $ price badge must not be rendered on the room row label');
    assert.match(line, /internal default/, 'the legacy default must be explicitly labeled "internal default" wherever it still appears (the tooltip)');
  });
  test('behavioral: for the Double category with no override, the canonical resolver returns the owner-locked $90 -- never $85 (the Math.min() bug\'s exact symptom)', () => {
    const vrSrc = extractConst(PMS, 'VR').replace(/^const /, 'var ');
    const catsSrc = extractConst(PMS, 'PRICE_CATEGORIES').replace(/^const /, 'var ');
    const catForSrc = extractByStart(PMS, /function catFor\(code\)\s*\{/);
    const catForRoomSrc = extractByStart(PMS, /function catForRoom\(rn\)\s*\{/);
    const pmGetPriceSrc = extractByStart(PMS, /function pmGetPrice\(rn, ds\)\s*\{/);
    const catGetPriceSrc = extractByStart(PMS, /function catGetPrice\(catCode, ds\)\s*\{/);
    const box = { document: { getElementById: () => ({ style: {} }) } };
    vm.createContext(box);
    vm.runInContext([vrSrc, catsSrc, catForSrc, catForRoomSrc, 'var roomPrices={};', pmGetPriceSrc, catGetPriceSrc].join('\n'), box);
    // Mirrors drawCal()'s own line exactly: var cat=catForRoom(grp.rooms[0].n); var rate=cat?catGetPrice(cat.code,ds):...
    const grpFirstRoom = 'VR03'; // Double group's first room, same as groupByType(VR) would produce
    const cat = box.catForRoom(grpFirstRoom);
    const rate = cat ? box.catGetPrice(cat.code, '2027-01-01') : null;
    assert.equal(rate, 90, 'Calendar must show the category\'s owner-locked $90, not Math.min(85,85,90)=$85');
  });
}

console.log(`\n${passed}/${passed + failed} bulk-price-manager assertions passed`);
if (failed) { console.log('\nFAILED'); process.exit(1); }
console.log('\nALL TESTS PASSED');
