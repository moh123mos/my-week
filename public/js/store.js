// What the client currently holds. `state` is a cache of the server's data, never the source of truth.
import { todayKey } from './dates.js';
import { emptyWeek } from './week.js';

export const emptyNotebook = () => ({ items: [], weeks: {} });

export const createStore = () => {
  const thisWeek = todayKey();
  return {
    user: null,
    state: emptyNotebook(),
    cur: thisWeek, // the week on screen
    target: thisWeek, // where the last prev/next click is heading, so a quick double click moves two weeks
    navSeq: 0, // bumped by every navigation: a slower, older one must not win
  };
};

export const weekOf = (store, k) => store.state.weeks[k] || null;
export const ensureWeek = (store, k) => (store.state.weeks[k] ||= emptyWeek());
