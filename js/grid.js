// Weekly grid: HTML for the screen, canvas for the image export.
import { DAYS, mins, fmtTime, typeLabel, range } from './model.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const MODE_TAG = { rec: '🎥', skip: '✕', moved: '↪', alt: '↩' };

/** Which blocks a view shows: "reg" = what I'm registered to, "att" = where I actually am. */
export function visible(blocks, view) {
  return view === 'reg' ? blocks.filter((b) => b.registered || b.mode === 'moved') : blocks;
}

const STRIPE = 18; // % of a day column kept for lessons I'm not attending, when they share an hour with one I am
const passiveMode = (m) => m === 'skip' || m === 'moved';
const overlap = (a, b) => a.start < b.end && b.start < a.end;
const span = (b) => ({ start: mins(b.m.start), end: mins(b.m.end) });

/**
 * Places blocks in each day column. Rules, so nothing gets squeezed into unreadable slivers:
 * - A lesson I attend takes the full width; one I skip (or am registered to but sit elsewhere)
 *   becomes a narrow stripe at the side when it shares an hour with one I attend.
 * - Two lessons I attend at the same time become one "⚠ N שיעורים" block that opens a list.
 * - A day with any of that gets a wider column.
 * items: { day, start, end, right, width (percent), kind: 'one' | 'stripe' | 'clash', blocks }
 */
function layout(list, view) {
  const days = [1, 2, 3, 4, 5];
  if (list.some((b) => b.m.day === 6)) days.push(6);
  let lo = 8, hi = 18;
  for (const b of list) {
    lo = Math.min(lo, Math.floor(mins(b.m.start) / 60));
    hi = Math.max(hi, Math.ceil(mins(b.m.end) / 60));
  }
  const items = [];
  const wide = new Set();
  const isPassive = (b) => view === 'att' && passiveMode(b.mode);
  for (const d of days) {
    const dayList = list.filter((b) => b.m.day === d).sort((a, b) => mins(a.m.start) - mins(b.m.start));
    // lessons I attend: merge the ones that clash
    const act = [];
    for (const b of dayList.filter((x) => !isPassive(x))) {
      const sp = span(b);
      const last = act[act.length - 1];
      if (last && sp.start < last.end) {
        last.blocks.push(b);
        last.end = Math.max(last.end, sp.end);
        last.kind = 'clash';
      } else act.push({ day: d, ...sp, kind: 'one', blocks: [b], right: 0, width: 100 });
    }
    // lessons I don't attend: a side stripe next to attended ones, side-by-side lanes otherwise
    const pas = dayList.filter(isPassive).map((b) => ({ day: d, ...span(b), kind: 'one', blocks: [b] }));
    const stripes = pas.filter((p) => act.some((a) => overlap(a, p)));
    const free = pas.filter((p) => !stripes.includes(p));
    for (const a of act) if (stripes.some((p) => overlap(a, p))) a.width = 100 - STRIPE;
    const lanesFor = (group, right0, width) => {
      const ends = [];
      const placed = group.map((it) => {
        let lane = ends.findIndex((e) => e <= it.start);
        if (lane < 0) lane = ends.length;
        ends[lane] = it.end;
        return [it, lane];
      });
      for (const [it, lane] of placed) {
        it.width = width / ends.length;
        it.right = right0 + lane * it.width;
      }
      return ends.length;
    };
    lanesFor(stripes.map((p) => Object.assign(p, { kind: 'stripe' })), 100 - STRIPE, STRIPE);
    const freeLanes = lanesFor(free, 0, 100);
    if (stripes.length || freeLanes > 1 || act.some((a) => a.kind === 'clash')) wide.add(d);
    items.push(...act, ...stripes, ...free);
  }
  return { days, lo, hi, items, wide };
}

// Blocks behind each rendered grid, so a tap on a merged "⚠" block can list what's in it.
const registry = new Map();
let gridSeq = 0;
export const gridBlocks = (id) => registry.get(+id) || [];

export function weekHtml(blocks, { view = 'att', hueOf, tap = false } = {}) {
  const list = visible(blocks, view).filter((b) => b.m.day >= 1 && b.m.day <= 6);
  const { days, lo, hi, items, wide } = layout(list, view);
  const gid = ++gridSeq;
  registry.set(gid, blocks);
  if (registry.size > 40) registry.delete(registry.keys().next().value);
  const total = (hi - lo) * 60;
  const pct = (m) => ((m - lo * 60) / total) * 100;
  const cols = days.map((d) => (wide.has(d) ? 'minmax(var(--col-wide), 1.7fr)' : 'minmax(var(--col-min), 1fr)')).join(' ');
  let html = `<div class="week-wrap"><div class="week" data-grid="${gid}" style="grid-template-columns: var(--hcol) ${cols}">`;
  html += `<div class="wh"></div>` + days.map((d) => `<div class="wh">${DAYS[d]}</div>`).join('');
  html += `<div class="hours" style="height:calc(var(--hour) * ${hi - lo})">`;
  for (let h = lo + 1; h < hi; h++) html += `<span style="top:${pct(h * 60)}%">${h}:00</span>`;
  html += `</div>`;
  const label = (b) => `${b.course.name} · ${typeLabel(b.g.type)} ${b.g.n} · ${range(b.m.start, b.m.end)}${b.g.lecturer ? ' · ' + b.g.lecturer : ''}`;
  for (const d of days) {
    html += `<div class="col" style="height:calc(var(--hour) * ${hi - lo})">`;
    for (const it of items.filter((x) => x.day === d)) {
      const pos = `top:${pct(it.start)}%;height:calc(${((it.end - it.start) / total) * 100}% - 2px);right:calc(${it.right}% + 2px);width:calc(${it.width}% - 4px)`;
      if (it.kind === 'clash') {
        html += `<button class="blk clash" data-clash="${it.blocks.map((b) => blocks.indexOf(b)).join(',')}" style="${pos}" title="${esc(it.blocks.map(label).join('\n'))}">
          <b>⚠ ${it.blocks.length} שיעורים</b>
          ${it.blocks.map((b) => `<span class="t" style="--h:${hueOf(b.course.id)}"><i class="cdot"></i>${esc(shortName(b.course.name))}</span>`).join('')}
        </button>`;
        continue;
      }
      const b = it.blocks[0];
      const mode = view === 'reg' ? 'go' : b.mode;
      const tag = view === 'att' ? MODE_TAG[mode] || '' : '';
      const common = `data-bi="${blocks.indexOf(b)}" ${tap ? '' : 'tabindex="-1"'} title="${esc(label(b))}"`;
      if (it.kind === 'stripe') {
        html += `<button class="blk stripe m-${mode}" ${common} style="--h:${hueOf(b.course.id)};${pos}" aria-label="${esc(label(b))}"><span class="tag">${tag}</span></button>`;
        continue;
      }
      html += `<button class="blk m-${mode}" ${common} style="--h:${hueOf(b.course.id)};${pos}">
        ${tag ? `<span class="tag">${tag}</span>` : ''}
        <b>${esc(shortName(b.course.name))}</b>
        <span class="t"><span class="full">${esc(typeLabel(b.g.type))}</span><span class="abbr">${esc(typeLabel(b.g.type).slice(0, 3))}׳</span> ${b.g.n}</span>
        ${b.g.lecturer ? `<span class="p">${esc(shortPerson(b.g.lecturer))}</span>` : ''}
      </button>`;
    }
    html += `</div>`;
  }
  return html + `</div></div>`;
}

/** "מבוא ללוגיקה ולתורת הקבוצות…" → "לוגיקה": most first-year courses start with "מבוא", which says nothing in a small block. */
/** "ד\"ר י. מייזל" → "י. מייזל": the title takes room a small block doesn't have. */
export const shortPerson = (name) => (name || '').replace(/^(ד"ר|פרופ['׳]|מר|גב['׳]|הרב|עו"ד)\s+/, '').replace(/\. /g, '.\u00a0');

export function shortName(name) {
  let s = name.replace(/^מבוא\s+(ל|ל-)?/, '').replace(/ למדעי המחשב והנדסת תכנה| להנדסה$/, '');
  const words = s.split(' ');
  if (words.length > 2) s = words[1].startsWith('ו') ? words[0] : words.slice(0, 2).join(' ');
  return s.length > 22 ? s.slice(0, 20) + '…' : s;
}

/** Draws the grid to a PNG blob (for WhatsApp etc.). */
export async function weekPng(blocks, { view = 'att', hueOf, title = '' }) {
  const list = visible(blocks, view).filter((b) => b.m.day >= 1 && b.m.day <= 6);
  const { days, lo, hi, items, wide } = layout(list, view);
  const W = 1200, left = 70, top = title ? 110 : 60, hourH = 64;
  const H = top + (hi - lo) * hourH + 30;
  const weights = days.map((d) => (wide.has(d) ? 1.7 : 1));
  const unit = (W - left - 20) / weights.reduce((a, b) => a + b, 0);
  const c = document.createElement('canvas');
  c.width = W * 2; c.height = H * 2;
  const x = c.getContext('2d');
  x.scale(2, 2);
  x.direction = 'rtl';
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, W, H);
  const font = (w, s) => `${w} ${s}px Rubik, Arial, sans-serif`;
  if (title) {
    x.fillStyle = '#1b1f24'; x.font = font(700, 30); x.textAlign = 'right';
    x.fillText(title, W - 24, 52);
  }
  // columns right-to-left: day 1 at the right
  const colRight = (i) => W - 20 - weights.slice(0, i).reduce((a, b) => a + b, 0) * unit;
  const colW = (i) => weights[i] * unit;
  x.textAlign = 'center'; x.font = font(600, 18); x.fillStyle = '#1b1f24';
  days.forEach((d, i) => x.fillText(`יום ${DAYS[d]}`, colRight(i) - colW(i) / 2, top - 16));
  x.strokeStyle = '#e2e6eb'; x.lineWidth = 1;
  x.font = font(400, 14); x.fillStyle = '#8a94a3'; x.textAlign = 'right';
  for (let h = lo; h <= hi; h++) {
    const y = top + (h - lo) * hourH;
    x.beginPath(); x.moveTo(20, y); x.lineTo(W - 20, y); x.stroke();
    if (h < hi) x.fillText(`${h}:00`, left - 12, y + 16);
  }
  days.forEach((_, i) => { const cx = colRight(i) - colW(i); x.beginPath(); x.moveTo(cx, top); x.lineTo(cx, H - 30); x.stroke(); });
  for (const it of items) {
    const i = days.indexOf(it.day);
    const bx = colRight(i) - ((it.right + it.width) / 100) * colW(i) + 3;
    const bw = (it.width / 100) * colW(i) - 6;
    const by = top + ((it.start - lo * 60) / 60) * hourH + 2;
    const bh = ((it.end - it.start) / 60) * hourH - 4;
    const tx = bx + bw - 12;
    x.textAlign = 'right';
    if (it.kind === 'clash') {
      x.fillStyle = '#fde5e7'; x.strokeStyle = '#b4232f'; x.lineWidth = 2; x.setLineDash([]);
      roundRect(x, bx, by, bw, bh, 8); x.fill(); x.stroke();
      x.fillStyle = '#b4232f'; x.font = font(600, 14);
      x.fillText(clip(x, `⚠ ${it.blocks.length} שיעורים`, bw - 20), tx, by + 18);
      x.font = font(400, 12);
      it.blocks.forEach((b, k) => { if (22 + (k + 1) * 16 < bh) x.fillText(clip(x, shortName(b.course.name), bw - 20), tx, by + 20 + (k + 1) * 16); });
      continue;
    }
    const b = it.blocks[0];
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
    const tag = view === 'att' && MODE_TAG[mode] ? MODE_TAG[mode] : '';
    if (it.kind === 'stripe') {
      x.fillStyle = `hsl(${hue} 60% 20%)`; x.font = font(400, 13); x.textAlign = 'center';
      x.fillText(tag, bx + bw / 2, by + 18);
      x.globalAlpha = 1;
      continue;
    }
    x.fillStyle = `hsl(${hue} 60% 20%)`;
    x.font = font(600, 14); x.fillText(clip(x, shortName(b.course.name), bw - 20), tx, by + 17);
    x.font = font(400, 12);
    x.fillText(clip(x, `${typeLabel(b.g.type)} ${b.g.n} · ${range(b.m.start, b.m.end)}${tag ? ' ' + tag : ''}`, bw - 20), tx, by + 34);
    if (b.g.lecturer) x.fillText(clip(x, shortPerson(b.g.lecturer), bw - 20), tx, by + 50);
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
