// Phase 49 — Agency Portal Hardening regression suite.
//
// Run: node test/agency-portal-hardening.test.js
//
// Static/source-level checks only — no live Firestore connection, no
// emulator, no destructive production data. Guards: agency data isolation
// (agencyId==auth.uid, own-email-only reads), no self-registration, no
// cross-agency package/pricing leakage, the shared writeReservation contract,
// ROOM_CONFLICT, the Phase 48 esc() stored-XSS fix (including the Phase 49
// block-request-note fix), no default/hardcoded credentials, no public
// reservation reads, and no hard-delete privilege for reservations.

const assert = require('node:assert/strict');
const fs = require('node:fs');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }
// Brace-counting extraction from a function's own start marker -- immune to
// CRLF/LF differences and exact whitespace, unlike slicing to a literal
// multi-newline string.
function extractFn(src, startMarker) {
  const i0 = src.indexOf(startMarker);
  if (i0 === -1) throw new Error('marker not found: ' + startMarker);
  let i = src.indexOf('{', i0) + 1, depth = 1;
  while (depth > 0 && i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return src.slice(i0, i);
}

const AGENCY = read('vilu-agency-portal.html');
const PMS = read('vilu-unified.html');
const RULES = read('firestore.rules');
const FUNCTIONS = fs.existsSync('functions-core/index.js') ? read('functions-core/index.js') : '';

section('Case A — agency data isolation is server-enforced, not client-filter-only');
{
  test('firestore.rules: reservations no longer grants an agency ANY direct read at all (Phase I, I-17) -- isolation now lives entirely server-side in getMyAgencyBookings()/getAgencyBookingConfirmationData(), which check agencyId==auth.uid themselves and return only a safe projection', () => {
    const line = RULES.split('\n').find(l => l.includes('isAgency() && resource.data.agencyId'));
    assert.equal(line, undefined, 'a direct agency read branch still exists in firestore.rules for reservations');
    assert.match(FUNCTIONS, /exports\.getMyAgencyBookings = onCall/);
    assert.match(FUNCTIONS, /const agencyId = request\.auth\.uid;/);
  });
  test('firestore.rules: reservations create for agencies was REMOVED entirely by Agency Sales Workflow Phase F -- confirmAgencyBookingRequest() (Admin SDK) is the only path from an agency\'s action to a real reservation now', () => {
    const line = RULES.split('\n').find(l => l.includes('isAgency() && request.resource.data.agencyId'));
    assert.equal(line, undefined, 'a direct agency reservations-create branch still exists in firestore.rules');
  });
  test('firestore.rules: reservations update is admin/staff only — agencies cannot update any reservation, including their own', () => {
    const m = RULES.match(/allow update: if request\.resource\.data\.room_id[\s\S]{0,400}?;/);
    assert.ok(m, 'update rule not found');
    assert.ok(!/isAgency/.test(m[0]), 'agency now appears in the reservations update rule — isolation model changed, verify intentionally');
  });
  test('reservations are scoped by agencyId==auth identity, not a client-filtered bulk fetch -- as of Agency Sales Workflow Phase D (2026-09-11) this scoped query moved OFF the client entirely, into functions-core/index.js\'s getAgencyAvailability Cloud Function (Admin SDK, scoped by request.auth.uid, never a client-supplied value) -- the client no longer queries reservations for anyone\'s data, own or otherwise; it only calls that callable. This is a strictly stronger form of the same isolation this test originally checked for, not a regression: see test/agency-availability-rules.test.js for the emulator-proven behavior.', () => {
    const clientQuery = /collection\('reservations'\)\.where\('agencyId','==',currentAgency\.uid\)/.test(AGENCY);
    const serverQuery = /db\.collection\('reservations'\)\.where\('agencyId', '==', agencyId\)/.test(FUNCTIONS) && /const agencyId = request\.auth\.uid;/.test(FUNCTIONS);
    assert.ok(clientQuery || serverQuery, 'agencyId-scoped reservations query not found on either the client or the new server-side callable');
  });
  test('firestore.rules: agency_packages read requires the caller\'s own email match (or admin) — no cross-agency package/pricing read', () => {
    const m = RULES.match(/match \/agency_packages\/\{email\} \{[\s\S]{0,300}?\}/);
    assert.ok(m, 'agency_packages rule block not found');
    assert.ok(/request\.auth\.token\.email\.lower\(\) == email/.test(m[0]), 'own-email-match isolation missing from agency_packages read rule');
  });
  test('vilu-agency-portal.html fetches packages only from its own agency_packages/{own email} doc', () => {
    assert.ok(/collection\('agency_packages'\)\.doc\(currentAgency\.email\.toLowerCase\(\)\)/.test(AGENCY), 'package fetch no longer scoped to the agency\'s own email');
  });
}

section('Case B — self-registration exists (2026-09-13) but grants NO immediate access; approval remains staff-controlled');
{
  // Superseded finding: this repo used to guarantee "no self-registration
  // exists at all". Agency Self-Registration + Admin/Manager Approval
  // (2026-09-13) deliberately adds a public signup path, so that guarantee
  // is now narrower and stronger instead: self-registration exists, but a
  // new signup can NEVER reach portal data without a server-side approval
  // step (see agency-self-registration-rules.test.js for the emulator
  // proof of the approval side of that boundary).
  test('createUserWithEmailAndPassword has exactly two REAL call sites: the legacy migration path and the new self-registration signup path -- both intentional, no unexpected third path (comment-line mentions, e.g. explaining the race-condition fix, are deliberately excluded so this stays a check on actual code, not prose)', () => {
    const realCallLines = AGENCY.split('\n').filter((line) => {
      if (!/createUserWithEmailAndPassword/.test(line)) return false;
      return !/^\s*\/\//.test(line); // exclude // comment lines
    });
    assert.equal(realCallLines.length, 2, 'expected exactly two real createUserWithEmailAndPassword call sites (migrateLegacyAgency + doAgencySignup) — a new one may indicate an unreviewed additional signup path. Found:\n' + realCallLines.join('\n'));
  });
  test('the new self-registration call site lives inside doAgencySignup(), which only ever creates the Auth account, sends verification, and submits an application -- it never itself writes users/ or grants agency role/portal access', () => {
    const fn = extractFn(AGENCY, 'async function doAgencySignup');
    assert.match(fn, /createUserWithEmailAndPassword/);
    assert.match(fn, /sendEmailVerification/);
    assert.match(fn, /submitAgencyApplication/);
    assert.ok(!/collection\('users'\)/.test(fn), 'doAgencySignup() writes users/ directly -- it must only ever reach agency role via the server-side approval callable');
    assert.ok(!/enterAgencyPortal/.test(fn), 'doAgencySignup() calls enterAgencyPortal() -- self-registration must never grant immediate access');
  });
  test('login screen has a subordinate "Apply for Agency Access" link, not an equal-prominence sign-up form on the primary card', () => {
    const i0 = AGENCY.indexOf('id="login-screen"');
    const loginScreenHtml = AGENCY.slice(i0, AGENCY.indexOf('id="forgot-card"', i0));
    assert.match(loginScreenHtml, /Apply for Agency Access/, 'self-registration entry point missing from the login screen');
    assert.match(loginScreenHtml, /Sign in/);
  });
  test('doAgencyLogin() grants portal access only for role==="agency" AND accountStatus!=="SUSPENDED" -- a suspended agency, even with the right role, is refused', () => {
    const fn = extractFn(AGENCY, 'async function doAgencyLogin');
    assert.match(fn, /profile\.role === 'agency'/);
    assert.match(fn, /accountStatus/, 'doAgencyLogin() does not check accountStatus at all -- a suspended agency would be let straight into the portal');
  });
  test('a signed-in user who is not an approved agency gets an accurate PENDING/REJECTED status screen via getMyAgencyApplicationStatus() before the generic "not set up" fallback -- never silently signed out', () => {
    const fn = extractFn(AGENCY, 'async function doAgencyLogin');
    assert.match(fn, /showStatusScreenIfApplicant/);
    assert.ok(!/firebase\.auth\(\)\.signOut\(\)/.test(fn), 'doAgencyLogin() signs the user out on a non-agency profile -- a pending/rejected applicant should stay signed in so a return visit shows the same accurate status');
  });
  test('getMyAgencyApplicationStatus() is called with no client-supplied identity -- the applicant\'s own uid is implicit in their auth session, never passed as data', () => {
    assert.match(AGENCY, /httpsCallable\('getMyAgencyApplicationStatus'\)\(\{\}\)/);
  });
  test('account revocation: deleteUser() removes the users/{email} profile doc without deleting the underlying Firebase Auth account (documented, intentional design)', () => {
    const fn = PMS.slice(PMS.indexOf('function deleteUser'), PMS.indexOf('function deleteUser') + 900);
    assert.ok(/admin/.test(fn) && /toast/.test(fn), 'deleteUser() structure changed — re-verify admin-only gating');
  });
}

section('Case C — no default/hardcoded credentials (Phase 47 fix must not regress)');
{
  test('no hardcoded/base64 default password fallback remains in the agency portal login path', () => {
    assert.ok(!/DEFAULTS/.test(AGENCY), 'a DEFAULTS credential table has reappeared in vilu-agency-portal.html');
  });
}

section('Case D — stored-XSS: guest- and agency-controlled fields stay escaped, including Phase 49\'s new finding');
{
  test('vilu-agency-portal.html defines esc()', () => {
    assert.ok(/function esc\(/.test(AGENCY), 'esc() helper missing from vilu-agency-portal.html');
  });
  test('the agency\'s own "My block requests" table escapes the agency-authored note field', () => {
    const fn = AGENCY.slice(AGENCY.indexOf("th>Note</th>") - 800, AGENCY.indexOf("th>Note</th>") + 400);
    assert.ok(/esc\(r\.note/.test(fn), 'agency-authored block-request note is rendered unescaped in the agency\'s own block-requests view');
  });
  test('the PMS staff-facing block-request approval panel escapes agencyName and note (Phase 49 fix — an agency-authored XSS payload must not execute in an admin session)', () => {
    const fn = PMS.slice(PMS.indexOf('async function drawBlockRequests'), PMS.indexOf('async function drawBlockRequests') + 1200);
    assert.ok(/esc\(r\.agencyName/.test(fn), 'drawBlockRequests() no longer escapes agencyName');
    assert.ok(/esc\(r\.note\)/.test(fn), 'drawBlockRequests() no longer escapes note — the exact Phase 49 stored-XSS finding has regressed');
  });
  test('agency-submitted guest fields (fn/ln/em/ph/nat/pid/notes) flow into the same reservations collection already covered by the Phase 48 esc() sweep — no second, unescaped rendering path exists for them', () => {
    assert.ok(/var fn=\(document\.getElementById\('bk-fn'\)/.test(AGENCY), 'agency booking form field wiring changed — re-verify it still shares the PMS reservation-detail render path');
  });
}

section('Case E — shared reservation-write contract (Phase 48) is unforked');
{
  test('vilu-agency-portal.html\'s writeReservation()/hasBlockConflict() still exist and still throw ROOM_CONFLICT', () => {
    const start = AGENCY.indexOf('async function writeReservation');
    const wr = AGENCY.slice(start, AGENCY.indexOf('\n}', start) + 2);
    assert.ok(/runTransaction/.test(wr), 'transaction removed from agency portal\'s writeReservation()');
    assert.ok(/ROOM_CONFLICT/.test(wr), 'ROOM_CONFLICT throw removed');
    assert.ok(/\{\s*merge:\s*true\s*\}/.test(wr), 'merge:true removed');
  });
  test('group/block requests never create a real block directly — they submit a pending block_requests doc for staff approval', () => {
    const start = AGENCY.indexOf('window.submitBlock=async function');
    const fn = AGENCY.slice(start, AGENCY.indexOf('\n};', start) + 3);
    assert.ok(/status:'pending'/.test(fn), 'submitBlock() no longer creates a pending (staff-approved) request — may now bypass approval');
    assert.ok(/collection\('block_requests'\)/.test(fn), 'submitBlock() no longer writes to block_requests');
    assert.ok(!/collection\('blocks'\)\.doc[^\n]*\.set/.test(fn), 'submitBlock() appears to write directly to the real blocks collection, bypassing staff approval');
  });
}

section('Case F — reservations cannot be hard-deleted by anyone, including agencies');
{
  test('firestore.rules: reservations delete is unconditionally denied', () => {
    assert.ok(/match \/reservations\/\{id\} \{[\s\S]*?allow delete: if false;/.test(RULES), 'reservation hard-delete is no longer unconditionally denied');
  });
}

section('Case G — public cannot read reservations or agency package/pricing data');
{
  test('firestore.rules: reservations read requires admin/staff/manager — never public, never an unauthenticated branch (Phase I, I-17, later removed the matching-agency branch too -- see agency-security-rules.test.js)', () => {
    const m = RULES.match(/match \/reservations\/\{id\} \{[\s\S]*?allow read: if ([^;]+);/);
    assert.ok(m, 'reservations read rule not found');
    assert.ok(!/request\.auth == null/.test(m[1]), 'reservations read rule now permits an unauthenticated branch');
  });
  test('firestore.rules: agency_packages has no public-read branch', () => {
    const m = RULES.match(/match \/agency_packages\/\{email\} \{\s*allow read: if ([^;]+);/);
    assert.ok(m, 'agency_packages read rule not found');
    assert.ok(/request\.auth != null/.test(m[1]), 'agency_packages read rule no longer requires authentication');
  });
}

section('Summary');
console.log(`\n${passed}/${passed + failed} agency-portal-hardening assertions passed`);
if (failed > 0) process.exitCode = 1;
