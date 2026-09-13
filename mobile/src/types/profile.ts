/**
 * Vilu Mobile — shared profile/session/role types.
 *
 * These mirror the REAL, verified server-side contracts from the existing
 * web PMS/Agency Portal, not assumed field names:
 *  - `role` values come from functions-core/index.js's own callerRole()
 *    ('admin' | 'staff' | 'manager' | 'agency' | 'suspended' | 'none') and
 *    firestore.rules' isAdmin()/isStaff()/isManagerRole()/isAgency().
 *  - `accountStatus` ('ACTIVE' | 'SUSPENDED') is the Agency
 *    Self-Registration field on users/{email}; a pre-existing agency
 *    created before that feature has no accountStatus field at all and
 *    must be treated as ACTIVE (see resolveAccountStatus in
 *    profileService.ts) -- never assumed missing = blocked.
 *  - Application status values ('NONE' | 'PENDING_APPROVAL' | 'REJECTED')
 *    come from getMyAgencyApplicationStatus()'s real return shape.
 */

/** Every role users/{email}.role (or the hardcoded admin email) can resolve to. */
export type UserRole = 'admin' | 'manager' | 'staff' | 'agency' | 'none';

/** Agency account status, mirroring users/{email}.accountStatus exactly. */
export type AccountStatus = 'ACTIVE' | 'SUSPENDED';

/** getMyAgencyApplicationStatus()'s real `status` values. */
export type ApplicationStatus = 'NONE' | 'PENDING_APPROVAL' | 'REJECTED';

/** The raw, minimally-typed shape of a users/{email} Firestore document. */
export interface RawUserDoc {
  role?: string;
  accountStatus?: string;
  name?: string;
  company?: string;
  commission?: number;
  uid?: string;
}

/** The authenticated Firebase Auth identity, independent of Firestore profile. */
export interface AuthUser {
  uid: string;
  /** Exactly as Firebase Auth returns it -- may not be lower-case. */
  email: string;
  emailVerified: boolean;
}

/**
 * ResolvedSession: the ONE object the rest of the app reads to decide what
 * to show. Deliberately flat and serializable (no class instances) so it is
 * trivial to unit test the pure guard functions in navigation/guards.ts
 * against plain object fixtures.
 */
export interface ResolvedSession {
  authUser: AuthUser;
  /** Always the normalized (trim + lowercase) form -- see utils/email.ts. */
  normalizedEmail: string;
  role: UserRole;
  accountStatus: AccountStatus | null;
  /** Only meaningful when role === 'none' (no users/{email} doc yet). */
  applicationStatus: ApplicationStatus | null;
  agencyName: string | null;
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; session: ResolvedSession };

/** A clean, user-facing outcome for "should this variant let this session in". */
export interface AccessDecision {
  allowed: boolean;
  /**
   * Where an unauthorized/blocked session should land instead of the normal
   * shell. `null` when allowed === true.
   */
  redirect:
    | null
    | 'unauthorized'
    | 'pending'
    | 'rejected'
    | 'suspended';
}
