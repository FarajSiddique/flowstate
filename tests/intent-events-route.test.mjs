import assert from 'node:assert/strict';
import test from 'node:test';

import { POST } from '../apps/api/src/app/api/intent-events/route.ts';
import { LOG_ID, noteRow, savedNote, savedTask, taskRow } from './support/records.mjs';
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
  const upstream = mockSupabaseAuth(t, async () =>
    Response.json({ eventId: LOG_ID, item: { kind: 'task', ...taskRow } }),
  );
  const response = await POST(
    request({ text, context, decision, outcome: 'confirmed', via: 'form', action }, token),
  );
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { eventId: LOG_ID, item: savedTask });
  const call = upstreamCall(upstream);
  assert.equal(call.url.href, `${supabaseEnv.SUPABASE_URL}/rest/v1/rpc/record_intent`);
  assert.equal(call.headers.get('authorization'), `Bearer ${token}`);
  assert.equal(call.headers.get('apikey'), supabaseEnv.SUPABASE_PUBLISHABLE_KEY);
  assert.equal(call.body.input_outcome, 'confirmed');
  assert.equal(call.body.input_action.title, 'Call mom');
  assert.equal(call.body.input_time_zone, 'America/New_York');
  assert.equal(call.body.input_text, text);
  assert.equal(call.body.input_via, 'form');
});

test('a dismissed draft is only logged, in UTC when the client sent no zone', async (t) => {
  const upstream = mockSupabaseAuth(t, async () => Response.json({ eventId: LOG_ID, item: null }));
  const response = await POST(request({ text, decision, outcome: 'dismissed' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { eventId: LOG_ID, item: null });
  const call = upstreamCall(upstream);
  assert.equal(call.body.input_action, null);
  assert.equal(call.body.input_time_zone, 'UTC');
  assert.equal(call.body.input_via, null);
});

test('invalid events are rejected before reaching the database', async (t) => {
  const upstream = mockSupabaseAuth(t);
  const missing = await POST(request({ text, decision, outcome: 'confirmed', via: 'form' }));
  assert.equal(missing.status, 400);
  assert.deepEqual(await missing.json(), { error: 'Invalid request.' });
  const untitled = await POST(
    request({
      text,
      decision,
      outcome: 'confirmed',
      via: 'form',
      action: { ...action, title: '  ' },
    }),
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
  const response = await POST(
    request({ text, context, decision, outcome: 'confirmed', via: 'form', action }),
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Could not save. Try again.' });
  assert.equal(JSON.stringify(logged.mock.calls).includes('boom secret'), false);
});

const tripNotes = { kind: 'note', id: noteRow.id, title: 'Gift ideas', when: null };
const append = {
  kind: 'APPEND',
  phrase: 'gift',
  target: tripNotes,
  alternatives: [],
  text: ' Lamp ',
};
const appendDecision = { intent: 'APPEND', confidence: 0.9, entities: {}, action: append };
const appendBody = {
  text: "add 'lamp' to gift notes",
  decision: appendDecision,
  outcome: 'confirmed',
  action: append,
  via: 'instant',
};

test('an instant append is applied with its text trimmed', async (t) => {
  const upstream = mockSupabaseAuth(t, async () =>
    Response.json({
      eventId: LOG_ID,
      item: { kind: 'note', ...noteRow, body: 'Book, scarf\nLamp' },
    }),
  );
  const response = await POST(request(appendBody));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    eventId: LOG_ID,
    item: { ...savedNote, body: 'Book, scarf\nLamp' },
  });
  const call = upstreamCall(upstream);
  assert.equal(call.body.input_action.text, 'Lamp');
  assert.equal(call.body.input_via, 'instant');
});

test('a change to an item that moved on returns 409', async (t) => {
  mockSupabaseAuth(t, async () =>
    Response.json({ code: 'NXU01', message: 'The item changed or is not yours' }, { status: 400 }),
  );
  const response = await POST(request(appendBody));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'That item changed; try again.' });
});

test('appending past the note limit returns 409 instead of a 500', async (t) => {
  mockSupabaseAuth(t, async () =>
    Response.json({ code: '23514', message: 'violates check constraint' }, { status: 400 }),
  );
  const response = await POST(request(appendBody));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'That note is full.' });
});
