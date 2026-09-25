// Share links, calendar export and the registration cheat-sheet.
import { mins, typeLabel, findGroup, DAY_FULL, validPlan } from './model.js';
import { displayId } from './data.js';

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** plan → compact string for the URL hash. Only group numbers travel; the catalogue fills in the rest. */
export async function encodePlan(semester, plan) {
  const payload = JSON.stringify({ s: semester, n: plan.name, p: plan.picks, a: plan.attend || {} });
  const bytes = new TextEncoder().encode(payload);
  if (typeof CompressionStream === 'function') return 'z' + b64url(await pipe(bytes, new CompressionStream('deflate-raw')));
  return 'j' + b64url(bytes);
}

export async function decodePlan(str) {
  const kind = str[0];
  let bytes = unb64url(str.slice(1));
  if (kind === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  return sanitizePlan(JSON.parse(new TextDecoder().decode(bytes)));
}

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const ID = /^\d{3}-\d-\d{4}$/;

/** A shared link is input from a stranger: keep only well-formed fields. */
export function sanitizePlan(o) {
  if (!isObj(o) || typeof o.s !== 'string' || !/^\d{4}-[1-3]$/.test(o.s)) throw new Error('bad link');
  const picks = {}, attend = {};
  for (const [id, nums] of Object.entries(isObj(o.p) ? o.p : {})) {
    if (!ID.test(id) || !Array.isArray(nums)) continue;
    picks[id] = nums.filter((n) => Number.isInteger(n) && n > 0 && n < 10000).slice(0, 6);
  }
  for (const [id, m] of Object.entries(isObj(o.a) ? o.a : {})) {
    if (!picks[id] || !isObj(m)) continue;
    attend[id] = Object.fromEntries(Object.entries(m).filter(([n, v]) => /^\d{1,4}$/.test(n) && validPlan(v)));
  }
  if (!Object.keys(picks).length) throw new Error('empty link');
  return { semester: o.s, plan: { name: String(o.n ?? '').slice(0, 60), picks, attend } };
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
