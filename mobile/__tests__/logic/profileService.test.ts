import {
  resolveAccountStatus,
  resolveRole,
  buildResolvedSession,
  fetchResolvedSession,
  type FirestoreUserDocReader,
  type ApplicationStatusReader,
} from '../../src/services/profile/profileService';
import type { AuthUser, RawUserDoc } from '../../src/types/profile';

const authUser: AuthUser = { uid: 'uid-1', email: 'Person@Example.com', emailVerified: true };

describe('resolveRole', () => {
  test.each(['admin', 'manager', 'staff', 'agency'] as const)('recognizes role "%s"', (role) => {
    expect(resolveRole({ role })).toBe(role);
  });
  test('an unrecognized role string resolves to "none", never guessed', () => {
    expect(resolveRole({ role: 'owner' })).toBe('none');
  });
  test('no doc at all resolves to "none"', () => {
    expect(resolveRole(null)).toBe('none');
  });
  test('a doc with no role field resolves to "none"', () => {
    expect(resolveRole({})).toBe('none');
  });
});

describe('resolveAccountStatus — legacy-agency compatibility', () => {
  test('accountStatus: "SUSPENDED" resolves to SUSPENDED', () => {
    expect(resolveAccountStatus({ role: 'agency', accountStatus: 'SUSPENDED' })).toBe('SUSPENDED');
  });
  test('accountStatus: "ACTIVE" resolves to ACTIVE', () => {
    expect(resolveAccountStatus({ role: 'agency', accountStatus: 'ACTIVE' })).toBe('ACTIVE');
  });
  test('a manually-created legacy agency with NO accountStatus field at all is treated as ACTIVE, never blocked by absence', () => {
    expect(resolveAccountStatus({ role: 'agency' })).toBe('ACTIVE');
  });
  test('null/undefined doc resolves to ACTIVE (never throws, never blocks)', () => {
    expect(resolveAccountStatus(null)).toBe('ACTIVE');
    expect(resolveAccountStatus(undefined)).toBe('ACTIVE');
  });
  test('any value other than the literal string "SUSPENDED" is ACTIVE (matches functions-core/index.js callerRole()\'s own equality check)', () => {
    expect(resolveAccountStatus({ role: 'agency', accountStatus: 'suspended' })).toBe('ACTIVE');
    expect(resolveAccountStatus({ role: 'agency', accountStatus: '' })).toBe('ACTIVE');
  });
});

describe('buildResolvedSession', () => {
  test('normalizes the session email (trim + lowercase) regardless of Firebase Auth\'s own casing', () => {
    const result = buildResolvedSession({ authUser, userDoc: { role: 'admin' } });
    expect(result.normalizedEmail).toBe('person@example.com');
    expect(result.authUser.email).toBe('Person@Example.com'); // the raw AuthUser is preserved as-is
  });
  test('accountStatus is only ever populated for role "agency" -- null for every other role', () => {
    expect(buildResolvedSession({ authUser, userDoc: { role: 'admin' } }).accountStatus).toBeNull();
    expect(buildResolvedSession({ authUser, userDoc: { role: 'staff' } }).accountStatus).toBeNull();
    expect(
      buildResolvedSession({ authUser, userDoc: { role: 'agency', accountStatus: 'ACTIVE' } }).accountStatus,
    ).toBe('ACTIVE');
  });
  test('applicationStatus is only populated for role "none"', () => {
    const withDoc = buildResolvedSession({ authUser, userDoc: { role: 'staff' }, applicationStatus: 'PENDING_APPROVAL' });
    expect(withDoc.applicationStatus).toBeNull();
    const withoutDoc = buildResolvedSession({ authUser, userDoc: null, applicationStatus: 'PENDING_APPROVAL' });
    expect(withoutDoc.applicationStatus).toBe('PENDING_APPROVAL');
  });
});

describe('fetchResolvedSession — I/O orchestration with fake dependencies', () => {
  function fakeUsers(doc: RawUserDoc | null): FirestoreUserDocReader {
    return { getUserDoc: jest.fn(async () => doc) };
  }
  function fakeApplications(result: { status: 'NONE' | 'PENDING_APPROVAL' | 'REJECTED'; agencyName?: string }): ApplicationStatusReader {
    return { getMyApplicationStatus: jest.fn(async () => result) };
  }

  test('when a users/{email} doc exists, the applications reader is never called', async () => {
    const users = fakeUsers({ role: 'agency', accountStatus: 'ACTIVE' });
    const applications = fakeApplications({ status: 'NONE' });
    const session = await fetchResolvedSession(authUser, { users, applications });
    expect(session.role).toBe('agency');
    expect(applications.getMyApplicationStatus).not.toHaveBeenCalled();
  });
  test('when no users/{email} doc exists, the applications reader IS consulted for pending/rejected/none', async () => {
    const users = fakeUsers(null);
    const applications = fakeApplications({ status: 'PENDING_APPROVAL', agencyName: 'Test Co' });
    const session = await fetchResolvedSession(authUser, { users, applications });
    expect(session.role).toBe('none');
    expect(session.applicationStatus).toBe('PENDING_APPROVAL');
    expect(session.agencyName).toBe('Test Co');
    expect(applications.getMyApplicationStatus).toHaveBeenCalledTimes(1);
  });
  test('the Firestore reader is always called with the NORMALIZED email, never the raw Firebase Auth casing', async () => {
    const getUserDoc = jest.fn(async () => ({ role: 'admin' }));
    await fetchResolvedSession(authUser, { users: { getUserDoc }, applications: fakeApplications({ status: 'NONE' }) });
    expect(getUserDoc).toHaveBeenCalledWith('person@example.com');
  });
});
