import type { HighlightField, IntentHighlight } from '@nexui/types';

export interface TextSegment {
  text: string;
  field: HighlightField | null;
}

// Server offsets index the trimmed, whitespace-collapsed input. Map them back onto the
// text as typed, and drop any span that no longer matches (for example, a stale decision).
export function highlightSegments(
  raw: string,
  highlights: readonly IntentHighlight[] = [],
): TextSegment[] {
  const rawIndex: number[] = [];
  let normalized = '';
  let gap = -1;
  for (let index = 0; index < raw.length; index += 1) {
    if (/\s/.test(raw[index]!)) {
      if (normalized && gap < 0) {
        gap = index;
      }
      continue;
    }
    if (gap >= 0) {
      normalized += ' ';
      rawIndex.push(gap);
      gap = -1;
    }
    normalized += raw[index];
    rawIndex.push(index);
  }

  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const span of [...highlights].sort((a, b) => a.start - b.start)) {
    if (normalized.slice(span.start, span.end) !== span.text) {
      continue;
    }
    const start = rawIndex[span.start]!;
    const end = rawIndex[span.end - 1]! + 1;
    if (start < cursor) {
      continue;
    }
    if (start > cursor) {
      segments.push({ text: raw.slice(cursor, start), field: null });
    }
    segments.push({ text: raw.slice(start, end), field: span.field });
    cursor = end;
  }
  if (cursor < raw.length || segments.length === 0) {
    segments.push({ text: raw.slice(cursor), field: null });
  }
  return segments;
}
