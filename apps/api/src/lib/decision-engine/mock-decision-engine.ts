import type { IntentDecision, IntentRequest } from '@nexui/types';

import { buildHighlights, buildIntentAction, type FieldSelections } from './action-builder.ts';
import {
  findActionCandidates,
  resolveReference,
  type ActionCandidates,
} from './action-candidates.ts';
import type { DecisionEngine } from './index';

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function parseTime(hourText: string, minuteText?: string, period?: string): string | undefined {
  const hour = Number(hourText);
  const minute = Number(minuteText ?? '0');
  if (hour < 1 || hour > 12 || minute > 59) {
    return undefined;
  }
  const isPm = period?.toLowerCase() === 'pm' || (!period && hour < 8);
  const hour24 = (hour % 12) + (isPm ? 12 : 0);
  return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// Offline stand-in for Jev's field choices: first candidate wins, keywords set enums.
function heuristicSelections(input: string, candidates: ActionCandidates): FieldSelections {
  return {
    when: candidates.when[0]?.id,
    duration: candidates.duration[0]?.id,
    location: candidates.location[0]?.id,
    attendees: candidates.attendees[0]?.id,
    range: candidates.range[0]?.id,
    noteSplit: candidates.noteSplit[0]?.id,
    priority: /\b(?:urgent|asap|critical|important|high priority)\b/i.test(input)
      ? 'high'
      : /\b(?:no rush|whenever|someday|low priority)\b/i.test(input)
        ? 'low'
        : 'normal',
    scope: /\bnotes?\b/i.test(input)
      ? 'notes'
      : /\b(?:tasks?|to-?dos?|reminders?)\b/i.test(input)
        ? 'tasks'
        : /\b(?:events?|meetings?|calendar)\b/i.test(input)
          ? 'events'
          : 'all',
  };
}

export class MockDecisionEngine implements DecisionEngine {
  async classifyIntent({ text, context }: IntentRequest): Promise<IntentDecision> {
    const input = text.trim().replace(/\s+/g, ' ');
    const decision = this.classify(input);
    const candidates = findActionCandidates(input, resolveReference(context));
    const selections = heuristicSelections(input, candidates);
    const action = buildIntentAction(decision.intent, input, candidates, selections);
    if (!action) {
      return decision;
    }
    const highlights = buildHighlights(decision.intent, input, candidates, selections);
    return { ...decision, action, ...(highlights.length > 0 && { highlights }) };
  }

  private classify(input: string): IntentDecision {
    const event = input.match(
      /^meet\s+(.+?)(?:\s+(today|tomorrow))?(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/i,
    );
    if (event?.[1]) {
      const person = capitalize(event[1]);
      const date = event[2]?.toLowerCase();
      const time = event[3] ? parseTime(event[3], event[4], event[5]) : undefined;
      return {
        intent: 'CREATE_EVENT',
        confidence: date && time ? 0.96 : 0.72,
        entities: { title: `Meet ${person}`, person, ...(date && { date }), ...(time && { time }) },
      };
    }

    const task = input.match(/^remind me to\s+(.+?)(?:\s+(today|tomorrow))?$/i);
    if (task?.[1]) {
      const date = task[2]?.toLowerCase();
      return {
        intent: 'CREATE_TASK',
        confidence: date ? 0.95 : 0.72,
        entities: { title: capitalize(task[1]), ...(date && { date }) },
      };
    }

    const note = input.match(/^write down idea about\s+(.+)$/i);
    if (note?.[1]) {
      return { intent: 'CREATE_NOTE', confidence: 0.95, entities: { title: note[1] } };
    }

    const search = input.match(/^(?:find|search for)\s+(?:my\s+)?(.+)$/i);
    if (search?.[1]) {
      return { intent: 'SEARCH', confidence: 0.94, entities: { query: search[1] } };
    }

    return { intent: 'UNKNOWN', confidence: 0.3, entities: {} };
  }
}
