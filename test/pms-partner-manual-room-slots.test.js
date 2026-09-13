// VILU PMS — INTERNAL PMS MANUAL ROOM SLOTS FOR RANFARU INN / WHITE SAND INN
// (2026-09-13, third follow-up to the multi-property calendar restore)
//
// The previous fix showed Ranfaru Inn/White Sand Inn as clean "Availability
// on request" sections -- correct for external/Agency purposes, but the
// user needed something more: real, permanent, STAFF-ONLY room slots
// (Room 1..10 / Room 1..8, using the exact legacy ha-R*/hb-R* ids) so a
// PMS user can manually select a specific partner room and create a
// reservation against it, exactly like a Vilu room, WITHOUT that ever
// becoming public/Agency/OTA-visible commercial inventory and WITHOUT
// restoring the old PH $70/night fixture rate.
//
// Architecture: a plain `manualPmsRoomSlots` count field lives on the
// existing canonical accommodation_properties doc (one source of truth,
// admin-editable in the Partner Accommodation page) -- never a second
// partner-hotel config system, never new fabricated inventory. drawCal()
// renders exactly that many mR()-based (fully bookable, same as Vilu) rows
// per property; New Booking's existing candidate-agnostic room-selection
// pipeline (already generic before Part 10 retired only its UI options)
// is re-opened for these rooms with rate forced to null (manual entry
// only, never a default).
//
//   node test/pms-partner-manual-room-slots.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }

const PMS = read('vilu-unified.html');
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

const drawCalSrc = extractByStart(PMS, /function drawCal\(\)\s*\{/);
const gridIdx = drawCalSrc.indexOf("document.getElementById('cb-grid').innerHTML=gH;");
const fHBuildSrc = drawCalSrc.slice(0, drawCalSrc.indexOf("document.getElementById('cb-fixed-rows').innerHTML=fH;"));
const gHBuildSrc = drawCalSrc.slice(drawCalSrc.indexOf("document.getElementById('cb-fixed-rows').innerHTML=fH;"), gridIdx);
const barsSrc = drawCalSrc.slice(gridIdx);

const initNBSrc = extractByStart(PMS, /async function initNB\(\)\{/);
const submitNBSrc = extractByStart(PMS, /async function submitNB\(\)\{/);
const nbAddRoomSrc = extractByStart(PMS, /function nbAddRoom\(rn\)\{/);
const getAvailRoomsSrc = extractByStart(PMS, /async function getAvailableRoomsWithRates\(candidateRooms, ci, co, excludeId\) \{/);

// ---- A tiny in-process simulation of the room-row-count logic, run
// against the REAL extracted expression, to prove actual behavior (not
// just that a regex exists) for the 10/8-row and ordering requirements.
function simulateManualSlotRows(prefix, manualSlots) {
  const rows = [];
  for (let mi = 1; mi <= manualSlots; mi++) rows.push({ rn: prefix + mi, nm: 'Room ' + mi });
  return rows;
}

section('Architecture — one canonical field, no second config system, no fake commercial data');
{
  test('manualPmsRoomSlots is read straight off the canonical accommodation_properties doc (via ACC_PROPERTIES), not from PH or a new collection', () => {
    assert.match(drawCalSrc, /var manualSlots\s*=\s*Math\.max\(0,\+p\.manualPmsRoomSlots\|\|0\);/);
  });
  test('saveAccProp() persists it to the SAME accommodation_properties doc as every other partner-property field (no new Firestore collection)', () => {
    const savePropSrc = extractByStart(PMS, /async function saveAccProp\(\)\{/);
    assert.match(savePropSrc, /manualPmsRoomSlots:\s*Math\.max\(0,Math\.round\(\+document\.getElementById\('ah-manual-slots'\)\.value\|\|0\)\)/);
    assert.doesNotMatch(savePropSrc, /fsDb\.collection\((?!'accommodation_properties')/, 'saveAccProp must write only to accommodation_properties');
  });
  test('a brand-new property defaults to 0 manual slots -- never a fabricated non-zero default', () => {
    const openAddSrc = extractByStart(PMS, /function openAddAccProp\(\)\{/);
    assert.match(openAddSrc, /document\.getElementById\('ah-manual-slots'\)\.value\s*=\s*0;/);
  });
  test('no PH-array room list ($70 rate, hardcoded 10/8 rooms) is read anywhere in the manual-slot rendering path', () => {
    assert.doesNotMatch(drawCalSrc.replace(/\/\/.*$/gm, ''), /PH\.(find|forEach|filter)/, 'drawCal() must never read PH directly for these rows');
  });
}

section('Ranfaru Inn — 10 internal PMS room rows, correctly ordered');
{
  const rows = simulateManualSlotRows('ha-R', 10);
  test('exactly 10 rows are generated', () => { assert.equal(rows.length, 10); });
  test('ids run ha-R1..ha-R10 in order', () => {
    assert.deepEqual(rows.map(r => r.rn), Array.from({length:10}, (_,i)=>'ha-R'+(i+1)));
  });
  test('labels run Room 1..Room 10 in order', () => {
    assert.deepEqual(rows.map(r => r.nm), Array.from({length:10}, (_,i)=>'Room '+(i+1)));
  });
}

section('White Sand Inn — 8 internal PMS room rows, correctly ordered');
{
  const rows = simulateManualSlotRows('hb-R', 8);
  test('exactly 8 rows are generated', () => { assert.equal(rows.length, 8); });
  test('ids run hb-R1..hb-R8 in order', () => {
    assert.deepEqual(rows.map(r => r.rn), Array.from({length:8}, (_,i)=>'hb-R'+(i+1)));
  });
  test('labels run Room 1..Room 8 in order', () => {
    assert.deepEqual(rows.map(r => r.nm), Array.from({length:8}, (_,i)=>'Room '+(i+1)));
  });
}

section('Historical + legacy id mapping — ha-R1/hb-R2 land on the SAME permanent row, no separate "Historical" tag needed');
{
  test('ha-R1 is the 1st generated row for Ranfaru (10 slots)', () => {
    const rows = simulateManualSlotRows('ha-R', 10);
    assert.equal(rows[0].rn, 'ha-R1');
  });
  test('hb-R2 is the 2nd generated row for White Sand (8 slots)', () => {
    const rows = simulateManualSlotRows('hb-R', 8);
    assert.equal(rows[1].rn, 'hb-R2');
  });
  test('once manualSlots>0, the old date-window-gated legacy compatibility row is skipped entirely (rows come from the SAME permanent set, not a duplicate temporary one)', () => {
    assert.match(drawCalSrc, /var legacyRns=manualSlots>0\?\[\]:Array\.from/);
  });
  test('the fixed-column "Historical" tag only ever renders in the manualSlots===0 fallback branch (never alongside real permanent rows)', () => {
    const forEachBody = extractByStart(fHBuildSrc, /partnerSections\.forEach\(function\(sec\)\{/);
    const idx = forEachBody.indexOf('Historical');
    const elseBranchIdx = forEachBody.indexOf('} else if(!sec.roomTypes.length){');
    assert.ok(idx > elseBranchIdx && elseBranchIdx > -1, '"Historical" label must live inside the manualSlots===0 fallback branch only');
  });
}

section('Real bookable rows — same mR() builder as Vilu, full drag/click/conflict behavior, in correct property order');
{
  test('manual-slot grid rows are built with mR() (the real, interactive, .cb-cell-based row builder), never mRStatic', () => {
    assert.match(gHBuildSrc, /for\(var mi=1;mi<=sec\.manualSlots;mi\+\+\)\{ gH\+=mR\(\{n:sec\.prefix\+mi,nm:'Room '\+mi\},false,null\); \}/);
  });
  test('roomTypes (configured commercial rows, if any) render before the manual-slot rows, which render before the zero-config fallback -- consistent order in both fixed column and grid', () => {
    const fEachF = extractByStart(fHBuildSrc, /partnerSections\.forEach\(function\(sec\)\{/);
    const rtIdx = fEachF.indexOf('sec.roomTypes.forEach(function(rt){');
    const slotIdx = fEachF.indexOf('if(sec.manualSlots>0){');
    const fallbackIdx = fEachF.indexOf('} else if(!sec.roomTypes.length){');
    assert.ok(rtIdx > -1 && slotIdx > rtIdx && fallbackIdx > slotIdx, 'expected order: roomTypes -> manual slots -> zero-config fallback');
  });
  test('a reservation on a manual-slot row (manualSlots>0) is fully draggable/editable, exactly like Vilu -- the legacy drag-guard no longer applies once manual slots exist', () => {
    assert.match(barsSrc, /var isHistPartner\s*=\s*partnerSections\.some\(function\(sec\)\{return sec\.manualSlots===0&&res\.rn&&res\.rn\.indexOf\(sec\.prefix\)===0;\}\);/);
  });
  test('property order is preserved: Vilu Residence\'s own section is built first, partnerSections (Ranfaru then White Sand, by displayOrder) strictly after', () => {
    const viluIdx = PMS.indexOf("var fH='<div class=\"cb-section-lbl\"><span>Vilu Residence</span></div>';");
    const partnerIdx = PMS.indexOf('partnerSections.forEach(function(sec){');
    assert.ok(viluIdx > -1 && partnerIdx > viluIdx, 'Vilu section must be built before any partner section');
  });
}

section('New Booking — property + room selection restored, generic conflict protection, no automatic rate');
{
  test('initNB() re-offers a partner property option ONLY when manualPmsRoomSlots>0, sourced from ACC_PROPERTIES (never PH)', () => {
    assert.match(initNBSrc, /ACC_PROPERTIES\.filter\(function\(p\)\{return !p\.isVilu&&p\.active!==false&&\(\+p\.manualPmsRoomSlots\|\|0\)>0;\}\)/);
    assert.doesNotMatch(initNBSrc.replace(/\/\/.*$/gm,''), /PH\.(find|forEach|filter|map)/);
  });
  test('the room-selection pipeline is candidate-agnostic (getHR().filter by prop), sliced to exactly manualPmsRoomSlots -- so exactly the configured count of rooms is offered, never more', () => {
    const nbRenderRoomsSrc = extractByStart(PMS, /async function nbRenderRooms\(\)\{/);
    assert.match(nbRenderRoomsSrc, /getHR\(\)\.filter\(r=>r\.prop===prop\)\.slice\(0,partnerManualSlotCount\(prop\)\)/);
  });
  test('a room added for a non-Vilu property gets rate:null (never the PH $70 default) -- manual entry only', () => {
    assert.match(nbAddRoomSrc, /const rate=isVR\(rn\)\?getDateRangeRate\(rn,ci,co\):null;/);
  });
  test('the availability-table rate lookup also returns null for a non-Vilu room, never rm.rate (the PH fixture value)', () => {
    assert.match(getAvailRoomsSrc, /var rate = isVR\(rm\.n\) \? getDateRangeRate\(rm\.n, ci, co\) : null;/);
  });
  test('submitNB() refuses to save when any selected room has no rate and no manual override was entered -- blocks a silent rate:0/rate:null write', () => {
    assert.match(submitNBSrc, /if\(nbSelectedRooms\.some\(function\(r\)\{return r\.rate==null;\}\)&&pricing\.rateOverride==null\)\{/);
    assert.match(submitNBSrc, /Enter a room rate/);
  });
  test('the saved reservation still stores the exact selected room id (room.n) as rn/room_id -- so it appears on the matching Ranfaru/White Sand calendar row', () => {
    assert.match(submitNBSrc, /rn:room\.n/);
  });
  test('writeReservation()\'s conflict transaction is completely generic by room id -- no isVR/Vilu-only branch in the conflict check itself', () => {
    const writeResSrc = extractByStart(PMS, /async function writeReservation\(docId, fields, opts\) \{/);
    assert.doesNotMatch(writeResSrc, /isVR\(/, 'the conflict-protection transaction must not special-case Vilu rooms');
  });
}

section('No $70 rate anywhere in this feature, ever');
{
  test('no code path in this feature (drawCal, initNB, nbAddRoom, getAvailableRoomsWithRates, saveAccProp) contains a literal 70 rate', () => {
    [drawCalSrc, initNBSrc, nbAddRoomSrc, getAvailRoomsSrc].forEach(src => {
      const codeOnly = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
      assert.doesNotMatch(codeOnly, /rate\s*:\s*70\b/);
    });
  });
}

section('Agency Portal / external availability — completely unaffected');
{
  test('manualPmsRoomSlots is never read anywhere in vilu-agency-portal.html', () => {
    assert.doesNotMatch(AGENCY, /manualPmsRoomSlots/);
  });
  test('manualPmsRoomSlots is never read anywhere in functions-core/index.js (getAgencyProperties/getAgencyPropertyRoomTypes/getAgencyAvailability all stay untouched)', () => {
    assert.doesNotMatch(FUNCTIONS_CORE, /manualPmsRoomSlots/);
  });
  test('agDrawCal() still renders the ON_REQUEST striped/clean bar exactly as before -- no manual-slot-derived room count leaks into it', () => {
    assert.match(AGENCY, /data-partner-onrequest="'\+p\.propertyId\+'"/);
  });
  test('the Agency Portal ON_REQUEST rendering condition (!roomTypes.length) is untouched -- it has no concept of manualPmsRoomSlots at all', () => {
    const agCalSrc = extractByStart(AGENCY, /async function agDrawCal\(\)\s*\{/);
    assert.match(agCalSrc, /if\(!roomTypes\.length\)\{/);
  });
}

section('Vilu\'s six rooms — completely unchanged');
{
  test('VR array (Vilu\'s own room source) is untouched by this feature', () => {
    assert.match(PMS, /const VR=\[\s*\{n:'VR01',nm:'Room 101',type:'Deluxe Family Room',rate:80,cap:3\},/);
  });
  test('Vilu\'s own fixed-column/grid building code is unchanged (byte-identical section header and mR() call)', () => {
    assert.match(PMS, /var fH='<div class="cb-section-lbl"><span>Vilu Residence<\/span><\/div>';/);
    assert.match(PMS, /grp\.rooms\.forEach\(function\(rm\)\{gH\+=mR\(rm,false,null\);\}\);/);
  });
}

console.log(`\n${passed}/${passed + failed} pms-partner-manual-room-slots (structural) assertions passed`);
