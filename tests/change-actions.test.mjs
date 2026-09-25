import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveReference } from '../apps/api/src/lib/decision-engine/action-candidates.ts';
import {
  buildChangeAction,
  findChangeMatch,
  parseWhenParts,
  shortlistTargets,
} from '../apps/api/src/lib/decision-engine/change-actions.ts';
import { EVENT_ID, TASK_ID } from './support/records.mjs';

// Noon on Thursday, Sep 24 in New York.
const reference = resolveReference({
  now: '2026-09-24T16:00:00Z',
  timeZone: 'America/New_York',
});
const dentist = {
  kind: 'event',
  id: EVENT_ID,
  title: 'Dentist',
  when: { date: '2026-09-24', time: '15:00' },
};
const callMom = { kind: 'task', id: TASK_ID, title: 'Call mom', when: null };

test('finds the verb and the phrase naming the item', () => {
  const cases = [
    ['done with the report', 'COMPLETE', 'report'],
    ["I'm done with the quarterly report.", 'COMPLETE', 'quarterly report'],
    ['finished call mom', 'COMPLETE', 'call mom'],
    ['mark the dentist appointment as done', 'COMPLETE', 'dentist appointment'],
    ['check off groceries', 'COMPLETE', 'groceries'],
    ['the report is done', 'COMPLETE', 'report'],
    ['push the dentist to friday at 4', 'RESCHEDULE', 'dentist'],
    ['move standup back to 10', 'RESCHEDULE', 'standup'],
    ["add 'bring charger' to trip notes", 'APPEND', 'trip'],
    ['append passport copy to my trip note', 'APPEND', 'trip'],
  ];

  for (const [text, intent, phrase] of cases) {
    const match = findChangeMatch(text, reference);
    assert.equal(match?.intent, intent, text);
    assert.equal(match?.phrase, phrase, text);
  }

  assert.equal(
    findChangeMatch("add 'bring charger' to trip notes", reference).text,
    'bring charger',
  );
  assert.equal(
    findChangeMatch('append passport copy to my trip note', reference).text,
    'passport copy',
  );
});

test('create phrases, bare verbs and non-date destinations are not changes', () => {
  for (const text of [
    'finish the report tonight',
    'remind me to move the couch',
    'add dentist to calendar friday',
    'done with',
    'meet Sarah tomorrow at 2',
    'move the couch to the garage',
  ]) {
    assert.equal(findChangeMatch(text, reference), null, text);
  }
});

test('a phrase longer than the contract allows is not a change', () => {
  assert.equal(findChangeMatch('finished ' + 'x'.repeat(250), reference), null);
});

test('reads only the date and time parts the user said', () => {
  assert.deepEqual(parseWhenParts('friday at 4', reference), { date: '2026-09-25', time: '16:00' });
  assert.deepEqual(parseWhenParts('tomorrow', reference), { date: '2026-09-25', time: null });
  assert.deepEqual(parseWhenParts('10', reference), { date: null, time: '10:00' });
  assert.deepEqual(parseWhenParts('3pm', reference), { date: null, time: '15:00' });
  assert.deepEqual(parseWhenParts('9:30', reference), { date: null, time: '09:30' });
  assert.equal(parseWhenParts('the garage', reference), null);
});

test('a picked target resolves the new time against its current date', () => {
  const match = findChangeMatch('move dentist to 10', reference);
  assert.deepEqual(
    buildChangeAction(match, [dentist], { type: 'picked', id: EVENT_ID }, reference),
    {
      kind: 'RESCHEDULE',
      phrase: 'dentist',
      target: dentist,
      alternatives: [],
      to: { date: '2026-09-24', time: '10:00' },
      toParsed: { date: null, time: '10:00' },
    },
  );
});

test('unsure keeps the shortlist as alternatives; none leaves nothing', () => {
  const match = findChangeMatch('done with call mom', reference);
  assert.deepEqual(buildChangeAction(match, [callMom, dentist], { type: 'unsure' }, reference), {
    kind: 'COMPLETE',
    phrase: 'call mom',
    target: null,
    alternatives: [callMom, dentist],
  });
  assert.deepEqual(buildChangeAction(match, [callMom], { type: 'none' }, reference), {
    kind: 'COMPLETE',
    phrase: 'call mom',
    target: null,
    alternatives: [],
  });
});

test('the shortlist asks for the allowed kinds and survives a failed lookup', async (t) => {
  const calls = [];
  const lookup = {
    async findTargets(phrase, kinds) {
      calls.push({ phrase, kinds });

      return [dentist];
    },
  };
  const match = findChangeMatch('push the dentist to friday at 4', reference);
  assert.deepEqual(await shortlistTargets(lookup, match), [dentist]);
  assert.deepEqual(calls, [{ phrase: 'dentist', kinds: ['task', 'event'] }]);

  const logged = t.mock.method(console, 'error', () => {});
  const failing = { findTargets: async () => Promise.reject(new Error('db down secret')) };
  assert.deepEqual(await shortlistTargets(failing, match), []);
  assert.equal(JSON.stringify(logged.mock.calls).includes('secret'), false);
});
