#!/usr/bin/env node
// Semester dates and teaching breaks from the university's academic calendar
// (bgu.ac.il/academic-calendar), for the "add to calendar" defaults.
//
//   node scraper/calendar.mjs      → data/calendar.json
//   { "2027-1": { "start": "2026-10-18", "end": "2027-01-15", "breaks": [{ "from", "to", "title" }] }, … }

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://www.bgu.ac.il';
const UA = 'bgu-schedule catalogue bot (+https://github.com/Plan-Schedule/bgu-schedule)';

const SEASON = { 'סתיו': 1, 'סתו': 1, 'אביב': 2, 'קיץ': 3 };

// תשפ"ז → 2027 (the civil year the academic year ends in)
const LETTERS = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9, 'י': 10, 'כ': 20, 'ל': 30, 'מ': 40, 'נ': 50, 'ס': 60, 'ע': 70, 'פ': 80, 'צ': 90, 'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400 };
export function civilYear(heb) {
  const n = [...heb.replace(/["'׳״]/g, '')].reduce((s, ch) => s + (LETTERS[ch] || 0), 0);
  return n ? 5000 + n - 3760 : null;
}

/** The site writes local dates with a "Z" on them (e.g. 23:59Z = end of that local day), so the date part is the date. */
const localDate = (iso) => String(iso).slice(0, 10);

export function semestersFrom(events) {
  const out = {};
  for (const { semester, e } of events) {
    const m = semester.match(/(סתיו|סתו|אביב|קיץ)\s+(תש\S+)/);
    if (!m) continue;
    const key = `${civilYear(m[2])}-${SEASON[m[1]]}`;
    const s = (out[key] ||= { start: null, end: null, breaks: [] });
    const text = `${e.title || ''} ${e.subTitle || ''} ${e.portalToolTipTitle || ''}`;
    if (/פתיחת/.test(e.title || '') && !s.start) s.start = localDate(e.startDate);
    else if (/סיום סמסטר|יום אחרון ל/.test(text) && !s.end) s.end = localDate(e.startDate);
    else if (/פגרת לימודים/.test(text)) s.breaks.push({ from: localDate(e.startDate), to: localDate(e.endDate), title: (e.title || '').trim() });
  }
  for (const k of Object.keys(out)) if (!out[k].start || !out[k].end) delete out[k];
  return out;
}

async function main() {
  const page = await (await fetch(`${SITE}/academic-calendar/`, { headers: { 'User-Agent': UA } })).text();
  const nodeId = +(page.match(/id="currentNodeId"[^>]*value="(\d+)"|value="(\d+)"[^>]*id="currentNodeId"/) || []).slice(1).find(Boolean);
  if (!nodeId) throw new Error('calendar page layout changed');
  const events = [];
  for (let p = 1; p <= 20; p++) {
    const res = await fetch(`${SITE}/umbraco/surface/academicCalendarSurface/getAcademicCalendarEvents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ cultureCode: 'he-IL', semesterId: 0, currentPage: p, pageNodeId: nodeId }),
    });
    const d = await res.json();
    const batch = (d.semesters || []).flatMap((s) => (s.events || []).map((e) => ({ semester: s.name || '', e })));
    if (!batch.length) break;
    events.push(...batch);
    if (p >= (d.totalPages || d.pagesCount || p)) break;
  }
  const found = semestersFrom(events);
  if (!Object.keys(found).length) throw new Error('no semesters found in the calendar');
  const path = join(ROOT, 'data', 'calendar.json');
  const old = JSON.parse(await readFile(path, 'utf8').catch(() => '{}'));
  const merged = { ...old, ...found }; // keep past semesters the site no longer lists
  await writeFile(path, JSON.stringify(merged, null, 1) + '\n');
  console.log('calendar:', Object.entries(found).map(([k, v]) => `${k} ${v.start}→${v.end} (${v.breaks.length} breaks)`).join(', '));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
