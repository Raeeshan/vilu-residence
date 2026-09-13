// VILU PMS — RESTORE PARTNER HOTEL SHEETS ON THE MAIN PMS CALENDAR (2026-09-13)
//
// Root cause established via `git blame`/`git log`, not guesswork: the PMS's
// own Availability Calendar (drawCal(), vilu-unified.html) NEVER read the
// canonical `accommodation_properties` Firestore collection at any point in
// its history. What the user remembered as "Ranfaru Inn"/"White Sand Inn"
// calendar sections were the OLD, hardcoded, never-persisted `PH` fixture
// ($70/night flat, 10/8 fake rooms) -- deliberately retired one day earlier
// in commit ee474f20 (2026-09-12) specifically because it let staff book
// real reservations against fake inventory. Building canonical-property
// sections into drawCal() is therefore new functionality (mirroring what
// vilu-agency-portal.html's agDrawCal() already does for the Agency Portal),
// not a revert of that commit -- these tests prove the new PMS-side
// rendering never resurrects the fake PH data it deliberately excludes.
//
//   node test/pms-calendar-partner-properties.test.js
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
const fixedIdx = drawCalSrc.indexOf("document.getElementById('cb-fixed-rows').innerHTML=fH;");
const gridIdx = drawCalSrc.indexOf("document.getElementById('cb-grid').innerHTML=gH;");
const fHBuildSrc = drawCalSrc.slice(0, fixedIdx);
const gHBuildSrc = drawCalSrc.slice(fixedIdx, gridIdx);
const barsSrc = drawCalSrc.slice(gridIdx);

section('Data source — canonical accommodation_properties, never the retired PH fixture');
{
  test('partnerSections is computed from ACC_PROPERTIES (the same global the Partner Accommodation admin page uses), not from PH', () => {
    assert.match(drawCalSrc, /var partnerSections\s*=\s*\(typeof ACC_PROPERTIES!==['"]undefined['"]\?ACC_PROPERTIES:\[\]\)\.filter\(function\(p\)\{return !p\.isVilu&&p\.active!==false;\}\)/);
  });
  test('drawCal() never introduces a second partner-hotel config system -- no new Firestore collection name appears in it besides accommodation_properties (via ACC_PROPERTIES/ACC_ROOM_TYPES_CACHE)', () => {
    assert.doesNotMatch(drawCalSrc, /fsDb\.collection\(/, 'drawCal() should read the already-loaded ACC_PROPERTIES/ACC_ROOM_TYPES_CACHE caches, not fetch a new collection itself');
  });
  test('no fake $70 rate, and no literal "Ranfaru Inn"/"White Sand Inn" hardcoded string, is introduced anywhere in drawCal() (code only -- historical comments describing the old retired rate are fine)', () => {
    const codeOnly = drawCalSrc.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(codeOnly, /rate\s*:\s*70\b/, 'the old PH rate:70 pattern must never reappear as live code inside drawCal()');
    assert.doesNotMatch(codeOnly, /Ranfaru Inn/);
    assert.doesNotMatch(codeOnly, /White Sand Inn/);
  });
  test('the property section label is read from the canonical doc\'s own propertyName field, not a literal', () => {
    assert.match(fHBuildSrc, /esc\(p\.propertyName\|\|p\.id\)/);
  });
}

section('Zero-room-type ON_REQUEST rendering — clean section, no fabricated inventory');
{
  test('a partner with zero active room types renders "Availability on request" when ON_REQUEST, or "No room types configured yet" otherwise -- never a fabricated room row', () => {
    assert.match(fHBuildSrc, /p\.availabilityMode===['"]ON_REQUEST['"]\?['"]Availability on request['"]:['"]No room types configured yet['"]/);
  });
  test('the zero-room-type case is driven by roomTypes.length, so it disappears automatically (no duplicate section) once real room types are configured', () => {
    assert.match(fHBuildSrc, /if\(!sec\.roomTypes\.length\)\{/);
    assert.match(gHBuildSrc, /if\(!sec\.roomTypes\.length\)\s*gH\+=mRStatic\('__onreq_'\+sec\.p\.id\);/);
  });
  test('exactly one cb-section-lbl is emitted per partner property regardless of how many room types/legacy rows it has (no duplicate property sections)', () => {
    const forEachBody = extractByStart(fHBuildSrc, /partnerSections\.forEach\(function\(sec\)\{/);
    const sectionLblCount = (forEachBody.match(/cb-section-lbl/g) || []).length;
    assert.equal(sectionLblCount, 1, 'expected exactly one cb-section-lbl push inside the per-property forEach body');
  });
  test('configured room types render as additional rows under the SAME section (expansion, not a new section)', () => {
    assert.match(fHBuildSrc, /sec\.roomTypes\.forEach\(function\(rt\)\{/);
    assert.match(gHBuildSrc, /sec\.roomTypes\.forEach\(function\(rt\)\{\s*gH\+=mRStatic\(sec\.p\.id\+'::'\+rt\.id\);/);
  });
}

section('Legacy ha-R*/hb-R* historical compatibility — visible, never rewritten, never new bookable inventory');
{
  test('the legacy prefix is read from the canonical doc\'s own legacyRoomPrefix field (falling back to id+"-R"), not hardcoded to ha-/hb-', () => {
    assert.match(drawCalSrc, /var prefix\s*=\s*p\.legacyRoomPrefix\|\|\(p\.id\+'-R'\);/);
  });
  test('legacy reservations are found by matching RES rn against that prefix AND overlapping the visible date window, deduped and numerically sorted', () => {
    assert.match(drawCalSrc, /RES\.filter\(function\(r\)\{return r\.rn&&r\.rn\.indexOf\(prefix\)===0&&r\.ci<winEndExcl&&r\.co>winStart;\}\)/);
  });
  test('legacy compatibility rows are built with mRStatic (.cb-cell-ro), never mR (.cb-cell) -- so they can never become a drag-select/click-to-book target', () => {
    assert.match(gHBuildSrc, /sec\.legacyRns\.forEach\(function\(rn\)\{\s*gH\+=mRStatic\(rn\);\s*\}\);/);
  });
  test('.cb-cell-ro is a visually-matching but non-interactive class, structurally separate from the real .cb-cell used for bookable Vilu rows', () => {
    assert.match(PMS, /\.cb-cell-ro\{[^}]*\}/);
    const mRStaticSrc = extractByStart(drawCalSrc, /function mRStatic\(rn\)\{/);
    assert.match(mRStaticSrc, /cb-cell-ro/);
    assert.doesNotMatch(mRStaticSrc, /class="cb-cell /, 'mRStatic must never emit the interactive cb-cell class');
  });
  test('legacy reservation documents are never mutated anywhere in the historical-bar rendering path', () => {
    const histStart = barsSrc.indexOf('if(partnerSections.length) RES.filter(function(r){');
    const histEnd = barsSrc.indexOf("document.querySelectorAll('.cb-cell')");
    const histBlock = barsSrc.slice(histStart, histEnd);
    assert.doesNotMatch(histBlock, /res\.rn\s*=/, 'must never write res.rn');
    assert.doesNotMatch(histBlock, /res\.ci\s*=/, 'must never write res.ci');
    assert.doesNotMatch(histBlock, /res\.co\s*=/, 'must never write res.co');
    assert.doesNotMatch(histBlock, /saveRES\(/, 'must never call saveRES on a historical partner reservation');
  });
  test('the historical bar loop is scoped ONLY to Cancelled reservations matching a partner prefix -- Vilu\'s own Cancelled-hides-bar behavior is untouched', () => {
    assert.match(barsSrc, /RES\.filter\(function\(r\)\{\s*return r\.st===['"]Cancelled['"]&&partnerSections\.some\(function\(sec\)\{return r\.rn&&r\.rn\.indexOf\(sec\.prefix\)===0;\}\);\s*\}\)/);
    // The ORIGINAL, unrelated Vilu/general bar loop still excludes Cancelled -- unchanged.
    assert.match(barsSrc, /RES\.filter\(function\(r\)\{return r\.st!==['"]Cancelled['"];\}\)\.forEach\(function\(res\)\{/);
  });
  test('a historical partner reservation bar is never draggable and never sets the drag flag, even if a future one is not Cancelled', () => {
    assert.match(barsSrc, /var isHistPartner\s*=\s*partnerSections\.some\(function\(sec\)\{return res\.rn&&res\.rn\.indexOf\(sec\.prefix\)===0;\}\);/);
    assert.match(barsSrc, /if\(!\(res\.isBlock\|\|res\.src===['"]Agency Block['"]\|\|isHistPartner\)\)\{\s*bar\.setAttribute\('draggable','true'\);/);
    assert.match(barsSrc, /if\(!\(res\.isBlock\|\|res\.src===['"]Agency Block['"]\|\|isHistPartner\)\)\{bDrg=true;sOn=false;\}/);
  });
  test('the read-only historical bar is click-to-view only (showDet), with no drag/mousedown wiring at all', () => {
    const histStart = barsSrc.indexOf('if(partnerSections.length) RES.filter(function(r){');
    const histEnd = barsSrc.indexOf("document.querySelectorAll('.cb-cell')");
    const histBlock = barsSrc.slice(histStart, histEnd);
    assert.match(histBlock, /bar\.addEventListener\('click',function\(e\)\{e\.preventDefault\(\);e\.stopPropagation\(\);showDet\(res\.id\);\}\);/);
    assert.doesNotMatch(histBlock, /setAttribute\('draggable'/);
    assert.doesNotMatch(histBlock, /addEventListener\('mousedown'/);
    assert.doesNotMatch(histBlock, /addEventListener\('dragstart'/);
  });
}

section('Date-window gating (2026-09-13 follow-up) — a legacy row appears ONLY while its own dates are visible, never permanently');
{
  // Extract the REAL production expression (not a reimplementation) and run
  // it against synthetic RES fixtures for several visible-window scenarios,
  // so this proves actual behavior, not just that some regex is present.
  const filterExprMatch = drawCalSrc.match(/RES\.filter\(function\(r\)\{return r\.rn&&r\.rn\.indexOf\(prefix\)===0&&r\.ci<winEndExcl&&r\.co>winStart;\}\)\.map\(function\(r\)\{return r\.rn;\}\)/);
  assert.ok(filterExprMatch, 'could not locate the legacy-row window-overlap expression to test it live');
  const legacyRnsFor = (prefix, winStart, winEndExcl, RES) =>
    Array.from(new Set(new Function('RES', 'prefix', 'winStart', 'winEndExcl', 'return ' + filterExprMatch[0] + ';')(RES, prefix, winStart, winEndExcl)));

  const RES_FIXTURE = [
    { id: 'BK007', rn: 'ha-R1', ci: '2026-07-11', co: '2026-07-15', st: 'Cancelled' },
    { id: 'BK008', rn: 'hb-R2', ci: '2026-07-12', co: '2026-07-16', st: 'Cancelled' },
  ];

  test('September/current window: ha-R1 does NOT appear under Ranfaru (no overlap)', () => {
    const rns = legacyRnsFor('ha-R', '2026-09-13', '2026-10-13', RES_FIXTURE);
    assert.deepEqual(rns, []);
  });
  test('September/current window: hb-R2 does NOT appear under White Sand (no overlap)', () => {
    const rns = legacyRnsFor('hb-R', '2026-09-13', '2026-10-13', RES_FIXTURE);
    assert.deepEqual(rns, []);
  });
  test('July historical window: ha-R1 DOES appear under Ranfaru (overlaps 2026-07-11..07-15)', () => {
    const rns = legacyRnsFor('ha-R', '2026-07-01', '2026-07-31', RES_FIXTURE);
    assert.deepEqual(rns, ['ha-R1']);
  });
  test('July historical window: hb-R2 DOES appear under White Sand (overlaps 2026-07-12..07-16)', () => {
    const rns = legacyRnsFor('hb-R', '2026-07-01', '2026-07-31', RES_FIXTURE);
    assert.deepEqual(rns, ['hb-R2']);
  });
  test('window entirely BEFORE the stay: row disappears (half-open interval -- checkout day itself is not occupied)', () => {
    assert.deepEqual(legacyRnsFor('ha-R', '2026-06-01', '2026-07-01', RES_FIXTURE), []); // ci(07-11) is NOT < winEndExcl(07-01)
    assert.deepEqual(legacyRnsFor('ha-R', '2026-07-01', '2026-07-11', RES_FIXTURE), []); // window ends exactly at check-in day, no overlap yet
  });
  test('window entirely AFTER the stay: row disappears (checkout day boundary, half-open)', () => {
    assert.deepEqual(legacyRnsFor('ha-R', '2026-07-15', '2026-08-01', RES_FIXTURE), []); // co(07-15) is NOT > winStart(07-15)
    assert.deepEqual(legacyRnsFor('ha-R', '2026-07-16', '2026-08-01', RES_FIXTURE), []);
  });
  test('window overlapping only the check-in day edge still shows the row (arrival day counts)', () => {
    assert.deepEqual(legacyRnsFor('ha-R', '2026-07-11', '2026-07-12', RES_FIXTURE), ['ha-R1']);
  });
  test('window overlapping only the day before checkout still shows the row (last occupied night counts)', () => {
    assert.deepEqual(legacyRnsFor('ha-R', '2026-07-14', '2026-07-15', RES_FIXTURE), ['ha-R1']);
  });
  test('a property with NO historical reservations at all (arbitrary prefix) never shows a row in any window', () => {
    assert.deepEqual(legacyRnsFor('zz-R', '2026-07-01', '2026-07-31', RES_FIXTURE), []);
  });
}

section('Ordering — configured room types before compatibility-only historical rows, in both windows');
{
  test('within one property section, roomTypes render before legacyRns in BOTH the fixed column and the grid (never interleaved/reordered)', () => {
    const fixedForEach = extractByStart(fHBuildSrc, /partnerSections\.forEach\(function\(sec\)\{/);
    const roomTypesIdxF = fixedForEach.indexOf('sec.roomTypes.forEach(function(rt){');
    const legacyIdxF = fixedForEach.indexOf('sec.legacyRns.forEach(function(rn){');
    assert.ok(roomTypesIdxF > -1 && legacyIdxF > -1 && roomTypesIdxF < legacyIdxF, 'fixed column: roomTypes must be emitted before legacyRns');
    const gridForEach = extractByStart(gHBuildSrc, /partnerSections\.forEach\(function\(sec\)\{/);
    const roomTypesIdxG = gridForEach.indexOf("sec.roomTypes.forEach(function(rt){ gH+=mRStatic(sec.p.id+'::'+rt.id); });");
    const legacyIdxG = gridForEach.indexOf('sec.legacyRns.forEach(function(rn){ gH+=mRStatic(rn); });');
    assert.ok(roomTypesIdxG > -1 && legacyIdxG > -1 && roomTypesIdxG < legacyIdxG, 'grid: roomTypes must be emitted before legacyRns');
  });
  test('a configured room type is never gated by the date window -- only the legacy compatibility rows are', () => {
    const forEachBody = extractByStart(fHBuildSrc, /partnerSections\.forEach\(function\(sec\)\{/);
    // roomTypes.forEach itself carries no winStart/winEndExcl reference -- only the legacyRns
    // computation (already proven above) does.
    const roomTypesBlock = extractByStart(forEachBody, /sec\.roomTypes\.forEach\(function\(rt\)\{/);
    assert.doesNotMatch(roomTypesBlock, /winStart|winEndExcl/);
  });
}

section('Vilu Residence regression guard — completely untouched');
{
  test('Vilu\'s own section header, VR room source, and mR()-based bookable rows are byte-identical to before', () => {
    assert.match(PMS, /var fH='<div class="cb-section-lbl"><span>Vilu Residence<\/span><\/div>';/);
    assert.match(PMS, /var vrGroups=groupByType\(VR\);/);
    assert.match(PMS, /grp\.rooms\.forEach\(function\(rm\)\{gH\+=mR\(rm,false,null\);\}\);/);
  });
  test('the general (non-partner) reservation bar loop still filters Cancelled exactly as before', () => {
    assert.match(barsSrc, /RES\.filter\(function\(r\)\{return r\.st!==['"]Cancelled['"];\}\)\.forEach\(function\(res\)\{/);
  });
  test('the PH retirement (Part 10) comments and getR()/getHR()/rNm() lookup helpers remain untouched', () => {
    assert.match(PMS, /Calendar-fix follow-up \(Part 10\)/);
    assert.match(PMS, /function getHR\(\)\{/);
    assert.match(PMS, /function getR\(n\)\{return \[\.\.\.VR,\.\.\.getHR\(\)\]\.find\(r=>r\.n===n\);\}/);
  });
}

section('Async load — synchronous callers of drawCal() are never blocked, and partner config edits invalidate the cache');
{
  test('drawCal() itself stays synchronous; the accommodation_properties fetch is fire-and-forget with a self re-render on completion', () => {
    assert.match(PMS, /function drawCal\(\)\{\s*sR=null;sS=null;sE=null;sOn=false;\s*if\(!PMS_CAL_ACC_READY\)\{ pmsCalLoadPartnerProps\(\); \}/);
    assert.doesNotMatch(drawCalSrc, /^\s*async function drawCal/);
  });
  test('editing a partner property or its room types invalidates the PMS calendar cache so the sheet expands automatically on next visit', () => {
    assert.match(PMS, /toast\('✓ '\+nm\+' saved'\);\s*if\(typeof PMS_CAL_ACC_READY!==['"]undefined['"]\)PMS_CAL_ACC_READY=false;/);
    assert.match(PMS, /toast\('✓ Room type saved'\);\s*delete ACC_ROOM_TYPES_CACHE\[propertyId\];\s*if\(typeof PMS_CAL_ACC_READY!==['"]undefined['"]\)PMS_CAL_ACC_READY=false;/);
  });
}

section('Agency Calendar isolation — completely unaffected by this PMS-only change');
{
  test('agDrawCal() (Agency Portal) contains none of the new PMS-only symbols', () => {
    const agCalSrc = extractByStart(AGENCY, /async function agDrawCal\(\)\s*\{/);
    assert.doesNotMatch(agCalSrc, /PMS_CAL_ACC_READY/);
    assert.doesNotMatch(agCalSrc, /mRStatic/);
    assert.doesNotMatch(agCalSrc, /cb-cell-ro/);
    assert.doesNotMatch(agCalSrc, /isHistPartner/);
  });
  test('the Agency Portal\'s own existing ON_REQUEST rendering (per-property striped bar) is untouched', () => {
    assert.match(AGENCY, /data-partner-onrequest="'\+p\.propertyId\+'"/);
  });
}

console.log(`\n${passed}/${passed + failed} pms-calendar-partner-properties (structural) assertions passed`);
