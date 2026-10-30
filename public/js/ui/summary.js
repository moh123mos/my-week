// The growing moon at the top and "the week's rhythm" (seven small moons and the stats) at the bottom.
import { DAYS, TIMING } from '../config.js';
import { $, cls, esc } from '../dom.js';
import { weekOf } from '../store.js';
import { doneByDay, elapsedDays, summarize, todayIndexIn } from '../week.js';

const MOON_RADIUS = 42;
// The lit part of a moon in a 100x100 box: the right limb, then the terminator back up. fraction is 0..1.
const moonPath = fraction => {
  const terminator = (MOON_RADIUS * Math.abs(1 - 2 * fraction)).toFixed(2);
  return `M50 8A${MOON_RADIUS} ${MOON_RADIUS} 0 0 1 50 92A${terminator} ${MOON_RADIUS} 0 0 ${fraction > .5 ? 1 : 0} 50 8Z`;
};
const easeOutQuart = t => 1 - (1 - t) ** 4;

function summaryTitle(percent, elapsed) {
  if (!elapsed) return 'أسبوع قادم';
  if (percent === 100) return 'اكتمل البدر هذا الأسبوع';
  if (percent >= 80) return 'ما شاء الله، أسبوع قوي';
  if (percent >= 50) return 'ماضٍ على الطريق';
  if (percent > 0) return 'كل خطوة تُحسب';
  return 'أسبوع جديد، ابدأ بخطوة صغيرة';
}

function summarySubtitle({ done, total }, itemCount, elapsed) {
  if (!itemCount) return 'دفترك ينتظر أول بند';
  return elapsed ? `أنجزت ${done} من ${total} خانة حتى الآن` : 'سجّل بداياتك مبكرًا لتسهل المقارنة';
}

const statHtml = (label, value, good = false) =>
  `<div class="${cls('stat', good && 'good')}"><span>${label}</span><strong>${value}</strong></div>`;

function statsHtml({ best, worst, trackedCount, endsWritten }) {
  let html = '';
  if (best) html += statHtml('الأقوى', esc(best.name), true);
  if (worst) html += statHtml('يحتاج عناية', esc(worst.name));
  if (trackedCount) html += statHtml('نهايات مكتوبة', `${endsWritten} من ${trackedCount}`);
  return html;
}

const barHtml = (day, isToday) => `<div class="${cls('bar', isToday && 'today')}"><em></em>
  <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="moon-dark" cx="50" cy="50" r="${MOON_RADIUS}"/><path class="moon-lit"/></svg>
  <span>${day}</span></div>`;

export function createSummary(store) {
  let moonFraction = 0, moonFrame = 0;
  let shownStats = '';

  function setMoon(fraction) {
    const el = $('#moonLit');
    cancelAnimationFrame(moonFrame);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      moonFraction = fraction;
      el.setAttribute('d', moonPath(fraction));
      return;
    }
    const from = moonFraction, startedAt = performance.now();
    const step = now => {
      const t = Math.min(1, (now - startedAt) / TIMING.MOON_ANIMATION_MS);
      moonFraction = from + (fraction - from) * easeOutQuart(t);
      el.setAttribute('d', moonPath(moonFraction));
      if (t < 1) moonFrame = requestAnimationFrame(step);
    };
    moonFrame = requestAnimationFrame(step);
  }

  // Refreshes the numbers in place; cheap enough to run on every click and keystroke.
  function update() {
    const week = weekOf(store, store.cur), items = store.state.items;
    const elapsed = elapsedDays(store.cur);
    const summary = summarize(items, week, elapsed);

    setMoon(summary.ratio);
    $('#pct').textContent = summary.percent + '%';
    $('#sumTitle').textContent = summaryTitle(summary.percent, elapsed);
    $('#sumSub').textContent = summarySubtitle(summary, items.length, elapsed);

    const stats = statsHtml(summary);
    if (stats !== shownStats) {
      shownStats = stats;
      $('#stats').innerHTML = stats;
    }

    const counts = doneByDay(items, week);
    document.querySelectorAll('#bars .bar').forEach((bar, day) => {
      const count = counts[day];
      bar.classList.toggle('empty', count === 0);
      bar.querySelector('em').textContent = day >= elapsed && !count ? '' : count;
      bar.querySelector('path').setAttribute('d', moonPath(items.length ? count / items.length : 0));
    });
  }

  // Builds the seven moons for the week on screen.
  function render() {
    const todayIdx = todayIndexIn(store.cur);
    $('#bars').innerHTML = DAYS.map((day, i) => barHtml(day, i === todayIdx)).join('');
    update();
  }

  function clear() {
    $('#stats').innerHTML = '';
    $('#bars').innerHTML = '';
    shownStats = '';
  }

  return { render, update, clear };
}
