/**
 * Pure route-guard decisions for the two app variants. These functions are
 * the ONLY place "should this session see the Staff/Agency shell" is
 * decided client-side — and per this project's own explicit security
 * principle, they are NOT the security boundary. They exist purely to
 * route the UI correctly and avoid showing the wrong shell; every
 * sensitive read/write still goes through a Cloud Function or Firestore
 * rule that independently re-derives role/status/ownership from
 * request.auth, never trusting anything this file decided.
 *
 * Deliberately pure (ResolvedSession in, AccessDecision out) so every
 * scenario in the task's own test list can be asserted with a plain object
 * fixture — no React, no navigation library, no Firebase mock needed.
 */
import type { AccessDecision, AuthState, ResolvedSession } from '../types/profile';

const STAFF_ROLES: ReadonlySet<ResolvedSession['role']> = new Set(['admin', 'manager', 'staff']);

/**
 * VILU STAFF authorization: admin, manager, or staff — exactly, never a
 * downgraded/widened set. An agency session (or an unresolved 'none') is
 * refused cleanly, never silently granted read-only access.
 */
export function resolveStaffAccess(authState: AuthState): AccessDecision {
  if (authState.status !== 'signed-in') return { allowed: false, redirect: 'unauthorized' };
  const { role } = authState.session;
  if (STAFF_ROLES.has(role)) return { allowed: true, redirect: null };
  return { allowed: false, redirect: 'unauthorized' };
}

/**
 * VILU AGENCY authorization: an approved, active agency account only.
 * Admin/Manager/Staff are deliberately refused here too — this phase does
 * not implement agency impersonation/Admin Preview for mobile (explicit
 * product decision; the web Agency Portal's separate Admin Preview screen
 * is a distinct, already-shipped feature this app does not need to copy
 * yet). A pending/rejected applicant, or a suspended agency, is routed to
 * its own status screen, never the normal Agency shell.
 */
export function resolveAgencyAccess(authState: AuthState): AccessDecision {
  if (authState.status !== 'signed-in') return { allowed: false, redirect: 'unauthorized' };
  const { session } = authState;

  if (session.role === 'agency') {
    if (session.accountStatus === 'SUSPENDED') return { allowed: false, redirect: 'suspended' };
    return { allowed: true, redirect: null };
  }

  if (session.role === 'none') {
    if (session.applicationStatus === 'PENDING_APPROVAL') return { allowed: false, redirect: 'pending' };
    if (session.applicationStatus === 'REJECTED') return { allowed: false, redirect: 'rejected' };
    return { allowed: false, redirect: 'unauthorized' };
  }

  // admin / manager / staff signed into the Agency variant.
  return { allowed: false, redirect: 'unauthorized' };
}
