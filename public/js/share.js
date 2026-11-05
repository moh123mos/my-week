// The week as a picture: what goes in it and where. No DOM, so it can be tested; ui/shareCanvas.js only paints.
import { DAYS_SHORT, SHARE } from './config.js';
import { addDays, fromKey, weekHijriText, weekRangeText } from './dates.js';
import {
  activeOnDay, checkState, checksOf, dayOn, doneByDay, doneIn, activeDays, elapsedDays, periodOf, startValue,
  summarize, summarySubtitle, summaryTitle, todayIndexIn,
} from './week.js';

const OFF = -1; // a day this habit is not tracked on

const noteText = (start, end) => [start && `بدأت: ${start}`, end && `وصلت: ${end}`].filter(Boolean).join(' · ');

export function buildShareModel({ items, week, prevWeek, weekKey, userName = '', now = new Date() }) {
  const elapsed = elapsedDays(weekKey, now);
  const summary = summarize(items, week, elapsed);
  const counts = doneByDay(items, week);
  const first = fromKey(weekKey);

  const rows = items.map(item => {
    const checks = checksOf(week, item.id);
    const start = item.track ? startValue(week, prevWeek, item.id).value : '';
    const end = item.track ? String((week && week.end[item.id]) || '') : '';
    return {
      name: item.name,
      period: periodOf(item.period),
      cells: checks.map((v, day) => (dayOn(item, day) ? checkState(v) : OFF)),
      done: doneIn(item, checks),
      active: activeDays(item),
      note: noteText(start.trim(), end.trim()),
    };
  });

  const bars = counts.map((count, day) => {
    const tracked = activeOnDay(items, day);
    return {
      label: DAYS_SHORT[day],
      date: addDays(first, day).getDate(),
      count,
      ratio: tracked ? count / tracked : 0,
      show: day < elapsed || count > 0,
    };
  });

  return {
    weekKey,
    userName: String(userName || '').trim(),
    range: weekRangeText(weekKey),
    hijri: weekHijriText(weekKey),
    title: summaryTitle(summary.percent, elapsed),
    subtitle: summarySubtitle(summary, items.length, elapsed),
    percent: summary.percent,
    ratio: summary.ratio,
    done: summary.done,
    total: summary.total,
    elapsed,
    todayIdx: todayIndexIn(weekKey, now),
    best: summary.best ? summary.best.name : '',
    worst: summary.worst ? summary.worst.name : '',
    rows,
    bars,
  };
}

// "+ 3 بنود أخرى" with the Arabic number agreement.
export function moreText(n) {
  if (n === 1) return '+ بند آخر';
  if (n === 2) return '+ بندان آخران';
  return n <= 10 ? `+ ${n} بنود أخرى` : `+ ${n} بندًا آخر`;
}

// How many rows fit in `avail` pixels and how tall each one is. Rows that don't fit collapse into "+ N more".
export function planRows(rows, avail, notes, L = SHARE.LAYOUT, maxRow = L.maxRow.portrait) {
  const noteFor = r => (notes && r.note ? L.noteH : 0);
  const total = rows.length;
  for (let n = total; n >= 1; n--) {
    const shown = rows.slice(0, n);
    const reserved = (n < total ? L.moreH : 0) + shown.reduce((sum, r) => sum + noteFor(r), 0);
    const rowH = Math.min(maxRow, Math.floor((avail - reserved) / n));
    if (rowH >= L.minRow) return { shown, hidden: total - n, rowH };
  }
  return { shown: rows.slice(0, 1), hidden: Math.max(0, total - 1), rowH: L.minRow };
}

export function layoutFor(model, sizeKey, notes) {
  const L = SHARE.LAYOUT, W = SHARE.WIDTH, H = SHARE.SIZES[sizeKey];
  const stats = model.best || model.worst ? L.stat : 0;
  const rhythmH = L.rhythmTitle + L.bars + stats;
  const rowsTop = L.pad + L.head + L.gap + L.summary + L.gap + L.dayHead;
  const avail = H - L.footer - rhythmH - L.gap * 2 - rowsTop;
  const plan = planRows(model.rows, avail, notes, L, L.maxRow[sizeKey]);
  const blocks = plan.shown.map(r => plan.rowH + (notes && r.note ? L.noteH : 0));
  const rowsH = blocks.reduce((a, b) => a + b, 0) + (plan.hidden ? L.moreH : 0);
  const contentH = rowsTop + rowsH + L.gap * 2 + rhythmH + L.footer;
  // Leftover room is split above and below, so a short notebook sits in the middle of the page.
  const offset = Math.max(0, Math.floor((H - contentH) / 2));
  const head = offset + L.pad;
  const summary = head + L.head + L.gap;
  const dayHead = summary + L.summary + L.gap;
  const rowsY = dayHead + L.dayHead;
  const rhythm = rowsY + rowsH + L.gap * 2;
  return {
    W, H, plan, blocks, stats: !!stats,
    y: { head, summary, dayHead, rows: rowsY, rhythm, footer: rhythm + rhythmH + L.footer / 2 },
  };
}

// "auto" takes the portrait picture while it holds every row at a readable size, and the tall one otherwise.
export function chooseSize(model, notes) {
  const { plan } = layoutFor(model, 'portrait', notes);
  return !plan.hidden && plan.rowH >= SHARE.AUTO_MIN_ROW ? 'portrait' : 'story';
}

export const shareFileName = weekKey => `my-week-${weekKey}.png`;

export const shareAlt = model => `${model.range}: ${model.percent}٪ — ${model.title}. ${model.subtitle}`;
