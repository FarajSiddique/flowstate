import {
  GoogleSignin,
  isCancelledResponse,
  isErrorWithCode,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { Platform } from 'react-native';

import { AuthActionError } from './auth-actions';

let configured = false;

function configureGoogleSignIn() {
  if (configured) {
    return;
  }

  GoogleSignin.configure({
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  });
  configured = true;
}

/** Opens the native account picker. Cancellation returns null, not an error. */
export async function getGoogleIdToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    throw new AuthActionError('Google sign-in needs the mobile app.');
  }

  try {
    configureGoogleSignIn();
    if (Platform.OS === 'android') {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }

    const response = await GoogleSignin.signIn();

    if (isCancelledResponse(response)) {
      return null;
    }

    const idToken = response.data.idToken;

    if (!idToken) {
      throw new AuthActionError('Google did not return an ID token.');
    }

    return idToken;
  } catch (error) {
    if (error instanceof AuthActionError) {
      throw error;
    }

    if (isErrorWithCode(error)) {
      if (error.code === statusCodes.SIGN_IN_CANCELLED || error.code === statusCodes.IN_PROGRESS) {
        return null;
      }

      if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new AuthActionError('Google sign-in needs Google Play services.');
      }
    }

    throw new AuthActionError('Google sign-in failed. Try again.');
  }
}

/** Forgets the Google account so the next sign-in shows the account picker. */
export async function forgetGoogleAccount(): Promise<void> {
  if (Platform.OS === 'web') {
    return;
  }

  try {
    configureGoogleSignIn();
    await GoogleSignin.signOut();
  } catch {
    // Google may have no session; Supabase sign-out must still proceed.
  }
}
