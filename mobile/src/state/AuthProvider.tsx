import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged as subscribeAuthState, signIn, signOut, sendPasswordReset } from '../services/auth/authService';
import { fetchResolvedSession } from '../services/profile/profileService';
import { usersRepository } from '../services/profile/usersRepository';
import { getMyApplicationStatus } from '../services/api/applicationService';
import type { AuthState } from '../types/profile';
import type { CleanError } from '../utils/errors';

export interface AuthContextValue {
  authState: AuthState;
  signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: CleanError }>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<{ ok: boolean; error?: CleanError }>;
  /** Re-runs profile resolution without a full sign-out/sign-in (e.g. after approval). */
  refreshSession: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const applicationStatusReader = { getMyApplicationStatus };

/**
 * Boots session restoration on mount (Firebase Auth's own native
 * persistence, not anything this app stores itself — see authService.ts),
 * resolves the full profile for whatever session comes back, and exposes
 * ONE AuthState the rest of the app reads. Every screen's protected-route
 * check goes through navigation/guards.ts against this same AuthState —
 * there is no second, parallel session model anywhere in the app.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading' });

  const resolveForUser = useCallback(async (uid: string, email: string, emailVerified: boolean) => {
    try {
      const session = await fetchResolvedSession(
        { uid, email, emailVerified },
        { users: usersRepository, applications: applicationStatusReader },
      );
      setAuthState({ status: 'signed-in', session });
    } catch {
      // Profile resolution failed (network/Firestore outage) -- fail closed
      // to signed-out rather than guessing a role, per this project's own
      // "server authority, never assume" principle.
      setAuthState({ status: 'signed-out' });
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeAuthState((user) => {
      if (!user) {
        setAuthState({ status: 'signed-out' });
        return;
      }
      setAuthState({ status: 'loading' });
      void resolveForUser(user.uid, user.email, user.emailVerified);
    });
    return unsubscribe;
  }, [resolveForUser]);

  const value = useMemo<AuthContextValue>(
    () => ({
      authState,
      signIn: async (email, password) => {
        const result = await signIn(email, password);
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true };
      },
      signOut: async () => {
        await signOut();
      },
      sendPasswordReset: async (email) => {
        const result = await sendPasswordReset(email);
        return result.ok ? { ok: true } : { ok: false, error: result.error };
      },
      refreshSession: async () => {
        const fbUser = authState.status === 'signed-in' ? authState.session.authUser : null;
        if (fbUser) await resolveForUser(fbUser.uid, fbUser.email, fbUser.emailVerified);
      },
    }),
    [authState, resolveForUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
