// VILU AGENCY PORTAL — REAL PARTNER HOTEL SETUP + REMAINING MULTI-PROPERTY
// BUSINESS GAPS (follow-up to the calendar-fix task). Structural pass over
// source (brace-match real functions, regex-check wiring) -- behavioral
// proof against a real Firestore emulator is in
// test/assigned-package-partner-pricing-rules.test.js.
//   node test/assigned-package-partner-pricing.test.js
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
function onCallStart(name) {
  return new RegExp('exports\\.' + name + ' = onCall\\(\\{ region: \'us-central1\', maxInstances: 10 \\}, async \\(request\\) => \\{');
}

section('Part 5/6: assigned-package partner pricing is server-authoritative, never a guessed/reused number');
{
  test('resolveAssignedPackageRate() never reuses the Vilu rate for a partner property -- only an explicit pkg.partnerRates[propertyId] override, else "Rate on request" (configured:false)', () => {
    const src = extractByStart(FUNCTIONS, /function resolveAssignedPackageRate\(pkg, accommodation\)\s*\{/);
    assert.match(src, /if \(accommodation\.isVilu\)/);
    assert.match(src, /pkg\.partnerRates && pkg\.partnerRates\[accommodation\.propertyId\]/);
    assert.match(src, /configured: false/);
    const viluBranchEnd = src.indexOf('}', src.indexOf('if (accommodation.isVilu)')) + 1;
    const partnerBranch = src.slice(viluBranchEnd);
    assert.doesNotMatch(partnerBranch, /pkg\.agencyPricePerRoom/, 'the partner branch must never fall through to the Vilu rate -- only pkg.partnerRates[...] (read as `override`)');
  });
  test('calcAssignedPackageViluNet() is the SAME per-person/extra-nights formula as the client\'s calcQuoteViluNet() -- not a second, possibly-diverging formula', () => {
    const server = extractByStart(FUNCTIONS, /function calcAssignedPackageViluNet\(basePerPerson, childDiscountPct, baseNights, adults, children, arrivalDate, departureDate, extraNightRate\)\s*\{/);
    const client = extractByStart(PORTAL, /function calcQuoteViluNet\(pkg, adults, children, childDiscountPct, arrivalDate, departureDate, agyBookingSettings\)\s*\{/);
    assert.match(server, /basePerPerson \* \(1 - \(childDiscountPct \|\| 0\) \/ 100\)/);
    assert.match(client, /basePerPerson \* \(1 - \(childDiscountPct\|\|0\)\/100\)/);
    assert.match(server, /Math\.max\(0, totalNights - \(baseNights \|\| 0\)\)/);
    assert.match(client, /Math\.max\(0, totalNights - baseNights\)/);
  });
  test('finalizeAgencyAssignedPackageQuote exists, is agency-only, and never trusts the quote doc\'s own accommodation/package fields for pricing -- re-reads agency_packages and re-resolves accommodation server-side', () => {
    const src = extractByStart(FUNCTIONS, onCallStart('finalizeAgencyAssignedPackageQuote'));
    assert.match(src, /if \(role !== 'agency'\)/);
    assert.match(src, /quote\.agencyId !== request\.auth\.uid/);
    assert.match(src, /quote\.quoteType !== 'ASSIGNED_PACKAGE'/);
    assert.match(src, /quote\.status !== 'DRAFT'/);
    assert.match(src, /db\.collection\('agency_packages'\)\.doc\(agencyEmailLower\)\.get\(\)/);
    assert.match(src, /resolveAccommodationSelection\(\{/);
    assert.match(src, /resolveAssignedPackageRate\(pkg, accommodation\)/);
    assert.match(src, /if \(!rate\.configured\)/, 'must block finalizing with no configured rate, never a guessed number');
    assert.match(src, /calcAssignedPackageViluNet\(/);
  });
  test('a Vilu-only quote finalized through this function comes out byte-identical to the existing client formula -- reuses the package\'s own agencyPricePerRoom, no partner lookup involved', () => {
    const rateSrc = extractByStart(FUNCTIONS, /function resolveAssignedPackageRate\(pkg, accommodation\)\s*\{/);
    assert.match(rateSrc, /return \{ perPerson: Number\(pkg\.agencyPricePerRoom \|\| pkg\.pricePerRoom\) \|\| 0, currency: 'USD', configured: true \};/);
  });
  test('the finalized quote snapshots the accommodation exactly like Custom Package quotes do (Part 14) -- accommodationRateSnapshot is the resolved per-person rate, never the client\'s own number', () => {
    const src = extractByStart(FUNCTIONS, onCallStart('finalizeAgencyAssignedPackageQuote'));
    assert.match(src, /accommodationRateSnapshot: rate\.perPerson/);
    assert.match(src, /accommodationPropertyId: accommodation\.propertyId/);
  });
}

section('Part 5: firestore.rules refuses a direct-client finalize with a non-Vilu accommodation, forcing the server path -- Vilu-only finalize is completely unaffected');
{
  test('the agency_quotes update rule now requires accommodationPropertyId to be missing/VILU whenever the client writes status:FINALIZED', () => {
    const block = ruleBlock(RULES, 'match /agency_quotes/{quoteId}');
    assert.match(block, /request\.resource\.data\.status != 'FINALIZED'\s*\n\s*\|\| !\('accommodationPropertyId' in request\.resource\.data\)\s*\n\s*\|\| request\.resource\.data\.accommodationPropertyId == 'VILU'/);
  });
  test('Admin/Staff/Manager can still update ANY assigned-package quote unconditionally (unchanged) -- the new restriction only narrows the AGENCY\'s own direct-write branch', () => {
    const block = ruleBlock(RULES, 'match /agency_quotes/{quoteId}');
    assert.match(block, /allow update: if isAdmin\(\) \|\| isStaff\(\) \|\| isManagerRole\(\)\s*\n\s*\|\| \(request\.auth != null/);
  });
}

section('Part 5: the Agency Portal client branches to the new Cloud Function only for a partner-property finalize -- Vilu finalize keeps its original direct write');
{
  test('finalizeQuote() calls finalizeAgencyAssignedPackageQuote() when accommodationPropertyId is set and not VILU', () => {
    const src = extractByStart(PORTAL, /async function finalizeQuote\(\)\s*\{/);
    assert.match(src, /if\(_quoteWorking\.accommodationPropertyId && _quoteWorking\.accommodationPropertyId !== 'VILU'\)\{/);
    assert.match(src, /fsFunctions\.httpsCallable\('finalizeAgencyAssignedPackageQuote'\)\(\{ quoteId: _quoteWorking\.quoteId \}\)/);
  });
  test('the Vilu-only branch of finalizeQuote() is unchanged -- still a direct fsDb write, reached only after the partner branch returns', () => {
    const src = extractByStart(PORTAL, /async function finalizeQuote\(\)\s*\{/);
    const partnerIdx = src.indexOf('finalizeAgencyAssignedPackageQuote');
    const directWriteIdx = src.indexOf("fsDb.collection('agency_quotes').doc(_quoteWorking.quoteId).set(_quoteWorking)");
    assert.ok(partnerIdx > -1 && directWriteIdx > -1 && partnerIdx < directWriteIdx);
  });
  test('saveQuoteDraft() is completely untouched -- still the only path for DRAFT saves, no callable involved regardless of accommodation', () => {
    const src = extractByStart(PORTAL, /async function saveQuoteDraft\(\)\s*\{/);
    assert.doesNotMatch(src, /fsFunctions/);
  });
}

section('Part 6: Admin/Manager can configure an approved partner-property rate per package, without editing Firestore by hand');
{
  test('the per-agency package editor has a "Partner property rates" section rendered from the REAL accommodation_properties catalog (loadAccProperties), never PH', () => {
    assert.match(PMS, /id="agy-pkg-partner-rates"/);
    const src = extractByStart(PMS, /async function renderAgencyPkgPartnerRates\(pkg\)\s*\{/);
    assert.match(src, /await loadAccProperties\(\);/);
    assert.doesNotMatch(src, /\bPH\b/);
  });
  test('a blank partner rate is never coerced to 0 or the Vilu rate -- collectAgencyPkgPartnerRates() only writes a property whose input is a real number', () => {
    const src = extractByStart(PMS, /function collectAgencyPkgPartnerRates\(\)\s*\{/);
    assert.match(src, /if\(raw==='' \|\| isNaN\(\+raw\)\) return;/);
  });
  test('saveAgencyPkgForm() persists partnerRates onto the SAME agency_packages/{email}.packages[] doc the Vilu rate already lives on -- no new collection, no new write path', () => {
    const src = extractByStart(PMS, /async function saveAgencyPkgForm\(\)\s*\{/);
    assert.match(src, /partnerRates: collectAgencyPkgPartnerRates\(\),/);
    assert.match(src, /fsDb\.collection\('agency_packages'\)\.doc\(_agyPkgEmail\)\.set\(\{ email: _agyPkgEmail, packages: _agyPkgWorking \}, \{ merge: true \}\)/);
  });
}

section('Part 4: manual availability now has a read-only "currently blocked" view -- not write-only anymore');
{
  test('openAccManualAvailability() loads and renders the CURRENT blockedDates map before the staff member changes anything', () => {
    const src = extractByStart(PMS, /function openAccManualAvailability\(propertyId, roomTypeId, roomTypeName\)\s*\{/);
    assert.match(src, /renderAccManualAvailabilityCurrent\(propertyId, roomTypeId\);/);
    const renderSrc = extractByStart(PMS, /async function renderAccManualAvailabilityCurrent\(propertyId, roomTypeId\)\s*\{/);
    assert.match(renderSrc, /\.collection\('manual_availability'\)\.doc\('data'\)\.get\(\);/);
  });
  test('consecutive blocked dates are merged into ranges for a compact display, not one line per date', () => {
    const src = extractByStart(PMS, /async function renderAccManualAvailabilityCurrent\(propertyId, roomTypeId\)\s*\{/);
    assert.match(src, /ranges\.push\(\{start:ds, end:ds\}\)/);
  });
  test('the modal now stays open and refreshes after a save, instead of closing blind -- a practical multi-range staff workflow', () => {
    const src = extractByStart(PMS, /async function setAccManualAvailability\(available\)\s*\{/);
    assert.doesNotMatch(src, /document\.getElementById\('m-ahavail'\)\.classList\.remove\('on'\)/, 'must no longer force-close the modal on every save');
    assert.match(src, /renderAccManualAvailabilityCurrent\(propertyId, roomTypeId\);/);
  });
}

section('Part 8: quote accommodation picker shows a live Available/Unavailable/On Request status for a partner property, never exposing internal rate data beyond the existing Rate on request label');
{
  test('accCheckAvailabilityStatus() reuses the existing getAgencyAvailability() data source -- no new endpoint, no second lookup path', () => {
    const src = extractByStart(PORTAL, /async function accCheckAvailabilityStatus\(prefix\)\s*\{/);
    assert.match(src, /fsFunctions\.httpsCallable\('getAgencyAvailability'\)\(\{ propertyId: state\.propertyId, startDate: arrival, endDate: departure \}\)/);
    assert.match(src, /On Request — Vilu must confirm/);
    assert.match(src, /Available for these dates/);
    assert.match(src, /Not available for these dates/);
  });
  test('it is wired into both quote builders\' live preview refresh (updateQuotePreview/updateCustomQuotePreview), so it re-checks whenever dates or the accommodation selection change', () => {
    const quoteSrc = extractByStart(PORTAL, /async function updateQuotePreview\(\)\s*\{/);
    assert.match(quoteSrc, /accCheckAvailabilityStatus\('quote'\);/);
    const cpSrc = extractByStart(PORTAL, /function updateCustomQuotePreview\(\)\s*\{/);
    assert.match(cpSrc, /accCheckAvailabilityStatus\('cp'\);/);
  });
  test('Vilu itself is skipped entirely (it already has its own separate Check-availability button) -- never a redundant second check', () => {
    const src = extractByStart(PORTAL, /async function accCheckAvailabilityStatus\(prefix\)\s*\{/);
    assert.match(src, /if\(!state\.propertyId \|\| state\.propertyId==='VILU' \|\| !state\.roomTypeId\)\{ el\.innerHTML=''; return; \}/);
  });
}

section('Part 10: the legacy PH-based fictional partner-hotel system is retired from every REACHABLE staff-facing surface');
{
  test('New Booking no longer offers "Ranfaru Inn"/"White Sand Inn" as a property choice -- Vilu Residence is the only option, staff can no longer create a real reservation against a fake property', () => {
    const src = extractByStart(PMS, /async function initNB\(\)\s*\{/);
    assert.match(src, /ps\.innerHTML='<option value="vilu">Vilu Residence \(own rooms\)<\/option>';/);
    assert.doesNotMatch(src, /PH\.map/, 'PH must no longer be offered as a property option');
  });
  test('the real PMS Calendar no longer draws PH\'s decorative partner-hotel section rows -- drawCal() has zero PH.forEach() calls left', () => {
    const src = extractByStart(PMS, /function drawCal\(\)\s*\{/);
    assert.doesNotMatch(src, /PH\.forEach/);
  });
  test('getR()/getHR()/rNm()/phNm()/phBx() are still intact -- so any reservation that already references a PH room (if one exists) still renders correctly wherever it is looked up; only CREATING/DISPLAYING new fake-hotel content was removed', () => {
    assert.match(PMS, /function getHR\(\)\{/);
    assert.match(PMS, /function getR\(n\)\{return \[\.\.\.VR,\.\.\.getHR\(\)\]\.find\(r=>r\.n===n\);\}/);
    assert.match(PMS, /function phNm\(p\)\{/);
    assert.match(PMS, /function phBx\(p\)\{/);
  });
}
console.log(`\n${passed}/${passed + failed} assigned-package-partner-pricing (structural) assertions passed`);
