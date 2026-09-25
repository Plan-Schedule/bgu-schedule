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
