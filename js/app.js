import * as store from './store.js';
import * as data from './data.js';
import {
  components, courseOptions, blocks as makeBlocks, solve, missedStars, weekStats, findGroup, alternatives,
  typeLabel, range, DAYS, DAY_FULL, DEFAULT_PREFS, DEFAULT_WEIGHTS, rating, RATE, overlaps, fmtTime,
} from './model.js';
import { weekHtml, weekPng, esc, shortName } from './grid.js';
import {
  encodePlan, decodePlan, registrationRows, registrationText, ics, download,
  pack, unpack, sanitizeState, encodeCourseList, decodeCourseList,
} from './share.js';
import { CONFIG } from './config.js';

const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const HUES = [212, 24, 150, 280, 345, 188, 45, 100, 255, 5];

const ui = {
  tab: 'courses',
  index: [],
  courses: new Map(), // id → course data for the current semester
  loading: new Set(),
  open: {},
  brush: 2,
  results: null,
  resultsKey: '',
  shown: {},
  limit: 10,
  compare: [],
  plan: null,
  planView: 'att',
  shared: null,
  error: null,
};

// ---------- helpers ----------
const S = () => store.get();
const sem = () => store.sem();
const cprefs = (id) => sem().courses[id] || (sem().courses[id] = { prefs: {}, pins: {} });
const hueOf = (id) => {
  const i = sem().order.indexOf(id);
  if (i >= 0) return HUES[i % HUES.length];
  const j = ui.shared ? Object.keys(ui.shared.plan.picks).indexOf(id) : -1;
  if (j >= 0) return HUES[j % HUES.length];
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
};
const myCourses = () => sem().order.map((id) => ui.courses.get(id)).filter(Boolean);
const fmtMeet = (m) => `<span class="nw">${DAYS[m.day]} ${range(m.start, m.end)}</span>`;
const hours = (n) => (Number.isInteger(n) ? n : n.toFixed(1));
/** Ratings of one course; the first time a course is seen, it starts from the old app-wide ratings. */
function ratingsOf(id) {
  const cs = sem().courses[id];
  if (!cs) return S().ratings;
  if (!cs.ratings) {
    if (S().seen.perCourseRatings) return (cs.ratings = {});
    const c = ui.courses.get(id);
    if (!c) return S().ratings;
    const names = new Set(c.groups.flatMap((g) => [g, ...(g.subs || [])]).map((g) => g.lecturer).filter(Boolean));
    cs.ratings = Object.fromEntries(Object.entries(S().ratings).filter(([n]) => names.has(n)));
  }
  return cs.ratings;
}

const starOf = (name, id) => {
  const r = rating(ratingsOf(id), name);
  return r === RATE.REC ? '<span class="star">⭐</span>' : r === RATE.OK ? '<span>👌</span>' : r === RATE.AVOID ? '<span class="avoid">🚫</span>' : '';
};

/** Share sheet on phones, clipboard elsewhere. Resolves true when the link left the page. */
async function shareUrl(url, title, text) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
  }
  try { await navigator.clipboard.writeText(url); toast('הקישור הועתק'); return true; } catch { await ask({ title: 'העתיקו את הקישור', copy: url, yes: 'סגירה' }); return true; }
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2400);
}

async function ensureCourse(id) {
  if (ui.courses.has(id) || ui.loading.has(id)) return;
  ui.loading.add(id);
  try {
    ui.courses.set(id, await data.course(S().semester, id));
  } catch {
    ui.error = `לא הצלחתי לטעון את הקורס ${data.displayId(id)}`;
  }
  ui.loading.delete(id);
  render();
}

// ---------- tabs ----------
function setTab(tab) {
  ui.tab = tab;
  history.replaceState(null, '', tab === 'courses' ? location.pathname : `#${tab}`);
  render();
  window.scrollTo({ top: 0 });
}

function render() {
  for (const b of document.querySelectorAll('.tabs [data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab));
  const fn = { courses: renderCourses, constraints: renderConstraints, results: renderResults, plans: renderPlans }[ui.tab];
  const focusQ = document.activeElement?.id === 'q';
  view.innerHTML = (ui.error ? `<div class="notice warn">${esc(ui.error)}</div>` : '') + fn();
  if (ui.tab === 'constraints') wireConstraintGrid();
  if (ui.tab === 'courses') {
    const q = $('#q');
    q.value = ui.q || '';
    if (focusQ) q.focus();
    renderSearch();
  }
}

// ---------- courses tab ----------
function renderCourses() {
  const list = myCourses();
  const credits = list.reduce((s, c) => s + (c.credits || 0), 0);
  return `
    <div class="section-head">
      <div>
        <h2>הקורסים שלי</h2>
        <p class="lead">מחפשים קורס ומוסיפים אותו. אחרי זה מדרגים מרצים ומתרגלים ומחליטים לאן הולכים.</p>
      </div>
      ${list.length ? `<span class="chip">${list.length} קורסים · ${hours(credits)} נק״ז</span>` : ''}
    </div>
    <div class="search">
      <div class="search-field">
        <input id="q" type="search" autocomplete="off" placeholder="חיפוש לפי שם או מספר קורס, למשל ״לוגיקה״ או 212.1.0201" aria-label="חיפוש קורס">
        <span class="kbd" aria-hidden="true">🔍</span>
      </div>
      <div id="qres"></div>
    </div>
    ${list.length ? `
      <p class="legend">
        <span>דירוג: ⭐ מומלץ · 👌 בסדר · 🚫 להימנע, לכל קורס בנפרד (לחיצה נוספת מבטלת)</span>
        <span>📌 חייב את הקבוצה הזו</span><span>⛔ לא מתאים לי</span><span>🎥 מוקלט (היברידי)</span>
      </p>` : ''}
    <div class="courses">
      ${sem().order.map((id) => courseCard(id)).join('')}
    </div>
    ${!sem().order.length ? `
      <div class="empty card">
        <div class="big">📚</div>
        <p><b>עוד לא הוספת קורסים.</b><br>חפשו למעלה לפי שם או מספר קורס.</p>
      </div>` : `
      <div class="row" style="justify-content:center;margin-top:14px"><button class="btn sm" data-action="list-share">🔗 שיתוף רשימת הקורסים (למשל לכל המחזור)</button></div>
      <div class="sticky-bar"><div class="bar-pair">
        <button class="btn" data-action="tab" data-tab="constraints">🗓️ לאילוצים</button>
        <button class="btn primary" data-action="build" data-free="1">✨ בנה לי מערכת בלי אילוצים</button>
      </div></div>`}
    ${dataNote()}
  `;
}

/** Where the data comes from and how fresh it is; shown wherever people decide based on it. */
function dataNote() {
  const cur = (ui.semesters || []).find((s) => s.id === S().semester);
  return `<p class="data-note">השעות נלקחו מ<a href="${CONFIG.university.catalogueUrl}" target="_blank" rel="noopener">${esc(CONFIG.university.catalogueName)} של ${esc(CONFIG.university.name)}</a>${cur?.updated ? ` ועודכנו ב-${esc(fmtDate(cur.updated))}` : ''}. שעות וקבוצות יכולות להשתנות, ולפני הרישום כדאי לבדוק אותן באתר האוניברסיטה.</p>`;
}
const fmtDate = (iso) => new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' });

function renderSearch() {
  const box = $('#qres');
  if (!box) return;
  const q = ui.q || '';
  if (!q.trim()) { box.innerHTML = ''; return; }
  if (!ui.index.length) { box.innerHTML = `<div class="card pad muted small">טוען את רשימת הקורסים…</div>`; return; }
  const hits = data.search(ui.index, q);
  box.innerHTML = `<div class="card results-list">${hits.length ? hits.map((c) => {
    const added = sem().order.includes(c.id);
    return `<div class="result-row">
      <div class="grow"><div>${esc(c.name)}</div><div class="num">${data.displayId(c.id)}${c.credits != null ? ` · ${c.credits} נק״ז` : ''}${c.g === 0 ? ' · אין קבוצות בסמסטר הזה' : ''}</div></div>
      <button class="btn sm ${added ? '' : 'primary'}" data-action="${added ? 'noop' : 'add'}" data-id="${c.id}" ${added ? 'disabled' : ''}>${added ? '✓ נוסף' : '+ הוספה'}</button>
    </div>`;
  }).join('') : `<div class="pad muted">לא נמצא קורס כזה בסמסטר ${esc(currentSemLabel())}.</div>`}</div>`;
}

const RATE_OPTS = [[RATE.REC, '⭐', 'מומלץ'], [RATE.OK, '👌', 'בסדר'], [RATE.AVOID, '🚫', 'להימנע']];

function rateControl(name, id) {
  const r = rating(ratingsOf(id), name);
  return `<span class="person" data-r="${r}"><span class="nm">${esc(name)}</span><span class="rate-seg" role="group" aria-label="דירוג ${esc(name)}">${RATE_OPTS.map(([v, ico, label]) =>
    `<button data-action="rate" data-id="${id}" data-name="${esc(name)}" data-v="${v}" aria-pressed="${r === v}" title="${label}" aria-label="${label}">${ico}</button>`).join('')}</span></span>`;
}

function courseCard(id) {
  const c = ui.courses.get(id);
  const meta = ui.index.find((x) => x.id === id);
  const name = c?.name || meta?.name || data.displayId(id);
  const open = ui.open[id];
  const head = `
    <div class="course-head" data-action="toggle" data-id="${id}" role="button" aria-expanded="${!!open}">
      <span class="swatch" style="--h:${hueOf(id)}"></span>
      <div class="grow">
        <div class="course-title">${esc(name)}</div>
        <div class="course-meta"><span dir="ltr">${data.displayId(id)}</span>${c?.credits != null ? ` · ${c.credits} נק״ז` : ''}${c ? ` · ${c.groups.length} קבוצות` : ' · טוען…'}</div>
      </div>
      <button class="course-x" data-action="remove" data-id="${id}" aria-label="הסרת ${esc(name)}" title="הסרת הקורס">✕</button>
      <span class="muted" aria-hidden="true">${open ? '▴' : '▾'}</span>
    </div>`;
  if (!open || !c) return `<article class="card course">${head}</article>`;
  const cp = cprefs(id);
  const comps = components(c);
  const pinBtn = (n, v, ico, t) => `<button class="pin" data-action="pin" data-id="${id}" data-n="${n}" data-v="${v}" aria-pressed="${cp.pins[n] === v}" title="${t}" aria-label="${t}">${ico}</button>`;
  const grp = (g, sub) => `
    <div class="grp ${sub ? 'sub' : ''} ${cp.pins[g.n] || ''}">
      <div class="gnum">${g.n}<small>${esc(typeLabel(g.type))}</small></div>
      <div>
        ${g.lecturer
          ? rateControl(g.lecturer, id)
          : `<span class="person none">ללא מרצה מוגדר</span>`}
        <div class="times">${g.meetings.length ? g.meetings.map((m) => `${fmtMeet(m)}${m.hybrid ? ' <span class="rec" title="מוקלט">🎥</span>' : ''}`).join(' · ') : 'ללא שעות'}</div>
      </div>
      <div class="pins">${pinBtn(g.n, 'must', '📌', 'חייב את הקבוצה הזו')}${pinBtn(g.n, 'never', '⛔', 'לא מתאים לי')}</div>
    </div>`;
  return `
    <article class="card course">${head}
      <div class="course-body">
        ${comps.map((k) => {
          const p = { ...DEFAULT_PREFS, ...(cp.prefs[k.key] || {}) };
          const seg = (field, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button data-action="pref" data-id="${id}" data-key="${esc(k.key)}" data-field="${field}" data-v="${v}" aria-pressed="${String(p[field]) === String(v)}">${l}</button>`).join('')}</div>`;
          return `<div class="comp">
            <div class="comp-label">${esc(k.label)}</div>
            <div class="row" style="gap:14px">
              <div><div class="lbl">אני מתכוון…</div>${seg('plan', [['go', 'ללכת'], ['rec', 'לראות הקלטות'], ['skip', 'לא ללכת']])}</div>
              <div><div class="lbl">כמה חשוב לי מי מלמד?</div>${seg('weight', [[0, 'לא משנה'], [1, 'קצת'], [2, 'חשוב'], [3, 'מאוד']])}</div>
            </div>
          </div>`;
        }).join('')}
        ${c.groups.length ? `<div class="groups">${c.groups.map((g) => grp(g, false) + (g.subs || []).map((s) => grp(s, true)).join('')).join('')}</div>`
          : `<div class="notice">לקורס הזה אין קבוצות בסמסטר ${esc(currentSemLabel())}.</div>`}
        <div class="row" style="justify-content:space-between">
          <a class="small muted" href="https://bgu4u.bgu.ac.il/pls/scwp/!app.gate?app=ann" target="_blank" rel="noopener">לקובץ הקורסים באתר האוניברסיטה ↗</a>
          <button class="btn sm ghost" data-action="remove" data-id="${id}">הסרת הקורס</button>
        </div>
      </div>
    </article>`;
}

// ---------- constraints tab ----------
function renderConstraints() {
  const cells = S().constraints.cells;
  const w = { ...DEFAULT_WEIGHTS, ...S().constraints.weights };
  let grid = `<div></div>`;
  for (let d = 1; d <= 6; d++) grid += `<div class="dh" data-day="${d}" title="סימון כל היום">${DAYS[d]}</div>`;
  for (let h = 8; h < 22; h++) {
    grid += `<div class="hh" data-hour="${h}" title="סימון השעה בכל הימים">${h}:00</div>`;
    for (let d = 1; d <= 6; d++) grid += `<div class="cell" data-cell="${d}-${h}" data-v="${cells[`${d}-${h}`] || 0}"></div>`;
  }
  const brush = (v, color, label) => `<button class="brush" data-action="brush" data-v="${v}" aria-pressed="${ui.brush === v}"><i style="background:${color}"></i>${label}</button>`;
  const slider = (k, label, hint) => `
    <label class="weight"><span><b>${label}</b> <span class="muted small">${['לא משנה', 'קצת', 'חשוב', 'מאוד'][w[k]]}</span></span>
      <input type="range" min="0" max="3" step="1" value="${w[k]}" data-weight="${k}">
      <span class="muted small">${hint}</span></label>`;
  return `
    <div class="section-head"><div>
      <h2>מתי אני לא יכול או לא רוצה</h2>
      <p class="lead">צובעים משבצות בלוח (אפשר לגרור). לחיצה על יום או על שעה צובעת את כל השורה או העמודה.<br>האילוצים חלים רק על שיעורים שבחרת ללכת אליהם, כך שלהירשם לשיעור ששמת עליו "לא ללכת" עדיין אפשר.</p>
    </div></div>
    <div class="two-col">
      <div class="card pad">
        <div class="brushes">
          ${brush(2, 'var(--block-hard)', 'לא יכול')}
          ${brush(1, 'var(--block-soft)', 'עדיף שלא')}
          ${brush(0, 'var(--surface-2)', 'מחיקה')}
          <button class="btn sm ghost" data-action="clear-cells">ניקוי הלוח</button>
        </div>
        <div class="cgrid" id="cgrid">${grid}</div>
      </div>
      <div class="card pad weights">
        <h3>מה חשוב לי במערכת</h3>
        ${slider('free', 'ימים חופשיים', 'כמה להעדיף מערכות עם יום בלי שיעורים')}
        ${slider('gaps', 'בלי חלונות', 'כמה להימנע משעות ריקות בין שיעורים')}
        ${slider('soft', 'משבצות "עדיף שלא"', 'כמה להתחשב במשבצות הצהובות')}
        <p class="muted small">את החשיבות של מרצים ומתרגלים קובעים לכל קורס בלשונית "קורסים".</p>
      </div>
    </div>
    <div class="sticky-bar"><button class="btn primary" data-action="build">✨ בנה לי מערכת</button></div>`;
}

function wireConstraintGrid() {
  const grid = $('#cgrid');
  let painting = null;
  const cells = S().constraints.cells;
  const setCell = (el, v) => {
    const k = el.dataset.cell;
    if (v) cells[k] = v; else delete cells[k];
    el.dataset.v = v;
  };
  const cellsWhere = (sel) => [...grid.querySelectorAll(sel)];
  const fill = (els) => {
    const all = els.every((e) => +e.dataset.v === ui.brush);
    for (const e of els) setCell(e, all ? 0 : ui.brush);
    store.save();
  };
  // Day and hour labels act on a tap (click), so a swipe that starts on them scrolls the page.
  grid.addEventListener('click', (ev) => {
    const t = ev.target;
    if (t.dataset.day) fill(cellsWhere(`[data-cell^="${t.dataset.day}-"]`));
    else if (t.dataset.hour) fill(cellsWhere(`[data-cell$="-${t.dataset.hour}"]`));
  });
  grid.addEventListener('pointerdown', (ev) => {
    const t = ev.target;
    if (!t.dataset.cell) return;
    ev.preventDefault();
    painting = +t.dataset.v === ui.brush ? 0 : ui.brush;
    setCell(t, painting);
    grid.setPointerCapture?.(ev.pointerId);
  });
  grid.addEventListener('pointermove', (ev) => {
    if (painting === null) return;
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    if (el?.dataset?.cell && +el.dataset.v !== painting) setCell(el, painting);
  });
  const stop = () => { if (painting !== null) { painting = null; store.save(); } };
  grid.addEventListener('pointerup', stop);
  grid.addEventListener('pointercancel', stop);
}

// ---------- results tab ----------
function computeResults() {
  const courses = myCourses();
  const key = JSON.stringify([S().semester, sem().order, sem().courses, S().ratings, S().constraints, courses.length, !!ui.ignoreConstraints]);
  if (key === ui.resultsKey && ui.results) return ui.results;
  ui.resultsKey = key;
  ui.shown = {};
  ui.compare = [];
  ui.limit = 10;
  const st = store.solverState();
  if (ui.ignoreConstraints) st.constraints = { cells: {}, weights: {} };
  ui.results = courses.length ? solve(courses, st) : null;
  return ui.results;
}

function statChips(st) {
  const chips = [];
  chips.push(`<span class="chip">🏫 ${st.days.length} ימים: ${st.days.map((d) => DAYS[d]).join(' ')}</span>`);
  if (st.freeDays.length) chips.push(`<span class="chip good">🌴 פנוי: ${st.freeDays.map((d) => DAYS[d]).join(' ')}</span>`);
  chips.push(`<span class="chip ${st.gapHours >= 3 ? 'warn' : ''}">⏳ חלונות: ${hours(st.gapHours)} ש׳</span>`);
  chips.push(`<span class="chip">⏱ ${hours(st.hours)} ש׳ בכיתה</span>`);
  if (st.first != null) chips.push(`<span class="chip">${range(fmtTime(st.first), fmtTime(st.last))}</span>`);
  if (st.softHours) chips.push(`<span class="chip warn">${st.softHours} ש׳ ב"עדיף שלא"</span>`);
  if (st.clashes) chips.push(`<span class="chip warn">⚠ ${st.clashes} חפיפות בנוכחות</span>`);
  return chips.join('');
}

function pickLine(course, picks) {
  return picks.map(({ g }) => `<span class="pick">${esc(typeLabel(g.type))} ${g.n}${g.lecturer ? ` · ${starOf(g.lecturer, course.id)}${esc(g.lecturer)}` : ''}</span>`).join('<span class="muted"> | </span>');
}

function renderResults() {
  const courses = myCourses();
  if (!sem().order.length) return `<div class="empty card"><div class="big">✨</div><p>קודם מוסיפים קורסים בלשונית "קורסים".</p><button class="btn primary" data-action="tab" data-tab="courses">לחיפוש קורסים</button></div>`;
  if (courses.length < sem().order.length) return `<div class="empty card">טוען קורסים…</div>`;
  const r = computeResults();
  const head = `<div class="section-head"><div><h2>המערכות הכי טובות בשבילך</h2>
    <p class="lead">${r.results.length ? `נבדקו ${r.leaves.toLocaleString('he')} מערכות שאפשר להירשם אליהן. אלה המובילות לפי הדירוגים והאילוצים שלך.` : ''}${r.truncated ? ' (החיפוש נעצר מוקדם כי יש הרבה אפשרויות. כדאי לנעול 📌 כמה קבוצות.)' : ''}</p></div></div>`;
  const hasConstraints = Object.keys(S().constraints.cells).length || Object.keys(S().constraints.weights).length;
  const freeNote = ui.ignoreConstraints && hasConstraints
    ? `<div class="notice">המערכות האלה נבנו <b>בלי להתחשב באילוצים שלך</b>. <button class="btn sm" data-action="build">להתחשב באילוצים</button></div>`
    : '';
  const issues = freeNote + r.issues.map((i) => {
    if (i.reason === 'pins') return `<div class="notice warn">ב<b>${esc(i.course.name)}</b> לא נשארה אף קבוצה שאפשר להירשם אליה אחרי הנעילות (📌/⛔). כדאי לשחרר חלק מהן.</div>`;
    if (i.reason === 'constraints') return `<div class="notice warn">ב<b>${esc(i.course.name)}</b> כל הקבוצות נופלות על משבצות "לא יכול". אפשר לסמן שלא הולכים לחלק מהשיעורים, או לשחרר אילוצים.</div>`;
    return `<div class="notice warn">אין צירוף של הקבוצות שלא מתנגש בשעות. כדאי לשחרר נעילות או להוריד קורס.</div>`;
  }).join('');
  let compare = '';
  if (ui.compare.length === 2) {
    const [a, b] = ui.compare.map((i) => r.results[i]);
    compare = `<section class="card pad" style="margin-bottom:14px">
      <div class="row" style="justify-content:space-between"><h3>השוואה: מערכת ${ui.compare[0] + 1} מול מערכת ${ui.compare[1] + 1}</h3><button class="btn sm ghost" data-action="compare-clear">סגירה</button></div>
      <div class="compare" style="margin-top:10px">
        ${[a, b].map((x, j) => `<div><div class="stats">${statChips(x.stats)}</div>${weekHtml(x.blocks, { hueOf })}<ul class="res-lines">${diffLines(x, j === 0 ? b : a)}</ul></div>`).join('')}
      </div></section>`;
  }
  const cards = r.results.slice(0, ui.limit).map((res, i) => {
    const lost = res.courses.flatMap(({ course, picks }) => missedStars(course, picks, store.solverState()).map((m) => ({ ...m, course })));
    return `<article class="card res">
      <div class="res-top">
        <div class="row"><span class="rank">${i + 1}</span><div class="stats" style="margin:0">${statChips(res.stats)}</div></div>
        <div class="row">
          <button class="btn sm" data-action="show" data-i="${i}">${ui.shown[i] ? 'הסתרה' : 'הצגת המערכת'}</button>
          <button class="btn sm" data-action="compare" data-i="${i}" aria-pressed="${ui.compare.includes(i)}">${ui.compare.includes(i) ? '✓ בהשוואה' : 'השוואה'}</button>
          <button class="btn sm primary" data-action="save-result" data-i="${i}">שמירה</button>
        </div>
      </div>
      <ul class="res-lines">${res.courses.map(({ course, picks }) => `<li><span class="dot" style="--h:${hueOf(course.id)}"></span><span class="cn">${esc(shortName(course.name))}</span>${pickLine(course, picks)}</li>`).join('')}</ul>
      ${lost.length ? `<div class="lost">ויתרת על: ${lost.map((l) => `<b>⭐ ${esc(l.name)}</b> (${esc(shortName(l.course.name))}, ${esc(l.comp.label)})`).join(' · ')}</div>` : ''}
      ${ui.shown[i] ? weekHtml(res.blocks, { hueOf }) : ''}
    </article>`;
  }).join('');
  const more = r.results.length > ui.limit ? `<div class="row" style="justify-content:center;margin-top:12px"><button class="btn" data-action="more">עוד מערכות (${r.results.length - ui.limit})</button></div>` : '';
  return head + issues + compare + `<div class="res-list">${cards}</div>` + more +
    (ui.compare.length === 1 ? `<div class="sticky-bar"><span class="chip" style="background:var(--text);color:var(--bg);padding:8px 14px">בחרו עוד מערכת אחת להשוואה</span></div>` : '');
}

function diffLines(x, other) {
  return x.courses.map(({ course, picks }) => {
    const o = other.courses.find((c) => c.course.id === course.id);
    const same = o && o.picks.map((p) => p.g.n).join() === picks.map((p) => p.g.n).join();
    return `<li style="${same ? 'opacity:.5' : ''}"><span class="dot" style="--h:${hueOf(course.id)}"></span><span class="cn">${esc(shortName(course.name))}</span>${pickLine(course, picks)}</li>`;
  }).join('');
}

// ---------- plans tab ----------
function planBlocks(plan, courseMap = ui.courses) {
  const out = [];
  for (const [cid, nums] of Object.entries(plan.picks)) {
    const course = courseMap.get(cid);
    if (!course) continue;
    const picks = nums.map((n) => findGroup(course, n)).filter(Boolean).map((f) => ({ g: f.g, role: f.role }));
    out.push(...makeBlocks(course, picks, sem().courses[cid]?.prefs || {}, plan.attend?.[cid] || {}));
  }
  return out;
}

function currentPlan() {
  if (ui.shared) return ui.shared.plan;
  const plans = sem().plans;
  return plans.find((p) => p.id === ui.plan) || plans[0] || null;
}

function renderPlans() {
  const plans = sem().plans;
  const plan = currentPlan();
  let top = '';
  if (ui.shared) {
    const missing = Object.keys(ui.shared.plan.picks).filter((id) => !ui.courses.has(id));
    missing.forEach(ensureCourse);
    top = `<div class="notice"><b>מערכת ששותפה איתך: ${esc(ui.shared.plan.name || '')}</b>
      <div class="row" style="margin-top:8px"><button class="btn sm primary" data-action="shared-save">שמירה אצלי</button><button class="btn sm" data-action="shared-close">סגירה</button></div></div>`;
  }
  if (!plan) {
    return `<div class="section-head"><div><h2>המערכות שלי</h2></div></div>
      <div class="empty card"><div class="big">⭐</div><p>עוד לא שמרת מערכת.<br>בלשונית "הצעות" לוחצים "שמירה" על מערכת שמוצאת חן בעיניך.</p>
      <button class="btn primary" data-action="tab" data-tab="results">להצעות</button></div>`;
  }
  const bl = planBlocks(plan);
  const st = weekStats(bl);
  const rows = registrationRows([...ui.courses.values()], plan);
  const credits = rows.reduce((s, r) => s + (r.course.credits || 0), 0);
  return `
    ${top}
    ${ui.shared ? '' : `<div class="section-head"><div><h2>המערכות שלי</h2><p class="lead">לחיצה על שיעור: להחליט אם הולכים, רואים הקלטה, הולכים לקבוצה אחרת, או מחליפים קבוצה ברישום.</p></div></div>
    <div class="plan-tabs">${plans.map((p) => `<button class="plan-tab" data-action="plan" data-id="${p.id}" aria-pressed="${p === plan}">${esc(p.name)}</button>`).join('')}</div>`}
    <div class="card pad">
      <div class="row" style="justify-content:space-between">
        <div class="seg" role="group">
          <button data-action="plan-view" data-v="att" aria-pressed="${ui.planView === 'att'}">לאן אני הולך בפועל</button>
          <button data-action="plan-view" data-v="reg" aria-pressed="${ui.planView === 'reg'}">למה אני רשום</button>
        </div>
        ${ui.shared ? '' : `<div class="row">
          <button class="btn sm ghost" data-action="plan-rename">שינוי שם</button>
          <button class="btn sm ghost" data-action="plan-dup">שכפול</button>
          <button class="btn sm ghost danger-ghost" data-action="plan-del">🗑️ מחיקה</button></div>`}
      </div>
      <div class="stats">${statChips(st)}</div>
      ${weekHtml(bl, { view: ui.planView, hueOf, tap: !ui.shared })}
      <p class="legend" style="margin-top:8px"><span>🎥 הקלטה</span><span>✕ לא הולך</span><span>↩ הולך לקבוצה אחרת</span><span>↪ רשום אבל לא שם</span></p>
      <h3 style="margin-top:14px">מה מקלידים במערכת הרישום</h3>
      <table class="reg-table"><thead><tr><th>מספר קורס</th><th>קורס</th><th>קבוצות</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td class="num">${data.displayId(r.course.id)}</td><td>${esc(r.course.name)}</td><td>${r.groups.map((g) => `${esc(g.label)} <b>${g.n}</b>`).join(' · ')}</td></tr>`).join('')}
        <tr><td></td><td class="muted">סה״כ</td><td class="muted">${hours(credits)} נק״ז</td></tr>
      </tbody></table>
      <div class="exports">
        <button class="btn" data-action="copy-reg">📋 העתקת רשימה לרישום</button>
        <button class="btn" data-action="share-link">🔗 קישור לשיתוף</button>
        <button class="btn" data-action="png">🖼️ שמירה כתמונה</button>
        <button class="btn" data-action="ics">📅 הוספה ליומן</button>
      </div>
    </div>
    ${ui.shared ? '' : backupNudge()}
    ${dataNote()}`;
}

/** After real work and no backup for a while, suggest the one-tap restore link. */
function backupNudge() {
  const m = S().meta;
  const days = m.lastBackup ? (Date.now() - new Date(m.lastBackup)) / 864e5 : Infinity;
  if (m.changes < 15 || days < 3 || ui.nudgeDismissed) return '';
  return `<div class="notice" style="margin-top:14px">
    <b>💾 כדאי לשמור את הנתונים שלך</b><br>
    <span class="small">הכול שמור רק בדפדפן הזה. קישור שחזור אחד שולחים לעצמך (למשל בוואטסאפ), ואיתו מחזירים הכול בכל מכשיר.</span>
    <div class="row" style="margin-top:8px"><button class="btn sm primary" data-action="restore-link">שליחת קישור שחזור לעצמי</button><button class="btn sm ghost" data-action="nudge-later">לא עכשיו</button></div>
  </div>`;
}

// ---------- sheets ----------
/**
 * Asks inside the page. window.confirm/prompt are silently blocked in the browsers
 * WhatsApp and Instagram open links in, so nothing would happen there.
 */
function ask({ title, text = '', value = null, yes = 'אישור', danger = false, copy = null }) {
  return new Promise((resolve) => {
    ui.askResolve?.(null);
    ui.askResolve = resolve;
    openSheet(`
      <h3>${esc(title)}</h3>
      ${text ? `<p class="muted">${esc(text)}</p>` : ''}
      ${value !== null ? `<label class="field"><input id="ask-input" maxlength="60" value="${esc(value)}"></label>` : ''}
      ${copy !== null ? `<textarea id="ask-copy" class="copybox" readonly rows="4">${esc(copy)}</textarea>` : ''}
      <div class="row" style="justify-content:flex-end;margin-top:12px">
        ${copy !== null ? '' : '<button class="btn" data-action="close-sheet">ביטול</button>'}
        <button class="btn ${danger ? 'danger' : 'primary'}" data-action="ask-yes">${esc(yes)}</button>
      </div>`);
    const input = $('#ask-input') || $('#ask-copy');
    if (input) { input.focus(); input.select(); }
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.id === 'ask-input') actions['ask-yes'](); });
  });
}

function openSheet(html) {
  const s = $('#sheet');
  $('.sheet-card', s).innerHTML = html;
  s.hidden = false;
  $('.sheet-card button, .sheet-card input', s)?.focus();
}
const closeSheet = () => {
  $('#sheet').hidden = true;
  const r = ui.askResolve;
  ui.askResolve = null;
  r?.(null);
};

function blockSheet(bi) {
  const plan = currentPlan();
  const bl = planBlocks(plan);
  const b = bl[bi];
  if (!b) return;
  const reg = b.mode === 'alt' ? b.regGroup : b.g;
  const course = b.course;
  const cur = plan.attend?.[course.id]?.[reg.n] || sem().courses[course.id]?.prefs?.[b.key]?.plan || 'go';
  const hybrid = reg.meetings.some((m) => m.hybrid);
  const opt = (v, ico, label, sub = '', dis = false) => `<button class="opt" data-action="attend" data-cid="${course.id}" data-n="${reg.n}" data-v="${v}" aria-pressed="${cur === v}" ${dis ? 'disabled' : ''}><span class="ico">${ico}</span><span class="grow"><b>${label}</b>${sub ? `<br><span class="muted small">${sub}</span>` : ''}</span></button>`;
  const alts = alternatives(course, reg.n);
  // other registrations for this course that don't clash with the rest of the plan
  const others = bl.filter((x) => x.course.id !== course.id && (x.registered || x.mode === 'moved')).map((x) => x.m);
  const swaps = courseOptions(course).filter((o) => {
    const nums = o.picks.map((p) => p.g.n).join();
    if (nums === plan.picks[course.id].join()) return false;
    return !o.picks.flatMap((p) => p.g.meetings).some((m) => others.some((x) => overlaps(m, x)));
  });
  openSheet(`
    <h3>${esc(course.name)}</h3>
    <p class="muted small">${esc(typeLabel(reg.type))} ${reg.n}${reg.lecturer ? ' · ' + starOf(reg.lecturer, course.id) + esc(reg.lecturer) : ''} · ${reg.meetings.map(fmtMeet).join(' · ')}${hybrid ? ' · 🎥 מוקלט' : ''}</p>
    <div class="opt-list">
      ${opt('go', '🙋', 'אלך')}
      ${opt('rec', '🎥', 'אראה בהקלטה', hybrid ? '' : 'השיעור הזה לא מסומן כהיברידי', !hybrid)}
      ${opt('skip', '✕', 'לא אלך')}
      ${alts.map((a) => opt(`alt:${a.n}`, '↩', `אלך במקום זה לקבוצה ${a.n}`, `${a.lecturer ? starOf(a.lecturer, course.id) + esc(a.lecturer) + ' · ' : ''}${a.meetings.map(fmtMeet).join(' · ')}`)).join('')}
    </div>
    ${swaps.length ? `<details><summary><b>החלפת קבוצה ברישום</b> <span class="muted small">(${swaps.length} אפשרויות בלי התנגשות)</span></summary>
      <div class="opt-list">${swaps.map((o) => `<button class="opt" data-action="swap" data-cid="${course.id}" data-nums="${o.picks.map((p) => p.g.n).join(',')}"><span class="ico">⇄</span><span class="grow">${o.picks.map(({ g }) => `<b>${esc(typeLabel(g.type))} ${g.n}</b> ${g.lecturer ? starOf(g.lecturer, course.id) + esc(g.lecturer) : ''} <span class="muted small">${g.meetings.map(fmtMeet).join(' · ')}</span>`).join('<br>')}</span></button>`).join('')}</div>
    </details>` : ''}
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-action="close-sheet">סגירה</button></div>`);
}

function settingsSheet() {
  const last = S().meta.lastBackup;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  openSheet(`
    <h3>שמירת הנתונים שלי</h3>
    <p class="muted small">הקורסים, הדירוגים והמערכות שלך שמורים רק בדפדפן הזה, ואף אחד אחר לא רואה אותם. כדי לא לאבד אותם, או כדי לעבור לטלפון או למחשב אחר:</p>
    <div class="opt-list">
      <button class="opt" data-action="restore-link"><span class="ico">📤</span><span class="grow"><b>שליחת קישור שחזור לעצמי</b><br><span class="muted small">פותחים את הקישור בכל מכשיר וכל הנתונים חוזרים. ${last ? `נשמר לאחרונה ${esc(fmtDate(last))}.` : 'עוד לא נשמר.'}</span></span></button>
      <button class="opt" data-action="backup"><span class="ico">⬇️</span><span class="grow"><b>הורדת קובץ גיבוי</b></span></button>
      <label class="opt"><span class="ico">⬆️</span><span class="grow"><b>טעינת קובץ גיבוי</b></span><input type="file" accept="application/json,.json" id="restore" hidden></label>
    </div>
    ${standalone ? '' : `<h3 style="margin-top:16px">התקנה כאפליקציה</h3>
    <p class="muted small">לא חובה: הכול עובד גם מהקישור. התקנה מוסיפה אייקון למסך הבית, פותחת את המתכנן במסך מלא ומאפשרת להשתמש בו גם בלי אינטרנט.</p>
    <div class="opt-list"><button class="opt" data-action="install"><span class="ico">📲</span><span class="grow"><b>הוספה למסך הבית</b></span></button></div>`}
    <h3 style="margin-top:16px">עוד</h3>
    <div class="opt-list">
      <a class="opt" href="${CONFIG.feedbackUrl}" target="_blank" rel="noopener"><span class="ico">💬</span><span class="grow"><b>יש לי הערה</b><br><span class="muted small">באג, רעיון, או שעה שלא מתאימה לאתר האוניברסיטה</span></span></a>
      <a class="opt" href="about.html"><span class="ico">ℹ️</span><span class="grow"><b>אודות, פרטיות ותנאי שימוש</b></span></a>
      <button class="opt" data-action="intro"><span class="ico">👋</span><span class="grow"><b>הסבר קצר על המתכנן</b></span></button>
      <button class="opt" data-action="reset"><span class="ico">🗑️</span><span class="grow"><b>מחיקת כל הנתונים שלי</b></span></button>
    </div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-action="close-sheet">סגירה</button></div>`);
  $('#restore').addEventListener('change', async (e) => {
    try {
      restoreState(sanitizeState(JSON.parse(await e.target.files[0].text())));
      toast('הגיבוי נטען');
    } catch { toast('הקובץ לא נראה כמו גיבוי של המתכנן'); }
  });
}

function restoreState(clean) {
  store.replaceAll(clean);
  closeSheet();
  store.persist();
  bootSelectors();
  loadSemester();
}

function introSheet() {
  openSheet(`
    <div class="intro">
      <div class="intro-logo" aria-hidden="true"></div>
      <h3>ברוכים הבאים ל${esc(CONFIG.appName)}</h3>
      <p class="muted">בונים מערכת שעות ל${esc(CONFIG.university.short)} לפי המרצים והמתרגלים שאתם רוצים, ורואים מה מקבלים ועל מה מוותרים.</p>
      <ol class="steps">
        <li><b>מוסיפים קורסים</b><span>מחפשים לפי שם או מספר, או פותחים קישור של המחזור.</span></li>
        <li><b>מדרגים ומחליטים</b><span>⭐ מומלץ · 👌 בסדר · 🚫 להימנע, ולאן באמת הולכים.</span></li>
        <li><b>מקבלים מערכות</b><span>רק כאלה שאפשר להירשם אליהן, עם מה שקיבלתם ועל מה ויתרתם.</span></li>
      </ol>
      <p class="fine">כלי עצמאי של סטודנטים, <b>לא אתר רשמי של האוניברסיטה</b>. השעות נלקחות מהאתר הציבורי שלה ויכולות להשתנות, ולכן לפני הרישום בודקים שם. הנתונים שלכם נשמרים רק במכשיר שלכם. <a href="about.html">פרטים</a></p>
      <button class="btn primary" data-action="intro-done" style="width:100%;padding:12px">בואו נתחיל</button>
    </div>`);
}

function courseListSheet() {
  const ids = sem().order;
  openSheet(`
    <h3>שיתוף רשימת הקורסים</h3>
    <p class="muted small">מי שיפתח את הקישור יקבל את הקורסים האלה בלחיצה אחת. זה מתאים לקבוצת המחזור. רק רשימת הקורסים עוברת, בלי הדירוגים והמערכות שלך.</p>
    <label class="field"><span>שם לרשימה</span><input id="list-name" maxlength="80" placeholder="למשל: הנדסת תוכנה שנה א׳ סתו"></label>
    <ul class="mini-list">${ids.map((id) => `<li><span dir="ltr">${data.displayId(id)}</span> ${esc(ui.courses.get(id)?.name || '')}</li>`).join('')}</ul>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-action="close-sheet">ביטול</button><button class="btn primary" data-action="list-share-go">שיתוף הקישור</button></div>`);
}

async function incomingListSheet(list) {
  const idx = await data.index(list.semester).catch(() => ({ courses: [] }));
  const known = new Map(idx.courses.map((c) => [c.id, c]));
  const ids = list.ids.filter((id) => known.has(id));
  const already = new Set(store.sem().order);
  openSheet(`
    <h3>רשימת קורסים ששותפה איתך</h3>
    <p class="muted small">${list.name ? `<b>${esc(list.name)}</b> · ` : ''}${esc(currentSemLabel())}</p>
    ${ids.length ? `<div class="opt-list">${ids.map((id) => `<label class="opt"><input type="checkbox" name="add" value="${id}" ${already.has(id) ? 'checked disabled' : 'checked'}><span class="grow"><b>${esc(known.get(id).name)}</b><br><span class="muted small" dir="ltr">${data.displayId(id)}</span>${already.has(id) ? ' <span class="muted small">· כבר ברשימה שלך</span>' : ''}</span></label>`).join('')}</div>`
      : `<div class="notice warn">הקורסים ברשימה הזו לא נמצאו בסמסטר הזה.</div>`}
    <div class="row" style="justify-content:flex-end"><button class="btn" data-action="close-sheet">ביטול</button>${ids.length ? `<button class="btn primary" data-action="list-add">הוספת הקורסים</button>` : ''}</div>`);
}

function restoreAskSheet(clean) {
  ui.pendingRestore = clean;
  const n = Object.values(clean.sems).reduce((a, x) => a + x.order.length, 0);
  const p = Object.values(clean.sems).reduce((a, x) => a + x.plans.length, 0);
  openSheet(`
    <h3>שחזור נתונים מקישור</h3>
    <p>בקישור יש ${n} קורסים, ${p} מערכות ו-${Object.keys(clean.ratings).length} דירוגים.</p>
    <p class="muted small">השחזור יחליף את מה שכבר שמור בדפדפן הזה.</p>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-action="close-sheet">ביטול</button><button class="btn primary" data-action="restore-yes">שחזור</button></div>`);
}

function icsSheet() {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  const iso = (x) => x.toISOString().slice(0, 10);
  const end = new Date(d); end.setDate(end.getDate() + 7 * 13 - 2);
  openSheet(`
    <h3>הוספה ליומן</h3>
    <p class="muted small">נוצר קובץ יומן עם אירוע שבועי חוזר לכל שיעור שבחרת ללכת אליו או לראות בהקלטה. פותחים אותו בטלפון או מייבאים ל-Google Calendar.</p>
    <label class="field"><span>תחילת הסמסטר</span><input type="date" id="ics-start" value="${iso(d)}"></label>
    <label class="field"><span>סוף הסמסטר</span><input type="date" id="ics-end" value="${iso(end)}"></label>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-action="close-sheet">ביטול</button><button class="btn primary" data-action="ics-go">הורדה</button></div>`);
}

// ---------- actions ----------
const actions = {
  tab: (el) => setTab(el.dataset.tab),
  noop: () => {},
  add(el) {
    const id = el.dataset.id;
    store.update(() => {
      if (!sem().order.includes(id)) sem().order.push(id);
      cprefs(id);
    });
    ui.open = { [id]: true };
    ensureCourse(id);
    toast('הקורס נוסף');
  },
  async remove(el) {
    const id = el.dataset.id;
    const name = ui.courses.get(id)?.name || data.displayId(id);
    if (!(await ask({ title: `להסיר את "${name}"?`, text: 'הדירוגים וההעדפות שסימנת בקורס הזה יימחקו. מערכות ששמרת לא משתנות.', yes: 'הסרה', danger: true }))) return;
    store.update(() => {
      sem().order = sem().order.filter((x) => x !== id);
      delete sem().courses[id];
    });
  },
  toggle(el) { ui.open[el.dataset.id] = !ui.open[el.dataset.id]; render(); },
  rate(el) {
    const { name: n, id } = el.dataset;
    const v = +el.dataset.v;
    store.update(() => {
      const r = ratingsOf(id);
      if (r[n] === v) delete r[n]; else r[n] = v;
    });
  },
  pin(el) {
    const { id, n, v } = el.dataset;
    store.update(() => {
      const pins = cprefs(id).pins;
      if (pins[n] === v) delete pins[n]; else pins[n] = v;
    });
  },
  pref(el) {
    const { id, key, field, v } = el.dataset;
    store.update(() => {
      const p = cprefs(id).prefs;
      p[key] = { ...DEFAULT_PREFS, ...(p[key] || {}), [field]: field === 'weight' ? +v : v };
    });
  },
  brush(el) { ui.brush = +el.dataset.v; render(); },
  build(el) {
    ui.ignoreConstraints = !!el.dataset.free;
    setTab('results');
  },
  'clear-cells': () => store.update((s) => { s.constraints.cells = {}; }),
  more() { ui.limit += 10; render(); },
  show(el) { ui.shown[el.dataset.i] = !ui.shown[el.dataset.i]; render(); },
  compare(el) {
    const i = +el.dataset.i;
    ui.compare = ui.compare.includes(i) ? ui.compare.filter((x) => x !== i) : [...ui.compare, i].slice(-2);
    render();
    if (ui.compare.length === 2) window.scrollTo({ top: 0, behavior: 'smooth' });
  },
  'compare-clear': () => { ui.compare = []; render(); },
  'save-result'(el) {
    const res = ui.results.results[+el.dataset.i];
    const plan = {
      id: Math.random().toString(36).slice(2, 9),
      name: `מערכת ${sem().plans.length + 1}`,
      picks: Object.fromEntries(res.courses.map(({ course, picks }) => [course.id, picks.map((p) => p.g.n)])),
      attend: {},
    };
    store.update(() => sem().plans.push(plan));
    store.persist();
    ui.plan = plan.id;
    toast(`נשמר בתור "${plan.name}"`);
  },
  plan(el) { ui.plan = el.dataset.id; render(); },
  'plan-view'(el) { ui.planView = el.dataset.v; render(); },
  'ask-yes'() {
    const r = ui.askResolve;
    ui.askResolve = null;
    const v = $('#ask-input')?.value ?? true;
    $('#sheet').hidden = true;
    r?.(v);
  },
  async 'plan-rename'() {
    const p = currentPlan();
    const name = await ask({ title: 'שם למערכת', value: p.name, yes: 'שמירה' });
    if (name?.trim()) store.update(() => { p.name = name.trim().slice(0, 60); });
  },
  'plan-dup'() {
    const p = currentPlan();
    const copy = { ...structuredClone(p), id: Math.random().toString(36).slice(2, 9), name: `${p.name} (עותק)` };
    store.update(() => sem().plans.push(copy));
    ui.plan = copy.id;
    render();
  },
  async 'plan-del'() {
    const p = currentPlan();
    if (!(await ask({ title: `למחוק את "${p.name}"?`, text: 'אי אפשר לבטל את המחיקה.', yes: 'מחיקה', danger: true }))) return;
    store.update(() => { sem().plans = sem().plans.filter((x) => x !== p); });
    ui.plan = sem().plans[0]?.id || null;
    toast('המערכת נמחקה');
  },
  attend(el) {
    const { cid, n, v } = el.dataset;
    const p = currentPlan();
    store.update(() => {
      p.attend ||= {};
      p.attend[cid] ||= {};
      p.attend[cid][n] = v;
    });
    closeSheet();
  },
  swap(el) {
    const { cid, nums } = el.dataset;
    const p = currentPlan();
    store.update(() => {
      p.picks[cid] = nums.split(',').map(Number);
      if (p.attend) delete p.attend[cid];
    });
    closeSheet();
    toast('הקבוצה הוחלפה');
  },
  async 'copy-reg'() {
    const p = currentPlan();
    const text = registrationText(registrationRows([...ui.courses.values()], p), `${p.name} · ${currentSemLabel()}`);
    try { await navigator.clipboard.writeText(text); toast('הרשימה הועתקה'); } catch { await ask({ title: 'העתיקו מכאן', copy: text, yes: 'סגירה' }); }
  },
  async 'share-link'() {
    const p = currentPlan();
    const url = `${location.origin}${location.pathname}#s=${await encodePlan(S().semester, p)}`;
    await shareUrl(url, p.name, `המערכת שלי: ${p.name}`);
  },
  async png() {
    const p = currentPlan();
    const blob = await weekPng(planBlocks(p), { view: ui.planView, hueOf, title: `${p.name} · ${currentSemLabel()}` });
    const file = new File([blob], `${p.name}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: p.name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    download(blob, `${p.name}.png`);
  },
  ics: () => icsSheet(),
  'ics-go'() {
    const p = currentPlan();
    const text = ics(planBlocks(p), { start: $('#ics-start').value, end: $('#ics-end').value, name: p.name });
    download(new Blob([text], { type: 'text/calendar' }), `${p.name}.ics`);
    closeSheet();
  },
  'shared-save'() {
    const sp = ui.shared.plan;
    const plan = { ...structuredClone(sp), id: Math.random().toString(36).slice(2, 9), name: sp.name || 'מערכת ששותפה' };
    store.update(() => {
      sem().plans.push(plan);
      for (const id of Object.keys(plan.picks)) if (!sem().order.includes(id)) { sem().order.push(id); cprefs(id); }
    });
    ui.shared = null;
    ui.plan = plan.id;
    history.replaceState(null, '', '#plans');
    render();
    toast('המערכת נשמרה אצלך');
  },
  'shared-close'() { ui.shared = null; history.replaceState(null, '', '#plans'); render(); },
  settings: () => settingsSheet(),
  intro: () => introSheet(),
  'intro-done'() {
    store.update((s) => { s.seen.intro = true; });
    closeSheet();
    if (ui.pendingList) { incomingListSheet(ui.pendingList); ui.pendingList = null; }
  },
  'list-share': () => courseListSheet(),
  async 'list-share-go'() {
    const name = $('#list-name').value.trim();
    const url = `${location.origin}${location.pathname}#c=${await encodeCourseList(S().semester, name, sem().order)}`;
    closeSheet();
    await shareUrl(url, name || 'רשימת קורסים', `רשימת הקורסים${name ? ` ל${name}` : ''} במתכנן המערכת:`);
  },
  'list-add'() {
    const ids = [...document.querySelectorAll('input[name=add]:checked:not(:disabled)')].map((i) => i.value);
    store.update(() => {
      for (const id of ids) if (!sem().order.includes(id)) { sem().order.push(id); cprefs(id); }
    });
    ids.forEach(ensureCourse);
    closeSheet();
    ui.tab = 'courses';
    render();
    toast(ids.length ? `נוספו ${ids.length} קורסים` : 'לא נוספו קורסים');
  },
  async 'restore-link'() {
    const url = `${location.origin}${location.pathname}#r=${await pack(S())}`;
    const ok = await shareUrl(url, 'קישור שחזור · מתכנן מערכת', 'קישור השחזור שלי למתכנן המערכת (לא לשתף, יש בו את הדירוגים שלי):');
    if (ok) { store.markBackup(); store.persist(); ui.nudgeDismissed = true; render(); }
  },
  'restore-yes'() {
    const clean = ui.pendingRestore;
    ui.pendingRestore = null;
    if (clean) { restoreState(clean); toast('הנתונים שוחזרו'); }
  },
  'nudge-later'() { ui.nudgeDismissed = true; render(); },
  async install() {
    if (ui.installPrompt) {
      ui.installPrompt.prompt();
      const { outcome } = await ui.installPrompt.userChoice;
      ui.installPrompt = null;
      if (outcome === 'accepted') closeSheet();
      return;
    }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    openSheet(`<h3>הוספה למסך הבית</h3>
      ${ios ? `<ol class="steps"><li><b>לוחצים על כפתור השיתוף</b><span>הריבוע עם החץ למעלה, בתחתית ספארי.</span></li><li><b>"הוסף למסך הבית"</b><span>גוללים קצת למטה ברשימה.</span></li><li><b>"הוסף"</b><span>האייקון יופיע במסך הבית.</span></li></ol>`
        : `<ol class="steps"><li><b>פותחים את תפריט הדפדפן</b><span>⋮ בכרום, למעלה.</span></li><li><b>"התקנת אפליקציה" או "הוספה למסך הבית"</b><span></span></li></ol>`}
      <p class="muted small">אם לא מתקינים, הכול ממשיך לעבוד מהקישור.</p>
      <div class="row" style="justify-content:flex-end"><button class="btn" data-action="close-sheet">הבנתי</button></div>`);
  },
  'close-sheet': () => closeSheet(),
  backup() {
    store.markBackup();
    download(new Blob([JSON.stringify(S(), null, 1)], { type: 'application/json' }), 'bgu-schedule-backup.json');
  },
  async reset() {
    if (!(await ask({ title: 'למחוק את כל הנתונים שלך?', text: 'כל הקורסים, הדירוגים, האילוצים והמערכות ששמרת יימחקו מהדפדפן הזה.', yes: 'מחיקת הכול', danger: true }))) return;
    const semester = S().semester;
    store.replaceAll({ semester, seen: { intro: true } });
    closeSheet();
  },
};

document.addEventListener('click', (ev) => {
  const tabBtn = ev.target.closest('.tabs [data-tab]');
  if (tabBtn) return setTab(tabBtn.dataset.tab);
  const blk = ev.target.closest('.blk[data-bi]');
  if (blk && ui.tab === 'plans' && !ui.shared) return blockSheet(+blk.dataset.bi);
  const el = ev.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) {
    ev.preventDefault?.();
    actions[el.dataset.action](el, ev);
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
view.addEventListener('input', (e) => {
  if (e.target.id === 'q') { ui.q = e.target.value; renderSearch(); }
  if (e.target.dataset.weight) {
    store.get().constraints.weights[e.target.dataset.weight] = +e.target.value;
    store.save();
    e.target.closest('.weight').querySelector('.muted').textContent = ['לא משנה', 'קצת', 'חשוב', 'מאוד'][+e.target.value];
  }
});
store.subscribe(render);

// ---------- boot ----------
function currentSemLabel() {
  const [y, s] = (S().semester || '').split('-');
  return y ? `${data.SEM_NAMES[s] || s} ${data.hebrewYear(+y)}` : '';
}

async function loadSemester() {
  ui.courses = new Map();
  ui.index = [];
  ui.results = null;
  ui.resultsKey = '';
  render();
  try {
    const idx = await data.index(S().semester);
    ui.index = idx.courses;
  } catch {
    ui.error = 'לא הצלחתי לטעון את רשימת הקורסים. בדקו את החיבור לאינטרנט ונסו לרענן.';
  }
  const need = new Set([...sem().order, ...sem().plans.flatMap((p) => Object.keys(p.picks))]);
  await Promise.all([...need].map(ensureCourse));
  // One-time move from app-wide ratings to per-course ones; courses added later start unrated.
  if (!S().seen.perCourseRatings && sem().order.every((id) => ui.courses.has(id))) {
    sem().order.forEach(ratingsOf);
    S().seen.perCourseRatings = true;
    store.save();
  }
  render();
}

function bootSelectors() {
  const has = (id) => ui.semesters.some((s) => s.id === id);
  if (!has(S().semester)) S().semester = has(data.currentSemesterId()) ? data.currentSemesterId() : ui.semesters[0]?.id || '2027-1';
  const yearSel = $('#year'), semSel = $('#sem');
  const years = [...new Set(ui.semesters.map((s) => +s.id.split('-')[0]))].sort((a, b) => b - a);
  yearSel.innerHTML = years.map((y) => `<option value="${y}">${data.hebrewYear(y)} (${y})</option>`).join('');
  const fillSems = () => {
    const y = yearSel.value;
    semSel.innerHTML = ui.semesters.filter((s) => s.id.startsWith(y + '-')).sort((a, b) => a.id.localeCompare(b.id))
      .map((s) => `<option value="${s.id}">${data.SEM_NAMES[s.id.split('-')[1]] || s.id}</option>`).join('');
  };
  yearSel.value = S().semester.split('-')[0];
  fillSems();
  semSel.value = S().semester;
  const switchTo = (id) => {
    ui.shared = null;
    store.update((s) => { s.semester = id; });
    loadSemester();
  };
  yearSel.onchange = () => {
    const wanted = `${yearSel.value}-${S().semester.split('-')[1]}`;
    fillSems();
    semSel.value = has(wanted) ? wanted : semSel.options[0].value;
    switchTo(semSel.value);
  };
  semSel.onchange = () => switchTo(semSel.value);
}

/** Links someone sent: a plan (#s=), a course list (#c=), or my own restore link (#r=). */
async function readLink(hash) {
  const offered = (id) => (ui.semesters || []).some((s) => s.id === id);
  try {
    if (hash.startsWith('s=')) {
      ui.shared = await decodePlan(hash.slice(2));
      if (offered(ui.shared.semester)) S().semester = ui.shared.semester;
      ui.tab = 'plans';
    } else if (hash.startsWith('c=')) {
      const list = await decodeCourseList(hash.slice(2));
      if (offered(list.semester)) S().semester = list.semester;
      history.replaceState(null, '', location.pathname);
      return () => (S().seen.intro ? incomingListSheet(list) : (ui.pendingList = list));
    } else if (hash.startsWith('r=')) {
      const clean = sanitizeState(await unpack(hash.slice(2)));
      history.replaceState(null, '', location.pathname);
      const empty = !Object.keys(S().ratings).length && !Object.values(S().sems).some((x) => x.order.length || x.plans.length);
      return () => (empty ? (restoreState(clean), toast('הנתונים שוחזרו')) : restoreAskSheet(clean));
    }
  } catch { ui.error = 'הקישור שנפתח פגום או חלקי. אולי הוא נחתך בהעתקה?'; }
  return null;
}

// A link opened while the app is already open in this tab only changes the #hash.
window.addEventListener('hashchange', async () => {
  const hash = location.hash.slice(1);
  if (!/^[scr]=/.test(hash)) return;
  const after = await readLink(hash);
  bootSelectors();
  await loadSemester();
  if (after) after();
});

async function boot() {
  const hash = location.hash.slice(1);
  if (['constraints', 'results', 'plans'].includes(hash)) ui.tab = hash;
  try {
    ui.semesters = await data.semesters();
  } catch {
    ui.semesters = [];
    ui.error = 'לא הצלחתי לטעון את נתוני הקורסים.';
  }
  const after = await readLink(hash);
  bootSelectors();
  if (!S().seen.intro && !hash.startsWith('r=')) introSheet();
  if (after) after();
  await loadSemester();
}

// Installing is optional; the site works the same from a plain link.
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); ui.installPrompt = e; });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
for (const a of document.querySelectorAll('[data-feedback]')) a.href = CONFIG.feedbackUrl;

boot();
