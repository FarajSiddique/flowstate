import assert from 'node:assert/strict';
import test from 'node:test';

import { POST } from '../apps/api/src/app/api/intent/route.ts';

function request(body) {
  return new Request('http://localhost/api/intent', { method: 'POST', body });
}

function configure(t, values = {}) {
  for (const key of ['AI_PROVIDER', 'AI_GATEWAY_API_KEY', 'FLOWSTATE_INTENT_MODEL', 'NODE_ENV']) {
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
}

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
  configure(t, {
    AI_PROVIDER: 'jev',
    AI_GATEWAY_API_KEY: 'test-secret',
    FLOWSTATE_INTENT_MODEL: 'typesafe-ai/jev',
  });
  const gateway = t.mock.method(
    globalThis,
    'fetch',
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
