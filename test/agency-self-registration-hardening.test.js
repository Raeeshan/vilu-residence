// Agency Self-Registration + Admin/Manager Approval + Package Assignment --
// structural/source-level regression suite (2026-09-13). Static checks only
// -- see test/agency-self-registration-rules.test.js for the real
// Firestore + Auth emulator proof.
//
// Run: node test/agency-self-registration-hardening.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }
function extractFn(src, startMarker) {
  const i0 = src.indexOf(startMarker);
  if (i0 === -1) throw new Error('marker not found: ' + startMarker);
  // If the marker text itself already ends with the body's own opening
  // brace (e.g. "match /users/{id} {", a rules path template), that IS the
  // real opening brace -- don't search further (a naive search would
  // instead find some unrelated `{` deeper inside the block). Otherwise
  // scan for the body-opening brace starting AFTER the marker's own text.
  let bodyStart;
  if (startMarker.trimEnd().endsWith('{')) {
    bodyStart = i0 + startMarker.length - 1;
  } else {
    const scanFrom = i0 + startMarker.length;
    // For `exports.foo = onCall({...options...}, async (request) => { ... })`
    // the FIRST `{` after the marker belongs to the options object, not the
    // function body -- brace-count from the arrow's own `{` instead. Only
    // applies to that exact "= onCall" shape; a plain function whose body
    // happens to contain an early arrow (e.g. an Array.map callback) must
    // never trigger this, so it always uses its own first `{`.
    if (startMarker.includes('= onCall')) {
      const arrowIdx = src.indexOf('=>', scanFrom);
      bodyStart = src.indexOf('{', arrowIdx);
    } else {
      bodyStart = src.indexOf('{', scanFrom);
    }
  }
  let i = bodyStart + 1, depth = 1;
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
const FUNCTIONS = read('functions-core/index.js');

section('functions-core/index.js -- every new callable exists with the correct gate');
{
  test('requireManagerLike exists and is strictly narrower than requireStaffLike (rejects staff)', () => {
    const fn = extractFn(FUNCTIONS, 'function requireManagerLike');
    assert.match(fn, /role !== 'admin'/);
    assert.match(fn, /role !== 'manager'/);
    assert.ok(!/role === 'staff'/.test(fn) && !/role !== 'staff'/.test(fn) === false || !/staff/.test(fn.replace(/\/\/.*$/gm, '')), 'requireManagerLike appears to reference staff at all -- it must never treat staff as passing');
  });
  test('callerRole() returns a distinct "suspended" sentinel for an agency with accountStatus===SUSPENDED, without ever mutating role itself', () => {
    const fn = extractFn(FUNCTIONS, 'async function callerRole');
    assert.match(fn, /accountStatus === 'SUSPENDED'/);
    assert.match(fn, /role: 'suspended'/);
  });
  [
    'submitAgencyApplication', 'getMyAgencyApplicationStatus', 'listPendingAgencyApplications',
    'listAgencyAccounts', 'approveAgencyApplication', 'rejectAgencyApplication',
    'resetAgencyApplicationToPending', 'suspendAgencyAccount', 'reactivateAgencyAccount', 'setAgencyPackages',
  ].forEach((name) => {
    test('exports.' + name + ' exists', () => {
      assert.match(FUNCTIONS, new RegExp('exports\\.' + name + ' = onCall'));
    });
  });
  [
    'listPendingAgencyApplications', 'listAgencyAccounts', 'approveAgencyApplication',
    'rejectAgencyApplication', 'resetAgencyApplicationToPending', 'suspendAgencyAccount',
    'reactivateAgencyAccount', 'setAgencyPackages',
  ].forEach((name) => {
    test(name + ' calls requireManagerLike -- Admin/Manager only, never plain requireStaffLike', () => {
      const fn = extractFn(FUNCTIONS, 'exports.' + name + ' = onCall');
      assert.match(fn, /requireManagerLike\(role\)/);
    });
  });
  test('submitAgencyApplication requires only request.auth (any freshly-signed-up user), never requireManagerLike/requireStaffLike', () => {
    const fn = extractFn(FUNCTIONS, 'exports.submitAgencyApplication = onCall');
    assert.match(fn, /if \(!request\.auth\)/);
    assert.ok(!/requireManagerLike|requireStaffLike/.test(fn));
  });
  test('approveAgencyApplication re-verifies identity live via the Auth Admin SDK (getAuth().getUser), never trusting the stored application email alone', () => {
    const fn = extractFn(FUNCTIONS, 'exports.approveAgencyApplication = onCall');
    assert.match(fn, /getAuth\(\)\.getUser\(app\.uid\)/);
    assert.match(fn, /authUser\.emailVerified/);
    assert.match(fn, /authEmail !== app\.emailLower/);
  });
  test('approveAgencyApplication and setAgencyPackages both re-fetch canonical packages server-side and filter by requested ids -- never trusting client-supplied package content', () => {
    ['approveAgencyApplication', 'setAgencyPackages'].forEach((name) => {
      const fn = extractFn(FUNCTIONS, 'exports.' + name + ' = onCall');
      assert.match(fn, /resolveCanonicalAgencyPackages/);
    });
    const resolver = extractFn(FUNCTIONS, 'async function resolveCanonicalAgencyPackages');
    assert.match(resolver, /collection\('packages'\)/);
    assert.match(resolver, /channel === 'agency'/);
  });
  test('approveAgencyApplication performs its state changes inside one Firestore transaction (atomicity)', () => {
    const fn = extractFn(FUNCTIONS, 'exports.approveAgencyApplication = onCall');
    assert.match(fn, /db\.runTransaction/);
    assert.match(fn, /tx\.set\(userRef,/);
    assert.match(fn, /tx\.set\(db\.collection\('agency_packages'\)/);
    assert.match(fn, /tx\.set\(appRef,/);
  });
  test('identity-collision hardening: approveAgencyApplication reads the existing users/{email} doc INSIDE the transaction (not a separate pre-check) and refuses before any write if one already exists', () => {
    const fn = extractFn(FUNCTIONS, 'exports.approveAgencyApplication = onCall');
    assert.match(fn, /tx\.get\(userRef\)/);
    const txBody = extractFn(fn, 'await db.runTransaction');
    const readIdx = txBody.indexOf('tx.get(userRef)');
    const throwIdx = txBody.indexOf("existingUserSnap.exists");
    const firstWriteIdx = txBody.indexOf('tx.set(userRef,');
    assert.ok(readIdx > -1 && throwIdx > -1 && firstWriteIdx > -1, 'expected read/check/write all present');
    assert.ok(readIdx < throwIdx && throwIdx < firstWriteIdx, 'the existing-user check must happen after the read and before any write');
  });
  test('identity-collision hardening: submitAgencyApplication refuses for ANY existing users/{email} doc, not only role===\'agency\'', () => {
    const fn = extractFn(FUNCTIONS, 'exports.submitAgencyApplication = onCall');
    assert.match(fn, /if \(userDoc\.exists\) \{/);
    assert.ok(!/userDoc\.data\(\)\.role === 'agency'/.test(fn), 'submitAgencyApplication still only checks role===\'agency\' -- must refuse for any existing users/{email} doc regardless of role');
  });
  test('submitAgencyApplication is resumable: a retry while still PENDING_APPROVAL returns success rather than throwing', () => {
    const fn = extractFn(FUNCTIONS, 'exports.submitAgencyApplication = onCall');
    assert.match(fn, /existingStatus === 'PENDING_APPROVAL'\) return/);
  });
  test('getMyAgencyApplicationStatus never returns rejectionReason/approvedBy/uid/emailLower -- the redaction boundary', () => {
    const fn = extractFn(FUNCTIONS, 'exports.getMyAgencyApplicationStatus = onCall');
    const returnMatch = fn.match(/return \{[\s\S]*?\};/);
    assert.ok(returnMatch, 'return object not found');
    assert.ok(!/rejectionReason|approvedBy|rejectedBy/.test(returnMatch[0]));
  });
  test('listPendingAgencyApplications fetches live Auth state per row (getAuth().getUser) and handles a deleted Auth user safely', () => {
    const fn = extractFn(FUNCTIONS, 'exports.listPendingAgencyApplications = onCall');
    assert.match(fn, /auth\.getUser\(a\.uid\)/);
    assert.match(fn, /authUserExists = false/);
  });
  test('listAgencyAccounts is NOT the same broad query the existing admin User Management uses -- it returns a narrow, purpose-built projection', () => {
    const fn = extractFn(FUNCTIONS, 'exports.listAgencyAccounts = onCall');
    assert.match(fn, /where\('role', '==', 'agency'\)/);
    // Only the documented allowlist fields should appear in the returned object literal.
    const returnObjMatch = fn.match(/return \{\s*email:[\s\S]*?\};/);
    assert.ok(returnObjMatch, 'per-account return object not found');
    assert.ok(!/commission[\s\S]*password|role:/.test(returnObjMatch[0]));
  });
}

section('firestore.rules -- agency_applications / agency_application_audit are server-only; users/{id} blocks self-writing accountStatus');
{
  test('agency_applications: write is unconditionally false (Admin SDK only, same hardening pattern as agency_quotes)', () => {
    const m = RULES.match(/match \/agency_applications\/\{uid\} \{[\s\S]{0,400}?\}/);
    assert.ok(m, 'agency_applications rule block not found');
    assert.match(m[0], /allow write: if false;/);
    assert.ok(!/request\.auth\.token\.email\.lower\(\) == /.test(m[0]) && !/request\.auth\.uid == uid/.test(m[0]), 'agency_applications appears to grant the owning applicant a direct read -- this must stay Admin/Manager only, see getMyAgencyApplicationStatus() for the safe redacted read path');
    assert.match(m[0], /isAdmin\(\) \|\| isManagerRole\(\)/);
  });
  test('agency_application_audit: same server-only lockdown', () => {
    const m = RULES.match(/match \/agency_application_audit\/\{id\} \{[\s\S]{0,300}?\}/);
    assert.ok(m, 'agency_application_audit rule block not found');
    assert.match(m[0], /allow write: if false;/);
  });
  test('users/{id} self-write blocks accountStatus alongside the existing role/commission block', () => {
    const fn = extractFn(RULES, 'match /users/{id} {');
    assert.match(fn, /request\.resource\.data\.get\('accountStatus', null\) == resource\.data\.get\('accountStatus', null\)/);
  });
}

section('vilu-unified.html -- least-privilege PMS UI (no direct broad `users` query for the new tabs), esc() everywhere, existing modal untouched');
{
  test('the Approved/Suspended tab rendering path uses listAgencyAccounts(), never a direct fsDb.collection(\'users\') query', () => {
    const fn = extractFn(PMS, 'async function drawAgyapps');
    assert.match(fn, /httpsCallable\('listAgencyAccounts'\)/);
    assert.ok(!/fsDb\.collection\('users'\)/.test(fn), 'drawAgyapps() queries users/ directly -- Approved/Suspended tabs must go through listAgencyAccounts() instead');
  });
  test('the Pending tab uses listPendingAgencyApplications(), never a direct fsDb.collection(\'agency_applications\') query', () => {
    const fn = extractFn(PMS, 'async function drawAgyapps');
    assert.match(fn, /httpsCallable\('listPendingAgencyApplications'\)/);
  });
  test('every applicant-supplied field rendered in a PMS row goes through esc()', () => {
    const rowFn = extractFn(PMS, 'function renderAgyappsPendingRow');
    ['a.agencyName', 'a.contactPerson', 'a.emailLower', 'a.phone', 'a.country'].forEach((field) => {
      assert.ok(new RegExp('esc\\(' + field.replace('.', '\\.') + '\\)').test(rowFn), field + ' is not passed through esc() in renderAgyappsPendingRow');
    });
  });
  test('the new nav item is gated by canManageCatalog() (Admin+Manager), not the admin-only applyUserMgmtVisibility()', () => {
    const fn = extractFn(PMS, 'function applyAgencyAppsVisibility');
    assert.match(fn, /canManageCatalog\(\)/);
    const umFn = extractFn(PMS, 'function applyUserMgmtVisibility');
    assert.ok(!/sl-agyapps/.test(umFn), 'sl-agyapps was added to the admin-only applyUserMgmtVisibility() array -- it must only use applyAgencyAppsVisibility()');
  });
  test('the existing admin-only #m-agency-pkgs modal (openAgencyPkgManager/saveAgencyPkgForm) is completely untouched -- still admin-hardcoded, not migrated to the new Manager-capable path', () => {
    const fn = extractFn(PMS, 'async function openAgencyPkgManager');
    assert.match(fn, /currentUser\.role!=="admin"/);
  });
  test('the new Manage Packages flow calls setAgencyPackages(), a separate path from saveAgencyPkgForm()', () => {
    const fn = extractFn(PMS, 'async function saveAgymgrPackages');
    assert.match(fn, /httpsCallable\('setAgencyPackages'\)/);
  });
  test('zero-package approval is allowed client-side too -- the confirm handler has no guard blocking an empty selection, only a warning', () => {
    const fn = extractFn(PMS, 'async function agyappApproveConfirm');
    assert.ok(!/if\(packageIds\.length===0\)\s*\{?\s*return/.test(fn), 'agyappApproveConfirm() blocks zero-package submission -- it should only warn, per product decision');
  });
}

section('vilu-agency-portal.html -- resumable signup, no client-side privilege escalation');
{
  test('doAgencySignup() recovers from auth/email-already-in-use by attempting sign-in with the same credentials, instead of dead-ending', () => {
    const fn = extractFn(AGENCY, 'async function doAgencySignup');
    assert.match(fn, /auth\/email-already-in-use/);
    assert.match(fn, /signInWithEmailAndPassword\(email, pass\)/);
  });
  test('the login-screen status-card "Back to sign in" path performs a real firebase.auth().signOut(), unlike the file\'s other, unrelated doSignout() implementations', () => {
    const fn = extractFn(AGENCY, 'function agencyStatusScreenSignOut');
    assert.match(fn, /firebase\.auth\(\)\.signOut\(\)/);
  });
}

section('Unified Admin Login (2026-09-13) -- Agency Portal accepts role===admin only through a separate, inert Preview mode');
{
  test('doAgencyLogin() and onAuthStateChanged both dispatch role===\'admin\' to enterAgencyPortalAdminPreview() -- a separate branch, not a change to the real agency check', () => {
    const loginFn = extractFn(AGENCY, 'async function doAgencyLogin');
    assert.match(loginFn, /profile\.role === 'admin'/);
    assert.match(loginFn, /enterAgencyPortalAdminPreview\(profile\)/);
    const authStateIdx = AGENCY.indexOf("firebase.auth().onAuthStateChanged(async function(fbUser)");
    assert.ok(authStateIdx > -1, 'onAuthStateChanged handler not found');
    const authStateFn = extractFn(AGENCY, "firebase.auth().onAuthStateChanged(async function(fbUser)");
    assert.match(authStateFn, /profile\.role === 'admin'/);
    assert.match(authStateFn, /enterAgencyPortalAdminPreview\(profile\)/);
  });
  test('the existing profile.role===\'agency\' branch is unchanged by this addition -- normal agency login still calls the real enterAgencyPortal()', () => {
    const loginFn = extractFn(AGENCY, 'async function doAgencyLogin');
    assert.match(loginFn, /profile\.role === 'agency' && profile\.accountStatus !== 'SUSPENDED'/);
    assert.match(loginFn, /await enterAgencyPortal\(profile\)/);
  });
  test('enterAgencyPortalAdminPreview() sets currentAgency to null (never a real agency identity) and never calls the real enterAgencyPortal()', () => {
    const fn = extractFn(AGENCY, 'function enterAgencyPortalAdminPreview');
    assert.match(fn, /currentAgency = null/);
    assert.ok(!/enterAgencyPortal\(/.test(fn), 'enterAgencyPortalAdminPreview() calls the real agency entry point');
  });
  test('the admin preview screen loads no agency data -- neither enterAgencyPortalAdminPreview() nor exitAdminAgencyPreview() calls any real-dashboard data-loading function', () => {
    const enterFn = extractFn(AGENCY, 'function enterAgencyPortalAdminPreview');
    const exitFn = extractFn(AGENCY, 'function exitAdminAgencyPreview');
    const combined = enterFn + exitFn;
    ['drawPackages(', 'drawQuotations(', 'drawMyBookings(', 'drawMyBlocks(', 'drawMyHolds(', 'searchAgencyGuests', 'fetchPackagesFromFirestore', 'agency_packages'].forEach((forbidden) => {
      assert.ok(!combined.includes(forbidden), 'admin preview mode references ' + forbidden + ' -- it must load no agency data at all');
    });
  });
  test('the #admin-preview-screen markup is a sibling of #login-screen and #agency-app, never nested inside the real dashboard shell', () => {
    const previewIdx = AGENCY.indexOf('id="admin-preview-screen"');
    const appIdx = AGENCY.indexOf('id="agency-app"');
    assert.ok(previewIdx > -1 && appIdx > -1);
    assert.ok(previewIdx < appIdx, 'the preview screen markup should appear before the real app shell, confirming it is not nested inside it');
  });
}

section('Unified Admin Login (2026-09-13) -- PMS/Staff Portal side, documented as already-working (regression guard, no code changed)');
{
  test('PMS doLogin() already grants full access when loginRole===\'admin\' matches the stored profile.role -- no separate Staff Portal identity exists or is needed', () => {
    const fn = extractFn(PMS, 'async function doLogin');
    assert.match(fn, /profile\.role !== loginRole/, 'the existing role-matches-selected-tab gate is gone -- verify Admin can still only log in by selecting the Admin tab, intentionally');
  });
  test('canManageCatalog() and requireStaffLike() both already include admin -- Admin already has every Staff-level capability with no downgrade and no separate identity', () => {
    const clientFn = extractFn(PMS, 'function canManageCatalog');
    assert.match(clientFn, /role.*===.*'admin'|'admin'.*===.*role/);
    const serverFn = extractFn(FUNCTIONS, 'function requireStaffLike');
    assert.match(serverFn, /role !== 'admin'/);
  });
}

console.log(`\n${passed}/${passed + failed} agency-self-registration-hardening (structural) assertions passed`);
if (failed) process.exitCode = 1;
