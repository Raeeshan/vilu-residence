import React, { useEffect } from 'react';
import { Slot } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider } from '../src/state/AuthProvider';
import { useAuth } from '../src/state/useAuth';
import { ThemeProvider } from '../src/theme/ThemeProvider';

void SplashScreen.preventAutoHideAsync().catch(() => {
  /* no-op: safe if already hidden or unsupported (e.g. web preview) */
});

function SplashGate({ children }: { children: React.ReactNode }) {
  const { authState } = useAuth();

  useEffect(() => {
    if (authState.status !== 'loading') {
      void SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [authState.status]);

  return <>{children}</>;
}

/**
 * Root layout for BOTH app variants — variant selection happens inside the
 * (staff)/(agency) route groups' own guards (src/navigation/guards.ts), not
 * here. AuthProvider/ThemeProvider wrap the whole app exactly once.
 */
export default function RootLayout() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SplashGate>
          <Slot />
        </SplashGate>
      </AuthProvider>
    </ThemeProvider>
  );
}
