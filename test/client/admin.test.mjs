import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionLabel, ACTION_LABELS, ago, barHeights, percent, rateOf } from '../../public/js/admin/format.js';

const NOW = Date.parse('2026-11-05T12:00:00Z');
const before = ms => new Date(NOW - ms).toISOString();
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;

test('ago speaks Arabic with proper dual and plural forms', () => {
  assert.equal(ago(null, NOW), 'لم يحدث بعد');
  assert.equal(ago('garbage', NOW), 'لم يحدث بعد');
  assert.equal(ago(before(10e3), NOW), 'الآن');
  assert.equal(ago(before(MIN), NOW), 'منذ دقيقة');
  assert.equal(ago(before(2 * MIN), NOW), 'منذ دقيقتين');
  assert.equal(ago(before(5 * MIN), NOW), 'منذ ٥ دقائق');
  assert.equal(ago(before(3 * HOUR), NOW), 'منذ ٣ ساعات');
  assert.equal(ago(before(DAY), NOW), 'منذ يوم');
  assert.equal(ago(before(2 * DAY), NOW), 'منذ يومين');
  assert.equal(ago(before(12 * DAY), NOW), 'منذ ١٢ يوم');
  assert.equal(ago(before(65 * DAY), NOW), 'منذ شهرين');
  assert.equal(ago(before(800 * DAY), NOW), 'منذ سنتين');
  assert.equal(ago(new Date(NOW + HOUR).toISOString(), NOW), 'الآن', 'a clock slightly ahead never shows a negative time');
});

test('barHeights scales to the tallest bar and never divides by zero', () => {
  assert.deepEqual(barHeights([0, 5, 10]), [0, 0.5, 1]);
  assert.deepEqual(barHeights([0, 0]), [0, 0]);
  assert.deepEqual(barHeights([]), []);
  assert.deepEqual(barHeights([1, 100], 0.1), [0.1, 1], 'a non-zero value stays visible');
});

test('percent and rateOf', () => {
  assert.equal(percent(null), '—');
  assert.equal(percent(75), '٧٥٪');
  assert.equal(rateOf(3, 1), 75);
  assert.equal(rateOf(0, 0), null);
});

test('every audit action the server writes has an Arabic label', () => {
  const actions = ['user.rename', 'user.email', 'user.disable', 'user.enable', 'user.promote', 'user.demote',
    'user.reset_password', 'user.revoke_sessions', 'user.delete', 'admin.grant', 'admin.revoke'];
  for (const a of actions) assert.ok(ACTION_LABELS[a], a);
  assert.equal(actionLabel('unknown.thing'), 'unknown.thing');
});

import { buildHash, parseHash } from '../../public/js/admin/route.js';
import { barReadout, indexAt, monthDay } from '../../public/js/admin/format.js';

const ID = '0123456789abcdef01234567';

test('parseHash understands every place and falls back to overview', () => {
  assert.deepEqual(parseHash(''), { tab: 'overview', id: null, filter: null });
  assert.deepEqual(parseHash('#users'), { tab: 'users', id: null, filter: null });
  assert.deepEqual(parseHash('#users?filter=disabled'), { tab: 'users', id: null, filter: 'disabled' });
  assert.deepEqual(parseHash(`#users/${ID}`), { tab: 'users', id: ID, filter: null });
  assert.deepEqual(parseHash('#audit'), { tab: 'audit', id: null, filter: null });
  // Junk never reaches the page: bad tab, bad id, bad filter, ids/filters on the wrong tab.
  assert.deepEqual(parseHash('#nope'), { tab: 'overview', id: null, filter: null });
  assert.deepEqual(parseHash('#users/not-an-id'), { tab: 'users', id: null, filter: null });
  assert.deepEqual(parseHash('#users?filter=$ne'), { tab: 'users', id: null, filter: null });
  assert.deepEqual(parseHash(`#audit/${ID}?filter=admin`), { tab: 'audit', id: null, filter: null });
});

test('buildHash round-trips with parseHash', () => {
  for (const route of [{ tab: 'overview' }, { tab: 'users' }, { tab: 'users', filter: 'admin' }, { tab: 'users', id: ID }, { tab: 'audit' }]) {
    const parsed = parseHash(buildHash(route));
    assert.equal(parsed.tab, route.tab);
    assert.equal(parsed.id, route.id || null);
    assert.equal(parsed.filter, route.filter || null);
  }
  assert.equal(buildHash({ tab: 'users', filter: 'all' }), '#users');
  assert.equal(buildHash({ tab: 'bogus' }), '#overview');
});

test('indexAt maps a pointer to a bar, right to left, and clamps', () => {
  // 10 bars, 100px wide starting at x=0: the rightmost tenth is bar 0 (the oldest).
  assert.equal(indexAt(99, 0, 100, 10), 0);
  assert.equal(indexAt(1, 0, 100, 10), 9);
  assert.equal(indexAt(55, 0, 100, 10), 4);
  assert.equal(indexAt(-50, 0, 100, 10), 9);
  assert.equal(indexAt(500, 0, 100, 10), 0);
  assert.equal(indexAt(1, 0, 100, 10, false), 0);
  assert.equal(indexAt(5, 0, 0, 10), 0);
  assert.equal(indexAt(5, 0, 100, 0), 0);
});

test('barReadout names the day and the value', () => {
  assert.equal(monthDay('2026-11-05'), new Date('2026-11-05T00:00:00Z').toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', timeZone: 'UTC' }));
  assert.ok(barReadout('2026-11-05', 3).endsWith(': ٣'));
});
