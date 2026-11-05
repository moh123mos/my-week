// Constants shared by the client modules. No DOM here, so it can be imported from tests.

export const DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
export const DAYS_SHORT = ['س', 'ح', 'ن', 'ث', 'ر', 'خ', 'ج'];
export const DAYS_IN_WEEK = DAYS.length;
// A habit's tracked days are a bitmask (bit 0 = Saturday .. bit 6 = Friday). Mirrors ALL_DAYS in server/validate.js.
export const ALL_DAYS = (1 << DAYS_IN_WEEK) - 1;

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

// The week-as-an-image feature. Colours mirror the :root tokens in style.css (a canvas can't read var()).
export const SHARE = {
  WIDTH: 1080,
  SIZES: { portrait: 1350, story: 1920 },
  SIZE_LABELS: { auto: 'تلقائي', portrait: 'عمودي', story: 'قصة' },
  // Below this a row is too small to read once a phone downsizes the picture, so "auto" moves to the taller size.
  AUTO_MIN_ROW: 64,
  PREFS_KEY: 'mw_share',
  LAYOUT: {
    margin: 64, pad: 52, head: 176, summary: 230, dayHead: 64, gap: 20,
    rhythmTitle: 28, bars: 140, stat: 48, footer: 70,
    minRow: 60, maxRow: { portrait: 92, story: 112 }, noteH: 40, moreH: 48,
    nameW: 360, countW: 90,
  },
  COLORS: {
    bg: '#0f1320',
    rule: 'oklch(.88 .03 265 / .14)',
    ruleStrong: 'oklch(.88 .03 265 / .3)',
    ink: 'oklch(.95 .015 90)',
    ink2: 'oklch(.78 .025 265)',
    moon: 'oklch(.89 .085 88)',
    moonInk: 'oklch(.2 .03 268)',
    moonDark: 'oklch(.27 .03 268)',
    mare: 'oklch(.8 .08 85)',
    moonTint: 'oklch(.89 .085 88 / .09)',
    miss: 'oklch(.72 .02 265)',
    missFill: 'oklch(.72 .02 265 / .16)',
    periods: {
      sobh: 'oklch(.79 .09 235)', dhuhr: 'oklch(.87 .13 100)', asr: 'oklch(.78 .13 65)',
      maghrib: 'oklch(.73 .13 30)', isha: 'oklch(.72 .1 285)',
    },
  },
};

export const MESSAGES = {
  SHARE_FAILED: 'تعذّر تجهيز الصورة، حاول مرة أخرى.',
  SHARE_FUTURE: 'لا يمكن مشاركة أسبوع لم يبدأ بعد',
  OFFLINE: 'تعذّر الاتصال بالخادم، تحقق من الإنترنت',
  GENERIC_ERROR: 'حدث خطأ، حاول مرة أخرى',
  SESSION_EXPIRED: 'انتهت الجلسة، سجّل الدخول مجددًا',
  BAD_FILE: 'الملف غير صالح.',
};
