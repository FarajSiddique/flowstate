import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../apps/api/src/app/api/search/route.ts';
import { savedTask, taskRow, timelineRow } from './support/records.mjs';
import { mockSupabaseAuth, signToken, upstreamCall } from './support/supabase-auth.mjs';

function request(params, token = signToken()) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return new Request(`http://localhost/api/search?${new URLSearchParams(params)}`, { headers });
}

test('search requires a valid token', async (t) => {
  mockSupabaseAuth(t);
  assert.equal((await GET(request({ q: 'mom' }, null))).status, 401);
});

test('search matches typed text literally within scope and dates', async (t) => {
  const upstream = mockSupabaseAuth(t, async () =>
    Response.json([timelineRow('task', taskRow, '2026-09-25T15:00:00')]),
  );
  const response = await GET(
    request({ q: '50%_off, (sale)', scope: 'tasks', from: '2026-09-01', to: '2026-09-30' }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [savedTask] });
  const { url } = upstreamCall(upstream);
  assert.equal(url.pathname, '/rest/v1/timeline_items');
  assert.equal(url.searchParams.get('search_text'), 'ilike.%50\\%\\_off, (sale)%');
  assert.equal(url.searchParams.get('kind'), 'in.(task)');
  assert.deepEqual(url.searchParams.getAll('item_date'), ['gte.2026-09-01', 'lte.2026-09-30']);
  assert.equal(url.searchParams.get('order'), 'sort_at.desc,id.desc');
  assert.equal(url.searchParams.get('limit'), '50');
});

test('an empty query or reversed range is rejected without a query', async (t) => {
  const upstream = mockSupabaseAuth(t);
  const empty = await GET(request({ q: '  ' }));
  assert.equal(empty.status, 400);
  assert.deepEqual(await empty.json(), { error: 'Enter something to search for.' });
  const reversed = await GET(request({ q: 'x', from: '2026-09-30', to: '2026-09-01' }));
  assert.deepEqual(await reversed.json(), { error: 'Invalid search.' });
  assert.equal(upstream.mock.callCount(), 0);
});
