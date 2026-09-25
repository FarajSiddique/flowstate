import assert from 'node:assert/strict';
import test from 'node:test';

import { POST } from '../apps/api/src/app/api/intent-events/[id]/undo/route.ts';
import { LOG_ID, savedTask, taskRow } from './support/records.mjs';
import {
  mockSupabaseAuth,
  signToken,
  supabaseEnv,
  upstreamCall,
} from './support/supabase-auth.mjs';

function undo(id, token = signToken()) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const request = new Request(`http://localhost/api/intent-events/${id}/undo`, {
    method: 'POST',
    headers,
  });

  return POST(request, { params: Promise.resolve({ id }) });
}

const refusal = (message) => async () => Response.json({ code: 'NXU09', message }, { status: 400 });

test('undo requires a valid token', async (t) => {
  const upstream = mockSupabaseAuth(t);
  assert.equal((await undo(LOG_ID, null)).status, 401);
  assert.equal(upstream.mock.callCount(), 0);
});

test('undoing a change returns the restored item', async (t) => {
  const token = signToken();
  const upstream = mockSupabaseAuth(t, async () => Response.json({ kind: 'task', ...taskRow }));
  const response = await undo(LOG_ID, token);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { item: savedTask });
  const call = upstreamCall(upstream);
  assert.equal(call.url.href, `${supabaseEnv.SUPABASE_URL}/rest/v1/rpc/undo_intent`);
  assert.equal(call.headers.get('authorization'), `Bearer ${token}`);
  assert.deepEqual(call.body, { input_event_id: LOG_ID });
});

test('undoing a create returns no item', async (t) => {
  mockSupabaseAuth(t, async () => Response.json(null));
  const response = await undo(LOG_ID);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { item: null });
});

test('an unknown or foreign log row is 404, and a bad id never reaches the database', async (t) => {
  const upstream = mockSupabaseAuth(t, async () =>
    Response.json({ code: 'NXU04', message: 'Not found' }, { status: 400 }),
  );
  assert.equal((await undo(LOG_ID)).status, 404);
  assert.equal((await undo('not-a-uuid')).status, 404);
  assert.equal(upstream.mock.callCount(), 1);
});

test('refusals pass their reason through as 409', async (t) => {
  for (const reason of [
    'Too late to undo',
    'Item was edited, so undo was skipped',
    'Already undone',
    'Nothing to undo',
  ]) {
    mockSupabaseAuth(t, refusal(reason));
    const response = await undo(LOG_ID);
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: reason });
    t.mock.restoreAll();
  }
});

test('an unexpected refusal message is replaced with a generic one', async (t) => {
  mockSupabaseAuth(t, refusal('internal detail'));
  const response = await undo(LOG_ID);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'Could not undo. Try again.' });
});

test('a database failure returns a generic 500 and logs no details', async (t) => {
  mockSupabaseAuth(t, async () =>
    Response.json({ message: 'boom secret', code: 'XX000' }, { status: 500 }),
  );
  const logged = t.mock.method(console, 'error', () => {});
  const response = await undo(LOG_ID);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Could not undo. Try again.' });
  assert.equal(JSON.stringify(logged.mock.calls).includes('boom secret'), false);
});
