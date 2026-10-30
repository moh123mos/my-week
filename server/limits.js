// Every size limit in one place. The client mirrors some of them (maxlength, add-item button) in public/app.js.
module.exports = {
  MAX_ITEMS: 100,
  MAX_NAME: 100,
  MAX_TEXT: 300,
  MAX_USER_NAME: 60,
  MAX_EMAIL: 254,
  PASSWORD_MIN: 8,
  PASSWORD_MAX: 128,
  MAX_WEEKS_PER_SAVE: 20,
  MAX_IMPORT_WEEKS: 2000,
  // A normal save is ~1KB. Only restoring a backup needs more room.
  BODY_LIMIT: '100kb',
  IMPORT_BODY_LIMIT: '4mb',
};
