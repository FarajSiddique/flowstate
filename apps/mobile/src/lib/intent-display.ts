import type { DateRange, LocalDateTime, SearchScope, TaskPriority } from '@nexui/types';

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

// Formats a wall-clock YYYY-MM-DD without shifting it through the device time zone.
export function displayLocalDate(date: string, withWeekday = true): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day!));
  const monthDay = `${MONTHS[value.getUTCMonth()]} ${value.getUTCDate()}`;

  return withWeekday ? `${WEEKDAYS[value.getUTCDay()]}, ${monthDay}` : monthDay;
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
