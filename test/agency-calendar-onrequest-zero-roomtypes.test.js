// VILU AGENCY PORTAL — LIVE CALENDAR FIX: ON_REQUEST PARTNER PROPERTIES WITH
// ZERO CONFIGURED ROOM TYPES.
//
// Root cause (found by reproducing the live screenshot against the actual
// rendering code, not assumed): two separate bugs, both only visible once a
// REAL production partner property existed with zero room types (Ranfaru
// Inn / White Sand Inn, bridged from the legacy PH array with deliberately
// no fabricated room-type/rate data):
//
//   1. The partner section header (".cb-section-lbl") had the qualifier
//      "· availability on request" appended directly onto the property
//      name, inside a fixed 22px row with NO overflow control on either the
//      row or its <span> -- a real property name plus that suffix routinely
//      wrapped/overflowed, desyncing the fixed column's row heights from the
//      timeline grid's (the "crushed header" look in the live screenshot).
//   2. The "zero room types" empty-state path always rendered the same
//      "No room types configured yet" italic label + a blank, unstyled,
//      unclickable full-width cell -- appropriate for a MANUAL_INVENTORY
//      property mid-setup, but never designed for a property that is
//      PERMANENTLY, INTENTIONALLY property-level ON_REQUEST with no
//      room-type catalog at all. That case now gets its own clean "On
//      request" row + the same striped "Availability on request — ask
//      Vilu" bar already used for the (room-types-configured) ON_REQUEST
//      case, instead of a broken blank cell.
//
//   node test/agency-calendar-onrequest-zero-roomtypes.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }

const PORTAL = read('vilu-agency-portal.html');

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

section('Root cause 1 — the partner section header never overflows/wraps its fixed-height row again');
{
  test('.cb-section-lbl itself clips overflow', () => {
    assert.match(PORTAL, /\.cb-section-lbl\{[^}]*overflow:hidden[^}]*\}/);
  });
  test('.cb-section-lbl span truncates with an ellipsis instead of wrapping', () => {
    const m = PORTAL.match(/\.cb-section-lbl span\{([^}]*)\}/);
    assert.ok(m, '.cb-section-lbl span rule not found');
    assert.match(m[1], /white-space:nowrap/);
    assert.match(m[1], /overflow:hidden/);
    assert.match(m[1], /text-overflow:ellipsis/);
  });
  test('the "· availability on request" qualifier is no longer appended to the section header label', () => {
    const src = extractByStart(PORTAL, /async function agDrawCal\(\)\s*\{/);
    assert.doesNotMatch(src, /esc\(p\.propertyName\)\+\(p\.availabilityMode===['"]ON_REQUEST['"]/, 'the old concatenation onto the section header must be gone');
  });
}

section('Root cause 2 — a property-level ON_REQUEST property with zero room types gets a clean dedicated row, never the generic "still being configured" blank cell');
{
  test('the zero-room-types branch checks availabilityMode and renders a distinct "On request" row + a data-partner-onrequest marker for ON_REQUEST', () => {
    const src = extractByStart(PORTAL, /async function agDrawCal\(\)\s*\{/);
    const partnerBuildIdx = src.indexOf('partnerProps.forEach(function(p){');
    const barsBuildIdx = src.indexOf('// Bars: merge consecutive');
    const buildSrc = src.slice(partnerBuildIdx, barsBuildIdx);
    // Superseded by the internal-room-slots follow-up (2026-09-13): the
    // check is now `var isOnRequest = p.availabilityMode==='ON_REQUEST';`
    // followed by `if(isOnRequest){` (no longer inline), and the label
    // itself was upgraded from the terse "On request" to "Availability on
    // request" to match the PMS's own wording -- see
    // test/agency-unified-availability-and-partner-calendar.test.js for the
    // full current-behavior proof.
    assert.match(buildSrc, /var isOnRequest = p\.availabilityMode==='ON_REQUEST';/);
    assert.match(buildSrc, /if\(isOnRequest\)\{/);
    assert.match(buildSrc, /data-partner-onrequest="'\+p\.propertyId\+'"/);
    assert.match(buildSrc, />Availability on request</);
  });
  test('a non-ON_REQUEST property with zero room types keeps the original "No room types configured yet" fallback, unchanged', () => {
    const src = extractByStart(PORTAL, /async function agDrawCal\(\)\s*\{/);
    assert.match(src, /No room types configured yet/);
  });
  test('the property name itself is never re-fabricated as a fake room-type row -- the fixed-column label says "On request", not the property name repeated', () => {
    const src = extractByStart(PORTAL, /async function agDrawCal\(\)\s*\{/);
    const partnerBuildIdx = src.indexOf('partnerProps.forEach(function(p){');
    const barsBuildIdx = src.indexOf('// Bars: merge consecutive');
    const buildSrc = src.slice(partnerBuildIdx, barsBuildIdx);
    // Wording upgraded to "Availability on request" (2026-09-13 follow-up) --
    // still never the property name repeated.
    assert.match(buildSrc, /<span class="rn" style="color:var\(--muted\)">Availability on request<\/span>/);
  });
}

section('Root cause 2 (bars) — the property-level ON_REQUEST row gets the SAME striped "Availability on request" bar as the per-room-type case, targeted at its own row');
{
  // Superseded by the internal-room-slots follow-up (2026-09-13, see
  // test/agency-unified-availability-and-partner-calendar.test.js): the
  // ON_REQUEST bar check is no longer gated on "zero room types" at all --
  // it now runs unconditionally whenever the property itself is ON_REQUEST
  // (so it still shows even once 10/8 room-slot rows exist alongside it),
  // BEFORE the per-room-type forEach either way.
  test('the property-level ON_REQUEST bar check runs BEFORE the per-room-type forEach, and only draws a bar for ON_REQUEST (never for a plain MANUAL_INVENTORY property still being configured)', () => {
    const src = extractByStart(PORTAL, /async function agDrawCal\(\)\s*\{/);
    const barsIdx = src.indexOf('// Bars: merge consecutive');
    const barsSrc = src.slice(barsIdx);
    const onRequestIdx = barsSrc.indexOf("if(cache.property && cache.property.availabilityMode==='ON_REQUEST'){");
    assert.ok(onRequestIdx > -1, 'property-level ON_REQUEST bar branch not found');
    const perRoomTypeForEachIdx = barsSrc.indexOf('(cache.roomTypes||[]).forEach(function(rt){');
    assert.ok(onRequestIdx < perRoomTypeForEachIdx, 'the property-level ON_REQUEST check must run before the per-room-type forEach');
    const onRequestBranch = barsSrc.slice(onRequestIdx, perRoomTypeForEachIdx);
    assert.match(onRequestBranch, /data-partner-onrequest="'\+p\.propertyId\+'"/);
    assert.match(onRequestBranch, /Availability on request — ask Vilu/);
    assert.match(onRequestBranch, /repeating-linear-gradient/);
  });
  test('the existing per-room-type ON_REQUEST striped bar is untouched', () => {
    const src = extractByStart(PORTAL, /async function agDrawCal\(\)\s*\{/);
    assert.match(src, /data-partner-room="'\+p\.propertyId\+'\|'\+rt\.roomTypeId\+'"/);
  });
}
console.log(`\n${passed}/${passed + failed} agency-calendar-onrequest-zero-roomtypes (structural) assertions passed`);
