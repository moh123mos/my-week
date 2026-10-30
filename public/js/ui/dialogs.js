// In-page confirm() and alert(), so they match the app and can be dismissed when the session ends.
import { $ } from '../dom.js';

let settle = null;

export function dismissDialogs(result = false) {
  const done = settle;
  settle = null;
  const el = $('#ask');
  if (el.open) el.close();
  if (done) done(result);
}

// Resolves false when dismissed: "back", Esc, the backdrop, or the session ending underneath it.
export function ask(message, okLabel, danger = false) {
  dismissDialogs(false);
  $('#askMsg').textContent = message;
  $('#askOk').textContent = okLabel;
  $('#askOk').classList.toggle('danger', danger);
  $('#askNo').hidden = false;
  $('#ask').showModal();
  $('#askNo').focus();
  return new Promise(resolve => { settle = resolve; });
}

export function say(message) {
  const answered = ask(message, 'حسنًا');
  $('#askNo').hidden = true;
  $('#askOk').focus();
  return answered;
}

export function initDialogs() {
  const el = $('#ask');
  $('#askOk').onclick = () => dismissDialogs(true);
  $('#askNo').onclick = () => dismissDialogs(false);
  el.addEventListener('close', () => dismissDialogs(false));
  el.addEventListener('click', e => { if (e.target === e.currentTarget) dismissDialogs(false); });
}
