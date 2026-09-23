import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findActionCandidates,
  resolveReference,
} from '../apps/api/src/lib/decision-engine/action-candidates.ts';

// 22:30 on Sep 23 in New York, 02:30 on Sep 24 in UTC.
const now = '2026-09-24T02:30:00Z';
const newYork = resolveReference({ now, timeZone: 'America/New_York' });

const spans = (candidates) => candidates.map(({ text, value }) => [text, value]);

test('resolves the user-local day, not the server or UTC day', () => {
  assert.equal(newYork.today, '2026-09-23');
  assert.equal(newYork.offsetMinutes, -240);
  assert.equal(resolveReference({ now, timeZone: 'Asia/Tokyo' }).today, '2026-09-24');
  const tomorrow = (timeZone) =>
    findActionCandidates('meet Sarah tomorrow at 9am', resolveReference({ now, timeZone })).when[0]
      .value;
  assert.deepEqual(tomorrow('America/New_York'), { date: '2026-09-24', time: '09:00' });
  assert.deepEqual(tomorrow('Asia/Tokyo'), { date: '2026-09-25', time: '09:00' });
});

test('separates start time, duration, place and people in an event', () => {
  const found = findActionCandidates('meet Sarah tomorrow at 2 for 45 min at Blue Bottle', newYork);
  assert.deepEqual(spans(found.when), [['tomorrow at 2', { date: '2026-09-24', time: '14:00' }]]);
  assert.deepEqual(spans(found.duration), [['for 45 min', 45]]);
  // "at 2" is a time, never a place.
  assert.deepEqual(spans(found.location), [['at Blue Bottle', 'Blue Bottle']]);
  assert.deepEqual(spans(found.attendees), [['Sarah', ['Sarah']]]);
});

test('finds several attendees and keeps relative starts out of durations', () => {
  const lunch = findActionCandidates('lunch with Alex and Priya on Monday at noon', newYork);
  assert.deepEqual(spans(lunch.attendees), [['Alex and Priya', ['Alex', 'Priya']]]);
  assert.deepEqual(spans(lunch.when), [
    ['on Monday at noon', { date: '2026-09-28', time: '12:00' }],
  ]);
  const later = findActionCandidates('review the budget in 2 hours', newYork);
  assert.deepEqual(later.duration, []);
  assert.deepEqual(later.when[0].value, { date: '2026-09-24', time: '00:30' });
});

test('includes a leading preposition in dates and over-finds places for Jev to reject', () => {
  const task = findActionCandidates('finish report by Friday, urgent', newYork);
  assert.deepEqual(spans(task.when), [['by Friday', { date: '2026-09-25', time: null }]]);
  const look = findActionCandidates('look at the budget', newYork);
  assert.deepEqual(spans(look.location), [['at the budget', 'the budget']]);
});

test('builds calendar ranges for searches', () => {
  const found = findActionCandidates('search notes from last week', newYork);
  assert.deepEqual(spans(found.range), [
    ['from last week', { from: '2026-09-14', to: '2026-09-20' }],
  ]);
  const month = findActionCandidates('find meetings this month', newYork);
  assert.deepEqual(month.range[0].value, { from: '2026-09-01', to: '2026-09-30' });
});

test('offers note title/body splits and nothing for plain text', () => {
  const note = findActionCandidates(
    'write down idea about onboarding: use progressive disclosure',
    newYork,
  );
  assert.deepEqual(
    note.noteSplit.map(({ value }) => value),
    [{ title: 'onboarding', body: 'use progressive disclosure' }],
  );
  const plain = findActionCandidates('asdf banana purple', newYork);
  for (const list of Object.values(plain)) assert.deepEqual(list, []);
});
