import type { IntentDecision, IntentRequest } from '@flowstate/types';

import type { DecisionEngine } from './index';

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function parseTime(hourText: string, minuteText?: string, period?: string): string | undefined {
  const hour = Number(hourText);
  const minute = Number(minuteText ?? '0');
  if (hour < 1 || hour > 12 || minute > 59) return undefined;
  const isPm = period?.toLowerCase() === 'pm' || (!period && hour < 8);
  const hour24 = (hour % 12) + (isPm ? 12 : 0);
  return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export class MockDecisionEngine implements DecisionEngine {
  async classifyIntent({ text }: IntentRequest): Promise<IntentDecision> {
    const input = text.trim().replace(/\s+/g, ' ');

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
