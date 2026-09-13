/**
 * Maps raw Firebase/Cloud-Function errors to clean, user-facing messages.
 * Full technical detail (error.code, error.message, stack) is only ever
 * passed to `devLog`, never rendered -- see the module comment below.
 *
 * Never surface to the user:
 *  - raw FirebaseError objects / their .message
 *  - Cloud Function internal error text
 *  - Firestore/collection names
 *  - stack traces
 */

export interface CleanError {
  message: string;
  /** True for errors the user can retry themselves (network, timeout). */
  retryable: boolean;
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/user-not-found': 'Incorrect email or password. Please try again.',
  'auth/wrong-password': 'Incorrect email or password. Please try again.',
  'auth/invalid-credential': 'Incorrect email or password. Please try again.',
  'auth/user-disabled': 'This account has been disabled. Contact Vilu Residence.',
  'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
  'auth/missing-password': 'Enter your password.',
};

const FUNCTIONS_ERROR_MESSAGES: Record<string, string> = {
  'permission-denied': "You don't have access to do that.",
  unauthenticated: 'Please sign in again.',
  'invalid-argument': 'Something about this request was invalid. Please try again.',
  'not-found': 'That item could not be found.',
  'failed-precondition': 'This action can’t be completed right now.',
  'resource-exhausted': 'Too many requests. Please wait a moment and try again.',
  internal: 'Something went wrong. Please try again.',
  unavailable: 'Vilu services are temporarily unavailable. Please try again shortly.',
};

const RETRYABLE_CODES = new Set([
  'auth/network-request-failed',
  'auth/too-many-requests',
  'unavailable',
  'resource-exhausted',
  'deadline-exceeded',
]);

/** Narrow shape covering both a Firebase Auth error and an onCall HttpsError. */
interface FirebaseLikeError {
  code?: string;
  message?: string;
}

export function toCleanError(error: unknown): CleanError {
  const code = extractCode(error);
  devLog(error);

  if (code && AUTH_ERROR_MESSAGES[code]) {
    return { message: AUTH_ERROR_MESSAGES[code], retryable: RETRYABLE_CODES.has(code) };
  }
  if (code && FUNCTIONS_ERROR_MESSAGES[code]) {
    return { message: FUNCTIONS_ERROR_MESSAGES[code], retryable: RETRYABLE_CODES.has(code) };
  }
  return {
    message: 'Something went wrong. Please try again.',
    retryable: false,
  };
}

function extractCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as FirebaseLikeError;
  return typeof e.code === 'string' ? e.code : null;
}

/**
 * The ONE place raw error detail is allowed to surface -- development
 * console only, never Crashlytics custom keys/user-facing UI/analytics
 * event payloads. Swapped for a no-op (or a Crashlytics recordError with
 * no user-identifying context) in a production build via __DEV__.
 */
function devLog(error: unknown): void {
  // eslint-disable-next-line no-console
  if (typeof __DEV__ === 'undefined' || __DEV__) console.warn('[vilu-mobile] error', error);
}
