// What the client currently holds. `state` is a cache of the server's data, never the source of truth.
//
// Every loaded week carries the habit rows it shows (`week.items`) and whether they are its own (`week.own`) or
// borrowed from an earlier week until something is written to it. The rows on screen are those of `store.cur`.
import { todayKey } from './dates.js';
import { emptyWeek } from './week.js';

export const emptyNotebook = () => ({ weeks: {} });

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

const NO_ITEMS = Object.freeze([]);

export const weekOf = (store, k) => store.state.weeks[k] || null;
export const ensureWeek = (store, k) => (store.state.weeks[k] ||= emptyWeek());
// The rows of a week (default: the one on screen), for reading.
export const itemsOf = (store, k = store.cur) => {
  const week = store.state.weeks[k];
  return week && week.items ? week.items : NO_ITEMS;
};
// The same, for editing in place.
export const editableItems = (store, k = store.cur) => (ensureWeek(store, k).items ||= []);

// A brand-new notebook: these weeks show a copy of the starting rows until something is written to them.
export const startNotebook = (store, weekKeys, items) => {
  store.state = emptyNotebook();
  for (const k of weekKeys) store.state.weeks[k] = { ...emptyWeek(), items: structuredClone(items), own: false };
};
