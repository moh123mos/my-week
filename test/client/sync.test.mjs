// Drives the real sync module against a fake fetch, in the situations that lose data if they go wrong.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createSync, mergeWeek, weeksDelta } from '../../public/js/sync.js';

const WEEK = '2026-10-24', PREV = '2026-10-17';
const realFetch = globalThis.fetch;
let requests, respond;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const puts = () => requests.filter(r => r.method === 'PUT');
const emptyWeek = () => ({ checks: {}, start: {}, end: {} });

function setup() {
  const store = {
    user: { name: 'n', email: 'e' },
    state: { weeks: { [WEEK]: { ...emptyWeek(), items: [{ id: 'a' }], own: true } } },
    cur: WEEK, target: WEEK, navSeq: 0,
  };
  const events = { saved: 0, expired: 0, remote: 0, status: null };
  const sync = createSync(store, {
    onSaved: () => { events.saved++; },
    onStatus: s => { events.status = { ...s }; },
    onExpired: () => { events.expired++; },
    onRemoteChange: () => { events.remote++; },
    isEditingItems: () => false,
  });
  return { store, sync, events };
}

function edit(store, sync, id, value) {
  store.state.weeks[WEEK].end[id] = value;
  sync.markDirty(WEEK, 'end', id);
}

beforeEach(() => {
  requests = [];
  respond = () => json({ ok: true });
  globalThis.fetch = async (url, init = {}) => {
    const request = { url, method: init.method, body: init.body && JSON.parse(init.body), keepalive: init.keepalive };
    requests.push(request);
    return respond(request);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

test('a save sends only the fields that changed, never the whole week', async () => {
  const { store, sync, events } = setup();
  store.state.weeks[WEEK].end.other = 'not touched';
  edit(store, sync, 'a', 'x');
  await sync.flush();
  assert.deepEqual(puts()[0].body, { weeks: { [WEEK]: { checks: {}, start: {}, end: { a: 'x' } } } });
  assert.equal(events.saved, 1);
  assert.equal(sync.hasDirty(), false);
  sync.clear();
});

test('rows and weeks go as separate requests; weeks are chunked to the server limit', async () => {
  const { store, sync } = setup();
  sync.markBaseDirty([{ id: 'a' }]);
  for (let i = 0; i < 25; i++) {
    const k = `w${i}`;
    store.state.weeks[k] = { ...emptyWeek(), end: { a: 'x' } };
    sync.markDirty(k, 'end', 'a');
  }
  await sync.flush();
  assert.equal(puts().length, 3);
  assert.deepEqual(puts()[0].body.items, [{ id: 'a' }]);
  assert.equal(Object.keys(puts()[1].body.weeks).length, 20);
  assert.equal(Object.keys(puts()[2].body.weeks).length, 5);
  sync.clear();
});

test('a network failure keeps the edit and resends its current value', async () => {
  const { store, sync, events } = setup();
  respond = () => { throw new TypeError('offline'); };
  edit(store, sync, 'a', 'first');
  await sync.flush();
  assert.equal(sync.hasDirty(), true);
  assert.equal(events.status.saveFailed, true);

  respond = () => json({ ok: true });
  store.state.weeks[WEEK].end.a = 'second';
  await sync.flush();
  assert.equal(puts().at(-1).body.weeks[WEEK].end.a, 'second');
  assert.equal(events.status.saveFailed, false);
  assert.equal(sync.hasDirty(), false);
  sync.clear();
});

test('a rejected edit is dropped so it cannot block later saves', async () => {
  const { store, sync, events } = setup();
  respond = () => json({ error: 'no' }, 400);
  edit(store, sync, 'a', 'x');
  await sync.flush();
  assert.equal(sync.hasDirty(), false);
  assert.equal(events.status.limitHit, true);
  assert.equal(events.saved, 0);
  sync.clear();
});

test('a 401 while saving ends the session', async () => {
  const { store, sync, events } = setup();
  respond = () => json({ error: 'no' }, 401);
  edit(store, sync, 'a', 'x');
  await sync.flush();
  assert.equal(events.expired, 1);
  sync.clear();
});

test('a keepalive overlapping a running save re-sends, because the older request might land last', async () => {
  const { store, sync } = setup();
  let release;
  respond = () => new Promise(r => { release = () => r(json({ ok: true })); });
  edit(store, sync, 'a', 'older');
  const running = sync.flush();
  await new Promise(r => setImmediate(r));

  respond = () => json({ ok: true });
  edit(store, sync, 'a', 'newer');
  await sync.push(true);
  assert.equal(puts()[1].keepalive, true);
  assert.equal(sync.hasDirty(), true);
  release();
  await running;
  sync.clear();
});

test('a response from before a logout does not touch the next session', async () => {
  const { store, sync, events } = setup();
  let release;
  respond = () => new Promise(r => { release = () => r(json({ error: 'gone' }, 401)); });
  edit(store, sync, 'a', 'x');
  const running = sync.push();
  await new Promise(r => setImmediate(r));
  sync.clear();
  release();
  await running;
  assert.equal(events.expired, 0);
  assert.equal(sync.hasDirty(), false);
});

test('nothing is saved while the notebook is being replaced, and the old edits die with it', async () => {
  const { store, sync } = setup();
  edit(store, sync, 'a', 'old');
  await sync.whilePaused(async () => {
    await sync.push(true); // the page being hidden must not slip a save in
    assert.equal(puts().length, 0);
    sync.discardPending();
  });
  assert.equal(sync.hasDirty(), false);
  await sync.flush();
  assert.equal(puts().length, 0);
  sync.clear();
});

test('a failed replacement keeps the edits', async () => {
  const { store, sync } = setup();
  edit(store, sync, 'a', 'kept');
  await assert.rejects(sync.whilePaused(async () => { throw new Error('nope'); }));
  assert.equal(sync.hasDirty(), true);
  await sync.flush();
  assert.equal(puts()[0].body.weeks[WEEK].end.a, 'kept');
  sync.clear();
});

test('replacing the notebook clears an old save error, which no later save would otherwise clear', async () => {
  const { store, sync, events } = setup();
  respond = () => { throw new TypeError('offline'); };
  edit(store, sync, 'a', 'x');
  await sync.flush();
  assert.equal(events.status.saveFailed, true);
  sync.discardPending();
  assert.equal(events.status.saveFailed, false);
  sync.clear();
});

test('loadWeeks asks once per key however many callers ask, and skips loaded weeks', async () => {
  const { store, sync } = setup();
  sync.adoptSession([WEEK, PREV]);
  respond = () => json({ weeks: { '2026-10-10': { ...emptyWeek(), end: { a: 'old' } } } });
  await Promise.all([sync.loadWeeks([WEEK, PREV, '2026-10-10']), sync.loadWeeks(['2026-10-10'])]);
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /keys=2026-10-10$/);
  assert.equal(store.state.weeks['2026-10-10'].end.a, 'old');
  await sync.loadWeeks(['2026-10-10']);
  assert.equal(requests.length, 1);
  sync.clear();
});

test('resync takes what other devices changed but keeps fields still waiting to be saved', async () => {
  const { store, sync, events } = setup();
  sync.adoptSession([WEEK, PREV]);
  await new Promise(r => setImmediate(r));
  store.state.weeks[WEEK].checks.a = [1, 0, 0, 0, 0, 0, 0];
  edit(store, sync, 'mine', 'typing');
  respond = () => json({
    items: [{ id: 'a' }, { id: 'b' }],
    weeks: { [WEEK]: { checks: { other: [2, 0, 0, 0, 0, 0, 0] }, start: {}, end: { mine: 'stale' }, items: [{ id: 'a' }, { id: 'b' }], own: true } },
  });
  const realNow = Date.now;
  Date.now = () => realNow() + 60000;
  try { await sync.resync(); } finally { Date.now = realNow; }
  assert.equal(store.state.weeks[WEEK].end.mine, 'typing');
  assert.deepEqual(store.state.weeks[WEEK].checks.other, [2, 0, 0, 0, 0, 0, 0]);
  assert.equal(store.state.weeks[WEEK].items.length, 2);
  assert.equal(events.remote, 1);
  sync.clear();
});

test('mergeWeek handles every combination of local, server and pending', () => {
  const server = { ...emptyWeek(), end: { a: 's' } };
  const local = { ...emptyWeek(), end: { a: 'l', b: 'lb' } };
  const pendingA = { checks: new Set(), start: new Set(), end: new Set(['a']) };
  assert.equal(mergeWeek(local, server, undefined), server);
  assert.equal(mergeWeek(local, undefined, undefined), undefined);
  assert.equal(mergeWeek(local, undefined, pendingA).end.a, 'l');
  assert.equal(mergeWeek(undefined, server, pendingA), server);
  assert.deepEqual(mergeWeek(local, server, pendingA).end, { a: 'l' }); // b is not pending, so the server decides
});

test('weeksDelta leaves out a week with nothing to send', () => {
  const pending = new Map([['gone', { checks: new Set(), start: new Set(), end: new Set(['a']) }]]);
  assert.deepEqual(weeksDelta(pending, {}), {});
});

test('the first write to a week that only borrows its rows makes them its own, and sends them with the box', async () => {
  const { store, sync } = setup();
  store.state.weeks[WEEK].own = false;
  edit(store, sync, 'a', 'x');
  await sync.flush();
  assert.equal(store.state.weeks[WEEK].own, true);
  assert.deepEqual(puts()[0].body.weeks[WEEK].items, [{ id: 'a' }]);
  assert.equal(puts()[0].body.weeks[WEEK].end.a, 'x');
  // Once the rows are the week's own they are not sent again with every box.
  edit(store, sync, 'a', 'y');
  await sync.flush();
  assert.equal(puts()[1].body.weeks[WEEK].items, undefined);
  sync.clear();
});

test('editing the rows of a week sends them for that week only', async () => {
  const { store, sync } = setup();
  store.state.weeks[WEEK].items.push({ id: 'b', days: 5 });
  sync.markItemsDirty(WEEK);
  await sync.flush();
  assert.equal(puts().length, 1);
  assert.deepEqual(puts()[0].body, { weeks: { [WEEK]: { checks: {}, start: {}, end: {}, items: [{ id: 'a' }, { id: 'b', days: 5 }] } } });
  sync.clear();
});

test('a failed save of rows is retried with the rows as they are by then', async () => {
  const { store, sync } = setup();
  respond = () => { throw new TypeError('offline'); };
  sync.markItemsDirty(WEEK);
  await sync.flush();
  assert.equal(sync.hasDirty(), true);
  respond = () => json({ ok: true });
  store.state.weeks[WEEK].items.push({ id: 'c' });
  await sync.flush();
  assert.equal(puts().at(-1).body.weeks[WEEK].items.length, 2);
  assert.equal(sync.hasDirty(), false);
  sync.clear();
});

test('resync keeps rows that are still waiting to be saved', async () => {
  const { store, sync } = setup();
  sync.adoptSession([WEEK, PREV]);
  await new Promise(r => setImmediate(r));
  store.state.weeks[WEEK].items.push({ id: 'mine' });
  sync.markItemsDirty(WEEK);
  respond = () => json({ weeks: { [WEEK]: { ...emptyWeek(), items: [{ id: 'theirs' }], own: true } } });
  const realNow = Date.now;
  Date.now = () => realNow() + 60000;
  try { await sync.resync(); } finally { Date.now = realNow; }
  assert.deepEqual(store.state.weeks[WEEK].items.map(i => i.id), ['a', 'mine']);
  sync.clear();
});

test('apply forward saves first, sends this week rows, and forgets the later weeks held in memory', async () => {
  const { store, sync } = setup();
  sync.adoptSession([WEEK, PREV, '2026-10-31']);
  store.state.weeks['2026-10-31'] = { ...emptyWeek(), items: [{ id: 'old' }], own: false };
  store.state.weeks[WEEK].items.push({ id: 'b', days: 3 });
  sync.markItemsDirty(WEEK);
  await sync.applyForward();
  const post = requests.find(r => r.method === 'POST');
  assert.match(post.url, /apply-forward$/);
  assert.deepEqual(post.body, { week: WEEK, items: [{ id: 'a' }, { id: 'b', days: 3 }] });
  assert.ok(requests.indexOf(post) > requests.findIndex(r => r.method === 'PUT'));
  assert.equal(store.state.weeks['2026-10-31'], undefined);
  assert.ok(store.state.weeks[WEEK]);
  sync.clear();
});

test('mergeWeek keeps pending rows over the server rows', () => {
  const server = { ...emptyWeek(), items: [{ id: 's' }], own: true };
  const local = { ...emptyWeek(), items: [{ id: 'l' }], own: false };
  assert.deepEqual(mergeWeek(local, server, undefined, true).items, [{ id: 'l' }]);
  assert.equal(mergeWeek(local, server, undefined, true).own, true);
  assert.equal(mergeWeek(local, server, undefined, false), server);
});

test('editing the rows of a week passes them to later weeks held in memory, up to the next week with its own rows', () => {
  const { store, sync } = setup();
  const w = n => `2026-11-${String(n).padStart(2, '0')}`;
  store.state.weeks[w(7)] = { ...emptyWeek(), items: [{ id: 'a' }], own: false };
  store.state.weeks[w(14)] = { ...emptyWeek(), items: [{ id: 'a' }], own: false };
  store.state.weeks[w(21)] = { ...emptyWeek(), items: [{ id: 'mine' }], own: true };
  store.state.weeks[w(28)] = { ...emptyWeek(), items: [{ id: 'a' }], own: false };
  store.state.weeks[WEEK].items.push({ id: 'new' });
  sync.markItemsDirty(WEEK);
  assert.deepEqual(store.state.weeks[w(7)].items.map(i => i.id), ['a', 'new']);
  assert.deepEqual(store.state.weeks[w(14)].items.map(i => i.id), ['a', 'new']);
  assert.notEqual(store.state.weeks[w(7)].items, store.state.weeks[WEEK].items); // copies, not shared
  assert.deepEqual(store.state.weeks[w(21)].items.map(i => i.id), ['mine']); // its own rows stop the chain
  assert.deepEqual(store.state.weeks[w(28)].items.map(i => i.id), ['a']);
  sync.clear();
});
