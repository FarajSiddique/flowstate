import assert from 'node:assert/strict';
import test from 'node:test';

import { corsHeaders, jsonError, preflight } from '../apps/api/src/lib/http/responses.ts';

test('route headers are uncacheable and always allow OPTIONS', () => {
  assert.deepEqual(corsHeaders(['POST'], ['Authorization', 'Content-Type']), {
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  });
});

test('a preflight is an empty 204 with the route headers', async () => {
  const response = preflight(corsHeaders(['DELETE'], ['Authorization']));

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-methods'), 'DELETE, OPTIONS');
  assert.equal(await response.text(), '');
});

test('errors use the { error } shape with the given status and headers', async () => {
  const response = jsonError('Invalid JSON', 400, { 'Cache-Control': 'no-store' });

  assert.equal(response.status, 400);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error: 'Invalid JSON' });
});
