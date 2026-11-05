const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const connect = require('../db');
const User = require('../models/User');

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

// A token is only as good as the account behind it: every request checks that the account still exists, is not
// suspended and that the token's version is current (an admin bumps it to sign the user out everywhere). One cheap
// indexed read, remembered per process for a few seconds so a burst of saves does not repeat it. Suspending,
// deleting or resetting an account clears the entry on the instance that did it; other serverless instances
// follow within AUTH_CACHE_MS. 0 turns the memory off (every request reads the database).
const CACHE_MS = process.env.AUTH_CACHE_MS === undefined ? 5000 : Math.max(0, Number(process.env.AUTH_CACHE_MS) || 0);
const CACHE_MAX = 5000;
const accounts = new Map();

const E_SESSION = { error: 'انتهت الجلسة، سجّل الدخول مجددًا' };
const E_MISSING = { error: 'الحساب غير موجود' };
const E_DISABLED = { error: 'تم إيقاف هذا الحساب، تواصل مع المسؤول', code: 'disabled' };

function issue(res, userId, tokenVersion = 0) {
  const token = jwt.sign({ sub: String(userId), tv: tokenVersion || 0 }, KEY, { expiresIn: `${DAYS}d`, algorithm: ALG });
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

// null = no such account.
async function account(id) {
  const now = Date.now();
  const hit = accounts.get(id);
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  await connect();
  const u = await User.findById(id).select('disabled tokenVersion').lean();
  const value = u ? { disabled: !!u.disabled, tv: u.tokenVersion || 0 } : null;
  if (CACHE_MS) {
    if (accounts.size >= CACHE_MAX) accounts.clear();
    accounts.set(id, { at: now, value });
  }
  return value;
}

// Call after changing an account on this instance so its effect is immediate here.
const forget = id => { accounts.delete(String(id)); };

async function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE];
  if (!token) return res.status(401).json({ error: 'غير مسجّل الدخول' });
  let claims;
  try {
    claims = jwt.verify(token, KEY, { algorithms: [ALG] });
  } catch (_) {
    clear(res);
    return res.status(401).json(E_SESSION);
  }
  try {
    // Our own tokens always carry a valid id, but a database error must never come from a malformed one.
    const acc = mongoose.isValidObjectId(claims.sub) ? await account(claims.sub) : null;
    if (!acc) { clear(res); return res.status(401).json(E_MISSING); }
    if (acc.disabled) { clear(res); return res.status(401).json(E_DISABLED); }
    // Tokens issued before versions existed have no `tv` and count as 0, like an account that has never had one bumped.
    if ((claims.tv || 0) !== acc.tv) { clear(res); return res.status(401).json(E_SESSION); }
    req.userId = claims.sub;
    next();
  } catch (e) {
    next(e);
  }
}

// Admin routes only. Never cached and never read from the token: taking the role away must work on the next request.
async function requireAdmin(req, res, next) {
  const u = await User.findById(req.userId).select('name email role disabled').lean();
  if (!u || u.disabled || u.role !== 'admin') return res.status(403).json({ error: 'غير مصرّح لك بهذه الصفحة' });
  req.admin = { id: u._id, name: u.name, email: u.email };
  next();
}

module.exports = { issue, clear, forget, requireAuth, requireAdmin, E_DISABLED };
