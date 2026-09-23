import assert from 'node:assert/strict';
import test from 'node:test';

import { highlightSegments } from '../apps/mobile/src/lib/highlight-segments.ts';

const pairs = (segments) => segments.map(({ text, field }) => [text, field]);

test('maps normalized offsets back onto the text as typed', () => {
  // The server saw "lunch with Alex Friday at noon" (trimmed, single spaces).
  const typed = '  lunch with   Alex\nFriday at noon ';
  assert.deepEqual(
    pairs(
      highlightSegments(typed, [
        { field: 'attendees', start: 11, end: 15, text: 'Alex' },
        { field: 'when', start: 16, end: 30, text: 'Friday at noon' },
      ]),
    ),
    [
      ['  lunch with   ', null],
      ['Alex', 'attendees'],
      ['\n', null],
      ['Friday at noon', 'when'],
      [' ', null],
    ],
  );
});

test('drops stale or overlapping spans and keeps plain text intact', () => {
  assert.deepEqual(
    pairs(
      highlightSegments('pay rent tomorrow', [
        { field: 'when', start: 9, end: 17, text: 'tomorrow' },
        { field: 'when', start: 9, end: 12, text: 'tom' },
        { field: 'location', start: 0, end: 3, text: 'eat' },
      ]),
    ),
    [
      ['pay rent ', null],
      ['tomorrow', 'when'],
    ],
  );
  assert.deepEqual(pairs(highlightSegments('')), [['', null]]);
});
