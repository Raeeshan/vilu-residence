import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';

export interface StatusScreenProps {
  icon: string;
  title: string;
  message: string;
  onSignOut?: () => void;
  onRetry?: () => void;
}

/**
 * Shared full-screen state for every "you're signed in, but not into the
 * normal shell" case: unauthorized role, pending/rejected application,
 * suspended account. Copy is written from the reader's side (what
 * happened, what to do), never a raw backend message.
 */
export function StatusScreen({ icon, title, message, onSignOut, onRetry }: StatusScreenProps) {
  const theme = useTheme();
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.content}>
        <Text style={styles.icon} accessibilityElementsHidden importantForAccessibility="no">
          {icon}
        </Text>
        <Text
          style={[styles.title, { color: theme.colors.textPrimary }]}
          accessibilityRole="header"
          maxFontSizeMultiplier={1.6}
        >
          {title}
        </Text>
        <Text style={[styles.message, { color: theme.colors.textSecondary }]} maxFontSizeMultiplier={1.8}>
          {message}
        </Text>
        <View style={styles.actions}>
          {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} /> : null}
          {onSignOut ? <Button label="Sign out" variant="secondary" onPress={onSignOut} /> : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  icon: { fontSize: 40, marginBottom: 8 },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  message: { fontSize: 16, textAlign: 'center', lineHeight: 22 },
  actions: { marginTop: 20, gap: 12, width: '100%', maxWidth: 320 },
});
