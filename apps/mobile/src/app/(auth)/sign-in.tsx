import { GoogleSigninButton } from '@react-native-google-signin/google-signin';
import { router } from 'expo-router';
import { useState, type ReactElement } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { AuthScreen, authStyles, FormError, PrimaryButton } from '@/components/auth-screen';
import { AuthActionError, sendEmailCode, signInWithGoogle } from '@/lib/auth';
import { colors, fonts } from '@/lib/theme';

type Pending = 'email' | 'google' | null;

export default function SignInScreen(): ReactElement {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);

  async function submitEmail() {
    if (pending !== null) {
      return;
    }

    setPending('email');
    setError(null);
    try {
      const sentTo = await sendEmailCode(email);

      router.push({ pathname: '/verify', params: { email: sentTo } });
    } catch (caught) {
      setError(caught instanceof AuthActionError ? caught.message : 'Something went wrong.');
    } finally {
      setPending(null);
    }
  }

  // A successful sign-in updates the session, and the root layout swaps to the app.
  async function continueWithGoogle() {
    if (pending !== null) {
      return;
    }

    setPending('google');
    setError(null);
    try {
      await signInWithGoogle();
    } catch (caught) {
      setError(caught instanceof AuthActionError ? caught.message : 'Something went wrong.');
    } finally {
      setPending(null);
    }
  }

  return (
    <AuthScreen title="Sign in" subtitle="Use Google, or get a one-time code by email.">
      {Platform.OS !== 'web' ? (
        <View style={styles.providers}>
          <GoogleSigninButton
            style={styles.providerButton}
            size={GoogleSigninButton.Size.Wide}
            color={GoogleSigninButton.Color.Light}
            disabled={pending !== null}
            onPress={() => void continueWithGoogle()}
          />
        </View>
      ) : null}

      {Platform.OS !== 'web' ? (
        <View style={styles.divider}>
          <View style={styles.rule} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.rule} />
        </View>
      ) : null}

      <Text nativeID="email-label" style={authStyles.label}>
        Email
      </Text>
      <TextInput
        accessibilityLabelledBy="email-label"
        accessibilityLabel="Email"
        value={email}
        onChangeText={setEmail}
        onSubmitEditing={() => void submitEmail()}
        placeholder="you@example.com"
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="send"
        editable={pending === null}
        style={authStyles.input}
      />
      <FormError message={error} />
      <PrimaryButton
        label="Email me a code"
        busy={pending === 'email'}
        disabled={pending !== null || !email.trim()}
        onPress={() => void submitEmail()}
      />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  providers: { gap: 12 },
  providerButton: { width: '100%', height: 52 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 24 },
  rule: { flex: 1, height: 1, backgroundColor: colors.line },
  dividerText: { fontFamily: fonts.body, fontSize: 14, color: colors.faint },
});
