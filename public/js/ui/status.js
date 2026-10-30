// The two ways the app reports on saving: the "saved" flash and the warning banner.
import { TIMING } from '../config.js';
import { $ } from '../dom.js';

const BANNERS = {
  saveFailed: 'تعذّر الحفظ على الخادم. سنعيد المحاولة تلقائيًا — لا تغلق الصفحة قبل ظهور «تم الحفظ».',
  limitHit: 'رُفض آخر تعديل لأنه تجاوز الحدود المسموحة.',
  loadFailed: 'تعذّر تحميل هذا الأسبوع، تحقق من الإنترنت وحاول مرة أخرى.',
};
const SAVED_NOTE = 'تم الحفظ';

let savedTimer;
let shownBanner = '';

function hideSaved() {
  clearTimeout(savedTimer);
  $('#saved').classList.remove('on');
  $('#savedNote').textContent = '';
}

export function flashSaved() {
  $('#saved').classList.add('on');
  // The visible flash only fades in, which a screen reader can't notice: the live region's text has to change.
  $('#savedNote').textContent = SAVED_NOTE;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(hideSaved, TIMING.SAVED_FLASH_MS);
}

// Failing to save outranks a rejected edit, which outranks failing to load.
export function renderBanner(status) {
  if (status.saveFailed) hideSaved(); // "saved" from the previous request must not sit next to the failure banner
  const reason = ['saveFailed', 'limitHit', 'loadFailed'].find(k => status[k]);
  const message = reason ? BANNERS[reason] : '';
  if (message === shownBanner) return;
  shownBanner = message;
  $('#banner').innerHTML = message ? `<div class="banner"><i class="ph-bold ph-warning"></i> ${message}</div>` : '';
}
