export const USER_ID = '6f1c9a52-0d0e-4b8f-9f4a-2f0d6f2c9a11';
export const TASK_ID = '0b7c1f8e-2d4a-4c6b-9e1f-3a5d7c9b1e2f';
export const EVENT_ID = '1c8d2a9f-3e5b-4d7c-8f2a-4b6e8d0c2f3a';
export const NOTE_ID = '2d9e3b0a-4f6c-4e8d-a03b-5c7f9e1d3a4b';
export const LOG_ID = '3e0f4c1b-5a7d-4f9e-b14c-6d8a0f2e4b5c';
const STAMP = '2026-09-24T12:00:00.123456+00:00';
const common = { user_id: USER_ID, completed_at: null, created_at: STAMP, updated_at: STAMP };

// Rows as PostgREST returns them.
export const taskRow = {
  ...common,
  id: TASK_ID,
  title: 'Call mom',
  due_date: '2026-09-25',
  due_time: '15:00:00',
  time_zone: 'America/New_York',
  priority: 'normal',
};
export const eventRow = {
  ...common,
  id: EVENT_ID,
  title: 'Design review',
  start_date: '2026-09-26',
  start_time: null,
  time_zone: 'America/New_York',
  duration_min: 60,
  location: 'Room 4',
  attendees: ['Ana', 'Sam'],
};
export const noteRow = {
  ...common,
  id: NOTE_ID,
  title: 'Gift ideas',
  body: 'Book, scarf',
  time_zone: 'America/New_York',
};

// The same rows as API contracts.
const stamps = { createdAt: STAMP, updatedAt: STAMP };
export const savedTask = {
  kind: 'task',
  id: TASK_ID,
  title: 'Call mom',
  due: { date: '2026-09-25', time: '15:00' },
  timeZone: 'America/New_York',
  priority: 'normal',
  completedAt: null,
  ...stamps,
};
export const savedEvent = {
  kind: 'event',
  id: EVENT_ID,
  title: 'Design review',
  start: { date: '2026-09-26', time: null },
  timeZone: 'America/New_York',
  durationMin: 60,
  location: 'Room 4',
  attendees: ['Ana', 'Sam'],
  ...stamps,
};
export const savedNote = {
  kind: 'note',
  id: NOTE_ID,
  title: 'Gift ideas',
  body: 'Book, scarf',
  timeZone: 'America/New_York',
  ...stamps,
};

export function timelineRow(kind, row, sortAt) {
  return { kind, id: row.id, sort_at: sortAt, item: row };
}
