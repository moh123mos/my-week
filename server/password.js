// scrypt runs on libuv's thread pool, so hashing never blocks the event loop (bcryptjs does).
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
// Cost is deliberately modest: N=16384 (16 MB, tens of ms) keeps login fast and cheap on small serverless CPUs.
// OWASP's stronger N=2^17 needs 128 MB per hash and Node's default maxmem is 32 MB, so raising it means
// raising maxmem and the function's memory too. The params live in each hash, so it can be raised later
// and needsRehash() will upgrade users as they log in.
const N = 16384, R = 8, P = 1, LEN = 64;
const MAX_N = 2 ** 17, MAX_R = 16, MAX_P = 4;
const HEX = /^(?:[0-9a-f]{2})+$/;

// "scrypt$N$r$p$salt$key", or the first format "scrypt$salt$key" (always N=16384, r=8, p=1).
// Params come from the database, so anything odd is rejected before it can ask scrypt for a lot of memory.
function parse(stored) {
  const a = String(stored).split('$');
  if (a[0] !== 'scrypt') return null;
  let n = 16384, r = 8, p = 1, salt, key;
  const legacy = a.length === 3;
  if (legacy) [, salt, key] = a;
  else if (a.length === 6) {
    if (!a.slice(1, 4).every(x => /^\d{1,7}$/.test(x))) return null;
    [n, r, p] = a.slice(1, 4).map(Number);
    [, , , , salt, key] = a;
  } else return null;
  if (n < 2 || n > MAX_N || (n & (n - 1)) !== 0 || r < 1 || r > MAX_R || p < 1 || p > MAX_P) return null;
  if (!HEX.test(salt || '') || !HEX.test(key || '') || salt.length > 128 || key.length > 256) return null;
  return { legacy, n, r, p, salt: Buffer.from(salt, 'hex'), key: Buffer.from(key, 'hex') };
}

async function hash(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, LEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verify(password, stored) {
  const h = parse(stored);
  if (!h) return false;
  try {
    const key = await scrypt(password, h.salt, h.key.length, { N: h.n, r: h.r, p: h.p });
    return crypto.timingSafeEqual(key, h.key);
  } catch (_) { return false; }
}

// True when the stored hash was made with other params (or the old format), so login can upgrade it.
function needsRehash(stored) {
  const h = parse(stored);
  return !!h && (h.legacy || h.n !== N || h.r !== R || h.p !== P || h.key.length !== LEN);
}

// Same cost for unknown emails, so response time doesn't reveal which emails exist.
let dummy;
async function verifyDummy(password) {
  dummy ||= await hash('dummy-password');
  await verify(password, dummy);
  return false;
}

module.exports = { hash, verify, verifyDummy, needsRehash };
