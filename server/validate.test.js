const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanItems, cleanWeek, isWeekKey, weekFieldPaths, parseKeys } = require('./validate');

test('cleanItems keeps valid rows and normalizes fields', () => {
  const out = cleanItems([{ id: 'a1', name: 'x'.repeat(150), period: 'nope', track: 1 }]);
  assert.equal(out[0].name.length, 100);
  assert.equal(out[0].period, 'sobh');
  assert.equal(out[0].track, true);
});

test('cleanItems rejects duplicate ids, __proto__, bad ids, non-arrays and more than 100 rows', () => {
  assert.equal(cleanItems([{ id: 'x' }, { id: 'x' }]), null);
  assert.equal(cleanItems([{ id: '__proto__' }]), null);
  assert.equal(cleanItems([{ id: 'a.b' }]), null);
  assert.equal(cleanItems([{ id: '$x' }]), null);
  assert.equal(cleanItems('nope'), null);
  assert.equal(cleanItems(Array.from({ length: 101 }, (_, i) => ({ id: 'i' + i }))), null);
  assert.equal(cleanItems(Array.from({ length: 100 }, (_, i) => ({ id: 'i' + i }))).length, 100);
});

test('cleanWeek clamps checks to 0/1/2 x 7 and drops bad ids', () => {
  const w = cleanWeek({
    checks: { ok1: [9, 'x', null, 1, 2], 'a.b': [1], $where: [1], str: 'no' },
    start: { a1: 'x'.repeat(400), bad$: 'y', n: 5 },
    end: { a1: 'ok' },
  });
  assert.deepEqual(w.checks.ok1, [0, 0, 0, 1, 2, 0, 0]);
  assert.deepEqual(Object.keys(w.checks), ['ok1']);
  assert.equal(w.start.a1.length, 300);
  assert.deepEqual(Object.keys(w.start), ['a1']);
  assert.deepEqual(w.end, { a1: 'ok' });
  assert.equal(cleanWeek('x'), null);
  assert.equal(cleanWeek([]), null);
});

test('cleanWeek ignores a __proto__ key from parsed JSON', () => {
  const w = cleanWeek(JSON.parse('{"checks":{"__proto__":[1]},"start":{"__proto__":"x"},"end":{}}'));
  assert.deepEqual(w, { checks: {}, start: {}, end: {} });
});

test('weekFieldPaths builds dotted $set paths for only the fields present', () => {
  const c = cleanWeek({ checks: { a: [1, 0, 0, 0, 0, 0, 0] }, start: { a: 's' } });
  assert.deepEqual(weekFieldPaths(c), { 'checks.a': [1, 0, 0, 0, 0, 0, 0], 'start.a': 's' });
  assert.deepEqual(weekFieldPaths(cleanWeek({})), {});
});

test('isWeekKey accepts real Saturdays in range', () => {
  for (const k of ['2020-01-04', '2026-10-24', '2026-10-17', '2026-03-07', '2100-12-25']) assert.equal(isWeekKey(k), true, k);
});

test('isWeekKey rejects everything else', () => {
  const bad = ['9999-99-99', '2026-10-25', '2026-02-30', '2026-13-01', '2019-12-28', '2101-01-02', '2026-1-1', '../etc', '', '2026-10-24 ', '2026-10-24\n'];
  for (const k of bad) assert.equal(isWeekKey(k), false, JSON.stringify(k));
  for (const v of [null, undefined, 5, {}, ['2026-10-24']]) assert.equal(isWeekKey(v), false);
});

test('parseKeys keeps valid unique keys, max 4', () => {
  assert.deepEqual(parseKeys('2026-10-24,2026-10-24,bad,2026-10-17'), ['2026-10-24', '2026-10-17']);
  assert.equal(parseKeys('2026-10-24,2026-10-17,2026-10-10,2026-10-03,2026-09-26').length, 4);
  assert.deepEqual(parseKeys(undefined), []);
});

test('isWeekKey follows the calendar, not the server timezone', () => {
  assert.equal(isWeekKey('2020-02-29'), true); // leap day that is a Saturday
  assert.equal(isWeekKey('2024-02-29'), false); // leap day, but a Thursday
  assert.equal(isWeekKey('2100-02-29'), false); // 2100 is not a leap year
  const tz = process.env.TZ;
  try {
    for (const z of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'UTC']) {
      process.env.TZ = z;
      assert.equal(isWeekKey('2026-10-24'), true, z);
      assert.equal(isWeekKey('2026-10-23'), false, z);
    }
  } finally { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; }
});

test('cleanWeek keeps odd-but-legal ids as plain keys and rejects over-long ones', () => {
  const w = cleanWeek({ checks: { constructor: [1], 0: [2], ['x'.repeat(41)]: [1] }, end: { toString: 'ok' } });
  assert.deepEqual(Object.keys(w.checks).sort(), ['0', 'constructor']);
  assert.deepEqual(weekFieldPaths(w), { 'checks.0': [2, 0, 0, 0, 0, 0, 0], 'checks.constructor': [1, 0, 0, 0, 0, 0, 0], 'end.toString': 'ok' });
  assert.equal(({}).polluted, undefined);
});
