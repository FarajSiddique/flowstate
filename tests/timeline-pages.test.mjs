import assert from 'node:assert/strict';
import test from 'node:test';

import { withCompletedAt } from '../apps/mobile/src/lib/timeline-pages.ts';
import { savedEvent, savedNote, savedTask } from './support/records.mjs';

const data = {
  pages: [
    { items: [savedTask, savedEvent], nextCursor: 'c1' },
    { items: [savedNote], nextCursor: null },
  ],
  pageParams: [null, 'c1'],
};

test('marks only the matching kind and id, across pages', () => {
  const stamp = '2026-09-24T18:30:00.000Z';
  const next = withCompletedAt(data, savedNote, stamp);
  assert.equal(next.pages[1].items[0].completedAt, stamp);
  assert.equal(next.pages[0].items[0].completedAt, null);
  assert.deepEqual(next.pageParams, data.pageParams);
  assert.equal(data.pages[1].items[0].completedAt, null, 'input is not mutated');
  assert.equal(
    withCompletedAt(data, { kind: 'event', id: savedTask.id }, stamp).pages[0].items[0].completedAt,
    null,
  );
  assert.equal(withCompletedAt(undefined, savedTask, stamp), undefined);
});
