/**
 * Creates the "יש לי הערה" Google Form for the planner, plus a Google Sheet
 * that collects the answers.
 *
 * How to use: script.google.com → New project → paste this file → Run
 * (approve the permissions it asks for) → the links appear in the log.
 */
function createFeedbackForm() {
  const form = FormApp.create('מתכנן מערכת שעות · יש לי הערה');
  form
    .setDescription(
      'מצאתם באג, שעה שלא מתאימה לאתר האוניברסיטה, או יש לכם רעיון? נשמח לשמוע.\n' +
      'המתכנן הוא כלי עצמאי של סטודנטים, לא אתר רשמי של האוניברסיטה.'
    )
    .setCollectEmail(false)
    .setAllowResponseEdits(false)
    .setLimitOneResponsePerUser(false) // true would force people to sign in to Google
    .setShowLinkToRespondAgain(true)
    .setConfirmationMessage('תודה! קיבלנו את ההערה 🙏');

  form.addMultipleChoiceItem()
    .setTitle('על מה ההערה?')
    .setChoiceValues([
      'משהו לא עובד (באג)',
      'שעה, קבוצה או מרצה לא נכונים',
      'רעיון לשיפור',
      'אחר',
    ])
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle('מה קרה? / מה הרעיון?')
    .setHelpText('כמה שיותר פרטים עוזרים לנו לתקן מהר.')
    .setRequired(true);

  form.addTextItem()
    .setTitle('מספר קורס וקבוצה (אם ההערה על קורס מסוים)')
    .setHelpText('למשל 212.1.0201, קבוצה 21');

  form.addMultipleChoiceItem()
    .setTitle('באיזה מכשיר?')
    .setChoiceValues(['אייפון', 'אנדרואיד', 'מחשב'])
    .showOtherOption(true);

  form.addTextItem()
    .setTitle('איך אפשר לחזור אליך? (לא חובה)')
    .setHelpText('מייל או טלפון, רק אם תרצו שנחזור אליכם.');

  const sheet = SpreadsheetApp.create('הערות · מתכנן מערכת שעות');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());

  const url = form.getPublishedUrl();
  Logger.log('קישור לטופס (את זה שולחים לי): ' + form.shortenFormUrl(url));
  Logger.log('עריכת הטופס: ' + form.getEditUrl());
  Logger.log('גיליון התשובות: ' + sheet.getUrl());
}
