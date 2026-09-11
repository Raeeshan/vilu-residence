// Agency Sales Workflow — Phase D: exact availability search + privacy-safe
// agency calendar. 2026-09-11.
//
// Scope reminder: the Agency Portal must never read reservations/blocks
// directly for anyone else's booking again -- everything goes through the
// new getAgencyAvailability() Cloud Function, which reuses the exact same
// overlap math the rest of the PMS already uses (functions-core/lib/
// inventory.js's overlaps()) rather than inventing a second formula.
// Behavioral/privacy proof (Parts 29-31) is in
// test/agency-availability-rules.test.js, run against the real Firestore
// emulator + the actual Cloud Function. This file is the usual structural
// pass over source.
//   node test/agency-availability.test.js
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
const INVENTORY = read('functions-core/lib/inventory.js');

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

section('Case A — Part 1 audit: canonical sources reused, not reinvented');
{
  test('getAgencyAvailability() imports PHYSICAL_ROOMS/overlaps/isActiveStatus/dateRange from the SAME lib/inventory.js the rest of functions-core uses -- no new overlap formula', () => {
    assert.match(FUNCTIONS, /const \{ PHYSICAL_ROOMS, addDays, dateRange, isActiveStatus, overlaps \} = require\('\.\/lib\/inventory'\);/);
    const fnSrc = extractByStart(FUNCTIONS, /exports\.getAgencyAvailability = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/);
    assert.match(fnSrc, /PHYSICAL_ROOMS\.map/);
    assert.match(fnSrc, /overlaps\(r\.check_in, r\.check_out, startDate, endDate\)/);
    assert.match(fnSrc, /isActiveStatus\(r\.status\)/);
  });
  test('reads the exact same two sources the Admin Calendar\'s own fetchRoomIntervals() uses: room_availability/{roomId} and a per-room blocks query', () => {
    const fnSrc = extractByStart(FUNCTIONS, /exports\.getAgencyAvailability = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/);
    assert.match(fnSrc, /db\.collection\('room_availability'\)\.doc\(room\.id\)\.get\(\)/);
    assert.match(fnSrc, /db\.collection\('blocks'\)\.where\('room_id', '==', room\.id\)\.get\(\)/);
  });
  test('PHYSICAL_ROOMS room-to-category mapping is unchanged (VR01/VR02 Deluxe Family, VR03/04/05 Double, VR06 Deluxe Family Open Deck) -- Part 8: do not alter room mapping', () => {
    assert.match(INVENTORY, /\{ id: 'VR01', name: 'Room 101', type: 'Deluxe Family Room' \}/);
    assert.match(INVENTORY, /\{ id: 'VR06', name: 'Room 106', type: 'Deluxe Family Room with Open Deck' \}/);
    assert.match(PORTAL, /\{id:'VR01',name:'Room 101',type:'Deluxe Family Room'\}/);
    assert.match(PORTAL, /\{id:'VR06',name:'Room 106',type:'Deluxe Family Room with Open Deck'\}/);
  });
}

section('Case B — Part 2/3: no full reservation read access, redacted server-side endpoint');
{
  test('the portal never reads the raw `blocks` collection for anyone else\'s data anymore -- fetchLiveAvailability is the only availability-fetch path and it calls the Cloud Function, not fsDb.collection(\'blocks\')', () => {
    const src = extractByStart(PORTAL, /async function fetchLiveAvailability\(startDate, endDateExclusive\) \{/);
    assert.doesNotMatch(src, /collection\('blocks'\)/);
    assert.doesNotMatch(src, /collection\('reservations'\)/);
    assert.doesNotMatch(src, /collection\('room_availability'\)/);
    assert.match(src, /fsFunctions\.httpsCallable\('getAgencyAvailability'\)/);
  });
  test('getAgencyAvailability requires role==\'agency\' via the shared callerRole() helper (same pattern as submitAgencyCustomQuote)', () => {
    const src = extractByStart(FUNCTIONS, /exports\.getAgencyAvailability = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/);
    assert.match(src, /const \{ role \} = await callerRole\(request\);/);
    assert.match(src, /if \(role !== 'agency'\) throw new HttpsError\('permission-denied'/);
  });
}

section('Case C — Part 4/22: exact fields returned, no over-exposure');
{
  const fnSrc = extractByStart(FUNCTIONS, /exports\.getAgencyAvailability = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/);
  test('own-reservation enrichment includes ONLY guestName/arrivalDate/departureDate/adults/children/status/bookingReference', () => {
    const ownBlock = fnSrc.slice(fnSrc.indexOf('ownReservations[doc.id] = {'), fnSrc.indexOf('};', fnSrc.indexOf('ownReservations[doc.id] = {')));
    ['guestName', 'arrivalDate', 'departureDate', 'adults', 'children', 'status', 'bookingReference', 'reservationId'].forEach(f => {
      assert.match(ownBlock, new RegExp(f + ':'));
    });
  });
  test('a BLOCKED cell never includes a reason field -- structurally impossible, the days.push() call for blocks has no such key', () => {
    const blockPush = fnSrc.match(/days\.push\(\{ roomId: room\.id, date, state: 'BLOCKED' \}\);/);
    assert.ok(blockPush, 'expected the BLOCKED cell push to be exactly {roomId,date,state} with nothing else');
  });
  test('an OCCUPIED cell for a booking NOT owned by the caller never gets ownReservationId or any other field beyond roomId/date/state', () => {
    assert.match(fnSrc, /const cell = \{ roomId: room\.id, date, state: 'OCCUPIED' \};\s*\n\s*if \(ownReservations\[booking\.id\]\) cell\.ownReservationId = booking\.id;/);
  });
  test('no pricing data (room rate, package price, quote total, tax) is ever computed or returned -- availability is status only (Part 22)', () => {
    assert.doesNotMatch(fnSrc, /pricePerRoom|agencyPricePerRoom|rate:|price:|tax/i);
  });
  test('the response never includes source/OTA/agencyName/notes/folio/payment/document fields for ANY reservation', () => {
    assert.doesNotMatch(fnSrc, /\bsource\b|\bnotes\b|folio|payment|passport|document/i);
  });
}

section('Case D — Part 5: blocks privacy leak fixed for the agency side, public rule left as documented technical debt');
{
  test('firestore.rules\' blocks rule is UNCHANGED (allow read: if true) -- the public website has no auth session and depends on it', () => {
    assert.match(RULES, /match \/blocks\/\{id\} \{\s*\n\s*allow read: if true;\s*\n\s*allow write: if isAdmin\(\) \|\| isStaff\(\) \|\| isManagerRole\(\);\s*\n\s*\}/);
  });
  test('the Cloud Function itself documents WHY the rule is left alone (public website dependency) rather than silently leaving it unexplained', () => {
    const fnSrc = extractByStart(FUNCTIONS, /exports\.getAgencyAvailability = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/);
    const commentBlock = FUNCTIONS.slice(FUNCTIONS.indexOf('// ── getAgencyAvailability'), FUNCTIONS.indexOf('exports.getAgencyAvailability'));
    assert.match(commentBlock, /UNAUTHENTICATED public website/);
    assert.match(commentBlock, /stays as-is/);
  });
}

section('Case E — Part 6/7: Check Availability UI');
{
  const tabStart = PORTAL.indexOf('id="tab-availability"');
  const tabEnd = PORTAL.indexOf('<!-- MY BOOKINGS TAB', tabStart);
  const tabHTML = PORTAL.slice(tabStart, tabEnd);
  test('Check-in/Check-out/Adults/Children/Rooms-needed/Category fields all exist', () => {
    ['av-ci', 'av-co', 'av-adults', 'av-children', 'av-rooms', 'av-category'].forEach(id => {
      assert.match(tabHTML, new RegExp(`id="${id}"`));
    });
  });
  test('"Search Availability" button calls searchAvailability()', () => {
    assert.match(tabHTML, /onclick="searchAvailability\(\)"/);
  });
  test('searchAvailability() reports per-category available counts (Part 7\'s exact example shape: "N of M available")', () => {
    const src = extractByStart(PORTAL, /async function searchAvailability\(\)\s*\{/);
    assert.match(src, /c\.free\+' of '\+c\.total/);
  });
}

section('Case F — Part 9/10/11: Agency Calendar design, redaction, own-booking summary');
{
  test('the calendar renders AVAILABLE/OCCUPIED(other)/OCCUPIED(own)/BLOCKED as distinct visual states, matching the legend', () => {
    const src = extractByStart(PORTAL, /async function renderAgencyCalendarGrid\(\)\s*\{/);
    assert.match(src, /state === 'OCCUPIED'/);
    assert.match(src, /state === 'BLOCKED'/);
    assert.match(PORTAL, />Occupied \(other\)/);
  });
  test('a non-owned OCCUPIED cell shows only "Occupied" -- no guest name, source, or price -- and a BLOCKED cell shows only "Blocked", never a reason', () => {
    const src = extractByStart(PORTAL, /async function renderAgencyCalendarGrid\(\)\s*\{/);
    assert.match(src, /title = 'Occupied';/);
    assert.match(src, /title = 'Blocked';/);
    assert.doesNotMatch(src, /block\.reason/);
  });
  test('own-booking cells are clickable and open a read-only safe summary (Part 11) -- guest name, arrival, departure, nights, guests, status, reference only', () => {
    const src = extractByStart(PORTAL, /async function renderAgencyCalendarGrid\(\)\s*\{/);
    assert.match(src, /openOwnBookingSummary\(/);
    const summarySrc = extractByStart(PORTAL, /function openOwnBookingSummary\(reservationId\)\s*\{/);
    ['Guest', 'Arrival', 'Departure', 'Nights', 'Guests', 'Status', 'Booking reference'].forEach(label => {
      assert.match(summarySrc, new RegExp('<label>' + label));
    });
  });
  test('the own-booking modal has no edit/cancel/change controls (Part 24 -- read-only in Phase D) -- only closeOwnBookingSummary appears as an onclick target', () => {
    const modalStart = PORTAL.indexOf('id="m-own-booking"');
    const modalEnd = PORTAL.indexOf('<!-- Margin Ledger modal removed', modalStart);
    const modalHTML = PORTAL.slice(modalStart, modalEnd);
    const onclicks = [...modalHTML.matchAll(/onclick="([^"]*)"/g)].map(m => m[1]);
    assert.ok(onclicks.length > 0, 'expected at least one onclick in the modal');
    onclicks.forEach(oc => {
      assert.match(oc, /closeOwnBookingSummary/, `unexpected onclick in the read-only own-booking modal: ${oc}`);
    });
  });
}

section('Case G — Part 12/13: no fabricated pending states, bounded date range with fast-jump controls');
{
  test('no pending-hold/pending-request calendar state is fabricated -- only AVAILABLE/OCCUPIED/BLOCKED exist anywhere in the render logic', () => {
    const src = extractByStart(PORTAL, /async function renderAgencyCalendarGrid\(\)\s*\{/);
    assert.doesNotMatch(src, /PENDING/);
  });
  test('calGridSetDays(14)/calGridSetDays(30) and calGridToday() exist and are wired to the 14d/30d/Today buttons', () => {
    assert.match(PORTAL, /function calGridSetDays\(n\)\{/);
    assert.match(PORTAL, /function calGridToday\(\)\{/);
    assert.match(PORTAL, /onclick="calGridSetDays\(14\)"/);
    assert.match(PORTAL, /onclick="calGridSetDays\(30\)"/);
    assert.match(PORTAL, /onclick="calGridToday\(\)"/);
  });
}

section('Case H — Part 14: exact overlap semantics, half-open interval, no invented formula');
{
  test('getAgencyAvailability\'s per-day cell check and searchAvailability()\'s per-room-free check both use the half-open "date >= from && date < to" convention (withinRange helper / inline range loop), matching writeReservation/hasBlockConflict/isOcc everywhere else', () => {
    assert.match(FUNCTIONS, /function withinRange\(date, from, to\) \{\s*\n\s*return date >= from && date < to;/);
    const searchSrc = extractByStart(PORTAL, /async function searchAvailability\(\)\s*\{/);
    assert.match(searchSrc, /d < end/);
  });
  test('overlaps() in lib/inventory.js (the canonical formula reused server-side for reservation overlap) is untouched', () => {
    assert.match(INVENTORY, /function overlaps\(aStart, aEnd, bStart, bEnd\) \{\s*\n\s*return aStart < bEnd && aEnd > bStart;/);
  });
}

section('Case I — Part 25: performance/range bounding');
{
  test('getAgencyAvailability rejects a date range beyond AGENCY_AVAILABILITY_MAX_DAYS (90)', () => {
    assert.match(FUNCTIONS, /const AGENCY_AVAILABILITY_MAX_DAYS = 90;/);
    const src = extractByStart(FUNCTIONS, /exports\.getAgencyAvailability = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/);
    assert.match(src, /if \(spanDays > AGENCY_AVAILABILITY_MAX_DAYS\) \{/);
  });
  test('room fetches are a small fixed N (6 physical rooms), not an unbounded reservations/blocks scan -- Promise.all over PHYSICAL_ROOMS, not a full collection .get()', () => {
    const src = extractByStart(FUNCTIONS, /exports\.getAgencyAvailability = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/);
    assert.match(src, /Promise\.all\(PHYSICAL_ROOMS\.map\(/);
    assert.doesNotMatch(src, /db\.collection\('reservations'\)\.get\(\)/);
  });
}

section('Case J — Part 17: server authorization, agencyId never trusted from client');
{
  test('agencyId is ALWAYS request.auth.uid -- request.data is never used to determine whose reservations to enrich', () => {
    const src = extractByStart(FUNCTIONS, /exports\.getAgencyAvailability = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/);
    assert.match(src, /const agencyId = request\.auth\.uid;/);
    assert.doesNotMatch(src, /d\.agencyId/);
    assert.match(src, /\.where\('agencyId', '==', agencyId\)/);
  });
}

section('Case K — Part 20/21: quote/custom-package availability integration is read-only');
{
  test('checkAvailabilityForDates() never writes anywhere and is only called from an explicit button, not from any input\'s change/input handler', () => {
    const src = extractByStart(PORTAL, /async function checkAvailabilityForDates\(arrivalDate, departureDate, targetElId\)\s*\{/);
    assert.doesNotMatch(src, /\.set\(|\.update\(|\.add\(/);
    assert.match(PORTAL, /onclick="checkAvailabilityForDates\(document\.getElementById\('quote-arrival'\)/);
    assert.match(PORTAL, /onclick="checkAvailabilityForDates\(document\.getElementById\('cp-arrival'\)/);
  });
  test('neither Quote Builder nor Custom Package Builder\'s save/finalize functions were touched by this phase -- still exactly the Phase B/C write paths', () => {
    const saveSrc = extractByStart(PORTAL, /async function saveQuoteDraft\(\)\s*\{/);
    assert.match(saveSrc, /fsDb\.collection\('agency_quotes'\)\.doc\(_quoteWorking\.quoteId\)\.set\(_quoteWorking\)/);
    const customSrc = extractByStart(PORTAL, /async function submitCustomQuote\(status\)\s*\{/);
    assert.match(customSrc, /fsFunctions\.httpsCallable\('submitAgencyCustomQuote'\)/);
  });
}

section('Case L — Part 33: zero inventory writes anywhere in Phase D code');
{
  const phaseDFns = [
    extractByStart(FUNCTIONS, /exports\.getAgencyAvailability = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/),
    extractByStart(PORTAL, /async function fetchLiveAvailability\(startDate, endDateExclusive\) \{/),
    extractByStart(PORTAL, /async function renderAgencyCalendarGrid\(\)\s*\{/),
    extractByStart(PORTAL, /async function searchAvailability\(\)\s*\{/),
    extractByStart(PORTAL, /async function checkAvailabilityForDates\(arrivalDate, departureDate, targetElId\)\s*\{/),
    extractByStart(PORTAL, /function openOwnBookingSummary\(reservationId\)\s*\{/),
  ];
  test('none of these functions ever perform a Firestore write (collection/doc chained into .set/.update/.add/.delete) -- DOM-only calls like classList.add() are not Firestore writes and are expected', () => {
    phaseDFns.forEach(src => {
      assert.doesNotMatch(src, /(?:collection|doc)\([^)]*\)[^;]*\.(?:set|update|add|delete)\(/);
    });
  });
}

section('Case M — Part 28: existing calendar UX preserved, not rewritten wholesale');
{
  test('the calendar is still a <table> grid with rooms as rows and dates as columns, same legend color scheme (dcfce7 available / dbeafe own / fee2e2 occupied / fef3c7 blocked)', () => {
    const src = extractByStart(PORTAL, /async function renderAgencyCalendarGrid\(\)\s*\{/);
    assert.match(src, /#dcfce7/);
    assert.match(src, /#dbeafe/);
    assert.match(src, /#fee2e2/);
    assert.match(src, /#fef3c7/);
  });
  test('calGridShift/ROOMS_LIST/ymdStr/esc/fd helpers are unchanged in shape, still used by the new renderer', () => {
    assert.match(PORTAL, /function calGridShift\(dir\)\{/);
    assert.match(PORTAL, /function ymdStr\(d\)\{ return d\.toISOString\(\)\.slice\(0,10\); \}/);
  });
}

section('Case N — DO-NOT-TOUCH: booking creation flow, block approval workflow, reservation permissions, Website Packages');
{
  test('submitAgencyBooking() (the direct-create booking flow) and its own hasBlockConflict()/writeReservation-equivalent are untouched -- still exist, still create Confirmed reservations directly (Phase F territory)', () => {
    assert.match(PORTAL, /async function hasBlockConflict\(roomId, checkIn, checkOut\) \{/);
    assert.match(PORTAL, /status: 'Confirmed'/);
  });
  test('block_requests / approveBlockRequest / submitBlock still exist and are structurally unchanged apart from isRoomAvailable\'s data source fix', () => {
    assert.match(PMS, /async function approveBlockRequest\(id\)\s*\{/);
    assert.match(PORTAL, /window\.submitBlock=async function\(\)\{/);
  });
  test('reservations create rule unchanged as of this phase (Phase F later removed the direct agency-create branch entirely -- see agency-booking-requests-rules.test.js)', () => {
    const resBlock = RULES.slice(RULES.indexOf('match /reservations/{id} {'), RULES.indexOf('match /reservation_price_adjustments/'));
    assert.match(resBlock, /request\.auth == null && request\.resource\.data\.source == 'Website'/);
  });
  test('agency_quotes rules unchanged from Phase C (no rules changes needed this phase)', () => {
    const rulesBlock = RULES.slice(RULES.indexOf('match /agency_quotes/{quoteId}'), RULES.indexOf('match /room_prices/{roomId}'));
    assert.match(rulesBlock, /request\.resource\.data\.quoteType == 'ASSIGNED_PACKAGE'/);
  });
  test('the Website tab\'s own card renderer in vilu-unified.html is unchanged', () => {
    const src = extractByStart(PMS, /function renderPkgList\(\)\s*\{/);
    assert.match(src, /WEBSITE PACKAGES — redesigned compact cards/);
  });
}

console.log(`\n${passed}/${passed + failed} agency-availability (structural) assertions passed`);
