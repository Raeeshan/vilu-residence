import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/state/useAuth';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';

export default function MoreScreen() {
  const theme = useTheme();
  const { authState, signOut } = useAuth();
  const session = authState.status === 'signed-in' ? authState.session : null;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]} accessibilityRole="header">
          More
        </Text>
        <Card>
          <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Signed in as</Text>
          <Text style={[styles.value, { color: theme.colors.textPrimary }]}>{session?.authUser.email}</Text>
        </Card>
        <Button label="Sign out" variant="danger" onPress={signOut} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flex: 1, padding: 20, gap: 16 },
  title: { fontSize: 24, fontWeight: '700' },
  label: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', marginBottom: 4 },
  value: { fontSize: 16, fontWeight: '600' },
});
