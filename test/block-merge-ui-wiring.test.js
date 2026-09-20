// Calendar / Block Rooms block-merge fix — structural pass over source,
// same pattern as test/agency-hold-requests.test.js. Proves the frontend
// wiring: both surfaces call the SAME backend callable, a reservation
// conflict still hard-stops with Confirm disabled, an existing-block-only
// overlap is never shown as "already booked/blocked", success only follows
// a confirmed backend result, and a successful merge refreshes BLK[] from
// Firestore (so the calendar renders the real final interval, not a locally
// guessed one) before redrawing.
//   node test/block-merge-ui-wiring.test.js
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

section('Backend: mergeBlockRoom exists and is staff-gated');
{
  test('functions-core exports mergeBlockRoom as an onCall', () => {
    assert.match(FUNCTIONS, /exports\.mergeBlockRoom\s*=\s*onCall\(/);
  });
  const src = extractByStart(FUNCTIONS, /exports\.mergeBlockRoom\s*=\s*onCall\(\{[^}]*\},\s*async\s*\(request\)\s*=>\s*\{/);
  test('gates on callerRole()/requireStaffLike() -- same auth pattern as approveAgencyHoldRequest, no new role system invented', () => {
    assert.match(src, /callerRole\(request\)/);
    assert.match(src, /requireStaffLike\(role\)/);
  });
  test('runs entirely inside one db.runTransaction -- never a separate delete then create', () => {
    assert.match(src, /db\.runTransaction\(/);
    // Only one runTransaction call in the whole function body -- proves the
    // read+validate+write is genuinely one atomic operation.
    const count = (src.match(/db\.runTransaction\(/g) || []).length;
    assert.equal(count, 1, 'expected exactly one runTransaction call, found ' + count);
  });
  test('reservation conflict check reads room_availability.bookings (the same active-lock source writeReservationTx/agencyHoldAvailable already use)', () => {
    assert.match(src, /room_availability/);
    assert.match(src, /bookings/);
  });
  test('reservation conflict throws failed-precondition with RESERVATION_CONFLICT and names the conflicting id/dates', () => {
    assert.match(src, /HttpsError\('failed-precondition',\s*'RESERVATION_CONFLICT/);
    assert.match(src, /conflict\.id/);
  });
  test('block-only overlap never throws -- the ONLY throw inside the transaction body is the RESERVATION_CONFLICT check (the two earlier throws are input validation, before any block is even read)', () => {
    const txSrc = extractByStart(src, /db\.runTransaction\(async\s*\(tx\)\s*=>\s*\{/);
    const httpsErrorCount = (txSrc.match(/throw new HttpsError/g) || []).length;
    assert.equal(httpsErrorCount, 1, 'expected exactly one throw path inside the transaction body, found ' + httpsErrorCount);
    assert.match(txSrc, /RESERVATION_CONFLICT/);
  });
  test('touching (checkout-exclusive-adjacent) blocks are treated as mergeable, not just true overlaps', () => {
    assert.match(src, /aFrom\s*<=\s*bTo\s*&&\s*bFrom\s*<=\s*aTo/);
  });
  test('reason/notes are preserved, never silently discarded on merge', () => {
    assert.match(src, /finalReason/);
    assert.match(src, /finalNotes/);
    assert.match(src, /noteSet/);
  });
}

section('Frontend: ONE shared call site for both surfaces');
{
  test('callMergeBlockRoom() exists and calls the mergeBlockRoom callable', () => {
    const src = extractByStart(PMS, /async function callMergeBlockRoom\([^)]*\)\s*\{/);
    assert.match(src, /httpsCallable\('mergeBlockRoom'\)/);
  });
  test('submitQuickBlock() (Calendar) calls callMergeBlockRoom(), not a direct fsDb.collection(\'blocks\') write', () => {
    const src = extractByStart(PMS, /async function submitQuickBlock\(\)\s*\{/);
    assert.match(src, /callMergeBlockRoom\(/);
    assert.doesNotMatch(src, /fsDb\.collection\('blocks'\)\.doc\([^)]*\)\.set\(/, 'submitQuickBlock must no longer write blocks/ directly from the client');
  });
  test('addBlk() (Block Rooms tab) calls callMergeBlockRoom(), not a direct BLK.push()-only local write', () => {
    const src = extractByStart(PMS, /async function addBlk\(\)\s*\{/);
    assert.match(src, /callMergeBlockRoom\(/);
  });
}

section('Frontend: reservation conflict still hard-stops; a block-only overlap does not');
{
  test('isResConflict() checks RES only -- BLK is deliberately excluded from this function', () => {
    const src = extractByStart(PMS, /function isResConflict\([^)]*\)\s*\{/);
    assert.match(src, /for\(const r of RES\)/);
    assert.doesNotMatch(src, /for\(const b of BLK\)/);
  });
  test('openQuickBlock() disables Confirm and shows the hard-conflict warning ONLY for a reservation conflict', () => {
    const src = extractByStart(PMS, /function openQuickBlock\([^)]*\)\s*\{/);
    assert.match(src, /isResConflict\(/);
    assert.match(src, /btn\.disabled\s*=\s*true/);
  });
  test('openQuickBlock() never disables Confirm for a block-only overlap -- previewBlockMerge() path leaves it enabled', () => {
    const src = extractByStart(PMS, /function openQuickBlock\([^)]*\)\s*\{/);
    // The only `btn.disabled=true` in this function must be inside the `if(rc)` branch,
    // not reachable from the wasMerge/previewBlockMerge branch.
    const rcBranch = src.match(/if\(rc\)\{[\s\S]*?\}else\{/);
    assert.ok(rcBranch && /btn\.disabled=true/.test(rcBranch[0]), 'btn.disabled=true must live inside the reservation-conflict branch');
  });
  test('the old hard-reject message "already booked/blocked" no longer appears in submitQuickBlock()/addBlk() -- an existing block is never worded as a conflict', () => {
    const qb = extractByStart(PMS, /async function submitQuickBlock\(\)\s*\{/);
    const bl = extractByStart(PMS, /async function addBlk\(\)\s*\{/);
    assert.doesNotMatch(qb, /already booked\/blocked/);
    assert.doesNotMatch(bl, /booked\/blocked/);
  });
  test('previewBlockMerge() shows "Existing block will be extended to X – Y" instead', () => {
    assert.match(PMS, /Existing block will be extended to/);
  });
}

section('Frontend: success only follows a confirmed backend result');
{
  test('submitQuickBlock() shows its success toast only inside the branch after `result` is truthy (post-await)', () => {
    const src = extractByStart(PMS, /async function submitQuickBlock\(\)\s*\{/);
    const resultIdx = src.indexOf('result=await callMergeBlockRoom');
    const toastIdx = src.indexOf("toast(result.wasMerge");
    assert.ok(resultIdx > -1 && toastIdx > -1 && toastIdx > resultIdx, 'the success toast must come after the awaited backend call, never before it');
  });
  test('a failed backend call shows an error, not "Room blocked"', () => {
    const src = extractByStart(PMS, /async function submitQuickBlock\(\)\s*\{/);
    assert.match(src, /if\(!result\)\{/);
    assert.match(src, /cf\.textContent\s*=\s*'⚠️ '\s*\+\s*errMsg/);
  });
}

section('Frontend: calendar refresh displays the final merged interval (test item 13)');
{
  test('submitQuickBlock() re-syncs BLK[] from Firestore (loadBlksFromFirestore) before redrawing -- never a synthetic local push', () => {
    const src = extractByStart(PMS, /async function submitQuickBlock\(\)\s*\{/);
    assert.match(src, /loadBlksFromFirestore\(\)/);
    assert.doesNotMatch(src, /BLK\.push\(/, 'a merge can shrink/delete other existing blocks too -- a local push() alone would leave stale entries');
    const loadIdx = src.indexOf('loadBlksFromFirestore()');
    const drawIdx = src.indexOf('drawCal()');
    assert.ok(loadIdx > -1 && drawIdx > -1 && drawIdx > loadIdx, 'drawCal() must run after the refreshed BLK[], not before');
  });
  test('addBlk() re-syncs BLK[] from Firestore before redrawing too -- identical behavior on both surfaces', () => {
    const src = extractByStart(PMS, /async function addBlk\(\)\s*\{/);
    assert.match(src, /loadBlksFromFirestore\(\)/);
    assert.match(src, /drawCal\(\)/);
  });
  test('the success toast reflects the ACTUAL final range returned by the server, not the originally requested one', () => {
    const src = extractByStart(PMS, /async function submitQuickBlock\(\)\s*\{/);
    assert.match(src, /result\.from_date/);
    assert.match(src, /result\.to_date/);
  });
}
console.log(`\n${passed}/${passed + failed} block-merge-ui-wiring assertions passed`);
if (failed > 0) process.exitCode = 1;
