import type { ReactElement, ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fonts } from '@/lib/theme';

interface AuthScreenProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

interface ButtonProps {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}

interface PrimaryButtonProps extends ButtonProps {
  busy?: boolean;
}

interface FormMessageProps {
  message: string | null;
}

export function AuthScreen({ title, subtitle, children }: AuthScreenProps): ReactElement {
  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.content}>
            <Text style={styles.brand}>nexui</Text>
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function PrimaryButton({
  label,
  busy,
  disabled,
  onPress,
}: PrimaryButtonProps): ReactElement {
  const inactive = disabled || busy;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [styles.primary, (pressed || inactive) && styles.dimmed]}
    >
      {busy ? (
        <ActivityIndicator color={colors.page} />
      ) : (
        <Text style={styles.primaryText}>{label}</Text>
      )}
    </Pressable>
  );
}

export function TextButton({ label, disabled, onPress }: ButtonProps): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.textButton, (pressed || disabled) && styles.dimmed]}
    >
      <Text style={styles.textButtonText}>{label}</Text>
    </Pressable>
  );
}

export function FormError({ message }: FormMessageProps): ReactElement | null {
  if (!message) {
    return null;
  }

  return (
    <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>
      {message}
    </Text>
  );
}

export function FormNotice({ message }: FormMessageProps): ReactElement | null {
  if (!message) {
    return null;
  }

  return (
    <Text accessibilityLiveRegion="polite" style={styles.notice}>
      {message}
    </Text>
  );
}

export const authStyles = StyleSheet.create({
  input: {
    fontFamily: fonts.input,
    fontSize: 18,
    color: colors.ink,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 8,
  },
  label: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 36 },
  content: { width: '100%', maxWidth: 440, alignSelf: 'center' },
  brand: { fontFamily: fonts.display, fontSize: 30, letterSpacing: -1, color: colors.ink },
  title: { fontFamily: fonts.heading, fontSize: 24, color: colors.ink, marginTop: 36 },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 23,
    color: colors.muted,
    marginTop: 8,
    marginBottom: 24,
  },
  primary: {
    backgroundColor: colors.ink,
    minHeight: 52,
    borderRadius: 999,
    justifyContent: 'center',
    marginTop: 16,
  },
  primaryText: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.page,
    textAlign: 'center',
  },
  textButton: { alignSelf: 'center', paddingVertical: 12, marginTop: 8 },
  textButtonText: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.ink,
    textDecorationLine: 'underline',
  },
  error: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.danger,
    marginTop: 12,
  },
  notice: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.success,
    marginTop: 12,
  },
  dimmed: { opacity: 0.6 },
});
