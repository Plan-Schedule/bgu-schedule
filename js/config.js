// Everything that is specific to one university or to this deployment.
// Supporting another university later starts here (plus a scraper for its catalogue).

export const CONFIG = {
  appName: 'מתכנן מערכת שעות',
  university: {
    id: 'bgu',
    name: 'אוניברסיטת בן-גוריון בנגב',
    short: 'בן-גוריון',
    catalogueName: 'קובץ הקורסים',
    catalogueUrl: 'https://bgu4u.bgu.ac.il/pls/scwp/!app.gate?app=ann',
  },
  // Where "יש לי הערה" leads: a Google Form, so no account is needed to send one.
  feedbackUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSfaeSm2csPLuLKGGCbJIaN91LJRI26RXIliW6JlI_YnheREPw/viewform',
  sourceUrl: 'https://github.com/Plan-Schedule/bgu-schedule',
  // The site's new home (e.g. 'https://bgu-schedule.pages.dev/'). When set, the old
  // GitHub Pages address sends everyone there and takes their saved data along
  // (see js/move.js). Empty = stay on GitHub Pages.
  movedTo: '',
  // Anonymous visit counter (see js/stats.js). Empty = off.
  statsUrl: 'https://plan-schedule.goatcounter.com/count',
};
