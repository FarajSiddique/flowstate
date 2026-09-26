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
  const base = { text: 'call mom', decision, outcome: 'confirmed', via: 'form' };
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

test("a confirmed draft stays within the saved columns' limits", () => {
  const event = {
    kind: 'CREATE_EVENT',
    title: 'Design review',
    start: null,
    durationMin: 60,
    attendees: ['Ana'],
    location: 'Room 4',
  };
  const note = { kind: 'CREATE_NOTE', title: 'Gift ideas', body: 'Book' };
  const confirm = (next) => ({
    text: 'save this',
    decision: { intent: next.kind, confidence: 0.9, entities: {} },
    outcome: 'confirmed',
    via: 'form',
    action: next,
  });
  const failedPath = (next) =>
    intentEventRequestSchema.safeParse(confirm(next)).error?.issues[0]?.path;

  assert.equal(intentEventRequestSchema.safeParse(confirm(event)).success, true);
  assert.equal(intentEventRequestSchema.safeParse(confirm(note)).success, true);
  assert.deepEqual(failedPath({ ...note, body: 'x'.repeat(10_001) }), ['action', 'body']);
  assert.deepEqual(failedPath({ ...event, location: 'x'.repeat(201) }), ['action', 'location']);
  assert.deepEqual(failedPath({ ...event, attendees: Array(51).fill('Ana') }), [
    'action',
    'attendees',
  ]);
  assert.deepEqual(failedPath({ ...event, attendees: ['x'.repeat(101)] }), ['action', 'attendees']);
  assert.deepEqual(failedPath({ ...event, attendees: ['  '] }), ['action', 'attendees']);
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
  assert.equal(eventPatchSchema.safeParse({ start: null, attendees: ['Ana'] }).success, true);
  assert.equal(
    eventPatchSchema.safeParse({ completed: true }).success,
    false,
    'only tasks complete',
  );
  assert.equal(
    notePatchSchema.safeParse({ completed: true }).success,
    false,
    'only tasks complete',
  );
  assert.equal(notePatchSchema.safeParse({ title: '' }).success, false);
});
