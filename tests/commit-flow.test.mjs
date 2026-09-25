import assert from 'node:assert/strict';
import test from 'node:test';

import { withTarget } from '../apps/mobile/src/lib/change-actions.ts';
import { commitLabel, undoMessage } from '../apps/mobile/src/lib/commit-label.ts';
import { displayLocalDateTime } from '../apps/mobile/src/lib/intent-display.ts';
import { fieldsFromChange, fieldsToChange } from '../apps/mobile/src/lib/item-fields.ts';
import { submitStep } from '../apps/mobile/src/lib/submit-decision.ts';
import { EVENT_ID, NOTE_ID, TASK_ID } from './support/records.mjs';

const today = '2026-09-24';
const callMom = { kind: 'task', id: TASK_ID, title: 'Call mom', when: null };
const dentist = {
  kind: 'event',
  id: EVENT_ID,
  title: 'Dentist',
  when: { date: '2026-09-24', time: '15:00' },
};
const trip = { kind: 'note', id: NOTE_ID, title: 'Trip notes', when: null };
const task = {
  kind: 'CREATE_TASK',
  title: 'Call mom',
  due: { date: '2026-09-25', time: null },
  priority: 'normal',
};
const complete = { kind: 'COMPLETE', phrase: 'call mom', target: callMom, alternatives: [] };
const move = {
  kind: 'RESCHEDULE',
  phrase: 'dentist',
  target: null,
  alternatives: [dentist],
  to: null,
  toParsed: { date: null, time: '10:00' },
};
const append = {
  kind: 'APPEND',
  phrase: 'trip',
  target: trip,
  alternatives: [],
  text: 'bring charger',
};
const decide = (action, confidence = 0.9) => ({
  intent: action.kind,
  confidence,
  entities: {},
  action,
});

test('labels say exactly what the button will do', () => {
  const to = { date: '2026-09-25', time: '16:00' };
  assert.equal(commitLabel(task), 'Add task');
  assert.equal(commitLabel(complete), "Mark 'Call mom' done");
  assert.equal(
    commitLabel({ ...move, target: dentist, to }),
    `Move Dentist to ${displayLocalDateTime(to)}`,
  );
  assert.equal(commitLabel(append), 'Add to Trip notes');
  assert.equal(undoMessage(task), `Added: Call mom · ${displayLocalDateTime(task.due)}`);
  assert.equal(undoMessage(complete), 'Marked done: Call mom');
  assert.equal(undoMessage(append), 'Added to Trip notes');
});

test('picking an alternative resolves the move against that item', () => {
  assert.deepEqual(withTarget(move, dentist, today), {
    ...move,
    target: dentist,
    alternatives: [],
    to: { date: '2026-09-24', time: '10:00' },
  });
});

test('return commits sure drafts, opens the form for unsure creates, and ignores the rest', () => {
  assert.equal(submitStep(decide(task)), 'commit');
  assert.equal(submitStep(decide(task, 0.7)), 'open-form');
  assert.equal(
    submitStep(decide({ kind: 'SEARCH', query: 'x', scope: 'all', range: null })),
    'open-form',
  );
  assert.equal(submitStep(decide(complete)), 'commit');
  assert.equal(submitStep(decide(move)), 'ignore');
  assert.equal(submitStep({ intent: 'UNKNOWN', confidence: 0.3, entities: {} }), 'ignore');
  assert.equal(submitStep(null), 'ignore');
});

test('the move and append forms round-trip, and refuse empty values', () => {
  const picked = withTarget(move, dentist, today);
  const fields = fieldsFromChange(picked, today);
  assert.equal(fields.time, '10:00 AM');
  assert.deepEqual(fieldsToChange(picked, fields, today), { ok: true, value: picked });
  assert.deepEqual(fieldsToChange(picked, { ...fields, date: '', time: '' }, today), {
    ok: false,
    error: 'Pick a new date.',
  });
  assert.deepEqual(
    fieldsToChange(append, { ...fieldsFromChange(append, today), body: ' ' }, today),
    {
      ok: false,
      error: 'Add some text.',
    },
  );
});
