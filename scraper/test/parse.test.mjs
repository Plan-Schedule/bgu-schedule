import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCourse, parseIndex, parseMeeting } from '../parse.mjs';

const load = (f) => new TextDecoder('windows-1255').decode(readFileSync(new URL(`./fixtures/${f}`, import.meta.url)));

test('index: reads course numbers and names', () => {
  const list = parseIndex(load('index_logic.html'));
  const logic = list.find((c) => c.id === '212-1-0201');
  assert.equal(logic.name, 'מבוא ללוגיקה ולתורת הקבוצות למדעי המחשב והנדסת תכנה');
  assert.equal(list.length, 7);
});

test('course: tutorials nest under the lecture they belong to', () => {
  const c = parseCourse(load('c_212_1_201.html'));
  assert.equal(c.name, 'מבוא ללוגיקה ולתורת הקבוצות למדעי המחשב והנדסת תכנה');
  assert.deepEqual(c.groups.map((g) => g.n), [1, 2, 3, 4, 8, 9]);
  const g1 = c.groups[0];
  assert.equal(g1.lecturer, 'ד"ר א. שקופ שמאמא');
  assert.equal(g1.meetings.length, 2);
  assert.deepEqual(g1.meetings.map((m) => [m.day, m.start, m.end]), [[3, '12:00', '14:00'], [5, '10:00', '12:00']]);
  assert.deepEqual(g1.subs.map((s) => s.n), [11, 12, 13]);
  assert.equal(g1.subs[0].lecturer, 'מר ע. שמרת');
  assert.equal(c.groups[3].subs.find((s) => s.n === 43).lecturer, 'מר ע. שמרת');
  // groups without a lecturer or without hours
  assert.equal(c.groups[4].lecturer, null);
  assert.equal(c.groups[5].meetings.length, 0);
});

test('course: nesting follows page order, not group numbers (19 → 99)', () => {
  const c = parseCourse(load('c_214_1_9321.html'));
  const g19 = c.groups.find((g) => g.n === 19);
  assert.deepEqual(g19.subs.map((s) => s.n), [99]);
  assert.equal(g19.meetings[1].day, 6);
  assert.equal(c.credits, 4.5);
});

test('course: labs are sub-groups too', () => {
  const c = parseCourse(load('c_238_1_1101.html'));
  assert.equal(c.groups.length, 1);
  assert.equal(c.groups[0].subs.length, 7);
  assert.equal(c.groups[0].subs[0].type, 'מעבדה');
  assert.equal(c.groups[0].meetings[0].hybrid, false);
});

test('meeting: hybrid flag and place', () => {
  const m = parseMeeting('<span>זמני לימוד:</span> יום ג <div>12:00 - 14:00</div><br><span>מקום לימוד:</span> גולדברגר [28]  חדר 106<br><span>אופן לימוד:</span> היברידי החל משבוע 1 כל שבוע');
  assert.equal(m.place, 'גולדברגר [28] חדר 106');
  assert.equal(m.hybrid, true);
});
