/**
 * Thin, typed wrapper around Firebase Auth (React Native Firebase). Screens
 * and the AuthProvider only ever call these functions — never
 * `@react-native-firebase/auth` directly — so the whole app has ONE place
 * that talks to Firebase Auth.
 *
 * Session persistence: React Native Firebase's native Auth SDK persists
 * the signed-in session itself (Keychain on iOS, encrypted storage on
 * Android) — there is no custom token/session storage in this app, no
 * AsyncStorage, no SecureStore for auth state. `onAuthStateChanged` below
 * is what restores a session on app launch, exactly like the existing web
 * apps' own onAuthStateChanged listener.
 *
 * Passwords are NEVER read back out of Firebase Auth, logged, stored in
 * Firestore, AsyncStorage, SecureStore, or attached to Crashlytics/
 * analytics — this module only ever sends a password INTO
 * signInWithEmailAndPassword, once, and never touches it again.
 */
import { getFirebaseAuth } from '../firebase/firebase';
import { normalizeEmail } from '../../utils/email';
import { toCleanError, type CleanError } from '../../utils/errors';
import type { AuthUser } from '../../types/profile';

export interface SignInResult {
  ok: true;
  user: AuthUser;
}
export interface SignInFailure {
  ok: false;
  error: CleanError;
}

function toAuthUser(fbUser: { uid: string; email: string | null; emailVerified: boolean }): AuthUser {
  return {
    uid: fbUser.uid,
    email: fbUser.email ?? '',
    emailVerified: fbUser.emailVerified,
  };
}

export async function signIn(emailInput: string, password: string): Promise<SignInResult | SignInFailure> {
  try {
    const email = normalizeEmail(emailInput);
    const credential = await getFirebaseAuth().signInWithEmailAndPassword(email, password);
    return { ok: true, user: toAuthUser(credential.user) };
  } catch (error) {
    return { ok: false, error: toCleanError(error) };
  }
}

export async function signOut(): Promise<void> {
  await getFirebaseAuth().signOut();
}

export interface PasswordResetResult {
  ok: boolean;
  error?: CleanError;
}

export async function sendPasswordReset(emailInput: string): Promise<PasswordResetResult> {
  try {
    const email = normalizeEmail(emailInput);
    await getFirebaseAuth().sendPasswordResetEmail(email);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toCleanError(error) };
  }
}

/**
 * Subscribes to Firebase Auth's own session-restoration listener. Fires
 * once on launch with whatever session the native SDK already restored
 * (or null if signed out), then again on every sign-in/sign-out. Returns
 * the unsubscribe function.
 */
export function onAuthStateChanged(callback: (user: AuthUser | null) => void): () => void {
  return getFirebaseAuth().onAuthStateChanged((fbUser) => {
    callback(fbUser ? toAuthUser(fbUser) : null);
  });
}

export function getCurrentAuthUser(): AuthUser | null {
  const fbUser = getFirebaseAuth().currentUser;
  return fbUser ? toAuthUser(fbUser) : null;
}
