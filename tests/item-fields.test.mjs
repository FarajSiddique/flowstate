import assert from 'node:assert/strict';
import test from 'node:test';

import { displayItemMeta } from '../apps/mobile/src/lib/intent-display.ts';
import {
  fieldsFromDecision,
  fieldsFromItem,
  fieldsToAction,
  fieldsToPatch,
} from '../apps/mobile/src/lib/item-fields.ts';
import { savedEvent, savedNote, savedTask } from './support/records.mjs';

const today = '2026-09-24';

test('a drafted event round-trips through the form unchanged', () => {
  const action = {
    kind: 'CREATE_EVENT',
    title: 'Dinner with Ana',
    start: { date: '2026-09-25', time: '19:00' },
    durationMin: 90,
    attendees: ['Ana'],
    location: 'Blue Bottle',
  };
  const decision = { intent: 'CREATE_EVENT', confidence: 0.9, entities: {}, action };
  const fields = fieldsFromDecision(decision, today);
  assert.equal(fields.date, 'Fri, Sep 25');
  assert.deepEqual(fieldsToAction('CREATE_EVENT', fields, today), { ok: true, value: action });
});

test('edited fields become a typed action, with blanks as null', () => {
  const decision = { intent: 'CREATE_TASK', confidence: 0.9, entities: { title: 'pay rent' } };
  const fields = {
    ...fieldsFromDecision(decision, today),
    date: 'Oct 1',
    time: '',
    priority: 'high',
  };
  assert.deepEqual(fieldsToAction('CREATE_TASK', fields, today), {
    ok: true,
    value: {
      kind: 'CREATE_TASK',
      title: 'pay rent',
      due: { date: '2026-10-01', time: null },
      priority: 'high',
    },
  });
});

test('unreadable fields explain themselves instead of sending anything', () => {
  const decision = { intent: 'CREATE_TASK', confidence: 0.9, entities: { title: 'x' } };
  const base = fieldsFromDecision(decision, today);
  assert.deepEqual(fieldsToAction('CREATE_TASK', { ...base, date: 'next friday' }, today), {
    ok: false,
    error: 'Enter a date like Sep 24.',
  });
  assert.deepEqual(fieldsToAction('CREATE_TASK', { ...base, date: '', time: '3pm' }, today), {
    ok: false,
    error: 'Add a date for this time.',
  });
  assert.deepEqual(fieldsToAction('CREATE_TASK', { ...base, title: '  ' }, today), {
    ok: false,
    error: 'Add a title.',
  });
  assert.equal(fieldsToAction('UNKNOWN', base, today).ok, false);
});

test('a search reads its query, scope and range', () => {
  const decision = { intent: 'SEARCH', confidence: 0.9, entities: { query: 'dentist' } };
  const fields = {
    ...fieldsFromDecision(decision, today),
    scope: 'events',
    range: 'Sep 1 – Sep 30',
  };
  assert.deepEqual(fieldsToAction('SEARCH', fields, today), {
    ok: true,
    value: {
      kind: 'SEARCH',
      query: 'dentist',
      scope: 'events',
      range: { from: '2026-09-01', to: '2026-09-30' },
    },
  });
});

test('saved items prefill the form and read back as a full patch', () => {
  assert.deepEqual(fieldsToPatch(savedTask, fieldsFromItem(savedTask, today), today), {
    ok: true,
    value: { title: 'Call mom', due: { date: '2026-09-25', time: '15:00' }, priority: 'normal' },
  });
  const eventFields = { ...fieldsFromItem(savedEvent, today), location: '  ', attendees: 'Ana' };
  assert.deepEqual(fieldsToPatch(savedEvent, eventFields, today), {
    ok: true,
    value: {
      title: 'Design review',
      start: { date: '2026-09-26', time: null },
      durationMin: 60,
      location: null,
      attendees: ['Ana'],
    },
  });
  assert.deepEqual(fieldsToPatch(savedNote, fieldsFromItem(savedNote, today), today), {
    ok: true,
    value: { title: 'Gift ideas', body: 'Book, scarf' },
  });
});

test('timeline rows describe kind and timing', () => {
  assert.equal(displayItemMeta(savedTask, 2026), 'Task · Fri, Sep 25 · 3:00 PM');
  assert.equal(displayItemMeta({ ...savedEvent, start: null }, 2026), 'Event · Unscheduled');
  assert.equal(displayItemMeta(savedEvent, 2026), 'Event · Sat, Sep 26 · 1 hr');
  assert.equal(displayItemMeta(savedNote, 2026), 'Note');
});

test('dates outside the current year show their year and round-trip unchanged', () => {
  const farTask = { ...savedTask, due: { date: '2027-06-01', time: null } };
  const pastTask = { ...savedTask, due: { date: '2025-01-10', time: '09:00' } };
  assert.equal(fieldsFromItem(farTask, today).date, 'Tue, Jun 1, 2027');

  for (const item of [farTask, pastTask]) {
    const patch = fieldsToPatch(item, fieldsFromItem(item, today), today);
    assert.equal(patch.ok && patch.value.due.date, item.due.date);
  }

  const action = {
    kind: 'CREATE_TASK',
    title: 'Renew passport',
    due: { date: '2027-06-01', time: null },
    priority: 'normal',
  };
  const decision = { intent: 'CREATE_TASK', confidence: 0.9, entities: {}, action };
  assert.deepEqual(fieldsToAction('CREATE_TASK', fieldsFromDecision(decision, today), today), {
    ok: true,
    value: action,
  });
  assert.equal(displayItemMeta(farTask, 2026), 'Task · Tue, Jun 1, 2027');
});
