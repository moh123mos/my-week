// The one place a Week document becomes what the client sees.
const WEEK_FIELDS = 'week checks start end items';

// Cheap guard so the client never sees a week without all three maps.
const toClientWeek = w => ({ checks: w.checks || {}, start: w.start || {}, end: w.end || {} });
// A backup keeps the week's own rows only when it has them.
const toExportWeek = w => ({ ...toClientWeek(w), ...(Array.isArray(w.items) ? { items: w.items } : {}) });
const weeksByKey = docs => Object.fromEntries(docs.map(w => [w.week, toExportWeek(w)]));

module.exports = { WEEK_FIELDS, toClientWeek, weeksByKey };
