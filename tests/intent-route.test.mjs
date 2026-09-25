import assert from 'node:assert/strict';
import test from 'node:test';

import { OPTIONS, POST } from '../apps/api/src/app/api/intent/route.ts';
import { TASK_ID, taskRow } from './support/records.mjs';
import { mockSupabaseAuth, signToken, upstreamCall } from './support/supabase-auth.mjs';

function request(body, token = signToken()) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return new Request('http://localhost/api/intent', { method: 'POST', body, headers });
}

function configure(t, values = {}, upstream) {
  for (const key of ['AI_PROVIDER', 'AI_GATEWAY_API_KEY', 'NEXUI_INTENT_MODEL', 'NODE_ENV']) {
    const previous = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  return mockSupabaseAuth(t, upstream);
}

test('route requires a valid access token before reading the request', async (t) => {
  const upstream = configure(t, { AI_PROVIDER: 'mock' });
  for (const token of [null, signToken({}, { expiresIn: -60 })]) {
    const response = await POST(request(JSON.stringify({ text: 'meet Sarah' }), token));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
  }
  assert.equal(upstream.mock.callCount(), 0);
});

test('preflight allows the Authorization header', () => {
  const allowed = OPTIONS().headers.get('access-control-allow-headers');
  assert.match(allowed, /Authorization/);
});

test('route rejects malformed requests before invoking any provider', async (t) => {
  configure(t, { AI_PROVIDER: 'invalid' });
  for (const body of ['{', JSON.stringify({ text: '' }), JSON.stringify({ text: 42 })]) {
    assert.equal((await POST(request(body))).status, 400);
  }
});

test('route keeps mock behavior and reports classification timing without input', async (t) => {
  configure(t, { AI_PROVIDER: 'mock' });
  const logs = t.mock.method(console, 'info', () => {});
  const response = await POST(request(JSON.stringify({ text: 'meet Sarah tomorrow at 2' })));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).intent, 'CREATE_EVENT');
  const output = JSON.stringify(logs.mock.calls.map((call) => call.arguments));
  assert.match(output, /provider=mock intent=CREATE_EVENT confidence=0.96 latencyMs=\d+/);
  assert.doesNotMatch(output, /Sarah/);
});

test('route selects Jev and safely returns UNKNOWN when Gateway rejects the call', async (t) => {
  const gateway = configure(
    t,
    {
      AI_PROVIDER: 'jev',
      AI_GATEWAY_API_KEY: 'test-secret',
      NEXUI_INTENT_MODEL: 'typesafe-ai/jev',
    },
    async () => new Response('secret upstream details', { status: 503 }),
  );
  const response = await POST(request(JSON.stringify({ text: 'meet Sarah tomorrow at 2' })));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { intent: 'UNKNOWN', confidence: 0, entities: {} });
  assert.equal(gateway.mock.callCount(), 1);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('configuration errors return a generic 500 and log actionable server details', async (t) => {
  configure(t, { AI_PROVIDER: 'jev' });
  const response = await POST(request(JSON.stringify({ text: 'meet Sarah' })));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: 'Intent prediction is temporarily unavailable.',
  });
  assert.match(JSON.stringify(console.error.mock.calls), /AI_GATEWAY_API_KEY/);
});

test('route resolves actions against the client clock and rejects an invalid context', async (t) => {
  configure(t, { AI_PROVIDER: 'mock' });
  t.mock.method(console, 'info', () => {});
  const context = { now: '2026-09-24T02:30:00Z', timeZone: 'Asia/Tokyo' };
  const response = await POST(
    request(JSON.stringify({ text: 'remind me to submit my application tomorrow', context })),
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).action, {
    kind: 'CREATE_TASK',
    title: 'Submit my application',
    due: { date: '2026-09-25', time: null },
    priority: 'normal',
  });
  const invalid = await POST(
    request(JSON.stringify({ text: 'meet Sarah', context: { ...context, timeZone: 'Nowhere' } })),
  );
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'Invalid request context.' });
});

test("a change phrase is matched against the signed-in user's open items", async (t) => {
  const token = signToken();
  const upstream = configure(t, { AI_PROVIDER: 'mock' }, async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));

    return Response.json(url.pathname === '/rest/v1/tasks' ? [taskRow] : []);
  });
  const context = { now: '2026-09-24T16:00:00Z', timeZone: 'America/New_York' };
  const response = await POST(
    request(JSON.stringify({ text: 'done with call mom', context }), token),
  );
  assert.equal(response.status, 200);
  const decision = await response.json();
  assert.equal(decision.intent, 'COMPLETE');
  assert.deepEqual(decision.action.target, {
    kind: 'task',
    id: TASK_ID,
    title: 'Call mom',
    when: { date: '2026-09-25', time: '15:00' },
  });

  const calls = upstream.mock.calls.map((_call, index) => upstreamCall(upstream, index));
  assert.deepEqual(calls.map((call) => call.url.pathname).sort(), [
    '/rest/v1/events',
    '/rest/v1/notes',
    '/rest/v1/tasks',
  ]);
  const tasks = calls.find((call) => call.url.pathname === '/rest/v1/tasks');
  assert.equal(tasks.headers.get('authorization'), `Bearer ${token}`);
  assert.equal(tasks.url.searchParams.get('completed_at'), 'is.null');
  assert.deepEqual(tasks.url.searchParams.getAll('title'), ['ilike.%call%', 'ilike.%mom%']);
});
