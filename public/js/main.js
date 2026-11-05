// Connects the parts. The hooks below run later, once every part exists.
import { takeAuthNotice } from './api.js';
import { MESSAGES, TIMING } from './config.js';
import { fromKey, keyOf, todayKey, weekKeyOf } from './dates.js';
import { createSession } from './session.js';
import { createStore } from './store.js';
import { createSync } from './sync.js';
import { createAuth } from './ui/auth.js';
import { createBackup } from './ui/backup.js';
import { createBoot } from './ui/boot.js';
import { initDialogs } from './ui/dialogs.js';
import { createEdit } from './ui/edit.js';
import { createGrid } from './ui/grid.js';
import { createNav } from './ui/nav.js';
import { createShare } from './ui/share.js';
import { flashSaved, renderBanner } from './ui/status.js';
import { createSummary } from './ui/summary.js';

initDialogs();

const expire = () => auth.lock(takeAuthNotice() || MESSAGES.SESSION_EXPIRED);
const store = createStore();
const sync = createSync(store, {
  onSaved: flashSaved,
  onStatus: renderBanner,
  onExpired: expire,
  onRemoteChange: () => renderWeek(false),
  isEditingItems: () => edit.isOpen(),
});

const summary = createSummary(store);
const edit = createEdit({ store, sync, onClosed: () => renderWeek(false) });
const grid = createGrid({ store, sync, summary, onAddFirst: () => edit.openAndAdd() });
const share = createShare({ store });
const nav = createNav({ store, sync, onShow: renderWeek, onExpired: expire });
const session = createSession({ store, sync, onReady: renderWeek });
const auth = createAuth({
  store,
  sync,
  session,
  onLocked() {
    grid.clear();
    summary.clear();
    edit.clear();
    edit.close();
    share.close();
    share.refresh();
  },
});
createBackup({ store, sync, edit, session, onReplaced: () => renderWeek(false) });

function renderWeek(animate) {
  nav.renderHeader();
  grid.render(animate);
  summary.render();
  share.refresh();
}

// The app can stay open for days on a phone. When the date changes, "today" moves;
// someone who was looking at the current week follows it into the new one.
let lastDay = keyOf(new Date());
function followClock() {
  const day = keyOf(new Date());
  if (day === lastDay) return;
  const wasThisWeek = store.cur === weekKeyOf(fromKey(lastDay));
  lastDay = day;
  if (!store.user) return;
  if (wasThisWeek && store.cur !== todayKey()) nav.goTo(todayKey());
  else renderWeek(false);
}
setInterval(followClock, TIMING.CLOCK_TICK_MS);

addEventListener('pagehide', sync.pushOnHide);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') return sync.pushOnHide();
  followClock();
  sync.resync();
});

createBoot({ store, session, lock: auth.lock })();
