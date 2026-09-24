import {
  GoogleSignin,
  isCancelledResponse,
  isErrorWithCode,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { emailCodeRequestSchema, emailCodeVerificationSchema } from '@nexui/types';
import { isAuthApiError } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { supabase } from './supabase';

// The web client ID makes Google issue ID tokens that Supabase accepts. iOS also needs its own.
GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
});

export class AuthActionError extends Error {}

function authMessage(error: unknown, fallback: string): string {
  if (isAuthApiError(error)) {
    if (error.status === 429) return 'Too many attempts. Wait a minute, then try again.';
    if (error.code === 'otp_expired') return 'That code is wrong or has expired.';
  }
  return fallback;
}

export async function sendEmailCode(email: string): Promise<string> {
  const parsed = emailCodeRequestSchema.safeParse({ email });
  if (!parsed.success) throw new AuthActionError('Enter a valid email address.');

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { shouldCreateUser: true },
  });

  if (error) {
    if (__DEV__) console.warn('Sending the email code failed', error);
    throw new AuthActionError(authMessage(error, 'Could not send a code. Try again.'));
  }
  return parsed.data.email;
}

export async function verifyEmailCode(email: string, token: string): Promise<void> {
  const parsed = emailCodeVerificationSchema.safeParse({ email, token });
  
  if (!parsed.success) throw new AuthActionError('Enter the 6-digit code.');

  const { error } = await supabase.auth.verifyOtp({ ...parsed.data, type: 'email' });

  if (error) {
    if (__DEV__) console.warn('Verifying the email code failed', error);
    throw new AuthActionError(authMessage(error, 'Could not verify the code. Try again.'));
  }
}

// Resolves false if the user closed Google's sheet.
export async function signInWithGoogle(): Promise<boolean> {
  if (Platform.OS === 'web') throw new AuthActionError('Google sign-in needs the mobile app.');
  try {
    if (Platform.OS === 'android') {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }
    const response = await GoogleSignin.signIn();
    if (isCancelledResponse(response)) return false;
    const idToken = response.data.idToken;
    if (!idToken) throw new AuthActionError('Google did not return an ID token.');
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
    if (error) throw error;
    return true;
  } catch (error) {
    if (error instanceof AuthActionError) throw error;
    if (isErrorWithCode(error)) {
      if (error.code === statusCodes.SIGN_IN_CANCELLED) return false;
      if (error.code === statusCodes.IN_PROGRESS) return false;
      if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new AuthActionError('Google sign-in needs Google Play services.');
      }
    }
    if (__DEV__) console.warn('Google sign-in failed', error);
    throw new AuthActionError(authMessage(error, 'Google sign-in failed. Try again.'));
  }
}

// Also forgets the Google account so the next sign-in shows the account picker.
async function forgetGoogleAccount() {
  if (Platform.OS === 'web') return;
  try {
    await GoogleSignin.signOut();
  } catch {
    // Not signed in with Google.
  }
}

export async function signOut(): Promise<void> {
  await forgetGoogleAccount();
  const { error } = await supabase.auth.signOut();
  // Try local sign-out if revocation fails; session refresh can still make this fail.
  if (error) {
    const { error: localError } = await supabase.auth.signOut({ scope: 'local' });
    if (localError) throw new AuthActionError('Could not sign out. Try again.');
  }
}

// After the server deletes the user, only the local session is left to clear.
export async function clearDeletedAccount(): Promise<void> {
  await forgetGoogleAccount();
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw new AuthActionError('Could not clear your session. Try again.');
}
