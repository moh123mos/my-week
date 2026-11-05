// "Share the week as a picture": the header button, the preview sheet, and share / save / copy.
import { MESSAGES, SHARE, TIMING } from '../config.js';
import { prevKey } from '../dates.js';
import { $ } from '../dom.js';
import { buildShareModel, chooseSize, shareAlt, shareFileName } from '../share.js';
import { itemsOf, weekOf } from '../store.js';
import { elapsedDays } from '../week.js';
import { say } from './dialogs.js';
import { drawShare, loadShareFonts } from './shareCanvas.js';

const DEFAULT_PREFS = { size: 'auto', notes: true };

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(SHARE.PREFS_KEY));
    const size = saved && (saved.size === 'auto' || saved.size in SHARE.SIZES) ? saved.size : DEFAULT_PREFS.size;
    return { size, notes: saved && typeof saved.notes === 'boolean' ? saved.notes : DEFAULT_PREFS.notes };
  } catch (_) {
    return { ...DEFAULT_PREFS };
  }
}
function savePrefs(prefs) {
  try { localStorage.setItem(SHARE.PREFS_KEY, JSON.stringify(prefs)); } catch (_) { /* private mode: just not remembered */ }
}

// Some browsers (desktop mostly) can't hand files to the system share sheet; the button is left out there.
const canShareFiles = (() => {
  try { return !!navigator.canShare && navigator.canShare({ files: [new File([''], 'a.png', { type: 'image/png' })] }); }
  catch (_) { return false; }
})();
const canCopyImage = !!(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write);

function saveBlob(blob, name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), TIMING.DOWNLOAD_REVOKE_MS);
}

export function createShare({ store }) {
  const dlg = $('#shareDlg'), canvas = $('#shareCanvas'), status = $('#shareStatus');
  const sendBtn = $('#shareSend'), saveBtn = $('#shareSave'), copyBtn = $('#shareCopy');
  const prefs = loadPrefs();
  let token = 0; // a slower, older render must not overwrite a newer one
  let current = null; // { blob, name } of the picture on show

  sendBtn.hidden = !canShareFiles;
  copyBtn.hidden = !canCopyImage;

  function setStatus(message) { status.textContent = message || ''; }
  function setReady(ready) {
    for (const b of [sendBtn, saveBtn, copyBtn]) b.disabled = !ready;
    $('#shareWait').hidden = ready;
  }

  function syncControls(sizeKey) {
    $('#shareNotes').checked = prefs.notes;
    document.querySelectorAll('#shareSizes [data-size]').forEach(b => {
      const on = b.dataset.size === prefs.size;
      b.setAttribute('aria-pressed', on);
      b.textContent = b.dataset.size === 'auto' && on && sizeKey
        ? `${SHARE.SIZE_LABELS.auto} (${SHARE.SIZE_LABELS[sizeKey]})` : SHARE.SIZE_LABELS[b.dataset.size];
    });
  }

  async function render() {
    const mine = ++token;
    current = null;
    setReady(false);
    setStatus('');
    syncControls();
    try {
      const model = buildShareModel({
        items: itemsOf(store),
        week: weekOf(store, store.cur),
        prevWeek: weekOf(store, prevKey(store.cur)),
        weekKey: store.cur,
        userName: store.user && store.user.name,
      });
      await loadShareFonts();
      if (mine !== token) return;
      const sizeKey = prefs.size === 'auto' ? chooseSize(model, prefs.notes) : prefs.size;
      drawShare(canvas, model, sizeKey, prefs.notes);
      canvas.setAttribute('aria-label', shareAlt(model));
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (mine !== token) return;
      if (!blob) throw new Error(MESSAGES.SHARE_FAILED);
      current = { blob, name: shareFileName(store.cur) };
      syncControls(sizeKey);
      setReady(true);
    } catch (err) {
      if (mine !== token) return;
      setStatus(err.message || MESSAGES.SHARE_FAILED);
    }
  }

  async function send() {
    if (!current) return;
    const file = new File([current.blob], current.name, { type: 'image/png' });
    try {
      await navigator.share({ files: [file], title: 'أسبوعي' });
    } catch (err) {
      if (err && err.name === 'AbortError') return; // the person closed the share sheet
      say(MESSAGES.SHARE_FAILED);
    }
  }

  let copiedTimer = 0;
  async function copy() {
    if (!current) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': current.blob })]);
      setStatus('تم نسخ الصورة');
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => setStatus(''), 2500);
    } catch (_) {
      setStatus('تعذّر النسخ، استخدم «حفظ الصورة».');
    }
  }

  function refresh() {
    const btn = $('#shareBtn');
    const has = !!store.user && itemsOf(store).length > 0;
    btn.hidden = !has;
    const future = has && elapsedDays(store.cur) === 0;
    btn.disabled = future;
    btn.title = future ? MESSAGES.SHARE_FUTURE : '';
  }

  function close() {
    token++;
    if (dlg.open) dlg.close();
  }

  $('#shareBtn').onclick = () => {
    dlg.showModal();
    render();
  };
  $('#shareClose').onclick = close;
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
  dlg.addEventListener('close', () => { token++; });
  $('#shareSizes').addEventListener('click', e => {
    const b = e.target.closest('[data-size]');
    if (!b || b.dataset.size === prefs.size) return;
    prefs.size = b.dataset.size;
    savePrefs(prefs);
    render();
  });
  $('#shareNotes').onchange = e => {
    prefs.notes = e.target.checked;
    savePrefs(prefs);
    render();
  };
  sendBtn.onclick = send;
  saveBtn.onclick = () => current && saveBlob(current.blob, current.name);
  copyBtn.onclick = copy;

  return { refresh, close };
}
