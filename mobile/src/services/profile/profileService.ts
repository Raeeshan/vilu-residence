/**
 * Profile resolution — turns a Firebase Auth identity + whatever Firestore/
 * callable data is available into ONE ResolvedSession the rest of the app
 * reads. Split deliberately into:
 *   - pure, dependency-free mapping functions (resolveRole,
 *     resolveAccountStatus, buildResolvedSession) — fully unit-testable
 *     with plain object fixtures, no Firebase SDK involved;
 *   - `fetchResolvedSession`, the thin I/O wrapper that actually talks to
 *     Firestore/the applicationStatus callable, mirroring the EXACT same
 *     contract the web Agency Portal's fetchAgencyProfile() and
 *     getMyAgencyApplicationStatus() already use, never re-implementing
 *     the role/status/application model from scratch.
 *
 * This is the ONE place users/{email} is read client-side and the ONE
 * place the applicationStatus callable is invoked from — every screen and
 * guard reads the resulting ResolvedSession, never Firestore directly.
 */
import { normalizeEmail } from '../../utils/email';
import type {
  AccountStatus,
  ApplicationStatus,
  AuthUser,
  RawUserDoc,
  ResolvedSession,
  UserRole,
} from '../../types/profile';

const VALID_ROLES: ReadonlySet<string> = new Set(['admin', 'manager', 'staff', 'agency']);

/**
 * A users/{email} doc with no accountStatus field at all is a legacy
 * agency created before Agency Self-Registration (2026-09-13) — it must be
 * treated as ACTIVE, matching functions-core/index.js's own callerRole()
 * (which only ever flips to the 'suspended' sentinel when
 * accountStatus === 'SUSPENDED' exactly). Anything other than the literal
 * string 'SUSPENDED' is ACTIVE — never inferred from absence being "unsafe".
 */
export function resolveAccountStatus(raw: RawUserDoc | null | undefined): AccountStatus {
  return raw?.accountStatus === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';
}

/**
 * Mirrors callerRole()'s own role resolution for the roles a users/{email}
 * doc can carry (admin is ALSO reachable via the doc — the server's
 * hardcoded-admin-email fallback is a defense-in-depth detail the mobile
 * client does not need to duplicate, since the real admin account's own
 * users/{email} doc already carries role:'admin', proven live by the web
 * Agency Portal's Admin Preview). An unrecognized/missing role resolves to
 * 'none', never a guessed default.
 */
export function resolveRole(raw: RawUserDoc | null | undefined): UserRole {
  const role = raw?.role;
  if (typeof role === 'string' && VALID_ROLES.has(role)) return role as UserRole;
  return 'none';
}

export interface BuildResolvedSessionParams {
  authUser: AuthUser;
  userDoc: RawUserDoc | null;
  /** Only fetched/relevant when userDoc is null (role would resolve to 'none'). */
  applicationStatus?: ApplicationStatus | null;
  agencyName?: string | null;
}

export function buildResolvedSession(params: BuildResolvedSessionParams): ResolvedSession {
  const role = resolveRole(params.userDoc);
  return {
    authUser: params.authUser,
    normalizedEmail: normalizeEmail(params.authUser.email),
    role,
    accountStatus: role === 'agency' ? resolveAccountStatus(params.userDoc) : null,
    applicationStatus: role === 'none' ? params.applicationStatus ?? 'NONE' : null,
    agencyName: params.agencyName ?? params.userDoc?.company ?? params.userDoc?.name ?? null,
  };
}

/**
 * Firestore + callable I/O. Kept intentionally thin — all the actual
 * decision logic lives in the pure functions above. Callers inject the
 * Firestore/functions clients so this stays testable without booting a
 * real Firebase app; the app's real call site (state/AuthProvider.tsx)
 * passes the real @react-native-firebase instances.
 */
export interface FirestoreUserDocReader {
  getUserDoc(normalizedEmail: string): Promise<RawUserDoc | null>;
}
export interface ApplicationStatusReader {
  getMyApplicationStatus(): Promise<{ status: ApplicationStatus; agencyName?: string }>;
}

export async function fetchResolvedSession(
  authUser: AuthUser,
  deps: { users: FirestoreUserDocReader; applications: ApplicationStatusReader },
): Promise<ResolvedSession> {
  const normalizedEmail = normalizeEmail(authUser.email);
  const userDoc = await deps.users.getUserDoc(normalizedEmail);

  if (userDoc) {
    return buildResolvedSession({ authUser, userDoc });
  }

  // No users/{email} doc at all -- either never applied, a pending
  // applicant, or a rejected one. getMyAgencyApplicationStatus() is the
  // SAME callable the web Agency Portal already uses for this exact case
  // (see showStatusScreenIfApplicant()) -- never a second, parallel status
  // model invented for mobile.
  const application = await deps.applications.getMyApplicationStatus();
  return buildResolvedSession({
    authUser,
    userDoc: null,
    applicationStatus: application.status,
    agencyName: application.agencyName ?? null,
  });
}
