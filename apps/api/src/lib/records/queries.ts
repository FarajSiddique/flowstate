import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  IntentEventRequest,
  ItemKind,
  ItemPatch,
  SavedItem,
  SearchQuery,
  SearchScope,
  TimelineQuery,
  TimelineResponse,
} from '@nexui/types';

import { decodeCursor, encodeCursor } from './cursor.ts';
import { ITEM_TABLES, toPatchColumns, toSavedItem, type ItemRow } from './mappers.ts';

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

const SCOPE_KINDS = {
  all: ['task', 'event', 'note'],
  tasks: ['task'],
  events: ['event'],
  notes: ['note'],
} as const satisfies Record<SearchScope, readonly ItemKind[]>;

const SEARCH_LIMIT = 50;

// Escapes LIKE wildcards so "50%" matches the literal text.
function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/**
 * Case-insensitive substring search over titles (plus note bodies and event
 * location/people), newest first. A date range keeps only dated tasks and events.
 */
export async function searchItems(
  client: SupabaseClient,
  query: SearchQuery,
): Promise<SavedItem[]> {
  let request = client
    .from('timeline_items')
    .select('kind, id, sort_at, item')
    .ilike('search_text', containsPattern(query.q))
    .in('kind', [...SCOPE_KINDS[query.scope]]);

  if (query.from) {
    request = request.gte('item_date', query.from);
  }

  if (query.to) {
    request = request.lte('item_date', query.to);
  }

  const { data, error } = await request
    .order('sort_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(SEARCH_LIMIT);

  if (error) {
    throw error;
  }

  return ((data ?? []) as TimelineRow[]).map((row) => toSavedItem(row.kind, row.item));
}

export class RecordNotFoundError extends Error {}

/**
 * Applies an edit and/or completion. A missing id and another user's row look the
 * same: RLS makes the update touch zero rows, which is reported as not found.
 */
export async function updateItem(
  client: SupabaseClient,
  kind: ItemKind,
  id: string,
  patch: ItemPatch,
  now: Date = new Date(),
): Promise<SavedItem> {
  const { data, error } = await client
    .from(ITEM_TABLES[kind])
    .update(toPatchColumns(patch, now))
    .eq('id', id)
    .select();

  if (error) {
    throw error;
  }

  const row = (data as ItemRow[] | null)?.[0];

  if (!row) {
    throw new RecordNotFoundError('Item not found');
  }

  return toSavedItem(kind, row);
}
