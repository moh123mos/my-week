// The sign-in / register form, signing out, and locking the screen.
import { login, logout, register } from '../api.js';
import { LIMITS } from '../config.js';
import { $ } from '../dom.js';
import { emptyNotebook } from '../store.js';
import { ask, dismissDialogs, say } from './dialogs.js';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
const isValidEmail = email => email.length <= LIMITS.MAX_EMAIL && EMAIL_RE.test(email);

export function createAuth({ store, sync, session, onLocked }) {
  const form = $('#authForm');
  let registering = false;

  function setError(message) {
    const el = $('#authErr');
    el.textContent = message;
    el.hidden = !message;
  }

  function setRegistering(value) {
    registering = value;
    $('#authName').closest('label').hidden = !value;
    $('#authName').required = value;
    $('#authPass').autocomplete = value ? 'new-password' : 'current-password';
    $('#authPass').minLength = value ? LIMITS.PASSWORD_MIN : 0;
    $('#authSubmit span').textContent = value ? 'إنشاء الحساب' : 'تسجيل الدخول';
    $('#authSwitch').textContent = value ? 'لدي حساب بالفعل' : 'إنشاء حساب جديد';
    $('#authTitle').textContent = value ? 'إنشاء حساب' : 'تسجيل الدخول';
    $('#authHelp').hidden = !value;
    setError('');
  }

  function formError(name, email, password) {
    if (registering && !name) return 'اكتب اسمك';
    if (!isValidEmail(email)) return 'اكتب إيميلًا صحيحًا';
    if (!password) return 'اكتب كلمة المرور';
    if (registering && password.length < LIMITS.PASSWORD_MIN) return 'كلمة المرور ٨ أحرف على الأقل';
    return '';
  }

  // Wipes the previous user's data from the page, not just hides it, and shows the form.
  function lock(message = '') {
    store.user = null;
    store.state = emptyNotebook();
    sync.clear();
    onLocked();
    document.body.classList.remove('booting');
    document.body.classList.add('locked');
    dismissDialogs(false);
    setRegistering(false);
    form.reset();
    setError(message);
    $('#authEmail').focus();
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#authName').value.trim(), email = $('#authEmail').value.trim(), password = $('#authPass').value;
    const invalid = formError(name, email, password);
    if (invalid) return setError(invalid);
    const submit = $('#authSubmit');
    submit.disabled = true;
    setError('');
    try {
      await (registering ? register(name, email, password) : login(email, password));
      form.reset();
      await session.start();
    } catch (err) {
      // A failure after the session was loaded (the legacy-upload reload) must not leave a signed-in state behind the login form.
      if (store.user) lock(err.message);
      else setError(err.message);
    }
    submit.disabled = false;
  });
  $('#authSwitch').onclick = () => setRegistering(!registering);

  $('#logoutBtn').onclick = async () => {
    await sync.flush();
    if (!store.user) return; // the final push found the session expired
    if (sync.hasDirty() && !await ask('لديك تعديلات غير محفوظة. تسجيل الخروج وفقدانها؟', 'خروج دون حفظ', true)) {
      sync.schedulePush();
      return;
    }
    if (!store.user) return; // the session ended while the question was open
    try {
      await logout();
    } catch (_) {
      sync.schedulePush();
      return say('تعذّر تسجيل الخروج، تحقق من الإنترنت وحاول مرة أخرى. ما زلت مسجّلًا الدخول.');
    }
    lock();
  };

  setRegistering(false);
  return { lock };
}
