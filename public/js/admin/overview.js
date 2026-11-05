// "نظرة عامة": the headline numbers, daily activity and the platform-wide completion rate.
import { $, esc } from '../dom.js';
import { barHeights, barReadout, indexAt, monthDay, num, percent } from './format.js';
import { buildHash } from './route.js';

const SKELETON = `<div class="skel" aria-hidden="true"><i class="skel-hero"></i><i></i><i></i><i class="skel-chart"></i></div>
  <span class="sr-only" role="status">جارٍ التحميل…</span>`;

const summary = (values, label) => `${label}: المجموع ${num(values.reduce((a, b) => a + b, 0))} · الأعلى ${num(Math.max(0, ...values))}`;

// A chart whose bars can be read by touch, mouse or keyboard: the line under it names the bar that is selected
// (a `title` tooltip never shows on a phone).
function dailyChart(id, rows, key, label, alt) {
  const values = rows.map(r => r[key]);
  const heights = barHeights(values);
  const bars = rows.map((r, i) => `<i${values[i] ? '' : ' class="zero"'} style="--h:${heights[i].toFixed(3)}"></i>`).join('');
  return `<div class="chart" data-chart="${id}">
    <div class="cols${alt ? ' alt' : ''}" tabindex="0" role="group" aria-label="${esc(label)}" aria-describedby="read-${id}">${bars}</div>
    <div class="axis"><span>${esc(monthDay(rows[0].day))}</span><span>${esc(monthDay(rows.at(-1).day))}</span></div>
    <p class="readout" id="read-${id}" aria-live="polite" data-default="${esc(summary(values, label))}">${esc(summary(values, label))}</p>
  </div>`;
}

function completionChart(rows) {
  const heights = barHeights(rows.map(r => r.rate ?? 0));
  return `<div class="weekcols">${rows.map((r, i) => `<div>
    <em>${percent(r.rate)}</em>
    <div class="track" role="img" aria-label="أسبوع ${esc(monthDay(r.week))}: ${percent(r.rate)}"><i${r.rate ? '' : ' class="zero"'} style="--h:${heights[i].toFixed(3)}"></i></div>
    <span>${esc(monthDay(r.week))}</span><span>${num(r.notebooks)} دفتر</span>
  </div>`).join('')}</div>`;
}

// Wires the readout line to the bars of every chart inside `root`.
function bindCharts(root, data) {
  for (const chart of root.querySelectorAll('[data-chart]')) {
    const cols = chart.querySelector('.cols'), bars = [...cols.children], out = chart.querySelector('.readout');
    const rows = data[chart.dataset.chart];
    const select = i => {
      bars.forEach((b, n) => b.classList.toggle('on', n === i));
      out.textContent = i < 0 ? out.dataset.default : barReadout(rows.days[i].day, rows.values[i]);
    };
    let at = -1;
    const fromPointer = e => {
      const r = cols.getBoundingClientRect();
      at = indexAt(e.clientX, r.left, r.width, bars.length, getComputedStyle(cols).direction === 'rtl');
      select(at);
    };
    cols.addEventListener('pointermove', fromPointer);
    cols.addEventListener('pointerdown', fromPointer); // a tap on a phone
    cols.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { at = -1; select(-1); } });
    cols.addEventListener('blur', () => { at = -1; select(-1); });
    // Arrows walk the bars in reading order (RTL: right arrow goes back in time).
    cols.addEventListener('keydown', e => {
      const step = { ArrowRight: -1, ArrowLeft: 1, Home: -Infinity, End: Infinity }[e.key];
      if (step === undefined) return;
      const start = at < 0 ? (step > 0 ? -1 : 0) : at;
      at = Math.min(bars.length - 1, Math.max(0, Number.isFinite(step) ? start + step : step < 0 ? 0 : bars.length - 1));
      select(at);
      e.preventDefault();
    });
  }
}

const link = (filter, text, value) =>
  `<a class="kv-link" href="${buildHash({ tab: 'users', filter })}"><span>${text}</span><strong>${num(value)}</strong><i class="ph ph-caret-left" aria-hidden="true"></i></a>`;

export function createOverview({ load, fail }) {
  const body = $('#overviewBody'), err = $('#overviewErr');

  function render({ overview: o, activity, completion }) {
    const plain = [['الجدد خلال ٣٠ يومًا', o.new30], ['نشطون خلال ٣٠ يومًا', o.active30], ['دخلوا خلال ٧ أيام', o.login7]];
    body.innerHTML = `
      <div class="a-section">
        <div class="hero">
          <a class="hero-link" href="${buildHash({ tab: 'users' })}"><b>${num(o.total)}</b><span>إجمالي المستخدمين</span></a>
          <div><b>${num(o.active7)}</b><span>نشطون هذا الأسبوع</span></div>
          <div><b>${num(o.new7)}</b><span>جدد هذا الأسبوع</span></div>
        </div>
        <div class="kv">
          ${plain.map(([k, v]) => `<div><span>${k}</span><strong>${num(v)}</strong></div>`).join('')}
          ${link('disabled', 'موقوفون', o.disabled)}
          ${link('admin', 'أدمن', o.admins)}
        </div>
      </div>
      <div class="overview-grid">
        <div class="a-section">
          <h3>النشاط اليومي</h3>
          <p>مستخدمون عدّلوا دفترهم في اليوم. المس عمودًا لتعرف قيمته. الأيام القديمة قد تُظهر أقل من الحقيقة لأن كل أسبوع يحفظ آخر تعديل فقط.</p>
          ${dailyChart('active', activity, 'active', 'مستخدمون نشطون')}
        </div>
        <div class="a-section">
          <h3>التسجيلات الجديدة</h3>
          <p>عدد الحسابات المنشأة في كل يوم من آخر ٣٠ يومًا.</p>
          ${dailyChart('signups', activity, 'signups', 'تسجيلات جديدة', true)}
        </div>
      </div>
      <div class="a-section">
        <h3>نسبة الإنجاز في آخر ٦ أسابيع</h3>
        <p>من الخانات التي عُلِّمت (أنجزت أو فاتت) عند كل المستخدمين. الخانات الفارغة لا تُحسب.</p>
        ${completionChart(completion)}
      </div>`;
    const days = activity;
    bindCharts(body, {
      active: { days, values: activity.map(r => r.active) },
      signups: { days, values: activity.map(r => r.signups) },
    });
  }

  return {
    async load() {
      err.hidden = true;
      if (!body.firstElementChild || body.querySelector('.skel')) body.innerHTML = SKELETON;
      else body.classList.add('loading');
      try {
        render(await load());
      } catch (e) {
        if (!fail(e)) {
          if (body.querySelector('.skel')) body.innerHTML = '';
          err.textContent = e.message;
          err.hidden = false;
        }
      } finally {
        body.classList.remove('loading');
      }
    },
  };
}
