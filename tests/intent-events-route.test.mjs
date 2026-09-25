import assert from 'node:assert/strict';
import test from 'node:test';

import { POST } from '../apps/api/src/app/api/intent-events/route.ts';
import { savedTask, taskRow } from './support/records.mjs';
import {
  mockSupabaseAuth,
  signToken,
  supabaseEnv,
  upstreamCall,
} from './support/supabase-auth.mjs';

const decision = { intent: 'CREATE_TASK', confidence: 0.92, entities: { title: 'call mom' } };
const action = {
  kind: 'CREATE_TASK',
  title: ' Call mom ',
  due: { date: '2026-09-25', time: '15:00' },
  priority: 'normal',
};
const context = { now: '2026-09-24T12:00:00.000Z', timeZone: 'America/New_York' };
const text = 'call mom tomorrow at 3';

function request(body, token = signToken()) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request('http://localhost/api/intent-events', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

test('logging an intent requires a valid token', async (t) => {
  const upstream = mockSupabaseAuth(t);
  assert.equal((await POST(request({}, null))).status, 401);
  assert.equal(upstream.mock.callCount(), 0);
});

test('a confirmed task is saved and logged as the signed-in user', async (t) => {
  const token = signToken();
  const upstream = mockSupabaseAuth(t, async () => Response.json({ kind: 'task', ...taskRow }));
  const response = await POST(
    request({ text, context, decision, outcome: 'confirmed', action }, token),
  );
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { item: savedTask });
  const call = upstreamCall(upstream);
  assert.equal(call.url.href, `${supabaseEnv.SUPABASE_URL}/rest/v1/rpc/record_intent`);
  assert.equal(call.headers.get('authorization'), `Bearer ${token}`);
  assert.equal(call.headers.get('apikey'), supabaseEnv.SUPABASE_PUBLISHABLE_KEY);
  assert.equal(call.body.input_outcome, 'confirmed');
  assert.equal(call.body.input_action.title, 'Call mom');
  assert.equal(call.body.input_time_zone, 'America/New_York');
  assert.equal(call.body.input_text, text);
});

test('a dismissed draft is only logged, in UTC when the client sent no zone', async (t) => {
  const upstream = mockSupabaseAuth(t, async () => Response.json(null));
  const response = await POST(request({ text, decision, outcome: 'dismissed' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { item: null });
  const call = upstreamCall(upstream);
  assert.equal(call.body.input_action, null);
  assert.equal(call.body.input_time_zone, 'UTC');
});

test('invalid events are rejected before reaching the database', async (t) => {
  const upstream = mockSupabaseAuth(t);
  const missing = await POST(request({ text, decision, outcome: 'confirmed' }));
  assert.equal(missing.status, 400);
  assert.deepEqual(await missing.json(), { error: 'Invalid request.' });
  const untitled = await POST(
    request({ text, decision, outcome: 'confirmed', action: { ...action, title: '  ' } }),
  );
  assert.equal(untitled.status, 400);
  assert.deepEqual(await untitled.json(), { error: 'Add a title.' });
  assert.equal(upstream.mock.callCount(), 0);
});

test('a database failure returns a generic 500 and logs no details', async (t) => {
  mockSupabaseAuth(t, async () =>
    Response.json({ message: 'boom secret', code: 'XX000' }, { status: 500 }),
  );
  const logged = t.mock.method(console, 'error', () => {});
  const response = await POST(request({ text, context, decision, outcome: 'confirmed', action }));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Could not save. Try again.' });
  assert.equal(JSON.stringify(logged.mock.calls).includes('boom secret'), false);
});
