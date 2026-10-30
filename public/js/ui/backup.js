// The notebook as a whole: export to a file, import from one, erase.
import { deleteNotebook, exportNotebook, importNotebook } from '../api.js';
import { MESSAGES, TIMING } from '../config.js';
import { keyOf, prevKey } from '../dates.js';
import { $ } from '../dom.js';
import { defaultItems, isNotebook } from '../week.js';
import { ask, say } from './dialogs.js';

function download(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `my-week-${keyOf(new Date())}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), TIMING.DOWNLOAD_REVOKE_MS);
}

async function readNotebookFile(file) {
  try {
    const parsed = JSON.parse(await file.text());
    return isNotebook(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

export function createBackup({ store, sync, edit, session, onReplaced }) {
  // Runs the work that replaces the notebook, with saving paused and the dialog frozen until it is all done.
  async function replacing(button, work) {
    edit.setBusy(true);
    try {
      await sync.whilePaused(work);
    } finally {
      edit.setBusy(false);
      button.focus(); // freezing the dialog dropped the focus
    }
  }

  // The server holds every week; the browser only has the ones it has opened, so a backup is fetched.
  async function exportFile() {
    try {
      await sync.flush();
      if (sync.hasDirty()) throw new Error('تعذّر حفظ آخر تعديلاتك قبل التصدير، حاول مرة أخرى.');
      download(await exportNotebook());
    } catch (err) {
      say(err.message);
    }
  }

  async function importFile(file) {
    const notebook = await readNotebookFile(file);
    if (!notebook) return say(MESSAGES.BAD_FILE);
    if (!await ask('سيُستبدل دفترك الحالي بالنسخة المستوردة. متابعة؟', 'استبدال الدفتر', true)) return;
    let reloaded = true;
    try {
      await replacing($('#importBtn'), async () => {
        await importNotebook(notebook);
        sync.discardPending();
        // show what the server kept after cleaning it, not the raw file
        await session.load(store.cur).catch(() => { reloaded = false; });
      });
    } catch (err) {
      return say(err.status === 400 ? MESSAGES.BAD_FILE : err.message);
    }
    if (!reloaded) return say('تم الاستيراد لكن تعذّر تحديث الشاشة. أعد تحميل الصفحة.');
    edit.render();
    onReplaced();
  }

  async function erase() {
    if (!await ask('سيتم مسح كل البيانات نهائيًا. هل أنت متأكد؟', 'مسح نهائيًا', true)) return;
    try {
      await replacing($('#resetBtn'), async () => {
        await deleteNotebook();
        sync.discardPending();
      });
    } catch (err) {
      return say(err.message);
    }
    store.state = { items: defaultItems(), weeks: {} };
    sync.setLoaded([store.cur, prevKey(store.cur)]);
    sync.markItemsDirty();
    edit.render();
    onReplaced();
  }

  $('#exportBtn').onclick = exportFile;
  $('#importBtn').onclick = () => $('#importFile').click();
  $('#resetBtn').onclick = erase;
  $('#importFile').onchange = e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) importFile(file);
  };
}
