// "السجل": what admins did, newest first. Also used for the per-account history inside the user sheet.
import { adminAudit } from '../api.js';
import { $, esc } from '../dom.js';
import { ACTION_LABELS, actionLabel, ago, dateTimeText } from './format.js';
import { buildHash } from './route.js';

const mail = e => `<span class="em">${esc(e || '—')}</span>`;

function detail(entry) {
  const m = entry.meta;
  if (!m) return '';
  if (m.from !== undefined && m.to !== undefined) return ` — من «${esc(m.from)}» إلى «${esc(m.to)}»`;
  if (typeof m.weeks === 'number') return ` — وحذف ${m.weeks} أسبوعًا من بياناته`;
  return '';
}

// One entry. `showTarget` is off inside an account's own history (the account is already on screen). The target
// is a link to that account, except after it was deleted.
export function entryHtml(e, { showTarget = true } = {}) {
  let target = '';
  if (showTarget && e.target) {
    const who = `${mail(e.target.email)}${e.target.name ? ` (${esc(e.target.name)})` : ''}`;
    target = ` · ${e.action === 'user.delete' ? who : `<a class="inline-link" href="${buildHash({ tab: 'users', id: e.target.id })}">${who}</a>`}`;
  }
  return `<div><b>${esc(actionLabel(e.action))}</b>${detail(e)}${target}
    <small>بواسطة ${mail(e.actor.email)} · <span title="${esc(dateTimeText(e.at))}">${esc(ago(e.at))}</span></small></div>`;
}

export function createAudit({ fail }) {
  const list = $('#auditList'), more = $('#auditMore'), err = $('#auditErr'), filter = $('#auditAction');
  let page = 1;

  filter.innerHTML = '<option value="">كل الإجراءات</option>'
    + Object.entries(ACTION_LABELS).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');

  async function fetchPage(reset) {
    err.hidden = true;
    if (reset) page = 1;
    list.setAttribute('aria-busy', 'true');
    try {
      const r = await adminAudit({ page, action: filter.value });
      const html = r.entries.map(e => entryHtml(e)).join('');
      if (reset) {
        list.innerHTML = html ? `<div class="log">${html}</div>`
          : `<p class="empty-note">${filter.value ? 'لا توجد إجراءات من هذا النوع.' : 'لا توجد إجراءات بعد.'}</p>`;
      } else list.firstElementChild.insertAdjacentHTML('beforeend', html);
      more.hidden = page * r.size >= r.total;
      page++;
    } catch (e) {
      if (!fail(e)) {
        err.textContent = e.message;
        err.hidden = false;
      }
    } finally {
      list.removeAttribute('aria-busy');
    }
  }

  filter.onchange = () => fetchPage(true);
  more.onclick = async () => {
    more.disabled = true;
    await fetchPage(false);
    more.disabled = false;
  };

  return { load: () => fetchPage(true) };
}
