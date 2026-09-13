import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link } from 'expo-router';
import { useAuth } from '../../src/state/useAuth';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Button } from '../../src/components/Button';
import { isValidEmailFormat } from '../../src/utils/email';
import { getVariantIdentity } from '../../src/config/variant';

export default function LoginScreen() {
  const theme = useTheme();
  const { signIn } = useAuth();
  const identity = getVariantIdentity();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canSubmit = isValidEmailFormat(email) && password.length > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMessage(null);
    const result = await signIn(email, password);
    setSubmitting(false);
    if (!result.ok && result.error) {
      setErrorMessage(result.error.message);
    }
    // On success, AuthProvider's onAuthStateChanged listener updates
    // authState and app/index.tsx's guard redirects to the right shell —
    // this screen does not navigate itself.
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text
            style={[styles.brand, { color: theme.colors.accent }]}
            accessibilityRole="header"
            maxFontSizeMultiplier={1.4}
          >
            {identity.displayName}
          </Text>
          <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]} maxFontSizeMultiplier={1.6}>
            Vilu Residence Maamigili
          </Text>

          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="name@example.com"
              placeholderTextColor={theme.colors.textSecondary}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="username"
              accessibilityLabel="Email address"
              style={[styles.input, { color: theme.colors.textPrimary, borderColor: theme.colors.border }]}
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={theme.colors.textSecondary}
              secureTextEntry
              autoComplete="password"
              textContentType="password"
              accessibilityLabel="Password"
              style={[styles.input, { color: theme.colors.textPrimary, borderColor: theme.colors.border }]}
            />
          </View>

          {errorMessage ? (
            <Text
              style={[styles.error, { color: theme.colors.danger }]}
              accessibilityLiveRegion="polite"
              role="alert"
            >
              {errorMessage}
            </Text>
          ) : null}

          <Button label="Sign in" onPress={handleSubmit} loading={submitting} disabled={!canSubmit} />

          <Link href="/(auth)/forgot-password" style={[styles.link, { color: theme.colors.accent }]}>
            Forgot password?
          </Link>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 4 },
  brand: { fontSize: 28, fontWeight: '700', textAlign: 'center' },
  subtitle: { fontSize: 15, textAlign: 'center', marginBottom: 32 },
  field: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  error: { fontSize: 14, marginBottom: 12, textAlign: 'center' },
  link: { textAlign: 'center', marginTop: 20, fontSize: 15, fontWeight: '600' },
});
