import assert from 'node:assert/strict';
import test from 'node:test';

import { DELETE } from '../apps/api/src/app/api/account/route.ts';
import { mockSupabaseAuth, signToken, supabaseEnv } from './support/supabase-auth.mjs';

function request(token = signToken()) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return new Request('http://localhost/api/account', { method: 'DELETE', headers });
}

test('deleting an account requires a valid token', async (t) => {
  const admin = mockSupabaseAuth(t);
  assert.equal((await DELETE(request(null))).status, 401);
  assert.equal(admin.mock.callCount(), 0);
});

test('deletes only the signed-in user with the secret key', async (t) => {
  const admin = mockSupabaseAuth(t, async () => Response.json({}));
  const response = await DELETE(request());
  assert.equal(response.status, 204);
  assert.equal(admin.mock.callCount(), 1);
  const [input, init] = admin.mock.calls[0].arguments;
  const url = input instanceof Request ? input.url : String(input);
  assert.equal(
    url,
    `${supabaseEnv.SUPABASE_URL}/auth/v1/admin/users/6f1c9a52-0d0e-4b8f-9f4a-2f0d6f2c9a11`,
  );
  const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
  assert.equal(init?.method ?? input.method, 'DELETE');
  assert.equal(headers.get('apikey'), supabaseEnv.SUPABASE_SECRET_KEY);
});

test('a failed deletion returns a generic 500', async (t) => {
  mockSupabaseAuth(t, async () => Response.json({ msg: 'boom' }, { status: 500 }));
  t.mock.method(console, 'error', () => {});
  const response = await DELETE(request());
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: 'Could not delete your account. Try again later.',
  });
});
