// The habits x days grid. render() rebuilds the structure (week change / items edit);
// clicks and typing patch the row in place, so nothing flashes and text boxes keep their focus.
import { CHECK_LABELS, DAYS, DAYS_SHORT, LIMITS, PERIODS } from '../config.js';
import { addDays, fromKey, prevKey } from '../dates.js';
import { $, cls, esc } from '../dom.js';
import { ensureWeek, itemsOf, weekOf } from '../store.js';
import {
  activeDays, checkState, checksOf, dayOn, doneIn, elapsedDays, ensureChecks, nextCheck, periodOf, startValue, todayIndexIn,
} from '../week.js';

const CELL_ICONS = '<i class="ph-bold ph-check ck"></i><i class="ph-bold ph-minus x"></i>';
const EMPTY_HTML = `<div class="empty">
  <svg class="logo" aria-hidden="true"><use href="#logo"/></svg>
  <p>دفترك فارغ. أضف أول بند، وليكن شيئًا صغيرًا تفعله كل يوم.</p>
  <button class="btn primary" id="emptyAdd" type="button"><i class="ph-bold ph-plus"></i> أضف أول بند</button>
</div>`;

const cellLabel = (item, day, value) => `${item.name} — ${DAYS[day]}: ${CHECK_LABELS[value]}`;
const notesPreview = (start, end) => {
  if (!start && !end) return 'أين بدأت؟ أين وصلت؟';
  return [start && `بدأت: ${start}`, end && `وصلت: ${end}`].filter(Boolean).join(' · ');
};

function headHtml(weekKey, todayIdx) {
  const first = fromKey(weekKey);
  const days = DAYS.map((day, i) => `<span class="${i === todayIdx ? 'today' : ''}">
    <b class="f">${day}</b><b class="s">${DAYS_SHORT[i]}</b><small>${addDays(first, i).getDate()}</small>
  </span>`).join('');
  return `<div class="h-name">البند</div><div class="dh">${days}</div>
    <div class="h-start">بداية الأسبوع</div><div class="h-end">نهاية الأسبوع</div><div class="h-cnt">العدد</div>`;
}

function cellHtml(item, day, raw, todayIdx, elapsed) {
  // A day this habit isn't tracked on keeps its place (the grid never changes shape) but is faded and can't be pressed.
  if (!dayOn(item, day)) {
    return `<div class="${cls('dc', 'off', day === todayIdx && 'today')}"><span class="cb s0" aria-hidden="true"></span></div>`;
  }
  const value = checkState(raw);
  return `<div class="${cls('dc', day === todayIdx && 'today', day >= elapsed && 'future')}">
    <button class="cb s${value}" data-d="${day}" aria-label="${esc(cellLabel(item, day, value))}">${CELL_ICONS}</button>
  </div>`;
}

// Only tracked habits have notes.
function notesHtml(start, end, open) {
  const inherited = start.inherited ? 'title="مأخوذة من نهاية الأسبوع الماضي"' : '';
  return `<button class="note-tg" type="button" aria-expanded="${open}">
      <i class="ph ph-pencil-simple-line"></i><span>${esc(notesPreview(start.value, end))}</span><i class="ph-bold ph-caret-down"></i>
    </button>
    <label class="fld st"><span>بداية الأسبوع</span>
      <input type="text" data-f="start" maxlength="${LIMITS.MAX_TEXT}" class="${start.inherited ? 'inh' : ''}" value="${esc(start.value)}" placeholder="أين بدأت؟" ${inherited}>
    </label>
    <label class="fld en"><span>نهاية الأسبوع</span>
      <input type="text" data-f="end" maxlength="${LIMITS.MAX_TEXT}" value="${esc(end)}" placeholder="أين وصلت؟">
    </label>`;
}

export function createGrid({ store, sync, summary, onAddFirst }) {
  const rowsEl = $('#rows');
  const openNotes = new Set(); // rows whose start/end fields are unfolded on small screens

  function rowHtml(item, index, view) {
    const { week, prevWeek, todayIdx, elapsed, items } = view;
    const checks = checksOf(week, item.id);
    const period = periodOf(item.period);
    const colour = `--pc:var(--p-${period});--i:${index}`;
    const startsPeriod = !index || periodOf(items[index - 1].period) !== period;
    const open = openNotes.has(item.id);
    const notes = item.track
      ? notesHtml(startValue(week, prevWeek, item.id), (week && week.end[item.id]) || '', open)
      : '';
    return `${startsPeriod ? `<h3 class="period" style="${colour}">${PERIODS[period]}</h3>` : ''}
      <article class="${cls('row', !item.track && 'notrack', open && 'open')}" data-id="${esc(item.id)}" style="${colour}">
        <div class="r-name"><h4>${esc(item.name)}</h4></div>
        <div class="r-days">${checks.map((v, day) => cellHtml(item, day, v, todayIdx, elapsed)).join('')}</div>
        ${notes}
        <div class="r-count"><b>${doneIn(item, checks)}</b> / ${activeDays(item)}</div>
      </article>`;
  }

  function render(animate) {
    const key = store.cur, items = itemsOf(store);
    const view = {
      items,
      week: weekOf(store, key),
      prevWeek: weekOf(store, prevKey(key)),
      todayIdx: todayIndexIn(key),
      elapsed: elapsedDays(key),
    };
    $('#head').innerHTML = headHtml(key, view.todayIdx);
    rowsEl.classList.remove('enter');
    rowsEl.innerHTML = items.length ? items.map((item, i) => rowHtml(item, i, view)).join('') : EMPTY_HTML;
    if (animate) {
      void rowsEl.offsetWidth; // restart the entrance animation
      rowsEl.classList.add('enter');
    }
  }

  function toggleNotes(toggle) {
    const row = toggle.closest('.row'), open = row.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open);
    if (open) openNotes.add(row.dataset.id);
    else openNotes.delete(row.dataset.id);
  }

  function cycleCheck(button) {
    const row = button.closest('.row'), id = row.dataset.id, day = +button.dataset.d;
    const item = itemsOf(store).find(x => x.id === id);
    if (!item || !dayOn(item, day)) return;
    const checks = ensureChecks(ensureWeek(store, store.cur), id);
    checks[day] = nextCheck(checks[day]);
    sync.markDirty(store.cur, 'checks', id);
    button.className = 'cb s' + checks[day];
    button.setAttribute('aria-label', cellLabel(item, day, checks[day]));
    row.querySelector('.r-count b').textContent = doneIn(item, checks);
    summary.update();
  }

  function editNote(input) {
    const row = input.closest('.row'), id = row.dataset.id;
    ensureWeek(store, store.cur)[input.dataset.f][id] = input.value;
    input.classList.remove('inh');
    row.querySelector('.note-tg span').textContent =
      notesPreview(row.querySelector('[data-f=start]').value, row.querySelector('[data-f=end]').value);
    sync.markDirty(store.cur, input.dataset.f, id);
    summary.update();
  }

  rowsEl.addEventListener('click', e => {
    if (e.target.closest('#emptyAdd')) return onAddFirst();
    const toggle = e.target.closest('.note-tg');
    if (toggle) return toggleNotes(toggle);
    const button = e.target.closest('button.cb');
    if (button) cycleCheck(button);
  });
  rowsEl.addEventListener('input', e => {
    const input = e.target.closest('input[data-f]');
    if (input) editNote(input);
  });

  function clear() {
    $('#head').innerHTML = '';
    rowsEl.innerHTML = '';
    openNotes.clear();
  }

  return { render, clear };
}
