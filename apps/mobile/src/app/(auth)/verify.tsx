import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
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
// Supabase allows one code per address every 60 seconds.
const RESEND_AFTER_S = 60;

export default function VerifyScreen() {
  const { email = '' } = useLocalSearchParams<{ email?: string }>();
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(RESEND_AFTER_S);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((seconds) => seconds - 1), 1_000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  // A successful verification updates the session, and the root layout swaps to the app.
  const verify = async (value: string) => {
    if (verifying) return;
    setVerifying(true);
    setError(null);
    setNotice(null);
    try {
      await verifyEmailCode(email, value);
    } catch (caught) {
      setError(caught instanceof AuthActionError ? caught.message : 'Something went wrong.');
      setVerifying(false);
    }
  };

  const onChangeCode = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (digits.length === CODE_LENGTH) void verify(digits);
  };

  const resend = async () => {
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
  };

  // Reached without an address (e.g. a restored route); start over from sign-in.
  if (!email) return <Redirect href="/sign-in" />;

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
        editable={!verifying}
        style={[authStyles.input, styles.code]}
      />
      <FormError message={error} />
      <FormNotice message={notice} />
      <PrimaryButton
        label="Verify"
        busy={verifying}
        disabled={code.length !== CODE_LENGTH}
        onPress={() => void verify(code)}
      />
      <TextButton
        label={resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
        disabled={resendIn > 0 || resending || verifying}
        onPress={() => void resend()}
      />
      <TextButton
        label="Use a different email"
        disabled={verifying}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/sign-in'))}
      />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  code: { fontSize: 24, letterSpacing: 8, textAlign: 'center' },
});
