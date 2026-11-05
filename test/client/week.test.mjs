import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activeDays, activeOnDay, allDaysOn, dayOn, toggleAllDays, toggleDay, checksOf, doneByDay, elapsedDays, emptyWeek, ensureChecks, isNotebook, nextCheck, periodOf, startValue, summarize, todayIndexIn,
} from '../../public/js/week.js';

const week = (over = {}) => ({ ...emptyWeek(), ...over });

test('a check cycles empty -> done -> missed -> empty, and junk counts as empty', () => {
  assert.deepEqual([nextCheck(0), nextCheck(1), nextCheck(2), nextCheck('x')], [1, 2, 0, 1]);
});

test('checksOf falls back to an empty week for missing or malformed data', () => {
  assert.deepEqual(checksOf(null, 'a'), [0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(checksOf(week({ checks: { a: [1] } }), 'a'), [0, 0, 0, 0, 0, 0, 0]);
});

test('ensureChecks returns the stored array so edits land in the week', () => {
  const w = week();
  ensureChecks(w, 'a')[2] = 1;
  assert.equal(w.checks.a[2], 1);
});

test('start is inherited from the previous end until written, even when written empty', () => {
  const prev = week({ end: { a: 'page 10' } });
  assert.deepEqual(startValue(null, prev, 'a'), { value: 'page 10', inherited: true });
  assert.deepEqual(startValue(week({ start: { a: 'mine' } }), prev, 'a'), { value: 'mine', inherited: false });
  assert.deepEqual(startValue(week({ start: { a: '' } }), prev, 'a'), { value: '', inherited: false });
  assert.deepEqual(startValue(null, null, 'a'), { value: '', inherited: false });
  // A habit id equal to an Object.prototype name must not read as written.
  assert.deepEqual(startValue(week(), null, 'toString'), { value: '', inherited: false });
});

test('elapsed days and today index depend on where the week sits', () => {
  const tuesday = new Date(2026, 9, 27); // Saturday = 0, so Tuesday = 3
  assert.equal(elapsedDays('2026-10-17', tuesday), 7);
  assert.equal(elapsedDays('2026-10-24', tuesday), 4);
  assert.equal(elapsedDays('2026-10-31', tuesday), 0);
  assert.equal(todayIndexIn('2026-10-24', tuesday), 3);
  assert.equal(todayIndexIn('2026-10-17', tuesday), -1);
});

test('summarize counts only elapsed days and names the strongest and weakest habits', () => {
  const items = [{ id: 'a', track: true }, { id: 'b', track: true }, { id: 'c', track: false }];
  const w = week({
    checks: { a: [1, 1, 0, 0, 0, 0, 1], b: [1, 2, 0, 0, 0, 0, 0] },
    end: { a: 'done', b: '   ' },
  });
  const s = summarize(items, w, 2);
  assert.equal(s.done, 3); // the 1 on day 6 hasn't happened yet
  assert.equal(s.total, 6);
  assert.equal(s.percent, 50);
  assert.equal(s.best.id, 'a');
  assert.equal(s.worst.id, 'c');
  assert.equal(s.trackedCount, 2);
  assert.equal(s.endsWritten, 1); // whitespace is not an ending
});

test('summarize leaves out best and worst when they say nothing', () => {
  const tied = [{ id: 'a' }, { id: 'b' }];
  const w = week({ checks: { a: [1, 0, 0, 0, 0, 0, 0], b: [1, 0, 0, 0, 0, 0, 0] } });
  const s = summarize(tied, w, 1);
  assert.equal(s.best.id, 'a');
  assert.equal(s.worst, null);
  assert.equal(summarize(tied, week(), 1).best, null); // nothing done yet
  assert.equal(summarize(tied, w, 0).percent, 0); // a future week
});

test('doneByDay counts per day', () => {
  const w = week({ checks: { a: [1, 0, 0, 0, 0, 0, 1], b: [1, 2, 0, 0, 0, 0, 0] } });
  assert.deepEqual(doneByDay([{ id: 'a' }, { id: 'b' }], w), [2, 0, 0, 0, 0, 0, 1]);
});

test('periodOf and isNotebook reject what they do not know', () => {
  assert.equal(periodOf('asr'), 'asr');
  assert.equal(periodOf('constructor'), 'sobh');
  assert.equal(isNotebook({ items: [], weeks: {} }), true);
  assert.equal(isNotebook({ items: [] }), false);
  assert.equal(isNotebook(null), false);
});

test('a habit without a mask is tracked every day; a mask picks days (bit 0 = Saturday)', () => {
  assert.equal(dayOn({ id: 'a' }, 3), true);
  assert.equal(dayOn({ id: 'a', days: 0 }, 3), true); // junk means every day, never none
  const monThu = { id: 'a', days: (1 << 2) | (1 << 5) };
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(d => dayOn(monThu, d)), [false, false, true, false, false, true, false]);
  assert.equal(activeDays(monThu), 2);
  assert.equal(activeDays(monThu, 3), 1);
  assert.equal(activeOnDay([monThu, { id: 'b' }], 2), 2);
  assert.equal(activeOnDay([monThu, { id: 'b' }], 0), 1);
});

test('toggleDay flips one day and never turns the last one off', () => {
  assert.equal(toggleDay({ days: 127 }, 0), 126);
  assert.equal(toggleDay({ id: 'a' }, 6), 63);
  assert.equal(toggleDay({ days: 4 }, 2), 4);
});

test('summarize counts only the days a habit is tracked on', () => {
  const items = [{ id: 'a', days: 0b0000011 }, { id: 'b' }];
  const w = week({ checks: { a: [1, 1, 1, 1, 1, 1, 1], b: [1, 0, 0, 0, 0, 0, 0] } });
  const s = summarize(items, w, 7);
  assert.equal(s.total, 9); // 2 tracked days for a + 7 for b
  assert.equal(s.done, 3); // a's ticks on days it isn't tracked on count for nothing
  assert.equal(summarize(items, w, 1).total, 2);
  assert.equal(summarize([{ id: 'a', days: 0b1000000 }], week(), 3).total, 0); // nothing tracked yet this week
});

test('doneByDay ignores boxes on days a habit is not tracked on', () => {
  const items = [{ id: 'a', days: 0b0000001 }, { id: 'b' }];
  const w = week({ checks: { a: [1, 1, 0, 0, 0, 0, 0], b: [1, 1, 0, 0, 0, 0, 0] } });
  assert.deepEqual(doneByDay(items, w), [2, 1, 0, 0, 0, 0, 0]);
});

test('toggleAllDays selects every day, and clearing all keeps the first day', () => {
  assert.equal(toggleAllDays({ id: 'a', days: 0b0100101 }), 127);
  assert.equal(allDaysOn({ id: 'a', days: 127 }), true);
  assert.equal(allDaysOn({ id: 'a' }), true); // a row without a mask is tracked every day
  assert.equal(allDaysOn({ id: 'a', days: 126 }), false);
  assert.equal(toggleAllDays({ id: 'a', days: 127 }), 1);
  assert.equal(toggleAllDays({ id: 'a' }), 1);
  assert.equal(toggleAllDays({ id: 'a', days: toggleAllDays({ id: 'a', days: 127 }) }), 127); // and back
});
