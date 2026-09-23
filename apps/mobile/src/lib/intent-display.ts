export function displayDate(date?: string): string | null {
  return date ? date.charAt(0).toUpperCase() + date.slice(1) : null;
}

export function displayTime(time?: string): string | null {
  if (!time) return null;
  const [hourText, minute = '00'] = time.split(':');
  const hour = Number(hourText);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return time;
  return `${hour % 12 || 12}:${minute} ${hour < 12 ? 'AM' : 'PM'}`;
}

export function displayTitle(title: string): string {
  return title.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
