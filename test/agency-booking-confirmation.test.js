// Agency Sales Workflow — Phase G: printable guest-safe Booking
// Confirmation. Structural assertions against the actual source files (not
// the real Firestore emulator -- see agency-booking-confirmation-rules.test.js
// for that), same extractByStart()/regex convention established in Phases C-F.
const fs = require('fs');
const assert = require('node:assert/strict');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); }
}

const PORTAL = fs.readFileSync('vilu-agency-portal.html', 'utf8');
const FUNCS = fs.readFileSync('functions-core/index.js', 'utf8');
const RULES = fs.readFileSync('firestore.rules', 'utf8');

function extractByStart(src, startRegex) {
  const m = startRegex.exec(src);
  assert.ok(m, 'pattern not found: ' + startRegex);
  const start = m.index + m[0].length;
  let depth = 1, i = start;
  while (depth > 0 && i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return src.slice(m.index, i);
}

section('Case A — Part 1: source of truth requires CONFIRMED + a valid reservationId, from frozen snapshots only');
{
  test('getAgencyBookingConfirmationData() requires status CONFIRMED and a reservationId before returning anything', () => {
    const fn = extractByStart(FUNCS, /exports\.getAgencyBookingConfirmationData = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /if \(bReq\.status !== 'CONFIRMED' \|\| !bReq\.reservationId\)/);
  });
  test('the payload is built from the booking request snapshot (itself a finalized-quote snapshot), not from live package/catalog reads', () => {
    const fn = extractByStart(FUNCS, /exports\.getAgencyBookingConfirmationData = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.doesNotMatch(fn, /service_catalog|agency_packages\b/);
  });
  test('Part 19: the live canonical reservation status is re-checked, not just the booking request\'s own (possibly stale) CONFIRMED flag', () => {
    const fn = extractByStart(FUNCS, /exports\.getAgencyBookingConfirmationData = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /db\.collection\('reservations'\)\.doc\(bReq\.reservationId\)\.get\(\)/);
    assert.match(fn, /if \(res\.status !== 'Confirmed'\)/);
  });
}

section('Case B — Part 2: entry point only for CONFIRMED, never PENDING/CHANGE_REQUESTED/REJECTED');
{
  test('Preview/Print buttons are nested inside the CONFIRMED branch of the booking-request row renderer, not a general branch', () => {
    const fn = extractByStart(PORTAL, /async function drawMyBookingRequests\(\)\s*\{/);
    const confirmedBranch = fn.slice(fn.indexOf("status==='CONFIRMED' ? ("), fn.indexOf("status==='REJECTED'"));
    assert.match(confirmedBranch, /openAgencyBookingConfirmation/);
  });
  test('no Preview/Print button exists in the PENDING/CHANGE_REQUESTED/REJECTED render branches', () => {
    const fn = extractByStart(PORTAL, /async function drawMyBookingRequests\(\)\s*\{/);
    const rejectedBranch = fn.slice(fn.indexOf("status==='REJECTED'"), fn.indexOf("status==='CHANGE_REQUESTED'"));
    const changeBranch = fn.slice(fn.indexOf("status==='CHANGE_REQUESTED'"));
    assert.doesNotMatch(rejectedBranch, /openAgencyBookingConfirmation/);
    assert.doesNotMatch(changeBranch, /openAgencyBookingConfirmation/);
  });
}

section('Case C — Part 3: confirmation content sections');
{
  test('the renderer includes booking reference, guest, dates, nights, guests, accommodation, package, inclusions, activities, agreed total, and status', () => {
    const fn = extractByStart(PORTAL, /function buildAgencyBookingConfirmationHTML\(safe\)\s*\{/);
    ['Booking Reference', 'Guest', 'Travel dates', 'Nights', 'Guests', 'Accommodation', 'Package', 'Inclusions', 'Activities', 'Agreed total package price', 'BOOKING STATUS: CONFIRMED'].forEach((label) => {
      assert.match(fn, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'missing: ' + label);
    });
  });
  test('Vilu Residence / Maamigili / South Ari Atoll / Maldives is shown as stable, hardcoded property identity text', () => {
    const fn = extractByStart(PORTAL, /function buildAgencyBookingConfirmationHTML\(safe\)\s*\{/);
    assert.match(fn, /Vilu Residence &middot; Maamigili, South Ari Atoll, Maldives/);
  });
  test('inclusions and activities render as two SEPARATE sections (not merged into one list, unlike the quote template)', () => {
    const fn = extractByStart(PORTAL, /function buildAgencyBookingConfirmationHTML\(safe\)\s*\{/);
    assert.match(fn, /includesHtml = \(safe\.guestIncludes/);
    assert.match(fn, /activitiesHtml = \(safe\.guestActivities/);
  });
}

section('Case D — Part 4: strict price privacy -- forbidden fields never enter the renderer');
{
  test('the renderer function only destructures/reads fields from its own "safe" parameter, never a wider reservation/request object', () => {
    const fn = extractByStart(PORTAL, /function buildAgencyBookingConfirmationHTML\(safe\)\s*\{/);
    // Checked as property-access on safe.* (or a bare identifier), not a
    // bare word match -- "margin"/"commission" as plain English words would
    // otherwise false-positive against the renderer's own legitimate CSS
    // (margin:0, margin-bottom, etc).
    ['viluNetTotal', 'agencyEarnings', 'paymentCollector', 'commission', 'agencyPricePerRoom', 'roomInternalRate'].forEach((forbidden) => {
      assert.doesNotMatch(fn, new RegExp('safe\\.' + forbidden + '\\b|\\b' + forbidden + '\\s*[:=]', 'i'), 'renderer must never reference: ' + forbidden);
    });
    assert.doesNotMatch(fn, /safe\.margin\b/i, 'renderer must never reference: safe.margin');
  });
  test('openAgencyBookingConfirmation() passes the callable\'s result straight into the renderer -- it never merges in the local _myBookingRequests row (which does carry viluNetTotal/paymentCollector for the admin-style list)', () => {
    const fn = extractByStart(PORTAL, /async function openAgencyBookingConfirmation\(requestId\)\s*\{/);
    assert.match(fn, /buildAgencyBookingConfirmationHTML\(result\.data\)/);
    assert.doesNotMatch(fn, /_myBookingRequests/);
  });
}

section('Case E — Part 5: explicit allowlist, not the whole object serialized');
{
  test('agencyBookingConfirmationPayload() builds an explicit field-by-field object literal, matching the task\'s own safe-object example', () => {
    const fn = extractByStart(FUNCS, /function agencyBookingConfirmationPayload\(bReq, reservationId\)\s*\{/);
    ['bookingReference', 'quoteReference', 'guestName', 'arrivalDate', 'departureDate', 'nights', 'adults', 'children',
      'roomCategory', 'packageName', 'guestIncludes', 'guestActivities', 'guestMessage', 'currency', 'agencyGuestSellingTotal', 'agencyName', 'agencyEmail',
    ].forEach((field) => assert.match(fn, new RegExp(field + '\\s*:'), 'missing field: ' + field));
    assert.doesNotMatch(fn, /viluNetTotal|agencyEarnings|paymentCollector/);
  });
  test('the callable never does `...bReq` / `...res` object-spread or returns bReq/res directly', () => {
    const fn = extractByStart(FUNCS, /exports\.getAgencyBookingConfirmationData = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.doesNotMatch(fn, /\.\.\.(bReq|res)\b/);
    assert.doesNotMatch(fn, /return bReq;|return res;/);
  });
}

section('Case F — Part 6: component-price sanitization reused, not re-invented');
{
  test('guestIncludes/guestActivities are passed through as-is -- already sanitized by sanitizeGuestLabel() at quote creation/finalize time (Phase B/C), never re-derived from raw package/catalog labels here', () => {
    const fn = extractByStart(FUNCS, /function agencyBookingConfirmationPayload\(bReq, reservationId\)\s*\{/);
    assert.match(fn, /guestIncludes: Array\.isArray\(bReq\.guestIncludes\) \? bReq\.guestIncludes : \[\]/);
    assert.doesNotMatch(fn, /sanitizeGuestLabel/); // not re-implemented here -- already sanitized upstream
  });
}

section('Case G — Part 7: snapshot immutability -- no live package/catalog/exchange-rate reads');
{
  test('getAgencyBookingConfirmationData() never reads service_catalog, agency_packages, website_content (exchange rates/booking settings), or ota_room_types', () => {
    const fn = extractByStart(FUNCS, /exports\.getAgencyBookingConfirmationData = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.doesNotMatch(fn, /service_catalog|agency_packages|website_content|ota_room_types/);
  });
}

section('Case H — Part 8/9: booking reference and branding');
{
  test('bookingReference is the canonical reservationId already created in Phase F -- no second id is invented', () => {
    const fn = extractByStart(FUNCS, /function agencyBookingConfirmationPayload\(bReq, reservationId\)\s*\{/);
    assert.match(fn, /bookingReference: reservationId/);
  });
  test('the document heading uses the agency\'s own name (the selling party), while Vilu Residence is clearly identified as the accommodation provider', () => {
    const fn = extractByStart(PORTAL, /function buildAgencyBookingConfirmationHTML\(safe\)\s*\{/);
    assert.match(fn, /<h1>'\+esc\(safe\.agencyName\)\+'<\/h1><h2>Booking Confirmation<\/h2>/);
    assert.match(fn, /Vilu Residence Maamigili/);
  });
}

section('Case I — Part 13/14/15: server-side ownership validation and allowlist architecture');
{
  test('the callable requires role agency, verifies the booking request belongs to auth.uid, and verifies the reservation belongs to the SAME agency (double ownership check)', () => {
    const fn = extractByStart(FUNCS, /exports\.getAgencyBookingConfirmationData = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /if \(role !== 'agency'\) throw new HttpsError\('permission-denied'/);
    assert.match(fn, /if \(bReq\.agencyId !== request\.auth\.uid\) throw new HttpsError\('permission-denied', 'Not your booking request\.'\)/);
    assert.match(fn, /if \(res\.agencyId !== request\.auth\.uid\) throw new HttpsError\('permission-denied', 'Not your reservation\.'\)/);
  });
  test('firestore.rules was NOT widened to grant broader reservation/booking-request read access for this feature (Phase I later TIGHTENED reservations\' own read rule further still -- see agency-security-rules.test.js)', () => {
    const resBlock = RULES.slice(RULES.indexOf('match /reservations/{id} {'), RULES.indexOf('match /reservation_price_adjustments/'));
    assert.doesNotMatch(resBlock, /isAgency\(\) && resource\.data\.agencyId == request\.auth\.uid/);
    const bookingReqBlock = RULES.slice(RULES.indexOf('match /agency_booking_requests/{id} {'), RULES.indexOf('match /packages/{packageId}'));
    assert.match(bookingReqBlock, /allow read: if request\.auth != null && \(isAdmin\(\) \|\| isStaff\(\) \|\| isManagerRole\(\) \|\| resource\.data\.agencyId == request\.auth\.uid\);/);
  });
}

section('Case J — Part 18: no payment information shown');
{
  test('the renderer never shows paymentCollector, settlement direction, or an amount due', () => {
    const fn = extractByStart(PORTAL, /function buildAgencyBookingConfirmationHTML\(safe\)\s*\{/);
    assert.doesNotMatch(fn, /paymentCollector|settlement|amount due|Amount Due/i);
  });
}

section('Case K — Part 20/22: guest notes and terms');
{
  test('guestMessage (the same dedicated guest-facing note field buildGuestQuotationHTML already treats as safe) is the only note source -- no internalNote/staff note/Cloudbeds import/housekeeping field is read', () => {
    const fn = extractByStart(FUNCS, /exports\.getAgencyBookingConfirmationData = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /payload\.guestMessage = String\(quoteSnap\.data\(\)\.guestMessage \|\| ''\)/);
    assert.doesNotMatch(fn, /internalNote|housekeeping|reservation_note_history/i);
  });
  test('terms are intentionally omitted this phase -- no packages_terms read in the confirmation payload/renderer', () => {
    const fnServer = extractByStart(FUNCS, /exports\.getAgencyBookingConfirmationData = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.doesNotMatch(fnServer, /packages_terms/);
    const fnClient = extractByStart(PORTAL, /function buildAgencyBookingConfirmationHTML\(safe\)\s*\{/);
    assert.doesNotMatch(fnClient, /terms/i);
  });
}

section('Case L — Part 11/12/23: print pattern reuse, single shared renderer, correct button labels');
{
  test('reuses the established window.open + document.write + document.close pattern (same as printQuotation()), no new PDF library', () => {
    const fn = extractByStart(PORTAL, /async function openAgencyBookingConfirmation\(requestId\)\s*\{/);
    assert.match(fn, /window\.open\('', '_blank'\)/);
    assert.match(fn, /win\.document\.write\(/);
    assert.match(fn, /win\.document\.close\(\)/);
  });
  test('Preview and Print buttons call the exact same function -- one renderer, never two divergent templates', () => {
    assert.doesNotMatch(PORTAL, /function buildAgencyBookingConfirmationHTMLPrint|function buildAgencyBookingConfirmationHTMLPreview/);
    const previewCount = (PORTAL.match(/Preview confirmation[\s\S]{0,20}onclick="openAgencyBookingConfirmation/) || PORTAL.match(/onclick="openAgencyBookingConfirmation\('\'\+esc\(r\.id\)\+'\''\)"><i class="ti ti-eye"><\/i> Preview confirmation/));
    assert.match(PORTAL, /Preview confirmation/);
    assert.match(PORTAL, /Print \/ Save PDF/);
  });
  test('no misleading "Download PDF" label is used anywhere for this feature', () => {
    assert.doesNotMatch(PORTAL, /Download PDF/);
  });
}

section('Case M — Part 27 (structural half): no inventory/accounting collection is written by this phase\'s new code');
{
  test('getAgencyBookingConfirmationData() performs only .get() reads, never .set()/.add()/.update()/runTransaction', () => {
    const fn = extractByStart(FUNCS, /exports\.getAgencyBookingConfirmationData = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.doesNotMatch(fn, /\.set\(|\.add\(|\.update\(|runTransaction/);
  });
  test('openAgencyBookingConfirmation() never writes to Firestore -- calls the read-only callable and opens a window', () => {
    const fn = extractByStart(PORTAL, /async function openAgencyBookingConfirmation\(requestId\)\s*\{/);
    assert.doesNotMatch(fn, /fsDb\.collection/);
  });
}

section('Case N — DO-NOT-TOUCH: confirmation logic, availability, holds, catalog, Website Packages, Beds24/Cloudbeds/OTA, tax, Document Vault, settlement');
{
  test('confirmAgencyBookingRequest (Phase F decision logic) is unchanged by this phase', () => {
    assert.match(FUNCS, /exports\.confirmAgencyBookingRequest = onCall\(/);
  });
  test('no Phase G code references Beds24/Cloudbeds/OTA collections or the document vault (settlement is checked separately -- Phase J later legitimately added it elsewhere, see agency-settlements.test.js)', () => {
    // Bounded to end where Phase H's own first new export begins, not run
    // to end-of-file -- otherwise this slice would also swallow Phase H's
    // and Phase J's later, unrelated code and false-positive against
    // THEIR content instead of checking only what Phase G itself added.
    const phaseGFuncs = FUNCS.slice(FUNCS.indexOf('exports.getAgencyBookingConfirmationData = onCall('), FUNCS.indexOf('exports.searchAgencyGuests = onCall('));
    assert.doesNotMatch(phaseGFuncs, /beds24|Beds24|ota_pushes|otaWebhook|reservation_documents/);
    const phaseGPortal = PORTAL.slice(PORTAL.indexOf('async function openAgencyBookingConfirmation'));
    assert.doesNotMatch(phaseGPortal, /beds24|Beds24|ota_pushes|otaWebhook/);
  });
  test('the Website tab\'s own card renderer in vilu-unified.html is unchanged', () => {
    const PMS = fs.readFileSync('vilu-unified.html', 'utf8');
    assert.match(PMS, /id="s-pkgs"/);
  });
}

console.log(`\n${passed}/${passed + failed} agency-booking-confirmation (structural) assertions passed`);
if (failed > 0) process.exitCode = 1;
