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
  // Where "יש לי הערה" leads. A Google Form works for people without a GitHub account.
  feedbackUrl: 'https://github.com/Plan-Schedule/bgu-schedule/issues/new?template=feedback.yml',
  sourceUrl: 'https://github.com/Plan-Schedule/bgu-schedule',
};
