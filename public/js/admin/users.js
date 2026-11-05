// "المستخدمون": search / filter / page through accounts, and manage one in a bottom sheet.
import {
  adminAudit, adminDeleteUser, adminResetPassword, adminRevokeSessions, adminUpdateUser, adminUser, adminUsers,
} from '../api.js';
import { LIMITS } from '../config.js';
import { $, esc } from '../dom.js';
import { ask } from '../ui/dialogs.js';
import { entryHtml } from './audit.js';
import { ago, barHeights, dateText, dateTimeText, monthDay, num, percent } from './format.js';
import { buildHash } from './route.js';

const SEARCH_DEBOUNCE_MS = 300;
const HISTORY_SIZE = 10;

const badges = u => (u.role === 'admin' ? '<span class="badge admin">أدمن</span>' : '') + (u.disabled ? '<span class="badge off">موقوف</span>' : '');

export function createUsers({ me, fail, onChanged, openAudit, onSheetClosed }) {
  const listEl = $('#userList'), err = $('#usersErr'), countEl = $('#usersCount');
  const dlg = $('#userDlg'), body = $('#userDlgBody');
  const query = { q: '', page: 1, filter: 'all', sort: 'newest' };
  let seq = 0, openId = null;
  // Which <details> sections the admin has open, kept across the re-renders that follow every action.
  const openSections = new Set(['usage']);

  // ---------- list ----------
  function rowHtml(u) {
    return `<button type="button" class="u-row" data-id="${esc(u.id)}">
      <span class="u-name"><span>${esc(u.name)}</span>${badges(u)}</span>
      <i class="ph ph-caret-left" aria-hidden="true"></i>
      <span class="u-mail" dir="ltr">${esc(u.email)}</span>
      <span class="u-meta">سجّل ${esc(ago(u.createdAt))} · آخر نشاط: ${esc(ago(u.lastActive))} · ${num(u.weeks)} أسبوع · ${num(u.habits)} بند</span>
    </button>`;
  }

  function emptyText() {
    if (query.q) return `لا يوجد مستخدم يطابق «${esc(query.q)}».`;
    return { disabled: 'لا يوجد حسابات موقوفة.', admin: 'لا يوجد أدمن.', active: 'لا يوجد حسابات نشطة.' }[query.filter] || 'لا يوجد مستخدمون بعد.';
  }

  async function load() {
    const mine = ++seq;
    err.hidden = true;
    listEl.setAttribute('aria-busy', 'true');
    listEl.classList.add('loading');
    try {
      const r = await adminUsers(query);
      if (mine !== seq) return; // a newer search is already on its way
      listEl.innerHTML = r.users.length ? r.users.map(rowHtml).join('') : `<p class="empty-note">${emptyText()}</p>`;
      countEl.textContent = `${num(r.total)} مستخدم`;
      const pages = Math.max(1, Math.ceil(r.total / r.size));
      $('#userPager').hidden = pages <= 1;
      $('#userPage').textContent = `صفحة ${num(r.page)} من ${num(pages)}`;
      $('#userPrev').disabled = r.page <= 1;
      $('#userNext').disabled = r.page >= pages;
    } catch (e) {
      if (mine !== seq || fail(e)) return;
      err.textContent = e.message;
      err.hidden = false;
    } finally {
      if (mine === seq) {
        listEl.classList.remove('loading');
        listEl.removeAttribute('aria-busy');
      }
    }
  }

  function setFilter(filter) {
    query.filter = filter;
    query.page = 1;
    for (const b of $('#userFilters').children) b.setAttribute('aria-pressed', String(b.dataset.filter === filter));
  }

  let timer;
  $('#userSearch').addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { query.q = e.target.value.trim(); query.page = 1; load(); }, SEARCH_DEBOUNCE_MS);
  });
  $('#userFilters').addEventListener('click', e => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    setFilter(btn.dataset.filter);
    // Keep the address in step with what is on screen, without adding a history entry per chip.
    history.replaceState(null, '', buildHash({ tab: 'users', filter: query.filter }));
    load();
  });
  $('#userSort').onchange = e => { query.sort = e.target.value; query.page = 1; load(); };
  $('#userPrev').onclick = () => { query.page--; load(); };
  $('#userNext').onclick = () => { query.page++; load(); };
  listEl.addEventListener('click', e => {
    const row = e.target.closest('[data-id]');
    if (row) location.hash = buildHash({ tab: 'users', id: row.dataset.id });
  });

  // ---------- one account ----------
  // Feedback appears where the admin is looking: by the buttons at the top, or under the edit form.
  let statusAt = '#dStatus';
  const setStatus = (msg, bad = false) => {
    const el = $(statusAt);
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('bad', bad);
  };

  const section = (key, title, inner, extra = '') =>
    `<details class="d-sec" data-key="${key}"${openSections.has(key) ? ' open' : ''}${extra}><summary>${title}</summary><div class="d-sec-body">${inner}</div></details>`;

  function usageHtml(usage) {
    const heights = barHeights(usage.recent.map(r => r.rate ?? 0));
    const weeks = usage.recent.map((r, i) => `<div>
      <em>${percent(r.rate)}</em>
      <div class="track" role="img" aria-label="${esc(monthDay(r.week))}: ${percent(r.rate)}"><i${r.rate ? '' : ' class="zero"'} style="--h:${heights[i].toFixed(3)}"></i></div>
      <span>${esc(monthDay(r.week))}</span>
    </div>`).join('');
    return `<div class="d-info">
        <div><span>البنود</span><strong>${num(usage.habits)}</strong></div>
        <div><span>أسابيع مكتوبة</span><strong>${num(usage.weeks)}</strong></div>
        <div><span>آخر نشاط</span><strong>${esc(ago(usage.lastActive))}</strong></div>
      </div>
      <h4>نسبة الإنجاز في آخر ٦ أسابيع</h4>
      <div class="weekcols">${weeks}</div>
      <p class="d-note">أرقام فقط: لا يرى الأدمن أسماء البنود ولا ما كتبه المستخدم.</p>`;
  }

  function actionsHtml(u) {
    const self = u.id === me.id, admin = u.role === 'admin';
    const lock = (self || admin) ? ' disabled' : '';
    const why = self ? 'هذا حسابك: لا يمكنك إيقافه أو خفض صلاحياتك أو حذفه من هنا.'
      : admin ? 'هذا الحساب أدمن: اخفض صلاحياته أولًا لتتمكن من إيقافه أو حذفه أو تغيير كلمة مروره.' : '';
    return `${why ? `<p class="d-note">${esc(why)}</p>` : ''}
      <div class="btn-row">
        ${u.disabled
          ? '<button class="btn primary" type="button" data-act="enable"><i class="ph-bold ph-play"></i> إعادة تفعيل الحساب</button>'
          : `<button class="btn" type="button" data-act="disable"${lock}><i class="ph ph-pause"></i> إيقاف الحساب</button>`}
        ${admin
          ? `<button class="btn" type="button" data-act="demote"${self ? ' disabled' : ''}><i class="ph ph-shield-slash"></i> خفض إلى مستخدم</button>`
          : '<button class="btn" type="button" data-act="promote"><i class="ph ph-shield-check"></i> ترقية إلى أدمن</button>'}
        <button class="btn" type="button" data-act="reset"${admin ? ' disabled' : ''}><i class="ph ph-key"></i> إعادة تعيين كلمة المرور</button>
        <button class="btn" type="button" data-act="revoke"><i class="ph ph-sign-out"></i> إنهاء كل الجلسات</button>
      </div>
      <div id="dSecret" hidden></div>
      <p class="d-status" id="dStatus" role="status"></p>`;
  }

  const editHtml = u => `<form class="d-form" id="dEdit" novalidate>
      <label class="af"><span>الاسم</span><input name="name" type="text" autocomplete="off" maxlength="${LIMITS.MAX_USER_NAME}" value="${esc(u.name)}" required></label>
      <label class="af"><span>الإيميل</span><input name="email" type="email" dir="ltr" autocomplete="off" maxlength="${LIMITS.MAX_EMAIL}" value="${esc(u.email)}" required></label>
      <button class="btn" type="submit"><i class="ph ph-floppy-disk"></i> حفظ</button>
      <p class="d-status" id="dEditStatus" role="status"></p>
    </form>`;

  const dangerHtml = (u, lock) => `<p class="d-note">يُحذف الحساب وكل أسابيعه وبنوده نهائيًا ولا يمكن التراجع.</p>
    <button class="btn danger" type="button" data-act="delete"${lock}><i class="ph ph-trash"></i> حذف الحساب وبياناته</button>`;

  async function open(id) {
    if (openId === id && dlg.open) return;
    openId = id;
    $('#userDlgTitle').textContent = '…';
    body.innerHTML = '<div class="skel" aria-hidden="true"><i></i><i></i><i class="skel-chart"></i></div><span class="sr-only" role="status">جارٍ التحميل…</span>';
    if (!dlg.open) dlg.showModal();
    await render(id);
  }

  async function render(id) {
    let r;
    try {
      r = await adminUser(id);
    } catch (e) {
      if (id !== openId || fail(e)) return;
      $('#userDlgTitle').textContent = 'تعذّر فتح الحساب';
      body.innerHTML = `<p class="a-error" role="alert">${esc(e.status === 404 ? 'هذا الحساب غير موجود، ربما حُذف.' : e.message)}</p>`;
      return;
    }
    if (id !== openId) return;
    const u = r.user, lock = (u.id === me.id || u.role === 'admin') ? ' disabled' : '';
    $('#userDlgTitle').innerHTML = `<span>${esc(u.name)}</span> ${badges(u)}`;
    body.innerHTML = `
      <div class="d-info">
        <div><span>الإيميل</span><strong dir="ltr">${esc(u.email)}</strong></div>
        <div><span>تاريخ التسجيل</span><strong>${esc(dateText(u.createdAt))}</strong></div>
        <div><span>آخر دخول</span><strong title="${esc(u.lastLoginAt ? dateTimeText(u.lastLoginAt) : '')}">${esc(ago(u.lastLoginAt))}</strong></div>
      </div>
      <h4>الحالة والأمان</h4>
      ${actionsHtml(u)}
      ${section('usage', 'الاستخدام', usageHtml(r.usage))}
      ${section('edit', 'تعديل الاسم والإيميل', editHtml(u))}
      ${section('history', 'سجل هذا الحساب', '<p class="d-note">جارٍ التحميل…</p>')}
      ${section('danger', 'منطقة الخطر', dangerHtml(u, lock))}`;
    body.dataset.id = u.id;
    body.dataset.name = u.name;
    if (openSections.has('history')) loadHistory(id);
  }

  async function loadHistory(id) {
    const box = body.querySelector('[data-key=history] .d-sec-body');
    if (!box) return;
    try {
      const r = await adminAudit({ user: id, size: HISTORY_SIZE });
      if (id !== openId || !box.isConnected) return;
      box.innerHTML = r.entries.length
        ? `<div class="log">${r.entries.map(e => entryHtml(e, { showTarget: false })).join('')}</div>
           ${r.total > r.entries.length ? `<button class="link-btn" type="button" data-act="allAudit">عرض كل السجل (${num(r.total)})</button>` : ''}`
        : '<p class="d-note">لا توجد إجراءات على هذا الحساب بعد.</p>';
    } catch (e) {
      if (fail(e) || !box.isConnected) return;
      box.innerHTML = `<p class="d-status bad">${esc(e.message)}</p>`;
    }
  }

  // <details> toggles don't bubble, so listen in the capture phase.
  body.addEventListener('toggle', e => {
    const d = e.target.closest?.('.d-sec');
    if (!d) return;
    if (d.open) openSections.add(d.dataset.key); else openSections.delete(d.dataset.key);
    if (d.open && d.dataset.key === 'history' && openId) loadHistory(openId);
  }, true);

  // Runs one admin call, shows its outcome next to the buttons, and refreshes both the sheet and the list.
  async function run(job, success) {
    const buttons = body.querySelectorAll('button');
    buttons.forEach(b => { b.disabled = true; });
    setStatus('');
    try {
      const out = await job();
      onChanged();
      await Promise.all([load(), render(openId)]);
      setStatus(success);
      return out;
    } catch (e) {
      if (fail(e)) return null;
      await render(openId); // puts the buttons back as the sheet had them
      setStatus(e.message, true);
      return null;
    }
  }

  const ACTIONS = {
    enable: id => run(() => adminUpdateUser(id, { disabled: false }), 'تمت إعادة التفعيل. على المستخدم تسجيل الدخول من جديد.'),
    promote: id => run(() => adminUpdateUser(id, { role: 'admin' }), 'أصبح أدمن.'),
    demote: id => run(() => adminUpdateUser(id, { role: 'user' }), 'أصبح مستخدمًا عاديًا.'),
    async disable(id) {
      if (!await ask('سيُنهى دخول هذا المستخدم فورًا على كل أجهزته ولن يستطيع الدخول حتى تعيد تفعيله. بياناته تبقى كما هي.', 'إيقاف الحساب', true)) return;
      run(() => adminUpdateUser(id, { disabled: true }), 'تم إيقاف الحساب.');
    },
    async revoke(id) {
      if (!await ask('سيُسجَّل خروج هذا المستخدم من كل أجهزته، ويدخل من جديد بكلمة مروره.', 'إنهاء الجلسات', true)) return;
      run(() => adminRevokeSessions(id), 'تم إنهاء كل الجلسات.');
    },
    async reset(id) {
      if (!await ask('ستُنشأ كلمة مرور جديدة وتظهر لك مرة واحدة، وتنتهي كل جلسات المستخدم. كلمته القديمة لن تعمل.', 'إنشاء كلمة مرور', true)) return;
      const r = await run(() => adminResetPassword(id), 'تم تغيير كلمة المرور. انسخها الآن.');
      if (!r) return;
      const box = $('#dSecret');
      box.className = 'secret';
      box.hidden = false;
      box.innerHTML = `<p>كلمة المرور المؤقتة (لن تظهر مرة أخرى):</p><code id="dPass">${esc(r.password)}</code>
        <button class="btn" type="button" data-act="copy"><i class="ph ph-copy"></i> نسخ</button>
        <p>سلّمها للمستخدم بطريقة آمنة. التطبيق لا يتيح للمستخدم تغيير كلمة مروره بنفسه بعد، فتبقى هذه كلمته حتى تعيد تعيينها.</p>`;
      box.scrollIntoView({ block: 'center' });
    },
    async copy() {
      try {
        await navigator.clipboard.writeText($('#dPass').textContent);
        setStatus('تم النسخ.');
      } catch (_) {
        const sel = getSelection(), range = document.createRange();
        range.selectNodeContents($('#dPass'));
        sel.removeAllRanges();
        sel.addRange(range);
        setStatus('حدّد النص وانسخه يدويًا.', true);
      }
    },
    async delete(id) {
      const name = body.dataset.name;
      if (!await ask(`سيُحذف حساب «${name}» وكل بياناته نهائيًا ولا يمكن التراجع. هل أنت متأكد؟`, 'حذف نهائي', true)) return;
      try {
        await adminDeleteUser(id);
      } catch (e) {
        if (fail(e)) return;
        return setStatus(e.message, true);
      }
      onChanged();
      closeSheet();
      load();
    },
    allAudit() {
      closeSheet();
      openAudit();
    },
  };

  body.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn || !openId) return;
    statusAt = '#dStatus';
    ACTIONS[btn.dataset.act](openId);
  });
  body.addEventListener('submit', async e => {
    e.preventDefault();
    statusAt = '#dEditStatus';
    const f = e.target, name = f.name.value.trim(), email = f.email.value.trim().toLowerCase();
    if (!name) return setStatus('اكتب الاسم', true);
    if (!f.email.checkValidity() || !email) return setStatus('اكتب إيميلًا صحيحًا', true);
    const patch = {};
    if (name !== body.dataset.name) patch.name = name;
    if (email !== f.email.defaultValue.toLowerCase()) patch.email = email;
    if (!Object.keys(patch).length) return setStatus('لا يوجد تغيير.');
    await run(() => adminUpdateUser(openId, patch), 'تم الحفظ.');
  });

  function closeSheet() {
    if (dlg.open) dlg.close();
    openId = null;
  }
  $('#userDlgClose').onclick = closeSheet;
  dlg.addEventListener('close', () => { openId = null; body.innerHTML = ''; onSheetClosed(); });
  dlg.addEventListener('click', e => { if (e.target === dlg) closeSheet(); });

  return { load, setFilter, open, closeSheet };
}
