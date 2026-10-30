// Pure rules about habits and weeks: no DOM, no network, no shared state.
import { CHECK_DONE, CHECK_LABELS, CHECK_MISSED, DAYS_IN_WEEK, DEFAULT_PERIOD, PERIODS, WEEK_FIELDS } from './config.js';
import { dayIndex, weekKeyOf } from './dates.js';

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const newId = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

export const newItem = (name = 'بند جديد', period = DEFAULT_PERIOD, track = false) => ({ id: newId(), name, period, track });
export const defaultItems = () => [
  newItem('روتين صباحي خفيف', 'sobh', false),
  newItem('مراجعة حزب (بعيدة)', 'sobh', true),
  newItem('بداية الشغل', 'sobh', true),
  newItem('تكميل الشغل', 'dhuhr', true),
  newItem('تطوير ذات | مذاكرة فقه', 'asr', true),
  newItem('مراجعة القرآن (جديدة)', 'maghrib', true),
  newItem('تقفيل اليوم والنوم المبكر', 'isha', false),
];

export const isNotebook = s => !!s && Array.isArray(s.items) && !!s.weeks && typeof s.weeks === 'object';
export const periodOf = p => (hasOwn(PERIODS, p) ? p : DEFAULT_PERIOD);

export const emptyWeek = () => Object.fromEntries(WEEK_FIELDS.map(f => [f, {}]));
const emptyChecks = () => Array(DAYS_IN_WEEK).fill(0);
const validChecks = c => Array.isArray(c) && c.length === DAYS_IN_WEEK;

export const checkState = v => (v === CHECK_DONE || v === CHECK_MISSED ? v : 0);
export const nextCheck = v => (checkState(v) + 1) % CHECK_LABELS.length;
export const countDone = checks => checks.filter(v => v === CHECK_DONE).length;
export const checksOf = (week, id) => {
  const c = week && week.checks && week.checks[id];
  return validChecks(c) ? c : emptyChecks();
};
// The stored array, created if missing, for editing in place.
export const ensureChecks = (week, id) => {
  if (!validChecks(week.checks[id])) week.checks[id] = emptyChecks();
  return week.checks[id];
};

// A week's "start" defaults to the previous week's "end" until it is written.
export function startValue(week, prevWeek, id) {
  if (week && hasOwn(week.start, id)) return { value: week.start[id], inherited: false };
  const prevEnd = prevWeek && prevWeek.end[id];
  return prevEnd ? { value: prevEnd, inherited: true } : { value: '', inherited: false };
}

// How many days of this week count so far: 7 for a past week, 0 for a future one.
export function elapsedDays(weekKey, now = new Date()) {
  const thisWeek = weekKeyOf(now);
  if (weekKey < thisWeek) return DAYS_IN_WEEK;
  return weekKey === thisWeek ? dayIndex(now) + 1 : 0;
}
export const todayIndexIn = (weekKey, now = new Date()) => (weekKey === weekKeyOf(now) ? dayIndex(now) : -1);

export function summarize(items, week, elapsed) {
  const scored = items.map(item => {
    const done = countDone(checksOf(week, item.id).slice(0, elapsed));
    return { item, done, ratio: elapsed ? done / elapsed : 0 };
  });
  const done = scored.reduce((sum, s) => sum + s.done, 0);
  const total = items.length * elapsed;
  const ratio = total ? done / total : 0;

  let best = null, worst = null;
  if (elapsed && items.length > 1 && done > 0) {
    const sorted = [...scored].sort((a, b) => b.ratio - a.ratio);
    const first = sorted[0], last = sorted[sorted.length - 1];
    best = first.item;
    if (last.ratio < first.ratio) worst = last.item;
  }
  const tracked = items.filter(i => i.track);
  const endsWritten = tracked.filter(i => week && String(week.end[i.id] || '').trim()).length;
  return { done, total, ratio, percent: Math.round(ratio * 100), best, worst, trackedCount: tracked.length, endsWritten };
}

// How many habits were done on each day of the week.
export const doneByDay = (items, week) =>
  Array.from({ length: DAYS_IN_WEEK }, (_, day) => items.filter(it => checksOf(week, it.id)[day] === CHECK_DONE).length);
