import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canCommit,
  intentActionSchema,
  intentEventRequestSchema,
  isChangeIntent,
  resolveRescheduleTo,
} from '../packages/types/src/index.ts';
import { EVENT_ID, NOTE_ID, TASK_ID } from './support/records.mjs';

const callMom = {
  kind: 'task',
  id: TASK_ID,
  title: 'Call mom',
  when: { date: '2026-09-25', time: '15:00' },
};
const dentist = {
  kind: 'event',
  id: EVENT_ID,
  title: 'Dentist',
  when: { date: '2026-09-24', time: '15:00' },
};
const tripNotes = { kind: 'note', id: NOTE_ID, title: 'Trip notes', when: null };
const complete = { kind: 'COMPLETE', phrase: 'call mom', target: callMom, alternatives: [] };
const reschedule = {
  kind: 'RESCHEDULE',
  phrase: 'dentist',
  target: dentist,
  alternatives: [],
  to: { date: '2026-09-25', time: '16:00' },
  toParsed: { date: '2026-09-25', time: '16:00' },
};
const append = {
  kind: 'APPEND',
  phrase: 'trip',
  target: tripNotes,
  alternatives: [],
  text: 'bring charger',
};
const decisionFor = (action, confidence = 0.9) => ({
  intent: action.kind,
  confidence,
  entities: {},
  action,
});

test('change actions parse, with at most five alternatives', () => {
  for (const action of [complete, reschedule, append]) {
    assert.deepEqual(intentActionSchema.parse(action), action);
  }

  const six = Array.from({ length: 6 }, () => callMom);
  assert.equal(
    intentActionSchema.safeParse({ ...complete, target: null, alternatives: six }).success,
    false,
  );
  assert.equal(
    intentActionSchema.safeParse({ ...reschedule, toParsed: { date: null, time: null } }).success,
    false,
  );
  assert.equal(isChangeIntent('RESCHEDULE'), true);
  assert.equal(isChangeIntent('CREATE_TASK'), false);
});

test('canCommit needs high confidence and a complete action', () => {
  const task = { kind: 'CREATE_TASK', title: 'Call mom', due: null, priority: 'normal' };
  assert.equal(canCommit(decisionFor(task)), true);
  assert.equal(canCommit(decisionFor(task, 0.84)), false);
  assert.equal(canCommit(decisionFor({ ...task, title: '  ' })), false);
  assert.equal(canCommit(decisionFor(complete)), true);
  assert.equal(canCommit(decisionFor({ ...complete, target: null })), false);
  assert.equal(canCommit(decisionFor({ ...reschedule, to: null })), false);
  assert.equal(canCommit(decisionFor({ ...append, text: ' ' })), false);
  assert.equal(
    canCommit(decisionFor({ kind: 'SEARCH', query: 'x', scope: 'all', range: null })),
    false,
  );
  assert.equal(canCommit({ intent: 'UNKNOWN', confidence: 1, entities: {} }), false);
});

test('resolveRescheduleTo keeps the parts the user did not say', () => {
  const current = { date: '2026-09-24', time: '15:00' };
  const today = '2026-09-20';
  assert.deepEqual(resolveRescheduleTo({ date: null, time: '10:00' }, current, today), {
    date: '2026-09-24',
    time: '10:00',
  });
  assert.deepEqual(resolveRescheduleTo({ date: '2026-09-25', time: null }, current, today), {
    date: '2026-09-25',
    time: '15:00',
  });
  assert.deepEqual(resolveRescheduleTo({ date: null, time: '10:00' }, null, today), {
    date: '2026-09-20',
    time: '10:00',
  });
});

test('a confirmed event needs `via`, and a confirmed change needs a fitting target', () => {
  const base = { text: 'done with call mom', decision: decisionFor(complete) };
  const confirmed = { ...base, outcome: 'confirmed', action: complete };
  assert.equal(intentEventRequestSchema.safeParse(confirmed).success, false);
  assert.equal(intentEventRequestSchema.safeParse({ ...confirmed, via: 'instant' }).success, true);
  assert.equal(intentEventRequestSchema.safeParse({ ...base, outcome: 'dismissed' }).success, true);

  const untargeted = { ...complete, target: null };
  assert.equal(
    intentEventRequestSchema.safeParse({ ...confirmed, via: 'instant', action: untargeted })
      .success,
    false,
  );

  const noteMove = { ...reschedule, target: tripNotes };
  const moveEvent = {
    text: 'move trip notes to friday',
    decision: decisionFor(noteMove),
    outcome: 'confirmed',
    via: 'instant',
  };
  assert.equal(
    intentEventRequestSchema.safeParse({ ...moveEvent, action: noteMove }).success,
    false,
  );
  assert.equal(
    intentEventRequestSchema.safeParse({
      ...moveEvent,
      decision: decisionFor(reschedule),
      action: { ...reschedule, to: null },
    }).success,
    false,
  );
  assert.equal(
    intentEventRequestSchema.safeParse({
      text: 'add to trip notes',
      decision: decisionFor(append),
      outcome: 'confirmed',
      via: 'form',
      action: { ...append, text: '   ' },
    }).success,
    false,
  );
});
