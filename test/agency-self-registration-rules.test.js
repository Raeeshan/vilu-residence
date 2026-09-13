// Agency Self-Registration + Admin/Manager Approval + Package Assignment --
// proven for real against the Firestore + Auth emulators + the actual Cloud
// Functions, same pattern as the other -rules suites in this repo.
//
// Run via:
//   firebase emulators:exec --only firestore,auth "node test/agency-self-registration-rules.test.js"
const assert = require('node:assert/strict');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}

const STAFF_UID = 'staff-uid', STAFF_EMAIL = 'staff@example.com';
const MANAGER_UID = 'manager-uid', MANAGER_EMAIL = 'manager@example.com';

(async () => {
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
  process.env.GCLOUD_PROJECT = 'vilu-residence';
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'vilu-residence' });

  const functionsTest = require('firebase-functions-test')({ projectId: 'vilu-residence' });
  const myFunctions = require('../functions-core/index.js');
  const path = require('node:path');
  const firebaseAdminFirestorePath = require.resolve('firebase-admin/firestore', { paths: [path.join(__dirname, '..', 'functions-core')] });
  const firebaseAdminAuthPath = require.resolve('firebase-admin/auth', { paths: [path.join(__dirname, '..', 'functions-core')] });
  const { getFirestore } = require(firebaseAdminFirestorePath);
  const { getAuth } = require(firebaseAdminAuthPath);
  const db = getFirestore();
  const auth = getAuth();

  const submitWrapped = functionsTest.wrap(myFunctions.submitAgencyApplication);
  const getMyStatusWrapped = functionsTest.wrap(myFunctions.getMyAgencyApplicationStatus);
  const listPendingWrapped = functionsTest.wrap(myFunctions.listPendingAgencyApplications);
  const listAccountsWrapped = functionsTest.wrap(myFunctions.listAgencyAccounts);
  const approveWrapped = functionsTest.wrap(myFunctions.approveAgencyApplication);
  const rejectWrapped = functionsTest.wrap(myFunctions.rejectAgencyApplication);
  const resetWrapped = functionsTest.wrap(myFunctions.resetAgencyApplicationToPending);
  const suspendWrapped = functionsTest.wrap(myFunctions.suspendAgencyAccount);
  const reactivateWrapped = functionsTest.wrap(myFunctions.reactivateAgencyAccount);
  const setPackagesWrapped = functionsTest.wrap(myFunctions.setAgencyPackages);
  const getAgencyPropertiesWrapped = functionsTest.wrap(myFunctions.getAgencyProperties);

  let _testEnv = null;
  async function getTestEnvForRules() {
    if (_testEnv) return _testEnv;
    const rules = require('node:fs').readFileSync('firestore.rules', 'utf8');
    _testEnv = await initializeTestEnvironment({ projectId: 'vilu-residence', firestore: { rules, host: '127.0.0.1', port: 8080 } });
    return _testEnv;
  }

  function callAs(fn, uid, email, data) {
    return fn({ data, auth: { uid, token: { email } } });
  }
  async function expectCode(promise, expectedCode) {
    try {
      await promise;
      assert.fail('expected the call to be rejected with code ' + expectedCode + ', but it succeeded');
    } catch (e) {
      assert.equal(e.code, expectedCode, 'wrong error code: got "' + e.code + '" ("' + e.message + '")');
    }
  }

  // Shared across sections below (approval creates it, suspend/reactivate
  // and setAgencyPackages sections reuse the same real agency).
  let realApproveUid;

  async function seedUser(email, role, overrides) {
    await db.collection('users').doc(email).set(Object.assign({ email, role, name: email.split('@')[0] }, overrides || {}));
  }
  async function seedPackage(id, overrides) {
    await db.collection('packages').doc(id).set(Object.assign({
      id, name: 'Test Package ' + id, emoji: '📦', description: 'test', pricePerRoom: 300, agencyPricePerRoom: 250,
      nights: 3, includes: ['Breakfast'], activities: [], addOns: [], color: '#00b4d8', active: true, channel: 'agency',
    }, overrides || {}));
  }
  // Creates a REAL emulated Firebase Auth user (not a Firestore fixture) so
  // getAuth().getUser()/emailVerified checks inside the functions under
  // test exercise real Auth-emulator behavior, not a mock.
  async function createAuthUser(email, emailVerified) {
    const rec = await auth.createUser({ email, password: 'password123', emailVerified: !!emailVerified });
    return rec.uid;
  }

  await seedUser(STAFF_EMAIL, 'staff');
  await seedUser(MANAGER_EMAIL, 'manager');

  section('submitAgencyApplication -- resumable, idempotent, never lets the client set status/role');
  {
    await test('unauthenticated caller is rejected', async () => {
      await expectCode(submitWrapped({ data: {} }), 'unauthenticated');
    });
    let uid1;
    await test('a valid submission creates agency_applications/{uid} with status PENDING_APPROVAL', async () => {
      uid1 = await createAuthUser('newagency1@example.com', false);
      const r = await callAs(submitWrapped, uid1, 'newagency1@example.com', {
        agencyName: 'Test Travel Co', contactPerson: 'Jane Doe', phone: '+960 555 1234', country: 'Maldives', agreedToTerms: true,
      });
      assert.equal(r.status, 'PENDING_APPROVAL');
      const doc = (await db.collection('agency_applications').doc(uid1).get()).data();
      assert.equal(doc.status, 'PENDING_APPROVAL');
      assert.equal(doc.agencyName, 'Test Travel Co');
      assert.equal(doc.emailLower, 'newagency1@example.com');
    });
    await test('retrying the same submission while still PENDING_APPROVAL succeeds again (resumability) instead of erroring', async () => {
      const r = await callAs(submitWrapped, uid1, 'newagency1@example.com', {
        agencyName: 'Test Travel Co', contactPerson: 'Jane Doe', phone: '+960 555 1234', country: 'Maldives', agreedToTerms: true,
      });
      assert.equal(r.status, 'PENDING_APPROVAL');
    });
    await test('missing agreedToTerms is rejected', async () => {
      const uid = await createAuthUser('needsterms@example.com', false);
      await expectCode(callAs(submitWrapped, uid, 'needsterms@example.com', {
        agencyName: 'X', contactPerson: 'Y', phone: '1', country: 'Z', agreedToTerms: false,
      }), 'invalid-argument');
    });
    await test('an over-length field is rejected', async () => {
      const uid = await createAuthUser('toolong@example.com', false);
      await expectCode(callAs(submitWrapped, uid, 'toolong@example.com', {
        agencyName: 'A'.repeat(200), contactPerson: 'Y', phone: '1', country: 'Z', agreedToTerms: true,
      }), 'invalid-argument');
    });
    // Identity-collision hardening (2026-09-13): the doAgencySignup() retry
    // path (auth/email-already-in-use -> signInWithEmailAndPassword instead
    // of creating a new account) means this callable can be reached by an
    // Auth account that ALREADY belongs to an existing privileged identity.
    // submitAgencyApplication must refuse for ANY existing users/{email}
    // doc, not just role==='agency' -- never just an agency-specific check.
    for (const [existingRole, email] of [
      ['agency', 'alreadyagency@example.com'],
      ['admin', 'alreadyadmin@example.com'],
      ['manager', 'alreadymanager@example.com'],
      ['staff', 'alreadystaff@example.com'],
    ]) {
      await test('an email that already belongs to an existing ' + existingRole + ' user is refused, never disclosing the role', async () => {
        await seedUser(email, existingRole);
        const uid = await createAuthUser(email, true);
        try {
          await callAs(submitWrapped, uid, email, { agencyName: 'X', contactPerson: 'Y', phone: '1', country: 'Z', agreedToTerms: true });
          assert.fail('expected already-exists');
        } catch (e) {
          assert.equal(e.code, 'already-exists');
          // The generic message legitimately says "...new agency
          // application" for every case (describing the action being
          // attempted, not the pre-existing role) -- so "agency" itself
          // isn't a disclosure. admin/manager/staff, on the other hand,
          // must never appear; those words could only get in by leaking
          // the actual stored role.
          if (existingRole !== 'agency') {
            assert.ok(!new RegExp(existingRole, 'i').test(e.message), 'error message discloses the existing role: ' + e.message);
          }
        }
      });
    }
    await test('the legitimate retry case remains allowed: Auth account exists, but users/{email} does NOT exist yet (interrupted first signup)', async () => {
      const uid = await createAuthUser('interruptedsignup@example.com', false);
      // No users/ doc was ever created for this email -- confirm that precondition.
      const preCheck = await db.collection('users').doc('interruptedsignup@example.com').get();
      assert.equal(preCheck.exists, false);
      const r = await callAs(submitWrapped, uid, 'interruptedsignup@example.com', { agencyName: 'Interrupted Co', contactPerson: 'Y', phone: '1', country: 'Z', agreedToTerms: true });
      assert.equal(r.status, 'PENDING_APPROVAL');
    });
  }

  section('getMyAgencyApplicationStatus -- the only applicant-facing read path, never leaks internal fields');
  {
    await test('no application -> NONE', async () => {
      const uid = await createAuthUser('nonewapp@example.com', false);
      const r = await callAs(getMyStatusWrapped, uid, 'nonewapp@example.com', {});
      assert.equal(r.status, 'NONE');
    });
    await test('a pending application returns only the safe allowlist, never rejectionReason/approvedBy/uid/emailLower', async () => {
      const uid = await createAuthUser('safereadtest@example.com', false);
      await callAs(submitWrapped, uid, 'safereadtest@example.com', { agencyName: 'Safe Read Co', contactPerson: 'X', phone: '1', country: 'Z', agreedToTerms: true });
      const r = await callAs(getMyStatusWrapped, uid, 'safereadtest@example.com', {});
      assert.equal(r.status, 'PENDING_APPROVAL');
      assert.equal(r.agencyName, 'Safe Read Co');
      assert.ok(!('rejectionReason' in r), 'rejectionReason leaked to the applicant');
      assert.ok(!('approvedBy' in r), 'approvedBy leaked to the applicant');
      assert.ok(!('uid' in r), 'uid leaked to the applicant');
      assert.ok(!('emailLower' in r), 'emailLower leaked to the applicant');
    });
  }

  section('agency_applications Firestore rules -- server-only, no direct client read or write, even for the owning applicant');
  {
    await test('the owning applicant cannot read their own raw application doc directly (redaction-by-lockdown design)', async () => {
      const { assertFails } = require('@firebase/rules-unit-testing');
      const uid = await createAuthUser('directreadtest@example.com', false);
      await callAs(submitWrapped, uid, 'directreadtest@example.com', { agencyName: 'X', contactPerson: 'Y', phone: '1', country: 'Z', agreedToTerms: true });
      const env = await getTestEnvForRules();
      const applicantDb = env.authenticatedContext(uid, { email: 'directreadtest@example.com' }).firestore();
      await assertFails(applicantDb.collection('agency_applications').doc(uid).get());
    });
    await test('an admin/manager CAN read the raw application doc directly (they are the intended full-detail viewer)', async () => {
      const { assertSucceeds } = require('@firebase/rules-unit-testing');
      const env = await getTestEnvForRules();
      const managerDb = env.authenticatedContext(MANAGER_UID, { email: MANAGER_EMAIL }).firestore();
      await assertSucceeds(managerDb.collection('agency_applications').limit(1).get());
    });
    await test('no one, not even admin, can write agency_applications directly -- write:false is absolute', async () => {
      const { assertFails } = require('@firebase/rules-unit-testing');
      const env = await getTestEnvForRules();
      const adminDb = env.authenticatedContext('admin-uid', { email: 'viluresidence@gmail.com' }).firestore();
      await assertFails(adminDb.collection('agency_applications').doc('HACK').set({ status: 'APPROVED' }));
    });
  }

  section('listPendingAgencyApplications -- Admin/Manager only, live Auth state per row, no internal fields');
  {
    await test('an ordinary Staff caller is refused -- this is Admin/Manager only, not staff-like', async () => {
      await expectCode(callAs(listPendingWrapped, STAFF_UID, STAFF_EMAIL, {}), 'permission-denied');
    });
    let pendingUid, unverifiedUid, deletedUid;
    await test('a manager sees pending applications with live emailVerified/authUserExists merged in', async () => {
      pendingUid = await createAuthUser('pendinglist1@example.com', true);
      await callAs(submitWrapped, pendingUid, 'pendinglist1@example.com', { agencyName: 'Verified Co', contactPerson: 'A', phone: '1', country: 'Z', agreedToTerms: true });
      unverifiedUid = await createAuthUser('pendinglist2@example.com', false);
      await callAs(submitWrapped, unverifiedUid, 'pendinglist2@example.com', { agencyName: 'Unverified Co', contactPerson: 'B', phone: '1', country: 'Z', agreedToTerms: true });
      const r = await callAs(listPendingWrapped, MANAGER_UID, MANAGER_EMAIL, {});
      const verifiedRow = r.applications.find((a) => a.agencyName === 'Verified Co');
      const unverifiedRow = r.applications.find((a) => a.agencyName === 'Unverified Co');
      assert.equal(verifiedRow.emailVerified, true);
      assert.equal(verifiedRow.authUserExists, true);
      assert.equal(unverifiedRow.emailVerified, false);
      assert.equal(unverifiedRow.authUserExists, true);
      Object.values(r.applications).forEach((a) => {
        assert.ok(!('rejectionReason' in a));
        assert.ok(!('approvedBy' in a));
      });
    });
    await test('an application whose Auth user was deleted returns authUserExists:false, emailVerified:false', async () => {
      deletedUid = await createAuthUser('willbedeleted@example.com', true);
      await callAs(submitWrapped, deletedUid, 'willbedeleted@example.com', { agencyName: 'Deleted Co', contactPerson: 'C', phone: '1', country: 'Z', agreedToTerms: true });
      await auth.deleteUser(deletedUid);
      const r = await callAs(listPendingWrapped, MANAGER_UID, MANAGER_EMAIL, {});
      const row = r.applications.find((a) => a.agencyName === 'Deleted Co');
      assert.equal(row.authUserExists, false);
      assert.equal(row.emailVerified, false);
    });
  }

  section('approveAgencyApplication -- identity lock, live re-verification, atomicity, package-shape preservation');
  {
    await test('an ordinary Staff caller is refused', async () => {
      await expectCode(callAs(approveWrapped, STAFF_UID, STAFF_EMAIL, { applicationId: 'whatever', packageIds: [] }), 'permission-denied');
    });
    await seedPackage('PKG_A', { name: 'Island Explorer' });
    await seedPackage('PKG_B', { name: 'Reef Adventure' });
    await seedPackage('PKG_WEBSITE', { name: 'Website Only', channel: 'website' });

    let approveUid;
    await test('approval is refused if the applicant has not verified their email, even though the stored application looks fine', async () => {
      approveUid = await createAuthUser('approvaltest1@example.com', false);
      await callAs(submitWrapped, approveUid, 'approvaltest1@example.com', { agencyName: 'Approval Test Co', contactPerson: 'D', phone: '1', country: 'Z', agreedToTerms: true });
      const appId = approveUid;
      await expectCode(callAs(approveWrapped, MANAGER_UID, MANAGER_EMAIL, { applicationId: appId, packageIds: ['PKG_A'] }), 'failed-precondition');
    });
    await test('approval is refused if the Auth email has changed since the application was submitted (identity lock)', async () => {
      const uid = await createAuthUser('changedemail-original@example.com', true);
      await callAs(submitWrapped, uid, 'changedemail-original@example.com', { agencyName: 'Changed Email Co', contactPerson: 'E', phone: '1', country: 'Z', agreedToTerms: true });
      await auth.updateUser(uid, { email: 'changedemail-new@example.com', emailVerified: true });
      await expectCode(callAs(approveWrapped, MANAGER_UID, MANAGER_EMAIL, { applicationId: uid, packageIds: ['PKG_A'] }), 'failed-precondition');
      const appDoc = (await db.collection('agency_applications').doc(uid).get()).data();
      assert.equal(appDoc.status, 'PENDING_APPROVAL', 'a refused approval must never change the application status');
    });
    await test('approval is refused if the Auth user no longer exists', async () => {
      const uid = await createAuthUser('deletedbeforeapproval@example.com', true);
      await callAs(submitWrapped, uid, 'deletedbeforeapproval@example.com', { agencyName: 'Ghost Co', contactPerson: 'F', phone: '1', country: 'Z', agreedToTerms: true });
      await auth.deleteUser(uid);
      await expectCode(callAs(approveWrapped, MANAGER_UID, MANAGER_EMAIL, { applicationId: uid, packageIds: [] }), 'not-found');
    });

    await test('a verified, identity-matched application is approved atomically: users/{email}, agency_packages/{email}, and application status all update together', async () => {
      realApproveUid = await createAuthUser('realapprove@example.com', true);
      await callAs(submitWrapped, realApproveUid, 'realapprove@example.com', { agencyName: 'Real Approve Co', contactPerson: 'G', phone: '1', country: 'Z', agreedToTerms: true });
      const r = await callAs(approveWrapped, MANAGER_UID, MANAGER_EMAIL, { applicationId: realApproveUid, packageIds: ['PKG_A', 'PKG_B'] });
      assert.equal(r.packageCount, 2);
      const userDoc = (await db.collection('users').doc('realapprove@example.com').get()).data();
      assert.equal(userDoc.role, 'agency');
      assert.equal(userDoc.accountStatus, 'ACTIVE');
      assert.equal(userDoc.uid, realApproveUid);
      const pkgDoc = (await db.collection('agency_packages').doc('realapprove@example.com').get()).data();
      assert.equal(pkgDoc.packages.length, 2);
      assert.ok(pkgDoc.packages.some((p) => p.id === 'PKG_A' && p.name === 'Island Explorer'), 'full canonical package object not preserved');
      const appDoc = (await db.collection('agency_applications').doc(realApproveUid).get()).data();
      assert.equal(appDoc.status, 'APPROVED');
      assert.deepEqual(appDoc.approvedPackageIds.sort(), ['PKG_A', 'PKG_B']);
    });
    await test('zero-package approval is explicitly allowed', async () => {
      const uid = await createAuthUser('zeropkg@example.com', true);
      await callAs(submitWrapped, uid, 'zeropkg@example.com', { agencyName: 'Zero Pkg Co', contactPerson: 'H', phone: '1', country: 'Z', agreedToTerms: true });
      const r = await callAs(approveWrapped, MANAGER_UID, MANAGER_EMAIL, { applicationId: uid, packageIds: [] });
      assert.equal(r.packageCount, 0);
    });
    await test('a requested package id from the wrong channel (website, not agency) is silently dropped, never assigned', async () => {
      const uid = await createAuthUser('wrongchannel@example.com', true);
      await callAs(submitWrapped, uid, 'wrongchannel@example.com', { agencyName: 'Wrong Channel Co', contactPerson: 'I', phone: '1', country: 'Z', agreedToTerms: true });
      await callAs(approveWrapped, MANAGER_UID, MANAGER_EMAIL, { applicationId: uid, packageIds: ['PKG_A', 'PKG_WEBSITE', 'PKG_NONEXISTENT'] });
      const pkgDoc = (await db.collection('agency_packages').doc('wrongchannel@example.com').get()).data();
      assert.equal(pkgDoc.packages.length, 1);
      assert.equal(pkgDoc.packages[0].id, 'PKG_A');
    });
    await test('approving an already-approved application is refused (idempotency/double-click protection)', async () => {
      await expectCode(callAs(approveWrapped, MANAGER_UID, MANAGER_EMAIL, { applicationId: realApproveUid, packageIds: [] }), 'failed-precondition');
    });

    // Identity-collision hardening (2026-09-13): a users/{email} document
    // could appear AFTER an application was submitted but BEFORE it is
    // approved (e.g. an unrelated admin action, or a race). The approval
    // transaction must re-check for this itself and refuse, never merge
    // into or overwrite whatever already exists there.
    await test('approval refuses if users/{email} appears after submission but before approval -- transaction-level check, not just a pre-check', async () => {
      const uid = await createAuthUser('collisionbeforeapprove@example.com', true);
      await callAs(submitWrapped, uid, 'collisionbeforeapprove@example.com', { agencyName: 'Collision Co', contactPerson: 'K', phone: '1', country: 'Z', agreedToTerms: true });
      // Simulate an unrelated identity appearing for this exact email
      // between submission and approval.
      await seedUser('collisionbeforeapprove@example.com', 'staff', { name: 'Real Staff Member' });

      await expectCode(callAs(approveWrapped, MANAGER_UID, MANAGER_EMAIL, { applicationId: uid, packageIds: ['PKG_A'] }), 'already-exists');

      const userDoc = (await db.collection('users').doc('collisionbeforeapprove@example.com').get()).data();
      assert.equal(userDoc.role, 'staff', 'the pre-existing staff identity\'s role was overwritten by a refused approval');
      assert.equal(userDoc.name, 'Real Staff Member', 'the pre-existing staff identity was modified by a refused approval');

      const appDoc = (await db.collection('agency_applications').doc(uid).get()).data();
      assert.equal(appDoc.status, 'PENDING_APPROVAL', 'a refused approval must leave the application PENDING_APPROVAL, not silently advance it');
      assert.equal(appDoc.approvedAt, null);

      const pkgDoc = await db.collection('agency_packages').doc('collisionbeforeapprove@example.com').get();
      assert.equal(pkgDoc.exists, false, 'a refused approval must never create an agency_packages doc');

      const auditSnap = await db.collection('agency_application_audit').where('agencyUid', '==', uid).where('action', '==', 'APPROVED').get();
      assert.equal(auditSnap.size, 0, 'no audit record may claim this application was APPROVED when the transaction actually threw');
    });
  }

  section('rejectAgencyApplication / resetAgencyApplicationToPending');
  {
    await test('an ordinary Staff caller is refused for reject', async () => {
      await expectCode(callAs(rejectWrapped, STAFF_UID, STAFF_EMAIL, { applicationId: 'x' }), 'permission-denied');
    });
    let rejectUid;
    await test('a manager rejects a pending application with an internal reason', async () => {
      rejectUid = await createAuthUser('rejecttest@example.com', true);
      await callAs(submitWrapped, rejectUid, 'rejecttest@example.com', { agencyName: 'Reject Test Co', contactPerson: 'J', phone: '1', country: 'Z', agreedToTerms: true });
      await callAs(rejectWrapped, MANAGER_UID, MANAGER_EMAIL, { applicationId: rejectUid, reason: 'Not a real travel agency' });
      const doc = (await db.collection('agency_applications').doc(rejectUid).get()).data();
      assert.equal(doc.status, 'REJECTED');
      assert.equal(doc.rejectionReason, 'Not a real travel agency');
    });
    await test('rejecting an already-rejected application is refused', async () => {
      await expectCode(callAs(rejectWrapped, MANAGER_UID, MANAGER_EMAIL, { applicationId: rejectUid, reason: 'again' }), 'failed-precondition');
    });
    await test('an ordinary Staff caller is refused for reset-to-pending', async () => {
      await expectCode(callAs(resetWrapped, STAFF_UID, STAFF_EMAIL, { applicationId: rejectUid }), 'permission-denied');
    });
    await test('a manager can reset a rejected application back to pending, clearing the rejection fields', async () => {
      await callAs(resetWrapped, MANAGER_UID, MANAGER_EMAIL, { applicationId: rejectUid });
      const doc = (await db.collection('agency_applications').doc(rejectUid).get()).data();
      assert.equal(doc.status, 'PENDING_APPROVAL');
      assert.equal(doc.rejectedAt, null);
      assert.equal(doc.rejectionReason, null);
    });
    await test('resetting a PENDING (not rejected) application is refused', async () => {
      await expectCode(callAs(resetWrapped, MANAGER_UID, MANAGER_EMAIL, { applicationId: rejectUid }), 'failed-precondition');
    });
  }

  section('suspendAgencyAccount / reactivateAgencyAccount -- and the suspension actually blocks agency callables');
  {
    await test('an ordinary Staff caller is refused for suspend', async () => {
      await expectCode(callAs(suspendWrapped, STAFF_UID, STAFF_EMAIL, { email: 'realapprove@example.com' }), 'permission-denied');
    });
    await test('suspending a non-agency email is refused', async () => {
      await expectCode(callAs(suspendWrapped, MANAGER_UID, MANAGER_EMAIL, { email: STAFF_EMAIL }), 'not-found');
    });
    await test('a manager suspends an approved agency', async () => {
      await callAs(suspendWrapped, MANAGER_UID, MANAGER_EMAIL, { email: 'realapprove@example.com' });
      const doc = (await db.collection('users').doc('realapprove@example.com').get()).data();
      assert.equal(doc.accountStatus, 'SUSPENDED');
      assert.equal(doc.role, 'agency', 'suspension must never change role -- history/identity is preserved');
    });
    await test('a suspended agency is now rejected by an existing, UNMODIFIED agency-only callable (getAgencyProperties) -- proves the callerRole() sentinel change requires zero changes to that callable', async () => {
      await expectCode(callAs(getAgencyPropertiesWrapped, realApproveUid, 'realapprove@example.com', {}), 'permission-denied');
    });
    await test('an ordinary Staff caller is refused for reactivate', async () => {
      await expectCode(callAs(reactivateWrapped, STAFF_UID, STAFF_EMAIL, { email: 'realapprove@example.com' }), 'permission-denied');
    });
    await test('a manager reactivates the agency, restoring normal access', async () => {
      await callAs(reactivateWrapped, MANAGER_UID, MANAGER_EMAIL, { email: 'realapprove@example.com' });
      const doc = (await db.collection('users').doc('realapprove@example.com').get()).data();
      assert.equal(doc.accountStatus, 'ACTIVE');
      const r = await callAs(getAgencyPropertiesWrapped, realApproveUid, 'realapprove@example.com', {});
      assert.equal(r.properties[0].propertyId, 'VILU');
    });
  }

  section('setAgencyPackages -- Manager-capable path alongside (never replacing) the existing admin-only PMS modal');
  {
    await test('an ordinary Staff caller is refused', async () => {
      await expectCode(callAs(setPackagesWrapped, STAFF_UID, STAFF_EMAIL, { email: 'realapprove@example.com', packageIds: [] }), 'permission-denied');
    });
    await test('a manager can reassign packages after approval, preserving the exact canonical shape and dropping invalid ids', async () => {
      await callAs(setPackagesWrapped, MANAGER_UID, MANAGER_EMAIL, { email: 'realapprove@example.com', packageIds: ['PKG_B', 'PKG_WEBSITE', 'PKG_NONEXISTENT'] });
      const pkgDoc = (await db.collection('agency_packages').doc('realapprove@example.com').get()).data();
      assert.equal(pkgDoc.packages.length, 1);
      assert.equal(pkgDoc.packages[0].id, 'PKG_B');
      assert.equal(pkgDoc.packages[0].name, 'Reef Adventure');
    });
  }

  section('listAgencyAccounts -- Admin/Manager only, narrow projection, never exposes staff/admin records');
  {
    await test('an ordinary Staff caller is refused', async () => {
      await expectCode(callAs(listAccountsWrapped, STAFF_UID, STAFF_EMAIL, {}), 'permission-denied');
    });
    await test('a manager sees only role==agency accounts with the narrow allowlisted fields', async () => {
      const r = await callAs(listAccountsWrapped, MANAGER_UID, MANAGER_EMAIL, {});
      const row = r.accounts.find((a) => a.email === 'realapprove@example.com');
      assert.ok(row, 'approved agency missing from listAgencyAccounts');
      assert.equal(row.accountStatus, 'ACTIVE');
      assert.equal(row.assignedPackageCount, 1);
      assert.ok(!r.accounts.some((a) => a.email === STAFF_EMAIL), 'a staff account leaked into the agency accounts list');
      assert.ok(!r.accounts.some((a) => a.email === MANAGER_EMAIL), 'a manager account leaked into the agency accounts list');
      Object.keys(row).forEach((k) => {
        assert.ok(['email', 'uid', 'agencyName', 'accountStatus', 'commission', 'assignedPackageCount', 'assignedPackageIds'].includes(k), 'unexpected field on listAgencyAccounts row: ' + k);
      });
    });
  }

  section('users/{id} rules -- accountStatus is admin/manager-set only, never self-writable');
  {
    await test('an agency cannot self-write a CHANGED accountStatus even while leaving role/commission unchanged (their real doc is currently ACTIVE)', async () => {
      const { assertFails } = require('@firebase/rules-unit-testing');
      const env = await getTestEnvForRules();
      const agencyDb = env.authenticatedContext('realapprove-uid-rules', { email: 'realapprove@example.com' }).firestore();
      await assertFails(agencyDb.collection('users').doc('realapprove@example.com').set({
        email: 'realapprove@example.com', role: 'agency', commission: 0, accountStatus: 'SUSPENDED', name: 'hacked',
      }, { merge: true }));
    });
    await test('an agency CAN self-write other fields (e.g. name) while leaving accountStatus genuinely unchanged -- the block is scoped to accountStatus itself, not a blanket self-write ban', async () => {
      const { assertSucceeds } = require('@firebase/rules-unit-testing');
      const env = await getTestEnvForRules();
      const agencyDb = env.authenticatedContext('realapprove-uid-rules', { email: 'realapprove@example.com' }).firestore();
      await assertSucceeds(agencyDb.collection('users').doc('realapprove@example.com').set({
        email: 'realapprove@example.com', role: 'agency', commission: 0, accountStatus: 'ACTIVE', name: 'Self-Updated Name',
      }, { merge: true }));
    });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (_testEnv) await _testEnv.cleanup();
  if (failed) process.exit(1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
