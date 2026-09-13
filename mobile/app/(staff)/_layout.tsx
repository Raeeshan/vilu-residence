import React from 'react';
import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '../../src/state/useAuth';
import { useTheme } from '../../src/theme/ThemeProvider';
import { resolveStaffAccess } from '../../src/navigation/guards';

/**
 * Route-group-level guard (defense in depth beyond app/index.tsx's own
 * redirect): even a direct deep link straight at /(staff)/reservations
 * mounts THIS layout first, which re-checks resolveStaffAccess() against
 * the live AuthState and redirects before any Staff screen ever renders.
 * There is no code path into a (staff) screen that skips this check.
 */
export default function StaffLayout() {
  const { authState } = useAuth();
  const theme = useTheme();

  if (authState.status === 'loading') return null;

  const decision = resolveStaffAccess(authState);
  if (!decision.allowed) {
    return <Redirect href={`/status/${decision.redirect}`} />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        tabBarStyle: { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today' }} />
      <Tabs.Screen name="reservations" options={{ title: 'Reservations' }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar' }} />
      <Tabs.Screen name="guests" options={{ title: 'Guests' }} />
      <Tabs.Screen name="agency-requests" options={{ title: 'Agency' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}
