// The edit dialog: the account line and the list of habit rows.
import { LIMITS, PERIODS } from '../config.js';
import { $, esc } from '../dom.js';
import { newItem, periodOf } from '../week.js';
import { ask } from './dialogs.js';

const periodOptions = selected => Object.entries(PERIODS)
  .map(([key, name]) => `<option value="${key}" ${key === selected ? 'selected' : ''}>${name}</option>`)
  .join('');

const rowHtml = (item, index, count) => `
  <div class="edit-row" data-id="${esc(item.id)}">
    <div class="l1">
      <input type="text" data-k="name" maxlength="${LIMITS.MAX_NAME}" value="${esc(item.name)}" aria-label="اسم البند">
      <select data-k="period" aria-label="الفترة">${periodOptions(periodOf(item.period))}</select>
    </div>
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

  const itemById = id => store.state.items.find(x => x.id === id);

  function render() {
    const items = store.state.items;
    $('#acctName').textContent = store.user ? store.user.name : '';
    $('#acctMail').textContent = store.user ? store.user.email : '';
    listEl.innerHTML = items.map((item, i) => rowHtml(item, i, items.length)).join('');
    const full = items.length >= LIMITS.MAX_ITEMS;
    $('#addItem').disabled = full;
    $('#addHint').hidden = !full;
  }

  function open() {
    render();
    dialog.showModal();
  }

  function addItem() {
    if (store.state.items.length >= LIMITS.MAX_ITEMS) return;
    store.state.items.push(newItem());
    sync.markItemsDirty();
    render();
    const name = listEl.lastElementChild.querySelector('input[type=text]');
    name.focus();
    name.select();
  }

  async function runRowAction(action, id) {
    const items = store.state.items;
    if (action === 'del') {
      if (!await ask('حذف هذا البند من الشبكة؟ (بياناته السابقة تبقى محفوظة)', 'حذف البند', true)) return;
      // Look it up again: the list may have changed while the question was open.
      const index = store.state.items.findIndex(x => x.id === id);
      if (index < 0) return;
      store.state.items.splice(index, 1);
    } else {
      const i = items.findIndex(x => x.id === id), j = action === 'up' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= items.length) return;
      [items[i], items[j]] = [items[j], items[i]];
    }
    sync.markItemsDirty();
    render();
  }

  listEl.addEventListener('input', e => {
    const field = e.target.closest('[data-k]');
    if (!field) return;
    const item = itemById(field.closest('.edit-row').dataset.id);
    if (!item) return;
    item[field.dataset.k] = field.type === 'checkbox' ? field.checked : field.value;
    sync.markItemsDirty();
  });
  listEl.addEventListener('click', e => {
    const button = e.target.closest('[data-a]');
    if (button) runRowAction(button.dataset.a, button.closest('.edit-row').dataset.id);
  });

  $('#editBtn').onclick = open;
  $('#dlgClose').onclick = () => dialog.close();
  $('#addItem').onclick = addItem;
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
    },
  };
}
