import type { DateRange, LocalDateTime, SavedItem, SearchScope, TaskPriority } from '@nexui/types';

export function displayDate(date?: string): string | null {
  return date ? date.charAt(0).toUpperCase() + date.slice(1) : null;
}

export function displayTime(time?: string): string | null {
  if (!time) {
    return null;
  }

  const [hourText, minute = '00'] = time.split(':');
  const hour = Number(hourText);

  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return time;
  }

  return `${hour % 12 || 12}:${minute} ${hour < 12 ? 'AM' : 'PM'}`;
}

export function displayTitle(title: string): string {
  return title.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const currentYear = (): number => new Date().getFullYear();

/**
 * Formats a wall-clock YYYY-MM-DD without shifting it through the device time zone.
 * The year is shown only when it differs from `thisYear`, so the text reads back unchanged.
 *
 * @example
 * displayLocalDate('2027-06-01', true, 2026) // 'Tue, Jun 1, 2027'
 */
export function displayLocalDate(
  date: string,
  withWeekday = true,
  thisYear: number = currentYear(),
): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day!));
  let text = `${MONTHS[value.getUTCMonth()]} ${value.getUTCDate()}`;

  if (withWeekday) {
    text = `${WEEKDAYS[value.getUTCDay()]}, ${text}`;
  }

  return value.getUTCFullYear() === thisYear ? text : `${text}, ${value.getUTCFullYear()}`;
}

export function displayLocalDateTime(value: LocalDateTime | null): string | null {
  if (!value) {
    return null;
  }

  return [displayLocalDate(value.date), displayTime(value.time ?? undefined)]
    .filter(Boolean)
    .join(' · ');
}

export function displayDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (!hours) {
    return `${rest} min`;
  }

  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

export function displayRange(range: DateRange | null): string | null {
  if (!range) {
    return null;
  }

  if (range.from === range.to) {
    return displayLocalDate(range.from);
  }

  return `${displayLocalDate(range.from, false)} – ${displayLocalDate(range.to, false)}`;
}

export const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
] as const satisfies readonly { value: TaskPriority; label: string }[];

export const SCOPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'events', label: 'Events' },
  { value: 'notes', label: 'Notes' },
] as const satisfies readonly { value: SearchScope; label: string }[];

const KIND_LABELS = { task: 'Task', event: 'Event', note: 'Note' } as const;

/** One line under a timeline row: kind, then when (or "Unscheduled"). */
export function displayItemMeta(item: SavedItem, thisYear: number = currentYear()): string {
  if (item.kind === 'note') {
    return KIND_LABELS.note;
  }

  const when = item.kind === 'task' ? item.due : item.start;

  if (!when) {
    return `${KIND_LABELS[item.kind]} · Unscheduled`;
  }

  const parts = [KIND_LABELS[item.kind], displayLocalDate(when.date, true, thisYear)];

  if (when.time) {
    parts.push(displayTime(when.time) ?? when.time);
  }

  if (item.kind === 'event') {
    parts.push(displayDuration(item.durationMin));
  }

  return parts.join(' · ');
}
