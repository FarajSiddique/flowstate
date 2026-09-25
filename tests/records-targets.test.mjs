import assert from 'node:assert/strict';
import test from 'node:test';

import { rankTargets } from '../apps/api/src/lib/records/targets.ts';
import { savedEvent, savedNote, savedTask } from './support/records.mjs';

test('closest dated items come first, then undated ones, newest first', () => {
  const today = '2026-09-26';
  const olderNote = {
    ...savedNote,
    id: '5a2b6e3d-7c9f-4b1a-9d36-8f0c2b4d6e7f',
    updatedAt: '2026-09-20T12:00:00.000000+00:00',
  };
  const refs = rankTargets([olderNote, savedTask, savedNote, savedEvent], today);
  assert.deepEqual(
    refs.map((ref) => ref.id),
    [savedEvent.id, savedTask.id, savedNote.id, olderNote.id],
  );
  assert.deepEqual(refs[0], {
    kind: 'event',
    id: savedEvent.id,
    title: 'Design review',
    when: { date: '2026-09-26', time: null },
  });
});

test('at most five targets are kept', () => {
  const many = Array.from({ length: 7 }, (_, index) => ({
    ...savedNote,
    id: `5a2b6e3d-7c9f-4b1a-9d36-8f0c2b4d6e7${index}`,
  }));
  assert.equal(rankTargets(many, '2026-09-26').length, 5);
});
