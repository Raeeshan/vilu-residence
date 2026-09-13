import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '../../src/state/useAuth';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Button } from '../../src/components/Button';
import { isValidEmailFormat } from '../../src/utils/email';

export default function ForgotPasswordScreen() {
  const theme = useTheme();
  const { sendPasswordReset } = useAuth();

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    if (!isValidEmailFormat(email)) return;
    setSubmitting(true);
    setErrorMessage(null);
    const result = await sendPasswordReset(email);
    setSubmitting(false);
    if (result.ok) {
      setSent(true);
    } else if (result.error) {
      setErrorMessage(result.error.message);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={[styles.title, { color: theme.colors.textPrimary }]} accessibilityRole="header">
            Reset your password
          </Text>

          {sent ? (
            <>
              <Text style={[styles.body, { color: theme.colors.textSecondary }]} accessibilityLiveRegion="polite">
                If an account exists for {email.trim()}, a password reset link has been sent. Check your inbox.
              </Text>
              <Button label="Back to sign in" variant="secondary" onPress={() => router.replace('/(auth)/login')} />
            </>
          ) : (
            <>
              <Text style={[styles.body, { color: theme.colors.textSecondary }]}>
                Enter the email you use to sign in. We&rsquo;ll send a reset link.
              </Text>
              <View style={styles.field}>
                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Email</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="name@example.com"
                  placeholderTextColor={theme.colors.textSecondary}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  textContentType="username"
                  accessibilityLabel="Email address"
                  style={[styles.input, { color: theme.colors.textPrimary, borderColor: theme.colors.border }]}
                />
              </View>
              {errorMessage ? (
                <Text style={[styles.error, { color: theme.colors.danger }]} role="alert">
                  {errorMessage}
                </Text>
              ) : null}
              <Button
                label="Send reset link"
                onPress={handleSubmit}
                loading={submitting}
                disabled={!isValidEmailFormat(email) || submitting}
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  body: { fontSize: 15, textAlign: 'center', lineHeight: 21, marginBottom: 20 },
  field: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 16 },
  error: { fontSize: 14, marginBottom: 12, textAlign: 'center' },
});
