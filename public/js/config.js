// Constants shared by the client modules. No DOM here, so it can be imported from tests.

export const DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
export const DAYS_SHORT = ['س', 'ح', 'ن', 'ث', 'ر', 'خ', 'ج'];
export const DAYS_IN_WEEK = DAYS.length;

// Each key needs a matching --p-<key> colour in style.css and an entry in PERIODS in server/validate.js.
export const PERIODS = { sobh: 'الصبح', dhuhr: 'الضهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' };
export const DEFAULT_PERIOD = 'sobh';

export const CHECK_DONE = 1;
export const CHECK_MISSED = 2;
// Indexed by check value: 0 empty, 1 done, 2 missed.
export const CHECK_LABELS = ['لم يُحدد', 'أنجزت', 'فاتني'];

// The per-week maps. A new one also needs cleanWeek, weekFieldPaths and serializers.js on the server.
export const WEEK_FIELDS = ['checks', 'start', 'end'];

// Mirrors server/limits.js (test/client/mirrors.test.mjs fails if they drift apart).
export const LIMITS = {
  MAX_ITEMS: 100,
  MAX_NAME: 100,
  MAX_TEXT: 300,
  MAX_USER_NAME: 60,
  MAX_EMAIL: 254,
  PASSWORD_MIN: 8,
  MAX_WEEKS_PER_SAVE: 20,
};

export const TIMING = {
  SAVE_DEBOUNCE_MS: 600,
  SAVE_BUSY_RETRY_MS: 300,
  SAVE_FAIL_RETRY_MS: 5000,
  IDLE_POLL_MS: 50,
  RESYNC_MIN_GAP_MS: 30000,
  REQUEST_TIMEOUT_MS: 15000,
  BACKUP_TIMEOUT_MS: 30000,
  BOOT_RETRY_MS: [700, 1800],
  SAVED_FLASH_MS: 1400,
  MOON_ANIMATION_MS: 600,
  CLOCK_TICK_MS: 60000,
  DOWNLOAD_REVOKE_MS: 1000,
};

export const MESSAGES = {
  OFFLINE: 'تعذّر الاتصال بالخادم، تحقق من الإنترنت',
  GENERIC_ERROR: 'حدث خطأ، حاول مرة أخرى',
  SESSION_EXPIRED: 'انتهت الجلسة، سجّل الدخول مجددًا',
  BAD_FILE: 'الملف غير صالح.',
};
