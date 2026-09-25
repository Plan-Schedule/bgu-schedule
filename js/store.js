// Everything the student decides lives here and is kept in this browser (localStorage).
// Ratings and constraints are shared across semesters; courses and plans are per semester.

const KEY = 'bgu-schedule:v1';

const fresh = () => ({
  v: 2,
  semester: null,
  ratings: {},
  constraints: { cells: {}, weights: {} },
  sems: {},
  seen: {}, // intro screen, install tip…
  meta: { lastBackup: null, changes: 0 }, // for the "save a restore link" reminder
});

let state = load();
const listeners = new Set();
let timer = null;

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && (s.v === 1 || s.v === 2)) return migrate(s);
  } catch { /* private mode or broken data: start clean */ }
  return fresh();
}

// v1 had two ratings (1 = מומלץ, -1 = להימנע); v2 adds "בסדר" in between.
export function migrate(s) {
  if (s.v === 1) {
    s.ratings = Object.fromEntries(Object.entries(s.ratings || {}).map(([k, r]) => [k, r > 0 ? 2 : -2]));
    s.v = 2;
  }
  const f = fresh();
  return { ...f, ...s, seen: { ...f.seen, ...s.seen }, meta: { ...f.meta, ...s.meta } };
}

export function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
  }, 150);
}

export const get = () => state;

/** Ask the browser to keep our data even when storage is tight (and Safari's 7-day rule). */
export function persist() {
  navigator.storage?.persist?.().catch(() => {});
}

export function markBackup() {
  state.meta.lastBackup = new Date().toISOString();
  state.meta.changes = 0;
  save();
}

export function sem() {
  const k = state.semester;
  if (!state.sems[k]) state.sems[k] = { order: [], courses: {}, plans: [] };
  return state.sems[k];
}

/** Mutate, persist, re-render. */
export function update(fn) {
  fn(state);
  state.meta.changes++;
  save();
  for (const l of listeners) l();
}

export const subscribe = (fn) => listeners.add(fn);

export function replaceAll(next) {
  state = migrate({ ...fresh(), ...next, meta: { lastBackup: new Date().toISOString(), changes: 0 } });
  save();
  for (const l of listeners) l();
}

/** The subset the solver needs. */
export const solverState = () => ({ ratings: state.ratings, courses: sem().courses, constraints: state.constraints });
