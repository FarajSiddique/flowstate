import assert from 'node:assert/strict';
import test from 'node:test';

import {
  eventPatchSchema,
  intentEventRequestSchema,
  notePatchSchema,
  savedItemSchema,
  searchQuerySchema,
  taskPatchSchema,
  timelineQuerySchema,
} from '../packages/types/src/index.ts';
import { savedTask } from './support/records.mjs';

const decision = { intent: 'CREATE_TASK', confidence: 0.9, entities: {} };
const action = { kind: 'CREATE_TASK', title: 'Call mom', due: null, priority: 'normal' };

test('a saved item accepts PostgREST timestamps and rejects unknown values', () => {
  assert.deepEqual(savedItemSchema.parse(savedTask), savedTask);
  assert.equal(savedItemSchema.safeParse({ ...savedTask, priority: 'urgent' }).success, false);
  assert.equal(savedItemSchema.safeParse({ ...savedTask, kind: 'reminder' }).success, false);
});

test('a confirmed intent event needs a titled action that matches the decision', () => {
  const base = { text: 'call mom', decision, outcome: 'confirmed' };
  assert.equal(intentEventRequestSchema.safeParse({ ...base, action }).success, true);
  assert.equal(intentEventRequestSchema.safeParse(base).success, false);
  assert.equal(
    intentEventRequestSchema.safeParse({ ...base, action: { ...action, title: '   ' } }).success,
    false,
  );
  assert.equal(
    intentEventRequestSchema.safeParse({
      ...base,
      action: { kind: 'CREATE_NOTE', title: 'x', body: null },
    }).success,
    false,
  );
  assert.equal(
    intentEventRequestSchema.safeParse({ text: 'call mom', decision, outcome: 'dismissed' })
      .success,
    true,
  );
});

test('timeline query coerces limit, defaults to 50 and caps at 100', () => {
  assert.deepEqual(timelineQuerySchema.parse({}), { limit: 50 });
  assert.deepEqual(timelineQuerySchema.parse({ limit: '20', cursor: 'abc' }), {
    limit: 20,
    cursor: 'abc',
  });
  assert.equal(timelineQuerySchema.safeParse({ limit: '0' }).success, false);
  assert.equal(timelineQuerySchema.safeParse({ limit: '101' }).success, false);
});

test('search query needs text and an ordered date range', () => {
  assert.deepEqual(searchQuerySchema.parse({ q: ' dentist ' }), { q: 'dentist', scope: 'all' });
  assert.equal(searchQuerySchema.safeParse({ q: '  ' }).success, false);
  assert.equal(
    searchQuerySchema.safeParse({ q: 'x', from: '2026-09-30', to: '2026-09-01' }).success,
    false,
  );
});

test('patches accept only their own kind of fields and must change something', () => {
  assert.equal(taskPatchSchema.safeParse({ completed: true }).success, true);
  assert.equal(taskPatchSchema.safeParse({}).success, false);
  assert.equal(taskPatchSchema.safeParse({ durationMin: 30 }).success, false);
  assert.equal(
    eventPatchSchema.safeParse({ start: null, attendees: ['Ana'], completed: false }).success,
    true,
  );
  assert.equal(notePatchSchema.safeParse({ title: '' }).success, false);
});
