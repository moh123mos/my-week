import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SHARE } from '../../public/js/config.js';
import { buildShareModel, chooseSize, layoutFor, moreText, planRows } from '../../public/js/share.js';
import { emptyWeek, newItem } from '../../public/js/week.js';

const NOW = new Date(2026, 10, 4); // Wednesday; its week starts Saturday 2026-10-31
const KEY = '2026-10-31';
const items = n => Array.from({ length: n }, (_, i) => ({ ...newItem(`بند ${i}`, 'sobh', i % 2 === 0), id: 'i' + i }));
const model = (list, week = emptyWeek(), extra = {}) =>
  buildShareModel({ items: list, week, prevWeek: null, weekKey: KEY, userName: ' محمد ', now: NOW, ...extra });

test('the model carries the user name trimmed and one cell per day per habit', () => {
  const m = model(items(2));
  assert.equal(m.userName, 'محمد');
  assert.equal(m.rows.length, 2);
  assert.equal(m.rows[0].cells.length, 7);
  assert.equal(m.todayIdx, 4);
  assert.equal(m.elapsed, 5);
});

test('days a habit is not tracked on are marked off and do not count', () => {
  const list = items(1);
  list[0].days = 0b0000011; // Saturday and Sunday only
  const w = emptyWeek();
  w.checks.i0 = [1, 1, 1, 0, 0, 0, 0];
  const row = model(list, w).rows[0];
  assert.deepEqual(row.cells, [1, 1, -1, -1, -1, -1, -1]);
  assert.equal(row.done, 2);
  assert.equal(row.active, 2);
});

test('notes show only for tracked habits and fall back to the inherited start', () => {
  const list = items(2); // i0 is tracked, i1 is not
  const w = emptyWeek();
  w.end.i0 = 'صفحة 20';
  w.end.i1 = 'تجاهل';
  const prev = { ...emptyWeek(), end: { i0: 'صفحة 10' } };
  const m = buildShareModel({ items: list, week: w, prevWeek: prev, weekKey: KEY, now: NOW });
  assert.equal(m.rows[0].note, 'بدأت: صفحة 10 · وصلت: صفحة 20');
  assert.equal(m.rows[1].note, '');
});

test('planRows keeps every row when they fit and collapses the rest into a count when they do not', () => {
  const rows = model(items(7)).rows;
  assert.deepEqual(planRows(rows, 7 * 90, false).hidden, 0);
  const tight = planRows(model(items(30)).rows, 500, false);
  assert.ok(tight.hidden > 0 && tight.rowH >= SHARE.LAYOUT.minRow);
  assert.equal(tight.shown.length + tight.hidden, 30);
});

test('notes take room from the rows', () => {
  const list = items(7);
  const w = emptyWeek();
  for (const it of list) w.end[it.id] = 'x';
  const rows = model(list, w).rows;
  const without = planRows(rows, 520, false), withNotes = planRows(rows, 520, true);
  assert.ok(withNotes.rowH < without.rowH || withNotes.hidden > without.hidden);
});

test('auto picks the portrait size for a short notebook and the tall one for a long one', () => {
  assert.equal(chooseSize(model(items(5)), false), 'portrait');
  assert.equal(chooseSize(model(items(25)), true), 'story');
});

test('the layout stays inside the picture and ends with the footer', () => {
  for (const [count, size] of [[1, 'portrait'], [7, 'portrait'], [40, 'portrait'], [7, 'story'], [100, 'story']]) {
    const lay = layoutFor(model(items(count)), size, true);
    assert.equal(lay.H, SHARE.SIZES[size]);
    assert.ok(lay.y.head >= 0);
    assert.ok(lay.y.footer < lay.H, `${count} rows in ${size}: footer at ${lay.y.footer} of ${lay.H}`);
  }
});

test('moreText agrees with the number', () => {
  assert.deepEqual([1, 2, 5, 12].map(moreText), ['+ بند آخر', '+ بندان آخران', '+ 5 بنود أخرى', '+ 12 بندًا آخر']);
});
