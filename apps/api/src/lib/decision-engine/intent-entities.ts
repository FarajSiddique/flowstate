import type { Intent, IntentEntities } from '@nexui/types';

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Jev selects an intent, not arbitrary strings. Keep source-text extraction local
// and conservative; unsupported date expressions stay in the editable title.
export function extractIntentEntities(intent: Intent, text: string): IntentEntities {
  if (intent === 'UNKNOWN') return {};
  let title = text.trim().replace(/\s+/g, ' ');
  if (intent === 'SEARCH') {
    const query = title.replace(/^(?:find|search for|where is)\s+(?:my\s+)?/i, '');
    return query ? { query } : {};
  }
  if (intent === 'CREATE_NOTE') {
    title = title.replace(
      /^(?:write down(?:\s+idea about)?|note that|save this thought about)\s+/i,
      '',
    );
    return title ? { title: capitalize(title) } : {};
  }

  const entities: IntentEntities = {};
  const time = title.match(/\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (time) {
    const hour = Number(time[1]);
    const minute = Number(time[2] ?? '0');
    const period = time[3]?.toLowerCase();
    if (hour >= 1 && hour <= 12 && minute <= 59) {
      // Preserve the starter's convention: unqualified hours 1–7 mean PM.
      const hour24 = (hour % 12) + (period === 'pm' || (!period && hour < 8) ? 12 : 0);
      entities.time = `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      title = title.slice(0, time.index).trim();
    }
  }
  const date = title.match(
    /\s+(?:on\s+)?(today|tomorrow|tonight|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))$/i,
  );
  if (date) {
    entities.date = date[1]!.toLowerCase();
    title = title.slice(0, date.index).trim();
  }
  title = title.replace(/^(?:remind me to|schedule)\s+/i, '');
  if (intent === 'CREATE_EVENT') {
    const person = title.match(/^(?:meet(?: with)?\s+)(.+)$/i) ?? title.match(/\s+with\s+(.+)$/i);
    if (person?.[1]) entities.person = capitalize(person[1]);
  }
  // A bare action word has no useful title yet.
  if (title && !/^(?:meet|schedule|remind me to)$/i.test(title)) entities.title = capitalize(title);
  return entities;
}
