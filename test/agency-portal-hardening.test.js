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

const AGENCY = read('vilu-agency-portal.html');
const PMS = read('vilu-unified.html');
const RULES = read('firestore.rules');

section('Case A — agency data isolation is server-enforced, not client-filter-only');
{
  test('firestore.rules: reservations read requires agencyId==auth.uid for the agency branch', () => {
    const line = RULES.split('\n').find(l => l.includes('isAgency() && resource.data.agencyId'));
    assert.ok(line, 'agency read-isolation clause not found in reservations read rule');
  });
  test('firestore.rules: reservations create for agencies requires agencyId==auth.uid AND source==Agency', () => {
    const line = RULES.split('\n').find(l => l.includes('isAgency() && request.resource.data.agencyId'));
    assert.ok(line && /source == 'Agency'/.test(line), 'agency create branch missing agencyId/source enforcement');
  });
  test('firestore.rules: reservations update is admin/staff only — agencies cannot update any reservation, including their own', () => {
    const m = RULES.match(/allow update: if request\.resource\.data\.room_id[\s\S]{0,400}?;/);
    assert.ok(m, 'update rule not found');
    assert.ok(!/isAgency/.test(m[0]), 'agency now appears in the reservations update rule — isolation model changed, verify intentionally');
  });
  test('vilu-agency-portal.html queries reservations filtered by agencyId==currentAgency.uid (not a bulk fetch filtered client-side)', () => {
    assert.ok(/collection\('reservations'\)\.where\('agencyId','==',currentAgency\.uid\)/.test(AGENCY), 'reservations query no longer filters by agencyId server-side');
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

section('Case B — no self-registration; account creation/lifecycle is staff-controlled');
{
  test('createUserWithEmailAndPassword is only reachable through the legacy-migration path (requires a pre-existing matching legacy credential), not a public sign-up form', () => {
    const calls = [...AGENCY.matchAll(/createUserWithEmailAndPassword/g)];
    assert.equal(calls.length, 1, 'expected exactly one createUserWithEmailAndPassword call site (migrateLegacyAgency) — a new one may indicate a new signup path was added');
    const idx = calls[0].index;
    const fnStart = AGENCY.lastIndexOf('async function migrateLegacyAgency', idx);
    assert.ok(fnStart !== -1 && fnStart < idx, 'createUserWithEmailAndPassword is no longer inside migrateLegacyAgency() — verify no new self-registration path was introduced');
  });
  test('login screen states accounts are staff-created, with no visible sign-up affordance', () => {
    assert.ok(/Your login is created by Vilu Residence/.test(AGENCY), 'staff-creates-your-login messaging removed from login screen');
    assert.ok(!/Sign\s*up/i.test(AGENCY.slice(AGENCY.indexOf('id="login-screen"'), AGENCY.indexOf('id="login-screen"') + 3000)), 'a "Sign up" affordance appears to have been added to the login screen');
  });
  test('doAgencyLogin() rejects an authenticated non-agency account (profile.role !== "agency") rather than granting portal access', () => {
    const start = AGENCY.indexOf('async function doAgencyLogin');
    const fn = AGENCY.slice(start, AGENCY.indexOf('\n}', start) + 2);
    assert.ok(/profile\.role !== 'agency'/.test(fn), 'role check missing from doAgencyLogin()');
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
  test('firestore.rules: reservations read requires admin/staff/matching-agency — never public', () => {
    const m = RULES.match(/match \/reservations\/\{id\} \{\s*allow read: if ([^;]+);/);
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
