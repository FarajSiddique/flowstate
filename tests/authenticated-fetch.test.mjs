import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { fetchWithSession, UnauthorizedError } from '../apps/mobile/src/lib/authenticated-fetch.ts';

const mobileRequire = createRequire(new URL('../apps/mobile/package.json', import.meta.url));
const nativeRequire = createRequire(mobileRequire.resolve('react-native/package.json'));
const { AbortController: NativeAbortController } = nativeRequire('abort-controller');

function session(accessToken) {
  return { data: { session: { access_token: accessToken } }, error: null };
}

function setup(t) {
  return {
    getSession: t.mock.fn(async () => session('stored-token')),
    refreshSession: t.mock.fn(async () => session('refreshed-token')),
  };
}

test('authenticated requests preserve headers, method, body, and cancellation signal', async (t) => {
  const auth = setup(t);
  const controller = new AbortController();
  const init = {
    method: 'POST',
    body: 'payload',
    signal: controller.signal,
    headers: { 'Content-Type': 'application/json' },
  };
  const response = new Response(null, { status: 204 });
  const send = t.mock.fn(async () => response);
  assert.equal(await fetchWithSession(auth, 'https://api.test/action', init, send), response);
  const [url, request] = send.mock.calls[0].arguments;
  assert.equal(url, 'https://api.test/action');
  assert.equal(request.method, 'POST');
  assert.equal(request.body, 'payload');
  assert.equal(request.signal, controller.signal);
  assert.equal(request.headers.get('Content-Type'), 'application/json');
  assert.equal(request.headers.get('Authorization'), 'Bearer stored-token');
  assert.equal(auth.refreshSession.mock.callCount(), 0);
});

test('a 401 refreshes once and retries with the new token', async (t) => {
  const auth = setup(t);
  const send = t.mock.fn(
    async (_url, init) =>
      new Response(null, {
        status: init.headers.get('Authorization') === 'Bearer refreshed-token' ? 204 : 401,
      }),
  );
  assert.equal((await fetchWithSession(auth, 'https://api.test/action', {}, send)).status, 204);
  assert.equal(auth.refreshSession.mock.callCount(), 1);
  assert.equal(send.mock.callCount(), 2);
});

test('a second 401 rejects without another refresh or request', async (t) => {
  const auth = setup(t);
  const send = t.mock.fn(async () => new Response(null, { status: 401 }));
  await assert.rejects(
    () => fetchWithSession(auth, 'https://api.test/action', {}, send),
    UnauthorizedError,
  );
  assert.equal(auth.refreshSession.mock.callCount(), 1);
  assert.equal(send.mock.callCount(), 2);
});

test('missing sessions fail without making an API request', async (t) => {
  const auth = setup(t);
  auth.getSession.mock.mockImplementation(async () => ({ data: { session: null }, error: null }));
  const send = t.mock.fn();
  await assert.rejects(
    () => fetchWithSession(auth, 'https://api.test/action', {}, send),
    UnauthorizedError,
  );
  assert.equal(send.mock.callCount(), 0);
});

test('refresh failures propagate without pretending the user signed out', async (t) => {
  const auth = setup(t);
  const offline = new Error('Offline');
  auth.refreshSession.mock.mockImplementation(async () => ({
    data: { session: null },
    error: offline,
  }));
  const send = t.mock.fn(async () => new Response(null, { status: 401 }));
  await assert.rejects(
    () => fetchWithSession(auth, 'https://api.test/action', {}, send),
    (error) => error === offline,
  );
  assert.equal(send.mock.callCount(), 1);
});

test('an aborted request does not start a token refresh', async (t) => {
  const auth = setup(t);
  const controller = new AbortController();
  const send = t.mock.fn(async () => {
    controller.abort();
    return new Response(null, { status: 401 });
  });
  await assert.rejects(
    () => fetchWithSession(auth, 'https://api.test/action', { signal: controller.signal }, send),
    { name: 'AbortError' },
  );
  assert.equal(auth.refreshSession.mock.callCount(), 0);
});

test('server failures do not refresh or retry', async (t) => {
  const auth = setup(t);
  const send = t.mock.fn(async () => new Response(null, { status: 503 }));
  assert.equal((await fetchWithSession(auth, 'https://api.test/action', {}, send)).status, 503);
  assert.equal(auth.refreshSession.mock.callCount(), 0);
  assert.equal(send.mock.callCount(), 1);
});

test('requests support React Native abort signals, including cancellation before sending', async (t) => {
  const auth = setup(t);
  const controller = new NativeAbortController();
  const send = t.mock.fn(async () => new Response(null, { status: 204 }));
  await fetchWithSession(auth, 'https://api.test/action', { signal: controller.signal }, send);
  controller.abort();
  await assert.rejects(
    () => fetchWithSession(auth, 'https://api.test/action', { signal: controller.signal }, send),
    { name: 'AbortError' },
  );
  assert.equal(send.mock.callCount(), 1);
});
