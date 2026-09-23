import type { Intent, IntentAction, SearchScope, TaskPriority } from '@flowstate/types';

import { NOTE_PREFIX, type ActionCandidates, type Candidate } from './action-candidates.ts';

// Selected candidate ids per field; missing means "not stated" and falls back to a default.
export interface FieldSelections {
  when?: string;
  duration?: string;
  location?: string;
  attendees?: string;
  range?: string;
  noteSplit?: string;
  priority?: TaskPriority;
  scope?: SearchScope;
}

export const DEFAULT_EVENT_MINUTES = 30;

const TASK_PREFIX =
  /^(?:remind me to|remember to|i need to|i have to|need to|todo:?|to-do:?|task:?)\s+/i;
const EVENT_PREFIX = /^(?:schedule|set up|book|add)\s+(?:an?\s+)?/i;
const SEARCH_PREFIX =
  /^(?:find|search(?:\s+for)?|look\s+(?:up|for)|where\s+(?:is|are)|show\s+me)\s+(?:my\s+)?/i;
const PRIORITY_CUE =
  /,?\s*\b(?:urgent(?:ly)?|asap|critical|important|(?:high|low)[- ]priority|no rush|whenever)\b/gi;

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function pick<T>(candidates: Candidate<T>[], id?: string): Candidate<T> | undefined {
  return id ? candidates.find((candidate) => candidate.id === id) : undefined;
}

// Remove chosen spans (latest first so indexes stay valid) and tidy what remains.
function withoutSpans(text: string, spans: (Candidate<unknown> | undefined)[]): string {
  let result = text;
  for (const span of spans
    .filter((item): item is Candidate<unknown> => Boolean(item))
    .sort((a, b) => b.start - a.start)) {
    result = `${result.slice(0, span.start)} ${result.slice(span.end)}`;
  }
  return result
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/(?:[\s,;]+|\s+(?:on|by|at|in|for|from|due|and))+$/i, '')
    .replace(/^[\s,;]+/, '')
    .trim();
}

export function buildIntentAction(
  intent: Intent,
  text: string,
  candidates: ActionCandidates,
  selections: FieldSelections,
): IntentAction | undefined {
  const input = text.trim().replace(/\s+/g, ' ');
  const when = pick(candidates.when, selections.when);

  switch (intent) {
    case 'CREATE_TASK': {
      const priority = selections.priority ?? 'normal';
      let title = withoutSpans(input, [when]);
      if (priority !== 'normal') title = title.replace(PRIORITY_CUE, '').trim();
      return {
        kind: intent,
        title: capitalize(title.replace(TASK_PREFIX, '')),
        due: when?.value ?? null,
        priority,
      };
    }
    case 'CREATE_EVENT': {
      const duration = pick(candidates.duration, selections.duration);
      const location = pick(candidates.location, selections.location);
      const title = withoutSpans(input, [when, duration, location]).replace(EVENT_PREFIX, '');
      return {
        kind: intent,
        title: capitalize(title),
        start: when?.value ?? null,
        durationMin: duration?.value ?? DEFAULT_EVENT_MINUTES,
        attendees: pick(candidates.attendees, selections.attendees)?.value ?? [],
        location: location?.value ?? null,
      };
    }
    case 'CREATE_NOTE': {
      const split = pick(candidates.noteSplit, selections.noteSplit);
      return {
        kind: intent,
        title: capitalize(split?.value.title ?? input.replace(NOTE_PREFIX, '')),
        body: split?.value.body ?? null,
      };
    }
    case 'SEARCH': {
      const range = pick(candidates.range, selections.range);
      return {
        kind: intent,
        query: withoutSpans(input, [range]).replace(SEARCH_PREFIX, ''),
        scope: selections.scope ?? 'all',
        range: range?.value ?? null,
      };
    }
    case 'UNKNOWN':
      return undefined;
  }
}
