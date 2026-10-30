// Getting from "signed in" to a notebook on screen.
import { fetchSession, importNotebook } from './api.js';
import { prevKey, todayKey } from './dates.js';
import { ask, say } from './ui/dialogs.js';
import { defaultItems, isNotebook } from './week.js';

const LEGACY_KEY = 'my-week:v1';
const LEGACY_OFFERED_KEY = 'my-week:legacy-offered';

// Storage can throw (private mode, blocked site data): the app must work without it.
const storage = {
  get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} },
  del: k => { try { localStorage.removeItem(k); } catch (_) {} },
};
function legacyNotebook() {
  try {
    const parsed = JSON.parse(storage.get(LEGACY_KEY));
    return isNotebook(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

export function createSession({ store, sync, onReady }) {
  // One request: who I am + my rows + the given week and the one before it. The screen only ever shows
  // what the server returned (never an object from a file or localStorage), so it is always cleaned data.
  async function load(weekKey) {
    const keys = [weekKey, prevKey(weekKey)];
    const session = await fetchSession(keys);
    sync.adoptSession(keys);
    store.user = session.user;
    store.state = { items: session.items || [], weeks: session.weeks };
    return session;
  }

  // First sign-in: offer, once per device, the notebook that lived here before accounts existed.
  async function uploadLegacyNotebook() {
    const legacy = storage.get(LEGACY_OFFERED_KEY) ? null : legacyNotebook();
    if (!legacy) return false;
    storage.set(LEGACY_OFFERED_KEY, '1');
    if (!await ask('وجدنا بيانات محفوظة على هذا الجهاز. هل ترفعها إلى حسابك؟', 'رفع البيانات')) return false;
    try {
      await importNotebook(legacy);
    } catch (_) {
      await say('تعذّر رفع البيانات القديمة، سنبدأ بدفتر جديد.');
      return false;
    }
    storage.del(LEGACY_KEY);
    return true;
  }

  async function start() {
    const thisWeek = todayKey();
    const session = await load(thisWeek);
    if (!session.items) {
      if (await uploadLegacyNotebook()) {
        await load(thisWeek);
      } else {
        store.state.items = defaultItems();
        sync.markItemsDirty();
      }
    }
    store.cur = store.target = thisWeek;
    sync.setLoadFailed(false);
    document.body.classList.remove('locked', 'booting');
    onReady(true);
  }

  return { load, start };
}
