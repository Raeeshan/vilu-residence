import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/state/useAuth';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Card } from '../../src/components/Card';
import { Badge } from '../../src/components/Badge';

export default function AgencyPackagesScreen() {
  const theme = useTheme();
  const { authState } = useAuth();
  const session = authState.status === 'signed-in' ? authState.session : null;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text
          style={[styles.brand, { color: theme.colors.accent }]}
          accessibilityRole="header"
          maxFontSizeMultiplier={1.4}
        >
          Vilu Agency
        </Text>

        <Card>
          <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Agency</Text>
          <Text style={[styles.value, { color: theme.colors.textPrimary }]} maxFontSizeMultiplier={1.6}>
            {session?.agencyName || session?.authUser.email || '—'}
          </Text>
          <Text style={[styles.email, { color: theme.colors.textSecondary }]}>{session?.authUser.email}</Text>
          <View style={styles.badgeRow}>
            <Badge label="Active" tone="success" />
          </View>
        </Card>

        <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>Your packages</Text>
        <Card>
          <Text style={[styles.placeholder, { color: theme.colors.textSecondary }]} maxFontSizeMultiplier={1.8}>
            Your assigned packages will appear here once live data is wired up in a future phase.
          </Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 20, gap: 16 },
  brand: { fontSize: 26, fontWeight: '700', marginBottom: 4 },
  label: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  value: { fontSize: 17, fontWeight: '600' },
  email: { fontSize: 13, marginBottom: 10 },
  badgeRow: { flexDirection: 'row' },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginTop: 8 },
  placeholder: { fontSize: 14, lineHeight: 20 },
});
