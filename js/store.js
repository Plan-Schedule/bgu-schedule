// Everything the student decides lives here and is kept in this browser (localStorage).
// Ratings and constraints are shared across semesters; courses and plans are per semester.

const KEY = 'bgu-schedule:v1';

const fresh = () => ({
  v: 1,
  semester: null,
  ratings: {},
  constraints: { cells: {}, weights: {} },
  sems: {},
});

let state = load();
const listeners = new Set();
let timer = null;

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.v === 1) return { ...fresh(), ...s };
  } catch { /* private mode or broken data: start clean */ }
  return fresh();
}

export function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
  }, 150);
}

export const get = () => state;

export function sem() {
  const k = state.semester;
  if (!state.sems[k]) state.sems[k] = { order: [], courses: {}, plans: [] };
  return state.sems[k];
}

/** Mutate, persist, re-render. */
export function update(fn) {
  fn(state);
  save();
  for (const l of listeners) l();
}

export const subscribe = (fn) => listeners.add(fn);

export function replaceAll(next) {
  state = { ...fresh(), ...next };
  save();
  for (const l of listeners) l();
}

/** The subset the solver needs. */
export const solverState = () => ({ ratings: state.ratings, courses: sem().courses, constraints: state.constraints });
