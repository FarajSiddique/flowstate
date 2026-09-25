import assert from 'node:assert/strict';
import test from 'node:test';

import { MockDecisionEngine } from '../apps/api/src/lib/decision-engine/mock-decision-engine.ts';
import { EVENT_ID, NOTE_ID, TASK_ID } from './support/records.mjs';

const engine = new MockDecisionEngine();
// 22:30 on Sep 23 in New York, 02:30 on Sep 24 in UTC.
const context = { now: '2026-09-24T02:30:00Z', timeZone: 'America/New_York' };

test('classifies an event with person, date and 24-hour time', async () => {
  assert.deepEqual(await engine.classifyIntent({ text: 'meet Sarah tomorrow at 2', context }), {
    intent: 'CREATE_EVENT',
    confidence: 0.96,
    entities: { title: 'Meet Sarah', person: 'Sarah', date: 'tomorrow', time: '14:00' },
    action: {
      kind: 'CREATE_EVENT',
      title: 'Meet Sarah',
      start: { date: '2026-09-24', time: '14:00' },
      durationMin: 30,
      attendees: ['Sarah'],
      location: null,
    },
    highlights: [
      { field: 'attendees', start: 5, end: 10, text: 'Sarah' },
      { field: 'when', start: 11, end: 24, text: 'tomorrow at 2' },
    ],
  });
});

test('classifies a dated task', async () => {
  assert.deepEqual(
    await engine.classifyIntent({ text: 'remind me to submit my application tomorrow', context }),
    {
      intent: 'CREATE_TASK',
      confidence: 0.95,
      entities: { title: 'Submit my application', date: 'tomorrow' },
      action: {
        kind: 'CREATE_TASK',
        title: 'Submit my application',
        due: { date: '2026-09-24', time: null },
        priority: 'normal',
      },
      highlights: [{ field: 'when', start: 35, end: 43, text: 'tomorrow' }],
    },
  );
});

test('classifies a note and search query', async () => {
  assert.deepEqual(await engine.classifyIntent({ text: 'write down idea about AI sports coach' }), {
    intent: 'CREATE_NOTE',
    confidence: 0.95,
    entities: { title: 'AI sports coach' },
    action: { kind: 'CREATE_NOTE', title: 'AI sports coach', body: null },
  });
  assert.deepEqual(await engine.classifyIntent({ text: 'find my architecture notes' }), {
    intent: 'SEARCH',
    confidence: 0.94,
    entities: { query: 'architecture notes' },
    action: { kind: 'SEARCH', query: 'architecture notes', scope: 'notes', range: null },
  });
});

test('returns unknown for nonsense', async () => {
  assert.deepEqual(await engine.classifyIntent({ text: 'asdf banana purple' }), {
    intent: 'UNKNOWN',
    confidence: 0.3,
    entities: {},
  });
});

const noon = { now: '2026-09-24T16:00:00Z', timeZone: 'America/New_York' };
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
const followUp = {
  kind: 'event',
  id: '4f1a5d2c-6b8e-4a0f-8c25-7e9b1a3f5c6d',
  title: 'Dentist follow-up',
  when: null,
};
const tripNotes = { kind: 'note', id: NOTE_ID, title: 'Trip notes', when: null };
const lookupOf = (refs) => ({
  async findTargets(_phrase, kinds) {
    return refs.filter((ref) => kinds.includes(ref.kind));
  },
});

test('completes the one open item whose title matches', async () => {
  assert.deepEqual(
    await engine.classifyIntent({ text: 'done with call mom', context: noon }, lookupOf([callMom])),
    {
      intent: 'COMPLETE',
      confidence: 0.9,
      entities: {},
      action: { kind: 'COMPLETE', phrase: 'call mom', target: callMom, alternatives: [] },
    },
  );
});

test('reschedules to the spoken day and time', async () => {
  const decision = await engine.classifyIntent(
    { text: 'push the dentist to friday at 4', context: noon },
    lookupOf([dentist]),
  );
  assert.deepEqual(decision.action, {
    kind: 'RESCHEDULE',
    phrase: 'dentist',
    target: dentist,
    alternatives: [],
    to: { date: '2026-09-25', time: '16:00' },
    toParsed: { date: '2026-09-25', time: '16:00' },
  });
});

test('two matching items become a choice', async () => {
  const decision = await engine.classifyIntent(
    { text: 'move dentist to 10', context: noon },
    lookupOf([dentist, followUp]),
  );
  assert.equal(decision.action.target, null);
  assert.deepEqual(decision.action.alternatives, [dentist, followUp]);
  assert.equal(decision.action.to, null);
});

test('appends quoted text to a note, and no match leaves nothing to change', async () => {
  const append = await engine.classifyIntent(
    { text: "add 'bring charger' to trip notes", context: noon },
    lookupOf([tripNotes]),
  );
  assert.deepEqual(append.action, {
    kind: 'APPEND',
    phrase: 'trip',
    target: tripNotes,
    alternatives: [],
    text: 'bring charger',
  });
  const none = await engine.classifyIntent(
    { text: 'done with taxes', context: noon },
    lookupOf([]),
  );
  assert.deepEqual(none.action, {
    kind: 'COMPLETE',
    phrase: 'taxes',
    target: null,
    alternatives: [],
  });
});

test('a create phrase never looks up saved items', async () => {
  const lookup = {
    async findTargets() {
      throw new Error('should not be called');
    },
  };
  const decision = await engine.classifyIntent(
    { text: 'remind me to submit my application tomorrow', context: noon },
    lookup,
  );
  assert.equal(decision.intent, 'CREATE_TASK');
});
