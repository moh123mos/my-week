// Numbers for the admin dashboard. Everything here is read-only, and none of it reads habit names or notes:
// only counts of ticked / missed boxes and timestamps.
//
// "Active" means a week document was last written in the period. A document keeps only its latest write time, so a
// user who edited on Monday and again on Wednesday counts for Wednesday only: the daily chart is a lower bound for
// the days before today, not an exact history. Only weeks from the last ~5 weeks are looked at (that is what the
// `week` index serves), so editing a much older week does not count as activity.
const User = require('./models/User');
const Week = require('./models/Week');
const Settings = require('./models/Settings');

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVITY_DAYS = 30;
const COMPLETION_WEEKS = 6;
const SATURDAY = 6;

const pad = n => String(n).padStart(2, '0');
const dayKey = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

// The Saturday on or before `date`, as the week key the app uses (UTC, so the server's timezone cannot matter).
function weekKeyOf(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - SATURDAY + 7) % 7));
  return dayKey(d);
}

// The last `count` week keys, newest first.
function recentWeekKeys(now, count) {
  const keys = [];
  const d = new Date(weekKeyOf(now) + 'T00:00:00Z');
  for (let i = 0; i < count; i++) {
    keys.push(dayKey(d));
    d.setUTCDate(d.getUTCDate() - 7);
  }
  return keys;
}

// { id: [0|1|2 x7] } -> how many boxes are ticked (1) and missed (2).
function countChecks(checks) {
  let done = 0, missed = 0;
  if (checks && typeof checks === 'object') {
    for (const arr of Object.values(checks)) {
      if (!Array.isArray(arr)) continue;
      for (const v of arr) { if (v === 1) done++; else if (v === 2) missed++; }
    }
  }
  return { done, missed };
}

// Share of the marked boxes that were ticked, as a whole percent. null when nothing was marked (no basis for a rate).
const rate = (done, missed) => (done + missed ? Math.round(100 * done / (done + missed)) : null);

// One entry per day, oldest first, zeros where nothing happened.
function fillDays(now, days, bySignup, byActive) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = dayKey(new Date(now.getTime() - i * DAY_MS));
    out.push({ day, signups: bySignup.get(day) || 0, active: byActive.get(day) || 0 });
  }
  return out;
}

const MAX_MS = 8000;

async function overview(now = new Date()) {
  const d7 = new Date(now.getTime() - 7 * DAY_MS), d30 = new Date(now.getTime() - 30 * DAY_MS);
  const weekFloor = weekKeyOf(new Date(now.getTime() - 35 * DAY_MS));
  const [total, admins, disabled, new7, new30, login7, active7, active30] = await Promise.all([
    User.countDocuments({}).maxTimeMS(MAX_MS),
    User.countDocuments({ role: 'admin' }).maxTimeMS(MAX_MS),
    User.countDocuments({ disabled: true }).maxTimeMS(MAX_MS),
    User.countDocuments({ createdAt: { $gte: d7 } }).maxTimeMS(MAX_MS),
    User.countDocuments({ createdAt: { $gte: d30 } }).maxTimeMS(MAX_MS),
    User.countDocuments({ lastLoginAt: { $gte: d7 } }).maxTimeMS(MAX_MS),
    distinctUsers(weekFloor, d7),
    distinctUsers(weekFloor, d30),
  ]);
  return { total, admins, disabled, new7, new30, login7, active7, active30 };
}

async function distinctUsers(weekFloor, since) {
  const [r] = await Week.aggregate([
    { $match: { week: { $gte: weekFloor }, updatedAt: { $gte: since } } },
    { $group: { _id: '$userId' } },
    { $count: 'n' },
  ]).option({ maxTimeMS: MAX_MS });
  return r ? r.n : 0;
}

async function activity(now = new Date(), days = ACTIVITY_DAYS) {
  const since = new Date(now.getTime() - (days - 1) * DAY_MS);
  since.setUTCHours(0, 0, 0, 0);
  const weekFloor = weekKeyOf(new Date(since.getTime() - 7 * DAY_MS));
  const fmt = { $dateToString: { format: '%Y-%m-%d', date: '$updatedAt', timezone: 'UTC' } };
  const [signups, active] = await Promise.all([
    User.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } }, n: { $sum: 1 } } },
    ]).option({ maxTimeMS: MAX_MS }),
    Week.aggregate([
      { $match: { week: { $gte: weekFloor }, updatedAt: { $gte: since } } },
      { $group: { _id: { d: fmt, u: '$userId' } } },
      { $group: { _id: '$_id.d', n: { $sum: 1 } } },
    ]).option({ maxTimeMS: MAX_MS }),
  ]);
  return fillDays(now, days, new Map(signups.map(r => [r._id, r.n])), new Map(active.map(r => [r._id, r.n])));
}

// Across all users, per recent week: ticked and missed boxes counted inside Mongo, so no habit data reaches Node.
async function completion(now = new Date(), count = COMPLETION_WEEKS) {
  const keys = recentWeekKeys(now, count);
  const tally = (field, value) => ({ $size: { $filter: { input: field, as: 'c', cond: { $eq: ['$$c', value] } } } });
  const rows = await Week.aggregate([
    { $match: { week: { $in: keys } } },
    { $project: {
      week: 1,
      cells: { $reduce: {
        input: { $objectToArray: { $ifNull: ['$checks', {}] } },
        initialValue: { done: 0, missed: 0 },
        in: (() => {
          const arr = { $cond: [{ $isArray: '$$this.v' }, '$$this.v', []] };
          return {
            done: { $add: ['$$value.done', tally(arr, 1)] },
            missed: { $add: ['$$value.missed', tally(arr, 2)] },
          };
        })(),
      } },
    } },
    { $group: { _id: '$week', done: { $sum: '$cells.done' }, missed: { $sum: '$cells.missed' }, notebooks: { $sum: 1 } } },
  ]).option({ maxTimeMS: MAX_MS });
  const byWeek = new Map(rows.map(r => [r._id, r]));
  return keys.map(week => {
    const r = byWeek.get(week) || { done: 0, missed: 0, notebooks: 0 };
    return { week, done: r.done, missed: r.missed, notebooks: r.notebooks, rate: rate(r.done, r.missed) };
  }).reverse(); // oldest first, like the daily chart
}

// Small per-process memory: the dashboard is refreshed by hand, and these scan recent weeks of every user.
const TTL_MS = 30000;
let memo = null;
async function dashboard(now = new Date()) {
  if (memo && now.getTime() - memo.at < TTL_MS) return memo.value;
  const [ov, act, comp] = await Promise.all([overview(now), activity(now), completion(now)]);
  const value = { overview: ov, activity: act, completion: comp, generatedAt: now.toISOString() };
  memo = { at: now.getTime(), value };
  return value;
}
const resetDashboardMemo = () => { memo = null; };

// Per-account figures for one page of the users list: how many weeks written, last write, how many habits.
async function usageFor(ids) {
  if (!ids.length) return new Map();
  const [weeks, settings] = await Promise.all([
    Week.aggregate([
      { $match: { userId: { $in: ids } } },
      { $group: { _id: '$userId', weeks: { $sum: 1 }, lastActive: { $max: '$updatedAt' } } },
    ]).option({ maxTimeMS: MAX_MS }),
    Settings.aggregate([
      { $match: { userId: { $in: ids } } },
      { $project: { userId: 1, n: { $cond: [{ $isArray: '$items' }, { $size: '$items' }, 0] } } },
    ]).option({ maxTimeMS: MAX_MS }),
  ]);
  const out = new Map(ids.map(id => [String(id), { weeks: 0, lastActive: null, habits: 0 }]));
  for (const w of weeks) Object.assign(out.get(String(w._id)), { weeks: w.weeks, lastActive: w.lastActive });
  for (const s of settings) out.get(String(s.userId)).habits = s.n;
  return out;
}

// One user in detail, including the last few weeks' completion (counts only).
async function detailFor(userId, now = new Date(), count = COMPLETION_WEEKS) {
  const keys = recentWeekKeys(now, count);
  const [settings, docs, totals] = await Promise.all([
    Settings.findOne({ userId }).select('items updatedAt').lean(),
    Week.find({ userId, week: { $in: keys } }).select('week checks').lean(),
    Week.aggregate([
      { $match: { userId } },
      { $group: { _id: null, weeks: { $sum: 1 }, first: { $min: '$week' }, last: { $max: '$week' }, lastActive: { $max: '$updatedAt' } } },
    ]).option({ maxTimeMS: MAX_MS }),
  ]);
  const byWeek = new Map(docs.map(d => [d.week, countChecks(d.checks)]));
  const recent = keys.map(week => {
    const c = byWeek.get(week) || { done: 0, missed: 0 };
    return { week, done: c.done, missed: c.missed, rate: rate(c.done, c.missed) };
  }).reverse();
  const t = totals[0] || {};
  return {
    habits: settings && Array.isArray(settings.items) ? settings.items.length : 0,
    weeks: t.weeks || 0,
    firstWeek: t.first || null,
    lastWeek: t.last || null,
    lastActive: t.lastActive || null,
    recent,
  };
}

module.exports = {
  weekKeyOf, recentWeekKeys, countChecks, rate, fillDays, dayKey,
  overview, activity, completion, dashboard, resetDashboardMemo, usageFor, detailFor,
};
