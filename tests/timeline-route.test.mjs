import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../apps/api/src/app/api/timeline/route.ts';
import {
  eventRow,
  noteRow,
  savedEvent,
  savedNote,
  savedTask,
  taskRow,
  TASK_ID,
  timelineRow,
} from './support/records.mjs';
import { mockSupabaseAuth, signToken, upstreamCall } from './support/supabase-auth.mjs';

const rows = [
  timelineRow('event', eventRow, '2026-09-26T00:00:00'),
  timelineRow('task', taskRow, '2026-09-25T15:00:00'),
  timelineRow('note', noteRow, '2026-09-24T08:00:00'),
];

function request(query = '', token = signToken()) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return new Request(`http://localhost/api/timeline${query}`, { headers });
}

const decode = (cursor) => JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));

test('the timeline requires a valid token', async (t) => {
  mockSupabaseAuth(t);
  assert.equal((await GET(request('', null))).status, 401);
});

test('a full page returns a cursor at its last row', async (t) => {
  const upstream = mockSupabaseAuth(t, async () => Response.json(rows));
  const response = await GET(request('?limit=2'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.items, [savedEvent, savedTask]);
  assert.deepEqual(decode(body.nextCursor), { sortAt: '2026-09-25T15:00:00', id: TASK_ID });
  const call = upstreamCall(upstream);
  assert.equal(call.url.pathname, '/rest/v1/rpc/timeline_page');
  assert.deepEqual(call.body, { page_size: 3, cursor_sort_at: null, cursor_id: null });
});

test('the next page starts after the cursor and ends with a null cursor', async (t) => {
  const upstream = mockSupabaseAuth(t, async () => Response.json([rows[2]]));
  const cursor = Buffer.from(
    JSON.stringify({ sortAt: '2026-09-25T15:00:00', id: TASK_ID }),
  ).toString('base64url');
  const response = await GET(request(`?limit=2&cursor=${cursor}`));
  assert.deepEqual(await response.json(), { items: [savedNote], nextCursor: null });
  assert.deepEqual(upstreamCall(upstream).body, {
    page_size: 3,
    cursor_sort_at: '2026-09-25T15:00:00',
    cursor_id: TASK_ID,
  });
});

test('a tampered cursor or bad limit is rejected without a query', async (t) => {
  const upstream = mockSupabaseAuth(t);
  const tampered = await GET(request('?cursor=abc'));
  assert.equal(tampered.status, 400);
  assert.deepEqual(await tampered.json(), { error: 'Invalid cursor' });
  assert.equal((await GET(request('?limit=500'))).status, 400);
  assert.equal(upstream.mock.callCount(), 0);
});
