const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// Fail at load, not on the first login: a short or missing secret makes every token forgeable.
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) throw new Error('JWT_SECRET must be set to a random string of at least 32 characters');
// Hand jsonwebtoken a ready KeyObject. Given a string it first tries to parse it as a PEM key and throws on every
// call (~0.5 ms each for sign and verify, a third of a request's CPU). Tokens signed from the string still verify.
const KEY = crypto.createSecretKey(Buffer.from(SECRET));

const DAYS = Number(process.env.SESSION_DAYS) || 30;
const COOKIE = 'mw_token';
const MAX_AGE = DAYS * 24 * 60 * 60 * 1000;
const ALG = 'HS256';

function issue(res, userId) {
  const token = jwt.sign({ sub: String(userId) }, KEY, { expiresIn: `${DAYS}d`, algorithm: ALG });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE,
    path: '/',
  });
}

function clear(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE];
  if (!token) return res.status(401).json({ error: 'غير مسجّل الدخول' });
  try {
    req.userId = jwt.verify(token, KEY, { algorithms: [ALG] }).sub;
    next();
  } catch (_) {
    clear(res);
    res.status(401).json({ error: 'انتهت الجلسة، سجّل الدخول مجددًا' });
  }
}

module.exports = { issue, clear, requireAuth };
