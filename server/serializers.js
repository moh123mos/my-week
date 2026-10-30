// The one place a Week document becomes what the client sees.
const WEEK_FIELDS = 'week checks start end';

// Cheap guard so the client never sees a week without all three maps.
const toClientWeek = w => ({ checks: w.checks || {}, start: w.start || {}, end: w.end || {} });
const weeksByKey = docs => Object.fromEntries(docs.map(w => [w.week, toClientWeek(w)]));

module.exports = { WEEK_FIELDS, toClientWeek, weeksByKey };
