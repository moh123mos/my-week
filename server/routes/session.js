const express = require('express');
const User = require('../models/User');
const Settings = require('../models/Settings');
const { issue, clear, requireAuth } = require('../middleware/auth');
const { parseKeys } = require('../validate');
const { loadWeeks } = require('../weeks');

const router = express.Router();

// One round trip on page load: who am I + my rows + the weeks being displayed.
// Also re-issues the cookie so active users stay signed in.
router.get('/', requireAuth, async (req, res) => {
  const keys = parseKeys(req.query.weeks);
  const [user, settings] = await Promise.all([
    User.findById(req.userId).select('name email role tokenVersion').lean(),
    Settings.findOne({ userId: req.userId }).select('items').lean(),
  ]);
  if (!user) { clear(res); return res.status(401).json({ error: 'الحساب غير موجود' }); }
  const weeks = await loadWeeks(req.userId, keys, settings ? settings.items : []);
  issue(res, user._id, user.tokenVersion);
  // `items` is only the signal "this account has a notebook"; the rows to show come with each week.
  res.json({
    user: { id: user._id, name: user.name, email: user.email, isAdmin: user.role === 'admin' },
    items: settings ? settings.items : null,
    weeks,
  });
});

module.exports = router;
