// Weekly grid: HTML for the screen, canvas for the image export.
import { DAYS, mins, fmtTime, typeLabel, range } from './model.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const MODE_TAG = { rec: '🎥', skip: '✕', moved: '↪', alt: '↩' };

/** Which blocks a view shows: "reg" = what I'm registered to, "att" = where I actually am. */
export function visible(blocks, view) {
  return view === 'reg' ? blocks.filter((b) => b.registered || b.mode === 'moved') : blocks;
}

function layout(list) {
  const days = [1, 2, 3, 4, 5];
  if (list.some((b) => b.m.day === 6)) days.push(6);
  let lo = 8, hi = 18;
  for (const b of list) {
    lo = Math.min(lo, Math.floor(mins(b.m.start) / 60));
    hi = Math.max(hi, Math.ceil(mins(b.m.end) / 60));
  }
  // side-by-side lanes for blocks that overlap on the same day
  const lanes = new Map();
  for (const d of days) {
    const dayList = list.filter((b) => b.m.day === d).sort((a, b) => mins(a.m.start) - mins(b.m.start));
    let cluster = [], clusterEnd = -1;
    const flush = () => {
      const ends = [];
      for (const b of cluster) {
        let lane = ends.findIndex((e) => e <= mins(b.m.start));
        if (lane < 0) lane = ends.length;
        ends[lane] = mins(b.m.end);
        lanes.set(b, { lane });
      }
      for (const b of cluster) lanes.get(b).of = ends.length;
      cluster = [];
    };
    for (const b of dayList) {
      if (mins(b.m.start) >= clusterEnd && cluster.length) flush();
      cluster.push(b);
      clusterEnd = Math.max(clusterEnd, mins(b.m.end));
    }
    if (cluster.length) flush();
  }
  return { days, lo, hi, lanes };
}

export function weekHtml(blocks, { view = 'att', hueOf, tap = false } = {}) {
  const list = visible(blocks, view).filter((b) => b.m.day >= 1 && b.m.day <= 6);
  const { days, lo, hi, lanes } = layout(list);
  const total = (hi - lo) * 60;
  const hourPct = (m) => ((m - lo * 60) / total) * 100;
  let html = `<div class="week-wrap"><div class="week" style="--days:${days.length}">`;
  html += `<div class="wh"></div>` + days.map((d) => `<div class="wh">${DAYS[d]}</div>`).join('');
  html += `<div class="hours" style="height:calc(var(--hour) * ${hi - lo})">`;
  for (let h = lo + 1; h < hi; h++) html += `<span style="top:${hourPct(h * 60)}%">${h}:00</span>`;
  html += `</div>`;
  for (const d of days) {
    html += `<div class="col" style="height:calc(var(--hour) * ${hi - lo})">`;
    for (const b of list.filter((x) => x.m.day === d)) {
      const s = mins(b.m.start), e = mins(b.m.end);
      const { lane, of } = lanes.get(b);
      const w = 100 / of;
      const mode = view === 'reg' ? 'go' : b.mode;
      const tag = view === 'att' ? MODE_TAG[mode] || '' : '';
      html += `<button class="blk m-${mode}" data-bi="${blocks.indexOf(b)}" ${tap ? '' : 'tabindex="-1"'}
        style="--h:${hueOf(b.course.id)};top:${hourPct(s)}%;height:calc(${((e - s) / total) * 100}% - 2px);right:calc(${lane * w}% + 2px);width:calc(${w}% - 4px)"
        title="${esc(`${b.course.name} · ${typeLabel(b.g.type)} ${b.g.n} · ${range(b.m.start, b.m.end)}${b.g.lecturer ? ' · ' + b.g.lecturer : ''}`)}">
        ${tag ? `<span class="tag">${tag}</span>` : ''}
        <b>${esc(shortName(b.course.name))}</b>
        <span class="t">${esc(typeLabel(b.g.type))} ${b.g.n}</span>
        ${e - s >= 90 ? `<span class="p">${esc(b.g.lecturer || '')}</span>` : ''}
      </button>`;
    }
    html += `</div>`;
  }
  return html + `</div></div>`;
}

/** "מבוא ללוגיקה ולתורת הקבוצות…" → "לוגיקה": most first-year courses start with "מבוא", which says nothing in a small block. */
export function shortName(name) {
  let s = name.replace(/^מבוא\s+(ל|ל-)?/, '').replace(/ למדעי המחשב והנדסת תכנה| להנדסה$/, '');
  const words = s.split(' ');
  if (words.length > 2) s = words[1].startsWith('ו') ? words[0] : words.slice(0, 2).join(' ');
  return s.length > 22 ? s.slice(0, 20) + '…' : s;
}

/** Draws the grid to a PNG blob (for WhatsApp etc.). */
export async function weekPng(blocks, { view = 'att', hueOf, title = '' }) {
  const list = visible(blocks, view).filter((b) => b.m.day >= 1 && b.m.day <= 6);
  const { days, lo, hi, lanes } = layout(list);
  const dark = false;
  const W = 1200, left = 70, top = title ? 110 : 60, hourH = 64;
  const H = top + (hi - lo) * hourH + 30;
  const colW = (W - left - 20) / days.length;
  const c = document.createElement('canvas');
  c.width = W * 2; c.height = H * 2;
  const x = c.getContext('2d');
  x.scale(2, 2);
  x.direction = 'rtl';
  x.fillStyle = dark ? '#14171c' : '#ffffff';
  x.fillRect(0, 0, W, H);
  const font = (w, s) => `${w} ${s}px Rubik, Arial, sans-serif`;
  if (title) {
    x.fillStyle = '#1b1f24'; x.font = font(700, 30); x.textAlign = 'right';
    x.fillText(title, W - 24, 52);
  }
  // columns right-to-left: day 1 at the right
  const colX = (i) => W - 20 - (i + 1) * colW;
  x.textAlign = 'center'; x.font = font(600, 18); x.fillStyle = '#1b1f24';
  days.forEach((d, i) => x.fillText(`יום ${DAYS[d]}`, colX(i) + colW / 2, top - 16));
  x.strokeStyle = '#e2e6eb'; x.lineWidth = 1;
  x.font = font(400, 14); x.fillStyle = '#8a94a3'; x.textAlign = 'right';
  for (let h = lo; h <= hi; h++) {
    const y = top + (h - lo) * hourH;
    x.beginPath(); x.moveTo(20, y); x.lineTo(W - 20, y); x.stroke();
    if (h < hi) x.fillText(`${h}:00`, left - 12, y + 16);
  }
  days.forEach((_, i) => { x.beginPath(); x.moveTo(colX(i), top); x.lineTo(colX(i), H - 30); x.stroke(); });
  for (const b of list) {
    const i = days.indexOf(b.m.day);
    const { lane, of } = lanes.get(b);
    const w = colW / of;
    const bx = colX(i) + colW - (lane + 1) * w + 3, by = top + ((mins(b.m.start) - lo * 60) / 60) * hourH + 2;
    const bw = w - 6, bh = ((mins(b.m.end) - mins(b.m.start)) / 60) * hourH - 4;
    const hue = hueOf(b.course.id);
    const mode = view === 'reg' ? 'go' : b.mode;
    const faded = mode === 'skip' || mode === 'moved';
    x.globalAlpha = faded ? 0.45 : 1;
    x.fillStyle = mode === 'rec' || faded ? '#ffffff' : `hsl(${hue} 75% 93%)`;
    x.strokeStyle = `hsl(${hue} 55% 42%)`;
    x.lineWidth = 1.5;
    x.setLineDash(mode === 'rec' || faded || mode === 'alt' ? [6, 4] : []);
    roundRect(x, bx, by, bw, bh, 8); x.fill(); x.stroke();
    x.setLineDash([]);
    x.fillStyle = `hsl(${hue} 55% 42%)`; x.fillRect(bx + bw - 5, by, 5, bh);
    x.fillStyle = `hsl(${hue} 60% 20%)`; x.textAlign = 'right';
    const tx = bx + bw - 12;
    x.font = font(600, 15); x.fillText(clip(x, shortName(b.course.name), bw - 20), tx, by + 20);
    x.font = font(400, 13);
    const tag = view === 'att' && MODE_TAG[mode] ? ` ${MODE_TAG[mode]}` : '';
    x.fillText(clip(x, `${typeLabel(b.g.type)} ${b.g.n} · ${range(b.m.start, b.m.end)}${tag}`, bw - 20), tx, by + 38);
    if (bh > 70 && b.g.lecturer) x.fillText(clip(x, b.g.lecturer, bw - 20), tx, by + 56);
    x.globalAlpha = 1;
  }
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

function roundRect(x, a, b, w, h, r) {
  x.beginPath();
  x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r);
  x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath();
}
function clip(x, s, max) {
  if (x.measureText(s).width <= max) return s;
  while (s.length > 1 && x.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s + '…';
}

export { fmtTime };
