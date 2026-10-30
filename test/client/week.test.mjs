import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checksOf, doneByDay, elapsedDays, emptyWeek, ensureChecks, isNotebook, nextCheck, periodOf, startValue, summarize, todayIndexIn,
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
