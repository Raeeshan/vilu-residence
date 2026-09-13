import React from 'react';
import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '../../src/state/useAuth';
import { useTheme } from '../../src/theme/ThemeProvider';
import { resolveAgencyAccess } from '../../src/navigation/guards';

/**
 * Route-group-level guard, mirroring app/(staff)/_layout.tsx exactly —
 * see that file's own comment. A deep link straight into
 * /(agency)/availability still passes through this guard first.
 */
export default function AgencyLayout() {
  const { authState } = useAuth();
  const theme = useTheme();

  if (authState.status === 'loading') return null;

  const decision = resolveAgencyAccess(authState);
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
      <Tabs.Screen name="index" options={{ title: 'Packages' }} />
      <Tabs.Screen name="availability" options={{ title: 'Availability' }} />
      <Tabs.Screen name="quotations" options={{ title: 'Quotations' }} />
      <Tabs.Screen name="bookings" options={{ title: 'Bookings' }} />
      <Tabs.Screen name="earnings" options={{ title: 'Earnings' }} />
      <Tabs.Screen name="account" options={{ title: 'Account' }} />
    </Tabs>
  );
}
