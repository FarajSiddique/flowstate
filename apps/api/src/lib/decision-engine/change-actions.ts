import * as chrono from 'chrono-node';

import {
  resolveRescheduleTo,
  TARGET_KINDS,
  type ChangeAction,
  type ChangeIntent,
  type ItemKind,
  type ItemRef,
  type PartialWhen,
} from '@nexui/types';

import type { Reference } from './action-candidates.ts';

// Change intents act on saved items. Code finds the phrase naming the item and the new
// value; the route's lookup shortlists matching items; the engine only picks among them.

/** Finds the user's open items whose titles match a phrase, best first. */
export interface TargetLookup {
  findTargets(phrase: string, kinds: readonly ItemKind[]): Promise<ItemRef[]>;
}

export const NO_TARGETS: TargetLookup = { findTargets: async () => [] };

export const MAX_TARGETS = 5;

export interface ChangeMatch {
  intent: ChangeIntent;
  phrase: string;
  toParsed: PartialWhen | null;
  text: string | null;
}

export type TargetChoice = { type: 'picked'; id: string } | { type: 'none' } | { type: 'unsure' };

const COMPLETE_PATTERNS = [
  /^(?:i(?:'m|’m| am)\s+)?(?:done|finished)\s+with\s+(.+)$/i,
  /^(?:mark|tick)\s+(.+?)(?:\s+as)?\s+(?:done|complete|completed|finished)$/i,
  /^(?:check|tick)\s+off\s+(.+)$/i,
  /^(?:finished|completed)\s+(.+)$/i,
  /^(.+?)\s+is\s+(?:done|finished|complete)$/i,
];
const RESCHEDULE_PATTERN =
  /^(?:push|move|reschedule|shift|bump)\s+(.+?)\s+(?:to|until|till)\s+(.+)$/i;
const APPEND_QUOTED = /^(?:add|append)\s+["'“‘](.+?)["'”’]\s+to\s+(.+)$/i;
const APPEND_PLAIN = /^(?:add|append)\s+(.+?)\s+to\s+(.+?\s+notes?)$/i;
const BARE_TIME = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

// "the quarterly report." → "quarterly report"; "trip notes" → "trip" for APPEND.
function cleanPhrase(raw: string, dropNoteWord = false): string {
  let phrase = raw
    .replace(/[\s,.;!?]+$/, '')
    .replace(/^(?:the|my|a|an|our)\s+/i, '')
    .replace(/\s+(?:back|up)$/i, '')
    .trim();

  if (dropNoteWord) {
    phrase = phrase.replace(/\s+notes?$/i, '').trim();
  }

  return phrase;
}

// Unqualified hours 1–7 mean PM, as elsewhere in the engine.
function hour24(hour: number, meridiem: string | undefined): number {
  if (meridiem) {
    return (hour % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
  }

  return hour >= 1 && hour <= 7 ? hour + 12 : hour;
}

/**
 * Reads the parts of a new date/time the user actually said.
 *
 * @example
 * parseWhenParts('10', reference) // { date: null, time: '10:00' }
 */
export function parseWhenParts(span: string, reference: Reference): PartialWhen | null {
  const text = span.trim().replace(/[\s,.;!?]+$/, '');
  const bare = BARE_TIME.exec(text);

  if (bare) {
    const hour = Number(bare[1]);
    const minute = Number(bare[2] ?? '0');

    if (hour < 1 || hour > 12 || minute > 59) {
      return null;
    }

    return { date: null, time: `${pad(hour24(hour, bare[3]))}:${pad(minute)}` };
  }

  const [result] = chrono.parse(
    text,
    { instant: reference.instant, timezone: reference.offsetMinutes },
    { forwardDate: true },
  );

  if (!result) {
    return null;
  }

  const { start } = result;
  const dateSaid = start.isCertain('day') || start.isCertain('weekday');
  const date = dateSaid
    ? `${start.get('year')}-${pad(start.get('month') ?? 1)}-${pad(start.get('day') ?? 1)}`
    : null;
  let time: string | null = null;

  if (start.isCertain('hour')) {
    const hour = start.get('hour') ?? 0;
    const adjusted = start.isCertain('meridiem') ? hour : hour24(hour, undefined);

    time = `${pad(adjusted)}:${pad(start.get('minute') ?? 0)}`;
  }

  return date || time ? { date, time } : null;
}

/** Recognizes "done with X", "move X to <when>" and "add 'Y' to X notes". */
export function findChangeMatch(text: string, reference: Reference): ChangeMatch | null {
  const input = text.trim().replace(/\s+/g, ' ');

  for (const pattern of COMPLETE_PATTERNS) {
    const match = pattern.exec(input);
    const phrase = match ? cleanPhrase(match[1]!) : '';

    if (phrase) {
      return { intent: 'COMPLETE', phrase, toParsed: null, text: null };
    }
  }

  const move = RESCHEDULE_PATTERN.exec(input);

  if (move) {
    const phrase = cleanPhrase(move[1]!);
    const toParsed = parseWhenParts(move[2]!, reference);

    return phrase && toParsed ? { intent: 'RESCHEDULE', phrase, toParsed, text: null } : null;
  }

  const append = APPEND_QUOTED.exec(input) ?? APPEND_PLAIN.exec(input);

  if (append) {
    const phrase = cleanPhrase(append[2]!, true);
    const addition = append[1]!.trim();

    return phrase && addition ? { intent: 'APPEND', phrase, toParsed: null, text: addition } : null;
  }

  return null;
}

/** Up to five candidate items for the match. A failed lookup yields none. */
export async function shortlistTargets(
  lookup: TargetLookup,
  match: ChangeMatch,
): Promise<ItemRef[]> {
  try {
    const targets = await lookup.findTargets(match.phrase, TARGET_KINDS[match.intent]);

    return targets.slice(0, MAX_TARGETS);
  } catch {
    console.error('[intent]', 'Looking up saved items failed.');

    return [];
  }
}

/** Turns the match and the engine's pick into the draft action. */
export function buildChangeAction(
  match: ChangeMatch,
  shortlist: ItemRef[],
  choice: TargetChoice,
  reference: Reference,
): ChangeAction {
  const target =
    choice.type === 'picked' ? (shortlist.find((ref) => ref.id === choice.id) ?? null) : null;
  const alternatives = choice.type === 'unsure' ? shortlist.slice(0, MAX_TARGETS) : [];
  const base = { phrase: match.phrase, target, alternatives };

  switch (match.intent) {
    case 'COMPLETE':
      return { kind: 'COMPLETE', ...base };
    case 'RESCHEDULE': {
      const { toParsed } = match;
      const to =
        target && toParsed ? resolveRescheduleTo(toParsed, target.when, reference.today) : null;

      return { kind: 'RESCHEDULE', ...base, to, toParsed };
    }

    case 'APPEND':
      return { kind: 'APPEND', ...base, text: match.text ?? '' };
  }
}
