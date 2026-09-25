// Share links, calendar export and the registration cheat-sheet.
import { mins, typeLabel, findGroup, DAY_FULL, validPlan } from './model.js';
import { displayId } from './data.js';

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** JSON → short URL-safe string (deflated when the browser can). */
export async function pack(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'function') return 'z' + b64url(await pipe(bytes, new CompressionStream('deflate-raw')));
  return 'j' + b64url(bytes);
}

export async function unpack(str) {
  if (!str || str.length > 200_000) throw new Error('bad link');
  let bytes = unb64url(str.slice(1));
  if (str[0] === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** plan → compact string for the URL hash. Only group numbers travel; the catalogue fills in the rest. */
export const encodePlan = (semester, plan) => pack({ s: semester, n: plan.name, p: plan.picks, a: plan.attend || {} });
export const decodePlan = async (str) => sanitizePlan(await unpack(str));

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const ID = /^\d{3}-\d-\d{4}$/;
const SEM = /^\d{4}-[1-3]$/;
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, max);

function cleanPicks(o) {
  const picks = {};
  for (const [id, nums] of Object.entries(isObj(o) ? o : {})) {
    if (!ID.test(id) || !Array.isArray(nums)) continue;
    const ok = nums.filter((n) => Number.isInteger(n) && n > 0 && n < 10000).slice(0, 6);
    if (ok.length) picks[id] = ok;
  }
  return picks;
}

function cleanAttend(o, picks) {
  const attend = {};
  for (const [id, m] of Object.entries(isObj(o) ? o : {})) {
    if (!picks[id] || !isObj(m)) continue;
    attend[id] = Object.fromEntries(Object.entries(m).filter(([n, v]) => /^\d{1,4}$/.test(n) && validPlan(v)));
  }
  return attend;
}

/** A shared link is input from a stranger: keep only well-formed fields. */
export function sanitizePlan(o) {
  if (!isObj(o) || typeof o.s !== 'string' || !SEM.test(o.s)) throw new Error('bad link');
  const picks = cleanPicks(o.p);
  if (!Object.keys(picks).length) throw new Error('empty link');
  return { semester: o.s, plan: { name: text(o.n, 60), picks, attend: cleanAttend(o.a, picks) } };
}

/** "Courses of my cohort": a named list of course ids for one semester. */
export const encodeCourseList = (semester, name, ids) => pack({ s: semester, n: name, c: ids });
export async function decodeCourseList(str) {
  const o = await unpack(str);
  if (!isObj(o) || !SEM.test(o.s) || !Array.isArray(o.c)) throw new Error('bad link');
  const ids = [...new Set(o.c.filter((id) => typeof id === 'string' && ID.test(id)))].slice(0, 30);
  if (!ids.length) throw new Error('empty link');
  return { semester: o.s, name: text(o.n, 80), ids };
}

/**
 * Everything the student saved (restore link / backup file). It may have been
 * sent by someone else, so it is rebuilt field by field from known shapes.
 */
export function sanitizeState(o) {
  if (!isObj(o) || (o.v !== 1 && o.v !== 2)) throw new Error('not a backup');
  const ratings = cleanRatings(o.ratings, o.v === 1 ? { 1: 2, [-1]: -2 } : { 2: 2, 1: 1, [-2]: -2 });
  const cells = {};
  for (const [k, v] of Object.entries(isObj(o.constraints?.cells) ? o.constraints.cells : {})) {
    if (/^[1-7]-([0-9]|1[0-9]|2[0-3])$/.test(k) && (v === 1 || v === 2)) cells[k] = v;
  }
  const weights = {};
  for (const [k, v] of Object.entries(isObj(o.constraints?.weights) ? o.constraints.weights : {})) {
    if (['free', 'gaps', 'soft'].includes(k) && [0, 1, 2, 3].includes(v)) weights[k] = v;
  }
  const sems = {};
  for (const [semId, sv] of Object.entries(isObj(o.sems) ? o.sems : {})) {
    if (!SEM.test(semId) || !isObj(sv)) continue;
    const order = [...new Set((Array.isArray(sv.order) ? sv.order : []).filter((id) => typeof id === 'string' && ID.test(id)))].slice(0, 40);
    const courses = {};
    for (const id of order) {
      const c = isObj(sv.courses?.[id]) ? sv.courses[id] : {};
      const prefs = {};
      for (const [k, p] of Object.entries(isObj(c.prefs) ? c.prefs : {})) {
        if (!/^[PS]:[^<>"'&]{0,20}$/.test(k) || !isObj(p)) continue;
        prefs[k] = { plan: validPlan(p.plan) && !p.plan.startsWith('alt:') ? p.plan : 'go', weight: [0, 1, 2, 3].includes(p.weight) ? p.weight : 2 };
      }
      const pins = {};
      for (const [n, v] of Object.entries(isObj(c.pins) ? c.pins : {})) if (/^\d{1,4}$/.test(n) && (v === 'must' || v === 'never')) pins[n] = v;
      courses[id] = { prefs, pins };
      if (isObj(c.ratings)) courses[id].ratings = cleanRatings(c.ratings, { 2: 2, 1: 1, [-2]: -2 });
    }
    const plans = [];
    for (const p of (Array.isArray(sv.plans) ? sv.plans : []).slice(0, 30)) {
      if (!isObj(p)) continue;
      const picks = cleanPicks(p.picks);
      if (!Object.keys(picks).length) continue;
      plans.push({ id: /^[a-z0-9]{1,12}$/.test(p.id) ? p.id : Math.random().toString(36).slice(2, 9), name: text(p.name, 60) || 'מערכת', picks, attend: cleanAttend(p.attend, picks) });
    }
    sems[semId] = { order, courses, plans };
  }
  return {
    v: 2,
    semester: SEM.test(o.semester) ? o.semester : null,
    ratings,
    constraints: { cells, weights },
    sems,
    seen: { intro: true, perCourseRatings: o.seen?.perCourseRatings === true },
  };
}

function cleanRatings(o, map) {
  const out = {};
  for (const [name, v] of Object.entries(isObj(o) ? o : {}).slice(0, 2000)) {
    if (map[v] !== undefined && name.length <= 80) out[text(name, 80)] = map[v];
  }
  return out;
}

/** Lines for typing into the registration system. */
export function registrationRows(courses, plan) {
  return courses
    .filter((c) => plan.picks[c.id])
    .map((c) => ({
      course: c,
      groups: plan.picks[c.id].map((n) => {
        const f = findGroup(c, n);
        return { n, label: typeLabel(f?.g.type), lecturer: f?.g.lecturer };
      }),
    }));
}

export function registrationText(rows, title) {
  const lines = [title, ''];
  for (const r of rows) {
    lines.push(`${displayId(r.course.id)}  ${r.course.name}`);
    lines.push('   ' + r.groups.map((g) => `${g.label} ${g.n}`).join(' · '));
  }
  return lines.join('\n');
}

const pad = (n) => String(n).padStart(2, '0');
const icsDate = (d, m) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(Math.floor(m / 60))}${pad(m % 60)}00`;
const icsEsc = (s) => String(s).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');

/** Weekly recurring events for everything the student attends (or watches), from start to end date. */
export function ics(blocks, { start, end, name }) {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T23:59:00');
  const until = `${e.getFullYear()}${pad(e.getMonth() + 1)}${pad(e.getDate())}T215900Z`;
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//bgu-schedule//HE', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsEsc(name)}`];
  let i = 0;
  for (const b of blocks) {
    if (b.mode === 'skip' || b.mode === 'moved') continue;
    const first = new Date(s);
    first.setDate(s.getDate() + ((b.m.day - 1 - s.getDay() + 7) % 7));
    const note = b.mode === 'rec' ? ' (הקלטה)' : b.mode === 'alt' ? ` (במקום קבוצה ${b.regGroup.n})` : '';
    out.push(
      'BEGIN:VEVENT',
      `UID:${b.course.id}-${b.g.n}-${b.m.day}-${b.m.start.replace(':', '')}-${i++}@bgu-schedule`,
      `DTSTAMP:${now}Z`,
      `DTSTART;TZID=Asia/Jerusalem:${icsDate(first, mins(b.m.start))}`,
      `DTEND;TZID=Asia/Jerusalem:${icsDate(first, mins(b.m.end))}`,
      `RRULE:FREQ=WEEKLY;UNTIL=${until}`,
      `SUMMARY:${icsEsc(`${b.course.name} – ${typeLabel(b.g.type)}${note}`)}`,
      `LOCATION:${icsEsc(b.m.place || '')}`,
      `DESCRIPTION:${icsEsc(`קבוצה ${b.g.n}${b.g.lecturer ? ' · ' + b.g.lecturer : ''} · יום ${DAY_FULL[b.m.day]}`)}`,
      'END:VEVENT',
    );
  }
  out.push('END:VCALENDAR');
  return out.join('\r\n');
}

export function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
