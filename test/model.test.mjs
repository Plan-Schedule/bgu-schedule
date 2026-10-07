import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { courseOptions, solve, blocks, missedStars, alternatives, weekStats } from '../js/model.js';

const load = (id) => JSON.parse(readFileSync(new URL(`../data/2027-1/c/${id}.json`, import.meta.url)));
const logic = load('212-1-0201'), algebra = load('214-1-9321'), cs = load('232-1-1011'), data = load('238-1-1101');

test('options only pair a tutorial with its own lecture', () => {
  const opts = courseOptions(logic);
  for (const o of opts) {
    const [p, s] = o.picks;
    assert.ok(p.g.subs.includes(s.g), `${s.g.n} not under ${p.g.n}`);
  }
  // groups 1-4 have 3 tutorials each, 8 has one; 9 has no hours and is dropped
  assert.equal(opts.length, 13);
});

test('pins: must and never', () => {
  assert.equal(courseOptions(logic, { 2: 'must' }).length, 3);
  assert.equal(courseOptions(logic, { 2: 'must', 21: 'never' }).length, 2);
  // a must on a tutorial forces its lecture
  const o = courseOptions(logic, { 43: 'must' });
  assert.ok(o.every((x) => x.picks.some((p) => p.g.n === 4)));
});

test('solve: no registered clashes', () => {
  const state = { ratings: { 'ד"ר י. מייזל': 2, 'מר ע. שמרת': 2 }, courses: {}, constraints: {} };
  const r = solve([logic, algebra, cs, data], state);
  assert.ok(r.results.length > 5);
  for (const res of r.results) {
    const ms = res.courses.flatMap((c) => c.picks.flatMap((p) => p.g.meetings));
    for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
      const a = ms[i], b = ms[j];
      const clash = a.day === b.day && a.start < b.end && b.start < a.end;
      assert.ok(!clash, 'registered meetings clash');
    }
  }
});

test('solve: stars win within a course', () => {
  const state = { ratings: { 'ד"ר י. מייזל': 2, 'מר ע. שמרת': 2 }, courses: {}, constraints: {} };
  const best = solve([logic], state).results[0].courses[0].picks;
  assert.equal(best[0].g.lecturer, 'ד"ר י. מייזל');
  assert.equal(best[1].g.lecturer, 'מר ע. שמרת');
});

test('hard block only binds lessons the student attends', () => {
  const cells = {};
  for (let h = 8; h < 22; h++) cells[`3-${h}`] = 2; // Tuesday blocked
  const base = { ratings: {}, courses: {}, constraints: { cells } };
  const r1 = solve([logic], base);
  assert.ok(r1.results.every((x) => x.blocks.every((b) => b.m.day !== 3)));
  const skipLect = { ...base, courses: { [logic.id]: { prefs: { 'P:שעור': { plan: 'skip', weight: 0 } } } } };
  const r2 = solve([logic], skipLect);
  assert.ok(r2.results.some((x) => x.courses[0].picks[0].g.n === 1)); // group 1 lectures on Tuesday, allowed when skipped
});

test('attendance: go to another group\'s lecture', () => {
  const g1 = logic.groups[0], g11 = g1.subs[0];
  const bl = blocks(logic, [{ g: g1, role: 'primary' }, { g: g11, role: 'sub' }], {}, { 1: 'alt:2' });
  assert.equal(bl.filter((b) => b.mode === 'moved').length, 2);
  assert.ok(bl.some((b) => b.mode === 'alt' && b.g.n === 2));
  assert.deepEqual(alternatives(logic, 11).map((g) => g.n).includes(21), true);
  assert.equal(weekStats(bl).days.length, 3);
});

test('missed stars are reported', () => {
  const state = { ratings: { 'פרופ\' ג. וייס': 2 }, courses: {} };
  const m = missedStars(logic, [{ g: logic.groups[0], role: 'primary' }, { g: logic.groups[0].subs[0], role: 'sub' }], state);
  assert.equal(m[0].name, 'פרופ\' ג. וייס');
});

test('rating: מומלץ > בסדר > not rated > להימנע', () => {
  // groups 1-4 of logic: prefer the "בסדר" lecturer over unrated ones, and never pick the avoided one if avoidable
  const state = { ratings: { 'ד"ר א. שקופ שמאמא': 1, 'ד"ר י. מייזל': -2 }, courses: {}, constraints: {} };
  const best = solve([logic], state).results[0].courses[0].picks[0].g;
  assert.equal(best.lecturer, 'ד"ר א. שקופ שמאמא');
  const r = solve([logic], state).results;
  assert.ok(r.findIndex((x) => x.courses[0].picks[0].g.lecturer === 'ד"ר י. מייזל') > r.findIndex((x) => x.courses[0].picks[0].g.lecturer === "פרופ' ג. וייס"));
});

test('store: v1 ratings migrate to the three-level scale', async () => {
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  const { migrate } = await import('../js/store.js');
  const s = migrate({ v: 1, ratings: { a: 1, b: -1 } });
  assert.deepEqual(s.ratings, { a: 2, b: -2 });
  assert.equal(s.v, 2);
});

test('security: attendance values from a shared link or backup cannot inject markup', async () => {
  const { blocks: mk } = await import('../js/model.js');
  const { sanitizePlan } = await import('../js/share.js');
  const g1 = logic.groups[0];
  const evil = 'x" onmouseover="alert(1)';
  const bl = mk(logic, [{ g: g1, role: 'primary' }], { 'P:שעור': { plan: evil } }, { 1: evil });
  assert.ok(bl.every((b) => ['go', 'rec', 'skip', 'moved', 'alt'].includes(b.mode)));
  const p = sanitizePlan({ s: '2027-1', n: '<b>x</b>'.repeat(20), p: { '212-1-0201': [1, 11, 'x'], '../x': [1] }, a: { '212-1-0201': { 1: evil, 11: 'rec' } } });
  assert.deepEqual(Object.keys(p.plan.picks), ['212-1-0201']);
  assert.deepEqual(p.plan.picks['212-1-0201'], [1, 11]);
  assert.deepEqual(p.plan.attend['212-1-0201'], { 11: 'rec' });
  assert.ok(p.plan.name.length <= 60);
  assert.throws(() => sanitizePlan({ s: '"><img>', p: {} }));
});

test('security: restore links and course lists keep only well-formed data', async () => {
  const { sanitizeState, pack, unpack, decodeCourseList, encodeCourseList } = await import('../js/share.js');
  const evil = '"><img src=x onerror=alert(1)>';
  const s = sanitizeState({
    v: 2, semester: evil, ratings: { 'מר ע. שמרת': 2, x: 99, [evil]: 1 },
    constraints: { cells: { '3-10': 2, [evil]: 2, '3-11': 5 }, weights: { free: 3, gaps: evil, [evil]: 1 } },
    sems: {
      '2027-1': {
        order: ['212-1-0201', evil],
        courses: { '212-1-0201': { prefs: { 'P:שעור': { plan: evil, weight: 9 }, [evil]: { plan: 'go' } }, pins: { 1: 'must', 2: evil } } },
        plans: [{ id: evil, name: evil.repeat(5), picks: { '212-1-0201': [1, 11] }, attend: { '212-1-0201': { 11: 'rec', 1: evil } } }],
      },
      [evil]: {},
    },
  });
  assert.equal(s.semester, null);
  assert.deepEqual(Object.keys(s.sems), ['2027-1']);
  assert.deepEqual(s.sems['2027-1'].order, ['212-1-0201']);
  assert.deepEqual(s.sems['2027-1'].courses['212-1-0201'], { prefs: { 'P:שעור': { plan: 'go', weight: 2 } }, pins: { 1: 'must' } });
  assert.deepEqual(s.constraints, { cells: { '3-10': 2 }, weights: { free: 3 } });
  assert.equal(s.ratings['מר ע. שמרת'], 2);
  assert.equal(s.ratings.x, undefined);
  const plan = s.sems['2027-1'].plans[0];
  assert.match(plan.id, /^[a-z0-9]+$/);
  assert.deepEqual(plan.attend['212-1-0201'], { 11: 'rec' });
  assert.throws(() => sanitizeState({ v: 3 }));
  // round trip through a link
  assert.deepEqual(await unpack(await pack({ a: 'שלום' })), { a: 'שלום' });
  const l = await decodeCourseList(await encodeCourseList('2027-1', 'x'.repeat(200), ['212-1-0201', evil, '212-1-0201']));
  assert.deepEqual(l.ids, ['212-1-0201']);
  assert.equal(l.name.length, 80);
});

test('ratings are per course, falling back to old app-wide ratings', () => {
  const name = 'ד"ר י. מייזל'; // teaches logic (groups 2,3) and algebra (group 5)
  const state = { ratings: { [name]: 2 }, courses: { [algebra.id]: { ratings: { [name]: -2 } } }, constraints: {} };
  const lg = solve([logic], state).results[0].courses[0].picks[0].g;
  assert.equal(lg.lecturer, name); // logic has no own ratings yet → old global: recommended
  const al = solve([algebra], state).results[0].courses[0].picks[0].g;
  assert.notEqual(al.lecturer, name); // algebra: avoid
});

test('academic calendar: Hebrew year and semester detection', async () => {
  const { civilYear, semestersFrom } = await import('../scraper/calendar.mjs');
  assert.equal(civilYear('תשפ"ז'), 2027);
  assert.equal(civilYear('תשפ"ח'), 2028);
  const s = semestersFrom([
    { semester: 'סמסטר סתיו תשפ"ז', e: { title: 'פתיחת שנת הלימודים תשפ"ז', startDate: '2026-10-18T08:00:00Z' } },
    { semester: 'סמסטר סתיו תשפ"ז', e: { title: 'חג חנוכה', subTitle: 'פגרת לימודים', startDate: '2026-12-06T00:00:00Z', endDate: '2026-12-06T23:59:00Z' } },
    { semester: 'סמסטר סתיו תשפ"ז', e: { title: 'סיום סמסטר סתיו תשפ"ז', startDate: '2027-01-15T00:00:00Z' } },
  ]);
  assert.deepEqual(s['2027-1'], { start: '2026-10-18', end: '2027-01-15', breaks: [{ from: '2026-12-06', to: '2026-12-06', title: 'חג חנוכה' }] });
});

test('lesson types: line breaks from the catalogue and language suffixes', async () => {
  const { typeLabel, normalizeCourse } = await import('../js/model.js');
  assert.equal(typeLabel('שעור\n(אנגלית)'), 'הרצאה (אנגלית)');
  assert.equal(typeLabel('תרגיל'), 'תרגול');
  assert.equal(typeLabel('מעבדה'), 'מעבדה');
  assert.equal(typeLabel(''), 'קבוצה');
  const c = normalizeCourse({ groups: [{ type: 'שעור\n(אנגלית)', subs: [{ type: ' תרגיל \n(אנגלית)' }] }] });
  assert.equal(c.groups[0].type, 'שעור (אנגלית)');
  assert.equal(c.groups[0].subs[0].type, 'תרגיל (אנגלית)');
});

test('search output is plain data (for the worker) and expands to the same results', async () => {
  const { searchSchedules, expandResults } = await import('../js/model.js');
  const list = [logic, algebra, cs, data];
  const state = { ratings: {}, courses: {}, constraints: { cells: { '1-8': 1 } } };
  const raw = searchSchedules(list, state);
  const copy = structuredClone(raw);
  assert.deepEqual(copy, raw);
  const a = expandResults(copy, list, state), b = solve(list, state);
  assert.deepEqual(a.results.map((r) => [r.score, r.stats]), b.results.map((r) => [r.score, r.stats]));
  assert.ok(a.results[0].courses[0].course === list.find((c) => c.id === a.results[0].courses[0].course.id));
});

test('registration window: four weeks before the semester to two weeks into it', async () => {
  const { inRegistration } = await import('../scraper/plan.mjs');
  const cal = { '2027-1': { start: '2026-10-18' } };
  assert.equal(inRegistration(cal, 2027, 1, new Date('2026-10-05')), true);
  assert.equal(inRegistration(cal, 2027, 1, new Date('2026-09-01')), false);
  assert.equal(inRegistration(cal, 2027, 1, new Date('2026-11-10')), false);
  assert.equal(inRegistration(cal, 2027, 2, new Date('2026-10-05')), false);
});

test('degree: lectures meant for other degrees are not offered', async () => {
  const { openTo } = await import('../js/degrees.js');
  const pop = (rows) => ({ pop: rows });
  const se1 = { dept: 'הנדסת תכנה', year: 1 };
  assert.equal(openTo(pop([{ dept: 'הנדסת תכנה', degree: 'תואר ראשון', year: 1 }]), se1), 'yes');
  assert.equal(openTo(pop([{ dept: 'מדעי המחשב', degree: 'תואר ראשון' }]), se1), 'no');
  assert.equal(openTo(pop([{ dept: 'הנדסת תכנה', degree: 'תואר ראשון', year: 2 }]), se1), 'no');
  assert.equal(openTo(pop([{ dept: 'הנדסת תכנה', degree: 'תואר שני' }]), se1), 'no');
  assert.equal(openTo(pop([{ dept: 'הנדסת תכנה', track: 'חד מחלקתי', major: 'מדעי הנתונים' }]), se1), 'maybe');
  assert.equal(openTo(pop([{ faculty: 'מדעי ההנדסה', degree: 'תואר ראשון' }]), { dept: 'הנדסת מכונות', year: 1 }), 'yes');
  assert.equal(openTo(pop([{ faculty: 'מדעי הטבע', degree: 'תואר ראשון' }]), { dept: 'הנדסת מכונות', year: 1 }), 'no');
  assert.equal(openTo(pop([{ faculty: 'מדעי הטבע' }]), { dept: 'מחלקה לא מוכרת', year: 1 }), 'maybe');
  assert.equal(openTo(pop([]), se1), 'yes');
  assert.equal(openTo(pop([{ dept: 'מדעי המחשב' }]), null), 'yes');

  // In the solver: only the lecture for the student's degree; none fits → planned without the rule, with a note.
  const course = structuredClone(logic);
  course.groups.forEach((g, i) => { g.pop = [{ dept: i === 0 ? 'הנדסת תכנה' : 'מדעי המחשב', degree: 'תואר ראשון' }]; });
  const base = { ratings: {}, courses: {}, constraints: {} };
  const r = solve([course], { ...base, profile: se1 });
  assert.ok(r.results.length && r.results.every((x) => x.courses[0].picks[0].g.n === course.groups[0].n));
  const none = solve([course], { ...base, profile: { dept: 'פיזיקה', year: 1 } });
  assert.ok(none.results.length > 1);
  assert.equal(none.notes[0].reason, 'degree');
});

test('long days: over 4 hours straight costs more with every hour; a break resets it', async () => {
  const { dayLoad } = await import('../js/model.js');
  const h = (a, b) => [a * 60, b * 60];
  assert.equal(dayLoad([h(8, 10), h(10, 12)]).penalty, 0);
  const nine = dayLoad([h(8, 10), h(10, 12), h(12, 14), h(14, 17)]);
  const withBreak = dayLoad([h(8, 10), h(10, 12), h(13, 15), h(15, 17)]);
  assert.equal(nine.longest, 9 * 60);
  assert.ok(nine.penalty > 40 && withBreak.penalty < 10);
  assert.equal(dayLoad([h(8, 10), [10 * 60 + 15, 12 * 60]]).longest, 4 * 60); // 15 minutes is not a break
});
