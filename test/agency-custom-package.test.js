// Agency Sales Workflow — Phase C: Custom Package Builder + Vilu Rate
// Catalog. 2026-09-11.
//
// Scope reminder: agencies may combine Vilu-APPROVED components (not
// everything in service_catalog -- nothing is agency-visible by default)
// into a custom quote. Component rates must never be trusted from the
// client at save time -- see functions-core/index.js's submitAgencyCustomQuote
// for the actual server-side re-verification, proven behaviorally against
// the Firestore+Functions emulators in test/agency-custom-package-rules.test.js.
// This file is the usual structural/regex pass over source.
//   node test/agency-custom-package.test.js
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

// NOTE: every startRegex used with this helper must end exactly at the
// block's opening '{' (e.g. "...=> {" or "function f(){"). Counting braces
// from the END of the match (not a fresh indexOf('{', m.index)) is what
// makes this safe for a match whose own header text contains other braces,
// like onCall({ region: ..., maxInstances: 10 }, async (request) => { --
// an indexOf-based search would lock onto that options object's brace
// instead of the real function body and close far too early.
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

section('Case A — Vilu Rate Catalog security (Part 1/3/18): nothing agency-visible by default');
{
  test('service_catalog rules gate agency reads on active==true AND visibleToAgencies (\'all\' or a per-agency list) -- no default-visible fallback', () => {
    const block = RULES.slice(RULES.indexOf('match /service_catalog/{itemId}'), RULES.indexOf('match /service_catalog/{itemId}') + 2200);
    assert.match(block, /resource\.data\.active == true/);
    assert.match(block, /resource\.data\.visibleToAgencies == 'all'/);
    assert.match(block, /request\.auth\.token\.email\.lower\(\) in resource\.data\.visibleToAgencies/);
    // Unlike packages/{packageId}, there must be NO get('visibleToAgencies','all') default -- every
    // existing catalog item predates this field, so defaulting to 'all' would expose everything at once.
    assert.doesNotMatch(block, /resource\.data\.get\('visibleToAgencies', ?'all'\)/);
  });
  test('service_catalog write validation accepts the new optional visibleToAgencies field, still admin/manager only', () => {
    const block = extractByStart(RULES, /match \/service_catalog\/\{itemId\} \{/);
    assert.match(block, /allow create, update: if \(isAdmin\(\) \|\| isManagerRole\(\)\)/);
    assert.match(block, /'visibleToAgencies' in request\.resource\.data/);
  });
  test('packages/{packageId}.visibleToAgencies rule is unchanged from before Phase C (Phase C did not touch it -- Accommodation/package base comes from agency_packages instead, see Part 20 audit)', () => {
    assert.match(RULES, /match \/packages\/\{packageId\} \{\s*\n\s*allow read: if isAdmin\(\) \|\| isStaff\(\) \|\| isManagerRole\(\)\s*\n\s*\|\| resource\.data\.get\('visibleToAgencies', 'all'\) == 'all'/);
  });
  test('the Admin catalog editor has a "Visible to agencies" toggle, defaulting unchecked for a new item', () => {
    assert.match(PMS, /id="cim-visible-agencies"/);
    const addSrc = extractByStart(PMS, /function openAddCatalogItem\(\)\s*\{/);
    assert.match(addSrc, /cim-visible-agencies'\)\.checked=false/);
  });
  test('saveCatalogItem() writes visibleToAgencies:\'all\' when checked, and removes the field (FieldValue.delete) when unchecked on an edit -- never a bare false', () => {
    const src = extractByStart(PMS, /async function saveCatalogItem\(\)\s*\{/);
    assert.match(src, /firebase\.firestore\.FieldValue\.delete\(\)/);
    assert.match(src, /doc\.visibleToAgencies='all'/);
  });
}

section('Case B — Rate Catalog / Custom Package Builder UI wiring (Parts 2/4)');
{
  test('a "Rate Catalog" tab exists, wired to drawRateCatalog()', () => {
    assert.match(PORTAL, /onclick="showTab\('ratecatalog',this\)"/);
    assert.match(PORTAL, /id="tab-ratecatalog"/);
    const showTabSrc = extractByStart(PORTAL, /function showTab\(name, el\)\s*\{/);
    assert.match(showTabSrc, /if\(name==='ratecatalog'\) drawRateCatalog\(\);/);
  });
  test('the Rate Catalog is explicitly labeled private/never-guest-facing', () => {
    const tabStart = PORTAL.indexOf('id="tab-ratecatalog"');
    const tabEnd = PORTAL.indexOf('<!-- QUOTATIONS TAB', tabStart);
    const tabHTML = PORTAL.slice(tabStart, tabEnd);
    assert.match(tabHTML, /Private to your agency/);
    assert.match(tabHTML, /must never appear on a guest-facing quotation/);
  });
  test('"Create Custom Package" opens openCustomPackageBuilder(), reachable from both the Rate Catalog and Quotations tabs', () => {
    const matches = PORTAL.match(/onclick="openCustomPackageBuilder\(\)"/g) || [];
    assert.ok(matches.length >= 2, 'expected the Create Custom Package button in at least two places');
  });
  test('loadRateCatalog() sources components from exactly three already-authorized reads: this agency\'s own active packages, visibility-filtered service_catalog, and the public global settings doc -- nothing else', () => {
    const src = extractByStart(PORTAL, /async function loadRateCatalog\(\)\s*\{/);
    assert.match(src, /loadPMS_Packages\(\)\.filter\(function\(p\)\{ return p\.active!==false; \}\)/);
    assert.match(src, /fsDb\.collection\('service_catalog'\)\.where\('visibleToAgencies','=='?,'all'\)\.where\('active','==',true\)\.get\(\)/);
    // Reuses Phase B's existing cached settings loader (which itself reads
    // website_content/agency_booking_settings) rather than duplicating the fetch.
    assert.match(src, /var settings = await loadAgyBookingSettings\(\);/);
  });
}

section('Case C — Component rate integrity (Part 6/19): client never sends a rate, server never trusts one');
{
  test('submitCustomQuote() sends ONLY sourceType/sourceId/quantity per component -- no viluUnitRate, no name, no category', () => {
    const src = extractByStart(PORTAL, /async function submitCustomQuote\(status\)\s*\{/);
    const mapMatch = src.match(/selectedComponents: _customSelectedComponents\.map\(function\(c\)\{ return \{([^}]*)\}; \}\)/);
    assert.ok(mapMatch, 'could not find the selectedComponents payload mapping');
    assert.doesNotMatch(mapMatch[1], /viluUnitRate/);
    assert.doesNotMatch(mapMatch[1], /\bname\b/);
    assert.match(mapMatch[1], /sourceType:c\.sourceType/);
    assert.match(mapMatch[1], /sourceId:c\.sourceId/);
    assert.match(mapMatch[1], /quantity:c\.quantity/);
  });
  test('the save path is exclusively the Cloud Function callable -- no direct fsDb write of a CUSTOM_PACKAGE quote from the portal', () => {
    const src = extractByStart(PORTAL, /async function submitCustomQuote\(status\)\s*\{/);
    assert.match(src, /fsFunctions\.httpsCallable\('submitAgencyCustomQuote'\)/);
    assert.doesNotMatch(src, /fsDb\.collection\('agency_quotes'\)/);
  });
  test('server-side: resolveAgencyQuoteComponent() re-reads the rate from the canonical source for each sourceType, ignoring any rate the client might have sent', () => {
    const src = extractByStart(FUNCTIONS, /async function resolveAgencyQuoteComponent\(entry, agencyEmailLower\)\s*\{/);
    assert.doesNotMatch(src, /entry\.viluUnitRate/);
    assert.doesNotMatch(src, /entry\.name/);
    assert.match(src, /db\.collection\('service_catalog'\)\.doc\(sourceId\)\.get\(\)/);
    assert.match(src, /db\.collection\('agency_packages'\)\.doc\(agencyEmailLower\)\.get\(\)/);
    assert.match(src, /db\.collection\('website_content'\)\.doc\('agency_booking_settings'\)\.get\(\)/);
    assert.match(src, /viluUnitRate: Number\(item\.basePrice\) \|\| 0/);
  });
  test('a catalog item not approved for this agency (visibleToAgencies mismatch) is rejected server-side, not just hidden client-side', () => {
    const src = extractByStart(FUNCTIONS, /async function resolveAgencyQuoteComponent\(entry, agencyEmailLower\)\s*\{/);
    assert.match(src, /const approved = visible === 'all' \|\| \(Array\.isArray\(visible\) && visible\.indexOf\(agencyEmailLower\) !== -1\);/);
    assert.match(src, /if \(!approved\) throw new HttpsError\('permission-denied'/);
  });
  test('an inactive catalog item or Not-assigned package is rejected server-side even if its id is guessed correctly', () => {
    const src = extractByStart(FUNCTIONS, /async function resolveAgencyQuoteComponent\(entry, agencyEmailLower\)\s*\{/);
    assert.match(src, /if \(item\.active === false\) throw new HttpsError\('failed-precondition'/);
    assert.match(src, /if \(pkg\.active === false\) throw new HttpsError\('failed-precondition'/);
  });
  test('an agency_package component can only resolve against the CALLING agency\'s own agency_packages/{email} doc -- never another agency\'s', () => {
    const src = extractByStart(FUNCTIONS, /async function resolveAgencyQuoteComponent\(entry, agencyEmailLower\)\s*\{/);
    assert.match(src, /db\.collection\('agency_packages'\)\.doc\(agencyEmailLower\)\.get\(\)/);
  });
  test('THE critical firestore.rules fix: a CUSTOM_PACKAGE quote can only be created/updated by Admin/Staff/Manager or the (Admin-SDK, rules-bypassing) Cloud Function -- direct agency client writes are restricted to ASSIGNED_PACKAGE only', () => {
    const block = RULES.slice(RULES.indexOf('match /agency_quotes/{quoteId}'), RULES.indexOf('match /agency_quotes/{quoteId}') + 2400);
    assert.match(block, /allow create: if request\.auth != null\s*\n\s*&& request\.resource\.data\.agencyId == request\.auth\.uid\s*\n\s*&& request\.resource\.data\.quoteType == 'ASSIGNED_PACKAGE';/);
    assert.match(block, /&& resource\.data\.status == 'DRAFT'\s*\n\s*&& resource\.data\.quoteType == 'ASSIGNED_PACKAGE'\);/);
  });
  test('the Cloud Function uses the Admin SDK (getFirestore from firebase-admin), which is documented to bypass security rules -- confirming the rule restriction above does not also block the function itself', () => {
    assert.match(FUNCTIONS, /const \{ getFirestore, FieldValue \} = require\('firebase-admin\/firestore'\);/);
    assert.match(FUNCTIONS, /const db = getFirestore\(\);/);
  });
  test('submitAgencyCustomQuote requires role==\'agency\' and re-derives agencyId from request.auth.uid, never from request.data', () => {
    const src = extractByStart(FUNCTIONS, /exports\.submitAgencyCustomQuote = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/);
    assert.match(src, /if \(role !== 'agency'\) throw new HttpsError\('permission-denied'/);
    assert.match(src, /agencyId: request\.auth\.uid,/);
    assert.doesNotMatch(src, /agencyId: d\.agencyId/);
  });
  test('editing an existing quote via the function re-checks ownership AND DRAFT status server-side (mirrors the rules\' own immutability gate, for the path the rules can\'t reach)', () => {
    const src = extractByStart(FUNCTIONS, /exports\.submitAgencyCustomQuote = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/);
    assert.match(src, /if \(existing\.agencyId !== request\.auth\.uid\) throw new HttpsError\('permission-denied', 'Not your quotation\.'\);/);
    assert.match(src, /if \(existing\.status !== 'DRAFT'\) throw new HttpsError\('failed-precondition'/);
  });
}

section('Case D — Vilu net total / agencyEarnings / paymentCollector (Parts 7/8/9/10)');
{
  test('viluNetTotal is the sum of resolved (server-verified) line totals, never a client-supplied number', () => {
    const src = extractByStart(FUNCTIONS, /exports\.submitAgencyCustomQuote = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/);
    assert.match(src, /const viluNetTotal = \+componentsWithTotals\.reduce\(\(sum, c\) => sum \+ c\.viluLineTotal, 0\)\.toFixed\(2\);/);
    assert.doesNotMatch(src, /viluNetTotal = d\.viluNetTotal/);
  });
  test('agencyEarnings = agencyGuestSellingTotal - viluNetTotal, computed server-side, never labeled "commission"', () => {
    const src = extractByStart(FUNCTIONS, /exports\.submitAgencyCustomQuote = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/);
    assert.match(src, /const agencyEarnings = \+\(agencyGuestSellingTotal - viluNetTotal\)\.toFixed\(2\);/);
    assert.doesNotMatch(FUNCTIONS.slice(FUNCTIONS.indexOf('submitAgencyCustomQuote'), FUNCTIONS.indexOf('submitAgencyCustomQuote')+9000), /commission/i);
  });
  test('the portal UI labels the private helper "Estimated Agency Earnings", not Commission', () => {
    assert.match(PORTAL, /Estimated Agency Earnings/);
    const modalStart = PORTAL.indexOf('id="m-custom-quote"');
    const modalEnd = PORTAL.indexOf('<!-- Margin Ledger modal removed', modalStart);
    assert.doesNotMatch(PORTAL.slice(modalStart, modalEnd), />Commission</);
  });
  test('paymentCollector is validated server-side to one of HOTEL/AGENCY/UNDECIDED, defaulting to UNDECIDED', () => {
    const src = extractByStart(FUNCTIONS, /exports\.submitAgencyCustomQuote = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/);
    assert.match(src, /AGENCY_QUOTE_PAYMENT_COLLECTORS\.includes\(d\.paymentCollector\) \? d\.paymentCollector : 'UNDECIDED'/);
    assert.match(FUNCTIONS, /const AGENCY_QUOTE_PAYMENT_COLLECTORS = \['HOTEL', 'AGENCY', 'UNDECIDED'\];/);
  });
  test('paymentCollector is stored on the quote but never sent to the guest-facing renderer\'s allowlist (Part 10)', () => {
    const buildSrc = extractByStart(PORTAL, /function buildGuestQuotationHTML\(quote\)\s*\{/);
    assert.doesNotMatch(buildSrc, /paymentCollector/);
  });
}

section('Case E — Custom Package quote type + guest print reuse (Parts 12/13/24/25)');
{
  test('quoteType: CUSTOM_PACKAGE is set server-side (assigned-package quotes remain ASSIGNED_PACKAGE, set client-side in Phase B, untouched)', () => {
    assert.match(FUNCTIONS, /quoteType: 'CUSTOM_PACKAGE',/);
    assert.match(PORTAL, /quoteType: 'ASSIGNED_PACKAGE',/);
  });
  test('the guest-facing snapshot stores component NAME ONLY (sanitized), never quantity/rate/lineTotal -- both server-side (save) and client-side (live preview)', () => {
    const serverSrc = extractByStart(FUNCTIONS, /exports\.submitAgencyCustomQuote = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/);
    assert.match(serverSrc, /const label = sanitizeGuestLabel\(c\.name\);/);
    assert.doesNotMatch(serverSrc.slice(serverSrc.indexOf('guestIncludes = []')), /guestIncludes\.push\(c\)/);
    const previewSrc = extractByStart(PORTAL, /function updateCustomQuotePreview\(\)\s*\{/);
    assert.match(previewSrc, /var label = sanitizeGuestLabel\(c\.name\);/);
  });
  test('Trips & Activities components go to guestActivities, everything else to guestIncludes -- same split convention as Phase B assigned-package quotes', () => {
    const serverSrc = extractByStart(FUNCTIONS, /exports\.submitAgencyCustomQuote = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/);
    assert.match(serverSrc, /if \(c\.category === 'TRIPS_ACTIVITIES'\) guestActivities\.push\(label\); else guestIncludes\.push\(label\);/);
  });
  test('no second/divergent guest-document renderer was created -- Custom Package reuses buildGuestQuotationHTML() from Phase B, unchanged', () => {
    const matches = PORTAL.match(/function buildGuestQuotationHTML\(quote\)/g) || [];
    assert.equal(matches.length, 1, 'expected exactly one buildGuestQuotationHTML definition');
    assert.match(PORTAL, /var frame = document\.getElementById\('cp-preview-frame'\);\s*\n\s*if\(frame\) frame\.srcdoc = buildGuestQuotationHTML\(previewQuote\);/);
    const printSrc = extractByStart(PORTAL, /async function printQuotation\(quoteId\)\s*\{/);
    assert.match(printSrc, /_customQuoteWorking && _customQuoteWorking\.quoteId===quoteId/);
  });
  test('the Quotations list visibly distinguishes Assigned Package vs. Custom Package, in the same list (Part 24: no separate competing quote system)', () => {
    const src = extractByStart(PORTAL, /function renderQuoteCard\(q\)\s*\{/);
    assert.match(src, /Custom Package/);
    assert.match(src, /Assigned Package/);
    assert.match(src, /q\.quoteType === 'CUSTOM_PACKAGE'/);
  });
  test('editing a draft routes to the correct builder by quoteType (custom -> openCustomPackageBuilder, assigned -> openQuoteBuilder)', () => {
    const src = extractByStart(PORTAL, /function renderQuoteCard\(q\)\s*\{/);
    assert.match(src, /openCustomPackageBuilder\('"\+qid\+"'\)/);
    assert.match(src, /openQuoteBuilder\('"\+pid\+"','"\+qid\+"'\)/);
  });
}

section('Case F — guest description/message sanitized against injection (Part 15)');
{
  test('guestDescription/guestMessage are length-capped server-side and rendered through esc() (HTML-entity escaping) in the print renderer -- a <script> tag can never execute in the printed document', () => {
    const serverSrc = extractByStart(FUNCTIONS, /exports\.submitAgencyCustomQuote = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/);
    assert.match(serverSrc, /String\(d\.guestDescription \|\| ''\)\.slice\(0, 500\)/);
    assert.match(serverSrc, /String\(d\.guestMessage \|\| ''\)\.slice\(0, 500\)/);
    const buildSrc = extractByStart(PORTAL, /function buildGuestQuotationHTML\(quote\)\s*\{/);
    assert.match(buildSrc, /esc\(safe\.guestMessage\)/);
  });
}

section('Case G — NO inventory effect (Part 26) -- structurally verified across every Phase C function');
{
  const phaseCFns = [
    extractByStart(PORTAL, /async function loadRateCatalog\(\)\s*\{/),
    extractByStart(PORTAL, /async function drawRateCatalog\(\)\s*\{/),
    extractByStart(PORTAL, /async function openCustomPackageBuilder\(existingQuoteId\)\s*\{/),
    extractByStart(PORTAL, /function addSelectedComponent\(\)\s*\{/),
    extractByStart(PORTAL, /async function submitCustomQuote\(status\)\s*\{/),
    extractByStart(FUNCTIONS, /exports\.submitAgencyCustomQuote = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/),
  ];
  test('none of the Phase C functions (client or server) ever touch reservations, block_requests, blocks, or room_availability', () => {
    phaseCFns.forEach(src => {
      assert.doesNotMatch(src, /collection\('reservations'\)/);
      assert.doesNotMatch(src, /collection\('block_requests'\)/);
      assert.doesNotMatch(src, /collection\('blocks'\)/);
      assert.doesNotMatch(src, /collection\('room_availability'\)/);
    });
  });
  test('the Cloud Function writes ONLY to agency_quotes/{quoteId}, and only reads service_catalog/agency_packages/website_content/users', () => {
    const src = extractByStart(FUNCTIONS, /exports\.submitAgencyCustomQuote = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/) + extractByStart(FUNCTIONS, /async function resolveAgencyQuoteComponent\(entry, agencyEmailLower\)\s*\{/);
    const writeMatches = src.match(/db\.collection\('[a-z_]+'\)\.doc\([^)]*\)\.set\(/g) || [];
    writeMatches.forEach(m => assert.match(m, /agency_quotes/));
  });
}

section('Case H — Phase B (assigned-package) is completely unaffected by Phase C');
{
  test('openQuoteBuilder()/saveQuoteDraft()/finalizeQuote() are byte-identical to Phase B -- still direct fsDb writes, no callable involved', () => {
    const saveSrc = extractByStart(PORTAL, /async function saveQuoteDraft\(\)\s*\{/);
    assert.match(saveSrc, /fsDb\.collection\('agency_quotes'\)\.doc\(_quoteWorking\.quoteId\)\.set\(_quoteWorking\)/);
    assert.doesNotMatch(saveSrc, /fsFunctions/);
  });
  test('calcQuoteViluNet()/sanitizeGuestLabel()/buildGuestQuotationHTML() (Phase B) are unchanged and still used by the assigned-package flow', () => {
    assert.match(PORTAL, /function calcQuoteViluNet\(pkg, adults, children, childDiscountPct, arrivalDate, departureDate, agyBookingSettings\)\s*\{/);
  });
  test('agency_quotes rules still permit an ASSIGNED_PACKAGE quote to be directly created/updated by its owning agency, exactly as Phase A/B established', () => {
    const block = RULES.slice(RULES.indexOf('match /agency_quotes/{quoteId}'), RULES.indexOf('match /agency_quotes/{quoteId}') + 2400);
    assert.match(block, /request\.resource\.data\.quoteType == 'ASSIGNED_PACKAGE'/);
  });
}

section('Case I — DO-NOT-TOUCH list preserved (Website Packages, block_requests, blocks, availability, reservations, tax settings, document vault)');
{
  test('block_requests / blocks rules unchanged as of this phase (Phase E later extended block_requests\' create rule -- see agency-hold-requests.test.js)', () => {
    assert.match(RULES, /match \/block_requests\/\{id\} \{[\s\S]*?request\.resource\.data\.agencyId == request\.auth\.uid/);
    assert.match(RULES, /match \/blocks\/\{id\} \{\s*\n\s*allow read: if true;\s*\n\s*allow write: if isAdmin\(\) \|\| isStaff\(\) \|\| isManagerRole\(\);\s*\n\s*\}/);
  });
  test('reservations create rule unchanged as of this phase (Phase F later removed the direct agency-create branch entirely -- see agency-booking-requests-rules.test.js)', () => {
    const resBlock = RULES.slice(RULES.indexOf('match /reservations/{id} {'), RULES.indexOf('match /reservation_price_adjustments/'));
    assert.match(resBlock, /request\.auth == null && request\.resource\.data\.source == 'Website'/);
  });
  test('tax_currency_settings / reservation_documents rules untouched', () => {
    assert.match(RULES, /match \/tax_currency_settings\/\{docId\} \{\s*\n\s*allow read: if isAdmin\(\) \|\| isStaff\(\) \|\| isManagerRole\(\);/);
  });
  test('the Website tab\'s own card renderer in vilu-unified.html is unchanged', () => {
    const src = extractByStart(PMS, /function renderPkgList\(\)\s*\{/);
    assert.match(src, /WEBSITE PACKAGES — redesigned compact cards/);
  });
  test('no Phase C code references Beds24/Cloudbeds/OTA collections', () => {
    ['loadRateCatalog','drawRateCatalog','submitCustomQuote'].forEach(fnName => {
      const re = new RegExp('(?:async )?function ' + fnName + '\\(');
      const src = extractByStart(PORTAL, re);
      assert.doesNotMatch(src, /ota_|beds24|cloudbeds/i);
    });
  });
}

console.log(`\n${passed}/${passed + failed} agency-custom-package (structural) assertions passed`);
