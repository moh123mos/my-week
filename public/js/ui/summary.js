// The growing moon at the top and "the week's rhythm" (seven small moons and the stats) at the bottom.
import { DAYS, TIMING } from '../config.js';
import { $, cls, esc } from '../dom.js';
import { MOON_RADIUS, moonPath } from '../moon.js';
import { itemsOf, weekOf } from '../store.js';
import { activeOnDay, doneByDay, elapsedDays, summarize, summarySubtitle, summaryTitle, todayIndexIn } from '../week.js';

const easeOutQuart = t => 1 - (1 - t) ** 4;

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
    const week = weekOf(store, store.cur), items = itemsOf(store);
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
      const tracked = activeOnDay(items, day);
      bar.querySelector('path').setAttribute('d', moonPath(tracked ? count / tracked : 0));
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
