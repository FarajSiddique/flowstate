import type { DateRange, IntentContext, LocalDateTime } from '@nexui/types';
import * as chrono from 'chrono-node';

// Code over-finds source spans; Jev only selects among them (or none). Values are
// normalized here, so the model never writes dates, names, or places itself.
export interface Candidate<T> {
  id: string;
  start: number;
  end: number;
  text: string;
  value: T;
}

export interface ActionCandidates {
  when: Candidate<LocalDateTime>[];
  duration: Candidate<number>[];
  location: Candidate<string>[];
  attendees: Candidate<string[]>[];
  range: Candidate<DateRange>[];
  noteSplit: Candidate<{ title: string; body: string }>[];
}

export interface Reference {
  instant: Date;
  offsetMinutes: number;
  today: string;
}

const MAX_CANDIDATES = 6;

export const NOTE_PREFIX =
  /^(?:write down(?:\s+(?:an?\s+)?idea about)?|note(?: that)?|save this thought about|jot down)\s+/i;

// Phrases end at punctuation, another action detail, or a date word.
const PHRASE_STOP =
  /\s+(?:with|for|on|by|from|to|at|in|about|and then|tomorrow|today|tonight|next|this)\b|[,.;!?]/i;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days));
  return isoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

function weekday(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
}

// chrono accepts numeric offsets but silently ignores IANA zone names.
export function resolveReference(context?: IntentContext): Reference {
  const instant = context ? new Date(context.now) : new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: context?.timeZone ?? 'UTC',
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value);
  const wallClock = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return {
    instant,
    offsetMinutes: Math.round((wallClock - instant.getTime()) / 60_000),
    today: isoDate(part('year'), part('month'), part('day')),
  };
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

// Include a leading preposition so removing the span leaves a clean title.
function extendBackward(text: string, start: number, pattern: RegExp): number {
  const match = text.slice(0, start).match(pattern);
  return match ? start - match[0].length : start;
}

function trimSpan(text: string, start: number, end: number) {
  const raw = text.slice(start, end);
  const trimmed = raw.replace(/[\s,.;!?]+$/, '');
  return { start, end: start + trimmed.length, text: trimmed };
}

function withIds<T>(field: string, candidates: Omit<Candidate<T>, 'id'>[]): Candidate<T>[] {
  return candidates
    .sort((a, b) => a.start - b.start)
    .slice(0, MAX_CANDIDATES)
    .map((candidate, index) => ({ ...candidate, id: `${field}_${index + 1}` }));
}

function findDurations(text: string): Omit<Candidate<number>, 'id'>[] {
  const pattern =
    /\b(?:for\s+)?(an?|half an|\d+(?:\.\d+)?)[\s-]*(hours?|hrs?|h|minutes?|mins?)\b(?:\s+long)?/gi;
  const found: Omit<Candidate<number>, 'id'>[] = [];
  for (const match of text.matchAll(pattern)) {
    // "in 2 hours" is a start time, not a length.
    if (/\bin\s+$/i.test(text.slice(0, match.index))) {
      continue;
    }
    const amount = /^half/i.test(match[1]!) ? 0.5 : /^an?$/i.test(match[1]!) ? 1 : Number(match[1]);
    const minutes = Math.round(/^h/i.test(match[2]!) ? amount * 60 : amount);
    if (minutes < 1 || minutes > 1440) {
      continue;
    }
    found.push({ ...trimSpan(text, match.index, match.index + match[0].length), value: minutes });
  }
  return found;
}

function findWhen(
  text: string,
  reference: Reference,
  durations: { start: number; end: number }[],
): Omit<Candidate<LocalDateTime>, 'id'>[] {
  const results = chrono.parse(
    text,
    { instant: reference.instant, timezone: reference.offsetMinutes },
    { forwardDate: true },
  );
  const found: Omit<Candidate<LocalDateTime>, 'id'>[] = [];
  for (const result of results) {
    const span = trimSpan(
      text,
      extendBackward(text, result.index, /\b(?:on|by|due|before|until)\s+$/i),
      result.index + result.text.length,
    );
    // chrono reads "for 45 min" as "45 minutes from now".
    if (durations.some((duration) => overlaps(span, duration))) {
      continue;
    }
    const { start } = result;
    let time: string | null = null;
    if (start.isCertain('hour')) {
      let hour = start.get('hour') ?? 0;
      // Preserve the existing convention: unqualified hours 1–7 mean PM.
      if (!start.isCertain('meridiem') && hour >= 1 && hour <= 7) {
        hour += 12;
      }
      time = `${pad(hour)}:${pad(start.get('minute') ?? 0)}`;
    }
    const date = isoDate(start.get('year')!, start.get('month')!, start.get('day')!);
    found.push({ ...span, value: { date, time } });
  }
  return found;
}

function phraseAfter(text: string, from: number, blocked: { start: number; end: number }[]) {
  const rest = text.slice(from);
  const stop = rest.search(PHRASE_STOP);
  let end = from + (stop === -1 ? rest.length : stop);
  for (const span of blocked) {
    if (span.start >= from && span.start < end) {
      end = span.start;
    }
  }
  const phrase = text.slice(from, end).trim();
  return phrase ? { phrase, end: from + text.slice(from, end).trimEnd().length } : null;
}

function capitalizeWords(text: string): string {
  return text.replace(/\b\p{Ll}/gu, (letter) => letter.toUpperCase());
}

function findLocations(
  text: string,
  blocked: { start: number; end: number }[],
): Omit<Candidate<string>, 'id'>[] {
  const pattern =
    /\b(?:at|in)\s+(?!\d|noon\b|midnight\b|the (?:morning|afternoon|evening)\b|tonight\b)/gi;
  const found: Omit<Candidate<string>, 'id'>[] = [];
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    if (blocked.some((span) => start >= span.start && start < span.end)) {
      continue;
    }
    const phrase = phraseAfter(text, start + match[0].length, blocked);
    if (!phrase || phrase.phrase.split(/\s+/).length > 6) {
      continue;
    }
    found.push({
      start,
      end: phrase.end,
      text: text.slice(start, phrase.end),
      value: phrase.phrase,
    });
  }
  return found;
}

function findAttendees(
  text: string,
  blocked: { start: number; end: number }[],
): Omit<Candidate<string[]>, 'id'>[] {
  const pattern = /\b(?:meet(?:ing)?(?:\s+up)?(?:\s+with)?|with|call|see)\s+/gi;
  const found: Omit<Candidate<string[]>, 'id'>[] = [];
  for (const match of text.matchAll(pattern)) {
    const phrase = phraseAfter(text, match.index + match[0].length, blocked);
    if (!phrase) {
      continue;
    }
    const names = phrase.phrase
      .split(/\s*(?:,|&|\band\b)\s*/i)
      .filter((name) => name && name.split(/\s+/).length <= 3)
      .map(capitalizeWords);
    if (!names.length) {
      continue;
    }
    const start = match.index + match[0].length;
    found.push({ start, end: phrase.end, text: text.slice(start, phrase.end), value: names });
  }
  return found;
}

function findRanges(
  text: string,
  reference: Reference,
  when: Candidate<LocalDateTime>[] | Omit<Candidate<LocalDateTime>, 'id'>[],
): Omit<Candidate<DateRange>, 'id'>[] {
  const { today } = reference;
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  const [year, month] = today.split('-').map(Number);
  const monthStart = isoDate(year!, month!, 1);
  const previousMonthStart =
    month === 1 ? isoDate(year! - 1, 12, 1) : isoDate(year!, month! - 1, 1);
  const relative: [RegExp, (match: RegExpMatchArray) => DateRange][] = [
    [/\byesterday\b/gi, () => ({ from: addDays(today, -1), to: addDays(today, -1) })],
    [/\bthis week\b/gi, () => ({ from: monday, to: addDays(monday, 6) })],
    [/\blast week\b/gi, () => ({ from: addDays(monday, -7), to: addDays(monday, -1) })],
    [/\bthis month\b/gi, () => ({ from: monthStart, to: addDays(nextMonth(monthStart), -1) })],
    [/\blast month\b/gi, () => ({ from: previousMonthStart, to: addDays(monthStart, -1) })],
    [
      /\b(?:past|last)\s+(\d{1,3})\s+days\b/gi,
      (match) => ({ from: addDays(today, -Number(match[1])), to: today }),
    ],
  ];
  const found: Omit<Candidate<DateRange>, 'id'>[] = [];
  for (const [pattern, toRange] of relative) {
    for (const match of text.matchAll(pattern)) {
      const start = extendBackward(text, match.index, /\b(?:from|in|during|since|over)\s+$/i);
      found.push({
        ...trimSpan(text, start, match.index + match[0].length),
        value: toRange(match),
      });
    }
  }
  // Single dates ("on Friday") become one-day ranges unless a relative range covers them.
  for (const candidate of when) {
    if (found.some((range) => overlaps(range, candidate))) {
      continue;
    }
    const { date } = candidate.value;
    found.push({ ...candidate, value: { from: date, to: date } });
  }
  return found;
}

function nextMonth(monthStart: string): string {
  const [year, month] = monthStart.split('-').map(Number);
  return month === 12 ? isoDate(year! + 1, 1, 1) : isoDate(year!, month! + 1, 1);
}

function findNoteSplits(text: string): Omit<Candidate<{ title: string; body: string }>, 'id'>[] {
  const base = text.replace(NOTE_PREFIX, '');
  const offset = text.length - base.length;
  const found: Omit<Candidate<{ title: string; body: string }>, 'id'>[] = [];
  for (const separator of [/:\s+/, /\s+[-–—]\s+/, /[.!?]\s+/, /\n+/]) {
    const match = base.match(separator);
    if (match?.index === undefined) {
      continue;
    }
    const title = base
      .slice(0, match.index)
      .replace(/[.!?]$/, '')
      .trim();
    const body = base.slice(match.index + match[0].length).trim();
    if (!title || !body || found.some((split) => split.value.title === title)) {
      continue;
    }
    const start = offset + match.index;
    found.push({ start, end: start + match[0].length, text: match[0], value: { title, body } });
  }
  return found;
}

export function findActionCandidates(text: string, reference: Reference): ActionCandidates {
  const durations = withIds('duration', findDurations(text));
  const when = withIds('when', findWhen(text, reference, durations));
  const timed = [...when, ...durations];
  const location = withIds('location', findLocations(text, timed));
  return {
    when,
    duration: durations,
    location,
    attendees: withIds('attendees', findAttendees(text, [...timed, ...location])),
    range: withIds('range', findRanges(text, reference, when)),
    noteSplit: withIds('split', findNoteSplits(text)),
  };
}
