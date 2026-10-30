// The week header: the dates on show and moving between weeks. Weeks are fetched on demand.
import { addDays, fromKey, prevKey, shiftWeek, todayKey } from '../dates.js';
import { $ } from '../dom.js';

const rangeFormat = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'long' });
const hijriFormat = (() => {
  // Not every browser ships this calendar; the Hijri line is simply left out then.
  try { return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { month: 'long', year: 'numeric' }); }
  catch (_) { return null; }
})();

export function createNav({ store, sync, onShow, onExpired }) {
  function renderHeader() {
    const first = fromKey(store.cur);
    $('#range').textContent = `${rangeFormat.format(first)} – ${rangeFormat.format(addDays(first, 6))}`;
    $('#hijri').textContent = hijriFormat ? hijriFormat.format(first) : '';
    $('#todayBtn').hidden = store.cur === todayKey();
  }

  // A click while a fetch is in flight supersedes it.
  async function goTo(key) {
    const seq = ++store.navSeq, epoch = sync.epoch();
    store.target = key;
    let error;
    try {
      await sync.loadWeeks([key, prevKey(key)]);
    } catch (e) {
      error = e;
    }
    const latest = seq === store.navSeq;
    // The account changed while the request was out: its answer (even a 401) is not about this session.
    if (epoch !== sync.epoch()) {
      if (latest) store.target = store.cur;
      return;
    }
    if (error) {
      if (error.status === 401) return onExpired();
      if (latest) {
        store.target = store.cur;
        sync.setLoadFailed(true);
      }
      return;
    }
    if (!latest) return;
    sync.setLoadFailed(false);
    store.cur = key;
    onShow(true);
  }

  function step(direction) {
    const key = shiftWeek(store.target, direction);
    goTo(key);
    // warm the next week in the same direction so the following click is instant
    const ahead = shiftWeek(key, direction);
    sync.loadWeeks([ahead, prevKey(ahead)]).catch(() => {});
  }

  $('#prevBtn').onclick = () => step(-1);
  $('#nextBtn').onclick = () => step(1);
  $('#todayBtn').onclick = () => goTo(todayKey());

  return { renderHeader, goTo };
}
