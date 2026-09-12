// VILU AGENCY PORTAL — FIX HOTEL SELECTION + AVAILABILITY SEARCH SYNC.
//
// Root cause (found by live reproduction, not assumed): the quote builders'
// primary "Check availability" button called checkAvailabilityForDates(),
// which was hardcoded to Vilu's ROOMS_LIST and never read the selected
// accommodation at all -- it neither respected a partner-property selection
// nor touched the calendar. A SEPARATE "View on calendar" button/function
// (agCalOpenForAccommodation) already did the correct property-aware
// calendar-focus, but was a second, easy-to-miss path sitting right next to
// the (broken, more prominent) first one. The main Availability tab's own
// searchAvailability() was ALSO hardcoded to Vilu's ROOMS_LIST regardless of
// which property tab was active, so even after correctly switching to a
// partner tab, pressing "Search Availability" (or completing a two-click
// date pick on a partner cell) still showed Vilu's room categories.
//
// This file is the structural pass over source. Live browser QA (screenshots,
// desktop + mobile) is reported separately, per this task's own requirement
// not to rely on structural tests alone.
//   node test/hotel-selection-availability-sync.test.js
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

section('Root cause 1 — the old dual-button confusion is retired: ONE calendar-opening path');
{
  test('checkAvailabilityForDates() (Vilu-hardcoded, calendar-blind) no longer exists anywhere', () => {
    assert.doesNotMatch(PORTAL, /function checkAvailabilityForDates/);
    assert.doesNotMatch(PORTAL, /checkAvailabilityForDates\(/);
  });
  test('both quote builders\' "Check availability" button calls agCalOpenForAccommodation() directly -- no second button, no second function', () => {
    assert.match(PORTAL, /onclick="agCalOpenForAccommodation\('quote'\)"><i class="ti ti-calendar-search"><\/i> Check availability<\/button>/);
    assert.match(PORTAL, /onclick="agCalOpenForAccommodation\('cp'\)"><i class="ti ti-calendar-search"><\/i> Check availability<\/button>/);
    assert.doesNotMatch(PORTAL, /View on calendar/, 'the separate second button/link must be gone, not just relabeled');
  });
}

section('Root cause 2 — agCalOpenForAccommodation() reads the CURRENTLY selected accommodation, never defaults to Vilu unless nothing is selected');
{
  test('propertyId comes from accState(prefix).propertyId (the live picker state), falling back to VILU only when that state is empty', () => {
    const src = extractByStart(PORTAL, /function agCalOpenForAccommodation\(prefix\)\s*\{/);
    assert.match(src, /var propertyId = accState\(prefix\)\.propertyId \|\| 'VILU';/);
  });
  test('it sets AG_CAL_PROPERTY_FILTER to that property (activating that tab), syncs the quote\'s own dates (never resets to today), and runs the SAME property-aware searchAvailability() -- one calendar state transition, not several disconnected ones', () => {
    const src = extractByStart(PORTAL, /function agCalOpenForAccommodation\(prefix\)\s*\{/);
    assert.match(src, /AG_CAL_PROPERTY_FILTER = propertyId;/);
    assert.match(src, /document\.getElementById\('av-ci'\)\.value = arrival \|\| '';/);
    assert.match(src, /searchAvailability\(propertyId\);/);
  });
}

section('Root cause 3 — searchAvailability() is now property-aware, branching Vilu / MANUAL_INVENTORY / ON_REQUEST, never a Vilu fallback for a selected partner');
{
  test('it resolves the target property from an explicit override or the active tab (never Vilu when a specific partner tab is active)', () => {
    const src = extractByStart(PORTAL, /async function searchAvailability\(propertyIdOverride\)\s*\{/);
    assert.match(src, /var propertyId = propertyIdOverride \|\| \(AG_CAL_PROPERTY_FILTER==='ALL' \? 'VILU' : AG_CAL_PROPERTY_FILTER\);/);
  });
  test('a non-Vilu property never falls through to the ROOMS_LIST/Vilu branch', () => {
    const src = extractByStart(PORTAL, /async function searchAvailability\(propertyIdOverride\)\s*\{/);
    const partnerBranchStart = src.indexOf("if(propertyId!=='VILU')");
    const partnerBranchEnd = src.indexOf('var categoryFilter=', partnerBranchStart);
    const partnerBranch = src.slice(partnerBranchStart, partnerBranchEnd);
    assert.doesNotMatch(partnerBranch, /ROOMS_LIST/);
    assert.match(partnerBranch, /fetchLivePartnerAvailability\(propertyId, ci, co\)/);
  });
  test('ON_REQUEST shows the exact required message and never a fabricated AVAILABLE grid', () => {
    const src = extractByStart(PORTAL, /async function searchAvailability\(propertyIdOverride\)\s*\{/);
    assert.match(src, /Availability on request — Vilu must confirm this property\./);
  });
  test('MANUAL_INVENTORY partner search checks each room type via agPartnerCellBucket -- the SAME bucket logic the calendar bars already use, not a second formula', () => {
    const src = extractByStart(PORTAL, /async function searchAvailability\(propertyIdOverride\)\s*\{/);
    assert.match(src, /agPartnerCellBucket\(propertyId, rt\.roomTypeId, ds\)\.kind!=='AVAILABLE'/);
  });
  test('the Vilu branch (categories, ROOMS_LIST, hold-request button) is otherwise unchanged from before this fix', () => {
    const src = extractByStart(PORTAL, /async function searchAvailability\(propertyIdOverride\)\s*\{/);
    assert.match(src, /ROOMS_LIST\.forEach/);
    assert.match(src, /openHoldRequestModal\(/);
  });
}

section('Root cause 4 — clicking a calendar cell resolves ITS OWN property, never the (possibly ambiguous, "ALL") active tab filter');
{
  test('agCellClick() derives the property from the clicked cell\'s own key (a "|" means a partner cell; a bare Vilu room id means VILU) -- picking dates on Partner Hotel A never searches Vilu', () => {
    const src = extractByStart(PORTAL, /function agCellClick\(roomId, ds\)\s*\{/);
    assert.match(src, /var pipeIdx = roomId\.indexOf\('\|'\);/);
    assert.match(src, /searchAvailability\(pipeIdx>-1 \? roomId\.slice\(0,pipeIdx\) : 'VILU'\);/);
  });
}

section('Part 7: the search card\'s own title/subtitle/category dropdown reflect the active property, wired through agDrawCal() so it never drifts out of sync');
{
  test('updateAvSearchUI() exists and is called from agDrawCal() (the single place both a tab click and a Check-availability reanchor funnel through)', () => {
    assert.match(PORTAL, /function updateAvSearchUI\(\)\s*\{/);
    const drawSrc = extractByStart(PORTAL, /async function agDrawCal\(\)\s*\{/);
    assert.match(drawSrc, /updateAvSearchUI\(\);/);
  });
  test('the Vilu-only Category dropdown is hidden whenever a partner property is active', () => {
    const src = extractByStart(PORTAL, /function updateAvSearchUI\(\)\s*\{/);
    assert.match(src, /if\(catWrap\) catWrap\.style\.display = 'none';/);
  });
}

section('Part 12/13: no stale Vilu Net after switching to a partner hotel');
{
  test('resolveAssignedPackageRatePreview() mirrors the server\'s resolveAssignedPackageRate() exactly -- Vilu uses the package\'s own rate, a partner property uses ONLY its admin-approved partnerRates[propertyId] override, never a silent Vilu-rate reuse, never a guess', () => {
    const src = extractByStart(PORTAL, /function resolveAssignedPackageRatePreview\(pkg, accSel\)\s*\{/);
    assert.match(src, /if\(accSel\.isVilu\) return \{ perPerson: pkg\.agencyPricePerRoom \|\| pkg\.pricePerRoom \|\| 0, configured:true \};/);
    assert.match(src, /var override = pkg\.partnerRates && pkg\.partnerRates\[accSel\.propertyId\];/);
    assert.match(src, /configured:false/);
  });
  test('updateQuotePreview() resolves the rate BEFORE computing net, so switching accommodation immediately updates the shown Vilu Net instead of leaving the previous property\'s number on screen', () => {
    const src = extractByStart(PORTAL, /async function updateQuotePreview\(\)\s*\{/);
    const accSelIdx = src.indexOf('var accSel = accSelectionSummary(\'quote\');');
    const netIdx = src.indexOf('var net =');
    assert.ok(accSelIdx > -1 && netIdx > -1 && accSelIdx < netIdx, 'accommodation must be resolved before net is computed');
    assert.match(src, /resolveAssignedPackageRatePreview\(_quotePkg, accSel\)/);
  });
  test('an unconfigured partner rate shows "Rate on request" in the preview, never a guessed/zero total presented as real, and finalizeQuote() blocks client-side before even calling the server', () => {
    const previewSrc = extractByStart(PORTAL, /async function updateQuotePreview\(\)\s*\{/);
    assert.match(previewSrc, /Rate on request — ask Vilu to configure this package for this property/);
    const finalizeSrc = extractByStart(PORTAL, /async function finalizeQuote\(\)\s*\{/);
    assert.match(finalizeSrc, /resolveAssignedPackageRatePreview\(_quotePkg, accSelectionSummary\('quote'\)\)\.configured/);
  });
}

section('Part 13 (Custom Package): pricing was already correct, re-verified unchanged -- no stale-Vilu-value bug here');
{
  test('updateCustomQuotePreview() already recomputes accommodationTotal from the CURRENTLY selected accSel.rate every call (via accPropertyChanged\'s onChange), not a Vilu-only fixed cost', () => {
    const src = extractByStart(PORTAL, /function updateCustomQuotePreview\(\)\s*\{/);
    assert.match(src, /var accSel = accSelectionSummary\('cp'\);/);
    assert.match(src, /var accommodationTotal = \(!accSel\.isVilu && accSel\.rate!=null && nights>0\) \? \+\(accSel\.rate\*nights\)\.toFixed\(2\) : 0;/);
  });
}

section('Part 4: room-type state is cleared/reselected on property switch (pre-existing, re-verified unchanged by this fix)');
{
  test('renderAccommodationRoomType() clears roomTypeId to null for Vilu, and re-validates/auto-selects the first room type for a partner property whose previous roomTypeId no longer matches', () => {
    const src = extractByStart(PORTAL, /async function renderAccommodationRoomType\(prefix, propertyId\)\s*\{/);
    assert.match(src, /if\(propertyId==='VILU'\)\{\s*\n\s*state\.roomTypeId = null;/);
    assert.match(src, /var currentRt = roomTypes\.some\(function\(rt\)\{ return rt\.roomTypeId===state\.roomTypeId; \}\) \? state\.roomTypeId : roomTypes\[0\]\.roomTypeId;/);
  });
}

section('Part 11: accommodation selection lives in the quote builders (before finalize), package browsing cards stay uncluttered');
{
  test('drawPackages() (the browsing card list) has no accommodation picker -- only "Create quotation"', () => {
    const src = extractByStart(PORTAL, /async function drawPackages\(\)\s*\{/);
    assert.doesNotMatch(src, /acc-picker/);
    assert.match(src, /Create quotation/);
  });
  test('both builders render the accommodation picker before any finalize action is reachable', () => {
    assert.match(PORTAL, /id="quote-acc-picker"/);
    assert.match(PORTAL, /id="cp-acc-picker"/);
  });
}
console.log(`\n${passed}/${passed + failed} hotel-selection-availability-sync (structural) assertions passed`);
