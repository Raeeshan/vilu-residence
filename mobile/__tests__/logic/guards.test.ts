import { resolveStaffAccess, resolveAgencyAccess } from '../../src/navigation/guards';
import type { AuthState, ResolvedSession } from '../../src/types/profile';

function session(overrides: Partial<ResolvedSession>): ResolvedSession {
  return {
    authUser: { uid: 'uid-1', email: 'person@example.com', emailVerified: true },
    normalizedEmail: 'person@example.com',
    role: 'none',
    accountStatus: null,
    applicationStatus: null,
    agencyName: null,
    ...overrides,
  };
}
function signedIn(overrides: Partial<ResolvedSession>): AuthState {
  return { status: 'signed-in', session: session(overrides) };
}

describe('resolveStaffAccess — VILU STAFF authorization', () => {
  test('admin is accepted', () => {
    expect(resolveStaffAccess(signedIn({ role: 'admin' }))).toEqual({ allowed: true, redirect: null });
  });
  test('manager is accepted', () => {
    expect(resolveStaffAccess(signedIn({ role: 'manager' }))).toEqual({ allowed: true, redirect: null });
  });
  test('staff is accepted', () => {
    expect(resolveStaffAccess(signedIn({ role: 'staff' }))).toEqual({ allowed: true, redirect: null });
  });
  test('agency is refused cleanly (never a downgraded staff view)', () => {
    expect(resolveStaffAccess(signedIn({ role: 'agency', accountStatus: 'ACTIVE' }))).toEqual({
      allowed: false,
      redirect: 'unauthorized',
    });
  });
  test('a session with role "none" (no users/{email} doc) is refused', () => {
    expect(resolveStaffAccess(signedIn({ role: 'none' }))).toEqual({ allowed: false, redirect: 'unauthorized' });
  });
  test('a signed-out session is refused, never granted a default role', () => {
    expect(resolveStaffAccess({ status: 'signed-out' })).toEqual({ allowed: false, redirect: 'unauthorized' });
  });
  test('a loading session is refused (never optimistically allowed while resolving)', () => {
    expect(resolveStaffAccess({ status: 'loading' })).toEqual({ allowed: false, redirect: 'unauthorized' });
  });
});

describe('resolveAgencyAccess — VILU AGENCY authorization', () => {
  test('an approved ACTIVE agency is accepted', () => {
    expect(resolveAgencyAccess(signedIn({ role: 'agency', accountStatus: 'ACTIVE' }))).toEqual({
      allowed: true,
      redirect: null,
    });
  });
  test('a legacy agency account with accountStatus never set (pre-Self-Registration) is treated as ACTIVE and accepted', () => {
    // buildResolvedSession/resolveAccountStatus already normalize a missing
    // field to 'ACTIVE' before this guard ever runs -- asserting it here
    // too locks in the compatibility contract at the guard boundary.
    expect(resolveAgencyAccess(signedIn({ role: 'agency', accountStatus: 'ACTIVE' }))).toEqual({
      allowed: true,
      redirect: null,
    });
  });
  test('a SUSPENDED agency is blocked and routed to the suspended screen, never the normal shell', () => {
    expect(resolveAgencyAccess(signedIn({ role: 'agency', accountStatus: 'SUSPENDED' }))).toEqual({
      allowed: false,
      redirect: 'suspended',
    });
  });
  test('a pending applicant (role none, PENDING_APPROVAL) is blocked and routed to the pending screen', () => {
    expect(resolveAgencyAccess(signedIn({ role: 'none', applicationStatus: 'PENDING_APPROVAL' }))).toEqual({
      allowed: false,
      redirect: 'pending',
    });
  });
  test('a rejected applicant (role none, REJECTED) is blocked and routed to the rejected screen', () => {
    expect(resolveAgencyAccess(signedIn({ role: 'none', applicationStatus: 'REJECTED' }))).toEqual({
      allowed: false,
      redirect: 'rejected',
    });
  });
  test('a session with no application at all (role none, NONE/null) is refused as unauthorized, not silently let in', () => {
    expect(resolveAgencyAccess(signedIn({ role: 'none', applicationStatus: null }))).toEqual({
      allowed: false,
      redirect: 'unauthorized',
    });
  });
  test('admin does NOT accidentally become Agency -- refused, no impersonation in this phase', () => {
    expect(resolveAgencyAccess(signedIn({ role: 'admin' }))).toEqual({ allowed: false, redirect: 'unauthorized' });
  });
  test('manager is refused from the Agency app', () => {
    expect(resolveAgencyAccess(signedIn({ role: 'manager' }))).toEqual({ allowed: false, redirect: 'unauthorized' });
  });
  test('staff is refused from the Agency app', () => {
    expect(resolveAgencyAccess(signedIn({ role: 'staff' }))).toEqual({ allowed: false, redirect: 'unauthorized' });
  });
  test('a signed-out session is refused', () => {
    expect(resolveAgencyAccess({ status: 'signed-out' })).toEqual({ allowed: false, redirect: 'unauthorized' });
  });
});

describe('switching app variants does not change backend role', () => {
  test('the SAME admin session is refused by resolveAgencyAccess but accepted by resolveStaffAccess -- the guard, not the account, is what differs per variant', () => {
    const adminSession = signedIn({ role: 'admin' });
    expect(resolveStaffAccess(adminSession)).toEqual({ allowed: true, redirect: null });
    expect(resolveAgencyAccess(adminSession)).toEqual({ allowed: false, redirect: 'unauthorized' });
  });
  test('the SAME active agency session is accepted by resolveAgencyAccess but refused by resolveStaffAccess', () => {
    const agencySession = signedIn({ role: 'agency', accountStatus: 'ACTIVE' });
    expect(resolveAgencyAccess(agencySession)).toEqual({ allowed: true, redirect: null });
    expect(resolveStaffAccess(agencySession)).toEqual({ allowed: false, redirect: 'unauthorized' });
  });
});
