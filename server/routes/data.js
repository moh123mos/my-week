const express = require('express');
const Settings = require('../models/Settings');
const Week = require('../models/Week');
const { requireAuth } = require('../middleware/auth');
const { isWeekKey, cleanItems, cleanWeek, weekFieldPaths, parseKeys, isObj } = require('../validate');
const { WEEK_FIELDS, weeksByKey } = require('../serializers');
const { MAX_WEEKS_PER_SAVE, MAX_IMPORT_WEEKS } = require('../limits');

const router = express.Router();
router.use(requireAuth);

// Delta save: set only the fields that were sent. Two devices editing different boxes of the same week don't
// overwrite each other (last write wins per field, not per week).
const fieldOp = (userId, key, set) => ({
  updateOne: { filter: { userId, week: key }, update: { $set: set }, upsert: true },
});
// Import: the week is replaced as a whole.
const replaceOp = (userId, key, w) => ({
  updateOne: { filter: { userId, week: key }, update: { $set: w }, upsert: true },
});

// Weeks the user navigated to.
router.get('/weeks', async (req, res) => {
  const keys = parseKeys(req.query.keys);
  const docs = keys.length ? await Week.find({ userId: req.userId, week: { $in: keys } }).select(WEEK_FIELDS).lean() : [];
  res.json({ weeks: weeksByKey(docs) });
});

// Delta save: only the rows and/or the fields of the weeks that changed.
router.put('/', async (req, res) => {
  const { items, weeks } = req.body;
  const ops = [];
  let cleanedItems = null;
  if (items !== undefined) {
    cleanedItems = cleanItems(items);
    if (!cleanedItems) return res.status(400).json({ error: 'بيانات غير صالحة' });
  }
  if (weeks !== undefined) {
    if (!isObj(weeks)) return res.status(400).json({ error: 'بيانات غير صالحة' });
    const entries = Object.entries(weeks);
    if (entries.length > MAX_WEEKS_PER_SAVE) return res.status(400).json({ error: 'بيانات كثيرة' });
    for (const [key, w] of entries) {
      const c = cleanWeek(w);
      if (!isWeekKey(key) || !c) return res.status(400).json({ error: 'بيانات غير صالحة' });
      const set = weekFieldPaths(c);
      if (Object.keys(set).length) ops.push(fieldOp(req.userId, key, set));
    }
  }
  await Promise.all([
    cleanedItems && Settings.updateOne({ userId: req.userId }, { $set: { items: cleanedItems } }, { upsert: true }),
    ops.length && Week.bulkWrite(ops, { ordered: false }),
  ]);
  res.json({ ok: true });
});

// Full backup in the same shape the app always exported: { v, items, weeks }.
router.get('/export', async (req, res) => {
  const [settings, docs] = await Promise.all([
    Settings.findOne({ userId: req.userId }).lean(),
    Week.find({ userId: req.userId }).select(WEEK_FIELDS).lean(),
  ]);
  res.json({ v: 1, items: settings ? settings.items : [], weeks: weeksByKey(docs) });
});

// Replace everything (import a backup, or upload the pre-account localStorage data).
router.put('/import', async (req, res) => {
  const s = req.body.state;
  const items = s && cleanItems(s.items);
  if (!items || !isObj(s.weeks)) return res.status(400).json({ error: 'الملف غير صالح' });
  const entries = Object.entries(s.weeks);
  if (entries.length > MAX_IMPORT_WEEKS) return res.status(400).json({ error: 'الملف كبير جدًا' });
  const ops = [];
  for (const [key, w] of entries) {
    const c = cleanWeek(w);
    if (!isWeekKey(key) || !c) return res.status(400).json({ error: 'الملف غير صالح' });
    ops.push(replaceOp(req.userId, key, c));
  }
  // Write first, delete the leftovers last: a failure midway can't leave the user with nothing (the import can simply be repeated).
  if (ops.length) await Week.bulkWrite(ops, { ordered: false });
  await Settings.updateOne({ userId: req.userId }, { $set: { items } }, { upsert: true });
  await Week.deleteMany({ userId: req.userId, week: { $nin: entries.map(([k]) => k) } });
  res.json({ ok: true });
});

router.delete('/', async (req, res) => {
  await Promise.all([Week.deleteMany({ userId: req.userId }), Settings.deleteOne({ userId: req.userId })]);
  res.json({ ok: true });
});

module.exports = router;
