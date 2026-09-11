// Agency Sales Workflow — Phase F: Booking Request -> Vilu Confirmation ->
// Canonical Reservation. Structural assertions against the actual source
// files (not the real Firestore emulator -- see
// agency-booking-requests-rules.test.js for that), same
// extractByStart()/regex convention established in Phases C-E.
const fs = require('fs');
const assert = require('node:assert/strict');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); }
}

const PORTAL = fs.readFileSync('vilu-agency-portal.html', 'utf8');
const PMS = fs.readFileSync('vilu-unified.html', 'utf8');
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

section('Case A — Part 1: old direct booking flow audited, left untouched (until cutover)');
{
  test('submitAgencyBooking() still exists and still writes status:\'Confirmed\'/source:\'Agency\' directly via writeReservation()', () => {
    const fn = extractByStart(PORTAL, /async function submitAgencyBooking\(\)\s*\{/);
    assert.match(fn, /src:'Agency',pay:'Unpaid',st:'Confirmed'/);
    assert.match(fn, /await writeReservation\(roomRef, roomFields\)/);
  });
  test('writeReservation() (the direct client transaction helper) is unchanged -- still the one function permitted to write reservations/room_availability client-side', () => {
    const fn = extractByStart(PORTAL, /async function writeReservation\(docId, fields, opts\)\s*\{/);
    assert.match(fn, /fsDb\.collection\('reservations'\)\.doc\(docId\)/);
    assert.match(fn, /fsDb\.collection\('room_availability'\)\.doc\(roomId\)/);
  });
}

section('Case B — Part 2: NEW agency_booking_requests collection, kept separate');
{
  test('agency_booking_requests is a distinct collection from agency_quotes/block_requests/reservations', () => {
    assert.match(PORTAL, /fsDb\.collection\('agency_booking_requests'\)/);
    assert.match(FUNCS, /db\.collection\('agency_booking_requests'\)/);
  });
  test('no code writes AGENCY_HOLD-style requestType docs into agency_booking_requests (would collapse the two collections)', () => {
    const bkReqSection = extractByStart(PORTAL, /async function sendAgencyBookingRequest\(\)\s*\{/);
    assert.doesNotMatch(bkReqSection, /requestType/);
  });
}

section('Case C — Part 3: booking request data model');
{
  test('sendAgencyBookingRequest() writes the full suggested field set', () => {
    const fn = extractByStart(PORTAL, /async function sendAgencyBookingRequest\(\)\s*\{/);
    ['agencyId', 'agencyEmail', 'agencyName', 'quoteId', 'quoteReference', 'guestName', 'guestEmail', 'guestPhone',
      'arrivalDate', 'departureDate', 'nights', 'adults', 'children', 'roomCategory', 'requestedRoomId', 'assignedRoomId',
      'quoteType', 'packageName', 'packageSnapshot', 'guestIncludes', 'guestActivities', 'currency',
      'viluNetTotal', 'agencyGuestSellingTotal', 'agencyEarnings', 'paymentCollector', 'holdRequestId', 'holdBlockId',
      'status', 'createdAt', 'updatedAt', 'confirmedAt', 'confirmedBy', 'reservationId', 'rejectionReason', 'changeRequestNote',
    ].forEach((field) => assert.match(fn, new RegExp(field + '\\s*:'), 'missing field: ' + field));
  });
  test('status enum matches PENDING/CONFIRMED/REJECTED/CHANGE_REQUESTED/CANCELLED throughout', () => {
    assert.match(FUNCS, /status !== 'PENDING' && bReq\.status !== 'CHANGE_REQUESTED'/);
    assert.match(FUNCS, /status: 'CONFIRMED'/);
    assert.match(FUNCS, /status: 'REJECTED'/);
    assert.match(FUNCS, /status: 'CHANGE_REQUESTED'/);
  });
}

section('Case D — Part 4: source must be a FINALIZED quote, snapshot not arbitrary entry');
{
  test('openBookingRequestModal() rejects a quote that is not FINALIZED', () => {
    const fn = extractByStart(PORTAL, /async function openBookingRequestModal\(quoteId\)\s*\{/);
    assert.match(fn, /status!=='FINALIZED'/);
  });
  test('sendAgencyBookingRequest() re-verifies FINALIZED + ownership from a FRESH read right before writing', () => {
    const fn = extractByStart(PORTAL, /async function sendAgencyBookingRequest\(\)\s*\{/);
    assert.match(fn, /freshSnap\.data\(\)\.status!=='FINALIZED'/);
    assert.match(fn, /freshSnap\.data\(\)\.agencyId!==currentAgency\.uid/);
  });
  test('the "Guest confirmed — Send booking request" button only appears on a FINALIZED quote card, never a DRAFT', () => {
    assert.match(PORTAL, /bookingReqBtn = \(!isDraft && q\.arrivalDate && q\.departureDate\)/);
    assert.match(PORTAL, /Guest confirmed — Send booking request/);
  });
}

section('Case E — Part 5/6/14: optional hold link, no hold required, hold conversion');
{
  test('a hold is optional -- confirmAgencyBookingRequest proceeds with a plain availability check when no valid hold is linked', () => {
    const fn = extractByStart(FUNCS, /exports\.confirmAgencyBookingRequest = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /let hold = null;/);
    assert.match(fn, /agencyHoldAvailable\(tx, bReq\.requestedRoomId, bReq\.arrivalDate, bReq\.departureDate, hold \? hold\.data\.blockId : undefined\)/);
  });
  test('the linked hold must match agency+room+dates and still be APPROVED and unexpired before it is trusted', () => {
    const fn = extractByStart(FUNCS, /exports\.confirmAgencyBookingRequest = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /h\.agencyId === bReq\.agencyId/);
    assert.match(fn, /h\.roomId === bReq\.requestedRoomId && h\.arrivalDate === bReq\.arrivalDate && h\.departureDate === bReq\.departureDate/);
    assert.match(fn, /\(h\.approvedHoldUntil \|\| ''\) > nowIso/);
  });
  test('confirming with a valid hold deletes its block inside the SAME transaction as the reservation write (Part 14: no leftover block, no gap)', () => {
    const fn = extractByStart(FUNCS, /exports\.confirmAgencyBookingRequest = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /tx\.delete\(db\.collection\('blocks'\)\.doc\(hold\.data\.blockId\)\)/);
    assert.match(fn, /tx\.set\(db\.collection\('reservations'\)\.doc\(resId\), reservationFields/);
  });
}

section('Case F — Part 7: Agency Portal request UI');
{
  test('the booking-request modal shows guest/dates/guests/package/room/totals/payment collector, and a hold-active note when linked', () => {
    assert.match(PORTAL, /id="m-booking-request"/);
    assert.match(PORTAL, /id="bkreq-summary"/);
    assert.match(PORTAL, /id="bkreq-room"/);
    assert.match(PORTAL, /id="bkreq-hold-note"/);
    assert.match(PORTAL, /Send booking request to Vilu/);
  });
}

section('Case G — Part 8: sending a request creates ONLY agency_booking_requests, status PENDING');
{
  test('sendAgencyBookingRequest() writes status PENDING and touches no other collection', () => {
    const fn = extractByStart(PORTAL, /async function sendAgencyBookingRequest\(\)\s*\{/);
    assert.match(fn, /status: 'PENDING'/);
    assert.doesNotMatch(fn, /\.collection\('reservations'\)/);
    assert.doesNotMatch(fn, /\.collection\('room_availability'\)/);
    assert.doesNotMatch(fn, /\.collection\('(folios|invoices|reservation_documents)'\)/);
  });
}

section('Case H — Part 9: PMS operational queue, not inside Package Manager');
{
  test('a dedicated top-level nav entry exists, in the Bookings group alongside New booking', () => {
    assert.match(PMS, /<div class="sg">Bookings<\/div>\s*\n\s*<div class="sl" onclick="go\('newbk',this\)">[\s\S]{0,80}<div class="sl" onclick="go\('agybk',this\)">/);
  });
  test('TITLES/FMAP wire agybk to its own section and drawAgencyBookingRequests()', () => {
    assert.match(PMS, /agybk:'Agency Booking Requests'/);
    assert.match(PMS, /agybk:drawAgencyBookingRequests/);
  });
  test('the queue is its own top-level section, not nested inside Package Manager (s-pkgs)', () => {
    const agybkIdx = PMS.indexOf('id="s-agybk"');
    const pkgsIdx = PMS.indexOf('id="s-pkgs"');
    assert.ok(agybkIdx > -1 && pkgsIdx > -1);
    const between = PMS.slice(Math.min(agybkIdx, pkgsIdx), Math.max(agybkIdx, pkgsIdx));
    assert.doesNotMatch(between.slice(1), /id="s-agybk"|id="s-pkgs"/); // exactly one of each between the two markers
  });
  test('the row shows Agency/Guest/Arrival/Departure/Nights/Guests/Package/Requested room/Vilu net/Guest total/Payment collector/Quote reference/hold status', () => {
    const fn = extractByStart(PMS, /async function drawAgencyBookingRequests\(\)\s*\{/);
    ['agencyName', 'guestName', 'roomCategory', 'requestedRoomId', 'arrivalDate', 'departureDate', 'nights',
      'adults', 'packageName', 'viluNetTotal', 'agencyGuestSellingTotal', 'paymentCollector', 'quoteReference', 'holdLine',
    ].forEach((f) => assert.match(fn, new RegExp('r\\.' + f + '|' + f), 'missing display of: ' + f));
  });
  test('Confirm / Request change / Reject actions are all present', () => {
    const fn = extractByStart(PMS, /async function drawAgencyBookingRequests\(\)\s*\{/);
    assert.match(fn, /onclick="confirmAgencyBookingRequest\(/);
    assert.match(fn, /onclick="requestChangeAgencyBookingRequest\(/);
    assert.match(fn, /onclick="rejectAgencyBookingRequest\(/);
  });
}

section('Case I — Part 10: Request Change behavior');
{
  test('requestChangeAgencyBookingRequest requires a note, only from PENDING, never touches a linked hold', () => {
    const fn = extractByStart(FUNCS, /exports\.requestChangeAgencyBookingRequest = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /if \(!note\) throw new HttpsError\('invalid-argument'/);
    assert.match(fn, /if \(bReq\.status !== 'PENDING'\)/);
    assert.doesNotMatch(fn, /blockId/);
  });
  test('does not silently mutate the finalized quote\'s commercial content -- only writes to the booking request itself', () => {
    const fn = extractByStart(FUNCS, /exports\.requestChangeAgencyBookingRequest = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.doesNotMatch(fn, /agency_quotes/);
  });
}

section('Case J — Part 11: rejection releases a linked active hold (chosen behavior)');
{
  test('rejectAgencyBookingRequest releases the linked hold\'s block and marks it CANCELLED when still APPROVED', () => {
    const fn = extractByStart(FUNCS, /exports\.rejectAgencyBookingRequest = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /holdSnap\.data\(\)\.status === 'APPROVED'/);
    assert.match(fn, /db\.collection\('blocks'\)\.doc\(h\.blockId\)\.delete\(\)/);
    assert.match(fn, /status: 'CANCELLED', releasedAt: now, releasedBy: email/);
  });
  test('rejection stores rejectionReason, updatedAt, and a decision actor; creates no reservation', () => {
    const fn = extractByStart(FUNCS, /exports\.rejectAgencyBookingRequest = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /status: 'REJECTED', rejectionReason: reason, updatedAt: now, rejectedBy: email/);
    assert.doesNotMatch(fn, /collection\('reservations'\)/);
  });
}

section('Case K — Part 12: confirmation is server-side, one controlled transaction');
{
  test('confirmAgencyBookingRequest is an onCall function requiring staff-like role', () => {
    const fn = extractByStart(FUNCS, /exports\.confirmAgencyBookingRequest = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /requireStaffLike\(role\)/);
  });
  test('the whole decision (load request, load quote, recheck availability, create reservation, consume hold, mark CONFIRMED) happens inside one db.runTransaction', () => {
    const fn = extractByStart(FUNCS, /exports\.confirmAgencyBookingRequest = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /return db\.runTransaction\(async \(tx\) => \{/);
    assert.match(fn, /tx\.set\(reqRef, \{\s*status: 'CONFIRMED'/);
  });
}

section('Case L — Part 13: availability recheck, never trust stale state');
{
  test('confirmAgencyBookingRequest re-reads room_availability/blocks fresh inside the transaction, not from the booking request\'s own snapshot', () => {
    const fn = extractByStart(FUNCS, /exports\.confirmAgencyBookingRequest = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /const available = await agencyHoldAvailable\(tx, bReq\.requestedRoomId/);
    assert.match(fn, /if \(!available\) \{/);
    assert.match(fn, /return \{ availabilityChanged: true \};/);
  });
  test('an unavailable room leaves the request actionable (no status change, no reservation) rather than half-confirmed', () => {
    const fn = extractByStart(FUNCS, /exports\.confirmAgencyBookingRequest = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    const availBlock = fn.slice(fn.indexOf('if (!available)'), fn.indexOf('if (!available)') + 300);
    assert.doesNotMatch(availBlock, /tx\.set\(reqRef/);
  });
}

section('Case M — Part 15/16: canonical reservation, correct source/agency linkage');
{
  test('confirmation writes to the SAME reservations collection every other source uses -- no separate "agency reservation" store', () => {
    const fn = extractByStart(FUNCS, /exports\.confirmAgencyBookingRequest = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /db\.collection\('reservations'\)\.doc\(resId\)/);
  });
  test('reservation carries source:\'Agency\' and full ownership snapshot (agencyId/agencyName/agencyEmail/agencyBookingRequestId/agencyQuoteId/agencyQuoteReference)', () => {
    const fn = extractByStart(FUNCS, /exports\.confirmAgencyBookingRequest = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /status: 'Confirmed', source: 'Agency'/);
    assert.match(fn, /agencyId: bReq\.agencyId, agencyEmail: bReq\.agencyEmail, agencyName: bReq\.agencyName/);
    assert.match(fn, /agencyBookingRequestId: requestId, agencyQuoteId: bReq\.quoteId \|\| null, agencyQuoteReference: bReq\.quoteReference \|\| null/);
  });
}

section('Case N — Part 17/18/19/20: price snapshot, payment collector, package immutability, guest privacy');
{
  test('reservation preserves viluNetTotal/agencyGuestSellingTotal/agencyEarnings/paymentCollector/currency copied from the booking request snapshot, not re-derived', () => {
    const fn = extractByStart(FUNCS, /exports\.confirmAgencyBookingRequest = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /viluNetTotal: bReq\.viluNetTotal \|\| 0, agencyGuestSellingTotal: bReq\.agencyGuestSellingTotal \|\| 0/);
    assert.match(fn, /agencyEarnings: bReq\.agencyEarnings \|\| 0, paymentCollector: bReq\.paymentCollector \|\| 'UNDECIDED'/);
  });
  test('packageSnapshot/guestIncludes/guestActivities are copied from the booking request verbatim, never re-read from the live quote/catalog at confirm time', () => {
    const fn = extractByStart(FUNCS, /exports\.confirmAgencyBookingRequest = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /packageSnapshot: bReq\.packageSnapshot \|\| null/);
    assert.match(fn, /guestIncludes: bReq\.guestIncludes \|\| \[\], guestActivities: bReq\.guestActivities \|\| \[\]/);
    assert.doesNotMatch(fn, /service_catalog|agency_packages/);
  });
  test('no settlement/accounting transaction logic is implemented this phase (Part 18/39) -- no settlements/payouts collection is written anywhere', () => {
    assert.doesNotMatch(FUNCS, /collection\('settlements'\)|collection\('payouts'\)|collection\('agency_earnings'\)/);
    assert.doesNotMatch(PORTAL, /collection\('settlements'\)|collection\('payouts'\)|collection\('agency_earnings'\)/);
  });
}

section('Case O — Part 21/22: agency-facing status display, agency cannot self-set status');
{
  test('the Agency Portal only ever DISPLAYS status from Firestore -- no code path sets status to CONFIRMED/REJECTED client-side', () => {
    const fn = extractByStart(PORTAL, /async function drawMyBookingRequests\(\)\s*\{/);
    assert.doesNotMatch(fn, /status:\s*'CONFIRMED'|status:\s*'REJECTED'/);
    assert.match(PORTAL, /BOOKING_REQUEST_STATUS_LABEL = \{ PENDING:'Pending Vilu confirmation'/);
  });
  test('a CONFIRMED request shows the reservation reference to the agency', () => {
    assert.match(PORTAL, /Reservation '\+esc\(r\.reservationId\|\|''\)/);
  });
}

section('Case P — Part 23/24: cutover -- old direct "Book this package" path and direct-create permission both removed');
{
  test('the "Book this package" button/entry point is gone -- "Create quotation" is the only action on a package card', () => {
    assert.doesNotMatch(PORTAL, /Book this package/);
    assert.doesNotMatch(PORTAL, /onclick="openBookingModal\(this\.dataset\.pid\)"/);
    assert.match(PORTAL, /onclick="openQuoteBuilder\(this\.dataset\.pid\)" style="flex:1;background:'\+col/);
  });
  test('openBookingModal()/submitAgencyBooking() are left in the file but marked RETIRED/unreachable, not silently still-live', () => {
    assert.match(PORTAL, /RETIRED \(Phase F cutover/);
  });
  test('firestore.rules no longer grants an agency a direct reservations-create path -- only isAdmin/isStaff/isManagerRole or the unauthenticated Website branch remain', () => {
    const block = extractByStart(RULES, /match \/reservations\/\{id\} \{/);
    assert.doesNotMatch(block, /isAgency\(\) && request\.resource\.data\.agencyId == request\.auth\.uid && request\.resource\.data\.source == 'Agency'/);
    assert.match(block, /isAdmin\(\) \|\| isStaff\(\) \|\| isManagerRole\(\) \|\|/);
    assert.match(block, /request\.auth == null && request\.resource\.data\.source == 'Website'/);
  });
}

section('Case Q — Part 25: security rules (agency create/read own only, cannot self-decide)');
{
  const block = extractByStart(RULES, /match \/agency_booking_requests\/\{id\} \{/);
  test('create requires agencyId==auth.uid, forbids status other than PENDING, forbids reservationId/confirmedAt/confirmedBy from being set at create time', () => {
    assert.match(block, /request\.resource\.data\.agencyId == request\.auth\.uid/);
    assert.match(block, /request\.resource\.data\.status == 'PENDING'/);
    assert.match(block, /request\.resource\.data\.get\('reservationId', null\) == null/);
    assert.match(block, /request\.resource\.data\.get\('confirmedAt', null\) == null/);
    assert.match(block, /request\.resource\.data\.get\('confirmedBy', null\) == null/);
  });
  test('read is self-or-admin/staff/manager; update is admin/staff/manager only (decisions go through callables); delete is always false', () => {
    assert.match(block, /allow read: if request\.auth != null && \(isAdmin\(\) \|\| isStaff\(\) \|\| isManagerRole\(\) \|\| resource\.data\.agencyId == request\.auth\.uid\);/);
    assert.match(block, /allow update: if isAdmin\(\) \|\| isStaff\(\) \|\| isManagerRole\(\);/);
    assert.match(block, /allow delete: if false;/);
  });
}

section('Case R — Part 22/39: no printable confirmation, no settlement UI, no My Bookings overhaul, no guest search built this phase');
{
  test('no PDF/print-confirmation function was added for booking requests (Phase G)', () => {
    assert.doesNotMatch(PORTAL, /printBookingConfirmation|generateGuestConfirmation/);
  });
  test('tab-mybookings (the old localStorage list) is untouched -- no Phase F code writes into it', () => {
    const idx = PORTAL.indexOf('id="tab-mybookings"');
    assert.ok(idx > -1);
  });
  test('no commission/earnings settlement screen was added', () => {
    assert.doesNotMatch(PORTAL, /commissionPaymentScreen|earningsSettlement/i);
  });
}

section('Case S — DO-NOT-TOUCH: Website Packages, Agency Rate Catalog, finalized quote content, Beds24/Cloudbeds/OTA, tax settings, Document Vault');
{
  test('no Phase F code references Beds24/Cloudbeds/OTA collections or push functions', () => {
    // Scoped to the NEW Phase F code only, anchored on the first actual new
    // export -- the file's pre-existing header summary comment (updated
    // earlier in this same phase to document these new exports) also
    // contains the literal string "Agency Sales Workflow Phase F", and
    // sits BEFORE all of this file's legitimate, pre-existing Beds24 sync
    // code -- anchoring there would false-positive against that unrelated
    // code instead of checking only what this phase actually added.
    const phaseFFuncs = FUNCS.slice(FUNCS.indexOf('exports.confirmAgencyBookingRequest = onCall('));
    assert.doesNotMatch(phaseFFuncs, /beds24|Beds24|ota_pushes|otaWebhook/);
    const phaseFPortal = PORTAL.slice(PORTAL.indexOf('async function openBookingRequestModal'));
    assert.doesNotMatch(phaseFPortal, /beds24|Beds24|ota_pushes|otaWebhook/);
  });
  test('finalizeQuote()/submitAgencyCustomQuote (finalized quote commercial content) are unchanged by this phase', () => {
    assert.match(PORTAL, /async function finalizeQuote\(\)\{/);
    assert.match(FUNCS, /exports\.submitAgencyCustomQuote = onCall/);
  });
  test('the Website tab\'s own card renderer in vilu-unified.html is unchanged', () => {
    assert.match(PMS, /id="s-pkgs"/);
  });
  test('tax_currency_settings / reservation_documents rules untouched by this phase\'s diff region', () => {
    assert.match(RULES, /match \/tax_currency_settings/);
  });
}

console.log(`\n${passed}/${passed + failed} agency-booking-requests (structural) assertions passed`);
if (failed > 0) process.exitCode = 1;
