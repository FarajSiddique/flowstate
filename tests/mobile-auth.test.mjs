import assert from 'node:assert/strict';
import test from 'node:test';

import { AuthActionError, createAuthActions } from '../apps/mobile/src/lib/auth-actions.ts';

function setup(t, overrides = {}) {
  const auth = {
    signInWithOtp: t.mock.fn(async () => ({ data: {}, error: null })),
    verifyOtp: t.mock.fn(async () => ({ data: {}, error: null })),
    signInWithIdToken: t.mock.fn(async () => ({ data: {}, error: null })),
    signOut: t.mock.fn(async () => ({ error: null })),
    ...overrides,
  };
  const google = {
    getIdToken: t.mock.fn(async () => 'google-id-token'),
    signOut: t.mock.fn(async () => {}),
  };
  return { auth, google, actions: createAuthActions(auth, google) };
}

test('email requests normalize the address and allow account creation', async (t) => {
  const { actions, auth } = setup(t);
  assert.equal(await actions.sendEmailCode(' Me@Example.com '), 'me@example.com');
  assert.deepEqual(auth.signInWithOtp.mock.calls[0].arguments, [
    { email: 'me@example.com', options: { shouldCreateUser: true } },
  ]);
});

test('invalid email and code never reach Supabase', async (t) => {
  const { actions, auth } = setup(t);
  await assert.rejects(() => actions.sendEmailCode('invalid'), AuthActionError);
  await assert.rejects(() => actions.verifyEmailCode('a@b.co', '12'), AuthActionError);
  assert.equal(auth.signInWithOtp.mock.callCount(), 0);
  assert.equal(auth.verifyOtp.mock.callCount(), 0);
});

test('verification preserves leading zeroes and uses email OTP', async (t) => {
  const { actions, auth } = setup(t);
  await actions.verifyEmailCode(' Me@Example.com ', ' 012345 ');
  assert.deepEqual(auth.verifyOtp.mock.calls[0].arguments, [
    { email: 'me@example.com', token: '012345', type: 'email' },
  ]);
});

test('email rate limits and expired codes produce actionable messages', async (t) => {
  const apiError = (status, code) => ({ __isAuthError: true, name: 'AuthApiError', status, code });
  const { actions } = setup(t, {
    signInWithOtp: async () => ({ error: apiError(429) }),
    verifyOtp: async () => ({ error: apiError(403, 'otp_expired') }),
  });
  await assert.rejects(() => actions.sendEmailCode('a@b.co'), /Too many attempts/);
  await assert.rejects(() => actions.verifyEmailCode('a@b.co', '012345'), /wrong or has expired/);
});

test('unexpected email errors do not expose provider details', async (t) => {
  const { actions } = setup(t, {
    signInWithOtp: async () => ({ error: new Error('provider internals') }),
  });
  await assert.rejects(() => actions.sendEmailCode('a@b.co'), {
    message: 'Could not send a code. Try again.',
  });
});

test('Google cancellation does not exchange a token', async (t) => {
  const { actions, auth, google } = setup(t);
  google.getIdToken.mock.mockImplementation(async () => null);
  assert.equal(await actions.signInWithGoogle(), false);
  assert.equal(auth.signInWithIdToken.mock.callCount(), 0);
});

test('Google sign-in exchanges the native ID token with Supabase', async (t) => {
  const { actions, auth } = setup(t);
  assert.equal(await actions.signInWithGoogle(), true);
  assert.deepEqual(auth.signInWithIdToken.mock.calls[0].arguments, [
    { provider: 'google', token: 'google-id-token' },
  ]);
});

test('Google exchange errors become user-facing auth errors', async (t) => {
  const { actions } = setup(t, {
    signInWithIdToken: async () => ({ error: new Error('provider internals') }),
  });
  await assert.rejects(actions.signInWithGoogle, {
    message: 'Google sign-in failed. Try again.',
  });
});

test('sign-out succeeds without a fallback when the first attempt succeeds', async (t) => {
  const { actions, auth, google } = setup(t);
  await actions.signOut();
  assert.equal(auth.signOut.mock.callCount(), 1);
  assert.equal(google.signOut.mock.callCount(), 1);
});

test('sign-out succeeds when local fallback succeeds', async (t) => {
  const attempts = t.mock.fn(async (options) => ({
    error: options?.scope === 'local' ? null : new Error('Revocation failed'),
  }));
  const { actions } = setup(t, { signOut: attempts });
  await assert.doesNotReject(actions.signOut);
  assert.equal(attempts.mock.callCount(), 2);
  assert.deepEqual(attempts.mock.calls[1].arguments, [{ scope: 'local' }]);
});

test('both sign-out attempts failing rejects so the screen can recover', async (t) => {
  const { actions } = setup(t, {
    signOut: async () => ({ error: new Error('Offline refresh failed') }),
  });
  await assert.rejects(actions.signOut, AuthActionError);
});

test('deleted-account cleanup rejects if local sign-out fails', async (t) => {
  const { actions } = setup(t, {
    signOut: async () => ({ error: new Error('Cleanup failed') }),
  });
  await assert.rejects(actions.clearDeletedAccount, AuthActionError);
});

test('deleted-account cleanup uses local sign-out only', async (t) => {
  const { actions, auth } = setup(t);
  await actions.clearDeletedAccount();
  assert.equal(auth.signOut.mock.callCount(), 1);
  assert.deepEqual(auth.signOut.mock.calls[0].arguments, [{ scope: 'local' }]);
});
