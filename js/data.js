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
