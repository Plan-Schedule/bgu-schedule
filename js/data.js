// Loads the catalogue that the scraper publishes under data/.

const cache = new Map();

async function json(path) {
  if (cache.has(path)) return cache.get(path);
  const p = fetch(path, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  });
  cache.set(path, p);
  p.catch(() => cache.delete(path));
  return p;
}

export const semesters = () => json('data/semesters.json');
export const index = (sem) => json(`data/${sem}/index.json`);
export const course = (sem, id) => json(`data/${sem}/c/${id}.json`);

export const SEM_NAMES = { 1: 'סתו', 2: 'אביב', 3: 'קיץ' };

/** 2027 → תשפ"ז (the academic year that ends in that civil year) */
export function hebrewYear(year) {
  let n = (year + 3760) % 1000;
  const L = [[400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'], [90, 'צ'], [80, 'פ'], [70, 'ע'], [60, 'ס'], [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'], [10, 'י'], [9, 'ט'], [8, 'ח'], [7, 'ז'], [6, 'ו'], [5, 'ה'], [4, 'ד'], [3, 'ג'], [2, 'ב'], [1, 'א']];
  let s = '';
  for (const [v, ch] of L) while (n >= v) { s += ch; n -= v; }
  s = s.replace(/יה$/, 'טו').replace(/יו$/, 'טז');
  return s.length > 1 ? `${s.slice(0, -1)}"${s.slice(-1)}` : `${s}'`;
}

/** The semester students are most likely planning right now. */
export function currentSemesterId(now = new Date()) {
  const m = now.getMonth() + 1, y = now.getFullYear();
  if (m >= 8) return `${y + 1}-1`;
  if (m <= 6) return `${y}-2`;
  return `${y}-3`;
}

export const displayId = (id) => id.replace(/-/g, '.');

const norm = (s) => s.replace(/["'׳״\-.,()]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Search by name (any words, any order) or by course number in any format. */
export function search(list, q, limit = 40) {
  const raw = q.trim();
  if (!raw) return [];
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 3 && /^[\d\s.\-]+$/.test(raw)) {
    const keys = (id) => {
      const [d, l, n] = id.split('-');
      return [d + l + n, `${+d}${l}${+n}`];
    };
    return list.filter((c) => keys(c.id).some((k) => k.includes(digits))).slice(0, limit);
  }
  const words = norm(raw).split(' ');
  const scored = [];
  for (const c of list) {
    const n = norm(c.name);
    if (!words.every((w) => n.includes(w))) continue;
    scored.push([n.startsWith(words[0]) ? 0 : 1, n.length, c]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return scored.slice(0, limit).map((x) => x[2]);
}
