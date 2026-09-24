import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// Native modules and the configured client need a device. Keep the auth helper real,
// substituting only its platform dependencies and Supabase boundary.
const dependenciesUrl = `data:text/javascript,${encodeURIComponent(`
  export const GoogleSignin = { configure() {}, async signOut() {} };
  export const isCancelledResponse = () => false;
  export const isErrorWithCode = () => false;
  export const statusCodes = {};
  export const Platform = { OS: 'ios' };
  export const supabase = { auth: { async signOut() { return { error: null }; } } };
`)}`;
const authUrl = new URL('../apps/mobile/src/lib/auth.ts', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL === authUrl &&
      ['@react-native-google-signin/google-signin', 'react-native', './supabase'].includes(
        specifier,
      )
    ) {
      return { url: dependenciesUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { supabase } = await import(dependenciesUrl);
const { AuthActionError, clearDeletedAccount, signOut } = await import(authUrl);
hooks.deregister();

test('sign-out succeeds without a fallback when the first attempt succeeds', async (t) => {
  const attempt = t.mock.method(supabase.auth, 'signOut', async () => ({ error: null }));
  await assert.doesNotReject(signOut);
  assert.equal(attempt.mock.callCount(), 1);
});

test('sign-out succeeds when the local fallback succeeds', async (t) => {
  const attempt = t.mock.method(supabase.auth, 'signOut', async (options) => ({
    error: options?.scope === 'local' ? null : new Error('Revocation failed'),
  }));
  await assert.doesNotReject(signOut);
  assert.equal(attempt.mock.callCount(), 2);
  assert.deepEqual(attempt.mock.calls[1].arguments, [{ scope: 'local' }]);
});

test('sign-out rejects when both attempts fail so the screen can recover', async (t) => {
  t.mock.method(supabase.auth, 'signOut', async () => ({
    error: new Error('Expired session could not refresh while offline'),
  }));
  await assert.rejects(signOut, AuthActionError);
});

test('deleted-account cleanup rejects when the local sign-out fails', async (t) => {
  t.mock.method(supabase.auth, 'signOut', async () => ({
    error: new Error('Session cleanup failed'),
  }));
  await assert.rejects(clearDeletedAccount, AuthActionError);
});

test('deleted-account cleanup succeeds with local sign-out', async (t) => {
  const attempt = t.mock.method(supabase.auth, 'signOut', async () => ({ error: null }));
  await assert.doesNotReject(clearDeletedAccount);
  assert.equal(attempt.mock.callCount(), 1);
  assert.deepEqual(attempt.mock.calls[0].arguments, [{ scope: 'local' }]);
});
