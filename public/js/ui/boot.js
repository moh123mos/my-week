// The first moments after opening the page. The login form is shown only when the server says "not signed in"
// (401). While the answer is on its way the page shows a placeholder; if the server can't be reached it says so
// and offers a retry instead of the form.
import { isPermanent } from '../api.js';
import { TIMING } from '../config.js';
import { $ } from '../dom.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function showBootView(failure) {
  $('#bootSkel').hidden = !!failure;
  $('#bootFail').hidden = !failure;
  $('#bootMsg').textContent = failure || '';
  $('#bootLabel').textContent = failure ? '' : 'جارٍ التحميل…';
  if (failure) $('#bootRetry').focus();
}

export function createBoot({ store, session, lock }) {
  let running = false;

  async function boot() {
    if (running) return;
    running = true;
    showBootView('');
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          return await session.start();
        } catch (e) {
          // Permanent answers (401, other 4xx) and failures after the session loaded go to the form as before.
          if (isPermanent(e) || store.user) return lock(e.status === 401 && e.code !== 'disabled' ? '' : e.message);
          if (attempt >= TIMING.BOOT_RETRY_MS.length) return showBootView(e.message);
          await sleep(TIMING.BOOT_RETRY_MS[attempt]);
        }
      }
    } finally {
      running = false;
    }
  }

  $('#bootRetry').onclick = boot;
  // Back online while the failure panel is up: try again without making the user press anything.
  addEventListener('online', () => {
    if (document.body.classList.contains('booting') && !$('#bootFail').hidden) boot();
  });

  return boot;
}
