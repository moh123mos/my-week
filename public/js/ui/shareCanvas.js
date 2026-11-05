// Paints the share picture on a canvas. The model and the positions come from share.js; nothing here decides content.
import { DAYS_IN_WEEK, SHARE } from '../config.js';
import { MOON_RADIUS, moonPath } from '../moon.js';
import { layoutFor, moreText } from '../share.js';

const C = SHARE.COLORS, L = SHARE.LAYOUT, W = SHARE.WIDTH, M = L.margin;
const UI = '"Cairo", sans-serif';
const HAND = '"Aref Ruqaa", "Cairo", serif';
const MARIA = [[38, 34, 11], [62, 48, 7], [44, 68, 9], [72, 28, 4]];
const LOGO_DOTS = [[22.05, 7.98], [13.62, 13.62], [7.98, 22.05], [6, 32], [7.98, 41.95], [13.62, 50.38], [22.05, 56.02]];
const LOGO = new Path2D('M32 6A26 26 0 0 1 32 58A13.5 26 0 0 0 32 6Z');

let fontsReady = null;
// The picture must not be painted in a fallback font because the real one was still downloading.
export function loadShareFonts() {
  fontsReady ||= (async () => {
    const sample = 'أسبوعي الأحد السبت 0123456789';
    const faces = ['700 56px "Aref Ruqaa"', '400 30px "Aref Ruqaa"', '500 30px Cairo', '600 30px Cairo', '700 30px Cairo'];
    try { await Promise.all(faces.map(face => document.fonts.load(face, sample))); } catch (_) { /* paint with what we have */ }
  })();
  return fontsReady;
}

const font = (weight, size, family) => `${weight} ${size}px ${family}`;

function text(ctx, str, x, y, { f, color, align = 'right', maxW, dir = 'rtl' }) {
  ctx.font = f;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.direction = dir;
  let out = String(str);
  if (maxW && ctx.measureText(out).width > maxW) {
    while (out.length > 1 && ctx.measureText(out + '…').width > maxW) out = out.slice(0, -1);
    out += '…';
  }
  ctx.fillText(out, x, y);
  ctx.direction = 'rtl';
}

function moon(ctx, cx, cy, r, fraction, withMaria) {
  ctx.save();
  ctx.translate(cx - r, cy - r);
  const k = (r * 2) / 100;
  ctx.scale(k, k);
  ctx.beginPath();
  ctx.arc(50, 50, MOON_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = C.moonDark;
  ctx.fill();
  if (fraction > 0) {
    const lit = new Path2D(moonPath(fraction));
    ctx.fillStyle = C.moon;
    ctx.fill(lit);
    if (withMaria) {
      ctx.save();
      ctx.clip(lit);
      ctx.fillStyle = C.mare;
      for (const [x, y, rad] of MARIA) { ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
  }
  ctx.restore();
}

function logo(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 64, size / 64);
  ctx.fillStyle = C.moon;
  ctx.fill(LOGO);
  for (const [cx, cy] of LOGO_DOTS) { ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

function line(ctx, x1, x2, y, color = C.rule, width = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
}

function cell(ctx, state, cx, cy, r, color, future) {
  ctx.save();
  if (state === -1) { // not tracked this day: keeps its place but fades
    ctx.globalAlpha = .2;
    ctx.strokeStyle = C.rule;
  } else {
    ctx.globalAlpha = state === 0 && future ? .45 : 1;
    ctx.strokeStyle = state === 1 ? color : C.ruleStrong;
  }
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (state === 1) { ctx.fillStyle = color; ctx.fill(); }
  else if (state === 2) { ctx.fillStyle = C.missFill; ctx.fill(); }
  if (state !== 2) ctx.stroke();
  ctx.restore();

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = r * .22;
  if (state === 1) {
    ctx.strokeStyle = C.moonInk;
    ctx.beginPath();
    ctx.moveTo(cx - r * .38, cy + r * .02);
    ctx.lineTo(cx - r * .1, cy + r * .3);
    ctx.lineTo(cx + r * .42, cy - r * .28);
    ctx.stroke();
  } else if (state === 2) {
    ctx.strokeStyle = C.miss;
    ctx.beginPath();
    ctx.moveTo(cx - r * .32, cy);
    ctx.lineTo(cx + r * .32, cy);
    ctx.stroke();
  }
}

function background(ctx, H) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
}

const width = (ctx, str, f) => { ctx.font = f; return ctx.measureText(str).width; };

// The day columns of the grid. The seven moons of the rhythm sit in the same columns, so the page reads as one table.
function columns() {
  const areaRight = W - M - L.nameW;
  const cellW = (areaRight - (M + L.countW)) / DAYS_IN_WEEK;
  return { areaRight, cellW, dayX: i => areaRight - cellW * (i + .5) };
}

// Centred on the page: the logo and name as one unit, the notebook's owner under it, then the dates.
function header(ctx, model, y) {
  // Logo and title are one unit; the owner's name is its own line below, so a long name never crowds the logo.
  const titleF = font(700, 64, HAND), gap = 28, size = 80;
  const titleW = width(ctx, 'أسبوعي', titleF);
  const right = (W + size + gap + titleW) / 2;
  logo(ctx, right - size, y, size);
  text(ctx, 'أسبوعي', right - size - gap - titleW / 2, y + size / 2, { f: titleF, color: C.moon, align: 'center' });
  const byline = model.userName ? `دفتر ${model.userName}` : 'دفتر العادات والبدايات';
  text(ctx, byline, W / 2, y + size + 34, {
    f: font(model.userName ? 600 : 500, 28, UI), color: C.ink2, align: 'center', maxW: W - 2 * M,
  });
  const when = model.hijri ? `${model.range} · ${model.hijri}` : model.range;
  text(ctx, when, W / 2, y + size + 82, { f: font(600, 30, UI), color: C.ink, align: 'center', maxW: W - 2 * M });
}

// The moon and its words form one group, centred on the page; the words are centred under each other.
function summary(ctx, model, y) {
  const r = 100, gap = 44, cy = y + L.summary / 2;
  const pctF = font(700, 96, UI), titleF = font(700, 46, HAND), subF = font(500, 26, UI);
  const textW = Math.min(W - 2 * M - 2 * r - gap, Math.max(
    width(ctx, `${model.percent}%`, pctF), width(ctx, model.title, titleF), width(ctx, model.subtitle, subF),
  ));
  const right = (W + 2 * r + gap + textW) / 2; // the moon's right edge
  moon(ctx, right - r, cy, r, model.ratio, true);
  const mid = right - 2 * r - gap - textW / 2;
  text(ctx, `${model.percent}%`, mid, y + 66, { f: pctF, color: C.moon, align: 'center', maxW: textW });
  text(ctx, model.title, mid, y + 140, { f: titleF, color: C.ink, align: 'center', maxW: textW });
  text(ctx, model.subtitle, mid, y + 190, { f: subF, color: C.ink2, align: 'center', maxW: textW });
}

function rows(ctx, model, lay) {
  const { plan, blocks, y } = lay;
  const { cellW, dayX } = columns();
  const rowsEnd = y.rows + blocks.reduce((a, b) => a + b, 0) + (plan.hidden ? L.moreH : 0);

  if (model.todayIdx >= 0) {
    ctx.fillStyle = C.moonTint;
    ctx.beginPath();
    ctx.roundRect(dayX(model.todayIdx) - cellW / 2 + 3, y.dayHead, cellW - 6, rowsEnd - y.dayHead, 16);
    ctx.fill();
  }

  model.bars.forEach((bar, i) => {
    const today = i === model.todayIdx;
    text(ctx, bar.label, dayX(i), y.dayHead + 26, { f: font(700, 30, UI), color: today ? C.moon : C.ink, align: 'center' });
    text(ctx, bar.date, dayX(i), y.dayHead + 54, { f: font(500, 22, UI), color: C.ink2, align: 'center' });
  });
  line(ctx, M, W - M, y.rows, C.ruleStrong);

  let top = y.rows;
  plan.shown.forEach((row, n) => {
    const block = blocks[n], cy = top + plan.rowH / 2, color = C.periods[row.period];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(W - M - 8, cy, 8, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, row.name, W - M - 30, cy + 2, { f: font(600, 30, UI), color: C.ink, maxW: L.nameW - 46 });

    const r = Math.min(27, plan.rowH * .36);
    row.cells.forEach((state, day) => cell(ctx, state, dayX(day), cy, r, color, day >= model.elapsed));

    text(ctx, `${row.done} / ${row.active}`, M + 6, cy + 2, {
      f: font(700, 28, UI), color: row.done ? C.ink : C.ink2, align: 'left', dir: 'ltr',
    });
    if (block > plan.rowH) {
      text(ctx, row.note, W - M, top + plan.rowH + (block - plan.rowH) / 2 - 4, {
        f: font(400, 27, HAND), color: C.ink2, maxW: W - 2 * M,
      });
    }
    top += block;
    line(ctx, M, W - M, top);
  });

  if (plan.hidden) {
    text(ctx, moreText(plan.hidden), W / 2, top + L.moreH / 2, { f: font(600, 26, UI), color: C.ink2, align: 'center' });
  }
}

function rhythm(ctx, model, lay) {
  const y = lay.y.rhythm;
  const { dayX } = columns(), top = y + L.rhythmTitle;
  line(ctx, M, W - M, y + 8, C.ruleStrong);
  // the title stands in the names column and the total in the count column, level with the moons
  text(ctx, 'إيقاع الأسبوع', W - M, top + 62, { f: font(700, 40, HAND), color: C.ink });
  text(ctx, `${model.done} / ${model.total}`, M + 6, top + 62, { f: font(700, 28, UI), color: C.ink, align: 'left', dir: 'ltr' });
  model.bars.forEach((bar, i) => {
    const cx = dayX(i), today = i === model.todayIdx;
    if (bar.show && bar.count) text(ctx, bar.count, cx, top + 20, { f: font(600, 24, UI), color: C.ink2, align: 'center' });
    moon(ctx, cx, top + 62, 28, bar.ratio, false);
    text(ctx, bar.label, cx, top + 112, { f: font(600, 26, UI), color: today ? C.moon : C.ink2, align: 'center' });
  });
  if (lay.stats) {
    const sy = top + L.bars + L.stat / 2, half = (W - 2 * M) / 2 - 12;
    if (model.best) text(ctx, `الأقوى: ${model.best}`, W - M, sy, { f: font(600, 27, UI), color: C.moon, maxW: half });
    if (model.worst) text(ctx, `يحتاج عناية: ${model.worst}`, M, sy, { f: font(500, 27, UI), color: C.ink2, align: 'left', maxW: half });
  }
}

// Sizes the canvas and paints the whole picture. Returns the layout that was used.
export function drawShare(canvas, model, sizeKey, notes) {
  const lay = layoutFor(model, sizeKey, notes);
  canvas.width = lay.W;
  canvas.height = lay.H;
  const ctx = canvas.getContext('2d');
  ctx.direction = 'rtl';
  ctx.textBaseline = 'middle';
  background(ctx, lay.H);
  header(ctx, model, lay.y.head);
  summary(ctx, model, lay.y.summary);
  rows(ctx, model, lay);
  rhythm(ctx, model, lay);
  text(ctx, 'أسبوعي · دفتر العادات والبدايات', W / 2, lay.y.footer, { f: font(500, 24, UI), color: C.ink2, align: 'center' });
  return lay;
}
