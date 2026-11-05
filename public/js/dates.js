// Week keys are local dates formatted YYYY-MM-DD, always a Saturday (the week's first day).

const pad = x => String(x).padStart(2, '0');

export const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromKey = k => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const rangeFormat = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'long' });
// "24 أكتوبر – 30 أكتوبر" for the week that starts on this key.
export const weekRangeText = k => {
  const first = fromKey(k);
  return `${rangeFormat.format(first)} – ${rangeFormat.format(addDays(first, 6))}`;
};
const hijriFormat = (() => {
  // Not every browser ships this calendar; the Hijri line is simply left out then.
  try { return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { month: 'long', year: 'numeric' }); }
  catch (_) { return null; }
})();
// "ربيع الآخر 1448" for the week that starts on this key, or '' where the calendar is missing.
export const weekHijriText = k => (hijriFormat ? hijriFormat.format(fromKey(k)) : '');
// 0 = Saturday .. 6 = Friday
export const dayIndex = d => (d.getDay() + 1) % 7;
const weekStart = d => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -dayIndex(d));

export const weekKeyOf = d => keyOf(weekStart(d));
export const todayKey = () => weekKeyOf(new Date());
export const shiftWeek = (k, weeks) => keyOf(addDays(fromKey(k), 7 * weeks));
export const prevKey = k => shiftWeek(k, -1);
