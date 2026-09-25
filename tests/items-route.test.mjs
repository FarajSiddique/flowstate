import assert from 'node:assert/strict';
import test from 'node:test';

import { PATCH } from '../apps/api/src/app/api/items/[kind]/[id]/route.ts';
import { EVENT_ID, eventRow, savedEvent, savedTask, TASK_ID, taskRow } from './support/records.mjs';
import { mockSupabaseAuth, signToken, upstreamCall } from './support/supabase-auth.mjs';

function patch(kind, id, body, token = signToken()) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const request = new Request(`http://localhost/api/items/${kind}/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  return PATCH(request, { params: Promise.resolve({ kind, id }) });
}

test('editing requires a valid token', async (t) => {
  mockSupabaseAuth(t);
  assert.equal((await patch('task', TASK_ID, { completed: true }, null)).status, 401);
});

test('completing a task stamps completed_at on that row only', async (t) => {
  const completedAt = '2026-09-24T18:30:00.000000+00:00';
  const upstream = mockSupabaseAuth(t, async () =>
    Response.json([{ ...taskRow, completed_at: completedAt }]),
  );
  const response = await patch('task', TASK_ID, { completed: true });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ...savedTask, completedAt });
  const call = upstreamCall(upstream);
  assert.equal(call.method, 'PATCH');
  assert.equal(call.url.pathname, '/rest/v1/tasks');
  assert.equal(call.url.searchParams.get('id'), `eq.${TASK_ID}`);
  assert.equal(typeof call.body.completed_at, 'string');
  assert.deepEqual(Object.keys(call.body), ['completed_at']);
});

test('an event can be rescheduled, re-staffed and completed in one request', async (t) => {
  const upstream = mockSupabaseAuth(t, async () => Response.json([eventRow]));
  const response = await patch('event', EVENT_ID, {
    start: { date: '2026-09-27', time: '10:00' },
    attendees: ['Ana'],
    completed: false,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), savedEvent);
  assert.deepEqual(upstreamCall(upstream).body, {
    start_date: '2026-09-27',
    start_time: '10:00',
    attendees: ['Ana'],
    completed_at: null,
  });
});

test('unknown kinds, bad ids and rows RLS hides are all 404', async (t) => {
  const upstream = mockSupabaseAuth(t, async () => Response.json([]));
  for (const [kind, id] of [
    ['reminder', TASK_ID],
    ['task', 'not-a-uuid'],
  ]) {
    const response = await patch(kind, id, { completed: true });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Item not found.' });
  }
  assert.equal(upstream.mock.callCount(), 0);
  assert.equal((await patch('task', TASK_ID, { completed: true })).status, 404);
  assert.equal(upstream.mock.callCount(), 1);
});

test('empty or cross-kind patches are rejected without a query', async (t) => {
  const upstream = mockSupabaseAuth(t);
  const empty = await patch('task', TASK_ID, {});
  assert.deepEqual(await empty.json(), { error: 'Nothing to update.' });
  const crossKind = await patch('task', TASK_ID, { durationMin: 30 });
  assert.equal(crossKind.status, 400);
  assert.deepEqual(await crossKind.json(), { error: 'Invalid changes.' });
  assert.equal(upstream.mock.callCount(), 0);
});
