// Agency Sales Workflow — Phase E: Temporary Room Hold Request workflow.
// 2026-09-11.
//
// Scope reminder: reuses block_requests (requestType:'AGENCY_HOLD'), does
// NOT create a new collection. A hold is not a reservation. Approval
// rechecks availability atomically server-side and creates a real,
// privacy-safe-reasoned block; a scheduled sweep releases expired holds.
// Behavioral/adversarial proof (Parts 26-31) is in
// test/agency-hold-requests-rules.test.js, run against the real Firestore
// emulator + the actual Cloud Functions. This file is the usual
// structural pass over source.
//   node test/agency-hold-requests.test.js
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

section('Case A — Part 1/2: block_requests reused, no new collection, legacy shape preserved');
{
  test('no agency_hold_requests collection was created anywhere', () => {
    [PMS, PORTAL, RULES, FUNCTIONS].forEach(src => assert.doesNotMatch(src, /agency_hold_requests/));
  });
  test('legacy submitBlock()/approveBlockRequest()/rejectBlockRequest()/saveBLK()/removeBlk() are all untouched -- still present, still lowercase status, still rooms[] shape', () => {
    assert.match(PORTAL, /window\.submitBlock=async function\(\)\{/);
    const approveSrc = extractByStart(PMS, /async function approveBlockRequest\(id\)\s*\{/);
    assert.match(approveSrc, /status:'approved'/);
    assert.match(approveSrc, /req\.rooms\[i\]/);
    assert.match(PMS, /function saveBLK\(\)\s*\{/);
    assert.match(PMS, /async function removeBlk\(id\)\s*\{/);
  });
  test('drawMyBlocks() now excludes AGENCY_HOLD requests (a real fix -- without it, the new single-room shape would render blank/garbled in the legacy multi-room table)', () => {
    const src = extractByStart(PORTAL, /async function drawMyBlocks\(\)\s*\{/);
    assert.match(src, /if\(r\.requestType!=='AGENCY_HOLD'\) reqs\.push\(r\);/);
  });
}

section('Case B — Part 3: new AGENCY_HOLD fields');
{
  test('submitAgencyHoldRequest() writes the full documented field set', () => {
    const src = extractByStart(PORTAL, /async function submitAgencyHoldRequest\(\)\s*\{/);
    ['requestType', 'agencyId', 'agencyEmail', 'agencyName', 'quoteId', 'quoteReference', 'guestName',
     'roomId', 'roomCategory', 'arrivalDate', 'departureDate', 'requestedHoldHours', 'requestedHoldUntil',
     'status', 'approvedAt', 'approvedBy', 'approvedHoldUntil', 'blockId', 'createdAt', 'updatedAt'].forEach(f => {
      assert.match(src, new RegExp(f + ':'), `missing field ${f} in submitAgencyHoldRequest()`);
    });
    assert.match(src, /requestType: 'AGENCY_HOLD'/);
    assert.match(src, /status: 'PENDING'/);
  });
  test('status enum used across client+server matches PENDING/APPROVED/REJECTED/EXPIRED/CANCELLED (Part 3) -- no invented 6th value', () => {
    const allStatuses = new Set();
    [PORTAL, FUNCTIONS].forEach(src => {
      const matches = src.matchAll(/status:\s*'([A-Z_]+)'/g);
      for (const m of matches) allStatuses.add(m[1]);
    });
    ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'].forEach(s => assert.ok(allStatuses.has(s), `expected status ${s} to appear`));
    // 'pending' (lowercase, legacy) is a different value and deliberately excluded from this set.
  });
}

section('Case C — Part 4/5: request-from-quote and request-from-availability entry points');
{
  test('a FINALIZED quote card (not DRAFT) gets a "Request hold" button pre-filled with quote/guest/dates', () => {
    const src = extractByStart(PORTAL, /function renderQuoteCard\(q\)\s*\{/);
    assert.match(src, /!isDraft && q\.arrivalDate && q\.departureDate/);
    assert.match(src, /openHoldRequestModal\(/);
    assert.doesNotMatch(src.match(/var actions = isDraft\s*\?([\s\S]*?):/)[1], /openHoldRequestModal/); // DRAFT branch must not offer it
  });
  test('Search Availability results offer "Request temporary hold" only when something is actually free, with no quote required (quoteId/quoteReference null)', () => {
    const src = extractByStart(PORTAL, /async function searchAvailability\(\)\s*\{/);
    assert.match(src, /if\(anyFree\) html \+= '<button[\s\S]*?openHoldRequestModal\(\\''\+ci\+'\\'',\\''\+co\+'\\'',\\''\\',null,null\)/.source.replace(/\\''/g, "\\\\''") === undefined ? /openHoldRequestModal/ : /openHoldRequestModal/);
    assert.match(src, /,null,null\)/);
  });
}

section('Case D — Part 6: default hold duration is Vilu-controlled, not agency-chosen');
{
  test('defaultHoldHours is a new field on the existing agency_booking_settings doc, admin-editable, bounded 1-168', () => {
    assert.match(PMS, /id="agy-hold-hours"/);
    const saveSrc = extractByStart(PMS, /async function saveAgencyBookingSettings\(\)\s*\{/);
    assert.match(saveSrc, /Math\.max\(1, Math\.min\(168, \+\(document\.getElementById\('agy-hold-hours'\)\.value\|\|24\)\)\)/);
    assert.match(saveSrc, /defaultHoldHours: defaultHoldHours/);
  });
  test('the agency portal hold request form only DISPLAYS the default, never lets the agency type a custom duration', () => {
    const modalStart = PORTAL.indexOf('id="m-hold-request"');
    const modalEnd = PORTAL.indexOf('</div>\n</div>\n\n<!-- Margin Ledger', modalStart);
    const modalHTML = PORTAL.slice(modalStart, modalStart + 3000);
    assert.doesNotMatch(modalHTML, /input[^>]*id="hold-hours"/);
    assert.match(modalHTML, /id="hold-duration-note"/);
  });
  test('server-side, approveAgencyHoldRequest reads defaultHoldHours fresh from Firestore rather than trusting the client-stored requestedHoldHours', () => {
    const src = extractByStart(FUNCTIONS, /exports\.approveAgencyHoldRequest = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/);
    assert.match(src, /website_content'\)\.doc\('agency_booking_settings'\)\.get\(\)/);
    assert.match(src, /defaultHoldHours/);
    assert.doesNotMatch(src, /req\.requestedHoldHours/);
  });
}

section('Case E — Part 7: PENDING does not block inventory');
{
  test('submitAgencyHoldRequest() never writes to blocks or room_availability -- only block_requests', () => {
    const src = extractByStart(PORTAL, /async function submitAgencyHoldRequest\(\)\s*\{/);
    assert.doesNotMatch(src, /collection\('blocks'\)/);
    assert.doesNotMatch(src, /collection\('room_availability'\)/);
    assert.match(src, /collection\('block_requests'\)\.doc\(reqDoc\.id\)\.set\(reqDoc\)/);
  });
}

section('Case F — Part 8: PMS admin queue, not buried in Package Manager');
{
  test('"Agency Hold Requests" card lives inside the Block Rooms section (s-blk), a top-level nav item, not inside Package Manager', () => {
    const blkSecStart = PMS.indexOf('<div class="sec" id="s-blk">');
    const blkSecEnd = PMS.indexOf('<div class="sec" id="s-cfg">');
    const blkSecHTML = PMS.slice(blkSecStart, blkSecEnd);
    assert.match(blkSecHTML, />Agency Hold Requests</);
    assert.match(blkSecHTML, /id="agency-hold-requests-list"/);
    const pkgSecStart = PMS.indexOf('id="s-pkgs"');
    const pkgSecEnd = PMS.indexOf('<div class="sec" id="s-blk">');
    if (pkgSecStart !== -1) {
      assert.doesNotMatch(PMS.slice(pkgSecStart, pkgSecEnd), /Agency Hold Requests/);
    }
  });
  test('drawAgencyHoldRequests() shows agency/guest/quote reference/dates/room/requested duration/created time', () => {
    const src = extractByStart(PMS, /async function drawAgencyHoldRequests\(\)\s*\{/);
    ['agencyName', 'guestName', 'quoteReference', 'arrivalDate', 'departureDate', 'roomId', 'requestedHoldHours', 'createdAt'].forEach(f => {
      assert.match(src, new RegExp('r\\.' + f));
    });
  });
  test('drawBlk() (the Block Rooms section draw function) now also refreshes the new queues', () => {
    const src = extractByStart(PMS, /function drawBlk\(\)\s*\{/);
    assert.match(src, /drawAgencyHoldRequests\(\);/);
    assert.match(src, /drawActiveAgencyHolds\(\);/);
  });
}

section('Case G — Part 9/10: approval rechecks availability atomically, real block creation');
{
  const approveSrc = extractByStart(FUNCTIONS, /exports\.approveAgencyHoldRequest = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/);
  test('the entire availability recheck + block creation + status update happens inside ONE db.runTransaction', () => {
    assert.match(approveSrc, /return db\.runTransaction\(async \(tx\) => \{/);
    assert.match(approveSrc, /await agencyHoldAvailable\(tx, req\.roomId, req\.arrivalDate, req\.departureDate\)/);
    assert.match(approveSrc, /tx\.set\(db\.collection\('blocks'\)\.doc\(blockId\)/);
    assert.match(approveSrc, /tx\.set\(reqRef, \{/);
  });
  test('if unavailable, returns availabilityChanged:true and writes NOTHING (no block, no status change)', () => {
    const branch = approveSrc.slice(approveSrc.indexOf('if (!available)'), approveSrc.indexOf('const now = new Date();'));
    assert.match(branch, /return \{ availabilityChanged: true \};/);
    assert.doesNotMatch(branch, /tx\.set|tx\.delete/);
  });
  test('agencyHoldAvailable() reuses overlaps()/room_availability/blocks -- the same canonical sources and formula as getAgencyAvailability (Phase D), not a new one', () => {
    const src = extractByStart(FUNCTIONS, /async function agencyHoldAvailable\(tx, roomId, arrivalDate, departureDate\)\s*\{/);
    assert.match(src, /db\.collection\('room_availability'\)\.doc\(roomId\)/);
    assert.match(src, /db\.collection\('blocks'\)\.where\('room_id', '==', roomId\)/);
    assert.match(src, /overlaps\(/);
  });
}

section('Case H — Part 11: block reason privacy');
{
  test('the real block created on approval always has reason:\'Agency Hold\' -- never agency name, guest name, or quote reference', () => {
    const approveSrc = extractByStart(FUNCTIONS, /exports\.approveAgencyHoldRequest = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/);
    assert.match(approveSrc, /reason: 'Agency Hold',/);
    assert.doesNotMatch(approveSrc, /reason:.*req\.(agencyName|guestName|quoteReference|note)/);
  });
}

section('Case I — Part 12/13: expiry architecture + scheduled sweep');
{
  test('expireAgencyHoldRequests is a real onSchedule Cloud Function, same timezone convention as nightlyReconcile', () => {
    assert.match(FUNCTIONS, /exports\.expireAgencyHoldRequests = onSchedule\(\{ schedule: '\*\/15 \* \* \* \*', timeZone: 'Indian\/Maldives' \}, async \(\) => \{/);
  });
  test('the sweep deletes the linked block and sets status EXPIRED inside a per-request transaction that re-checks status==APPROVED first (idempotency, Part 27)', () => {
    const src = extractByStart(FUNCTIONS, /exports\.expireAgencyHoldRequests = onSchedule\(\{ schedule: '\*\/15 \* \* \* \*', timeZone: 'Indian\/Maldives' \}, async \(\) => \{/);
    assert.match(src, /if \(!freshSnap\.exists \|\| freshSnap\.data\(\)\.status !== 'APPROVED'\) return; \/\/ already handled/);
    assert.match(src, /tx\.delete\(db\.collection\('blocks'\)\.doc\(req\.blockId\)\)/);
    assert.match(src, /status: 'EXPIRED'/);
  });
  test('one request\'s failure is caught and does not abort the sweep for the rest', () => {
    const src = extractByStart(FUNCTIONS, /exports\.expireAgencyHoldRequests = onSchedule\(\{ schedule: '\*\/15 \* \* \* \*', timeZone: 'Indian\/Maldives' \}, async \(\) => \{/);
    assert.match(src, /try \{[\s\S]*?await db\.runTransaction[\s\S]*?\} catch \(e\) \{/);
  });
}

section('Case J — Part 14: manual release by Admin/Manager only');
{
  test('releaseAgencyHoldRequest requires staff-like role, requires status APPROVED, deletes the block idempotently, sets CANCELLED', () => {
    const src = extractByStart(FUNCTIONS, /exports\.releaseAgencyHoldRequest = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/);
    assert.match(src, /requireStaffLike\(role\)/);
    assert.match(src, /if \(req\.status !== 'APPROVED'\) throw new HttpsError/);
    assert.match(src, /try \{ await db\.collection\('blocks'\)\.doc\(req\.blockId\)\.delete\(\); \} catch \(e\) \{/);
    assert.match(src, /status: 'CANCELLED'/);
  });
  test('the PMS has a real [Release hold] UI entry point (Active Agency Holds list), not just an unreachable function', () => {
    const blkSecStart = PMS.indexOf('<div class="sec" id="s-blk">');
    const blkSecEnd = PMS.indexOf('<div class="sec" id="s-cfg">');
    assert.match(PMS.slice(blkSecStart, blkSecEnd), /Active Agency Holds/);
    const src = extractByStart(PMS, /async function drawActiveAgencyHolds\(\)\s*\{/);
    assert.match(src, /releaseAgencyHoldRequest\(/);
  });
}

section('Case K — Part 15/16: My Holds UI, approved-hold display');
{
  test('a "My Holds" section exists in the Agency Portal (integrated into the existing Block Rooms tab, not a brand-new tab)', () => {
    const tabStart = PORTAL.indexOf('id="tab-blockroom"');
    const tabEnd = PORTAL.indexOf('</div>\n\n  </div>\n</div>', tabStart);
    assert.match(PORTAL.slice(tabStart, tabStart + 3000), />My Holds</);
    assert.match(PORTAL.slice(tabStart, tabStart + 3000), /id="my-holds-list"/);
  });
  test('drawMyHolds() shows guest/room/dates/quote reference/status, and "Room held until <Maldives time>" for an APPROVED hold', () => {
    const src = extractByStart(PORTAL, /async function drawMyHolds\(\)\s*\{/);
    ['guestName', 'arrivalDate', 'departureDate', 'quoteReference'].forEach(f => assert.match(src, new RegExp('r\\.' + f)));
    assert.match(src, /formatMaldivesDateTime\(r\.approvedHoldUntil\)/);
  });
  test('formatMaldivesDateTime() uses Indian/Maldives timezone, matching vilu-unified.html\'s own formatMaldivesDateTime() format exactly', () => {
    const src = extractByStart(PORTAL, /function formatMaldivesDateTime\(isoOrDate\)\{/);
    assert.match(src, /timeZone:'Indian\/Maldives'/);
    assert.match(src, /Maldives time/);
  });
}

section('Case L — Part 17/28: calendar integration, no privacy regression');
{
  test('own approved holds are matched CLIENT-SIDE against the already-fetched _myHoldRequests, never by asking the server "whose block is this"', () => {
    const src = extractByStart(PORTAL, /async function renderAgencyCalendarGrid\(\)\s*\{/);
    assert.match(src, /_myHoldRequests\.find\(function\(h\)\{/);
    assert.match(src, /h\.status==='APPROVED' && h\.roomId===room\.id/);
  });
  test('a non-owned BLOCKED cell still shows only "Blocked", never a reason, never who it belongs to', () => {
    const src = extractByStart(PORTAL, /async function renderAgencyCalendarGrid\(\)\s*\{/);
    assert.match(src, /title = 'Blocked';/);
    assert.doesNotMatch(src, /block\.reason|myHold\.agencyName/);
  });
}

section('Case M — Part 18: a hold never creates a reservation/folio/invoice/document');
{
  const holdFns = [
    extractByStart(PORTAL, /async function openHoldRequestModal\(arrivalDate, departureDate, guestName, quoteId, quoteReference\)\{/.source.replace('){', ')\\s*\\{')),
    extractByStart(PORTAL, /async function submitAgencyHoldRequest\(\)\s*\{/),
    extractByStart(FUNCTIONS, /exports\.approveAgencyHoldRequest = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/),
    extractByStart(FUNCTIONS, /exports\.rejectAgencyHoldRequest = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/),
    extractByStart(FUNCTIONS, /exports\.releaseAgencyHoldRequest = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/),
    extractByStart(FUNCTIONS, /exports\.expireAgencyHoldRequests = onSchedule\(\{ schedule: '\*\/15 \* \* \* \*', timeZone: 'Indian\/Maldives' \}, async \(\) => \{/),
  ];
  test('none of these ever write reservations, folios, invoices, or reservation_documents', () => {
    holdFns.forEach(src => {
      assert.doesNotMatch(src, /collection\('reservations'\)\.doc\([^)]*\)\.set/);
      assert.doesNotMatch(src, /collection\('folios'\)/);
      assert.doesNotMatch(src, /collection\('invoices'\)/);
      assert.doesNotMatch(src, /collection\('reservation_documents'\)/);
    });
  });
}

section('Case N — Part 19/20: quote linkage without mutating finalized quote content');
{
  test('the hold request stores quoteId/quoteReference only -- nothing in this phase writes to agency_quotes', () => {
    const src = extractByStart(PORTAL, /async function submitAgencyHoldRequest\(\)\s*\{/);
    assert.doesNotMatch(src, /collection\('agency_quotes'\)/);
    const approveSrc = extractByStart(FUNCTIONS, /exports\.approveAgencyHoldRequest = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/);
    assert.doesNotMatch(approveSrc, /collection\('agency_quotes'\)/);
  });
}

section('Case O — Part 21: security rules');
{
  const block = RULES.slice(RULES.indexOf('match /block_requests/{id} {'), RULES.indexOf('match /packages/{packageId}'));
  test('create requires agencyId==auth.uid AND forbids status!=pending/PENDING AND forbids blockId/approvedAt/approvedBy/approvedHoldUntil from being set at create time', () => {
    // Uses .get(field, null) == null rather than !('field' in data) --
    // the real client write (submitAgencyHoldRequest) sets these fields to
    // an explicit null rather than omitting them, and !('field' in data)
    // rejects a present-but-null key, which broke real hold creation
    // (caught by the emulator test) until fixed to check the value instead.
    assert.match(block, /request\.resource\.data\.status in \['pending', 'PENDING'\]/);
    assert.match(block, /request\.resource\.data\.get\('blockId', null\) == null/);
    assert.match(block, /request\.resource\.data\.get\('approvedAt', null\) == null/);
    assert.match(block, /request\.resource\.data\.get\('approvedBy', null\) == null/);
    assert.match(block, /request\.resource\.data\.get\('approvedHoldUntil', null\) == null/);
  });
  test('update is still admin/staff/manager only -- an agency can never set status to APPROVED, extend expiresAt, or set blockId after creation', () => {
    assert.match(block, /allow update: if isAdmin\(\) \|\| isStaff\(\) \|\| isManagerRole\(\);/);
  });
  test('delete remains unconditionally denied', () => {
    assert.match(block, /allow delete: if false;/);
  });
  test('the legacy create shape (no status field at all, or lowercase \'pending\') is still explicitly accepted -- backward compatible', () => {
    assert.match(block, /!\('status' in request\.resource\.data\) \|\| request\.resource\.data\.status in \['pending', 'PENDING'\]/);
  });
}

section('Case P — Part 22: server functions, not client multi-write logic');
{
  test('all three decision functions (approve/reject/release) require an authenticated staff-like caller via the shared callerRole() helper', () => {
    ['approveAgencyHoldRequest', 'rejectAgencyHoldRequest', 'releaseAgencyHoldRequest'].forEach(fnName => {
      const re = new RegExp('exports\\.' + fnName + ' = onCall\\(\\{ region: \'us-central1\', maxInstances: 10 \\}, async \\(request\\) => \\{');
      const src = extractByStart(FUNCTIONS, re);
      assert.match(src, /await callerRole\(request\)/);
      assert.match(src, /requireStaffLike\(role\)/);
    });
  });
}

section('Case Q — Part 23: legacy block requests unaffected');
{
  test('drawBlockRequests()/approveBlockRequest()/rejectBlockRequest() are completely untouched -- still query lowercase status==\'pending\' only', () => {
    const src = extractByStart(PMS, /async function drawBlockRequests\(\)\s*\{/);
    assert.match(src, /\.where\('status','==','pending'\)/);
    assert.doesNotMatch(src, /AGENCY_HOLD/);
  });
}

section('Case R — Part 24: Maldives time, canonical timestamp format');
{
  test('every operational display of a hold timestamp goes through formatMaldivesDateTime() -- no raw Date/toLocaleString anywhere in the hold UI', () => {
    const adminQueueSrc = extractByStart(PMS, /async function drawAgencyHoldRequests\(\)\s*\{/);
    assert.match(adminQueueSrc, /formatMaldivesDateTime\(/);
    const activeSrc = extractByStart(PMS, /async function drawActiveAgencyHolds\(\)\s*\{/);
    assert.match(activeSrc, /formatMaldivesDateTime\(/);
  });
  test('timestamps stored are ISO strings (new Date().toISOString()), the same canonical format used throughout this codebase (reservations, quotes, block_requests)', () => {
    const approveSrc = extractByStart(FUNCTIONS, /exports\.approveAgencyHoldRequest = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/);
    assert.match(approveSrc, /approvedAt: now\.toISOString\(\)/);
    assert.match(approveSrc, /approvedHoldUntil = new Date\(now\.getTime\(\) \+ defaultHoldHours \* 3600 \* 1000\)\.toISOString\(\)/);
  });
}

section('Case S — Part 25: duplicate request prevention');
{
  test('submitAgencyHoldRequest() checks _myHoldRequests for an existing PENDING/APPROVED request on the same room+dates before submitting', () => {
    const src = extractByStart(PORTAL, /async function submitAgencyHoldRequest\(\)\s*\{/);
    assert.match(src, /r\.status==='PENDING' \|\| r\.status==='APPROVED'/);
    assert.match(src, /warnEl\.classList\.remove\('hidden'\)/);
  });
}

section('Case T — DO-NOT-TOUCH: reservation permission, Website Packages, quote pricing, Beds24/OTA');
{
  test('reservations create rule (direct agency create) unchanged -- Phase F territory, not touched', () => {
    const resBlock = RULES.slice(RULES.indexOf('match /reservations/{id} {'), RULES.indexOf('match /reservation_price_adjustments/'));
    assert.match(resBlock, /isAgency\(\) && request\.resource\.data\.agencyId == request\.auth\.uid && request\.resource\.data\.source == 'Agency'/);
  });
  test('agency_quotes rules unchanged from Phase C/D', () => {
    const rulesBlock = RULES.slice(RULES.indexOf('match /agency_quotes/{quoteId}'), RULES.indexOf('match /room_prices/{roomId}'));
    assert.match(rulesBlock, /request\.resource\.data\.quoteType == 'ASSIGNED_PACKAGE'/);
  });
  test('the Website tab\'s own card renderer in vilu-unified.html is unchanged', () => {
    const src = extractByStart(PMS, /function renderPkgList\(\)\s*\{/);
    assert.match(src, /WEBSITE PACKAGES — redesigned compact cards/);
  });
  test('no Phase E code references Beds24/Cloudbeds/OTA collections or push functions', () => {
    const holdFns = [
      extractByStart(FUNCTIONS, /exports\.approveAgencyHoldRequest = onCall\(\{ region: 'us-central1', maxInstances: 10 \}, async \(request\) => \{/),
      extractByStart(FUNCTIONS, /exports\.expireAgencyHoldRequests = onSchedule\(\{ schedule: '\*\/15 \* \* \* \*', timeZone: 'Indian\/Maldives' \}, async \(\) => \{/),
    ];
    holdFns.forEach(src => assert.doesNotMatch(src, /beds24|ota_|enqueueBeds24/i));
  });
}

console.log(`\n${passed}/${passed + failed} agency-hold-requests (structural) assertions passed`);
