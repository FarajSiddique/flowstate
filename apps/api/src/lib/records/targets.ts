import type { SupabaseClient } from '@supabase/supabase-js';

import type { ItemRef, SavedItem } from '@nexui/types';

import { MAX_TARGETS, type TargetLookup } from '../decision-engine/change-actions.ts';
import { ITEM_TABLES, toSavedItem, type ItemRow } from './mappers.ts';
import { containsPattern } from './queries.ts';

export function toItemRef(item: SavedItem): ItemRef {
  let when = null;

  if (item.kind === 'task') {
    when = item.due;
  } else if (item.kind === 'event') {
    when = item.start;
  }

  return { kind: item.kind, id: item.id, title: item.title, when };
}

function daysFrom(date: string, today: string): number {
  return Math.abs(Date.parse(date) - Date.parse(today));
}

/** Closest dated items first, then undated items, most recently updated first. */
export function rankTargets(items: SavedItem[], today: string): ItemRef[] {
  return [...items]
    .sort((a, b) => {
      const aDate = toItemRef(a).when?.date;
      const bDate = toItemRef(b).when?.date;

      if (aDate && bDate) {
        return daysFrom(aDate, today) - daysFrom(bDate, today);
      }

      if (aDate || bDate) {
        return aDate ? -1 : 1;
      }

      return b.updatedAt.localeCompare(a.updatedAt);
    })
    .slice(0, MAX_TARGETS)
    .map(toItemRef);
}

/**
 * Finds the user's open items whose titles contain every word of the phrase, as the
 * signed-in user (RLS scopes it). "call mom" matches "Call mom back".
 */
export function createTargetLookup(client: SupabaseClient, today: string): TargetLookup {
  return {
    async findTargets(phrase, kinds) {
      const words = phrase
        .split(/\s+/)
        .filter((word) => word.length >= 2)
        .slice(0, 4);

      if (words.length === 0) {
        return [];
      }

      const found = await Promise.all(
        kinds.map(async (kind) => {
          let request = client.from(ITEM_TABLES[kind]).select('*').is('completed_at', null);

          for (const word of words) {
            request = request.ilike('title', containsPattern(word));
          }

          const { data, error } = await request
            .order('updated_at', { ascending: false })
            .limit(MAX_TARGETS);

          if (error) {
            throw error;
          }

          return ((data ?? []) as ItemRow[]).map((row) => toSavedItem(kind, row));
        }),
      );

      return rankTargets(found.flat(), today);
    },
  };
}
