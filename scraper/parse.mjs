// Parsers for the BGU course catalogue (bgu4u "קובץ הקורסים").
// The site is server-rendered HTML in windows-1255; callers decode it first.

const DAYS = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ש': 7 };

const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>' };

export function text(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? ' ')
    .replace(/[ \t\r]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

export function courseId(dept, level, num) {
  return `${String(dept).padStart(3, '0')}-${level}-${String(num).padStart(4, '0')}`;
}

/** Search results page → [{ id, dept, level, num, name }] */
export function parseIndex(html) {
  const out = [];
  const re = /goCourseSemester\('(\d+)','(\d+)','(\d+)','(\d+)','(\d+)'\)"?>([^<]*)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const [, dept, level, num, , , name] = m;
    out.push({ id: courseId(dept, level, num), dept: +dept, level: +level, num: +num, name: text(name) });
  }
  return out;
}

/** "זמני לימוד: יום ג 12:00 - 14:00 מקום לימוד: ... אופן לימוד: ..." → meeting or null */
export function parseMeeting(cellHtml) {
  const t = text(cellHtml).replace(/\n/g, ' ');
  const time = t.match(/יום\s+([א-ש])['׳]?\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  const place = (t.match(/מקום לימוד:\s*(.*?)\s*(?:אופן לימוד:|$)/) || [])[1] || '';
  const mode = (t.match(/אופן לימוד:\s*(.*)$/) || [])[1] || '';
  if (!time) return null;
  const [, dayLetter, a, b] = time;
  const pad = (s) => s.padStart(5, '0');
  return {
    day: DAYS[dayLetter] ?? null,
    start: pad(a),
    end: pad(b),
    place: place.trim(),
    mode: mode.trim(),
    hybrid: /היברידי|מקוון/.test(mode),
  };
}

/**
 * Course page → { name, credits, hours, groups }.
 * Groups are nested the way the site shows them: every "primary" group
 * (a lecture, rendered with class BlackInput) owns the rows under it
 * (tutorials / labs, rendered with class BlackTextCenter). Registration is
 * only possible to a sub-group that sits under the chosen primary group.
 */
export function parseCourse(html) {
  const name = text((html.match(/<p class="key">שם הקורס:<\/p>\s*<p class="val"[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '');
  const creditsCell = html.match(/נקודות זכות<\/span>:<\/p>\s*<p class="val"[^>]*>([\s\S]*?)<\/p>/);
  const hoursCell = html.match(/<p class="key">שעות:<\/p>\s*<p class="val"[^>]*>([\s\S]*?)<\/p>/);
  const credits = creditsCell ? parseFloat(text(creditsCell[1])) : null;
  const hours = hoursCell ? parseFloat(text(hoursCell[1])) : null;

  const groups = [];
  const start = html.indexOf('פרטי קבוצות לימוד');
  if (start >= 0) {
    let table = html.slice(start);
    const end = table.indexOf('</table>');
    if (end >= 0) table = table.slice(0, end);
    let current = null; // group receiving continuation rows
    let primary = null; // last primary group
    for (const row of table.split(/<tr[^>]*>/i).slice(1)) {
      const cells = [...row.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/gi)].map((c) => ({ attrs: c[1], html: c[2] }));
      if (!cells.length) continue;
      const first = cells[0];
      if (/scope="row"/.test(first.attrs)) {
        const n = parseInt(text(first.html), 10);
        if (Number.isNaN(n)) continue;
        const isPrimary = /class="BlackInput/.test(first.attrs);
        const meetingCell = cells.find((c) => c.html.includes('זמני לימוד'));
        const g = {
          n,
          type: text(cells[1]?.html || ''),
          lecturer: text(cells[2]?.html || '') || null,
          meetings: [],
        };
        const mt = meetingCell && parseMeeting(meetingCell.html);
        if (mt) g.meetings.push(mt);
        if (isPrimary || !primary) {
          g.subs = [];
          groups.push(g);
          primary = g;
        } else {
          primary.subs.push(g);
        }
        current = g;
      } else if (current) {
        const meetingCell = cells.find((c) => c.html.includes('זמני לימוד'));
        const mt = meetingCell && parseMeeting(meetingCell.html);
        if (mt) current.meetings.push(mt);
      }
    }
  }
  return { name, credits: Number.isFinite(credits) ? credits : null, hours: Number.isFinite(hours) ? hours : null, groups };
}
