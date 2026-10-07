// Pure scheduling logic: no DOM, so it runs in the browser and under node:test.
//
// Course data (from data/<sem>/c/<id>.json):
//   { id, name, credits, groups: [ { n, type, lecturer, meetings: [...], subs: [ {n, type, lecturer, meetings} ] } ] }
// A registration picks one primary group per primary type (normally one lecture),
// and under each picked primary, one sub-group per sub type (tutorial, lab…).
// Sub-groups can only be taken together with the primary they sit under.

import { openTo } from './degrees.js';

export const DAYS = ['', 'א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
export const DAY_FULL = ['', 'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

const TYPE_LABEL = { 'שעור': 'הרצאה', 'שיעור': 'הרצאה', 'תרגיל': 'תרגול', 'שעור ותרגיל': 'הרצאה ותרגול' };
/** "שעור (אנגלית)" → "הרצאה (אנגלית)"; anything unknown is shown as the university writes it. */
export function typeLabel(t) {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  const m = s.match(/^(.*?)\s*\(([^)]+)\)$/);
  const base = m ? m[1] : s;
  const label = TYPE_LABEL[base] || base || 'קבוצה';
  return m ? `${label} (${m[2]})` : label;
}

/** Course files from older scrapes may hold "שעור\n(אנגלית)"; one space everywhere keeps keys stable. */
export function normalizeCourse(c) {
  for (const g of c.groups || []) {
    for (const x of [g, ...(g.subs || [])]) x.type = String(x.type || '').replace(/\s+/g, ' ').trim();
  }
  return c;
}

export const mins = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
// Time ranges are isolated left-to-right; inside Hebrew text "08:00–10:00" would otherwise render as "10:00–08:00".
export const range = (a, b) => `\u2066${a}–${b}\u2069`;
export const fmtTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export const DEFAULT_PREFS = { plan: 'go', weight: 2 };
export const DEFAULT_WEIGHTS = { free: 2, gaps: 1, soft: 2 };

/** The things a student decides about per course: "הרצאה", "תרגול", "מעבדה"… */
export function components(course) {
  const seen = new Map();
  for (const g of course.groups) {
    const k = `P:${g.type}`;
    if (!seen.has(k)) seen.set(k, { key: k, role: 'primary', type: g.type, label: typeLabel(g.type) });
  }
  for (const g of course.groups) {
    for (const s of g.subs || []) {
      const k = `S:${s.type}`;
      if (!seen.has(k)) seen.set(k, { key: k, role: 'sub', type: s.type, label: typeLabel(s.type) });
    }
  }
  return [...seen.values()];
}

export const compKey = (g, role) => `${role === 'primary' ? 'P' : 'S'}:${g.type}`;

function groupBy(list, fn) {
  const m = new Map();
  for (const x of list) {
    const k = fn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return [...m.values()];
}

function cartesian(lists) {
  return lists.reduce((acc, list) => acc.flatMap((a) => list.map((x) => [...a, x])), [[]]);
}

/** Narrow a set of interchangeable groups by the student's pins, and drop groups with no hours when others have them. */
function candidates(list, pins) {
  let l = list.filter((g) => pins[g.n] !== 'never');
  const must = l.filter((g) => pins[g.n] === 'must');
  if (must.length) l = must;
  const timed = l.filter((g) => g.meetings.length);
  return timed.length ? timed : l;
}

/** Every registration the system would accept for this course: [{ picks: [{ g, role }] }] */
export function courseOptions(course, pins = {}) {
  const primarySets = cartesian(groupBy(course.groups, (g) => g.type).map((l) => candidates(l, pins)));
  const out = [];
  for (const prim of primarySets) {
    const subChoices = [];
    let ok = true;
    for (const p of prim) {
      for (const list of groupBy(p.subs || [], (s) => s.type)) {
        const c = candidates(list, pins);
        if (!c.length) ok = false;
        subChoices.push(c);
      }
    }
    if (!ok) continue;
    for (const subs of cartesian(subChoices)) {
      out.push({ picks: [...prim.map((g) => ({ g, role: 'primary' })), ...subs.map((g) => ({ g, role: 'sub' }))] });
    }
  }
  // A pinned tutorial also decides the lecture: keep only options that contain
  // one of the pinned groups for every component that has a pin.
  const mustByKey = new Map();
  for (const g of course.groups) {
    for (const [x, role] of [[g, 'primary'], ...(g.subs || []).map((s) => [s, 'sub'])]) {
      if (pins[x.n] !== 'must') continue;
      const k = compKey(x, role);
      if (!mustByKey.has(k)) mustByKey.set(k, new Set());
      mustByKey.get(k).add(x);
    }
  }
  if (!mustByKey.size) return out;
  return out.filter((o) => [...mustByKey].every(([k, set]) => o.picks.some((p) => compKey(p.g, p.role) === k && set.has(p.g))));
}

/** Finds the group object by number anywhere in the course, with its role and parent. */
export function findGroup(course, n) {
  for (const g of course.groups) {
    if (g.n === n) return { g, role: 'primary', parent: null };
    for (const s of g.subs || []) if (s.n === n) return { g: s, role: 'sub', parent: g };
  }
  return null;
}

/** All groups of the same component — the ones a student could sit in instead (attendance is not checked). */
export function alternatives(course, n) {
  const f = findGroup(course, n);
  if (!f) return [];
  if (f.role === 'primary') return course.groups.filter((g) => g.type === f.g.type && g.n !== n && g.meetings.length);
  return course.groups.flatMap((g) => g.subs || []).filter((s) => s.type === f.g.type && s.n !== n && s.meetings.length);
}

// מומלץ / בסדר / להימנע. Someone not rated yet counts as 0: below a known "בסדר", above "להימנע".
export const RATE = { REC: 2, OK: 1, AVOID: -2 };
export const rating = (ratings, name) => (name && ratings?.[name]) || 0;

/** Ratings are per course (a great lecturer in one course may not be in another). Old saves had one global list. */
export const courseRatings = (state, course) => state.courses?.[course.id]?.ratings || state.ratings || {};

const hourCells = (m) => {
  const out = [];
  for (let h = Math.floor(mins(m.start) / 60); h < Math.ceil(mins(m.end) / 60); h++) out.push(`${m.day}-${h}`);
  return out;
};

/**
 * Turns picks + attendance choices into concrete blocks for the grid.
 * attend: { [groupN]: 'go' | 'rec' | 'skip' | 'alt:<n>' }; missing → from component plan.
 */
export const validPlan = (v) => typeof v === 'string' && /^(go|rec|skip|alt:\d{1,4})$/.test(v);

export function blocks(course, picks, prefs = {}, attend = {}) {
  const out = [];
  for (const { g, role } of picks) {
    const key = compKey(g, role);
    // attend/prefs can come from a shared link or a backup file: only known values get through
    const plan = [attend[g.n], prefs[key]?.plan, DEFAULT_PREFS.plan].find(validPlan);
    let src = g;
    let mode = plan;
    if (plan.startsWith('alt:')) {
      const alt = findGroup(course, +plan.slice(4));
      if (alt) src = alt.g;
      mode = 'go';
      for (const m of g.meetings) out.push({ course, g, role, key, m, registered: true, attended: false, mode: 'moved' });
    }
    for (const m of src.meetings) {
      // A lesson that is not recorded cannot be watched later.
      const eff = mode === 'rec' && !m.hybrid ? 'go' : mode;
      out.push({
        course, g: src, regGroup: g, role, key, m,
        registered: src === g, attended: eff === 'go', mode: src === g ? eff : 'alt',
      });
    }
  }
  return out;
}

const overlaps = (a, b) => a.day === b.day && mins(a.start) < mins(b.end) && mins(b.start) < mins(a.end);

/** Stats of the week the student actually attends. */
// Long days. Lessons with less than half an hour between them count as one stretch.
// A stretch over 4 hours, or a day with over 7 hours of lessons, costs points that grow
// with every extra hour, so a break or a lesson on another day wins over a 9-hour day.
// Always on, also when schedules are built without constraints.
const BREAK = 30;
const STREAK_OK = 4 * 60, DAY_OK = 7 * 60;

/** list: [start, end] in minutes, sorted by start → { longest, covered, penalty } (minutes; points) */
export function dayLoad(list) {
  let longest = 0, covered = 0, penalty = 0;
  let from = list[0][0], end = list[0][1], segStart = from;
  const close = () => {
    longest = Math.max(longest, end - from);
    const x = (end - from - STREAK_OK) / 60;
    if (x > 0) penalty += 5 * x + 2 * x * x;
  };
  for (const [s, e] of list.slice(1)) {
    if (s - end >= BREAK) {
      close();
      covered += end - segStart;
      from = segStart = s;
    } else if (s > end) {
      covered += end - segStart;
      segStart = s;
    }
    if (e > end) end = e;
  }
  close();
  covered += end - segStart;
  const y = (covered - DAY_OK) / 60;
  if (y > 0) penalty += 4 * y;
  return { longest, covered, penalty };
}

export function weekStats(blockList) {
  const att = blockList.filter((b) => b.attended).map((b) => b.m);
  const byDay = new Map();
  for (const m of att) {
    if (!byDay.has(m.day)) byDay.set(m.day, []);
    byDay.get(m.day).push(m);
  }
  let gaps = 0, first = Infinity, last = 0, clashes = 0, longest = 0, tiring = 0;
  for (const list of byDay.values()) {
    list.sort((a, b) => mins(a.start) - mins(b.start));
    const load = dayLoad(list.map((m) => [mins(m.start), mins(m.end)]));
    longest = Math.max(longest, load.longest);
    tiring += load.penalty;
    let end = mins(list[0].start);
    for (const m of list) {
      const s = mins(m.start);
      if (s > end) gaps += s - end;
      if (s < end) clashes++;
      end = Math.max(end, mins(m.end));
      first = Math.min(first, s);
      last = Math.max(last, mins(m.end));
    }
  }
  const days = [...byDay.keys()].sort();
  const weekdays = [1, 2, 3, 4, 5];
  return {
    days,
    freeDays: weekdays.filter((d) => !byDay.has(d)),
    gapHours: gaps / 60,
    hours: att.reduce((s, m) => s + (mins(m.end) - mins(m.start)) / 60, 0),
    first: Number.isFinite(first) ? first : null,
    last: last || null,
    clashes,
    longestHours: longest / 60,
    tiring,
  };
}

/**
 * Searches all registrations across the chosen courses.
 * state: { ratings, courses: { [id]: { prefs: {[compKey]: {plan, weight}}, pins } }, constraints: { cells, weights } }
 */
export function solve(courseList, state, opts) {
  return expandResults(searchSchedules(courseList, state, opts), courseList, state);
}

// The search below runs in a Web Worker on big inputs, so it only returns plain numbers:
// for every result, which option (index into courseOptions) each course got.
// expandResults turns that back into objects that point at the app's own course data.

const SLOT = 5; // minutes; every meeting time in the catalogue is a multiple of 5
const daySlots = (24 * 60) / SLOT;

function prepare(courseList, state) {
  const cells = state.constraints?.cells || {};
  const issues = [];
  const notes = [];
  const perCourse = [];
  courseList.forEach((course, ci) => {
    const cs = state.courses?.[course.id] || {};
    const prefs = cs.prefs || {};
    const raw = courseOptions(course, cs.pins || {});
    if (!raw.length) {
      issues.push({ ci, reason: 'pins' });
      return;
    }
    const ratings = courseRatings(state, course);
    // Lectures meant for other degrees can't be registered to. When none is meant for the
    // student's degree (an unusual path, or missing data), the course is planned without the rule.
    const fits = (o) => o.picks.every(({ g }) => openTo(g, state.profile) !== 'no');
    const restrict = raw.some(fits);
    if (!restrict && raw.some((o) => o.picks.some(({ g }) => g.pop?.length)) && state.profile?.dept) notes.push({ ci, reason: 'degree' });
    const opts = [];
    raw.forEach((o, oi) => {
      if (restrict && !fits(o)) return;
      const bl = blocks(course, o.picks, prefs);
      const att = bl.filter((b) => b.attended);
      if (att.some((b) => hourCells(b.m).some((c) => cells[c] === 2))) return;
      let person = 0;
      for (const { g, role } of o.picks) {
        const p = prefs[compKey(g, role)] || DEFAULT_PREFS;
        if ((p.plan || 'go') === 'skip') continue;
        person += (p.weight ?? DEFAULT_PREFS.weight) * rating(ratings, g.lecturer);
      }
      const soft = att.reduce((s, b) => s + hourCells(b.m).filter((c) => cells[c] === 1).length, 0);
      // Registered meetings as slot ranges (for the clash check) and attended ones as minutes (for scoring).
      const reg = o.picks.flatMap(({ g }) => g.meetings).filter((m) => m.day).map((m) => [
        (m.day - 1) * daySlots + Math.floor(mins(m.start) / SLOT), (m.day - 1) * daySlots + Math.ceil(mins(m.end) / SLOT)]);
      const attended = att.map((b) => [b.m.day, mins(b.m.start), mins(b.m.end)]);
      opts.push({ oi, reg, attended, base: person * 10, soft, person });
    });
    if (!opts.length) issues.push({ ci, reason: 'constraints' });
    else perCourse.push({ ci, opts });
  });
  return { perCourse, issues, notes };
}

/** The search itself: pure data in, pure data out (safe to postMessage). */
export function searchSchedules(courseList, state, { limit = 40, maxLeaves = 300000 } = {}) {
  const w = { ...DEFAULT_WEIGHTS, ...(state.constraints?.weights || {}) };
  const { perCourse, issues, notes } = prepare(courseList, state);
  if (issues.length) return { results: [], issues, notes, leaves: 0, truncated: false };

  perCourse.sort((a, b) => a.opts.length - b.opts.length);
  const n = perCourse.length;
  const found = [];
  let leaves = 0, truncated = false;
  const chosen = new Array(n);
  const busy = new Uint8Array(7 * daySlots);
  const free = (o) => o.reg.every(([a, b]) => {
    for (let i = a; i < b; i++) if (busy[i]) return false;
    return true;
  });
  const mark = (o, v) => {
    for (const [a, b] of o.reg) for (let i = a; i < b; i++) busy[i] = v;
  };

  // Same numbers as weekStats, without building block objects for every leaf.
  const score = () => {
    const byDay = [[], [], [], [], [], [], [], []];
    let base = 0, soft = 0;
    for (const o of chosen) {
      base += o.base;
      soft += o.soft;
      for (const a of o.attended) byDay[a[0]].push(a);
    }
    let gaps = 0, clashes = 0, freeDays = 0, tiring = 0;
    for (let d = 1; d <= 7; d++) {
      const list = byDay[d];
      if (!list.length) {
        if (d <= 5) freeDays++;
        continue;
      }
      list.sort((a, b) => a[1] - b[1]);
      let end = list[0][1];
      for (const [, s, e] of list) {
        if (s > end) gaps += s - end;
        if (s < end) clashes++;
        if (e > end) end = e;
      }
      tiring += dayLoad(list.map((a) => [a[1], a[2]])).penalty;
    }
    return base + freeDays * w.free * 8 - (gaps / 60) * w.gaps * 3 - soft * w.soft * 4 - clashes * 5 - tiring;
  };

  (function dfs(i) {
    if (i === n) {
      if (++leaves > maxLeaves) {
        truncated = true;
        return;
      }
      found.push({ sel: chosen.map((o) => o.oi), score: score() });
      if (found.length > limit * 60) {
        found.sort((a, b) => b.score - a.score);
        found.length = limit * 15;
      }
      return;
    }
    for (const o of perCourse[i].opts) {
      if (truncated) return;
      if (!free(o)) continue;
      chosen[i] = o;
      mark(o, 1);
      dfs(i + 1);
      mark(o, 0);
    }
  })(0);

  found.sort((a, b) => b.score - a.score);
  const order = perCourse.map((pc) => pc.ci);
  return {
    results: found.map((r) => ({ score: r.score, sel: r.sel.map((oi, i) => [order[i], oi]) })),
    issues: found.length ? [] : [{ reason: 'clash' }],
    notes,
    leaves: Math.min(leaves, maxLeaves),
    truncated,
    limit,
  };
}

/** Compact search output → results the UI can show. */
export function expandResults(raw, courseList, state) {
  const withCourse = (i) => (i.ci != null ? { course: courseList[i.ci], reason: i.reason } : { reason: i.reason });
  const issues = raw.issues.map(withCourse);
  const notes = (raw.notes || []).map(withCourse);
  const limit = raw.limit ?? 40;
  const optCache = new Map();
  const optionsOf = (ci) => {
    if (!optCache.has(ci)) {
      const course = courseList[ci];
      optCache.set(ci, courseOptions(course, state.courses?.[course.id]?.pins || {}));
    }
    return optCache.get(ci);
  };
  // Many top results differ only by one tutorial hour; keep the list varied.
  const perSig = new Map();
  const results = [];
  for (const r of raw.results) {
    const sel = r.sel.map(([ci, oi]) => ({ course: courseList[ci], picks: optionsOf(ci)[oi].picks }));
    const sig = sel.map((o) => o.picks.filter((p) => p.role === 'primary').map((p) => p.g.n).join('.')).join('|');
    const c = perSig.get(sig) || 0;
    if (c >= 3) continue;
    perSig.set(sig, c + 1);
    const allBlocks = sel.flatMap((o) => blocks(o.course, o.picks, state.courses?.[o.course.id]?.prefs || {}));
    const cells = state.constraints?.cells || {};
    const softHours = allBlocks.filter((b) => b.attended).reduce((s, b) => s + hourCells(b.m).filter((x) => cells[x] === 1).length, 0);
    const person = sel.reduce((s, o) => {
      const prefs = state.courses?.[o.course.id]?.prefs || {};
      const ratings = courseRatings(state, o.course);
      return s + o.picks.reduce((t, { g, role }) => {
        const p = prefs[compKey(g, role)] || DEFAULT_PREFS;
        return (p.plan || 'go') === 'skip' ? t : t + (p.weight ?? DEFAULT_PREFS.weight) * rating(ratings, g.lecturer);
      }, 0);
    }, 0);
    results.push({
      score: Math.round(r.score),
      stats: { ...weekStats(allBlocks), softHours, person },
      courses: sel,
      blocks: allBlocks,
    });
    if (results.length >= limit) break;
  }
  return { results, issues, notes, leaves: raw.leaves, truncated: raw.truncated };
}

/** What a result gives up: recommended people who teach that component but are not in it. */
export function missedStars(course, picks, state) {
  const ratings = courseRatings(state, course);
  const prefs = state.courses?.[course.id]?.prefs || {};
  const out = [];
  for (const comp of components(course)) {
    const p = prefs[comp.key] || DEFAULT_PREFS;
    if (p.plan === 'skip' || !(p.weight ?? 2)) continue;
    // Stars in lectures meant for other degrees were never on offer.
    const open = course.groups.filter((g) => openTo(g, state.profile) !== 'no');
    const groups = open.length ? open : course.groups;
    const pool = comp.role === 'primary'
      ? groups.filter((g) => g.type === comp.type)
      : groups.flatMap((g) => g.subs || []).filter((s) => s.type === comp.type);
    const chosen = picks.filter((x) => compKey(x.g, x.role) === comp.key).map((x) => x.g.lecturer);
    const stars = [...new Set(pool.map((g) => g.lecturer).filter((n) => n && ratings[n] === RATE.REC))];
    for (const s of stars) if (!chosen.includes(s)) out.push({ name: s, comp });
  }
  return out;
}

/** All people teaching in a course, per component. */
export function peopleOf(course) {
  const out = new Map();
  for (const g of course.groups) {
    for (const x of [g, ...(g.subs || [])]) if (x.lecturer) out.set(x.lecturer, true);
  }
  return [...out.keys()];
}

export { hourCells, overlaps };
