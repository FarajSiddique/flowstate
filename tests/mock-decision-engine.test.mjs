import assert from 'node:assert/strict';
import test from 'node:test';

import { MockDecisionEngine } from '../apps/api/src/lib/decision-engine/mock-decision-engine.ts';

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
