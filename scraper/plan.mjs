#!/usr/bin/env node
// Prints the semesters to scrape today, one "<year> <sem> [once]" per line.
// "auto" in semesters.txt means: every semester of the current academic year,
// plus next year's autumn (it gets published over the summer). Semesters that
// aren't published yet are skipped by the scraper, so listing them early is harmless.
//
// --busy: only the semesters whose registration is happening now (from four weeks
// before the semester starts until two weeks into it, per data/calendar.json).
// The workflow uses it for the extra runs during the day; prints nothing otherwise.
import { readFileSync } from 'node:fs';

const DAY = 86400000;
export function inRegistration(calendar, year, sem, now = new Date()) {
  const c = calendar[`${year}-${sem}`];
  if (!c?.start) return false;
  const start = Date.parse(c.start);
  return now >= start - 28 * DAY && now <= start + 14 * DAY;
}

import { fileURLToPath } from 'node:url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const now = new Date();
  const year = now.getUTCMonth() + 1 >= 8 ? now.getUTCFullYear() + 1 : now.getUTCFullYear(); // 2027 = תשפ"ז
  const lines = new Set();
  for (const raw of readFileSync(new URL('./semesters.txt', import.meta.url), 'utf8').split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    if (line === 'auto') [`${year} 1`, `${year} 2`, `${year} 3`, `${year + 1} 1`].forEach((l) => lines.add(l));
    else lines.add(line);
  }
  let out = [...lines];
  if (process.argv.includes('--busy')) {
    let calendar = {};
    try { calendar = JSON.parse(readFileSync(new URL('../data/calendar.json', import.meta.url), 'utf8')); } catch { /* no calendar yet */ }
    out = out.filter((l) => !/\bonce\b/.test(l)).filter((l) => inRegistration(calendar, ...l.split(' ')));
  }
  if (out.length) console.log(out.join('\n'));
}
