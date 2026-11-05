// Display helpers for the admin dashboard. No DOM, so test/client/admin.test.mjs can import it.

const nf = new Intl.NumberFormat('ar-EG');
export const num = n => nf.format(n ?? 0);
export const percent = r => (r == null ? '—' : `${num(r)}٪`);

const PLURALS = {
  دقيقة: ['دقيقة', 'دقيقتين', 'دقائق'], ساعة: ['ساعة', 'ساعتين', 'ساعات'],
  يوم: ['يوم', 'يومين', 'أيام'], شهر: ['شهر', 'شهرين', 'أشهر'], سنة: ['سنة', 'سنتين', 'سنوات'],
};
const countWord = (n, unit) => {
  const [one, two, few] = PLURALS[unit];
  if (n === 1) return one;
  if (n === 2) return two;
  return `${num(n)} ${n <= 10 ? few : one}`;
};

// "منذ ٣ ساعات"; null/invalid -> "لم يحدث بعد".
export function ago(iso, now = Date.now()) {
  if (!iso) return 'لم يحدث بعد';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'لم يحدث بعد';
  const seconds = Math.max(0, (now - t) / 1000);
  if (seconds < 45) return 'الآن';
  const minutes = Math.round(seconds / 60);
  if (minutes < 45) return `منذ ${countWord(Math.max(1, minutes), 'دقيقة')}`;
  const hours = Math.round(minutes / 60);
  if (hours < 22) return `منذ ${countWord(hours, 'ساعة')}`;
  const days = Math.round(hours / 24);
  if (days < 30) return `منذ ${countWord(Math.max(1, days), 'يوم')}`;
  const months = Math.round(days / 30);
  if (months < 12) return `منذ ${countWord(months, 'شهر')}`;
  return `منذ ${countWord(Math.max(1, Math.round(days / 365)), 'سنة')}`;
}

export const dateText = iso => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
};

export const dateTimeText = iso => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const ACTION_LABELS = {
  'user.rename': 'غيّر الاسم',
  'user.email': 'غيّر الإيميل',
  'user.disable': 'أوقف الحساب',
  'user.enable': 'أعاد تفعيل الحساب',
  'user.promote': 'رقّى إلى أدمن',
  'user.demote': 'خفّض إلى مستخدم',
  'user.reset_password': 'أعاد تعيين كلمة المرور',
  'user.revoke_sessions': 'أنهى كل الجلسات',
  'user.delete': 'حذف الحساب',
  'admin.grant': 'مُنح صلاحية أدمن (من الطرفية)',
  'admin.revoke': 'سُحبت صلاحية الأدمن (من الطرفية)',
};
export const actionLabel = action => ACTION_LABELS[action] || action;

// Heights (0..1) for a bar chart; the tallest bar is 1, and an all-zero series stays flat instead of dividing by 0.
export function barHeights(values, floor = 0) {
  const max = Math.max(0, ...values);
  return values.map(v => (max ? Math.max(v / max, v > 0 ? floor : 0) : 0));
}

// The same share the server computes: ticked / (ticked + missed).
export const rateOf = (done, missed) => (done + missed ? Math.round(100 * done / (done + missed)) : null);

// "٥ نوفمبر" for a YYYY-MM-DD key (UTC, so the viewer's timezone cannot shift the day).
export const monthDay = day => new Date(day + 'T00:00:00Z').toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// Which of `count` equal bars a pointer is over. The chart reads right to left (oldest on the right), so in RTL
// the index grows toward the left. Clamped, so a pointer on the edge still picks the first / last bar.
export function indexAt(x, left, width, count, rtl = true) {
  if (!count || !(width > 0)) return 0;
  const ratio = Math.min(1, Math.max(0, (rtl ? left + width - x : x - left) / width));
  return Math.min(count - 1, Math.floor(ratio * count));
}

// The line under a chart for one bar: "٥ نوفمبر: ٣".
export const barReadout = (day, value) => `${monthDay(day)}: ${num(value)}`;
