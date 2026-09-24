import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setImmediate as flushRefresh } from 'node:timers/promises';
import test from 'node:test';

import { startSessionLifecycle } from '../apps/mobile/src/lib/session-lifecycle.ts';

function setup(t, currentState = 'active') {
  let onAuth;
  let onAppState;
  const unsubscribe = t.mock.fn();
  const remove = t.mock.fn();
  const auth = {
    onAuthStateChange(callback) {
      onAuth = callback;
      return { data: { subscription: { unsubscribe } } };
    },
    startAutoRefresh: t.mock.fn(async () => {}),
    stopAutoRefresh: t.mock.fn(async () => {}),
  };
  const appState = {
    currentState,
    addEventListener(event, callback) {
      assert.equal(event, 'change');
      onAppState = callback;
      return { remove };
    },
  };
  return {
    auth,
    appState,
    unsubscribe,
    remove,
    emitSession: (event, session) => onAuth(event, session),
    emitAppState: (state) => {
      appState.currentState = state;
      onAppState(state);
    },
  };
}

test('restored, refreshed, and cleared sessions reach the UI synchronously', (t) => {
  const env = setup(t);
  const sessions = [];
  const stop = startSessionLifecycle(env.auth, (session) => sessions.push(session));
  const restored = { access_token: 'restored' };
  const refreshed = { access_token: 'refreshed' };
  assert.equal(env.emitSession('INITIAL_SESSION', restored), undefined);
  env.emitSession('TOKEN_REFRESHED', refreshed);
  env.emitSession('SIGNED_OUT', null);
  assert.deepEqual(sessions, [restored, refreshed, null]);
  stop();
  env.emitSession('SIGNED_IN', restored);
  assert.deepEqual(sessions, [restored, refreshed, null]);
  assert.equal(env.unsubscribe.mock.callCount(), 1);
  assert.equal(env.auth.startAutoRefresh.mock.callCount(), 0);
  assert.equal(env.auth.stopAutoRefresh.mock.callCount(), 0);
});

test('native refresh follows app state and listeners are cleaned up', async (t) => {
  const env = setup(t);
  const stop = startSessionLifecycle(env.auth, () => {}, env.appState);
  await flushRefresh();
  assert.equal(env.auth.startAutoRefresh.mock.callCount(), 1);
  env.emitAppState('background');
  await flushRefresh();
  assert.equal(env.auth.stopAutoRefresh.mock.callCount(), 1);
  env.emitAppState('active');
  await flushRefresh();
  assert.equal(env.auth.startAutoRefresh.mock.callCount(), 2);
  stop();
  await flushRefresh();
  assert.equal(env.unsubscribe.mock.callCount(), 1);
  assert.equal(env.remove.mock.callCount(), 1);
  assert.equal(env.auth.stopAutoRefresh.mock.callCount(), 2);
  env.emitAppState('active');
  await flushRefresh();
  assert.equal(env.auth.startAutoRefresh.mock.callCount(), 2);
});

test('mounting in the background keeps native refresh stopped', async (t) => {
  const env = setup(t, 'background');
  const stop = startSessionLifecycle(env.auth, () => {}, env.appState);
  await flushRefresh();
  assert.equal(env.auth.startAutoRefresh.mock.callCount(), 0);
  assert.equal(env.auth.stopAutoRefresh.mock.callCount(), 1);
  stop();
});

test('cleanup waits for refresh startup already in progress', async (t) => {
  const env = setup(t);
  let finishStart;
  const started = new Promise((resolve) => {
    finishStart = resolve;
  });
  let running = false;
  env.auth.startAutoRefresh.mock.mockImplementation(async () => {
    await started;
    running = true;
  });
  env.auth.stopAutoRefresh.mock.mockImplementation(async () => {
    running = false;
  });
  const stop = startSessionLifecycle(env.auth, () => {}, env.appState);
  await flushRefresh();
  stop();
  finishStart();
  await flushRefresh();
  assert.equal(running, false);
});

test('immediate unmount and remount leave only one native refresh loop', async (t) => {
  const env = setup(t);
  let loops = 0;
  env.auth.startAutoRefresh.mock.mockImplementation(async () => {
    loops = 0;
    await Promise.resolve();
    loops += 1;
  });
  env.auth.stopAutoRefresh.mock.mockImplementation(async () => {
    loops = 0;
  });
  const stopFirst = startSessionLifecycle(env.auth, () => {}, env.appState);
  stopFirst();
  const stopSecond = startSessionLifecycle(env.auth, () => {}, env.appState);
  await flushRefresh();
  assert.equal(loops, 1);
  stopSecond();
  await flushRefresh();
  assert.equal(loops, 0);
});

test('the installed Supabase client restores a stored session through INITIAL_SESSION', async () => {
  const require = createRequire(new URL('../apps/mobile/package.json', import.meta.url));
  const { createClient } = require('@supabase/supabase-js');
  const session = {
    access_token: 'stored-access-token',
    refresh_token: 'stored-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'stored-user', email: 'user@example.com' },
  };
  const storage = new Map([['session-test', JSON.stringify(session)]]);
  const client = createClient('https://session-test.supabase.co', 'test-key', {
    auth: {
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
      storageKey: 'session-test',
      storage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => storage.delete(key),
      },
    },
    global: {
      fetch: async () => {
        throw new Error('Restoration should not need the network');
      },
    },
  });
  let restored;
  const initialSession = new Promise((resolve) => {
    restored = resolve;
  });
  const stop = startSessionLifecycle(client.auth, restored);
  try {
    assert.deepEqual(await initialSession, session);
  } finally {
    stop();
    await client.auth.stopAutoRefresh();
  }
});
