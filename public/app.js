(() => {
  'use strict';
  const KEY = 'my-week:v1';
  const OFFERED = 'my-week:legacy-offered';
  const DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
  const DAYS_SHORT = ['س', 'ح', 'ن', 'ث', 'ر', 'خ', 'ج'];
  const PERIODS = { sobh: 'الصبح', dhuhr: 'الضهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' };
  const STATE_LABEL = ['لم يُحدد', 'أنجزت', 'فاتني'];
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  const defaults = () => ({
    v: 1,
    items: [
      { id: uid(), name: 'روتين صباحي خفيف', period: 'sobh', track: false },
      { id: uid(), name: 'مراجعة حزب (بعيدة)', period: 'sobh', track: true },
      { id: uid(), name: 'بداية الشغل', period: 'sobh', track: true },
      { id: uid(), name: 'تكميل الشغل', period: 'dhuhr', track: true },
      { id: uid(), name: 'تطوير ذات | مذاكرة فقه', period: 'asr', track: true },
      { id: uid(), name: 'مراجعة القرآن (جديدة)', period: 'maghrib', track: true },
      { id: uid(), name: 'تقفيل اليوم والنوم المبكر', period: 'isha', track: false },
    ],
    weeks: {},
  });

  /* ---------- edit dialog markup ---------- */
  function injectChrome() {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="auth" id="auth" role="dialog" aria-labelledby="authTitle">
        <form class="auth-card" id="authForm" novalidate>
          <svg class="logo" aria-hidden="true"><use href="#logo"/></svg>
          <h2 id="authTitle">تسجيل الدخول</h2>
          <p class="auth-sub">أسبوعي — دفتر العادات والبدايات</p>
          <label class="af"><span>الاسم</span><input id="authName" type="text" autocomplete="name" maxlength="60"></label>
          <label class="af"><span>الإيميل</span><input id="authEmail" type="email" dir="ltr" autocomplete="email" inputmode="email" required></label>
          <label class="af"><span>كلمة المرور</span><input id="authPass" type="password" dir="ltr" autocomplete="current-password" required></label>
          <p class="auth-help" id="authHelp" hidden>٨ أحرف على الأقل.</p>
          <p class="auth-err" id="authErr" role="alert" hidden></p>
          <button class="btn primary" id="authSubmit" type="submit"><span>تسجيل الدخول</span></button>
          <button class="link-btn" id="authSwitch" type="button">إنشاء حساب جديد</button>
        </form>
      </div>
      <dialog id="dlg" aria-labelledby="dlgTitle">
        <div class="dlg-head"><h2 id="dlgTitle">تعديل الدفتر</h2><button class="icon-btn" id="dlgClose" aria-label="إغلاق"><i class="ph-bold ph-x"></i></button></div>
        <div class="dlg-body">
          <h4>الحساب</h4>
          <div class="acct">
            <div><strong id="acctName"></strong><small id="acctMail" dir="ltr"></small></div>
            <button class="btn sign-out" id="logoutBtn">خروج <i class="ph ph-sign-out"></i></button>
          </div>
          <h4>البنود (تظهر كصفوف في الشبكة)</h4>
          <div id="editList"></div>
          <button class="btn" id="addItem"><i class="ph-bold ph-plus"></i> إضافة بند</button>
          <p class="hint" id="addHint" hidden>وصلت للحد الأقصى (١٠٠ بند). احذف بندًا لإضافة غيره.</p>
          <h4>البيانات</h4>
          <div class="btn-row">
            <button class="btn" id="exportBtn"><i class="ph ph-download-simple"></i> تصدير نسخة احتياطية</button>
            <button class="btn" id="importBtn"><i class="ph ph-upload-simple"></i> استيراد نسخة</button>
            <button class="btn danger" id="resetBtn"><i class="ph ph-trash"></i> مسح كل البيانات</button>
          </div>
          <input type="file" id="importFile" accept="application/json,.json" hidden>
        </div>
      </dialog>
      <dialog id="ask" class="ask" aria-labelledby="askMsg">
        <p id="askMsg"></p>
        <div class="ask-acts"><button class="btn primary" id="askOk" type="button"></button><button class="btn" id="askNo" type="button">رجوع</button></div>
      </dialog>`);
  }

  /* ---------- in-page confirm()/alert() ---------- */
  let askDone = null;
  function settleAsk(v) {
    const done = askDone;
    askDone = null;
    const el = $('#ask');
    if (el.open) el.close();
    if (done) done(v);
  }
  // Resolves false when dismissed: "back", Esc, the backdrop, or the session ending underneath it.
  function ask(msg, okLabel, danger) {
    settleAsk(false);
    $('#askMsg').textContent = msg;
    $('#askOk').textContent = okLabel;
    $('#askOk').classList.toggle('danger', !!danger);
    $('#askNo').hidden = false;
    $('#ask').showModal();
    $('#askNo').focus();
    return new Promise(r => { askDone = r; });
  }
  function say(msg) {
    const p = ask(msg, 'حسنًا');
    $('#askNo').hidden = true;
    $('#askOk').focus();
    return p;
  }

  /* ---------- api + storage (server, per account) ---------- */
  let saveOk = true;
  let state = defaults();
  let user = null;

  const OFFLINE = 'تعذّر الاتصال بالخادم، تحقق من الإنترنت';
  async function api(path, method, body, keepalive) {
    // A hung request must not freeze saving: a timeout counts as a network failure.
    const ms = /^\/data\/(import|export)$/.test(path) ? 30000 : 15000;
    let r, data = null;
    try {
      r = await fetch('/api' + path, {
        method: method || 'GET',
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        keepalive: !!keepalive,
        signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined,
      });
      try { data = await r.json(); } catch (e) { if (r.ok) throw e; }
    } catch (_) { throw new Error(OFFLINE); }
    if (!r.ok) { const e = new Error((data && data.error) || 'حدث خطأ، حاول مرة أخرى'); e.status = r.status; throw e; }
    return data;
  }

  const validState = s => s && Array.isArray(s.items) && s.weeks && typeof s.weeks === 'object';
  // Storage can throw (private mode, blocked site data): the app must work without it.
  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} },
    del: k => { try { localStorage.removeItem(k); } catch (_) {} },
  };
  function legacyState() {
    try { const s = JSON.parse(ls.get(KEY)); return validState(s) ? s : null; } catch (_) { return null; }
  }

  // Only the week on screen (and the one before it, for inherited "start" values) is loaded.
  // Edits are sent as small deltas: the rows list and/or only the fields (boxes, texts) that changed,
  // so two devices editing the same week don't overwrite each other.
  const FIELDS = ['checks', 'start', 'end'];
  const MAX_WEEKS_PER_SAVE = 20; // mirrors server/limits.js
  const newDirty = () => ({ checks: new Set(), start: new Set(), end: new Set() });
  const loaded = new Set();
  const pendingLoads = new Map();
  const dirty = new Map(); // weekKey -> { checks: Set<itemId>, start: Set<itemId>, end: Set<itemId> }
  let dirtyItems = false;
  let savedTimer, pushTimer, retryTimer, inflight = 0, loadErr = false, limitErr = false, pushCount = 0, lastSync = 0, epoch = 0;
  const hasDirty = () => dirtyItems || dirty.size > 0;
  // A new account/notebook invalidates every request still on its way.
  const resetSync = () => { epoch++; pendingLoads.clear(); };
  function schedulePush() {
    if (!user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 600);
  }
  const markDirty = (k, f, id) => {
    let d = dirty.get(k);
    if (!d) dirty.set(k, d = newDirty());
    d[f].add(id);
    schedulePush();
  };
  const saveItems = () => { dirtyItems = true; schedulePush(); };
  function remerge(taken) {
    for (const [k, d] of taken) {
      let t = dirty.get(k);
      if (!t) dirty.set(k, t = newDirty());
      FIELDS.forEach(f => d[f].forEach(id => t[f].add(id)));
    }
  }
  function weeksDelta(taken) {
    const out = {};
    for (const [k, d] of taken) {
      const w = state.weeks[k], o = { checks: {}, start: {}, end: {} };
      let n = 0;
      if (w) FIELDS.forEach(f => d[f].forEach(id => { if (w[f] && w[f][id] !== undefined) { o[f][id] = w[f][id]; n++; } }));
      if (n) out[k] = o;
    }
    return out;
  }
  // Network trouble, 5xx, timeout (408) and rate limit (429) are worth retrying; any other 4xx will never succeed.
  const permanent = e => e.status && e.status < 500 && e.status !== 408 && e.status !== 429;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const idle = async () => { while (inflight) await sleep(50); };
  // keepalive (page hiding): send what's dirty even if a request is in flight (the page may not live to wait for it).
  async function push(keepalive) {
    if (!user || !hasDirty()) return;
    const ka = keepalive === true;
    if (inflight && !ka) { pushTimer = setTimeout(push, 300); return; }
    // ep: a response that arrives after a logout/login belongs to the previous account and must be ignored.
    const ep = epoch, overlap = ka && inflight > 0;
    const parts = [];
    if (dirtyItems) parts.push({ body: { items: state.items }, redo: () => { dirtyItems = true; } });
    const taken = new Map(dirty), entries = Object.entries(weeksDelta(taken));
    // The server accepts a limited number of weeks per request.
    for (let i = 0; i < entries.length; i += MAX_WEEKS_PER_SAVE) {
      const chunk = entries.slice(i, i + MAX_WEEKS_PER_SAVE);
      parts.push({ body: { weeks: Object.fromEntries(chunk) }, redo: () => remerge(new Map(chunk.map(([k]) => [k, taken.get(k)]))) });
    }
    dirtyItems = false; dirty.clear();
    if (!parts.length) return;
    // Rows and weeks go as separate requests so a rejected one can't block the other.
    const run = async p => {
      try { await api('/data', 'PUT', p.body, ka); return 'ok'; }
      catch (e) { return e.status === 401 ? 'auth' : permanent(e) ? 'drop' : 'retry'; }
    };
    const results = [];
    pushCount++; inflight++;
    try {
      if (ka) results.push(...await Promise.all(parts.map(run)));
      else for (const p of parts) { if (ep !== epoch) break; results.push(await run(p)); }
    } finally { inflight--; }
    if (!user || ep !== epoch) return;
    if (results.includes('auth')) return showAuth('انتهت الجلسة، سجّل الدخول مجددًا');
    // A keepalive sent while a normal request was still on its way may reach the server before it, and the older
    // request would then win. Marking the same fields dirty again re-sends their current values after it finishes.
    parts.forEach((p, i) => { if (results[i] === 'retry' || (overlap && results[i] === 'ok')) p.redo(); });
    if (overlap && results.includes('ok')) schedulePush();
    const rejected = results.includes('drop');
    if (rejected) limitErr = true;
    if (results.includes('retry')) {
      saveOk = false;
      $('#saved').classList.remove('on'); // "saved" from the previous request must not sit next to the failure banner
      clearTimeout(retryTimer); retryTimer = setTimeout(push, 5000);
    } else {
      saveOk = true;
      if (!rejected) {
        limitErr = false;
        const el = $('#saved');
        if (el) { el.classList.add('on'); clearTimeout(savedTimer); savedTimer = setTimeout(() => el.classList.remove('on'), 1400); }
      }
    }
    renderBanner();
  }
  function renderBanner() {
    const msg = !saveOk ? 'تعذّر الحفظ على الخادم. سنعيد المحاولة تلقائيًا — لا تغلق الصفحة قبل ظهور «تم الحفظ».'
      : limitErr ? 'رُفض آخر تعديل لأنه تجاوز الحدود المسموحة.'
      : loadErr ? 'تعذّر تحميل هذا الأسبوع، تحقق من الإنترنت وحاول مرة أخرى.' : '';
    $('#banner').innerHTML = msg ? `<div class="banner"><i class="ph-bold ph-warning"></i> ${msg}</div>` : '';
  }

  // Take the server's copy of a week but keep the fields still waiting to be saved.
  function mergeWeek(k, sw) {
    const d = dirty.get(k), w = state.weeks[k];
    if (!d || !w) { if (sw) state.weeks[k] = sw; else if (!d) delete state.weeks[k]; return; }
    const out = {};
    for (const f of FIELDS) {
      out[f] = { ...(sw && sw[f]) };
      d[f].forEach(id => { if (w[f] && id in w[f]) out[f][id] = w[f][id]; });
    }
    state.weeks[k] = out;
  }
  // One request per key, however many callers ask; a result never replaces a week that is already loaded.
  function loadWeeks(keys) {
    const need = keys.filter(k => !loaded.has(k));
    const fresh = need.filter(k => !pendingLoads.has(k));
    if (fresh.length) {
      const ep = epoch;
      const p = api('/data/weeks?keys=' + fresh.join(',')).then(({ weeks }) => {
        if (ep !== epoch) return;
        for (const k of fresh) { if (!loaded.has(k)) mergeWeek(k, weeks[k]); loaded.add(k); }
      }).finally(() => fresh.forEach(k => { if (pendingLoads.get(k) === p) pendingLoads.delete(k); }));
      fresh.forEach(k => pendingLoads.set(k, p));
    }
    return Promise.all(need.map(k => pendingLoads.get(k)));
  }
  // Coming back to the tab: pick up what other devices changed. Other weeks are refetched when visited.
  async function resync() {
    if (!user || document.visibilityState !== 'visible' || Date.now() - lastSync < 30000) return;
    if (inflight) return; // the GET could read data from before our own save lands
    lastSync = Date.now();
    const ep = epoch, pc = pushCount, nav = navSeq, at = cur, prev = prevKey(cur);
    let s;
    try { s = await api(`/session?weeks=${at},${prev}`); }
    catch (e) { if (e.status === 401 && ep === epoch) showAuth('انتهت الجلسة، سجّل الدخول مجددًا'); return; }
    if (ep !== epoch || pc !== pushCount || inflight || nav !== navSeq || at !== cur) { lastSync = 0; return; }
    const sig = () => JSON.stringify([state.items, state.weeks[at], state.weeks[prev]]);
    const before = sig();
    // With the edit dialog open its list is built from state.items, so the array must not be swapped under it.
    if (!dirtyItems && !dlg.open && Array.isArray(s.items)) state.items = s.items;
    for (const k of [at, prev]) { mergeWeek(k, s.weeks[k]); loaded.add(k); }
    for (const k of [...loaded]) {
      if (k === at || k === prev) continue;
      loaded.delete(k);
      if (!dirty.has(k)) delete state.weeks[k];
    }
    // Rebuilding the rows would drop focus from a text box the user is already typing in; skip it when nothing changed.
    if (!dlg.open && sig() !== before) renderAll(false);
  }
  // Don't lose the last edit when the tab is closed or hidden.
  addEventListener('pagehide', () => { clearTimeout(pushTimer); push(true); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { clearTimeout(pushTimer); push(true); }
    else resync();
  });

  /* ---------- auth ---------- */
  let authMode = 'login';
  function showAuth(msg) {
    user = null; dirtyItems = false; dirty.clear(); loaded.clear(); resetSync();
    clearTimeout(pushTimer); clearTimeout(retryTimer);
    state = defaults(); saveOk = true; loadErr = false; limitErr = false; renderBanner();
    // wipe the previous user's data from the page, not just hide it
    ['#rows', '#stats', '#bars', '#head', '#editList'].forEach(s => { $(s).innerHTML = ''; });
    statsCache = '';
    $('#acctName').textContent = ''; $('#acctMail').textContent = '';
    document.body.classList.remove('booting');
    document.body.classList.add('locked');
    openNotes.clear();
    settleAsk(false);
    if (dlg.open) dlg.close();
    setAuthMode('login');
    $('#authForm').reset();
    setAuthError(msg || '');
    $('#authEmail').focus();
  }
  function setAuthError(msg) { const el = $('#authErr'); el.textContent = msg; el.hidden = !msg; }
  function setAuthMode(m) {
    authMode = m;
    const reg = m === 'register';
    $('#authName').closest('label').hidden = !reg;
    $('#authName').required = reg;
    $('#authPass').autocomplete = reg ? 'new-password' : 'current-password';
    $('#authSubmit span').textContent = reg ? 'إنشاء الحساب' : 'تسجيل الدخول';
    $('#authSwitch').textContent = reg ? 'لدي حساب بالفعل' : 'إنشاء حساب جديد';
    $('#authTitle').textContent = reg ? 'إنشاء حساب' : 'تسجيل الدخول';
    $('#authPass').minLength = reg ? 8 : 0;
    $('#authHelp').hidden = !reg;
    setAuthError('');
  }
  // One request: who I am + my rows + the given week and the one before it. The screen only ever shows
  // what the server returned (never an object from a file or localStorage), so it is always cleaned data.
  async function loadSession(k) {
    const p = prevKey(k);
    const s = await api(`/session?weeks=${k},${p}`);
    resetSync();
    user = s.user;
    $('#acctName').textContent = user.name;
    $('#acctMail').textContent = user.email;
    clearTimeout(pushTimer);
    dirtyItems = false; dirty.clear();
    state = { v: 1, items: s.items || [], weeks: s.weeks };
    loaded.clear(); loaded.add(k); loaded.add(p);
    lastSync = Date.now();
    return s;
  }
  async function start() {
    const k = todayKey();
    const s = await loadSession(k);
    if (!s.items) {
      // first sign-in: offer, once per device, the notebook that lived here before accounts existed
      const old = ls.get(OFFERED) ? null : legacyState();
      let imported = false;
      if (old) {
        ls.set(OFFERED, '1');
        if (await ask('وجدنا بيانات محفوظة على هذا الجهاز. هل ترفعها إلى حسابك؟', 'رفع البيانات')) {
          try { await api('/data/import', 'PUT', { state: old }); imported = true; }
          catch (_) { await say('تعذّر رفع البيانات القديمة، سنبدأ بدفتر جديد.'); }
        }
      }
      if (imported) { ls.del(KEY); await loadSession(k); }
      else { state.items = defaults().items; saveItems(); }
    }
    cur = target = k; loadErr = false; renderBanner();
    document.body.classList.remove('locked', 'booting');
    renderAll(true);
  }
  // The login form is shown only when the server says "not signed in" (401). While the answer is on its way the
  // page shows a placeholder; if the server can't be reached it says so and offers a retry instead of the form.
  const BOOT_RETRY_MS = [700, 1800];
  let booting = false;
  function bootView(failMsg) {
    $('#bootSkel').hidden = !!failMsg;
    $('#bootFail').hidden = !failMsg;
    $('#bootMsg').textContent = failMsg || '';
    $('#bootLabel').textContent = failMsg ? '' : 'جارٍ التحميل…';
    if (failMsg) $('#bootRetry').focus();
  }
  async function boot() {
    if (booting) return;
    booting = true;
    bootView('');
    try {
      for (let i = 0; ; i++) {
        try { return await start(); }
        catch (e) {
          // Permanent answers (401, other 4xx) and failures after the session loaded go to the form as before.
          if (permanent(e) || user) return showAuth(e.status === 401 ? '' : e.message);
          if (i < BOOT_RETRY_MS.length) { await sleep(BOOT_RETRY_MS[i]); continue; }
          return bootView(e.message);
        }
      }
    } finally { booting = false; }
  }

  /* ---------- dates (week starts Saturday) ---------- */
  const pad = x => String(x).padStart(2, '0');
  const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, k) => { const x = new Date(d); x.setDate(x.getDate() + k); return x; };
  const dayIdx = d => (d.getDay() + 1) % 7;
  const weekStart = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return addDays(x, -dayIdx(x)); };
  const todayKey = () => keyOf(weekStart(new Date()));
  const prevKey = k => keyOf(addDays(fromKey(k), -7));
  let cur = todayKey();
  let target = cur; // where the last prev/next click is heading, so a quick double click moves two weeks

  /* ---------- week data ---------- */
  const emptyWeek = () => ({ checks: {}, start: {}, end: {} });
  const getWeek = k => state.weeks[k] || null;
  const ensureWeek = k => (state.weeks[k] ||= emptyWeek());
  const st = v => (v === 1 || v === 2 ? v : 0);
  const periodOf = p => (Object.prototype.hasOwnProperty.call(PERIODS, p) ? p : 'sobh');
  const checksOf = (w, id) => {
    const c = w && w.checks && w.checks[id];
    return Array.isArray(c) && c.length === 7 ? c : [0, 0, 0, 0, 0, 0, 0];
  };

  function startValue(id) {
    const w = getWeek(cur);
    if (w && Object.prototype.hasOwnProperty.call(w.start, id)) return { v: w.start[id], inh: false };
    const prev = getWeek(keyOf(addDays(fromKey(cur), -7)));
    const e = prev && prev.end[id];
    return e ? { v: e, inh: true } : { v: '', inh: false };
  }
  function denomDays() {
    const t = todayKey();
    if (cur < t) return 7;
    if (cur === t) return dayIdx(new Date()) + 1;
    return 0;
  }
  const todayIndex = () => (cur === todayKey() ? dayIdx(new Date()) : -1);

  /* ---------- render ---------- */
  const label = (it, d, v) => `${it.name} — ${DAYS[d]}: ${STATE_LABEL[v]}`;
  const cellInner = '<i class="ph-bold ph-check ck"></i><i class="ph-bold ph-minus x"></i>';
  const openNotes = new Set(); // rows whose start/end fields are unfolded on small screens
  const notesPreview = (s, e) => (s || e ? [s && `بدأت: ${s}`, e && `وصلت: ${e}`].filter(Boolean).join(' · ') : 'أين بدأت؟ أين وصلت؟');

  // The lit part of a moon of radius 42 in a 100x100 box: the right limb, then the terminator back up. f is 0..1.
  const moonPath = f => `M50 8A42 42 0 0 1 50 92A${(42 * Math.abs(1 - 2 * f)).toFixed(2)} 42 0 0 ${f > .5 ? 1 : 0} 50 8Z`;
  let moonF = 0, moonRaf = 0;
  function setMoon(f) {
    const el = $('#moonLit');
    cancelAnimationFrame(moonRaf);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { moonF = f; el.setAttribute('d', moonPath(f)); return; }
    const from = moonF, t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / 600);
      moonF = from + (f - from) * (1 - (1 - k) ** 4);
      el.setAttribute('d', moonPath(moonF));
      if (k < 1) moonRaf = requestAnimationFrame(step);
    };
    moonRaf = requestAnimationFrame(step);
  }

  // Builds the structure (week change / items edit). Click and typing never come through here.
  function renderAll(animate) {
    const start = fromKey(cur), end = addDays(start, 6);
    const f = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'long' });
    $('#range').textContent = `${f.format(start)} – ${f.format(end)}`;
    try {
      const h = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { month: 'long', year: 'numeric' });
      $('#hijri').textContent = h.format(start);
    } catch (e) { $('#hijri').textContent = ''; }
    $('#todayBtn').hidden = cur === todayKey();

    const ti = todayIndex(), den = denomDays();
    const w = getWeek(cur);

    $('#head').innerHTML =
      '<div class="h-name">البند</div>' +
      '<div class="dh">' + DAYS.map((d, i) => `<span class="${i === ti ? 'today' : ''}"><b class="f">${d}</b><b class="s">${DAYS_SHORT[i]}</b><small>${addDays(start, i).getDate()}</small></span>`).join('') + '</div>' +
      '<div class="h-start">بداية الأسبوع</div><div class="h-end">نهاية الأسبوع</div><div class="h-cnt">العدد</div>';

    const rows = $('#rows');
    rows.classList.remove('enter');
    rows.innerHTML = state.items.length ? state.items.map((it, idx) => {
      const c = checksOf(w, it.id);
      const done = c.filter(x => x === 1).length;
      const sv = startValue(it.id);
      const ev = (w && w.end[it.id]) || '';
      const per = periodOf(it.period);
      const newPeriod = !idx || periodOf(state.items[idx - 1].period) !== per;
      const open = openNotes.has(it.id);
      return `${newPeriod ? `<h3 class="period" style="--pc:var(--p-${esc(per)});--i:${idx}">${PERIODS[per]}</h3>` : ''}<article class="row ${it.track ? '' : 'notrack'} ${open ? 'open' : ''}" data-id="${esc(it.id)}" style="--pc:var(--p-${esc(per)});--i:${idx}">
        <div class="r-name"><h4>${esc(it.name)}</h4></div>
        <div class="r-days">${c.map((x, i) => { const v = st(x); return `<div class="dc ${i === ti ? 'today' : ''} ${i >= den ? 'future' : ''}"><button class="cb s${v}" data-d="${i}" aria-label="${esc(label(it, i, v))}">${cellInner}</button></div>`; }).join('')}</div>
        ${it.track ? `<button class="note-tg" type="button" aria-expanded="${open}"><i class="ph ph-pencil-simple-line"></i><span>${esc(notesPreview(sv.v, ev))}</span><i class="ph-bold ph-caret-down"></i></button>` : ''}
        <label class="fld st"><span>بداية الأسبوع</span><input type="text" data-f="start" maxlength="300" class="${sv.inh ? 'inh' : ''}" value="${esc(sv.v)}" placeholder="أين بدأت؟" ${sv.inh ? 'title="مأخوذة من نهاية الأسبوع الماضي"' : ''}></label>
        <label class="fld en"><span>نهاية الأسبوع</span><input type="text" data-f="end" maxlength="300" value="${esc(ev)}" placeholder="أين وصلت؟"></label>
        <div class="r-count"><b>${done}</b> / 7</div>
      </article>`;
    }).join('') : '<div class="empty"><svg class="logo" aria-hidden="true"><use href="#logo"/></svg><p>دفترك فارغ. أضف أول بند، وليكن شيئًا صغيرًا تفعله كل يوم.</p><button class="btn primary" id="emptyAdd" type="button"><i class="ph-bold ph-plus"></i> أضف أول بند</button></div>';
    if (animate) { void rows.offsetWidth; rows.classList.add('enter'); }

    $('#bars').innerHTML = DAYS.map((d, i) => `<div class="bar ${i === ti ? 'today' : ''}"><em></em><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="moon-dark" cx="50" cy="50" r="42"/><path class="moon-lit"/></svg><span>${d}</span></div>`).join('');
    patchBars(w);
    renderSummary(w);
  }

  let statsCache = '';
  function renderSummary(w) {
    const den = denomDays();
    const items = state.items;
    let done = 0;
    const per = items.map(it => {
      const d = checksOf(w, it.id).slice(0, den).filter(x => x === 1).length;
      done += d;
      return { it, r: den ? d / den : 0 };
    });
    const total = items.length * den;
    const p = total ? Math.round(done / total * 100) : 0;
    setMoon(total ? done / total : 0);
    $('#pct').textContent = p + '%';
    $('#sumTitle').textContent = !den ? 'أسبوع قادم' : p === 100 ? 'اكتمل البدر هذا الأسبوع' : p >= 80 ? 'ما شاء الله، أسبوع قوي' : p >= 50 ? 'ماضٍ على الطريق' : p > 0 ? 'كل خطوة تُحسب' : 'أسبوع جديد، ابدأ بخطوة صغيرة';
    $('#sumSub').textContent = !items.length ? 'دفترك ينتظر أول بند' : den ? `أنجزت ${done} من ${total} خانة حتى الآن` : 'سجّل بداياتك مبكرًا لتسهل المقارنة';
    let html = '';
    if (den && items.length > 1 && done > 0) {
      const sorted = [...per].sort((a, b) => b.r - a.r);
      const best = sorted[0], worst = sorted[sorted.length - 1];
      html += `<div class="stat good"><span>الأقوى</span><strong>${esc(best.it.name)}</strong></div>`;
      if (worst.r < best.r) html += `<div class="stat"><span>يحتاج عناية</span><strong>${esc(worst.it.name)}</strong></div>`;
    }
    const trackTotal = items.filter(i => i.track).length;
    const tracked = items.filter(i => i.track && w && String(w.end[i.id] || '').trim()).length;
    if (trackTotal) html += `<div class="stat"><span>نهايات مكتوبة</span><strong>${tracked} من ${trackTotal}</strong></div>`;
    if (html !== statsCache) { statsCache = html; $('#stats').innerHTML = html; }
  }

  function patchBars(w) {
    const den = denomDays(), items = state.items;
    document.querySelectorAll('#bars .bar').forEach((el, i) => {
      const cnt = items.filter(it => checksOf(w, it.id)[i] === 1).length;
      const pc = items.length ? cnt / items.length : 0;
      el.classList.toggle('empty', cnt === 0);
      el.querySelector('em').textContent = (i >= den && !cnt) ? '' : cnt;
      el.querySelector('path').setAttribute('d', moonPath(pc));
    });
  }

  /* ---------- interactions ---------- */
  $('#rows').addEventListener('click', e => {
    if (e.target.closest('#emptyAdd')) { renderEdit(); dlg.showModal(); $('#addItem').click(); return; }
    const tg = e.target.closest('.note-tg');
    if (tg) {
      const row = tg.closest('.row'), open = row.classList.toggle('open');
      tg.setAttribute('aria-expanded', open);
      if (open) openNotes.add(row.dataset.id); else openNotes.delete(row.dataset.id);
      return;
    }
    const b = e.target.closest('.cb'); if (!b) return;
    const row = b.closest('.row'), id = row.dataset.id, d = +b.dataset.d;
    const it = state.items.find(x => x.id === id); if (!it) return;
    const w = ensureWeek(cur);
    let c = w.checks[id];
    if (!Array.isArray(c) || c.length !== 7) c = w.checks[id] = [0, 0, 0, 0, 0, 0, 0];
    c[d] = (st(c[d]) + 1) % 3;
    markDirty(cur, 'checks', id);
    // patch in place: no re-render, so nothing flashes
    b.className = 'cb s' + c[d];
    b.setAttribute('aria-label', label(it, d, c[d]));
    row.querySelector('.r-count b').textContent = c.filter(x => x === 1).length;
    renderSummary(w); patchBars(w);
  });
  $('#rows').addEventListener('input', e => {
    const inp = e.target.closest('input[data-f]'); if (!inp) return;
    const w = ensureWeek(cur);
    const row = inp.closest('.row'), id = row.dataset.id;
    w[inp.dataset.f][id] = inp.value;
    inp.classList.remove('inh');
    row.querySelector('.note-tg span').textContent = notesPreview(row.querySelector('[data-f=start]').value, row.querySelector('[data-f=end]').value);
    markDirty(cur, inp.dataset.f, id); renderSummary(w);
  });
  // Weeks are fetched on demand; a click while a fetch is in flight supersedes it.
  let navSeq = 0;
  async function goTo(key) {
    const my = ++navSeq, ep = epoch;
    target = key;
    let err;
    try { await loadWeeks([key, prevKey(key)]); } catch (e) { err = e; }
    // The account changed while the request was out: its answer (even a 401) is not about this session.
    if (ep !== epoch) { if (my === navSeq) target = cur; return; }
    if (err) {
      if (err.status === 401) return showAuth('انتهت الجلسة، سجّل الدخول مجددًا');
      if (my === navSeq) { target = cur; loadErr = true; renderBanner(); }
      return;
    }
    if (my !== navSeq) return;
    loadErr = false; renderBanner();
    cur = key; renderAll(true);
  }
  const shift = k => {
    const key = keyOf(addDays(fromKey(target), 7 * k));
    goTo(key);
    // warm the next week in the same direction so the following click is instant
    loadWeeks([keyOf(addDays(fromKey(key), 7 * k)), prevKey(keyOf(addDays(fromKey(key), 7 * k)))]).catch(() => {});
  };
  $('#prevBtn').onclick = () => shift(-1);
  $('#nextBtn').onclick = () => shift(1);
  $('#todayBtn').onclick = () => goTo(todayKey());

  /* ---------- init ---------- */
  injectChrome();
  renderBanner();
  setAuthMode('login');

  $('#bootRetry').onclick = boot;
  // Back online while the failure panel is up: try again without making the user press anything.
  addEventListener('online', () => { if (document.body.classList.contains('booting') && !$('#bootFail').hidden) boot(); });
  $('#authSwitch').onclick = () => setAuthMode(authMode === 'login' ? 'register' : 'login');
  $('#authForm').addEventListener('submit', async e => {
    e.preventDefault();
    const reg = authMode === 'register';
    const name = $('#authName').value.trim(), email = $('#authEmail').value.trim(), password = $('#authPass').value;
    if (reg && !name) return setAuthError('اكتب اسمك');
    if (email.length > 254 || !/^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return setAuthError('اكتب إيميلًا صحيحًا');
    if (!password) return setAuthError('اكتب كلمة المرور');
    if (reg && password.length < 8) return setAuthError('كلمة المرور ٨ أحرف على الأقل');
    const btn = $('#authSubmit'); btn.disabled = true; setAuthError('');
    try {
      await api(reg ? '/auth/register' : '/auth/login', 'POST', reg ? { name, email, password } : { email, password });
      $('#authForm').reset();
      await start();
    } catch (err) {
      // A failure after the session was loaded (the legacy-upload reload) must not leave a signed-in state behind the login form.
      if (user) showAuth(err.message); else setAuthError(err.message);
    }
    btn.disabled = false;
  });
  $('#logoutBtn').onclick = async () => {
    await flush();
    if (!user) return; // the final push found the session expired
    if (hasDirty() && !await ask('لديك تعديلات غير محفوظة. تسجيل الخروج وفقدانها؟', 'خروج دون حفظ', true)) { schedulePush(); return; }
    if (!user) return; // the session ended while the question was open
    try { await api('/auth/logout', 'POST'); }
    catch (_) { schedulePush(); return say('تعذّر تسجيل الخروج، تحقق من الإنترنت وحاول مرة أخرى. ما زلت مسجّلًا الدخول.'); }
    showAuth();
  };

  /* edit dialog */
  const dlg = $('#dlg');
  function renderEdit() {
    $('#editList').innerHTML = state.items.map((it, i) => `
      <div class="edit-row" data-id="${esc(it.id)}">
        <div class="l1">
          <input type="text" data-k="name" maxlength="100" value="${esc(it.name)}" aria-label="اسم البند">
          <select data-k="period" aria-label="الفترة">${Object.entries(PERIODS).map(([k, v]) => `<option value="${k}" ${k === periodOf(it.period) ? 'selected' : ''}>${v}</option>`).join('')}</select>
        </div>
        <label class="tg"><input type="checkbox" data-k="track" ${it.track ? 'checked' : ''}> تتبّع البداية والنهاية</label>
        <div class="acts">
          <button class="sm-btn" data-a="up" ${i === 0 ? 'disabled' : ''} aria-label="أعلى"><i class="ph-bold ph-arrow-up"></i></button>
          <button class="sm-btn" data-a="down" ${i === state.items.length - 1 ? 'disabled' : ''} aria-label="أسفل"><i class="ph-bold ph-arrow-down"></i></button>
          <button class="sm-btn danger" data-a="del" aria-label="حذف"><i class="ph-bold ph-trash"></i></button>
        </div>
      </div>`).join('');
    const full = state.items.length >= 100;
    $('#addItem').disabled = full; $('#addHint').hidden = !full;
  }
  $('#editBtn').onclick = () => { renderEdit(); dlg.showModal(); };
  $('#dlgClose').onclick = () => dlg.close();
  $('#askOk').onclick = () => settleAsk(true);
  $('#askNo').onclick = () => settleAsk(false);
  $('#ask').addEventListener('close', () => settleAsk(false));
  $('#ask').addEventListener('click', e => { if (e.target === e.currentTarget) settleAsk(false); });
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => { if (user) renderAll(false); });
  $('#editList').addEventListener('input', e => {
    const el = e.target.closest('[data-k]'); if (!el) return;
    const it = state.items.find(x => x.id === el.closest('.edit-row').dataset.id); if (!it) return;
    it[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value;
    saveItems();
  });
  $('#editList').addEventListener('click', async e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const id = b.closest('.edit-row').dataset.id;
    let i = state.items.findIndex(x => x.id === id);
    if (b.dataset.a === 'del') {
      if (!await ask('حذف هذا البند من الشبكة؟ (بياناته السابقة تبقى محفوظة)', 'حذف البند', true)) return;
      i = state.items.findIndex(x => x.id === id);
      if (i < 0) return;
      state.items.splice(i, 1);
    } else {
      const j = b.dataset.a === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= state.items.length) return;
      [state.items[i], state.items[j]] = [state.items[j], state.items[i]];
    }
    saveItems(); renderEdit();
  });
  $('#addItem').onclick = () => {
    if (state.items.length >= 100) return;
    state.items.push({ id: uid(), name: 'بند جديد', period: 'sobh', track: false });
    saveItems(); renderEdit();
    const last = $('#editList').lastElementChild.querySelector('input[type=text]'); last.focus(); last.select();
  };

  // Save everything pending (waiting for a request already on its way) before leaving or exporting.
  async function flush() { clearTimeout(pushTimer); await idle(); await push(); await idle(); }
  // Before a request that replaces the whole notebook: nothing may be sent (or scheduled, e.g. the 5 s retry) meanwhile.
  async function quiesce() { clearTimeout(pushTimer); await idle(); clearTimeout(pushTimer); clearTimeout(retryTimer); }

  // The server holds every week; the browser only has the ones it has opened, so a backup is fetched.
  $('#exportBtn').onclick = async () => {
    try {
      await flush();
      if (hasDirty()) throw new Error('تعذّر حفظ آخر تعديلاتك قبل التصدير، حاول مرة أخرى.');
      const data = await api('/data/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `my-week-${keyOf(new Date())}.json`;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (err) { say(err.message); }
  };
  $('#importBtn').onclick = () => $('#importFile').click();
  $('#importFile').onchange = async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    let s;
    try { s = JSON.parse(await file.text()); if (!validState(s)) throw 0; } catch (_) { return say('الملف غير صالح.'); }
    if (!await ask('سيُستبدل دفترك الحالي بالنسخة المستوردة. متابعة؟', 'استبدال الدفتر', true)) return;
    try {
      await quiesce();
      await api('/data/import', 'PUT', { state: s });
    } catch (err) { if (hasDirty()) schedulePush(); return say(err.message === 'بيانات غير صالحة' ? 'الملف غير صالح.' : err.message); }
    // show what the server kept after cleaning it, not the raw file
    try { await loadSession(cur); }
    catch (err) { return say('تم الاستيراد لكن تعذّر تحديث الشاشة. أعد تحميل الصفحة.'); }
    renderEdit(); renderAll(false);
  };
  $('#resetBtn').onclick = async () => {
    if (!await ask('سيتم مسح كل البيانات نهائيًا. هل أنت متأكد؟', 'مسح نهائيًا', true)) return;
    try {
      await quiesce();
      await api('/data', 'DELETE');
      dirty.clear(); resetSync();
      state = defaults();
      loaded.clear(); loaded.add(cur); loaded.add(prevKey(cur));
      saveItems(); renderEdit(); renderAll(false);
    } catch (err) { if (hasDirty()) schedulePush(); say(err.message); }
  };

  boot();
  let lastDay = keyOf(new Date());
  setInterval(() => { const k = keyOf(new Date()); if (k !== lastDay) { lastDay = k; renderAll(false); } }, 60000);
})();
