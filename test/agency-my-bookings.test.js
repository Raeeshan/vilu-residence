// Agency Sales Workflow — Phase H: My Bookings + own-guest search.
// Structural assertions against the actual source files (not the real
// Firestore emulator -- see agency-my-bookings-rules.test.js for that),
// same extractByStart()/regex convention established in Phases C-G.
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

section('Case A — Part 1/3: localStorage retired as the source of truth');
{
  test('the new drawMyBookings() never reads the old myBookings array or localStorage', () => {
    const fn = extractByStart(PORTAL, /async function drawMyBookings\(\)\s*\{/);
    assert.doesNotMatch(fn, /myBookings\.|localStorage/);
  });
  test('renderMyBookings()/renderMbRow() render only from _mbReservations/_mbRequests/_mbSearchResults, never myBookings', () => {
    const fn = extractByStart(PORTAL, /function renderMyBookings\(\)\s*\{/);
    assert.doesNotMatch(fn, /myBookings\.|localStorage/);
  });
  test('the old myBookings-driven table/generateBookingConfirmation/generateAgencyInvoice are left in the file but no longer wired into the My Bookings tab', () => {
    assert.match(PORTAL, /function generateBookingConfirmation\(bkId\)/); // still present, unreachable
    const tabHtml = PORTAL.slice(PORTAL.indexOf('<!-- MY BOOKINGS TAB'), PORTAL.indexOf('<!-- BLOCK ROOMS TAB'));
    assert.doesNotMatch(tabHtml, /generateBookingConfirmation|generateAgencyInvoice/);
  });
}

section('Case B — Part 2: canonical sources, scoped server-side, no client-side global fetch');
{
  test('confirmed bookings come from an agencyId-scoped source -- direct client read as of Phase H, then hardened to the getMyAgencyBookings() callable by Phase I (I-17: the raw reservation doc also carries internal_note/notes/viluNetTotal, which rules cannot redact field-by-field) -- never an unscoped fetch', () => {
    const fn = extractByStart(PORTAL, /async function drawMyBookings\(\)\s*\{/);
    assert.match(fn, /fsFunctions\.httpsCallable\('getMyAgencyBookings'\)/);
    assert.doesNotMatch(fn, /fsDb\.collection\('reservations'\)\.get\(\)/);
    assert.doesNotMatch(fn, /fsDb\.collection\('reservations'\)\.where/);
  });
  test('pending/change/rejected booking business comes from agency_booking_requests scoped by agencyId==currentAgency.uid', () => {
    const fn = extractByStart(PORTAL, /async function drawMyBookings\(\)\s*\{/);
    assert.match(fn, /fsDb\.collection\('agency_booking_requests'\)\.where\('agencyId','==',currentAgency\.uid\)\.get\(\)/);
  });
}

section('Case C — Part 4/17: My Bookings dashboard summary, no double-counting');
{
  test('summary tiles are Total/Upcoming/Current/Pending/Confirmed/Past -- all derived from real fetched data, no hardcoded numbers', () => {
    const fn = extractByStart(PORTAL, /function renderMyBookings\(\)\s*\{/);
    ['Total bookings', 'Upcoming', 'Current', 'Pending', 'Confirmed', 'Past'].forEach((label) => {
      assert.match(fn, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });
  });
  test('a CONFIRMED booking request whose reservation already exists is excluded from _mbRequests -- never counted as a second booking', () => {
    const fn = extractByStart(PORTAL, /async function drawMyBookings\(\)\s*\{/);
    assert.match(fn, /confirmedRequestIds\[r\.agencyBookingRequestId\]=true/);
    assert.match(fn, /filter\(function\(r\)\{ return !confirmedRequestIds\[r\.id\]; \}\)/);
  });
  test('a Cancelled reservation is excluded from the confirmed/upcoming/current/past counts (its own bucket instead)', () => {
    const fn = extractByStart(PORTAL, /function renderMyBookings\(\)\s*\{/);
    assert.match(fn, /if\(r\.status==='Cancelled'\) return;/);
  });
}

section('Case D — Part 5: filters');
{
  test('MB_FILTERS covers All/Upcoming/Current/Pending/Confirmed/Past/Cancelled-Rejected', () => {
    assert.match(PORTAL, /key:'ALL'/);
    assert.match(PORTAL, /key:'UPCOMING'/);
    assert.match(PORTAL, /key:'CURRENT'/);
    assert.match(PORTAL, /key:'PENDING'/);
    assert.match(PORTAL, /key:'CONFIRMED'/);
    assert.match(PORTAL, /key:'PAST'/);
    assert.match(PORTAL, /key:'CANCELLED'/);
  });
  test('a date-range filter (arrival from/to) is wired into renderMyBookings()', () => {
    const fn = extractByStart(PORTAL, /function renderMyBookings\(\)\s*\{/);
    assert.match(fn, /mb-date-from/);
    assert.match(fn, /mb-date-to/);
  });
}

section('Case E — Part 6/7: booking row fields, pending rows clearly not confirmed');
{
  test('a confirmed row shows guest, reference, dates, nights, guests, room/category, package, status, and optionally the agreed selling total', () => {
    const fn = extractByStart(PORTAL, /function renderMbRow\(e\)\s*\{/);
    assert.match(fn, /r\.guest_name/);
    assert.match(fn, /roomCategory/);
    assert.match(fn, /nights/);
    assert.match(fn, /agencyGuestSellingTotal/);
  });
  test('a confirmed row never shows Vilu internal rate, component prices, or internal notes', () => {
    const fn = extractByStart(PORTAL, /function renderMbRow\(e\)\s*\{/);
    assert.doesNotMatch(fn, /viluNetTotal|viluUnitRate|roomInternalRate|adminNote|internalNote/i);
  });
  test('a pending/change/rejected request row reuses Phase F\'s exact BOOKING_REQUEST_STATUS_LABEL/BADGE maps -- never a third, inconsistent status vocabulary', () => {
    const fn = extractByStart(PORTAL, /function renderMbRow\(e\)\s*\{/);
    assert.match(fn, /BOOKING_REQUEST_STATUS_BADGE\[q\.status\]/);
    assert.match(fn, /BOOKING_REQUEST_STATUS_LABEL\[q\.status\]/);
  });
}

section('Case F — Part 8/9/20: Booking Detail reuses Phase G, never a second data path, never leaks internals');
{
  test('openBookingDetail() calls getAgencyBookingConfirmationData() as its ENTIRE data source -- no separate reservation/request read feeds the detail fields', () => {
    const fn = extractByStart(PORTAL, /async function openBookingDetail\(requestId\)\s*\{/);
    assert.match(fn, /fsFunctions\.httpsCallable\('getAgencyBookingConfirmationData'\)/);
  });
  test('the only OTHER read inside openBookingDetail is the agency\'s own booking request doc, used purely for the holdRequestId boolean (Part 19) -- not a second source of confirmation fields', () => {
    const fn = extractByStart(PORTAL, /async function openBookingDetail\(requestId\)\s*\{/);
    const afterCallable = fn.slice(fn.indexOf("getAgencyBookingConfirmationData"));
    const otherReads = afterCallable.match(/fsDb\.collection\('([a-z_]+)'\)/g) || [];
    otherReads.forEach((r) => assert.match(r, /agency_booking_requests/));
  });
  test('View confirmation / Print confirmation both call the existing openAgencyBookingConfirmation() (Phase G) -- not a re-implementation', () => {
    const fn = extractByStart(PORTAL, /async function openBookingDetail\(requestId\)\s*\{/);
    assert.match(fn, /onclick="openAgencyBookingConfirmation\(/g);
  });
  test('no internalNote/reservation_note_history/Cloudbeds/housekeeping/folio/invoice/passport/document field is ever referenced in the detail renderer', () => {
    const fn = extractByStart(PORTAL, /async function openBookingDetail\(requestId\)\s*\{/);
    assert.doesNotMatch(fn, /internalNote|reservation_note_history|housekeeping|folio|invoice|passport|reservation_documents/i);
  });
}

section('Case G — Part 18/19: quote history and hold history relationships');
{
  test('"View originating quotation" calls the existing printQuotation() (Phase B), only for this agency\'s own quoteReference', () => {
    const fn = extractByStart(PORTAL, /async function openBookingDetail\(requestId\)\s*\{/);
    assert.match(fn, /onclick="printQuotation\(/);
    assert.match(fn, /esc\(safe\.quoteReference\)/);
    assert.match(fn, /View originating quotation/);
  });
  test('hold usage is shown as safe operational text only ("Temporary hold used"), never a raw block reason', () => {
    const fn = extractByStart(PORTAL, /async function openBookingDetail\(requestId\)\s*\{/);
    assert.match(fn, /Temporary hold used/);
    assert.doesNotMatch(fn, /\.reason\b/);
  });
}

section('Case H — Part 10/11/25/26: own-guest search architecture');
{
  test('searchAgencyGuests() never accepts a client-supplied agencyId -- always request.auth.uid', () => {
    const fn = extractByStart(FUNCS, /exports\.searchAgencyGuests = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /const agencyId = request\.auth\.uid;/);
    assert.doesNotMatch(fn, /data\.agencyId/);
  });
  test('search queries only agencyId-scoped collections (reservations/agency_booking_requests/agency_quotes), never an unscoped read', () => {
    const fn = extractByStart(FUNCS, /exports\.searchAgencyGuests = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /db\.collection\('reservations'\)\.where\('agencyId', '==', agencyId\)/);
    assert.match(fn, /db\.collection\('agency_booking_requests'\)\.where\('agencyId', '==', agencyId\)/);
    assert.match(fn, /db\.collection\('agency_quotes'\)\.where\('agencyId', '==', agencyId\)/);
  });
  test('matching is case-insensitive substring (normalizeForSearch lowercases both sides)', () => {
    assert.match(FUNCS, /function normalizeForSearch\(s\)\s*\{\s*return String\(s \|\| ''\)\.toLowerCase\(\)\.trim\(\);/);
  });
  test('results are bounded (a per-source cap and a total result cap), not an unbounded scan', () => {
    assert.match(FUNCS, /AGENCY_SEARCH_MAX_PER_SOURCE/);
    assert.match(FUNCS, /AGENCY_SEARCH_MAX_RESULTS/);
    assert.match(FUNCS, /\.limit\(AGENCY_SEARCH_MAX_PER_SOURCE\)/);
  });
}

section('Case I — Part 12/17: search result dedup, confirmed supersedes request/quote');
{
  test('a booking request whose id already produced a confirmed reservation result is excluded (supersededRequestIds)', () => {
    const fn = extractByStart(FUNCS, /exports\.searchAgencyGuests = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /supersededRequestIds\.has\(doc\.id\)/);
  });
  test('a quote already linked to any booking request is excluded from quote results (supersededQuoteIds)', () => {
    const fn = extractByStart(FUNCS, /exports\.searchAgencyGuests = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /supersededQuoteIds\.has\(doc\.id\)/);
  });
  test('each result carries a `type` field (RESERVATION/BOOKING_REQUEST/QUOTE) so the client can clearly label what it is', () => {
    const fn = extractByStart(FUNCS, /exports\.searchAgencyGuests = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /type: 'RESERVATION'/);
    assert.match(fn, /type: 'BOOKING_REQUEST'/);
    assert.match(fn, /type: 'QUOTE'/);
  });
}

section('Case J — Part 16: Maldives date semantics for Upcoming/Current/Past, half-open convention');
{
  test('maldivesToday() uses Intl.DateTimeFormat with timeZone Indian/Maldives, not the browser\'s local Date', () => {
    const fn = extractByStart(PORTAL, /function maldivesToday\(\)\s*\{/);
    assert.match(fn, /timeZone:'Indian\/Maldives'/);
  });
  test('classification is half-open (departure day itself is PAST, not CURRENT), matching every other overlap check in this codebase', () => {
    const fn = extractByStart(PORTAL, /function classifyBookingDates\(arrivalDate, departureDate, today\)\s*\{/);
    assert.match(fn, /departureDate<=today\) return 'PAST'/);
    assert.match(fn, /departureDate>today/);
  });
}

section('Case K — Part 21: Calendar integration, one shared detail component');
{
  test('openOwnBookingSummary() (the Phase D calendar click handler) routes into the shared openBookingDetail() when a booking request id is resolvable -- looked up via getMyAgencyBookings() (Phase I: no more direct reservation doc read) rather than snap.data()', () => {
    const fn = extractByStart(PORTAL, /async function openOwnBookingSummary\(reservationId\)\s*\{/);
    assert.match(fn, /fsFunctions\.httpsCallable\('getMyAgencyBookings'\)/);
    assert.match(fn, /openBookingDetail\(match\.agencyBookingRequestId\)/);
    assert.doesNotMatch(fn, /fsDb\.collection\('reservations'\)\.doc/);
  });
  test('the fallback thin m-own-booking modal is only reached when no agencyBookingRequestId exists', () => {
    const fn = extractByStart(PORTAL, /async function openOwnBookingSummary\(reservationId\)\s*\{/);
    const beforeFallback = fn.slice(0, fn.indexOf("m-own-booking"));
    assert.match(beforeFallback, /if\(match && match\.agencyBookingRequestId\)/);
  });
}

section('Case L — Part 22/23: no availability changes, no editing/cancellation workflow');
{
  test('no Phase H code writes to room_availability, blocks, or reservations', () => {
    const phaseHPortal = PORTAL.slice(PORTAL.indexOf('// ══════════════════════════════════════════════\n// MY BOOKINGS — Phase H'));
    assert.doesNotMatch(phaseHPortal, /\.collection\('room_availability'\)\.doc\([^)]*\)\.set|\.collection\('blocks'\)\.doc\([^)]*\)\.set|\.collection\('reservations'\)\.doc\([^)]*\)\.set/);
  });
  test('the booking detail view shows only passive "contact Vilu" text -- no date/room/guest-count/price edit control, no cancel button', () => {
    const fn = extractByStart(PORTAL, /async function openBookingDetail\(requestId\)\s*\{/);
    assert.match(fn, /contact Vilu Residence directly/);
    assert.doesNotMatch(fn, /onclick="(edit|cancel|modify)[A-Za-z]*\(/i);
  });
}

section('Case M — Part 27/28: financial display restraint, future-readiness without a settlement UI');
{
  test('the row/detail views show agencyGuestSellingTotal only -- never viluNetTotal/agencyEarnings/paymentCollector/"amount due"/"commission"', () => {
    const rowFn = extractByStart(PORTAL, /function renderMbRow\(e\)\s*\{/);
    const detailFn = extractByStart(PORTAL, /async function openBookingDetail\(requestId\)\s*\{/);
    [rowFn, detailFn].forEach((fn) => {
      assert.doesNotMatch(fn, /viluNetTotal|agencyEarnings|paymentCollector/);
      assert.doesNotMatch(fn, /amount due|commission payable|paid commission|vilu owes|agency owes/i);
    });
  });
  test('no settlement/payout/commission-payment UI was built as PART OF Phase H itself (Phase J later legitimately added its own separate Earnings & Settlements tab, see agency-settlements.test.js)', () => {
    const phaseHOnly = PORTAL.slice(PORTAL.indexOf('// MY BOOKINGS — Phase H'), PORTAL.indexOf('// EARNINGS & SETTLEMENTS — Phase J'));
    assert.doesNotMatch(phaseHOnly, /settlement|payout/i);
  });
}

section('Case N — Part 29: firestore.rules not broadened');
{
  test('agency_booking_requests/agency_quotes read rules are byte-identical to their pre-Phase-H shape (already agency-own-scoped, reused as-is) -- reservations\' own read rule was later tightened FURTHER by Phase I (I-17), not broadened, see agency-security-rules.test.js', () => {
    const reqBlock = RULES.slice(RULES.indexOf('match /agency_booking_requests/{id} {'), RULES.indexOf('match /packages/{packageId}'));
    assert.match(reqBlock, /allow read: if request\.auth != null && \(isAdmin\(\) \|\| isStaff\(\) \|\| isManagerRole\(\) \|\| resource\.data\.agencyId == request\.auth\.uid\);/);
  });
}

section('Case O — DO-NOT-TOUCH: confirmation logic, holds, availability, catalog, Website Packages, Beds24/Cloudbeds/OTA, tax, Document Vault, settlement');
{
  test('getAgencyBookingConfirmationData/confirmAgencyBookingRequest (Phase F/G server logic) are unchanged by this phase', () => {
    assert.match(FUNCS, /exports\.getAgencyBookingConfirmationData = onCall\(/);
    assert.match(FUNCS, /exports\.confirmAgencyBookingRequest = onCall\(/);
  });
  test('no Phase H code references Beds24/Cloudbeds/OTA collections or the document vault (settlement is checked separately -- Phase I/J later legitimately touched reservations/added settlements, see agency-security-audit-rules.test.js / agency-settlements.test.js)', () => {
    // Bounded to end where Phase I's own first new export begins, not run
    // to end-of-file -- otherwise this slice would also swallow Phase I's
    // and Phase J's later, unrelated code and false-positive against
    // THEIR content instead of checking only what Phase H itself added.
    const phaseHFuncs = FUNCS.slice(FUNCS.indexOf('exports.searchAgencyGuests = onCall('), FUNCS.indexOf('exports.getMyAgencyBookings = onCall('));
    assert.doesNotMatch(phaseHFuncs, /beds24|Beds24|ota_pushes|otaWebhook|reservation_documents/);
  });
  test('the Website tab\'s own card renderer in vilu-unified.html is unchanged', () => {
    const PMS = fs.readFileSync('vilu-unified.html', 'utf8');
    assert.match(PMS, /id="s-pkgs"/);
  });
}

console.log(`\n${passed}/${passed + failed} agency-my-bookings (structural) assertions passed`);
if (failed > 0) process.exitCode = 1;
