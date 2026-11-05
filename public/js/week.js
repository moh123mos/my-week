// Pure rules about habits and weeks: no DOM, no network, no shared state.
import { ALL_DAYS, CHECK_DONE, CHECK_LABELS, CHECK_MISSED, DAYS_IN_WEEK, DEFAULT_PERIOD, PERIODS, WEEK_FIELDS } from './config.js';
import { dayIndex, weekKeyOf } from './dates.js';

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const newId = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

export const newItem = (name = 'بند جديد', period = DEFAULT_PERIOD, track = false) => ({ id: newId(), name, period, track, days: ALL_DAYS });

// Which days a habit is tracked on. A missing mask (rows saved before this existed) means every day.
const maskOf = item => (item && Number.isInteger(item.days) && item.days >= 1 && item.days <= ALL_DAYS ? item.days : ALL_DAYS);
export const dayOn = (item, day) => ((maskOf(item) >> day) & 1) === 1;
// The mask after flipping one day; the last remaining day cannot be switched off.
export const toggleDay = (item, day) => {
  const next = maskOf(item) ^ (1 << day);
  return next === 0 ? maskOf(item) : next;
};
export const allDaysOn = item => maskOf(item) === ALL_DAYS;
// "Select / clear all": every day on, or, since a habit always keeps one day, only the first day (Saturday).
export const toggleAllDays = item => (allDaysOn(item) ? 1 : ALL_DAYS);
// How many of the first `upTo` days the habit is tracked on.
export const activeDays = (item, upTo = DAYS_IN_WEEK) => {
  let n = 0;
  for (let d = 0; d < upTo; d++) if (dayOn(item, d)) n++;
  return n;
};
// How many habits are tracked on a given day.
export const activeOnDay = (items, day) => items.filter(it => dayOn(it, day)).length;
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
// Boxes ticked on the days the habit is tracked, among the first `upTo` days (a day switched off counts for nothing).
export const doneIn = (item, checks, upTo = DAYS_IN_WEEK) =>
  checks.slice(0, upTo).filter((v, day) => v === CHECK_DONE && dayOn(item, day)).length;
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
  // Only the days a habit is tracked on count, so a habit tracked three days a week can still reach 100%.
  const scored = items.map(item => {
    const active = activeDays(item, elapsed), done = doneIn(item, checksOf(week, item.id), elapsed);
    return { item, active, done, ratio: active ? done / active : 0 };
  });
  const done = scored.reduce((sum, s) => sum + s.done, 0);
  const total = scored.reduce((sum, s) => sum + s.active, 0);
  const ratio = total ? done / total : 0;

  let best = null, worst = null;
  const counted = scored.filter(s => s.active > 0);
  if (elapsed && counted.length > 1 && done > 0) {
    const sorted = [...counted].sort((a, b) => b.ratio - a.ratio);
    const first = sorted[0], last = sorted[sorted.length - 1];
    best = first.item;
    if (last.ratio < first.ratio) worst = last.item;
  }
  const tracked = items.filter(i => i.track);
  const endsWritten = tracked.filter(i => week && String(week.end[i.id] || '').trim()).length;
  return { done, total, ratio, percent: Math.round(ratio * 100), best, worst, trackedCount: tracked.length, endsWritten };
}

export function summaryTitle(percent, elapsed) {
  if (!elapsed) return 'أسبوع قادم';
  if (percent === 100) return 'اكتمل البدر هذا الأسبوع';
  if (percent >= 80) return 'ما شاء الله، أسبوع قوي';
  if (percent >= 50) return 'ماضٍ على الطريق';
  if (percent > 0) return 'كل خطوة تُحسب';
  return 'أسبوع جديد، ابدأ بخطوة صغيرة';
}

export function summarySubtitle({ done, total }, itemCount, elapsed) {
  if (!itemCount) return 'دفترك ينتظر أول بند';
  return elapsed ? `أنجزت ${done} من ${total} خانة حتى الآن` : 'سجّل بداياتك مبكرًا لتسهل المقارنة';
}

// How many habits were done on each day of the week.
export const doneByDay = (items, week) =>
  Array.from({ length: DAYS_IN_WEEK }, (_, day) =>
    items.filter(it => dayOn(it, day) && checksOf(week, it.id)[day] === CHECK_DONE).length);
