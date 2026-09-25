#!/usr/bin/env node
// Downloads the BGU course catalogue for one semester into data/<year>-<sem>/.
//
//   node scraper/scrape.mjs --year 2027 --sem 1 [--level 1] [--only 212-1-0201,214-1-9321]
//
// Output:
//   data/semesters.json               list of semesters the app can show
//   data/<year>-<sem>/index.json      every course: id, name, credits
//   data/<year>-<sem>/c/<id>.json     groups, lecturers, meetings of one course
//
// No dependencies; needs Node 20+.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCourse, parseIndex, text } from './parse.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_ANN = 'https://bgu4u.bgu.ac.il/pls/scwp/!app.ann';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const YEAR = args.year || '2027';
const SEM = args.sem || '1';
const LEVEL = args.level ?? '1';
const CONCURRENCY = +(args.concurrency || 3);
const ONLY = args.only ? args.only.split(',') : null;

const decoder = new TextDecoder('windows-1255');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The site's PL/SQL gateway answers 404 when any expected field is missing,
// so every request sends the full form.
const SEARCH_FORM = {
  lang: 'he', st: 'a', step: '2', oc_course_name: '%', on_course_ins: '0', on_course_ins_list: '0',
  on_course_department: '', on_course_department_list: '', on_course_degree_level: LEVEL,
  on_course_degree_level_list: LEVEL, on_course: '', on_credit_points: '', on_hours: '',
  on_year: YEAR, on_semester: SEM, oc_lecturer_first_name: '', oc_lecturer_last_name: '',
  oc_start_time: '', oc_end_time: '', on_campus: '',
};

async function post(form, tries = 6) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(URL_ANN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'bgu-schedule (github.com/dolev423/bgu-schedule)' },
        body: new URLSearchParams(form).toString(),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return decoder.decode(await res.arrayBuffer());
    } catch (e) {
      if (i >= tries) throw e;
      await sleep(1500 * i);
    }
  }
}

async function writeIfChanged(path, data) {
  const json = JSON.stringify(data, null, 1) + '\n';
  const old = await readFile(path, 'utf8').catch(() => null);
  if (old === json) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, json);
  return true;
}

async function main() {
  const semKey = `${YEAR}-${SEM}`;
  const dir = join(ROOT, 'data', semKey);

  console.log(`Searching all courses for ${semKey} (level ${LEVEL || 'any'})…`);
  let list = parseIndex(await post(SEARCH_FORM));
  list = [...new Map(list.map((c) => [c.id, c])).values()];
  console.log(`${list.length} courses in the catalogue`);
  if (ONLY) list = list.filter((c) => ONLY.includes(c.id));
  if (!list.length) throw new Error('No courses found; the site layout may have changed');

  // Keep what an earlier run already knows, so a partial run never shrinks the index.
  const prev = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8').catch(() => '{"courses":[]}'));
  const byId = new Map(prev.courses.map((c) => [c.id, c]));
  let label = prev.label || null;
  let done = 0, failed = 0, changed = 0;

  const queue = [...list];
  async function worker() {
    while (queue.length) {
      const c = queue.shift();
      try {
        const html = await post({
          lang: 'he', st: 'a', step: '3', rn_course_ins: '0', rn_course_department: String(c.dept),
          rn_course_degree_level: String(c.level), rn_course: String(c.num), rn_course_details: '',
          rn_year: YEAR, rn_semester: SEM, on_course_ins: '0', on_year: YEAR, on_semester: SEM, oc_course_name: '',
        });
        if (html.includes('ORA-01403')) throw new Error('no data');
        const course = parseCourse(html);
        if (!label) {
          const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<br/) || [])[1];
          if (h1) label = text(h1).replace('פרטי קורס בסמסטר', '').trim();
        }
        const data = { id: c.id, name: course.name || c.name, credits: course.credits, hours: course.hours, groups: course.groups };
        if (await writeIfChanged(join(dir, 'c', `${c.id}.json`), data)) changed++;
        byId.set(c.id, { id: c.id, name: data.name, credits: data.credits, g: data.groups.length });
      } catch (e) {
        failed++;
        if (!byId.has(c.id)) byId.set(c.id, { id: c.id, name: c.name, credits: null, g: null });
        console.warn(`  ! ${c.id}: ${e.message}`);
      }
      if (++done % 50 === 0) console.log(`  ${done}/${list.length}`);
      await sleep(200);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const courses = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  const indexChanged = await writeIfChanged(join(dir, 'index.json'), { semester: semKey, label, courses });

  const semPath = join(ROOT, 'data', 'semesters.json');
  const sems = JSON.parse(await readFile(semPath, 'utf8').catch(() => '[]')).filter((s) => s.id !== semKey);
  sems.push({ id: semKey, label: label || semKey, updated: new Date().toISOString().slice(0, 10) });
  sems.sort((a, b) => b.id.localeCompare(a.id));
  if (changed || indexChanged) await writeIfChanged(semPath, sems);

  console.log(`Done: ${done} fetched, ${changed} changed, ${failed} failed`);
  if (failed > list.length / 4) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
