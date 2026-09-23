import assert from 'node:assert/strict';
import test from 'node:test';

import { extractIntentEntities } from '../apps/api/src/lib/decision-engine/intent-entities.ts';

test('extracts only source entities for the selected intent', () => {
  const cases = [
    [
      'CREATE_TASK',
      'remind me to submit my application tomorrow',
      { title: 'Submit my application', date: 'tomorrow' },
    ],
    [
      'CREATE_EVENT',
      'schedule lunch with Alex Friday',
      { title: 'Lunch with Alex', person: 'Alex', date: 'friday' },
    ],
    [
      'CREATE_EVENT',
      'dentist appointment Monday at 9',
      { title: 'Dentist appointment', date: 'monday', time: '09:00' },
    ],
    [
      'CREATE_EVENT',
      'meet Sarah tomorrow',
      { title: 'Meet Sarah', person: 'Sarah', date: 'tomorrow' },
    ],
    [
      'CREATE_EVENT',
      'meet Sarah at 12 am',
      { title: 'Meet Sarah', person: 'Sarah', time: '00:00' },
    ],
    [
      'CREATE_NOTE',
      'note that we should redesign onboarding',
      { title: 'We should redesign onboarding' },
    ],
    ['SEARCH', 'where is my workout plan', { query: 'workout plan' }],
    ['UNKNOWN', 'meet Sarah tomorrow', {}],
  ];
  for (const [intent, text, expected] of cases)
    assert.deepEqual(extractIntentEntities(intent, text), expected);
});

test('does not invent dates, times, or people in a task', () => {
  assert.deepEqual(extractIntentEntities('CREATE_TASK', 'finish the report'), {
    title: 'Finish the report',
  });
  assert.equal(extractIntentEntities('CREATE_EVENT', 'meet Sarah tomorrow at 99').time, undefined);
  assert.equal(extractIntentEntities('CREATE_EVENT', 'meet Sarah at 2:99').time, undefined);
});
