// Input sanitizing: the client is untrusted, so every shape that reaches Mongo is rebuilt here.
const { MAX_ITEMS, MAX_NAME, MAX_TEXT, MAX_USER_NAME, MAX_EMAIL, ADMIN_PAGE_SIZE, ADMIN_MAX_PAGE_SIZE, ADMIN_MAX_QUERY, ADMIN_MAX_PAGE } = require('./limits');
const { isEmail } = require('./email');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const okId = id => typeof id === 'string' && ID_RE.test(id) && id !== '__proto__';
const PERIODS = ['sobh', 'dhuhr', 'asr', 'maghrib', 'isha'];
const FIELDS = ['checks', 'start', 'end'];
// Bounds each user to ~4,300 week docs.
const MIN_WEEK = '2020-01-01', MAX_WEEK = '2100-12-31';
const SATURDAY = 6;
// A habit's tracked days as a bitmask: bit 0 = Saturday .. bit 6 = Friday. 127 = every day (also the default).
const ALL_DAYS = 127;

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
      days: Number.isInteger(it.days) && it.days >= 1 && it.days <= ALL_DAYS ? it.days : ALL_DAYS,
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
  // The week's own habit rows. Absent when the client sent only boxes/notes.
  if (w.items !== undefined) {
    const items = cleanItems(w.items);
    if (!items) return null;
    out.items = items;
  }
  return out;
}

// { checks: {a: [..]}, start: {a: 'x'} } -> { 'checks.a': [..], 'start.a': 'x' }: a $set that touches only these fields.
// Ids are already limited to [A-Za-z0-9_-] (and not __proto__), so the dotted paths are safe.
function weekFieldPaths(c) {
  const set = {};
  for (const f of FIELDS) for (const [id, v] of Object.entries(c[f])) set[`${f}.${id}`] = v;
  if (c.items) set.items = c.items;
  return set;
}

// "2026-10-24,2026-10-17" -> validated keys (max 4)
function parseKeys(s) {
  const keys = String(s || '').split(',').filter(isWeekKey);
  return [...new Set(keys)].slice(0, 4);
}

// ---- admin dashboard ----

const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;
const isObjectId = s => typeof s === 'string' && OBJECT_ID_RE.test(s);
const ROLES = ['user', 'admin'];
// Query-string values only select among these, so nothing from the client ever becomes a Mongo sort or filter.
const USER_SORTS = { newest: { createdAt: -1 }, oldest: { createdAt: 1 }, name: { name: 1 }, login: { lastLoginAt: -1 } };
const USER_FILTERS = ['all', 'admin', 'disabled', 'active'];

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const intIn = (v, min, max, fallback) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

// ?q=&page=&size=&sort=&filter= -> safe values (never throws; junk falls back to the defaults).
function parseUserListQuery(query) {
  const q = isObj(query) ? query : {};
  return {
    text: typeof q.q === 'string' ? q.q.trim().slice(0, ADMIN_MAX_QUERY) : '',
    page: intIn(q.page, 1, ADMIN_MAX_PAGE, 1),
    size: intIn(q.size, 1, ADMIN_MAX_PAGE_SIZE, ADMIN_PAGE_SIZE),
    sort: Object.hasOwn(USER_SORTS, q.sort) ? q.sort : 'newest',
    filter: USER_FILTERS.includes(q.filter) ? q.filter : 'all',
  };
}

// Admin edit of one account. Returns only the recognised, valid fields, or null when there is nothing to apply
// or a field has the wrong type / value (the whole request is refused rather than half-applied).
function cleanUserPatch(body) {
  if (!isObj(body)) return null;
  const out = {};
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > MAX_USER_NAME) return null;
    out.name = name;
  }
  if (body.email !== undefined) {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (email.length > MAX_EMAIL || !isEmail(email)) return null;
    out.email = email;
  }
  if (body.disabled !== undefined) {
    if (typeof body.disabled !== 'boolean') return null;
    out.disabled = body.disabled;
  }
  if (body.role !== undefined) {
    if (!ROLES.includes(body.role)) return null;
    out.role = body.role;
  }
  return Object.keys(out).length ? out : null;
}

module.exports = { isObjectId, escapeRegex, parseUserListQuery, cleanUserPatch, USER_SORTS, ALL_DAYS, isWeekKey, cleanItems, cleanWeek, weekFieldPaths, parseKeys, isObj };
