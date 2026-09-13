/**
 * Email normalization -- ONE place, reused everywhere a users/{email}
 * document id or Firebase Auth email is compared.
 *
 * This exists because of a REAL bug found and fixed in the web Agency
 * Portal (2026-09-13): fetchAgencyProfile() looked up users/{email} using
 * whatever casing Firebase Auth handed back for fbUser.email, never
 * lower-cased -- but every real users/{id} doc in this codebase is always
 * keyed lower-case (self-registration, the PMS's own authenticateUser(),
 * and firestore.rules' own `.lower()` convention). A mismatch silently
 * returned null and was misread as "not set up for access" for a
 * perfectly valid account. The mobile client must never reintroduce that
 * class of bug -- every Firestore users/{id} lookup in this app goes
 * through normalizeEmail() first.
 */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

export function isValidEmailFormat(email: string): boolean {
  const trimmed = email.trim();
  if (!trimmed) return false;
  // Deliberately permissive (matches what Firebase Auth itself will accept
  // or reject) -- this is a UX pre-check, not a security boundary.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}
