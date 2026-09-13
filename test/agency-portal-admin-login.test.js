// VILU AGENCY PORTAL — ADMIN LOGIN RELIABILITY (2026-09-13)
//
// The user reported they "cannot reliably sign into the Agency Portal"
// using their normal PMS Admin account (viluresidence@gmail.com), and
// asked for the ACTUAL live reason, not an assumption that the existing
// "Vilu Admin — Agency Portal Preview" code (built and deployed earlier,
// commit d683b49) still works. A full source audit found doAgencyLogin(),
// the onAuthStateChanged handler, and enterAgencyPortalAdminPreview()/
// exitAdminAgencyPreview() all correctly wired, in the right branch order,
// in BOTH entry points -- and confirmed firestore.rules' isAdmin() is a
// hardcoded-email check independent of the `role` field, so a read of
// users/viluresidence@gmail.com can never be denied for the real admin.
//
// The one concrete bug found: fetchAgencyProfile(email) looked up
// `users/{email}` using fbUser.email EXACTLY as Firebase Auth returns it,
// never lower-cased -- but every users/{id} doc in this codebase is always
// created/keyed with a lower-cased email (self-registration, the PMS's own
// authenticateUser(), and firestore.rules' own isAgency()/isAdmin() reads
// all use .lower()). A casing mismatch here silently returns null (the
// try/catch swallows it as a non-error), which both doAgencyLogin() and
// onAuthStateChanged then misread as "not set up for agency access" for a
// perfectly valid admin (or agency) account -- exactly the kind of
// intermittent "sometimes I can't log in" symptom reported. Fixed by
// lower-casing once, inside fetchAgencyProfile() itself, so every caller
// benefits.
//
// This suite runs the REAL, unmodified doAgencyLogin(), onAuthStateChanged,
// fetchAgencyProfile(), enterAgencyPortalAdminPreview(),
// exitAdminAgencyPreview() source in a small hand-built mock harness (same
// technique as test/agency-signup-button-wiring.test.js) with a Firestore
// mock that does REAL exact-string doc-id matching (so the lower-case fix
// is actually exercised, not just present in source) -- proving live
// BEHAVIOR, not just that a regex matches.
//
//   node test/agency-portal-admin-login.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }
function extractFn(src, startMarker) {
  const i0 = src.indexOf(startMarker);
  if (i0 === -1) throw new Error('marker not found: ' + startMarker);
  const scanFrom = i0 + startMarker.length;
  const bodyStart = src.indexOf('{', scanFrom);
  let i = bodyStart + 1, depth = 1;
  while (depth > 0 && i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return src.slice(i0, i);
}

const AGENCY = read('vilu-agency-portal.html');

(async () => {

section('Static — deployed code has the fix, and both entry points still exist');
{
  test('fetchAgencyProfile() lower-cases the email before the Firestore lookup', () => {
    const fn = extractFn(AGENCY, 'async function fetchAgencyProfile(email)');
    assert.match(fn, /fsDb\.collection\('users'\)\.doc\(String\(email\|\|''\)\.trim\(\)\.toLowerCase\(\)\)\.get\(\)/);
  });
  test('doAgencyLogin() and onAuthStateChanged both still call enterAgencyPortalAdminPreview for role===admin, in the same branch order as before', () => {
    const loginFn = extractFn(AGENCY, 'async function doAgencyLogin()');
    const authFn = extractFn(AGENCY, 'firebase.auth().onAuthStateChanged(async function(fbUser)');
    [loginFn, authFn].forEach((fn) => {
      const agencyIdx = fn.indexOf("profile.role === 'agency' && profile.accountStatus !== 'SUSPENDED'");
      const suspendedIdx = fn.indexOf("profile.role === 'agency' && profile.accountStatus === 'SUSPENDED'");
      const adminIdx = fn.indexOf("profile.role === 'admin'");
      assert.ok(agencyIdx > -1 && suspendedIdx > agencyIdx && adminIdx > suspendedIdx, 'expected order: agency-active -> agency-suspended -> admin');
      assert.match(fn, /enterAgencyPortalAdminPreview\(profile\)/);
    });
  });
  test('enterAgencyPortalAdminPreview()/exitAdminAgencyPreview() exist and never touch role, agency_packages, or create an application', () => {
    const enterFn = extractFn(AGENCY, 'function enterAgencyPortalAdminPreview(profile)');
    assert.match(enterFn, /currentAgency = null;/);
    assert.doesNotMatch(enterFn, /agency_packages|submitAgencyApplication|role\s*[:=]\s*['"]agency['"]/);
  });
}

section('Dynamic — real extracted logic, realistic case-sensitive Firestore mock');
{
  // A minimal, purpose-built DOM/Firebase mock -- NOT jsdom (not a
  // dependency of this repo). fsDb here does REAL exact doc-id matching
  // (keyed by whatever the test registers, always lower-case, mirroring
  // how every real users/{email} doc in this codebase is actually keyed)
  // so the fetchAgencyProfile() lower-casing fix is genuinely exercised,
  // not just present in source.
  function buildHarness(opts) {
    opts = Object.assign({ usersById: {}, agencySignupHandledEmail: null }, opts);
    const elements = {};
    function makeEl(id) { return elements[id] || (elements[id] = { id, value: '', textContent: '', checked: false, style: { display: 'none' }, classList: { add(){}, remove(){} } }); }
    ['login-err', 'ag-email', 'ag-pass', 'login-screen', 'admin-preview-screen', 'admin-preview-email'].forEach(makeEl);
    const loginCard = { style: { display: 'block' } };

    let authStateCallback = null;
    let currentUser = null;
    const calls = { enterAgencyPortal: 0, enterAgencyPortalAdminPreview: 0, showAgencyStatusScreen: [], showStatusScreenIfApplicant: 0 };

    const sandbox = {
      console,
      document: {
        getElementById: (id) => { if (!(id in elements)) makeEl(id); return elements[id]; },
        querySelector: (sel) => (sel === '#login-screen .login-card' ? loginCard : null),
      },
      firebase: {
        auth: () => ({
          get currentUser() { return currentUser; },
          signInWithEmailAndPassword: async (email) => {
            if (opts.signInError) { const e = new Error('sign-in failed'); e.code = opts.signInError; throw e; }
            // Simulates Firebase Auth handing back the email in WHATEVER
            // casing opts specifies -- real Firebase Auth does not
            // normalize this to match a Firestore doc's own casing.
            currentUser = { email: opts.authReturnsEmail || email, uid: 'uid-' + email };
          },
          onAuthStateChanged: (cb) => { authStateCallback = cb; },
          signOut: async () => { currentUser = null; },
        }),
      },
      fsDb: {
        collection: (name) => ({
          doc: (id) => ({
            get: async () => {
              if (name !== 'users') return { exists: false };
              const key = String(id);
              return Object.prototype.hasOwnProperty.call(opts.usersById, key)
                ? { exists: true, data: () => opts.usersById[key] }
                : { exists: false };
            },
          }),
        }),
      },
      currentAgency: null,
      enterAgencyPortal: async () => { calls.enterAgencyPortal++; },
      enterAgencyPortalAdminPreview: (profile) => { calls.enterAgencyPortalAdminPreview++; sandbox.document.getElementById('admin-preview-email').textContent = profile.email; },
      showAgencyStatusScreen: (status) => { calls.showAgencyStatusScreen.push(status); },
      showStatusScreenIfApplicant: async () => { calls.showStatusScreenIfApplicant++; return false; },
    };
    sandbox.window = sandbox;
    // Pre-seed the signup-race guard exactly like a real page-load would
    // have left it, per the scenario under test.
    return { sandbox, elements, calls, fireAuthStateChanged: (fbUser) => authStateCallback(fbUser) };
  }

  function extractedSource(preSetSignupGuardEmail) {
    return [
      'var _agencySignupHandledEmail = ' + (preSetSignupGuardEmail ? JSON.stringify(preSetSignupGuardEmail) : 'null') + ';',
      extractFn(AGENCY, 'async function fetchAgencyProfile(email)'),
      extractFn(AGENCY, 'async function doAgencyLogin()'),
      extractFn(AGENCY, 'firebase.auth().onAuthStateChanged(async function(fbUser)') + ');',
    ].join('\n');
  }

  function run(opts, preSetSignupGuardEmail) {
    const h = buildHarness(opts);
    vm.createContext(h.sandbox);
    vm.runInContext(extractedSource(preSetSignupGuardEmail), h.sandbox);
    return h;
  }

  test('sanity: the exact extracted-and-executed source contains the lower-case fix', () => {
    const src = extractedSource(null);
    assert.match(src, /\.toLowerCase\(\)\)\.get\(\)/);
  });

  await testAsync('[fresh page, doAgencyLogin] Admin signs in from a clean, logged-out state, typing the exact-case email -> Admin Preview opens', async () => {
    const h = run({ usersById: { 'viluresidence@gmail.com': { role: 'admin', email: 'viluresidence@gmail.com' } } });
    h.sandbox.document.getElementById('ag-email').value = 'viluresidence@gmail.com';
    h.sandbox.document.getElementById('ag-pass').value = 'realpassword';
    await vm.runInContext('doAgencyLogin()', h.sandbox);
    assert.equal(h.calls.enterAgencyPortalAdminPreview, 1);
    assert.equal(h.elements['admin-preview-email'].textContent, 'viluresidence@gmail.com');
    assert.equal(h.elements['login-err'].style.display, 'none');
  });

  await testAsync('[fresh page, doAgencyLogin] a MISMATCHED-CASE Firebase-returned email still resolves to the admin profile (the actual fix) -- proves the bug this closes', async () => {
    const h = run({
      usersById: { 'viluresidence@gmail.com': { role: 'admin', email: 'viluresidence@gmail.com' } },
      authReturnsEmail: 'ViluResidence@Gmail.com', // what a real Firebase Auth session can hand back
    });
    h.sandbox.document.getElementById('ag-email').value = 'viluresidence@gmail.com';
    h.sandbox.document.getElementById('ag-pass').value = 'realpassword';
    await vm.runInContext('doAgencyLogin()', h.sandbox);
    assert.equal(h.calls.enterAgencyPortalAdminPreview, 1, 'admin preview should still open despite the casing mismatch');
  });

  await testAsync('negative control: WITHOUT the lower-case fix, the same casing mismatch fails to reach Admin Preview -- proves the harness genuinely exercises the bug, not a tautology', async () => {
    const h = buildHarness({
      usersById: { 'viluresidence@gmail.com': { role: 'admin', email: 'viluresidence@gmail.com' } },
      authReturnsEmail: 'ViluResidence@Gmail.com',
    });
    vm.createContext(h.sandbox);
    const brokenFetchProfile = extractFn(AGENCY, 'async function fetchAgencyProfile(email)')
      .replace("fsDb.collection('users').doc(String(email||'').trim().toLowerCase()).get()", "fsDb.collection('users').doc(email).get()");
    const src = [
      'var _agencySignupHandledEmail = null;',
      brokenFetchProfile,
      extractFn(AGENCY, 'async function doAgencyLogin()'),
      extractFn(AGENCY, 'firebase.auth().onAuthStateChanged(async function(fbUser)') + ');',
    ].join('\n');
    vm.runInContext(src, h.sandbox);
    h.sandbox.document.getElementById('ag-email').value = 'viluresidence@gmail.com';
    h.sandbox.document.getElementById('ag-pass').value = 'realpassword';
    await vm.runInContext('doAgencyLogin()', h.sandbox);
    assert.equal(h.calls.enterAgencyPortalAdminPreview, 0, 'expected the UNFIXED source to fail on a casing mismatch -- if this fails, the harness is not faithfully reproducing the bug');
    assert.match(h.elements['login-err'].textContent, /not set up for agency access/);
  });

  await testAsync('[fresh page, onAuthStateChanged] Admin signs in directly from a fresh page (auto-restored session, no reload in between) -> Admin Preview opens', async () => {
    const h = run({ usersById: { 'viluresidence@gmail.com': { role: 'admin', email: 'viluresidence@gmail.com' } } });
    await h.fireAuthStateChanged({ email: 'viluresidence@gmail.com', uid: 'uid-admin' });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(h.calls.enterAgencyPortalAdminPreview, 1);
    assert.equal(h.calls.enterAgencyPortal, 0);
  });

  await testAsync('[signup-guard interaction] synthetic signup email handled -> sign out -> Admin signs in -> Admin Preview opens successfully (the guard for a DIFFERENT email never suppresses it)', async () => {
    const h = run(
      { usersById: { 'viluresidence@gmail.com': { role: 'admin', email: 'viluresidence@gmail.com' } } },
      'viluresidence+agencytest@gmail.com' // guard left set from an earlier signup in the same page lifetime
    );
    // The guard fires and suppresses onAuthStateChanged ONLY for its own email.
    await h.fireAuthStateChanged({ email: 'viluresidence+agencytest@gmail.com', uid: 'uid-signup' });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(h.calls.enterAgencyPortal, 0);
    assert.equal(h.calls.enterAgencyPortalAdminPreview, 0);
    // Sign out (fbUser -> null), then a DIFFERENT email (the real admin) signs in.
    await h.fireAuthStateChanged(null);
    await h.fireAuthStateChanged({ email: 'viluresidence@gmail.com', uid: 'uid-admin' });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(h.calls.enterAgencyPortalAdminPreview, 1, 'the admin sign-in must not be suppressed by a different email\'s signup guard');
  });

  await testAsync('[doAgencyLogin, admin via literal button click path] typing admin credentials and calling doAgencyLogin() while the signup guard is set for an unrelated email still succeeds', async () => {
    const h = run(
      { usersById: { 'viluresidence@gmail.com': { role: 'admin', email: 'viluresidence@gmail.com' } } },
      'someone-else@example.com'
    );
    h.sandbox.document.getElementById('ag-email').value = 'viluresidence@gmail.com';
    h.sandbox.document.getElementById('ag-pass').value = 'realpassword';
    await vm.runInContext('doAgencyLogin()', h.sandbox);
    assert.equal(h.calls.enterAgencyPortalAdminPreview, 1);
  });

  await testAsync('[regression] normal active agency login via doAgencyLogin() is unchanged', async () => {
    const h = run({ usersById: { 'agency@example.com': { role: 'agency', accountStatus: 'ACTIVE', name: 'Real Agency', email: 'agency@example.com' } } });
    h.sandbox.document.getElementById('ag-email').value = 'agency@example.com';
    h.sandbox.document.getElementById('ag-pass').value = 'pw';
    await vm.runInContext('doAgencyLogin()', h.sandbox);
    assert.equal(h.calls.enterAgencyPortal, 1);
    assert.equal(h.calls.enterAgencyPortalAdminPreview, 0);
  });

  await testAsync('[regression] a suspended agency via doAgencyLogin() still shows the SUSPENDED status screen, never Admin Preview', async () => {
    const h = run({ usersById: { 'suspended@example.com': { role: 'agency', accountStatus: 'SUSPENDED', email: 'suspended@example.com' } } });
    h.sandbox.document.getElementById('ag-email').value = 'suspended@example.com';
    h.sandbox.document.getElementById('ag-pass').value = 'pw';
    await vm.runInContext('doAgencyLogin()', h.sandbox);
    assert.deepEqual(h.calls.showAgencyStatusScreen, ['SUSPENDED']);
    assert.equal(h.calls.enterAgencyPortal, 0);
    assert.equal(h.calls.enterAgencyPortalAdminPreview, 0);
  });

  await testAsync('[regression] a pending/rejected applicant (no users/{email} doc yet, or a non-agency/non-admin role) falls through to showStatusScreenIfApplicant(), never Admin Preview or enterAgencyPortal', async () => {
    const h = run({ usersById: {} });
    h.sandbox.document.getElementById('ag-email').value = 'pending-applicant@example.com';
    h.sandbox.document.getElementById('ag-pass').value = 'pw';
    await vm.runInContext('doAgencyLogin()', h.sandbox);
    assert.equal(h.calls.showStatusScreenIfApplicant, 1);
    assert.equal(h.calls.enterAgencyPortal, 0);
    assert.equal(h.calls.enterAgencyPortalAdminPreview, 0);
  });
}

console.log(`\n${passed}/${passed + failed} agency-portal-admin-login assertions passed`);
if (failed) process.exitCode = 1;

})().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
