const express = require('express');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const password = require('../password');
const { isEmail } = require('../email');
const { issue, E_DISABLED } = require('../middleware/auth');
const { MAX_USER_NAME, MAX_EMAIL, PASSWORD_MIN, PASSWORD_MAX } = require('../limits');

const router = express.Router();
const MAX = Number(process.env.AUTH_RATE_MAX) || 30;
const limiter = (opts = {}) => rateLimit({
  windowMs: 15 * 60 * 1000, limit: MAX, standardHeaders: true, legacyHeaders: false,
  message: { error: 'محاولات كثيرة، حاول بعد قليل' }, ...opts,
});
// Only failed logins count, so people behind one shared IP (office, school) aren't locked out.
const loginLimiter = limiter({ skipSuccessfulRequests: true });
const registerLimiter = limiter();
const pub = u => ({ id: u._id, name: u.name, email: u.email });

router.post('/register', registerLimiter, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const pass = String(req.body.password || '');
  if (!name || name.length > MAX_USER_NAME) return res.status(400).json({ error: 'الاسم مطلوب' });
  if (!isEmail(email)) return res.status(400).json({ error: 'الإيميل غير صالح' });
  if (pass.length < PASSWORD_MIN || pass.length > PASSWORD_MAX) return res.status(400).json({ error: `كلمة المرور من ${PASSWORD_MIN} إلى ${PASSWORD_MAX} حرفًا` });
  try {
    const user = await User.create({ name, email, passwordHash: await password.hash(pass) });
    issue(res, user._id);
    res.status(201).json({ user: pub(user) });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'هذا الإيميل مسجّل من قبل' });
    throw e;
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const pass = String(req.body.password || '').slice(0, 200);
  // An over-long email can't exist; skip the query but still pay the hashing cost.
  const user = email.length <= MAX_EMAIL ? await User.findOne({ email }).lean() : null;
  const ok = user ? await password.verify(pass, user.passwordHash) : await password.verifyDummy(pass);
  if (!ok) return res.status(401).json({ error: 'الإيميل أو كلمة المرور غير صحيحة' });
  // Only after the password was right, so the message does not reveal which emails belong to suspended accounts.
  if (user.disabled) return res.status(403).json(E_DISABLED);
  if (password.needsRehash(user.passwordHash)) {
    // Best effort: a failed upgrade must not block a correct login.
    try { await User.updateOne({ _id: user._id }, { $set: { passwordHash: await password.hash(pass) } }); }
    catch (e) { console.error('rehash failed', e); }
  }
  // Best effort too (it is only shown to admins), and awaited: a serverless function may be frozen once it responds.
  try { await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } }); }
  catch (e) { console.error('lastLoginAt failed', e); }
  issue(res, user._id, user.tokenVersion);
  res.json({ user: pub(user) });
});

module.exports = router;
