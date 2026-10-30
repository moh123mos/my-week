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
// 0 = Saturday .. 6 = Friday
export const dayIndex = d => (d.getDay() + 1) % 7;
const weekStart = d => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -dayIndex(d));

export const weekKeyOf = d => keyOf(weekStart(d));
export const todayKey = () => weekKeyOf(new Date());
export const shiftWeek = (k, weeks) => keyOf(addDays(fromKey(k), 7 * weeks));
export const prevKey = k => shiftWeek(k, -1);
