import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  IntentEventRequest,
  ItemKind,
  SavedItem,
  TimelineQuery,
  TimelineResponse,
} from '@nexui/types';

import { decodeCursor, encodeCursor } from './cursor.ts';
import { toSavedItem, type ItemRow } from './mappers.ts';

export class InvalidCursorError extends Error {}

/** A `timeline_items` row: the kind, sort key and full item row. */
export interface TimelineRow {
  kind: ItemKind;
  id: string;
  sort_at: string;
  item: ItemRow;
}

/**
 * Logs a confirmed or dismissed draft. A confirmed CREATE_* action is saved in the
 * same transaction (`record_intent`), and the saved item is returned.
 */
export async function recordIntent(
  client: SupabaseClient,
  event: IntentEventRequest,
): Promise<SavedItem | null> {
  const action =
    event.action && event.action.kind !== 'SEARCH'
      ? { ...event.action, title: event.action.title.trim() }
      : event.action;
  const { data, error } = await client.rpc('record_intent', {
    input_text: event.text,
    input_context: event.context ?? null,
    input_decision: event.decision,
    input_outcome: event.outcome,
    input_action: action ?? null,
    input_time_zone: event.context?.timeZone ?? 'UTC',
  });

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const row = data as ItemRow & { kind: ItemKind };

  return toSavedItem(row.kind, row);
}

/**
 * One page of the timeline, newest first. The query fetches one extra row to learn
 * whether a next page exists; its cursor is the last row returned.
 */
export async function getTimelinePage(
  client: SupabaseClient,
  query: TimelineQuery,
): Promise<TimelineResponse> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;

  if (query.cursor && !cursor) {
    throw new InvalidCursorError('Invalid cursor');
  }

  const { data, error } = await client.rpc('timeline_page', {
    page_size: query.limit + 1,
    cursor_sort_at: cursor?.sortAt ?? null,
    cursor_id: cursor?.id ?? null,
  });

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as TimelineRow[];
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  const hasMore = rows.length > query.limit && last !== undefined;

  return {
    items: page.map((row) => toSavedItem(row.kind, row.item)),
    nextCursor: hasMore ? encodeCursor({ sortAt: last.sort_at, id: last.id }) : null,
  };
}
