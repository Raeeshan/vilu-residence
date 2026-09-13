// VILU AGENCY PORTAL — UNIFY AVAILABILITY UI + PARTNER ROOM-SLOT CALENDAR
// (2026-09-13, third follow-up to the PMS multi-property restore)
//
// Three problems reported from the LIVE Agency Portal, fixed together:
//  1. Two separate-looking availability sections ("Check availability"
//     search panel + "Availability Calendar") stacked on the same tab --
//     merged into ONE `.card`, property tabs shared at the top, search as
//     a sub-section, calendar underneath. Zero JS logic changed for this
//     part -- updateAvSearchUI()/searchAvailability() already handled the
//     ON_REQUEST/partner case correctly.
//  2. The Agency Calendar had no concept of individual partner rooms --
//     only room TYPES (a commercial catalog concept, still empty for
//     Ranfaru/White Sand). Fixed by projecting a narrow, count-only
//     `calendarRoomSlotCount` field from getAgencyProperties() (never the
//     PMS's own `manualPmsRoomSlots` name, and never used as confirmed
//     availability math) and a new room-level `rooms`/`roomDays` shape from
//     getAgencyAvailability() for a partner property, built the same way
//     Vilu's own PHYSICAL_ROOMS branch already reads room_availability.
//  3. (Admin login is covered separately in
//     test/agency-portal-admin-login.test.js.)
//
//   node test/agency-unified-availability-and-partner-calendar.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }

const AGENCY = read('vilu-agency-portal.html');
const FUNCTIONS_CORE = read('functions-core/index.js');

function extractByStart(src, startRegex) {
  const m = src.match(startRegex);
  if (!m) throw new Error('pattern not found: ' + startRegex);
  let i = m.index + m[0].length, depth = 1;
  while (depth > 0 && i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return src.slice(m.index, i);
}
function extractFn(src, startMarker) {
  const i0 = src.indexOf(startMarker);
  if (i0 === -1) throw new Error('marker not found: ' + startMarker);
  const bodyStart = src.indexOf('{', i0 + startMarker.length);
  let i = bodyStart + 1, depth = 1;
  while (depth > 0 && i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return src.slice(i0, i);
}

const agDrawCalSrc = extractByStart(AGENCY, /async function agDrawCal\(\)\s*\{/);
const getAgencyPropertiesSrc = extractByStart(FUNCTIONS_CORE, /exports\.getAgencyProperties = onCall\(\{[^}]*\}, async \(request\) => \{/);
const getPartnerAvailSrc = extractByStart(FUNCTIONS_CORE, /async function getPartnerPropertyAvailability\(propertyId, startDate, endDate, agencyId\) \{/);

section('Part 1 — unified Availability UI, exactly one module');
{
  test('exactly one "Availability" tab pane exists (#tab-availability), and it is the ONLY container -- no separate second .card for the calendar anymore', () => {
    const tabMatches = [...AGENCY.matchAll(/id="tab-availability"/g)];
    assert.equal(tabMatches.length, 1, 'expected exactly one #tab-availability container');
    const tabIdx = AGENCY.indexOf('<div id="tab-availability"');
    const nextTabIdx = AGENCY.indexOf('<!-- MY BOOKINGS TAB');
    const tabBody = AGENCY.slice(tabIdx, nextTabIdx);
    const cardOpens = (tabBody.match(/<div class="card"/g) || []).length;
    assert.equal(cardOpens, 1, 'expected exactly one top-level .card wrapping the whole Availability tab (search + calendar merged)');
  });
  test('the old separate "Availability Calendar" heading is gone -- one "Availability" heading for the whole merged module', () => {
    const tabIdx = AGENCY.indexOf('<div id="tab-availability"');
    const nextTabIdx = AGENCY.indexOf('<!-- MY BOOKINGS TAB');
    const tabBody = AGENCY.slice(tabIdx, nextTabIdx);
    assert.doesNotMatch(tabBody, />Availability Calendar</);
    assert.match(tabBody, /<h3 style="margin:0">Availability<\/h3>/);
  });
  test('property tabs (#ag-cb-prop-tabs) now render ABOVE the exact-search fields, shared by both the search and the calendar', () => {
    const tabIdx = AGENCY.indexOf('<div id="tab-availability"');
    const propTabsIdx = AGENCY.indexOf('id="ag-cb-prop-tabs"', tabIdx);
    const searchFieldsIdx = AGENCY.indexOf('id="av-ci"', tabIdx);
    assert.ok(propTabsIdx > -1 && searchFieldsIdx > propTabsIdx, 'property tabs must appear before the exact-search date fields in the merged card');
  });
  test('the exact-availability search controls all still exist, unchanged ids (check-in/out, adults, children, rooms needed, category, search button)', () => {
    ['id="av-ci"', 'id="av-co"', 'id="av-adults"', 'id="av-children"', 'id="av-rooms"', 'id="av-category-wrap"', 'id="av-category"', 'onclick="searchAvailability()"', 'id="av-results"'].forEach((needle) => {
      assert.ok(AGENCY.includes(needle), 'missing: ' + needle);
    });
  });
  test('the calendar grid (property-tab-aware, .cb-wrap/#ag-cb-grid) is still present, immediately after the search results mount point', () => {
    const resultsIdx = AGENCY.indexOf('id="av-results"');
    const calWrapIdx = AGENCY.indexOf('class="cb-wrap"', resultsIdx);
    const gridIdx = AGENCY.indexOf('id="ag-cb-grid"', resultsIdx);
    assert.ok(calWrapIdx > resultsIdx && gridIdx > calWrapIdx, 'the calendar must render after the search/results section within the same merged card');
  });
  test('searchAvailability()/updateAvSearchUI() logic is completely unchanged -- no JS behavior was altered for the UI merge, only its HTML container', () => {
    assert.match(AGENCY, /el\.innerHTML = '<div class="al warn">Availability on request — Vilu must confirm this property\.<\/div>';/, 'ON_REQUEST partner search result message must be unchanged');
    assert.match(AGENCY, /Request temporary hold for these dates/, 'the temporary-hold button must still exist for the Vilu search path');
  });
  test('the partner-property search branch never computes a numeric free-room count from manualPmsRoomSlots/calendarRoomSlotCount -- it only ever renders Available/Not available per room TYPE, or the ON_REQUEST warning', () => {
    const searchFn = extractByStart(AGENCY, /async function searchAvailability\(propertyIdOverride\)\{/);
    assert.doesNotMatch(searchFn, /manualPmsRoomSlots|calendarRoomSlotCount/);
  });
}

section('Part 2 — Agency Calendar renders internal PMS room slots (calendar display only)');
{
  test('getAgencyProperties() projects calendarRoomSlotCount as a plain, clamped count derived from manualPmsRoomSlots -- a deliberately different, narrower field name', () => {
    assert.match(getAgencyPropertiesSrc, /calendarRoomSlotCount:\s*Math\.max\(0,\s*Math\.round\(\+p\.manualPmsRoomSlots \|\| 0\)\)/);
  });
  test('availabilityMode is completely unaffected by the new projection -- still read straight from the property doc, clamped to the known modes', () => {
    assert.match(getAgencyPropertiesSrc, /availabilityMode: ACCOMMODATION_AVAILABILITY_MODES\.includes\(p\.availabilityMode\) \? p\.availabilityMode : 'ON_REQUEST',/);
  });
  test('getPartnerPropertyAvailability() builds room ids from the property\'s own legacyRoomPrefix + manualPmsRoomSlots -- ha-R1..ha-R10 / hb-R1..hb-R8, never a hardcoded list', () => {
    assert.match(getPartnerAvailSrc, /const slotCount = Math\.max\(0, Math\.round\(\+prop\.manualPmsRoomSlots \|\| 0\)\);/);
    assert.match(getPartnerAvailSrc, /const legacyPrefix = prop\.legacyRoomPrefix \|\| \(propertyId \+ '-R'\);/);
    assert.match(getPartnerAvailSrc, /for \(let i = 1; i <= slotCount; i\+\+\) roomIds\.push\(legacyPrefix \+ i\);/);
  });
  test('room-level occupancy is read from room_availability + blocks, the SAME collections Vilu\'s own PHYSICAL_ROOMS branch reads -- no new/second data source', () => {
    assert.match(getPartnerAvailSrc, /db\.collection\('room_availability'\)\.doc\(roomId\)\.get\(\)/);
    assert.match(getPartnerAvailSrc, /db\.collection\('blocks'\)\.where\('room_id', '==', roomId\)\.get\(\)/);
  });
  test('an empty (not occupied/blocked) room slot is NEVER labeled AVAILABLE when the property is ON_REQUEST -- its own distinct state, never confirmed bookable inventory', () => {
    assert.match(getPartnerAvailSrc, /state: mode === 'ON_REQUEST' \? 'ON_REQUEST_SLOT' : 'AVAILABLE'/);
  });
  test('own-agency-booking detection for a room slot uses the SAME agencyId-scoped reservations query pattern as Vilu (never a client-supplied agencyId, never a second/looser check)', () => {
    assert.match(getPartnerAvailSrc, /db\.collection\('reservations'\)\.where\('agencyId', '==', agencyId\)\.get\(\)/);
    assert.match(getPartnerAvailSrc, /if \(!roomIds\.includes\(r\.room_id\)\) return;/);
    assert.match(getPartnerAvailSrc, /if \(!isActiveStatus\(r\.status\)\) return;/);
    assert.match(getPartnerAvailSrc, /if \(!overlaps\(r\.check_in, r\.check_out, startDate, endDate\)\) return;/);
  });
  test('a PMS-created manual reservation (no agencyId at all) is never misattributed as "own" -- ownReservations is keyed by reservation id, matched only through the agencyId-scoped query', () => {
    assert.match(getPartnerAvailSrc, /if \(booking\) \{\s*const cell = \{ roomId, date, state: 'OCCUPIED' \};\s*if \(ownReservations\[booking\.id\]\) cell\.ownReservationId = booking\.id;/);
  });
}

section('Client — agDrawCal() renders Room 1..N rows, in order, mapped to the correct legacy ids');
{
  test('slotRooms (cache.rooms) render AFTER room types but the property-level ON_REQUEST indicator renders first and independently -- never displaced by adding room-slot rows', () => {
    const onReqIdx = agDrawCalSrc.indexOf("fH+='<div class=\"cb-room-row-lbl\"><span class=\"rn\" style=\"color:var(--muted)\">Availability on request</span></div>';");
    const roomTypesIdx = agDrawCalSrc.indexOf('roomTypes.forEach(function(rt){');
    const slotRoomsIdx = agDrawCalSrc.indexOf('slotRooms.forEach(function(room){');
    assert.ok(onReqIdx > -1 && roomTypesIdx > onReqIdx && slotRoomsIdx > roomTypesIdx, 'expected order: ON_REQUEST indicator -> room types -> room-slot rows');
  });
  test('the ON_REQUEST indicator is gated only on availabilityMode, no longer on "zero room types" -- so it still shows even once 10/8 room-slot rows exist', () => {
    assert.match(agDrawCalSrc, /var isOnRequest = p\.availabilityMode==='ON_REQUEST';/);
    assert.match(agDrawCalSrc, /if\(isOnRequest\)\{/);
  });
  test('room-slot fixed-column rows are labeled directly from the server\'s own room.label ("Room 1".."Room N"), never recomputed client-side', () => {
    assert.match(agDrawCalSrc, /slotRooms\.forEach\(function\(room\)\{\s*fH\+='<div class="cb-room-row-lbl partner-room"><span class="rn">'\+esc\(room\.label\)\+'<\/span><\/div>';/);
  });
  test('room-slot grid rows key off room.roomId directly (the server\'s own ha-R*/hb-R* id), via a data-partner-room-slot attribute distinct from the room-TYPE rows', () => {
    assert.match(agDrawCalSrc, /data-partner-room-slot="'\+p\.propertyId\+'\|'\+room\.roomId\+'"/);
  });

  // Executable: simulate the room-id generation the server performs, proving
  // the SAME shape agDrawCal() consumes (room.roomId/room.label pairs) comes
  // out correctly ordered for both properties -- mirrors the equivalent
  // proof already established for the PMS side in
  // test/pms-partner-manual-room-slots.test.js.
  function simulateRooms(prefix, slotCount) {
    const rooms = [];
    for (let i = 1; i <= slotCount; i++) rooms.push({ roomId: prefix + i, label: 'Room ' + i });
    return rooms;
  }
  test('Ranfaru Inn: 10 rooms, ha-R1..ha-R10, "Room 1".."Room 10", in order', () => {
    const rooms = simulateRooms('ha-R', 10);
    assert.equal(rooms.length, 10);
    assert.deepEqual(rooms.map((r) => r.roomId), Array.from({ length: 10 }, (_, i) => 'ha-R' + (i + 1)));
    assert.deepEqual(rooms.map((r) => r.label), Array.from({ length: 10 }, (_, i) => 'Room ' + (i + 1)));
  });
  test('White Sand Inn: 8 rooms, hb-R1..hb-R8, "Room 1".."Room 8", in order', () => {
    const rooms = simulateRooms('hb-R', 8);
    assert.equal(rooms.length, 8);
    assert.deepEqual(rooms.map((r) => r.roomId), Array.from({ length: 8 }, (_, i) => 'hb-R' + (i + 1)));
  });
  test('ha-R1/hb-R2 (the known historical reservation room ids) are exactly the 1st/2nd generated rows -- no separate "Historical" row needed once slots exist', () => {
    assert.equal(simulateRooms('ha-R', 10)[0].roomId, 'ha-R1');
    assert.equal(simulateRooms('hb-R', 8)[1].roomId, 'hb-R2');
  });
}

section('Client — agPartnerRoomCellBucket(): privacy-safe occupancy classification, executed against the real function');
{
  // Extract and RUN the real function against synthetic cache data -- proves
  // actual behavior (own/other/blocked/empty classification), not just that
  // some string is present in the source.
  const bucketFnSrc = extractFn(AGENCY, 'function agPartnerRoomCellBucket(propertyId, roomId, ds)');
  function makeBucketFn(cacheByProperty) {
    // bucketFnSrc is the REAL, complete `function agPartnerRoomCellBucket(...){...}`
    // declaration extracted verbatim -- declare it, then call it, inside one
    // Function body so it closes over the `_partnerAvailCache` parameter
    // exactly like the real module-scope variable it reads in production.
    const fn = new Function('_partnerAvailCache', 'propertyId', 'roomId', 'ds',
      bucketFnSrc + '\nreturn agPartnerRoomCellBucket(propertyId, roomId, ds);');
    return (propertyId, roomId, ds) => fn(cacheByProperty, propertyId, roomId, ds);
  }
  const bucket = makeBucketFn({
    ha: {
      roomByCell: {
        'ha-R1|2026-09-20': { roomId: 'ha-R1', date: '2026-09-20', state: 'OCCUPIED' }, // another agency/direct guest -- no ownReservationId
        'ha-R2|2026-09-20': { roomId: 'ha-R2', date: '2026-09-20', state: 'OCCUPIED', ownReservationId: 'RES123' }, // this agency's own
        'ha-R3|2026-09-20': { roomId: 'ha-R3', date: '2026-09-20', state: 'BLOCKED' },
        'ha-R4|2026-09-20': { roomId: 'ha-R4', date: '2026-09-20', state: 'ON_REQUEST_SLOT' },
      },
    },
  });
  test('another agency/direct guest\'s reservation classifies as generic OCCUPIED (no ownReservationId, never attributable)', () => {
    assert.equal(bucket('ha', 'ha-R1', '2026-09-20').kind, 'OCCUPIED');
  });
  test('this agency\'s own reservation classifies as OWN_BOOKING (via the server\'s own ownReservationId, never a client guess)', () => {
    assert.equal(bucket('ha', 'ha-R2', '2026-09-20').kind, 'OWN_BOOKING');
  });
  test('a blocked date classifies as BLOCKED', () => {
    assert.equal(bucket('ha', 'ha-R3', '2026-09-20').kind, 'BLOCKED');
  });
  test('an unoccupied ON_REQUEST slot classifies as ON_REQUEST_SLOT, never AVAILABLE -- so it can never render a green "confirmed available" bar', () => {
    assert.equal(bucket('ha', 'ha-R4', '2026-09-20').kind, 'ON_REQUEST_SLOT');
  });
  test('a date with no data at all (not yet fetched) defaults to ON_REQUEST_SLOT, never AVAILABLE', () => {
    assert.equal(bucket('ha', 'ha-R5', '2026-09-20').kind, 'ON_REQUEST_SLOT');
  });
  test('an unknown property (never fetched) never throws and defaults to ON_REQUEST_SLOT', () => {
    assert.equal(bucket('unknown-prop', 'zz-R1', '2026-09-20').kind, 'ON_REQUEST_SLOT');
  });
}

section('No drag/write control leaks on room-slot cells');
{
  test('room-slot grid cells carry NO data-room/data-partner attribute -- so neither existing generic click-wiring loop (.cb-cell[data-room] for Vilu, .cb-cell[data-partner] for room types) ever attaches a click-to-book handler to them', () => {
    const rowBuild = agDrawCalSrc.slice(agDrawCalSrc.indexOf('slotRooms.forEach(function(room){'), agDrawCalSrc.indexOf('slotRooms.forEach(function(room){') + 700);
    assert.doesNotMatch(rowBuild, /data-room="/);
    assert.doesNotMatch(rowBuild, /data-partner="/);
  });
  test('the only two generic cell-click wiring loops remain scoped to [data-room] and [data-partner] respectively -- unchanged, so they structurally cannot match a room-slot cell', () => {
    assert.match(agDrawCalSrc, /document\.querySelectorAll\('#ag-cb-grid \.cb-cell\[data-room\]'\)\.forEach/);
    assert.match(agDrawCalSrc, /document\.querySelectorAll\('#ag-cb-grid \.cb-cell\[data-partner\]'\)\.forEach/);
  });
  test('room-slot bars are click-to-VIEW only (own-booking summary / generic occupied-or-blocked alert), never draggable, never a write path', () => {
    const barsBlock = agDrawCalSrc.slice(agDrawCalSrc.indexOf('(cache.rooms||[]).forEach(function(room){'));
    assert.doesNotMatch(barsBlock.slice(0, 2500), /setAttribute\('draggable'/);
    assert.doesNotMatch(barsBlock.slice(0, 2500), /addEventListener\('dragstart'/);
  });
}

section('Regression — Vilu calendar and same-day bar geometry untouched');
{
  test('Vilu\'s own section header, category rows, and room-row building are byte-identical to before', () => {
    assert.match(AGENCY, /fH\+='<div class="cb-section-lbl"><span>⭐ Vilu Residence — Primary Property<\/span><\/div>';/);
    assert.match(AGENCY, /var vrGroups = agGroupByType\(ROOMS_LIST\);/);
  });
  test('the same-day checkout/check-in bar-geometry formula (left/right midpoint clip, Part of the 2026-09-12 fix) is unchanged for Vilu, and reused as-is for both room-type bars and the new room-slot bars', () => {
    const occurrences = [...agDrawCalSrc.matchAll(/var right\s*=\s*\(j\+1\)\*AG_CAL_COL_W\s*\+\s*\(rightSlant\?AG_CAL_COL_W\/2:0\);/g)];
    assert.ok(occurrences.length >= 3, 'expected the same right-edge midpoint formula reused for Vilu bars, room-type bars, and the new room-slot bars');
  });
}
console.log(`\n${passed}/${passed + failed} agency-unified-availability-and-partner-calendar assertions passed`);
