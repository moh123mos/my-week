import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayIndex, fromKey, keyOf, prevKey, shiftWeek, weekKeyOf } from '../../public/js/dates.js';

test('a week starts on Saturday', () => {
  assert.equal(weekKeyOf(new Date(2026, 9, 24)), '2026-10-24'); // Saturday
  assert.equal(weekKeyOf(new Date(2026, 9, 30, 23, 59)), '2026-10-24'); // the following Friday night
  assert.equal(weekKeyOf(new Date(2026, 9, 31)), '2026-10-31'); // the next Saturday
});

test('dayIndex counts from Saturday', () => {
  assert.equal(dayIndex(new Date(2026, 9, 24)), 0);
  assert.equal(dayIndex(new Date(2026, 9, 30)), 6);
});

test('keys round-trip and shift across month and year ends', () => {
  assert.equal(keyOf(fromKey('2026-01-03')), '2026-01-03');
  assert.equal(prevKey('2026-01-03'), '2025-12-27');
  assert.equal(shiftWeek('2026-12-26', 1), '2027-01-02');
});
