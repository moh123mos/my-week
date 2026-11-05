const test = require('node:test');
const assert = require('node:assert/strict');
const { weekKeyOf, recentWeekKeys, countChecks, rate, fillDays } = require('./adminStats');
const { isWeekKey, parseUserListQuery, cleanUserPatch, escapeRegex, isObjectId } = require('./validate');
const password = require('./password');

test('weekKeyOf returns the Saturday on or before the date, and is always a valid week key', () => {
  assert.equal(weekKeyOf(new Date('2026-10-31T10:00:00Z')), '2026-10-31'); // a Saturday
  assert.equal(weekKeyOf(new Date('2026-11-05T23:59:00Z')), '2026-10-31'); // a Thursday
  assert.equal(weekKeyOf(new Date('2026-11-06T00:00:00Z')), '2026-10-31'); // Friday
  assert.equal(weekKeyOf(new Date('2026-11-07T00:00:00Z')), '2026-11-07');
  for (let i = 0; i < 400; i++) assert.ok(isWeekKey(weekKeyOf(new Date(Date.UTC(2026, 0, 1 + i)))));
});

test('recentWeekKeys lists consecutive Saturdays, newest first', () => {
  assert.deepEqual(recentWeekKeys(new Date('2026-11-05T00:00:00Z'), 3), ['2026-10-31', '2026-10-24', '2026-10-17']);
});

test('countChecks counts ticked and missed boxes and ignores junk', () => {
  assert.deepEqual(countChecks({ a: [1, 1, 2, 0, 0, 0, 0], b: [2, 0, 0, 0, 0, 0, 1], c: 'x' }), { done: 3, missed: 2 });
  assert.deepEqual(countChecks(null), { done: 0, missed: 0 });
  assert.deepEqual(countChecks({}), { done: 0, missed: 0 });
});

test('rate is a whole percent of marked boxes, null with no basis', () => {
  assert.equal(rate(3, 1), 75);
  assert.equal(rate(1, 2), 33);
  assert.equal(rate(0, 0), null);
  assert.equal(rate(0, 4), 0);
});

test('fillDays gives one entry per day, oldest first, zeros for quiet days', () => {
  const out = fillDays(new Date('2026-11-05T12:00:00Z'), 3, new Map([['2026-11-05', 2]]), new Map([['2026-11-03', 5]]));
  assert.deepEqual(out, [
    { day: '2026-11-03', signups: 0, active: 5 },
    { day: '2026-11-04', signups: 0, active: 0 },
    { day: '2026-11-05', signups: 2, active: 0 },
  ]);
});

test('parseUserListQuery never trusts the query string', () => {
  assert.deepEqual(parseUserListQuery({}), { text: '', page: 1, size: 20, sort: 'newest', filter: 'all' });
  const q = parseUserListQuery({ q: '  ali  ', page: '3', size: '10', sort: 'name', filter: 'disabled' });
  assert.deepEqual(q, { text: 'ali', page: 3, size: 10, sort: 'name', filter: 'disabled' });
  const bad = parseUserListQuery({ q: ['a'], page: '-1', size: '9999', sort: '__proto__', filter: '$ne' });
  assert.deepEqual(bad, { text: '', page: 1, size: 20, sort: 'newest', filter: 'all' });
  assert.equal(parseUserListQuery({ q: 'x'.repeat(500) }).text.length, 100);
  assert.deepEqual(parseUserListQuery(undefined), parseUserListQuery({}));
});

test('cleanUserPatch keeps only valid known fields, all or nothing', () => {
  assert.deepEqual(cleanUserPatch({ name: ' Ali ', role: 'admin', x: 1 }), { name: 'Ali', role: 'admin' });
  assert.deepEqual(cleanUserPatch({ email: ' A@B.com ' }), { email: 'a@b.com' });
  assert.deepEqual(cleanUserPatch({ disabled: false }), { disabled: false });
  for (const bad of [null, [], {}, { x: 1 }, { name: '' }, { name: 5 }, { name: 'x'.repeat(61) }, { email: 'no' },
    { disabled: 'true' }, { disabled: 1 }, { role: 'root' }, { role: { $ne: 1 } }, { name: 'ok', role: 'root' }]) {
    assert.equal(cleanUserPatch(bad), null, JSON.stringify(bad));
  }
});

test('escapeRegex and isObjectId', () => {
  const rx = new RegExp(escapeRegex('a.b*(c)[d]+?^$|\\'), 'i');
  assert.ok(rx.test('xa.b*(c)[d]+?^$|\\y'));
  assert.ok(!rx.test('aXb'));
  assert.ok(isObjectId('0123456789abcdef01234567'));
  for (const bad of ['', 'xyz', '0123456789abcdef0123456', { $ne: 1 }, null, '0123456789abcdef0123456g']) assert.ok(!isObjectId(bad));
});

test('generateTemporary is long enough, readable and random', () => {
  const a = password.generateTemporary(), b = password.generateTemporary();
  assert.equal(a.length, 12);
  assert.match(a, /^[a-km-zA-HJ-NP-Z2-9]+$/); // no 0 O 1 l I
  assert.notEqual(a, b);
});
