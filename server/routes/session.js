const express = require('express');
const User = require('../models/User');
const Settings = require('../models/Settings');
const Week = require('../models/Week');
const { issue, clear, requireAuth } = require('../middleware/auth');
const { parseKeys } = require('../validate');
const { WEEK_FIELDS, weeksByKey } = require('../serializers');

const router = express.Router();

// One round trip on page load: who am I + my rows + the weeks being displayed.
// Also re-issues the cookie so active users stay signed in.
router.get('/', requireAuth, async (req, res) => {
  const keys = parseKeys(req.query.weeks);
  const [user, settings, weeks] = await Promise.all([
    User.findById(req.userId).select('name email').lean(),
    Settings.findOne({ userId: req.userId }).select('items').lean(),
    keys.length ? Week.find({ userId: req.userId, week: { $in: keys } }).select(WEEK_FIELDS).lean() : [],
  ]);
  if (!user) { clear(res); return res.status(401).json({ error: 'الحساب غير موجود' }); }
  issue(res, user._id);
  res.json({
    user: { id: user._id, name: user.name, email: user.email },
    items: settings ? settings.items : null,
    weeks: weeksByKey(weeks),
  });
});

module.exports = router;
