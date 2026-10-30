// Input sanitizing: the client is untrusted, so every shape that reaches Mongo is rebuilt here.
const { MAX_ITEMS, MAX_NAME, MAX_TEXT } = require('./limits');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const okId = id => typeof id === 'string' && ID_RE.test(id) && id !== '__proto__';
const PERIODS = ['sobh', 'dhuhr', 'asr', 'maghrib', 'isha'];
const FIELDS = ['checks', 'start', 'end'];
// Bounds each user to ~4,300 week docs.
const MIN_WEEK = '2020-01-01', MAX_WEEK = '2100-12-31';
const SATURDAY = 6;

const isObj = o => o && typeof o === 'object' && !Array.isArray(o);

// A real calendar date, a Saturday (the app's week start; read from the UTC date so the server's timezone can't matter).
function isWeekKey(k) {
  if (typeof k !== 'string' || !DATE_RE.test(k) || k < MIN_WEEK || k > MAX_WEEK) return false;
  const [y, m, d] = k.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d && t.getUTCDay() === SATURDAY;
}

function cleanItems(items) {
  if (!Array.isArray(items) || items.length > MAX_ITEMS) return null;
  const seen = new Set(), out = [];
  for (const it of items) {
    if (!isObj(it) || !okId(it.id) || seen.has(it.id)) return null;
    seen.add(it.id);
    out.push({
      id: it.id,
      name: String(it.name ?? '').slice(0, MAX_NAME),
      period: PERIODS.includes(it.period) ? it.period : 'sobh',
      track: !!it.track,
    });
  }
  return out;
}

function cleanWeek(w) {
  if (!isObj(w)) return null;
  const out = { checks: {}, start: {}, end: {} };
  if (isObj(w.checks)) {
    for (const [id, arr] of Object.entries(w.checks).slice(0, MAX_ITEMS)) {
      if (!okId(id) || !Array.isArray(arr)) continue;
      out.checks[id] = Array.from({ length: 7 }, (_, i) => (arr[i] === 1 || arr[i] === 2 ? arr[i] : 0));
    }
  }
  for (const f of ['start', 'end']) {
    if (!isObj(w[f])) continue;
    for (const [id, v] of Object.entries(w[f]).slice(0, MAX_ITEMS)) {
      if (okId(id) && typeof v === 'string') out[f][id] = v.slice(0, MAX_TEXT);
    }
  }
  return out;
}

// { checks: {a: [..]}, start: {a: 'x'} } -> { 'checks.a': [..], 'start.a': 'x' }: a $set that touches only these fields.
// Ids are already limited to [A-Za-z0-9_-] (and not __proto__), so the dotted paths are safe.
function weekFieldPaths(c) {
  const set = {};
  for (const f of FIELDS) for (const [id, v] of Object.entries(c[f])) set[`${f}.${id}`] = v;
  return set;
}

// "2026-10-24,2026-10-17" -> validated keys (max 4)
function parseKeys(s) {
  const keys = String(s || '').split(',').filter(isWeekKey);
  return [...new Set(keys)].slice(0, 4);
}

module.exports = { isWeekKey, cleanItems, cleanWeek, weekFieldPaths, parseKeys, isObj };
