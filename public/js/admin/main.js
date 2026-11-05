// Admin dashboard entry. The page is only an interface: every route checks the admin role again on the server.
import { adminStats, fetchSession } from '../api.js';
import { $, esc } from '../dom.js';
import { initDialogs } from '../ui/dialogs.js';
import { createAudit } from './audit.js';
import { ago } from './format.js';
import { createOverview } from './overview.js';
import { buildHash, parseHash } from './route.js';
import { createUsers } from './users.js';

initDialogs();

const UPDATED_TICK_MS = 30000;

function showGate(title, message, retry) {
  $('#app').hidden = true;
  $('#gate').hidden = false;
  $('#gateTitle').textContent = title;
  $('#gateMsg').textContent = message;
  $('#gateRetry').hidden = !retry;
  document.querySelector('dialog[open]')?.close();
}

// Any admin call that fails with 401 / 403 (the session ended, or the role was taken away while the page was
// open) sends the admin to the gate instead of leaving a half-working page. Returns true when it handled the error.
function fail(e) {
  if (e.status === 401) showGate('انتهت الجلسة', 'افتح التطبيق وسجّل الدخول بحساب الأدمن، ثم ارجع إلى هنا.');
  else if (e.status === 403) showGate('غير مصرّح', 'لم تعد تملك صلاحية الأدمن.');
  else return false;
  return true;
}

async function start() {
  let me;
  try {
    me = (await fetchSession([])).user;
  } catch (e) {
    if (e.status === 401) return showGate('سجّل الدخول أولًا', 'افتح التطبيق وسجّل الدخول بحساب الأدمن، ثم ارجع إلى هنا.');
    return showGate('تعذّر الاتصال', e.message, true);
  }
  if (!me.isAdmin) return showGate('غير مصرّح', 'هذه الصفحة لمديري التطبيق فقط.');

  $('#gate').hidden = true;
  $('#app').hidden = false;
  $('#who').innerHTML = `<span dir="ltr">${esc(me.email)}</span>`;

  // A change to an account makes the other tabs stale; they reload the next time they are opened.
  const stale = new Set();
  const overview = createOverview({ load: adminStats, fail });
  const audit = createAudit({ fail, openUser: id => go({ tab: 'users', id }) });
  const users = createUsers({
    me,
    fail,
    onChanged: () => { stale.add('overview'); stale.add('audit'); },
    openAudit: () => go({ tab: 'audit' }),
    onSheetClosed: () => { if (parseHash(location.hash).id) go({ tab: 'users' }); },
  });
  const tabs = { overview, users, audit };
  const loaded = new Set();
  let current = null, updatedAt = null;

  const markUpdated = () => { updatedAt = Date.now(); renderUpdated(); };
  const renderUpdated = () => { $('#updated').textContent = updatedAt ? `آخر تحديث: ${ago(new Date(updatedAt).toISOString())}` : ''; };
  setInterval(renderUpdated, UPDATED_TICK_MS);

  // Runs a tab's load with the refresh button showing progress.
  async function load(name) {
    const btn = $('#refresh');
    btn.disabled = true;
    btn.classList.add('spin');
    try {
      await tabs[name].load();
      markUpdated();
    } finally {
      btn.disabled = false;
      btn.classList.remove('spin');
    }
  }

  function go(route) {
    const hash = buildHash(route);
    if (location.hash === hash) return apply(parseHash(hash));
    location.hash = hash; // fires hashchange, which applies it (and makes the back button work)
  }

  async function apply(route) {
    const name = route.tab;
    const changed = name !== current;
    current = name;
    for (const btn of document.querySelectorAll('[data-tab]')) {
      const on = btn.dataset.tab === name;
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      $(`#panel-${btn.dataset.tab}`).hidden = !on;
    }
    if (name === 'users') {
      if (route.filter) users.setFilter(route.filter);
      if (route.id) users.open(route.id); else users.closeSheet();
    } else users.closeSheet();
    if (!loaded.has(name) || stale.has(name) || (name === 'users' && route.filter)) {
      loaded.add(name);
      stale.delete(name);
      await load(name);
    } else if (changed) renderUpdated();
  }

  const tablist = document.querySelector('.tabs');
  tablist.addEventListener('click', e => {
    const btn = e.target.closest('[data-tab]');
    if (btn) go({ tab: btn.dataset.tab });
  });
  // Arrow keys move between tabs (RTL: the right arrow is "previous").
  tablist.addEventListener('keydown', e => {
    const names = Object.keys(tabs);
    const step = { ArrowRight: -1, ArrowLeft: 1 }[e.key];
    if (!step) return;
    const next = names[(names.indexOf(current) + step + names.length) % names.length];
    go({ tab: next });
    $(`#tab-${next}`).focus();
    e.preventDefault();
  });
  // Links inside the page (e.g. "موقوفون" on the overview) are plain #hashes.
  addEventListener('hashchange', () => apply(parseHash(location.hash)));

  $('#refresh').onclick = () => load(current);

  await apply(parseHash(location.hash));
}

$('#gateRetry').onclick = start;
start();
