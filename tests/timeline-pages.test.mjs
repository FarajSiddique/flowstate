import assert from 'node:assert/strict';
import test from 'node:test';

import { withoutItem } from '../apps/mobile/src/lib/timeline-pages.ts';
import { savedEvent, savedNote, savedTask } from './support/records.mjs';

const data = {
  pages: [
    { items: [savedTask, savedEvent], nextCursor: 'c1' },
    { items: [savedNote], nextCursor: null },
  ],
  pageParams: [null, 'c1'],
};

test('removes only the matching kind and id, across pages', () => {
  const next = withoutItem(data, savedTask);
  assert.deepEqual(next.pages[0].items, [savedEvent]);
  assert.deepEqual(next.pages[1].items, [savedNote]);
  assert.deepEqual(next.pageParams, data.pageParams);
  assert.equal(data.pages[0].items.length, 2, 'input is not mutated');
  assert.equal(withoutItem(data, { kind: 'event', id: savedTask.id }).pages[0].items.length, 2);
  assert.equal(withoutItem(undefined, savedTask), undefined);
});
