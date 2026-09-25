import { savedItemSchema } from '@nexui/types';
import type { ItemKind, ItemPatch, LocalDateTime, SavedItem } from '@nexui/types';

/** A table row as PostgREST returns it (snake_case columns). */
export type ItemRow = Record<string, unknown>;

export const ITEM_TABLES = {
  task: 'tasks',
  event: 'events',
  note: 'notes',
} as const satisfies Record<ItemKind, string>;

// Postgres returns `time` as HH:MM:SS; the contract uses HH:MM.
function localDateTime(date: unknown, time: unknown): LocalDateTime | null {
  if (typeof date !== 'string') {
    return null;
  }

  return { date, time: typeof time === 'string' ? time.slice(0, 5) : null };
}

/** Maps a row to the shared contract, throwing if the row doesn't fit it. */
export function toSavedItem(kind: ItemKind, row: ItemRow): SavedItem {
  const base = {
    kind,
    id: row.id,
    title: row.title,
    timeZone: row.time_zone,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  switch (kind) {
    case 'task':
      return savedItemSchema.parse({
        ...base,
        due: localDateTime(row.due_date, row.due_time),
        priority: row.priority,
      });
    case 'event':
      return savedItemSchema.parse({
        ...base,
        start: localDateTime(row.start_date, row.start_time),
        durationMin: row.duration_min,
        location: row.location,
        attendees: row.attendees,
      });
    case 'note':
      return savedItemSchema.parse({ ...base, body: row.body });
  }
}

/**
 * Turns a validated patch into column updates. `completed` becomes a server timestamp.
 *
 * @example
 * toPatchColumns({ due: null, completed: true }, now)
 * // { due_date: null, due_time: null, completed_at: '2026-09-24T18:30:00.000Z' }
 */
export function toPatchColumns(patch: ItemPatch, now: Date): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  const set = (column: string, value: unknown): void => {
    if (value !== undefined) {
      columns[column] = value;
    }
  };

  set('title', patch.title);

  if ('due' in patch && patch.due !== undefined) {
    columns.due_date = patch.due?.date ?? null;
    columns.due_time = patch.due?.time ?? null;
  }

  if ('start' in patch && patch.start !== undefined) {
    columns.start_date = patch.start?.date ?? null;
    columns.start_time = patch.start?.time ?? null;
  }

  if ('priority' in patch) {
    set('priority', patch.priority);
  }

  if ('durationMin' in patch) {
    set('duration_min', patch.durationMin);
  }

  if ('location' in patch) {
    set('location', patch.location);
  }

  if ('attendees' in patch) {
    set('attendees', patch.attendees);
  }

  if ('body' in patch) {
    set('body', patch.body);
  }

  if (patch.completed !== undefined) {
    columns.completed_at = patch.completed ? now.toISOString() : null;
  }

  return columns;
}
