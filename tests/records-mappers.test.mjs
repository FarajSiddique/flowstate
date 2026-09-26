import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeCursor, encodeCursor } from '../apps/api/src/lib/records/cursor.ts';
import { toPatchColumns, toSavedItem } from '../apps/api/src/lib/records/mappers.ts';
import {
  eventRow,
  noteRow,
  savedEvent,
  savedNote,
  savedTask,
  taskRow,
  TASK_ID,
} from './support/records.mjs';

test('rows map to contracts, trimming Postgres seconds off times', () => {
  assert.deepEqual(toSavedItem('task', taskRow), savedTask);
  assert.deepEqual(toSavedItem('event', eventRow), savedEvent);
  assert.deepEqual(toSavedItem('note', noteRow), savedNote);
  assert.deepEqual(toSavedItem('task', { ...taskRow, due_date: null, due_time: null }).due, null);
});

test('a malformed row throws instead of reaching the client', () => {
  assert.throws(() => toSavedItem('task', { ...taskRow, priority: 'urgent' }));
});

test('patches become column updates, and completion is stamped by the server', () => {
  const now = new Date('2026-09-24T18:30:00.000Z');
  assert.deepEqual(
    toPatchColumns({ due: { date: '2026-09-27', time: null }, completed: true }, now),
    { due_date: '2026-09-27', due_time: null, completed_at: '2026-09-24T18:30:00.000Z' },
  );
  assert.deepEqual(toPatchColumns({ due: null, completed: false }, now), {
    due_date: null,
    due_time: null,
    completed_at: null,
  });
  assert.deepEqual(toPatchColumns({ title: 'New', durationMin: 30, attendees: [] }, now), {
    title: 'New',
    duration_min: 30,
    attendees: [],
  });
});

test('cursors round-trip and reject anything tampered with', () => {
  const cursor = { sortAt: '2026-09-25T15:00:00', id: TASK_ID };
  assert.deepEqual(decodeCursor(encodeCursor(cursor)), cursor);
  assert.equal(decodeCursor('not-a-cursor'), null);
  assert.equal(decodeCursor(encodeCursor({ ...cursor, id: "x' or 1=1" })), null);
  assert.equal(decodeCursor(encodeCursor({ ...cursor, sortAt: 'tomorrow' })), null);
});
