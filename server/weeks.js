// Loads the weeks on screen together with the habit rows each one shows.
//
// A week shows: its own rows if it has them; otherwise, if its doc exists (it predates per-week rows),
// Settings.items; otherwise (never written) the rows of the nearest earlier week that has its own,
// falling back to Settings.items. A week is given its own rows the first time anything is written to it,
// so a week with data never changes when an earlier one is edited.
const Week = require('./models/Week');
const { WEEK_FIELDS, toClientWeek } = require('./serializers');

const hasItems = w => !!w && Array.isArray(w.items);

async function loadWeeks(userId, keys, baseItems) {
  if (!keys.length) return {};
  const docs = await Week.find({ userId, week: { $in: keys } }).select(WEEK_FIELDS).lean();
  const byKey = new Map(docs.map(d => [d.week, d]));
  const out = {};
  await Promise.all(keys.map(async k => {
    const doc = byKey.get(k);
    let items = baseItems, own = false;
    if (hasItems(doc)) {
      items = doc.items;
      own = true;
    } else if (!doc) {
      const earlier = await Week.findOne({ userId, week: { $lt: k }, items: { $exists: true } })
        .sort({ week: -1 }).select('items').lean();
      if (hasItems(earlier)) items = earlier.items;
    }
    out[k] = { ...toClientWeek(doc || {}), items, own };
  }));
  return out;
}

module.exports = { loadWeeks };
