// Pure scheduling logic: no DOM, so it runs in the browser and under node:test.
//
// Course data (from data/<sem>/c/<id>.json):
//   { id, name, credits, groups: [ { n, type, lecturer, meetings: [...], subs: [ {n, type, lecturer, meetings} ] } ] }
// A registration picks one primary group per primary type (normally one lecture),
// and under each picked primary, one sub-group per sub type (tutorial, lab…).
// Sub-groups can only be taken together with the primary they sit under.

export const DAYS = ['', 'א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
export const DAY_FULL = ['', 'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

const TYPE_LABEL = { 'שעור': 'הרצאה', 'שיעור': 'הרצאה', 'תרגיל': 'תרגול' };
export const typeLabel = (t) => TYPE_LABEL[t] || t || 'קבוצה';

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
export const rating = (ratings, name) => (name && ratings[name]) || 0;

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
export function weekStats(blockList) {
  const att = blockList.filter((b) => b.attended).map((b) => b.m);
  const byDay = new Map();
  for (const m of att) {
    if (!byDay.has(m.day)) byDay.set(m.day, []);
    byDay.get(m.day).push(m);
  }
  let gaps = 0, first = Infinity, last = 0, clashes = 0;
  for (const list of byDay.values()) {
    list.sort((a, b) => mins(a.start) - mins(b.start));
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
  };
}

/**
 * Searches all registrations across the chosen courses.
 * state: { ratings, courses: { [id]: { prefs: {[compKey]: {plan, weight}}, pins } }, constraints: { cells, weights } }
 */
export function solve(courseList, state, { limit = 40, maxLeaves = 300000 } = {}) {
  const cells = state.constraints?.cells || {};
  const w = { ...DEFAULT_WEIGHTS, ...(state.constraints?.weights || {}) };
  const ratings = state.ratings || {};
  const issues = [];

  const perCourse = [];
  for (const course of courseList) {
    const cs = state.courses?.[course.id] || {};
    const prefs = cs.prefs || {};
    const raw = courseOptions(course, cs.pins || {});
    if (!raw.length) {
      issues.push({ course, reason: 'pins' });
      continue;
    }
    const opts = [];
    for (const o of raw) {
      const bl = blocks(course, o.picks, prefs);
      if (bl.some((b) => b.attended && hourCells(b.m).some((c) => cells[c] === 2))) continue;
      let person = 0;
      for (const { g, role } of o.picks) {
        const p = prefs[compKey(g, role)] || DEFAULT_PREFS;
        const plan = p.plan || 'go';
        if (plan === 'skip') continue;
        person += (p.weight ?? DEFAULT_PREFS.weight) * rating(ratings, g.lecturer);
      }
      const regMeetings = o.picks.flatMap(({ g }) => g.meetings);
      opts.push({ picks: o.picks, blocks: bl, person, regMeetings });
    }
    if (!opts.length) issues.push({ course, reason: 'constraints' });
    else perCourse.push({ course, opts });
  }
  if (issues.length) return { results: [], issues, leaves: 0, truncated: false };

  perCourse.sort((a, b) => a.opts.length - b.opts.length);
  const found = [];
  let leaves = 0, truncated = false;
  const chosen = [];
  const busy = [];

  const score = (sel) => {
    const allBlocks = sel.flatMap((o) => o.blocks);
    const st = weekStats(allBlocks);
    const soft = allBlocks.filter((b) => b.attended).reduce((s, b) => s + hourCells(b.m).filter((c) => cells[c] === 1).length, 0);
    const person = sel.reduce((s, o) => s + o.person, 0);
    return {
      score: person * 10 + st.freeDays.length * w.free * 8 - st.gapHours * w.gaps * 3 - soft * w.soft * 4 - st.clashes * 5,
      stats: { ...st, softHours: soft, person },
    };
  };

  (function dfs(i) {
    if (truncated) return;
    if (i === perCourse.length) {
      if (++leaves > maxLeaves) {
        truncated = true;
        return;
      }
      const sel = [...chosen];
      found.push({ sel, ...score(sel) });
      if (found.length > limit * 60) {
        found.sort((a, b) => b.score - a.score);
        found.length = limit * 15;
      }
      return;
    }
    for (const o of perCourse[i].opts) {
      if (o.regMeetings.some((m) => busy.some((b) => overlaps(m, b)))) continue;
      chosen.push(o);
      busy.push(...o.regMeetings);
      dfs(i + 1);
      busy.length -= o.regMeetings.length;
      chosen.pop();
    }
  })(0);

  found.sort((a, b) => b.score - a.score);

  // Many top results differ only by one tutorial hour; keep the list varied.
  const perSig = new Map();
  const results = [];
  for (const r of found) {
    const sig = r.sel.map((o) => o.picks.filter((p) => p.role === 'primary').map((p) => p.g.n).join('.')).join('|');
    const c = perSig.get(sig) || 0;
    if (c >= 3) continue;
    perSig.set(sig, c + 1);
    results.push({
      score: Math.round(r.score),
      stats: r.stats,
      courses: r.sel.map((o) => ({ course: perCourseCourse(o), picks: o.picks })),
      blocks: r.sel.flatMap((o) => o.blocks),
    });
    if (results.length >= limit) break;
  }
  if (!found.length) issues.push({ reason: 'clash' });
  return { results, issues, leaves, truncated };

  function perCourseCourse(o) {
    return perCourse.find((pc) => pc.opts.includes(o)).course;
  }
}

/** What a result gives up: recommended people who teach that component but are not in it. */
export function missedStars(course, picks, state) {
  const ratings = state.ratings || {};
  const prefs = state.courses?.[course.id]?.prefs || {};
  const out = [];
  for (const comp of components(course)) {
    const p = prefs[comp.key] || DEFAULT_PREFS;
    if (p.plan === 'skip' || !(p.weight ?? 2)) continue;
    const pool = comp.role === 'primary'
      ? course.groups.filter((g) => g.type === comp.type)
      : course.groups.flatMap((g) => g.subs || []).filter((s) => s.type === comp.type);
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
