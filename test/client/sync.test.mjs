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
    state: { items: [{ id: 'a' }], weeks: { [WEEK]: emptyWeek() } },
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
  sync.markItemsDirty();
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
    weeks: { [WEEK]: { checks: { other: [2, 0, 0, 0, 0, 0, 0] }, start: {}, end: { mine: 'stale' } } },
  });
  const realNow = Date.now;
  Date.now = () => realNow() + 60000;
  try { await sync.resync(); } finally { Date.now = realNow; }
  assert.equal(store.state.weeks[WEEK].end.mine, 'typing');
  assert.deepEqual(store.state.weeks[WEEK].checks.other, [2, 0, 0, 0, 0, 0, 0]);
  assert.equal(store.state.items.length, 2);
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
