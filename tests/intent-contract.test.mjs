import assert from 'node:assert/strict';
import test from 'node:test';

import { intentRequestSchema, intentResponseSchema } from '../packages/types/src/index.ts';

test('intent request accepts meaningful text and rejects blank input', () => {
  assert.deepEqual(intentRequestSchema.parse({ text: '  meet Sarah  ' }), {
    text: 'meet Sarah',
  });
  assert.equal(intentRequestSchema.safeParse({ text: '   ' }).success, false);
  assert.equal(intentRequestSchema.safeParse({ text: 42 }).success, false);
});

test('intent response validates confidence and known intent values', () => {
  const valid = { intent: 'CREATE_EVENT', confidence: 0.96, entities: { person: 'Sarah' } };
  assert.deepEqual(intentResponseSchema.parse(valid), valid);
  assert.equal(intentResponseSchema.safeParse({ ...valid, confidence: 1.2 }).success, false);
  assert.equal(intentResponseSchema.safeParse({ ...valid, intent: 'CHAT' }).success, false);
});

test('intent request accepts an optional client clock and IANA time zone', () => {
  const context = { now: '2026-09-24T02:30:00.000Z', timeZone: 'America/New_York' };
  assert.deepEqual(intentRequestSchema.parse({ text: 'meet Sarah', context }), {
    text: 'meet Sarah',
    context,
  });
  for (const bad of [
    { ...context, timeZone: 'Mars/Olympus' },
    { ...context, now: 'tomorrow' },
    { now: context.now },
  ]) {
    assert.equal(
      intentRequestSchema.safeParse({ text: 'meet Sarah', context: bad }).success,
      false,
    );
  }
});

test('intent response accepts a typed action only when it matches the intent', () => {
  const task = {
    intent: 'CREATE_TASK',
    confidence: 0.9,
    entities: { title: 'Pay rent' },
    action: {
      kind: 'CREATE_TASK',
      title: 'Pay rent',
      due: { date: '2026-09-24', time: null },
      priority: 'high',
    },
  };
  assert.deepEqual(intentResponseSchema.parse(task), task);
  const reject = (change) => assert.equal(intentResponseSchema.safeParse(change).success, false);
  reject({ ...task, intent: 'CREATE_NOTE' });
  reject({ ...task, action: { ...task.action, due: { date: '24/09/2026', time: null } } });
  reject({ ...task, action: { ...task.action, due: { date: '2026-09-24', time: '25:00' } } });
  reject({ ...task, action: { ...task.action, priority: 'extreme' } });
  reject({
    ...task,
    intent: 'CREATE_EVENT',
    action: {
      kind: 'CREATE_EVENT',
      title: 'Standup',
      start: null,
      durationMin: 0,
      attendees: [],
      location: null,
    },
  });
});

test('highlights are optional and their offsets must match their text', () => {
  const base = { intent: 'CREATE_TASK', confidence: 0.9, entities: {} };
  const highlight = { field: 'when', start: 12, end: 20, text: 'tomorrow' };
  assert.equal(intentResponseSchema.safeParse({ ...base, highlights: [highlight] }).success, true);
  for (const bad of [
    { ...highlight, end: 22 },
    { ...highlight, field: 'mood' },
    { ...highlight, text: '' },
  ]) {
    assert.equal(intentResponseSchema.safeParse({ ...base, highlights: [bad] }).success, false);
  }
});
