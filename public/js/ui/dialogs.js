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

const phone = matchMedia('(max-width: 600px)');
const GRAB_ZONE = 32;      // px from the sheet's top edge that count as the grab handle
const CLOSE_DISTANCE = 100; // px dragged down that closes the sheet
const CLOSE_VELOCITY = 0.5; // px/ms flick that closes it regardless of distance

// Same path as Esc: a dialog that vetoes `cancel` (edit dialog while a request runs) stays open.
function requestClose(dialog) {
  if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close();
}

// Phone bottom sheets: drag the handle or the title bar down to close.
function enableSwipeClose(dialog) {
  let drag = null;

  const reset = () => ['transform', 'transition', 'animation'].forEach(p => dialog.style.removeProperty(p));
  const settleTo = (y, done) => {
    dialog.style.transition = 'transform .2s var(--ease-out)';
    dialog.style.transform = `translateY(${y}px)`;
    dialog.addEventListener('transitionend', done, { once: true });
  };

  dialog.addEventListener('pointerdown', e => {
    if (!phone.matches || !e.isPrimary || e.button > 0 || drag) return;
    if (e.target.closest('button, input, label, a')) return;
    const inHead = e.target.closest('.dlg-head');
    if (!inHead && e.clientY - dialog.getBoundingClientRect().top > GRAB_ZONE) return;
    drag = { id: e.pointerId, y0: e.clientY, dy: 0, t0: e.timeStamp, moved: false };
  });

  dialog.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = Math.max(0, e.clientY - drag.y0);
    if (!drag.moved) {
      if (dy < 4) return;
      drag.moved = true;
      dialog.setPointerCapture(drag.id);
      dialog.style.animation = 'none'; // the open animation's fill would override the inline transform
      dialog.style.transition = 'none';
    }
    drag.dy = dy;
    dialog.style.transform = `translateY(${dy}px)`;
  });

  const end = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const { moved, dy, t0 } = drag;
    drag = null;
    if (!moved) return;
    const flick = dy / Math.max(1, e.timeStamp - t0) > CLOSE_VELOCITY;
    if (e.type === 'pointercancel' || (dy < CLOSE_DISTANCE && !flick)) { settleTo(0, reset); return; }
    settleTo(dialog.offsetHeight, () => {
      requestClose(dialog);
      if (dialog.open) settleTo(0, reset); // vetoed: slide back
    });
  };
  dialog.addEventListener('pointerup', end);
  dialog.addEventListener('pointercancel', end);
  dialog.addEventListener('close', reset);
}

export function initDialogs() {
  document.querySelectorAll('dialog').forEach(enableSwipeClose);
  const el = $('#ask');
  $('#askOk').onclick = () => dismissDialogs(true);
  $('#askNo').onclick = () => dismissDialogs(false);
  el.addEventListener('close', () => dismissDialogs(false));
  el.addEventListener('click', e => { if (e.target === e.currentTarget) dismissDialogs(false); });
}
