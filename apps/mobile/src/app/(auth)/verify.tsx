import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactElement } from 'react';
import { StyleSheet, TextInput } from 'react-native';

import {
  AuthScreen,
  authStyles,
  FormError,
  FormNotice,
  PrimaryButton,
  TextButton,
} from '@/components/auth-screen';
import { AuthActionError, sendEmailCode, verifyEmailCode } from '@/lib/auth';
import { colors } from '@/lib/theme';

const CODE_LENGTH = 6;
// Match the email resend interval configured in Supabase.
const RESEND_AFTER_S = 60;

export default function VerifyScreen(): ReactElement {
  const { email = '' } = useLocalSearchParams<{ email?: string }>();
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(RESEND_AFTER_S);

  useEffect(() => {
    if (resendIn <= 0) {
      return;
    }

    const timer = setTimeout(() => setResendIn((seconds) => seconds - 1), 1_000);

    return () => clearTimeout(timer);
  }, [resendIn]);

  // A successful verification updates the session, and the root layout swaps to the app.
  async function verify(value: string) {
    if (verifying || resending) {
      return;
    }

    setVerifying(true);
    setError(null);
    setNotice(null);
    try {
      await verifyEmailCode(email, value);
    } catch (caught) {
      setError(caught instanceof AuthActionError ? caught.message : 'Something went wrong.');
      setVerifying(false);
    }
  }

  function onChangeCode(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, CODE_LENGTH);

    setCode(digits);
    if (digits.length === CODE_LENGTH) {
      void verify(digits);
    }
  }

  async function resend() {
    if (verifying || resending || resendIn > 0) {
      return;
    }

    setResending(true);
    setError(null);
    setNotice(null);
    try {
      await sendEmailCode(email);
      setCode('');
      setNotice('We sent a new code.');
      setResendIn(RESEND_AFTER_S);
    } catch (caught) {
      setError(caught instanceof AuthActionError ? caught.message : 'Something went wrong.');
    } finally {
      setResending(false);
    }
  }

  function useDifferentEmail() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/sign-in');
    }
  }

  // Reached without an address (e.g. a restored route); start over from sign-in.
  if (!email) {
    return <Redirect href="/sign-in" />;
  }

  return (
    <AuthScreen title="Check your email" subtitle={`Enter the 6-digit code we sent to ${email}.`}>
      <TextInput
        accessibilityLabel="6-digit code"
        value={code}
        onChangeText={onChangeCode}
        placeholder="000000"
        placeholderTextColor={colors.faint}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={CODE_LENGTH}
        autoFocus
        editable={!verifying && !resending}
        style={[authStyles.input, styles.code]}
      />
      <FormError message={error} />
      <FormNotice message={notice} />
      <PrimaryButton
        label="Verify"
        busy={verifying}
        disabled={code.length !== CODE_LENGTH || resending}
        onPress={() => void verify(code)}
      />
      <TextButton
        label={resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
        disabled={resendIn > 0 || resending || verifying}
        onPress={() => void resend()}
      />
      <TextButton
        label="Use a different email"
        disabled={verifying || resending}
        onPress={useDifferentEmail}
      />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  code: { fontSize: 24, letterSpacing: 8, textAlign: 'center' },
});
