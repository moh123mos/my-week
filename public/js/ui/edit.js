// The edit dialog: the account line and the list of habit rows of the week on screen.
// Edits belong to that week only; "apply to the coming weeks" copies its rows to the weeks after it.
import { DAYS, DAYS_SHORT, LIMITS, PERIODS } from '../config.js';
import { weekRangeText } from '../dates.js';
import { $, esc } from '../dom.js';
import { editableItems } from '../store.js';
import { allDaysOn, dayOn, newItem, periodOf, toggleAllDays, toggleDay } from '../week.js';
import { ask, say } from './dialogs.js';

const periodOptions = selected => Object.entries(PERIODS)
  .map(([key, name]) => `<option value="${key}" ${key === selected ? 'selected' : ''}>${name}</option>`)
  .join('');

const dayButtons = item => DAYS.map((day, i) => {
  const on = dayOn(item, i);
  return `<button type="button" class="day-chip" data-day="${i}" aria-pressed="${on}" aria-label="${day}">${DAYS_SHORT[i]}</button>`;
}).join('');

// One button above the chips: selects every day, or (when all are on) clears them all but Saturday.
const allLabel = item => (allDaysOn(item)
  ? '<i class="ph-bold ph-x"></i> إلغاء الكل'
  : '<i class="ph-bold ph-checks"></i> تحديد الكل');
const allButton = item => `<button type="button" class="all-days" data-all>${allLabel(item)}</button>`;

const rowHtml = (item, index, count) => `
  <div class="edit-row" data-id="${esc(item.id)}">
    <div class="l1">
      <input type="text" data-k="name" maxlength="${LIMITS.MAX_NAME}" value="${esc(item.name)}" aria-label="اسم البند">
      <select data-k="period" aria-label="الفترة">${periodOptions(periodOf(item.period))}</select>
    </div>
    <div class="days-bar"><span>أيام المتابعة</span>${allButton(item)}</div>
    <div class="days-pick" role="group" aria-label="أيام المتابعة">${dayButtons(item)}</div>
    <label class="tg"><input type="checkbox" data-k="track" ${item.track ? 'checked' : ''}> تتبّع البداية والنهاية</label>
    <div class="acts">
      <button class="sm-btn" data-a="up" ${index === 0 ? 'disabled' : ''} aria-label="أعلى"><i class="ph-bold ph-arrow-up"></i></button>
      <button class="sm-btn" data-a="down" ${index === count - 1 ? 'disabled' : ''} aria-label="أسفل"><i class="ph-bold ph-arrow-down"></i></button>
      <button class="sm-btn danger" data-a="del" aria-label="حذف"><i class="ph-bold ph-trash"></i></button>
    </div>
  </div>`;

export function createEdit({ store, sync, onClosed }) {
  const dialog = $('#dlg'), listEl = $('#editList');
  let busy = false;
  // The week these rows belong to, fixed while the dialog is open (a background refresh must not move it).
  let weekKey = store.cur;

  const items = () => editableItems(store, weekKey);
  const itemById = id => items().find(x => x.id === id);
  const changed = () => sync.markItemsDirty(weekKey);

  function render() {
    const list = items();
    $('#acctName').textContent = store.user ? store.user.name : '';
    $('#acctMail').textContent = store.user ? store.user.email : '';
    $('#adminLink').hidden = !(store.user && store.user.isAdmin);
    $('#scopeNote').textContent = `التعديلات هنا تخص أسبوع ${weekRangeText(weekKey)} فقط، ولا تغيّر الأسابيع السابقة.`;
    listEl.innerHTML = list.map((item, i) => rowHtml(item, i, list.length)).join('');
    const full = list.length >= LIMITS.MAX_ITEMS;
    $('#addItem').disabled = full;
    $('#addHint').hidden = !full;
  }

  function open() {
    weekKey = store.cur;
    render();
    dialog.showModal();
  }

  function addItem() {
    if (items().length >= LIMITS.MAX_ITEMS) return;
    items().push(newItem());
    changed();
    render();
    const name = listEl.lastElementChild.querySelector('input[type=text]');
    name.focus();
    name.select();
  }

  async function runRowAction(action, id) {
    const list = items();
    if (action === 'del') {
      if (!await ask('حذف هذا البند من هذا الأسبوع؟ (بياناته السابقة تبقى محفوظة)', 'حذف البند', true)) return;
      // Look it up again: the list may have changed while the question was open.
      const index = items().findIndex(x => x.id === id);
      if (index < 0) return;
      items().splice(index, 1);
    } else {
      const i = list.findIndex(x => x.id === id), j = action === 'up' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
    }
    changed();
    render();
  }

  // Patch the chips in place so focus stays where it is.
  function showDays(row, item) {
    row.querySelectorAll('[data-day]').forEach(c => c.setAttribute('aria-pressed', dayOn(item, +c.dataset.day)));
    row.querySelector('[data-all]').innerHTML = allLabel(item); // same button, so keyboard focus stays on it
  }

  // Flip one day (the last remaining day can't be switched off), or all of them.
  function pickDay(chip) {
    const item = itemById(chip.closest('.edit-row').dataset.id);
    if (!item) return;
    item.days = 'all' in chip.dataset ? toggleAllDays(item) : toggleDay(item, +chip.dataset.day);
    changed();
    showDays(chip.closest('.edit-row'), item);
  }

  async function applyForward() {
    if (!await ask('ستصبح بنود هذا الأسبوع وأيام تتبّعها هي بنود كل الأسابيع القادمة. بياناتها لا تُمسح. متابعة؟', 'تطبيق')) return;
    const button = $('#applyForward');
    button.disabled = true;
    try {
      await sync.applyForward();
      await say('تم تطبيق بنود هذا الأسبوع على الأسابيع القادمة.');
    } catch (err) {
      await say(err.message);
    } finally {
      button.disabled = false;
    }
  }

  listEl.addEventListener('input', e => {
    const field = e.target.closest('[data-k]');
    if (!field) return;
    const item = itemById(field.closest('.edit-row').dataset.id);
    if (!item) return;
    item[field.dataset.k] = field.type === 'checkbox' ? field.checked : field.value;
    changed();
  });
  listEl.addEventListener('click', e => {
    const chip = e.target.closest('[data-day], [data-all]');
    if (chip) return pickDay(chip);
    const button = e.target.closest('[data-a]');
    if (button) runRowAction(button.dataset.a, button.closest('.edit-row').dataset.id);
  });

  $('#editBtn').onclick = open;
  $('#dlgClose').onclick = () => dialog.close();
  $('#addItem').onclick = addItem;
  $('#applyForward').onclick = applyForward;
  dialog.addEventListener('click', e => { if (e.target === dialog && !busy) dialog.close(); });
  dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  dialog.addEventListener('close', () => { if (store.user) onClosed(); });

  return {
    render,
    open,
    openAndAdd() { open(); addItem(); },
    isOpen: () => dialog.open,
    close() { if (dialog.open) dialog.close(); },
    // While a request replaces the notebook the dialog is frozen: an edit made now would be lost or overwrite it.
    setBusy(value) {
      busy = value;
      dialog.inert = value;
    },
    clear() {
      listEl.innerHTML = '';
      $('#acctName').textContent = '';
      $('#acctMail').textContent = '';
      $('#adminLink').hidden = true;
    },
  };
}
