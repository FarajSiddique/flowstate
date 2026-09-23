import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHighlights,
  buildIntentAction,
} from '../apps/api/src/lib/decision-engine/action-builder.ts';
import {
  findActionCandidates,
  resolveReference,
} from '../apps/api/src/lib/decision-engine/action-candidates.ts';

const reference = resolveReference({
  now: '2026-09-24T02:30:00Z',
  timeZone: 'America/New_York',
});

function build(intent, text, selections = {}) {
  return buildIntentAction(intent, text, findActionCandidates(text, reference), selections);
}

test('event title drops only the selected time, duration and place spans', () => {
  const text = 'meet Sarah tomorrow at 2 for 45 min at Blue Bottle';
  assert.deepEqual(
    build('CREATE_EVENT', text, {
      when: 'when_1',
      duration: 'duration_1',
      location: 'location_1',
      attendees: 'attendees_1',
    }),
    {
      kind: 'CREATE_EVENT',
      title: 'Meet Sarah',
      start: { date: '2026-09-24', time: '14:00' },
      durationMin: 45,
      attendees: ['Sarah'],
      location: 'Blue Bottle',
    },
  );
  // Unselected ("none" or unsure) fields keep their text and use defaults.
  assert.deepEqual(build('CREATE_EVENT', text, { when: 'when_1' }), {
    kind: 'CREATE_EVENT',
    title: 'Meet Sarah for 45 min at Blue Bottle',
    start: { date: '2026-09-24', time: '14:00' },
    durationMin: 30,
    attendees: [],
    location: null,
  });
});

test('task removes the due span, prefix and priority cue', () => {
  assert.deepEqual(
    build('CREATE_TASK', 'finish report by Friday, urgent', { when: 'when_1', priority: 'high' }),
    {
      kind: 'CREATE_TASK',
      title: 'Finish report',
      due: { date: '2026-09-25', time: null },
      priority: 'high',
    },
  );
  assert.deepEqual(build('CREATE_TASK', 'remind me to call mom'), {
    kind: 'CREATE_TASK',
    title: 'Call mom',
    due: null,
    priority: 'normal',
  });
});

test('note uses the selected split; search keeps the query without the range', () => {
  const note = 'write down idea about onboarding: use progressive disclosure';
  assert.deepEqual(build('CREATE_NOTE', note, { noteSplit: 'split_1' }), {
    kind: 'CREATE_NOTE',
    title: 'Onboarding',
    body: 'use progressive disclosure',
  });
  assert.deepEqual(build('CREATE_NOTE', note), {
    kind: 'CREATE_NOTE',
    title: 'Onboarding: use progressive disclosure',
    body: null,
  });
  assert.deepEqual(
    build('SEARCH', 'search notes from last week', { range: 'range_1', scope: 'notes' }),
    {
      kind: 'SEARCH',
      query: 'notes',
      scope: 'notes',
      range: { from: '2026-09-14', to: '2026-09-20' },
    },
  );
});

test('unknown intent and unknown candidate ids produce no values', () => {
  assert.equal(build('UNKNOWN', 'asdf banana purple'), undefined);
  assert.equal(build('CREATE_TASK', 'pay rent tomorrow', { when: 'when_9' }).due, null);
});

test('highlights mark only the spans behind the draft, including the priority cue', () => {
  const marks = (intent, text, selections) =>
    buildHighlights(intent, text, findActionCandidates(text, reference), selections).map(
      ({ field, start, end, text: span }) => {
        assert.equal(text.slice(start, end), span);
        return [field, span];
      },
    );
  const task = 'finish report by Friday, urgent';
  assert.deepEqual(marks('CREATE_TASK', task, { when: 'when_1', priority: 'high' }), [
    ['when', 'by Friday'],
    ['priority', 'urgent'],
  ]);
  // An unsure priority is treated as normal, so the cue stays unmarked.
  assert.deepEqual(marks('CREATE_TASK', task, { when: 'when_1' }), [['when', 'by Friday']]);
  assert.deepEqual(marks('SEARCH', 'search notes from last week', { range: 'range_1' }), [
    ['range', 'from last week'],
  ]);
  assert.deepEqual(marks('CREATE_NOTE', 'note that onboarding: needs work', {}), []);
});
