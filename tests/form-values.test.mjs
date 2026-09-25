import assert from 'node:assert/strict';
import test from 'node:test';

import {
  localToday,
  parseDateInput,
  parseDurationInput,
  parseListInput,
  parseRangeInput,
  parseTimeInput,
} from '../apps/mobile/src/lib/form-values.ts';

const ok = (value) => ({ ok: true, value });
const today = '2026-09-24';

test('dates read what the sheet shows and what people type', () => {
  assert.deepEqual(parseDateInput('Thu, Sep 24', today), ok('2026-09-24'));
  assert.deepEqual(parseDateInput('sep 25', today), ok('2026-09-25'));
  assert.deepEqual(parseDateInput('September 5', today), ok('2026-09-05'));
  assert.deepEqual(parseDateInput('Tomorrow', today), ok('2026-09-25'));
  assert.deepEqual(parseDateInput('2026-10-01', today), ok('2026-10-01'));
  assert.deepEqual(parseDateInput('  ', today), ok(null));
});

test('a month and day without a year picks the nearest year', () => {
  assert.deepEqual(parseDateInput('Jan 3', '2026-12-20'), ok('2027-01-03'));
  assert.deepEqual(parseDateInput('Dec 30', '2027-01-02'), ok('2026-12-30'));
});

test('unreadable or impossible dates fail', () => {
  for (const text of ['next friday', 'Feb 30', '2026-13-01', 'Sept']) {
    assert.deepEqual(parseDateInput(text, today), { ok: false }, text);
  }
});

test('times accept 12- and 24-hour forms but not a bare hour', () => {
  assert.deepEqual(parseTimeInput('3:30 PM'), ok('15:30'));
  assert.deepEqual(parseTimeInput('3pm'), ok('15:00'));
  assert.deepEqual(parseTimeInput('12 am'), ok('00:00'));
  assert.deepEqual(parseTimeInput('09:05'), ok('09:05'));
  assert.deepEqual(parseTimeInput('noon'), ok('12:00'));
  assert.deepEqual(parseTimeInput(''), ok(null));
  for (const text of ['3', '25:00', '13pm', '9:75']) {
    assert.deepEqual(parseTimeInput(text), { ok: false }, text);
  }
});

test('durations read hours and minutes within a day', () => {
  assert.deepEqual(parseDurationInput('1 hr 30 min'), ok(90));
  assert.deepEqual(parseDurationInput('45 min'), ok(45));
  assert.deepEqual(parseDurationInput('2 hours'), ok(120));
  assert.deepEqual(parseDurationInput('90'), ok(90));
  for (const text of ['', '0 min', '25 hr', 'a while']) {
    assert.deepEqual(parseDurationInput(text), { ok: false }, text);
  }
});

test('lists split on commas and ranges read one or two dates', () => {
  assert.deepEqual(parseListInput(' Ana, Sam ,, '), ['Ana', 'Sam']);
  assert.deepEqual(
    parseRangeInput('Sep 24 – Sep 30', today),
    ok({ from: '2026-09-24', to: '2026-09-30' }),
  );
  assert.deepEqual(
    parseRangeInput('Thu, Sep 24', today),
    ok({ from: '2026-09-24', to: '2026-09-24' }),
  );
  assert.deepEqual(parseRangeInput('', today), ok(null));
  assert.deepEqual(parseRangeInput('Sep 30 to Sep 1', today), { ok: false });
});

test('today is the device’s local calendar date', () => {
  assert.equal(localToday(new Date(2026, 8, 24, 23, 59)), '2026-09-24');
});
