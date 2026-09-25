import type { DateRange } from '@nexui/types';

/** The result of reading one free-text form field. */
export type FieldResult<T> = { ok: true; value: T } | { ok: false };

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_MS = 86_400_000;

function isoDate(year: number, month: number, day: number): string | null {
  const value = new Date(Date.UTC(year, month - 1, day));

  if (value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) {
    return null;
  }

  return value.toISOString().slice(0, 10);
}

const dayNumber = (date: string): number => Date.parse(`${date}T00:00:00Z`) / DAY_MS;

/** The device's calendar date as YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Reads a date the sheet showed or the user typed. Blank means "no date". A month
 * and day without a year resolves to the year nearest `today`.
 *
 * @example
 * parseDateInput('Thu, Sep 24', '2026-09-20') // { ok: true, value: '2026-09-24' }
 */
export function parseDateInput(text: string, today: string): FieldResult<string | null> {
  const input = text.trim().toLowerCase();

  if (!input) {
    return { ok: true, value: null };
  }

  if (input === 'today') {
    return { ok: true, value: today };
  }

  if (input === 'tomorrow') {
    return {
      ok: true,
      value: new Date((dayNumber(today) + 1) * DAY_MS).toISOString().slice(0, 10),
    };
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);

  if (iso) {
    const value = isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

    return value ? { ok: true, value } : { ok: false };
  }

  const monthDay = /^(?:[a-z]{3,9},?\s+)?([a-z]{3})[a-z]*\.?\s+(\d{1,2})$/.exec(input);
  const month = monthDay ? MONTHS.indexOf(monthDay[1]!) + 1 : 0;

  if (!monthDay || month === 0) {
    return { ok: false };
  }

  const year = Number(today.slice(0, 4));
  const candidates = [year - 1, year, year + 1]
    .map((candidate) => isoDate(candidate, month, Number(monthDay[2])))
    .filter((candidate): candidate is string => candidate !== null);

  if (!candidates.length) {
    return { ok: false };
  }

  const distance = (date: string): number => Math.abs(dayNumber(date) - dayNumber(today));
  const nearest = candidates.reduce((best, date) =>
    distance(date) < distance(best) ? date : best,
  );

  return { ok: true, value: nearest };
}

/**
 * Reads a time as HH:MM. A bare hour ("3") is ambiguous and rejected.
 *
 * @example
 * parseTimeInput('3:30 PM') // { ok: true, value: '15:30' }
 */
export function parseTimeInput(text: string): FieldResult<string | null> {
  const input = text.trim().toLowerCase().replace(/\s+/g, '');

  if (!input) {
    return { ok: true, value: null };
  }

  if (input === 'noon') {
    return { ok: true, value: '12:00' };
  }

  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(input);

  if (!match) {
    return { ok: false };
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  const meridiem = match[3];

  if (minute > 59) {
    return { ok: false };
  }

  if (meridiem) {
    if (hour < 1 || hour > 12) {
      return { ok: false };
    }

    hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
  } else if (hour > 23 || match[2] === undefined) {
    return { ok: false };
  }

  return {
    ok: true,
    value: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

/**
 * Reads a duration in minutes (1–1440). A bare number means minutes.
 *
 * @example
 * parseDurationInput('1 hr 30 min') // { ok: true, value: 90 }
 */
export function parseDurationInput(text: string): FieldResult<number> {
  const input = text.trim().toLowerCase();
  const match =
    /^(?:(\d+)\s*(?:h|hr|hrs|hour|hours))?\s*(?:(\d+)\s*(?:m|min|mins|minute|minutes)?)?$/.exec(
      input,
    );

  if (!input || !match) {
    return { ok: false };
  }

  const minutes = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);

  return minutes >= 1 && minutes <= 1440 ? { ok: true, value: minutes } : { ok: false };
}

/** Splits a comma-separated list, dropping blanks. */
export function parseListInput(text: string): string[] {
  return text
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Reads "Sep 24 – Sep 30", "Sep 24 to Sep 30" or a single date as a range.
 *
 * @example
 * parseRangeInput('Sep 24', '2026-09-20') // { ok: true, value: { from: '2026-09-24', to: '2026-09-24' } }
 */
export function parseRangeInput(text: string, today: string): FieldResult<DateRange | null> {
  if (!text.trim()) {
    return { ok: true, value: null };
  }

  const parts = text.split(/\s+(?:–|—|-|to)\s+/i);

  if (parts.length > 2) {
    return { ok: false };
  }

  const from = parseDateInput(parts[0]!, today);
  const to = parseDateInput(parts[1] ?? parts[0]!, today);

  if (!from.ok || !to.ok || !from.value || !to.value || from.value > to.value) {
    return { ok: false };
  }

  return { ok: true, value: { from: from.value, to: to.value } };
}
