// Which faculty each department belongs to. Some population lists name only a faculty
// ("מדעי ההנדסה, תואר ראשון"); this tells whether that includes the student's department.
// A department missing here is never ruled out, only marked "worth checking".

const FACULTIES = {
  'מדעי הטבע': ['כימיה', 'מתמטיקה', 'פיזיקה', 'מדעי החיים', 'מדעי כדור הארץ והסביבה'],
  'מדעי ההנדסה': [
    'הנדסה אלקטרו-אופטית', 'הנדסה ביו-רפואית', 'הנדסה כימית', 'הנדסת ביוטכנולוגיה', 'הנדסת בניין', 'הנדסת חומרים',
    'הנדסת חשמל ומחשבים', 'הנדסת מחשבים', 'הנדסת מכונות', 'הנדסת מערכות תקשורת', 'הנדסת תעשיה וניהול', 'מכטרוניקה',
  ],
  'מדעי המחשב והמידע': ['מדעי המחשב'],
  'מדעי הבריאות': [
    'מדעי האחיות (סיעוד)', 'פיזיותרפיה', 'רוקחות', 'ריפוי בעיסוק', 'מדעי המעבדה הרפואית', 'רפואת חרום',
    "רפואה על שם ג'ויס וארוינג גולדמן", 'מדעי הרפואה', 'לימודי מדעי הבריאות שנה א',
  ],
  'ניהול על-שם גילפורד גלייזר': ['ניהול', 'ניהול תיירות ופנאי'],
  'מדעי הרוח והחברה': [
    'אמנויות', 'בלשנות', 'חינוך', 'כלכלה', 'לימודי המזרח התיכון', 'לשון עברית', 'ספרות עברית', 'ספרויות זרות',
    'סוציולוגיה ואנתרופולוגיה', 'פילוסופיה', 'פסיכולוגיה', 'עבודה סוציאלית', 'מדעי ההתנהגות', 'תקשורת',
    'מדעי הסביבה, גאואינפורמטיקה ותכנון ערים-גאוגרפיה', 'לימודי פוליטיקה וחברה אירופית', 'לימודי מדינת ישראל',
  ],
};

export const facultyOf = (dept) => Object.keys(FACULTIES).find((f) => FACULTIES[f].includes(dept)) || null;

const UNDERGRAD = 'תואר ראשון';

/**
 * Can someone with this profile ({ dept, year }) register to the group?
 * 'yes' – a row of its population list fits; 'no' – none could; 'maybe' – only rows that
 * depend on what we don't ask (track / major, an unmapped faculty) could.
 * No population list, or no profile, is always 'yes'.
 */
export function openTo(g, profile) {
  const rows = g?.pop;
  if (!rows?.length || !profile?.dept) return 'yes';
  let best = 'no';
  for (const r of rows) {
    if (r.degree && r.degree !== UNDERGRAD) continue;
    if (r.year && profile.year && r.year !== profile.year) continue;
    let fit = 'yes';
    if (r.dept) {
      if (r.dept !== profile.dept) continue;
    } else if (r.faculty) {
      const f = facultyOf(profile.dept);
      if (f && f !== r.faculty) continue;
      if (!f) fit = 'maybe';
    }
    if (r.year && !profile.year) fit = 'maybe';
    if (r.track || r.major || r.project) fit = 'maybe';
    if (fit === 'yes') return 'yes';
    best = 'maybe';
  }
  return best;
}

/** "מדעי המחשב (שנה א׳, חד מחלקתי)" lines for showing a population list. */
export function popLines(g) {
  const YEARS = ['', 'א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳'];
  return (g?.pop || []).map((r) => {
    const extra = [r.year && `שנה ${YEARS[r.year] || r.year}`, r.track, r.major, r.degree && r.degree !== UNDERGRAD && r.degree].filter(Boolean);
    return `${r.dept || `פקולטה ל${r.faculty}` || 'כולם'}${extra.length ? ` (${extra.join(', ')})` : ''}`;
  });
}
