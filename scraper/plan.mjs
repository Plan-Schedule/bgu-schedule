#!/usr/bin/env node
// Prints the semesters to scrape today, one "<year> <sem> [once]" per line.
// "auto" in semesters.txt means: every semester of the current academic year,
// plus next year's autumn (it gets published over the summer). Semesters that
// aren't published yet are skipped by the scraper, so listing them early is harmless.
import { readFileSync } from 'node:fs';

const now = new Date();
const year = now.getUTCMonth() + 1 >= 8 ? now.getUTCFullYear() + 1 : now.getUTCFullYear(); // 2027 = תשפ"ז
const lines = new Set();
for (const raw of readFileSync(new URL('./semesters.txt', import.meta.url), 'utf8').split('\n')) {
  const line = raw.replace(/#.*/, '').trim();
  if (!line) continue;
  if (line === 'auto') [`${year} 1`, `${year} 2`, `${year} 3`, `${year + 1} 1`].forEach((l) => lines.add(l));
  else lines.add(line);
}
console.log([...lines].join('\n'));
