import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../src/state/useAuth';
import { useTheme } from '../src/theme/ThemeProvider';
import { APP_VARIANT } from '../src/config/variant';
import { resolveAgencyAccess, resolveStaffAccess } from '../src/navigation/guards';

/**
 * The ONE routing decision point. Reads AuthState, applies the guard for
 * whichever APP_VARIANT this build is, and redirects — never renders
 * protected content itself. Deep-linking straight at a protected route
 * still passes through each route group's own layout guard (see
 * app/(staff)/_layout.tsx and app/(agency)/_layout.tsx), so this is a
 * convenience redirect, not the only enforcement point.
 */
export default function Index() {
  const { authState } = useAuth();
  const theme = useTheme();

  if (authState.status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background }}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  if (authState.status === 'signed-out') {
    return <Redirect href="/(auth)/login" />;
  }

  const decision = APP_VARIANT === 'staff' ? resolveStaffAccess(authState) : resolveAgencyAccess(authState);

  if (!decision.allowed) {
    return <Redirect href={`/status/${decision.redirect}`} />;
  }

  return <Redirect href={APP_VARIANT === 'staff' ? '/(staff)' : '/(agency)'} />;
}
