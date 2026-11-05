// Keeps the store and the server in step. No DOM: the UI reacts through the hooks.
//
// Only the week on screen (and the one before it, for inherited "start" values) is loaded.
// Edits are sent as small deltas: the rows list and/or only the fields (boxes, texts) that changed,
// so two devices editing the same week don't overwrite each other.
import { applyRowsForward, fetchSession, fetchWeeks, isPermanent, saveData } from './api.js';
import { LIMITS, MESSAGES, TIMING, WEEK_FIELDS } from './config.js';
import { prevKey } from './dates.js';

const newDirtyFields = () => Object.fromEntries(WEEK_FIELDS.map(f => [f, new Set()]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Take the server's copy of a week but keep the fields (and the rows) still waiting to be saved.
// Undefined means "no such week".
export function mergeWeek(local, server, pending, itemsPending = false) {
  const waiting = !!pending || itemsPending;
  if (!waiting || !local) return server || (waiting ? local : undefined);
  const merged = {};
  for (const f of WEEK_FIELDS) {
    merged[f] = { ...(server && server[f]) };
    if (pending) pending[f].forEach(id => { if (local[f] && id in local[f]) merged[f][id] = local[f][id]; });
  }
  const source = itemsPending || !server ? local : server;
  merged.items = source.items;
  merged.own = itemsPending ? true : source.own;
  return merged;
}

// The current values of the marked fields, per week; a week with nothing left to send is left out.
// itemKeys: weeks whose rows changed; those rows travel with the delta.
export function weeksDelta(pendingByWeek, weeks, itemKeys = new Set()) {
  const out = {};
  for (const [k, pending] of pendingByWeek) {
    const week = weeks[k], delta = Object.fromEntries(WEEK_FIELDS.map(f => [f, {}]));
    let count = 0;
    if (week) {
      WEEK_FIELDS.forEach(f => pending[f].forEach(id => {
        if (week[f] && week[f][id] !== undefined) { delta[f][id] = week[f][id]; count++; }
      }));
    }
    if (count) out[k] = delta;
  }
  for (const k of itemKeys) {
    const week = weeks[k];
    if (!week || !week.items) continue;
    out[k] ||= Object.fromEntries(WEEK_FIELDS.map(f => [f, {}]));
    out[k].items = week.items;
  }
  return out;
}

// hooks: onSaved(), onStatus(status), onExpired(), onRemoteChange(), isEditingItems()
export function createSync(store, hooks) {
  const dirty = new Map(); // weekKey -> { checks: Set<itemId>, start: Set<itemId>, end: Set<itemId> }
  const loaded = new Set();
  const pendingLoads = new Map();
  const status = { saveFailed: false, limitHit: false, loadFailed: false };
  let baseItems = null; // the starting rows of a new notebook, waiting to be saved
  const itemWeeks = new Set(); // weeks whose own rows changed
  let pushTimer, retryTimer;
  let inflight = 0, pushCount = 0, lastSync = 0;
  let paused = false; // a request that replaces the whole notebook is running
  let epoch = 0; // a new account/notebook invalidates every request still on its way

  const hasDirty = () => !!baseItems || itemWeeks.size > 0 || dirty.size > 0;
  const idle = async () => { while (inflight) await sleep(TIMING.IDLE_POLL_MS); };
  const notifyStatus = () => hooks.onStatus(status);
  const stopTimers = () => { clearTimeout(pushTimer); clearTimeout(retryTimer); };
  const clearStatus = () => { status.saveFailed = status.limitHit = status.loadFailed = false; notifyStatus(); };
  const forgetRequests = () => { epoch++; pendingLoads.clear(); };
  const forgetEdits = () => { baseItems = null; itemWeeks.clear(); dirty.clear(); };
  const setLoaded = keys => { loaded.clear(); keys.forEach(k => loaded.add(k)); };

  function schedulePush() {
    if (!store.user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, TIMING.SAVE_DEBOUNCE_MS);
  }
  // The first write to a week fixes the rows it shows as its own, so later edits to an earlier week can't change it.
  function adoptRows(k) {
    const week = store.state.weeks[k];
    if (week && week.items && !week.own) {
      week.own = true;
      itemWeeks.add(k);
    }
  }
  function markDirty(k, field, id) {
    adoptRows(k);
    if (!dirty.has(k)) dirty.set(k, newDirtyFields());
    dirty.get(k)[field].add(id);
    schedulePush();
  }
  // The rows of week k changed (added, renamed, reordered, days...).
  function markItemsDirty(k) {
    const week = store.state.weeks[k];
    if (week) {
      week.own = true;
      // Weeks after it that nobody wrote to follow it, up to the next week with rows of its own (the server's rule).
      // Without this, a week held in memory keeps showing the old rows, and its first tick would freeze them.
      for (const key of Object.keys(store.state.weeks).sort()) {
        if (key <= k) continue;
        const later = store.state.weeks[key];
        if (later.own) break;
        if (week.items) later.items = structuredClone(week.items);
      }
    }
    itemWeeks.add(k);
    schedulePush();
  }
  // The notebook's starting rows (a new account, or after erasing everything).
  function markBaseDirty(items) {
    baseItems = items;
    schedulePush();
  }
  function remerge(pendingByWeek) {
    for (const [k, pending] of pendingByWeek) {
      if (!dirty.has(k)) dirty.set(k, newDirtyFields());
      WEEK_FIELDS.forEach(f => pending[f].forEach(id => dirty.get(k)[f].add(id)));
    }
  }

  // Empties the dirty marks into requests. Each part knows how to mark its fields dirty again.
  function takeParts() {
    const parts = [];
    if (baseItems) {
      const items = baseItems;
      parts.push({ body: { items }, redo: () => { baseItems ||= items; } });
    }
    const taken = new Map(dirty), itemKeys = new Set(itemWeeks);
    const entries = Object.entries(weeksDelta(taken, store.state.weeks, itemKeys));
    // The server accepts a limited number of weeks per request.
    for (let i = 0; i < entries.length; i += LIMITS.MAX_WEEKS_PER_SAVE) {
      const chunk = entries.slice(i, i + LIMITS.MAX_WEEKS_PER_SAVE);
      parts.push({
        body: { weeks: Object.fromEntries(chunk) },
        redo: () => {
          remerge(new Map(chunk.filter(([k]) => taken.has(k)).map(([k]) => [k, taken.get(k)])));
          chunk.forEach(([k]) => { if (itemKeys.has(k)) itemWeeks.add(k); });
        },
      });
    }
    forgetEdits();
    return parts;
  }

  // Rows and weeks go as separate requests so a rejected one can't block the other.
  async function sendParts(parts, keepalive, ep) {
    const send = async part => {
      try {
        await saveData(part.body, keepalive);
        return 'ok';
      } catch (e) {
        if (e.status === 401) return 'auth';
        return isPermanent(e) ? 'drop' : 'retry';
      }
    };
    if (keepalive) return Promise.all(parts.map(send));
    const results = [];
    for (const part of parts) {
      if (ep !== epoch) break;
      results.push(await send(part));
    }
    return results;
  }

  function applyResults(parts, results, overlap) {
    if (results.includes('auth')) return hooks.onExpired();
    // A keepalive sent while a normal request was still on its way may reach the server before it, and the older
    // request would then win. Marking the same fields dirty again re-sends their current values after it finishes.
    parts.forEach((part, i) => {
      if (results[i] === 'retry' || (overlap && results[i] === 'ok')) part.redo();
    });
    if (overlap && results.includes('ok')) schedulePush();

    const rejected = results.includes('drop');
    if (rejected) status.limitHit = true;
    if (results.includes('retry')) {
      status.saveFailed = true;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(push, TIMING.SAVE_FAIL_RETRY_MS);
    } else {
      status.saveFailed = false;
      if (!rejected) {
        status.limitHit = false;
        hooks.onSaved();
      }
    }
    notifyStatus();
  }

  // keepalive (page hiding): send what's dirty even if a request is in flight (the page may not live to wait for it).
  async function push(keepalive) {
    if (!store.user || paused || !hasDirty()) return;
    const ka = keepalive === true;
    if (inflight && !ka) {
      pushTimer = setTimeout(push, TIMING.SAVE_BUSY_RETRY_MS);
      return;
    }
    // ep: a response that arrives after a logout/login belongs to the previous account and must be ignored.
    const ep = epoch, overlap = ka && inflight > 0;
    const parts = takeParts();
    if (!parts.length) return;
    let results;
    pushCount++;
    inflight++;
    try {
      results = await sendParts(parts, ka, ep);
    } finally {
      inflight--;
    }
    if (!store.user || ep !== epoch) return;
    applyResults(parts, results, overlap);
  }

  // Don't lose the last edit when the tab is closed or hidden.
  function pushOnHide() {
    clearTimeout(pushTimer);
    push(true);
  }

  // Save everything pending (waiting for a request already on its way) before leaving or exporting.
  async function flush() {
    clearTimeout(pushTimer);
    await idle();
    await push();
    await idle();
  }

  // For a request that replaces the whole notebook: nothing may be sent or scheduled while it runs,
  // or an older save could land after it. Afterwards, edits it did not discard are saved as usual.
  async function whilePaused(request) {
    paused = true;
    stopTimers();
    await idle();
    stopTimers();
    try {
      return await request();
    } finally {
      paused = false;
      if (hasDirty()) schedulePush();
    }
  }

  // The notebook was replaced on the server: edits and errors about the old one no longer mean anything.
  function discardPending() {
    forgetEdits();
    forgetRequests();
    clearStatus();
  }

  function applyServerWeek(k, serverWeek) {
    const merged = mergeWeek(store.state.weeks[k], serverWeek, dirty.get(k), itemWeeks.has(k));
    if (merged) store.state.weeks[k] = merged;
    else delete store.state.weeks[k];
  }

  // One request per key, however many callers ask; a result never replaces a week that is already loaded.
  function loadWeeks(keys) {
    const need = keys.filter(k => !loaded.has(k));
    const fresh = need.filter(k => !pendingLoads.has(k));
    if (fresh.length) {
      const ep = epoch;
      const p = fetchWeeks(fresh).then(({ weeks }) => {
        if (ep !== epoch) return;
        for (const k of fresh) {
          if (!loaded.has(k)) applyServerWeek(k, weeks[k]);
          loaded.add(k);
        }
      }).finally(() => fresh.forEach(k => { if (pendingLoads.get(k) === p) pendingLoads.delete(k); }));
      fresh.forEach(k => pendingLoads.set(k, p));
    }
    return Promise.all(need.map(k => pendingLoads.get(k)));
  }

  // Coming back to the tab: pick up what other devices changed. Other weeks are refetched when visited.
  async function resync() {
    if (!store.user || paused || Date.now() - lastSync < TIMING.RESYNC_MIN_GAP_MS) return;
    if (inflight) return; // the GET could read data from before our own save lands
    lastSync = Date.now();
    const ep = epoch, pc = pushCount, nav = store.navSeq, at = store.cur, prev = prevKey(at);
    let session;
    try {
      session = await fetchSession([at, prev]);
    } catch (e) {
      if (e.status === 401 && ep === epoch) hooks.onExpired();
      return;
    }
    if (ep !== epoch || pc !== pushCount || inflight || paused || nav !== store.navSeq || at !== store.cur) {
      lastSync = 0;
      return;
    }
    const snapshot = () => JSON.stringify([store.state.weeks[at], store.state.weeks[prev]]);
    const before = snapshot();
    // With the edit dialog open its list is built from the week's rows, so they must not be swapped under it.
    const editing = hooks.isEditingItems();
    const shown = store.state.weeks[at];
    const keep = editing && shown ? { items: shown.items, own: shown.own } : null;
    for (const k of [at, prev]) {
      applyServerWeek(k, session.weeks[k]);
      loaded.add(k);
    }
    if (keep && store.state.weeks[at]) Object.assign(store.state.weeks[at], keep);
    for (const k of [...loaded]) {
      if (k === at || k === prev) continue;
      loaded.delete(k);
      if (!dirty.has(k)) delete store.state.weeks[k];
    }
    // Rebuilding the rows would drop focus from a text box the user is already typing in; skip it when nothing changed.
    if (!editing && snapshot() !== before) hooks.onRemoteChange();
  }

  // Make the rows of the week on screen the rows of every later week. Saved first, so the server has them.
  async function applyForward() {
    const k = store.cur;
    await flush();
    if (hasDirty()) throw new Error(MESSAGES.GENERIC_ERROR);
    const week = store.state.weeks[k];
    if (!week || !week.items) throw new Error(MESSAGES.GENERIC_ERROR);
    const ep = epoch;
    await applyRowsForward(k, week.items);
    if (ep !== epoch) return;
    week.own = true;
    // Later weeks held in memory are stale now; they are fetched again when visited.
    for (const key of [...loaded]) {
      if (key > k) { loaded.delete(key); delete store.state.weeks[key]; }
    }
  }

  // A session was just loaded with these weeks: start over from what the server said.
  function adoptSession(weekKeys) {
    forgetRequests();
    stopTimers();
    forgetEdits();
    setLoaded(weekKeys);
    lastSync = Date.now();
  }

  // Signed out: nothing of the previous account may survive.
  function clear() {
    forgetEdits();
    loaded.clear();
    forgetRequests();
    stopTimers();
    clearStatus();
  }

  function setLoadFailed(failed) {
    status.loadFailed = failed;
    notifyStatus();
  }

  return {
    hasDirty, schedulePush, markDirty, markItemsDirty, markBaseDirty, applyForward, push, pushOnHide, flush,
    whilePaused, discardPending, loadWeeks, resync, adoptSession, setLoaded, clear, setLoadFailed,
    epoch: () => epoch,
  };
}
