const test = require('node:test');
const assert = require('node:assert/strict');

// Stand in for the Week model: an in-memory list of docs with just the queries weeks.js makes.
const docs = [];
const Week = {
  find: ({ userId, week }) => ({
    select: () => ({ lean: async () => docs.filter(d => d.userId === userId && week.$in.includes(d.week)) }),
  }),
  findOne: ({ userId, week }) => ({
    sort: () => ({
      select: () => ({
        lean: async () => docs
          .filter(d => d.userId === userId && d.week < week.$lt && Array.isArray(d.items))
          .sort((a, b) => (a.week < b.week ? 1 : -1))[0] || null,
      }),
    }),
  }),
};
require.cache[require.resolve('./models/Week')] = { id: 'w', filename: 'w', loaded: true, exports: Week };
const { loadWeeks } = require('./weeks');

const BASE = [{ id: 'base' }];
const rows = (...ids) => ids.map(id => ({ id }));
const W1 = '2026-10-03', W2 = '2026-10-10', W3 = '2026-10-17', W4 = '2026-10-24';

test('a week with its own rows shows them', async () => {
  docs.length = 0;
  docs.push({ userId: 'u', week: W3, checks: { a: [1] }, items: rows('mine') });
  const out = await loadWeeks('u', [W3], BASE);
  assert.deepEqual(out[W3].items, rows('mine'));
  assert.equal(out[W3].own, true);
  assert.deepEqual(out[W3].checks, { a: [1] });
});

test('a week saved before per-week rows existed reads the notebook rows, even after a later week was edited', async () => {
  docs.length = 0;
  docs.push({ userId: 'u', week: W1, checks: {} }, { userId: 'u', week: W2, checks: {}, items: rows('later') });
  const out = await loadWeeks('u', [W1], BASE);
  assert.deepEqual(out[W1].items, BASE);
  assert.equal(out[W1].own, false);
});

test('a week nobody wrote to follows the nearest earlier week that has rows', async () => {
  docs.length = 0;
  docs.push({ userId: 'u', week: W1, items: rows('first') }, { userId: 'u', week: W2, items: rows('second') });
  const out = await loadWeeks('u', [W3, W4], BASE);
  assert.deepEqual(out[W3].items, rows('second'));
  assert.deepEqual(out[W4].items, rows('second'));
  assert.equal(out[W3].own, false);
  assert.deepEqual(out[W3].checks, {}); // a week with no doc still comes back whole
});

test('before any week has rows, an unwritten week shows the notebook rows', async () => {
  docs.length = 0;
  docs.push({ userId: 'u', week: W4, items: rows('future') });
  const out = await loadWeeks('u', [W2], BASE);
  assert.deepEqual(out[W2].items, BASE);
});

test('an empty list of rows is still the week own choice', async () => {
  docs.length = 0;
  docs.push({ userId: 'u', week: W2, items: [] });
  const out = await loadWeeks('u', [W2, W3], BASE);
  assert.deepEqual(out[W2].items, []);
  assert.equal(out[W2].own, true);
  assert.deepEqual(out[W3].items, []); // inherits the empty list
});

test('another user rows never leak in', async () => {
  docs.length = 0;
  docs.push({ userId: 'other', week: W1, items: rows('secret') });
  const out = await loadWeeks('u', [W3], BASE);
  assert.deepEqual(out[W3].items, BASE);
});

test('no keys, no queries', async () => {
  assert.deepEqual(await loadWeeks('u', [], BASE), {});
});
