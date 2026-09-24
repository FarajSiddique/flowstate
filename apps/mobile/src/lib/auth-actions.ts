import { emailCodeRequestSchema, emailCodeVerificationSchema } from '@nexui/types';
import { isAuthApiError, type SupabaseClient } from '@supabase/supabase-js';

type AuthClient = Pick<
  SupabaseClient['auth'],
  'signInWithOtp' | 'verifyOtp' | 'signInWithIdToken' | 'signOut'
>;

export interface GoogleAuth {
  getIdToken(): Promise<string | null>;
  signOut(): Promise<void>;
}

export interface AuthActions {
  sendEmailCode(email: string): Promise<string>;
  verifyEmailCode(email: string, code: string): Promise<void>;
  signInWithGoogle(): Promise<boolean>;
  signOut(): Promise<void>;
  clearDeletedAccount(): Promise<void>;
}

// Marks messages safe to display to the user.
export class AuthActionError extends Error {}

function authMessage(error: unknown, fallback: string): string {
  if (isAuthApiError(error)) {
    if (error.status === 429) {
      return 'Too many attempts. Wait a minute, then try again.';
    }

    if (error.code === 'otp_expired') {
      return 'That code is wrong or has expired.';
    }
  }

  return fallback;
}

/** Binds auth operations to Supabase and the native Google adapter. */
export function createAuthActions(auth: AuthClient, google: GoogleAuth): AuthActions {
  async function sendEmailCode(email: string): Promise<string> {
    const parsed = emailCodeRequestSchema.safeParse({ email });

    if (!parsed.success) {
      throw new AuthActionError('Enter a valid email address.');
    }

    const { error } = await auth.signInWithOtp({
      email: parsed.data.email,
      options: { shouldCreateUser: true },
    });

    if (error) {
      throw new AuthActionError(authMessage(error, 'Could not send a code. Try again.'));
    }

    return parsed.data.email;
  }

  async function verifyEmailCode(email: string, token: string): Promise<void> {
    const parsed = emailCodeVerificationSchema.safeParse({ email, token });

    if (!parsed.success) {
      throw new AuthActionError('Enter the 6-digit code.');
    }

    const { error } = await auth.verifyOtp({ ...parsed.data, type: 'email' });

    if (error) {
      throw new AuthActionError(authMessage(error, 'Could not verify the code. Try again.'));
    }
  }

  /** Returns false when the native sheet was cancelled or is already open. */
  async function signInWithGoogle(): Promise<boolean> {
    const idToken = await google.getIdToken();

    if (idToken === null) {
      return false;
    }

    try {
      const { error } = await auth.signInWithIdToken({ provider: 'google', token: idToken });

      if (error) {
        throw error;
      }

      return true;
    } catch (error) {
      throw new AuthActionError(authMessage(error, 'Google sign-in failed. Try again.'));
    }
  }

  /** Tries local scope after a failed sign-out; offline refresh can still make both fail. */
  async function signOut(): Promise<void> {
    await google.signOut();
    const { error } = await auth.signOut();

    if (error) {
      const { error: localError } = await auth.signOut({ scope: 'local' });

      if (localError) {
        throw new AuthActionError('Could not sign out. Try again.');
      }
    }
  }

  /** Clears the remaining session after the API has deleted the account. */
  async function clearDeletedAccount(): Promise<void> {
    await google.signOut();
    const { error } = await auth.signOut({ scope: 'local' });

    if (error) {
      throw new AuthActionError('Could not clear your session. Try again.');
    }
  }

  return { sendEmailCode, verifyEmailCode, signInWithGoogle, signOut, clearDeletedAccount };
}
