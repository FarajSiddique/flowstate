import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import { verifyRequest } from '../apps/api/src/lib/supabase/verify-request.ts';
import { mockSupabaseAuth, signToken, supabaseEnv } from './support/supabase-auth.mjs';

function request(authorization) {
  const headers = authorization === undefined ? {} : { Authorization: authorization };
  return new Request('http://localhost/api/intent', { method: 'POST', headers });
}

async function assertUnauthorized(result) {
  assert.ok(result instanceof Response);
  assert.equal(result.status, 401);
  assert.equal(result.headers.get('www-authenticate'), 'Bearer');
  assert.deepEqual(await result.json(), { error: 'Sign in to continue.' });
}

test('a valid token returns the user id and email', async (t) => {
  mockSupabaseAuth(t);
  assert.deepEqual(await verifyRequest(request(`Bearer ${signToken()}`)), {
    userId: '6f1c9a52-0d0e-4b8f-9f4a-2f0d6f2c9a11',
    email: 'tester@example.com',
  });
});

test('a missing or malformed Authorization header is rejected without a network call', async (t) => {
  const upstream = mockSupabaseAuth(t);
  const token = signToken();
  for (const header of [
    undefined,
    '',
    token,
    `Basic ${token}`,
    'Bearer ',
    'Bearer abc',
    'Bearer a.b',
  ]) {
    await assertUnauthorized(await verifyRequest(request(header)));
  }
  assert.equal(globalThis.fetch.mock.callCount(), 0);
  assert.equal(upstream.mock.callCount(), 0);
});

test('an expired token is rejected', async (t) => {
  mockSupabaseAuth(t);
  await assertUnauthorized(
    await verifyRequest(request(`Bearer ${signToken({}, { expiresIn: -60 })}`)),
  );
});

test('a token signed by another key, or with tampered claims, is rejected', async (t) => {
  mockSupabaseAuth(t);
  const [header, payload] = signToken().split('.');
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const forged = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  await assertUnauthorized(await verifyRequest(request(`Bearer ${header}.${payload}.${forged}`)));

  const [, , signature] = signToken().split('.');
  const tampered = Buffer.from(JSON.stringify({ sub: 'someone-else', role: 'authenticated' }));
  await assertUnauthorized(
    await verifyRequest(request(`Bearer ${header}.${tampered.toString('base64url')}.${signature}`)),
  );
});

test('anon-role and anonymous-user tokens are not signed-in users', async (t) => {
  mockSupabaseAuth(t);
  await assertUnauthorized(await verifyRequest(request(`Bearer ${signToken({ role: 'anon' })}`)));
  await assertUnauthorized(
    await verifyRequest(request(`Bearer ${signToken({ is_anonymous: true })}`)),
  );
});

test('missing Supabase configuration returns 503 and logs what is missing', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const result = await verifyRequest(request(`Bearer ${signToken()}`), {}, {});
  assert.equal(result.status, 503);
  assert.match(JSON.stringify(errors.mock.calls), /SUPABASE_PUBLISHABLE_KEY/);
});

test('an unreachable JWKS endpoint returns 503 rather than signing the user out', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed');
  });
  const env = { ...supabaseEnv, SUPABASE_URL: 'https://nexui-offline.supabase.co' };
  const result = await verifyRequest(request(`Bearer ${signToken()}`), {}, env);
  assert.equal(result.status, 503);
});
