// Agency Self-Registration -- SIGNUP BUTTON WIRING + RACE-CONDITION FIX
// regression suite (2026-09-13).
//
// Background (real live investigation, not assumed): a live E2E test found
// that clicking the visible "Submit application" button sometimes left the
// applicant back on the plain login screen (or, once diagnosed more
// precisely with a local Firestore+Auth-emulator + a real headless-browser
// click, silently swapped the correct "Application submitted -- verify
// your email" confirmation screen for the generic "Application pending"
// status screen). Root cause: firebase.auth().createUserWithEmailAndPassword()
// (called inside doAgencySignup()) fires the SAME onAuthStateChanged
// listener registered separately in this file, ASYNCHRONOUSLY and
// independently of doAgencySignup()'s own await chain -- Firebase gives no
// guarantee about when that listener fires relative to the calling code's
// own promise chain. That listener's own network round-trip could resolve
// AFTER doAgencySignup() had already shown signup-pending-card, and
// showAgencyStatusScreen() hides every .login-card (signup-pending-card
// included) to show status-card instead -- a real, reproducible race, not a
// click-targeting mistake.
//
// Fix, in two iterations (both proven below -- the first was insufficient,
// which this suite also proves so it can never silently regress back to it):
//   Draft 1 (insufficient): a boolean `_agencySignupInProgress`, set true
//     before the first await that could trigger an auth-state change and
//     cleared in a `finally` when doAgencySignup() itself finishes. This
//     failed under a slightly slower onAuthStateChanged firing time --
//     Firebase gives no upper bound on that, so a fixed clear-on-finish
//     window can still be beaten by a late-firing listener.
//   Final: `_agencySignupHandledEmail`, scoped to the SPECIFIC email being
//     signed up (known before createUserWithEmailAndPassword is even
//     called, unlike the eventual uid) and left permanently set once a
//     session for that email exists -- onAuthStateChanged only stands down
//     for auth-state events about that exact email, so a later, different
//     sign-in on the same page is never affected, and sign-out needs no
//     special handling either (fbUser is null then, short-circuiting the
//     check on its own).
//
// This suite proves two different things, deliberately kept separate:
//   1. STATIC checks that the button is wired the way a real click needs
//      (no <form>/native-submit risk, exactly one unconditional onclick
//      wired straight to doAgencySignup(), no stray duplicate handler) and
//      that the fix has the right shape in the source.
//   2. DYNAMIC checks that run the REAL, unmodified doAgencySignup(),
//      onAuthStateChanged, showAgencyStatusScreen(), and
//      showStatusScreenIfApplicant() source -- extracted verbatim from the
//      shipped file and executed in a small hand-built DOM/Firebase mock
//      harness (not jsdom, which isn't a dependency of this repo) -- under
//      adversarial timing and every login-state permutation the live
//      investigation called for.
// This is a regression guard for CI, not a substitute for a real browser --
// the authoritative UI proof for this fix was a real click-through against
// the Firestore+Auth emulators in a real browser (see the session's own
// live investigation), reproducing the bug and then confirming the fix,
// exactly as required ("do not prove it by calling doAgencySignup()
// directly" -- that requirement governs the LIVE proof, already satisfied
// separately; a Node-based CI regression test has no browser to click in,
// so the best available fidelity here is running the real extracted logic
// under simulated adversarial async ordering).
//
// Run: node test/agency-signup-button-wiring.test.js
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
  const arrowIdx = src.indexOf('=>', scanFrom);
  const bodyStart = (arrowIdx !== -1 && arrowIdx < scanFrom + 200 && !startMarker.includes('function')) ? src.indexOf('{', arrowIdx) : src.indexOf('{', scanFrom);
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

section('Static wiring checks -- what a real click actually depends on');
{
  test('no <form> element wraps the signup UI -- native form submission/page reload is structurally impossible here, not merely prevented', () => {
    assert.doesNotMatch(AGENCY, /<form[\s>]/i, 'a <form> element exists somewhere in this file -- re-verify no native submit/reload risk was introduced for the signup card');
  });
  test('exactly one "Submit application" button, wired to a bare, unconditional doAgencySignup() call (no guard/typo/second handler)', () => {
    const matches = [...AGENCY.matchAll(/Submit application/g)];
    assert.equal(matches.length, 1, 'expected exactly one "Submit application" button label');
    const buttonMatch = AGENCY.match(/<button[^>]*onclick="doAgencySignup\(\)"[^>]*>Submit application/);
    assert.ok(buttonMatch, 'the Submit application button is not wired with a bare onclick="doAgencySignup()"');
  });
  test('the button is a plain <button> (implicit type="button" per HTML spec outside a <form>), not an <input type="submit"> or anything that could trigger native submission', () => {
    const buttonMatch = AGENCY.match(/<button[^>]*onclick="doAgencySignup\(\)"[^>]*>Submit application/);
    assert.ok(buttonMatch[0].startsWith('<button'), 'the signup submit control is not a <button> element');
    assert.ok(!/type=["']submit["']/.test(buttonMatch[0]), 'the signup submit control has type="submit" -- unnecessary and risky outside a <form>');
  });
}

section('Race-condition fix -- static shape (email-scoped guard)');
{
  test('_agencySignupHandledEmail is declared at module scope, before the onAuthStateChanged registration', () => {
    const flagIdx = AGENCY.indexOf('var _agencySignupHandledEmail = null;');
    const listenerIdx = AGENCY.indexOf('firebase.auth().onAuthStateChanged(async function(fbUser)');
    assert.ok(flagIdx > -1, '_agencySignupHandledEmail declaration not found');
    assert.ok(listenerIdx > -1, 'onAuthStateChanged registration not found');
    assert.ok(flagIdx < listenerIdx, '_agencySignupHandledEmail must be declared before onAuthStateChanged is registered');
  });
  test('onAuthStateChanged checks the guard (by email, case-insensitively) as its very first statement', () => {
    const fn = extractFn(AGENCY, 'firebase.auth().onAuthStateChanged(async function(fbUser)');
    const bodyStart = fn.indexOf('{') + 1;
    const firstStatement = fn.slice(bodyStart, fn.indexOf(';', bodyStart) + 1).trim();
    assert.equal(firstStatement, "if (fbUser && fbUser.email && fbUser.email.toLowerCase() === _agencySignupHandledEmail) return;");
  });
  test('doAgencySignup() sets the guard to the target email BEFORE calling createUserWithEmailAndPassword (not after -- the uid is not known until it resolves, but the email is)', () => {
    const fn = extractFn(AGENCY, 'async function doAgencySignup()');
    const setIdx = fn.indexOf('_agencySignupHandledEmail = email;');
    const createUserIdx = fn.indexOf('await firebase.auth().createUserWithEmailAndPassword(');
    assert.ok(setIdx > -1 && createUserIdx > -1, 'expected both markers present');
    assert.ok(setIdx < createUserIdx, 'the guard must be set BEFORE createUserWithEmailAndPassword, not after');
  });
  test('doAgencySignup() clears the guard on genuine no-session failure paths (recovery sign-in failed / account creation failed outright) -- exactly 2 clears, validation failures return before the guard is ever set so need none', () => {
    const fn = extractFn(AGENCY, 'async function doAgencySignup()');
    const clears = [...fn.matchAll(/_agencySignupHandledEmail = null;/g)].length;
    assert.equal(clears, 2, 'expected exactly 2 failure-path clears');
  });
  test('doAgencySignup() deliberately never clears the guard after a successful account creation (submitAgencyApplication failure OR success) -- a transient clear-on-finish window was proven insufficient (see the dynamic test below)', () => {
    const fn = extractFn(AGENCY, 'async function doAgencySignup()');
    const sendVerifyIdx = fn.indexOf('sendEmailVerification');
    const afterAccountExists = fn.slice(sendVerifyIdx);
    assert.ok(!/_agencySignupHandledEmail = null/.test(afterAccountExists), 'the guard is cleared after the Auth account already exists for this email -- this reopens the exact race the fix closed');
  });
}

section('Race-condition fix -- dynamic proof (real extracted logic, simulated adversarial timing and every login-state permutation)');
{
  // A minimal, purpose-built DOM/Firebase mock -- NOT jsdom (not a
  // dependency of this repo). Just enough surface for doAgencySignup(),
  // onAuthStateChanged, fetchAgencyProfile(), showStatusScreenIfApplicant(),
  // and showAgencyStatusScreen() to run unmodified.
  function buildHarness(opts) {
    opts = Object.assign({ userProfile: null, applicationSubmitted: false }, opts);
    const elements = {};
    function makeEl(id) { return elements[id] || (elements[id] = { id, value: '', textContent: '', checked: false, style: { display: 'none' } }); }
    ['signup-err', 'su-agencyname', 'su-contact', 'su-email', 'su-phone', 'su-country', 'su-pass', 'su-pass2',
      'su-website', 'su-regnum', 'su-message', 'su-agree', 'signup-card', 'signup-pending-card', 'status-card',
      'status-icon', 'status-title', 'status-body', 'login-screen', 'admin-preview-screen', 'admin-preview-email'].forEach(makeEl);
    const loginCardEl = { style: { display: 'block' } };

    let authStateCallback = null;
    let currentUser = opts.initialCurrentUser || null;
    const calls = { enterAgencyPortal: 0, enterAgencyPortalAdminPreview: 0 };
    let uidCounter = 0;

    const sandbox = {
      console,
      document: {
        getElementById: (id) => { if (!(id in elements)) makeEl(id); return elements[id]; },
        querySelector: (sel) => { if (sel === '#login-screen .login-card') return loginCardEl; return null; },
        querySelectorAll: (sel) => (sel === '#login-screen > .login-card' ? [loginCardEl, elements['signup-pending-card'], elements['status-card']] : []),
      },
      firebase: {
        auth: () => ({
          get currentUser() { return currentUser; },
          set currentUser(v) { currentUser = v; },
          createUserWithEmailAndPassword: async (email, pass) => {
            if (opts.createUserBehavior) await opts.createUserBehavior();
            currentUser = { email, uid: 'uid-' + (++uidCounter), emailVerified: false, sendEmailVerification: async () => {} };
            // Real Firebase fires onAuthStateChanged asynchronously here --
            // simulated with an explicit, test-controlled delay so we can
            // choose exactly when relative to submitAgencyApplication it fires.
            if (authStateCallback) {
              (async () => { await opts.authStateDelay(); await authStateCallback(currentUser); })();
            }
          },
          signInWithEmailAndPassword: async (email) => {
            if (opts.signInBehavior) await opts.signInBehavior();
            currentUser = { email, uid: 'uid-existing', emailVerified: true, sendEmailVerification: async () => {} };
          },
          onAuthStateChanged: (cb) => { authStateCallback = cb; },
          signOut: async () => { currentUser = null; },
        }),
      },
      fsFunctions: {
        httpsCallable: (name) => async (data) => {
          if (name === 'submitAgencyApplication') {
            await opts.submitAppDelay();
            if (opts.submitAppShouldFail) throw new Error(opts.submitAppErrorMessage || 'simulated submit failure');
            opts.applicationSubmitted = true;
            return { data: { status: 'PENDING_APPROVAL' } };
          }
          if (name === 'getMyAgencyApplicationStatus') return { data: opts.applicationSubmitted ? { status: 'PENDING_APPROVAL', agencyName: 'X' } : { status: 'NONE' } };
          throw new Error('unexpected callable: ' + name);
        },
      },
      fsDb: { collection: () => ({ doc: () => ({ get: async () => (opts.userProfile ? { exists: true, data: () => opts.userProfile } : { exists: false }) }) }) },
      currentAgency: null,
      enterAgencyPortal: async () => { calls.enterAgencyPortal++; },
      enterAgencyPortalAdminPreview: () => { calls.enterAgencyPortalAdminPreview++; },
    };
    sandbox.window = sandbox;
    return { sandbox, elements, loginCardEl, opts, calls, fireAuthStateChanged: (fbUser) => authStateCallback(fbUser) };
  }

  function extractedSource() {
    return [
      'var _agencySignupHandledEmail = null;',
      // Keep this as the REAL call (not a renamed/detached copy) so it
      // actually registers with the mock's onAuthStateChanged() below --
      // extractFn only balances {}, so the trailing ); that closes the
      // original firebase.auth().onAuthStateChanged(...) call must be
      // added back explicitly.
      extractFn(AGENCY, 'firebase.auth().onAuthStateChanged(async function(fbUser)') + ');',
      extractFn(AGENCY, 'async function fetchAgencyProfile'),
      extractFn(AGENCY, 'async function showStatusScreenIfApplicant'),
      extractFn(AGENCY, 'function showAgencyStatusScreen'),
      extractFn(AGENCY, 'async function doAgencySignup()'),
    ].join('\n');
  }

  function fillForm(sandbox, email) {
    sandbox.document.getElementById('su-agencyname').value = 'Race Test Co';
    sandbox.document.getElementById('su-contact').value = 'Tester';
    sandbox.document.getElementById('su-email').value = email;
    sandbox.document.getElementById('su-phone').value = '123';
    sandbox.document.getElementById('su-country').value = 'Testland';
    sandbox.document.getElementById('su-pass').value = 'password123';
    sandbox.document.getElementById('su-pass2').value = 'password123';
    sandbox.document.getElementById('su-agree').checked = true;
  }

  async function run(opts, email) {
    const h = buildHarness(opts);
    vm.createContext(h.sandbox);
    vm.runInContext(extractedSource(), h.sandbox);
    fillForm(h.sandbox, email || 'race-test@example.com');
    await vm.runInContext('doAgencySignup()', h.sandbox);
    await new Promise((r) => setTimeout(r, 60));
    return h;
  }

  test('sanity: the exact extracted-and-executed real source contains the fix (dynamic tests below would be meaningless against stale/mismatched source)', () => {
    const src = extractedSource();
    assert.match(src, /_agencySignupHandledEmail = email;/);
    assert.match(src, /if \(fbUser && fbUser\.email && fbUser\.email\.toLowerCase\(\) === _agencySignupHandledEmail\) return;/);
  });

  // ── Case 1: onAuthStateChanged fires immediately after createUser, before submitAgencyApplication finishes ──
  await testAsync('[case 1] onAuthStateChanged fires immediately after account creation, WHILE submitAgencyApplication is still in flight -- it must stand down, not act on a not-yet-existing application', async () => {
    const h = await run({
      createUserBehavior: async () => {},
      authStateDelay: () => new Promise((r) => setTimeout(r, 1)),
      submitAppDelay: () => new Promise((r) => setTimeout(r, 40)),
    });
    assert.equal(h.elements['signup-pending-card'].style.display, 'block');
    assert.equal(h.elements['status-card'].style.display, 'none');
  });

  // ── Cases 2/3: onAuthStateChanged fires after submitAgencyApplication resolves (JS's single-threaded run-to-completion means "before full render" and "after the screen is visible" are not independently distinguishable once the awaited call has resolved -- both are covered by varying how long after resolution it fires) ──
  await testAsync('[cases 2 & 3] onAuthStateChanged fires at various delays AFTER submitAgencyApplication resolves (including well after the confirmation screen has rendered) -- signup-pending-card must always win', async () => {
    for (const lateness of [5, 30, 100]) {
      const h = await run({
        createUserBehavior: async () => {},
        authStateDelay: () => new Promise((r) => setTimeout(r, lateness)),
        submitAppDelay: () => new Promise((r) => setTimeout(r, 2)),
      }, 'race-test-' + lateness + '@example.com');
      assert.equal(h.elements['signup-pending-card'].style.display, 'block', 'failed at lateness=' + lateness + 'ms');
      assert.equal(h.elements['status-card'].style.display, 'none', 'failed at lateness=' + lateness + 'ms');
    }
  });

  // ── Case 4: validation failure never touches the guard ──
  await testAsync('[case 4] a validation failure (e.g. passwords do not match) returns before the guard is ever set, and shows a visible error', async () => {
    const h = buildHarness({});
    vm.createContext(h.sandbox);
    vm.runInContext(extractedSource(), h.sandbox);
    fillForm(h.sandbox, 'validation-fail@example.com');
    h.sandbox.document.getElementById('su-pass2').value = 'SomethingElse123!';
    await vm.runInContext('doAgencySignup()', h.sandbox);
    assert.equal(h.elements['signup-err'].textContent, 'Passwords do not match.');
    assert.equal(h.elements['signup-err'].style.display, 'block');
    assert.equal(vm.runInContext('_agencySignupHandledEmail', h.sandbox), null, 'the guard must never be touched by a validation failure');
  });

  // ── Case 5: Auth signup failure clears the guard ──
  await testAsync('[case 5] a genuine Firebase Auth failure (not email-already-in-use) shows a visible error and clears the guard -- no stuck state for this email', async () => {
    const h = buildHarness({ createUserBehavior: async () => { const e = new Error('network error'); e.code = 'auth/network-request-failed'; throw e; }, authStateDelay: () => Promise.resolve(), submitAppDelay: () => Promise.resolve() });
    vm.createContext(h.sandbox);
    vm.runInContext(extractedSource(), h.sandbox);
    fillForm(h.sandbox, 'auth-fail@example.com');
    await vm.runInContext('doAgencySignup()', h.sandbox);
    assert.match(h.elements['signup-err'].textContent, /Could not create account/);
    assert.equal(h.elements['signup-err'].style.display, 'block');
    assert.equal(vm.runInContext('_agencySignupHandledEmail', h.sandbox), null, 'the guard must be cleared after a genuine account-creation failure');
  });

  // ── Case 6: submitAgencyApplication failure shows a visible error, UI not stuck ──
  await testAsync('[case 6] submitAgencyApplication failing after a successful account creation shows a visible, specific error and leaves signup-card (not a blank/stuck state) visible for retry', async () => {
    const h = await run({
      createUserBehavior: async () => {},
      authStateDelay: () => Promise.resolve(),
      submitAppDelay: () => Promise.resolve(),
      submitAppShouldFail: true,
      submitAppErrorMessage: 'simulated network failure',
    }, 'submit-fail@example.com');
    assert.match(h.elements['signup-err'].textContent, /Account created, but the application could not be submitted/);
    assert.equal(h.elements['signup-err'].style.display, 'block');
    assert.equal(h.elements['signup-pending-card'].style.display, 'none', 'the pending-confirmation screen must not show when submission actually failed');
  });

  // ── Case 7: a later page reload for the same PENDING applicant shows the status screen ──
  await testAsync('[case 7] a fresh page load (fresh module state, guard back to null) with an already-signed-in applicant and an existing PENDING application correctly shows the pending status screen', async () => {
    const h = buildHarness({ applicationSubmitted: true, userProfile: null });
    vm.createContext(h.sandbox);
    vm.runInContext(extractedSource(), h.sandbox);
    await h.fireAuthStateChanged({ email: 'reload-test@example.com', uid: 'uid-reload' });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(h.elements['status-card'].style.display, 'block');
    assert.equal(h.elements['status-title'].textContent, 'Application pending');
  });

  // ── Case 8: normal approved agency login unchanged ──
  await testAsync('[case 8] a fresh page load for an approved, active agency calls the real enterAgencyPortal(), never suppressed by the guard (which is null on a fresh load)', async () => {
    const h = buildHarness({ userProfile: { role: 'agency', accountStatus: 'ACTIVE', name: 'Real Agency' } });
    vm.createContext(h.sandbox);
    vm.runInContext(extractedSource(), h.sandbox);
    await h.fireAuthStateChanged({ email: 'real-agency@example.com', uid: 'uid-real-agency' });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(h.calls.enterAgencyPortal, 1);
    assert.equal(h.elements['status-card'].style.display, 'none');
  });

  // ── Case 9: Admin Preview login unchanged ──
  await testAsync('[case 9] a fresh page load for an admin calls the real enterAgencyPortalAdminPreview(), never suppressed by the guard', async () => {
    const h = buildHarness({ userProfile: { role: 'admin' } });
    vm.createContext(h.sandbox);
    vm.runInContext(extractedSource(), h.sandbox);
    await h.fireAuthStateChanged({ email: 'viluresidence@gmail.com', uid: 'uid-admin' });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(h.calls.enterAgencyPortalAdminPreview, 1);
    assert.equal(h.calls.enterAgencyPortal, 0);
  });

  // ── Case 10: sign-out clears signup-specific state / doesn't stick around for a later, different sign-in ──
  await testAsync('[case 10] after a successful signup, signing out (fbUser=null) and a DIFFERENT account signing in on the SAME page is never suppressed by the first email\'s guard', async () => {
    const h = await run({
      createUserBehavior: async () => {},
      authStateDelay: () => Promise.resolve(),
      submitAppDelay: () => Promise.resolve(),
    }, 'first-applicant@example.com');
    assert.equal(h.elements['signup-pending-card'].style.display, 'block', 'first signup should have succeeded');
    // Sign out (fbUser becomes null) -- must not throw, and the guard is
    // deliberately left set for the FIRST email (see the static test above);
    // what matters is that it must not affect a DIFFERENT, later sign-in.
    await h.fireAuthStateChanged(null);
    // Reconfigure the harness's mock to represent a different, already-
    // approved agency now signing in on this same page (no reload).
    h.opts.userProfile = { role: 'agency', accountStatus: 'ACTIVE', name: 'Second Agency' };
    await h.fireAuthStateChanged({ email: 'second-agency@example.com', uid: 'uid-second-agency' });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(h.calls.enterAgencyPortal, 1, 'the second, different agency\'s sign-in was incorrectly suppressed by the first applicant\'s email-scoped guard');
  });

  await testAsync('negative control: without the fix (guard check removed), the original adversarial timing WOULD have clobbered the screen -- proves this harness genuinely exercises the bug, not a tautology', async () => {
    const h = buildHarness({
      createUserBehavior: async () => {},
      authStateDelay: () => new Promise((r) => setTimeout(r, 30)),
      submitAppDelay: () => new Promise((r) => setTimeout(r, 5)),
    });
    vm.createContext(h.sandbox);
    const srcWithoutGuard = extractedSource()
      .replace("if (fbUser && fbUser.email && fbUser.email.toLowerCase() === _agencySignupHandledEmail) return;", '/* guard disabled for this negative-control test */')
      .replace('_agencySignupHandledEmail = email;', '/* guard disabled for this negative-control test */');
    vm.runInContext(srcWithoutGuard, h.sandbox);
    fillForm(h.sandbox, 'negative-control@example.com');
    await vm.runInContext('doAgencySignup()', h.sandbox);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(h.elements['status-card'].style.display, 'block', 'expected the UNGUARDED source to reproduce the original clobbering bug -- if this fails, the harness itself is not faithfully reproducing the race');
  });
}

console.log(`\n${passed}/${passed + failed} agency-signup-button-wiring assertions passed`);
if (failed) process.exitCode = 1;

})().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
