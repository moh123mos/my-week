// The dashboard's place lives in the URL hash, so a refresh, the back button and a pasted link all land where
// the admin was: #overview, #users, #users?filter=disabled, #users/<id> (an open account), #audit. No DOM.
export const TABS = ['overview', 'users', 'audit'];
export const FILTERS = ['all', 'active', 'disabled', 'admin'];
const ID_RE = /^[0-9a-f]{24}$/i;

// Anything unrecognised is "overview": a stale or hand-edited hash never breaks the page.
export function parseHash(hash) {
  const [path, query = ''] = String(hash || '').replace(/^#/, '').split('?');
  const [tab, id] = path.split('/');
  if (!TABS.includes(tab)) return { tab: 'overview', id: null, filter: null };
  const filter = new URLSearchParams(query).get('filter');
  return {
    tab,
    id: tab === 'users' && ID_RE.test(id || '') ? id : null,
    filter: tab === 'users' && FILTERS.includes(filter) ? filter : null,
  };
}

export function buildHash({ tab = 'overview', id = null, filter = null } = {}) {
  if (tab === 'users' && id) return `#users/${id}`;
  if (tab === 'users' && filter && filter !== 'all') return `#users?filter=${filter}`;
  return `#${TABS.includes(tab) ? tab : 'overview'}`;
}
