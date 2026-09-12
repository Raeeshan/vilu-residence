// Multi-Property Availability & Hotel Selection in Quotes -- structural
// pass over source (brace-match real functions, regex-check wiring), same
// technique as the rest of this suite. Behavioral/privacy proof is in
// test/multi-property-availability-rules.test.js (real Firestore emulator
// + the actual Cloud Functions).
//   node test/multi-property-availability.test.js
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
const PORTAL = read('vilu-agency-portal.html');
const RULES = read('firestore.rules');
const FUNCTIONS = read('functions-core/index.js');

// The regex must match all the way up to and including the function
// body's real opening `{` -- for an onCall({...}, async (request) => {
// export, that means the WHOLE options-object prefix has to be part of
// the match (see the getAgencyAvailability/submitAgencyCustomQuote
// regexes below), or this would stop at that options object's own brace
// instead of the real function body.
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
function ruleBlock(src, matchStr) {
  const idx = src.indexOf(matchStr);
  if (idx === -1) throw new Error('rule block not found: ' + matchStr);
  return src.slice(idx, src.indexOf('\n    }', idx));
}
// Every onCall({ region, maxInstances }, async (request) => { ... }) export
// in this codebase shares the exact same options-object prefix -- built via
// string concatenation (never a hand-escaped regex literal) so there is no
// risk of an unescaped ( or { silently changing what the pattern matches.
function onCallStart(name) {
  return new RegExp('exports\\.' + name + ' = onCall\\(\\{ region: \'us-central1\', maxInstances: 10 \\}, async \\(request\\) => \\{');
}

section('Part 1 audit: no invented partner-hotel data anywhere in this feature');
{
  test('the pre-existing PH array (hardcoded "Ranfaru Inn"/"White Sand Inn" demo data) is left completely untouched and is never read by any new function', () => {
    assert.match(PMS, /let PH=\[\s*\n\s*\{id:'ha',nm:'Ranfaru Inn'/, 'PH must still exist unchanged -- drawCal() still renders it');
    const newFns = [
      extractByStart(PMS, /async function drawHtls\(\)\s*\{/),
      extractByStart(PMS, /async function saveAccProp\(\)\s*\{/),
      extractByStart(PMS, /async function saveAccRoomType\(\)\s*\{/),
    ];
    newFns.forEach((src) => assert.doesNotMatch(src, /\bPH\b/, 'must never read the old fake PH array'));
  });
  test('no real-sounding partner hotel name is hardcoded/pre-seeded anywhere in the new admin UI or Cloud Functions', () => {
    const newFns = extractByStart(PMS, /async function drawHtls\(\)\s*\{/) + extractByStart(FUNCTIONS, onCallStart('getAgencyProperties'));
    assert.doesNotMatch(newFns, /Ranfaru|White Sand|Coral Beach/i);
  });
  test('Vilu Residence itself is synthesized (never a stored accommodation_properties doc) -- no seeding/migration code writes a VILU doc anywhere', () => {
    assert.doesNotMatch(FUNCTIONS, /collection\('accommodation_properties'\)\.doc\('VILU'\)\.set/);
    assert.doesNotMatch(PMS, /collection\('accommodation_properties'\)\.doc\('VILU'\)\.set/);
  });
}

section('Part 2/21: new Firestore-backed Partner Accommodation admin UI (Admin/Staff/Manager only)');
{
  test('drawHtls() is gated to admin/staff/manager (accStaffLike()), not admin-only like the page it replaced', () => {
    const src = extractByStart(PMS, /async function drawHtls\(\)\s*\{/);
    assert.match(src, /!accStaffLike\(\)/);
    const gateSrc = extractByStart(PMS, /function accStaffLike\(\)\s*\{/);
    assert.match(gateSrc, /role==='admin'/);
    assert.match(gateSrc, /role==='staff'/);
    assert.match(gateSrc, /role==='manager'/);
  });
  test('saveAccProp()/saveAccRoomType() write to accommodation_properties (and its room_types subcollection), never to the old PH array', () => {
    const propSrc = extractByStart(PMS, /async function saveAccProp\(\)\s*\{/);
    assert.match(propSrc, /collection\('accommodation_properties'\)\.doc\(id\)/);
    assert.match(propSrc, /ref\.set\(doc, \{merge:true\}\)/);
    assert.match(extractByStart(PMS, /async function saveAccRoomType\(\)\s*\{/), /collection\('accommodation_properties'\)\.doc\(propertyId\)\.collection\('room_types'\)\.doc\(id\)\.set\(doc/);
  });
  test('a blank agencyRate is stored as null ("Rate on request"), never coerced to 0 or any guessed number', () => {
    const src = extractByStart(PMS, /async function saveAccRoomType\(\)\s*\{/);
    assert.match(src, /agencyRate: rateRaw!==''.*?\?\s*\+rateRaw\s*:\s*null/);
  });
  test('manual availability (Part 22) writes ONE merged {date: true} map per room type -- not a document per date (never "a second giant PMS")', () => {
    const src = extractByStart(PMS, /async function setAccManualAvailability\(available\)\s*\{/);
    assert.match(src, /collection\('manual_availability'\)\.doc\('data'\)\.set\(upd/);
    assert.doesNotMatch(src, /\.doc\(ds\)\.set/, 'must not create a separate document per date');
  });
}

section('Part 3/25: getAgencyAvailability extended with an optional propertyId, existing Vilu behavior byte-for-byte unchanged');
{
  test('propertyId defaults to VILU; every pre-existing caller (no propertyId argument) is completely unaffected', () => {
    const src = extractByStart(FUNCTIONS, /exports\.getAgencyAvailability = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/);
    assert.match(src, /const propertyId = String\(d\.propertyId \|\| 'VILU'\) \|\| 'VILU';/);
    assert.match(src, /if \(propertyId !== 'VILU'\) \{\s*\n\s*return getPartnerPropertyAvailability/);
  });
  test('the Vilu-only date-range cap (AGENCY_AVAILABILITY_MAX_DAYS) is checked BEFORE the propertyId branch -- a partner property never gets a looser bound', () => {
    const src = extractByStart(FUNCTIONS, /exports\.getAgencyAvailability = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/);
    const capIdx = src.indexOf('AGENCY_AVAILABILITY_MAX_DAYS');
    const branchIdx = src.indexOf("propertyId !== 'VILU'");
    assert.ok(capIdx > -1 && branchIdx > -1 && capIdx < branchIdx);
  });
  test('getPartnerPropertyAvailability() never returns per-guest data -- ownReservations is always {} for a partner property', () => {
    const src = extractByStart(FUNCTIONS, /async function getPartnerPropertyAvailability\(propertyId, startDate, endDate\)\s*\{/);
    assert.match(src, /ownReservations: \{\}/);
  });
  test('ON_REQUEST mode never reads manual_availability at all and always returns state: \'ON_REQUEST\' -- never a fabricated AVAILABLE', () => {
    const src = extractByStart(FUNCTIONS, /async function getPartnerPropertyAvailability\(propertyId, startDate, endDate\)\s*\{/);
    assert.match(src, /if \(mode === 'ON_REQUEST'\) \{ days\.push\(\{ roomTypeId: rt\.roomTypeId, date, state: 'ON_REQUEST' \}\); return; \}/);
  });
}

section('Part 11-14: hotel selection in BOTH quote builders, Vilu default, server-authoritative rate');
{
  test('resolveAccommodationSelection() defaults to Vilu, needing no lookup, and rejects an inactive/hidden partner outright', () => {
    const src = extractByStart(FUNCTIONS, /async function resolveAccommodationSelection\(d\)\s*\{/);
    assert.match(src, /propertyId === 'VILU'/);
    assert.match(src, /isVilu: true/);
    assert.match(src, /propSnap\.data\(\)\.active !== true \|\| propSnap\.data\(\)\.visibleToAgencies !== true/);
  });
  test('submitAgencyCustomQuote() blocks FINALIZING with no configured partner rate, but never blocks a DRAFT -- "Rate on request", never a fake total', () => {
    const src = extractByStart(FUNCTIONS, onCallStart('submitAgencyCustomQuote'));
    assert.match(src, /accommodation\.rate == null && status === 'FINALIZED'/);
  });
  test('accommodationTotal is computed ONLY from the server-verified rate (never a client-supplied number) and added into viluNetTotal', () => {
    const src = extractByStart(FUNCTIONS, onCallStart('submitAgencyCustomQuote'));
    assert.match(src, /accommodation\.rate \* nights/);
    assert.match(src, /componentsNetTotal \+ accommodationTotal/);
  });
  test('both quote builder modals (Assigned Package + Custom Package) render an Accommodation picker section', () => {
    assert.match(PORTAL, /id="quote-acc-picker"/);
    assert.match(PORTAL, /id="cp-acc-picker"/);
  });
  test('openQuoteBuilder()/openCustomPackageBuilder() both call renderAccommodationPicker(), seeded from the loaded quote\'s own snapshot when editing', () => {
    const quoteSrc = extractByStart(PORTAL, /async function openQuoteBuilder\(pid, existingQuoteId\)\s*\{/);
    assert.match(quoteSrc, /renderAccommodationPicker\('quote', updateQuotePreview\)/);
    assert.match(quoteSrc, /_quoteAccommodation = \{/);
    const cpSrc = extractByStart(PORTAL, /async function openCustomPackageBuilder\(existingQuoteId\)\s*\{/);
    assert.match(cpSrc, /renderAccommodationPicker\('cp', updateCustomQuotePreview\)/);
    assert.match(cpSrc, /_cpAccommodation = \{/);
  });
  test('Vilu Residence is the pre-selected default and is visually marked PRIMARY in the picker, never a partner property by default', () => {
    const src = extractByStart(PORTAL, /async function renderAccommodationPicker\(prefix, onChange\)\s*\{/);
    assert.match(src, /var selected = state\.propertyId \|\| 'VILU';/);
    assert.match(src, /PRIMARY/);
  });
  test('submitCustomQuote() only ever sends accommodationPropertyId/accommodationRoomTypeId -- never a rate/name -- to the server', () => {
    const src = extractByStart(PORTAL, /async function submitCustomQuote\(status\)\s*\{/);
    assert.match(src, /accommodationPropertyId: _cpAccommodation\.propertyId/);
    assert.match(src, /accommodationRoomTypeId: _cpAccommodation\.roomTypeId/);
    assert.doesNotMatch(src, /accommodationRate\w*:/);
  });
}

section('Part 14/15: quote snapshot + guest-safe quotation accommodation display');
{
  test('the finalized quote stores a frozen accommodation snapshot (property/room-type name, rate, currency, availability mode) -- server-side, in submitAgencyCustomQuote()', () => {
    const src = extractByStart(FUNCTIONS, onCallStart('submitAgencyCustomQuote'));
    ['accommodationPropertyId', 'accommodationPropertyName', 'accommodationIsVilu', 'accommodationRoomTypeId', 'accommodationRoomTypeName', 'accommodationRateSnapshot', 'accommodationAvailabilityMode'].forEach((f) => {
      assert.match(src, new RegExp(f + ':'));
    });
  });
  test('buildGuestQuotationHTML()\'s structural allowlist includes accommodationPropertyName/accommodationRoomTypeName ONLY -- never rate/availabilityMode/propertyId (Part 15: no internal data to the guest)', () => {
    const src = extractByStart(PORTAL, /function buildGuestQuotationHTML\(quote\)\s*\{/);
    assert.match(src, /accommodationPropertyName: quote\.accommodationIsVilu === false/);
    assert.match(src, /accommodationRoomTypeName: quote\.accommodationIsVilu === false/);
    assert.doesNotMatch(src, /safe\.\w*=.*accommodationRateSnapshot|safe\.\w*=.*accommodationAvailabilityMode/);
  });
  test('the guest-facing Accommodation row falls back to "Vilu Residence Maamigili" for a pre-existing quote with no accommodation fields at all (backward compatible)', () => {
    const src = extractByStart(PORTAL, /function buildGuestQuotationHTML\(quote\)\s*\{/);
    assert.match(src, /Vilu Residence Maamigili/);
  });
}

section('Part 16/17: booking request preserves the accommodation snapshot; partner bookings never touch reservations');
{
  test('sendAgencyBookingRequest() branches to sendAccommodationBookingRequest() for a non-Vilu quote BEFORE requiring a Vilu roomId', () => {
    const src = extractByStart(PORTAL, /async function sendAgencyBookingRequest\(\)\s*\{/);
    const branchIdx = src.indexOf('sendAccommodationBookingRequest');
    const roomIdIdx = src.indexOf("getElementById('bkreq-room')");
    assert.ok(branchIdx > -1 && roomIdIdx > -1 && branchIdx < roomIdIdx, 'the partner branch must return before the Vilu-room-required code runs');
  });
  test('sendAccommodationBookingRequest() writes accommodation_booking_requests, never agency_booking_requests or reservations', () => {
    const src = extractByStart(PORTAL, /async function sendAccommodationBookingRequest\(\)\s*\{/);
    assert.match(src, /collection\('accommodation_booking_requests'\)\.doc\(reqDoc\.id\)\.set\(reqDoc\)/);
    assert.doesNotMatch(src, /collection\('agency_booking_requests'\)|collection\('reservations'\)/);
  });
  test('openBookingRequestModal() hides the Vilu Room selector entirely for a partner-property quote and shows a read-only accommodation summary instead', () => {
    const src = extractByStart(PORTAL, /async function openBookingRequestModal\(quoteId\)\s*\{/);
    assert.match(src, /var isPartnerAccommodation = quote\.accommodationIsVilu === false;/);
    assert.match(src, /getElementById\('bkreq-room-wrap'\)\.style\.display = isPartnerAccommodation \? 'none' : '';/);
  });
  test('confirmAccommodationBookingRequest/rejectAccommodationBookingRequest are staff-like gated (requireStaffLike) -- an agency can never self-confirm a partner booking (Part 17)', () => {
    assert.match(extractByStart(FUNCTIONS, onCallStart('confirmAccommodationBookingRequest')), /requireStaffLike\(role\)/);
    assert.match(extractByStart(FUNCTIONS, onCallStart('rejectAccommodationBookingRequest')), /requireStaffLike\(role\)/);
  });
}

section('Part 19/20: calendar property tabs + collapse/expand, Vilu always first and never collapsible');
{
  test('property tabs are a VISIBLE row, never hidden inside only a dropdown -- Vilu first with a PRIMARY pill, an "All Properties" tab, defaults to "ALL"', () => {
    assert.match(PORTAL, /id="ag-cb-prop-tabs"/);
    assert.doesNotMatch(PORTAL, /id="ag-cb-property-filter"/, 'the old dropdown must be fully removed, not left alongside the new tabs');
    assert.match(PORTAL, /var AG_CAL_PROPERTY_FILTER = 'ALL';/);
    const src = extractByStart(PORTAL, /function agCalRenderPropertyTabs\(allProps\)\{/);
    assert.match(src, /propertyName:'Vilu Residence'/);
    assert.match(src, /PRIMARY<\/span>/);
    assert.match(src, /All Properties<\/button>/);
  });
  test('agDrawCal() always renders the Vilu section before any partner section, and Vilu has no collapse control at all', () => {
    const src = extractByStart(PORTAL, /async function agDrawCal\(\)\s*\{/);
    const viluIdx = src.indexOf("Vilu Residence — Primary Property");
    const partnerIdx = src.indexOf('partnerProps.forEach');
    assert.ok(viluIdx > -1 && partnerIdx > -1 && viluIdx < partnerIdx);
    assert.doesNotMatch(src.slice(0, partnerIdx), /agCalToggleCollapse/, 'Vilu\'s own section must never be collapsible');
  });
  test('partner sections ARE collapsible, and the collapsed preference persists only to localStorage -- never authoritative business data (Part 20)', () => {
    assert.match(PORTAL, /function agCalToggleCollapse\(propertyId\)\{/);
    assert.match(PORTAL, /localStorage\.setItem\('vilu_agency_cal_collapsed'/);
  });
}

section('Part 6/7/8: click-drag pan, past/future navigation, date jump -- all bounded, windowed loading preserved');
{
  test('the date-jump control exists and calls agCalJumpToDate(), which re-anchors agCalD and redraws through the SAME windowed fetch path as Today/Prev/Next (agCalReanchor)', () => {
    assert.match(PORTAL, /id="ag-cb-jump-date"/);
    assert.match(PORTAL, /onclick="agCalJumpToDate\(\)"/);
    const src = extractByStart(PORTAL, /function agCalJumpToDate\(\)\s*\{/);
    assert.match(src, /agCalD = new Date\(v\+'T12:00'\);/);
    assert.match(src, /agCalReanchor\(\);/);
  });
  test('Prev/Next (past AND future navigation) still step by exactly 7 days, now from the currently visible position (agCalVisibleStart) rather than a stale anchor -- required so a real pan/scroll before pressing Next continues from where the user actually is', () => {
    const src = extractByStart(PORTAL, /function agCalNav\(dir\)\{/);
    assert.match(src, /agCalD=agCalVisibleStart\(\);/);
    assert.match(src, /agCalD\.setDate\(agCalD\.getDate\(\)\+dir\*7\)/);
  });
  test('fetchLivePartnerAvailability() caps any single request at 90 days and reuses cached cells the same way fetchLiveAvailability() already does (no unbounded/duplicate requests)', () => {
    const src = extractByStart(PORTAL, /async function fetchLivePartnerAvailability\(propertyId, startDate, endDateExclusive\)\s*\{/);
    assert.match(src, /unionDays<=90/);
    assert.match(src, /if\(cache\.coveredStart!=null && startDate>=cache\.coveredStart && endDateExclusive<=cache\.coveredEnd\) return cache;/);
  });
  test('real click-drag/pan (calendar-fix task) covers the WHOLE scroll area, not just the date header -- background, category rows, and empty cells all pan -- and still skips bars entirely so a bar\'s own click keeps working', () => {
    const src = extractByStart(PORTAL, /async function agDrawCal\(\)\s*\{/);
    assert.match(src, /sa\.onmousedown=function\(e\)\{\s*\n\s*if\(e\.target\.closest\('\.cb-bar'\)\) return;/);
  });
  test('the rolling timeline window (agCalTL) actually grows and fetches new data as the user pans near either edge -- not a fixed-size pre-rendered block (the exact gap this phase was reopened to fix)', () => {
    assert.match(PORTAL, /const AG_CAL_CHUNK=10, AG_CAL_LEAD=10, AG_CAL_TRAIL=10, AG_CAL_MAX_DAYS=90, AG_CAL_EDGE_COLS=4;/);
    const syncSrc = extractByStart(PORTAL, /function agCalTimelineSync\(\)\{/);
    assert.match(syncSrc, /agCalTL\.start=agAddDays\(agCalD,-AG_CAL_LEAD\);/);
    const extendSrc = extractByStart(PORTAL, /async function agCalExtend\(dir\)\{/);
    assert.match(extendSrc, /await agDrawCal\(\);/, 'extending the window must actually re-fetch server data for the newly exposed days, not just re-render already-cached DOM');
  });
}

section('Part 26: existing completed work is untouched');
{
  test('the Vilu-only Availability Calendar rendering path (agCellBucket, ROOMS_LIST rooms) is byte-identical to the prior redesign -- no behavior change for a Vilu-only view', () => {
    assert.match(PORTAL, /function agCellBucket\(roomId, ds\)\{/);
    assert.match(PORTAL, /var ROOMS_LIST = \[/);
  });
  test('the public website\'s own room-card renderer (vilu-website.html) is unchanged -- this task never touches guest-facing room content', () => {
    assert.match(read('vilu-website.html'), /function refreshRoomCards\(\)/);
  });
  test('Agency Settlements / OTA / Beds24 code is never referenced by any new function in this task', () => {
    const newFns = [
      extractByStart(FUNCTIONS, onCallStart('getAgencyProperties')),
      extractByStart(FUNCTIONS, /async function getPartnerPropertyAvailability\(propertyId, startDate, endDate\)\s*\{/),
      extractByStart(FUNCTIONS, onCallStart('confirmAccommodationBookingRequest')),
    ].join('\n');
    assert.doesNotMatch(newFns, /agency_settlements|beds24|cloudbeds|ota_/i);
  });
}

section('Rules: accommodation_properties / accommodation_booking_requests');
{
  test('accommodation_properties: admin/staff/manager write; agency read only active+visibleToAgencies (own-document field-level filtering is impossible in rules, so this is the coarse backstop -- getAgencyProperties()/getAgencyPropertyRoomTypes() are the real, field-filtered path)', () => {
    const block = ruleBlock(RULES, 'match /accommodation_properties/{propertyId}');
    assert.match(block, /resource\.data\.active == true && resource\.data\.visibleToAgencies == true/);
    assert.match(block, /allow write: if isAdmin\(\) \|\| isStaff\(\) \|\| isManagerRole\(\);/);
  });
  test('manual_availability subcollection is admin/staff/manager only, never agency-readable directly', () => {
    const block = ruleBlock(RULES, 'match /manual_availability/{docId}');
    assert.match(block, /allow read, write: if isAdmin\(\) \|\| isStaff\(\) \|\| isManagerRole\(\);/);
  });
  test('accommodation_booking_requests create rule blocks an agency from self-writing a decided status or fabricated confirm/reject fields (same shape as agency_booking_requests\' own create rule)', () => {
    const block = ruleBlock(RULES, 'match /accommodation_booking_requests/{id}');
    assert.match(block, /request\.resource\.data\.status == 'AVAILABILITY_REQUESTED'/);
    assert.match(block, /request\.resource\.data\.get\('confirmedAt', null\) == null/);
    assert.match(block, /request\.resource\.data\.get\('rejectedAt', null\) == null/);
    assert.match(block, /allow delete: if false;/);
  });
}

console.log(`\n${passed}/${passed + failed} multi-property-availability assertions passed`);
if (failed) { console.log('\nFAILED'); process.exit(1); } else { console.log('\nALL TESTS PASSED'); }
