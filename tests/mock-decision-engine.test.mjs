import assert from 'node:assert/strict';
import test from 'node:test';

import { MockDecisionEngine } from '../apps/api/src/lib/decision-engine/mock-decision-engine.ts';

const engine = new MockDecisionEngine();

test('classifies an event with person, date and 24-hour time', async () => {
  assert.deepEqual(await engine.classifyIntent({ text: 'meet Sarah tomorrow at 2' }), {
    intent: 'CREATE_EVENT',
    confidence: 0.96,
    entities: { title: 'Meet Sarah', person: 'Sarah', date: 'tomorrow', time: '14:00' },
  });
});

test('classifies a dated task', async () => {
  assert.deepEqual(
    await engine.classifyIntent({ text: 'remind me to submit my application tomorrow' }),
    {
      intent: 'CREATE_TASK',
      confidence: 0.95,
      entities: { title: 'Submit my application', date: 'tomorrow' },
    },
  );
});

test('classifies a note and search query', async () => {
  assert.deepEqual(await engine.classifyIntent({ text: 'write down idea about AI sports coach' }), {
    intent: 'CREATE_NOTE',
    confidence: 0.95,
    entities: { title: 'AI sports coach' },
  });
  assert.deepEqual(await engine.classifyIntent({ text: 'find my architecture notes' }), {
    intent: 'SEARCH',
    confidence: 0.94,
    entities: { query: 'architecture notes' },
  });
});

test('returns unknown for nonsense', async () => {
  assert.deepEqual(await engine.classifyIntent({ text: 'asdf banana purple' }), {
    intent: 'UNKNOWN',
    confidence: 0.3,
    entities: {},
  });
});
