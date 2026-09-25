import type { SupabaseClient } from '@supabase/supabase-js';

import type { IntentEventRequest, ItemKind, SavedItem } from '@nexui/types';

import { toSavedItem, type ItemRow } from './mappers.ts';

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
