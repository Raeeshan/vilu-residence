import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { Card } from './Card';

/**
 * Intentional empty placeholder for a future feature — never invented
 * numbers/fake data. Phase M1 only builds the auth/shell foundation; real
 * data wiring (reservations, packages, availability, etc.) is explicitly
 * out of scope until M2.
 */
export function PlaceholderScreen({ title, note }: { title: string; note?: string }) {
  const theme = useTheme();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <View style={styles.content}>
        <Text
          style={[styles.title, { color: theme.colors.textPrimary }]}
          accessibilityRole="header"
          maxFontSizeMultiplier={1.6}
        >
          {title}
        </Text>
        <Card style={styles.card}>
          <Text style={[styles.cardText, { color: theme.colors.textSecondary }]} maxFontSizeMultiplier={1.8}>
            {note ?? 'Coming in a future phase. No live data is wired up yet.'}
          </Text>
        </Card>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flex: 1, padding: 20, gap: 16 },
  title: { fontSize: 24, fontWeight: '700' },
  card: { alignItems: 'center', paddingVertical: 32 },
  cardText: { fontSize: 15, textAlign: 'center', lineHeight: 21 },
});
