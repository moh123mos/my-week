const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const password = require('./password');

const legacyHash = pw => {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
};

test('hash then verify round-trips and uses the new format', async () => {
  const h = await password.hash('correct horse');
  assert.match(h, /^scrypt\$16384\$8\$1\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(await password.verify('correct horse', h), true);
  assert.equal(password.needsRehash(h), false);
});

test('wrong password fails', async () => {
  const h = await password.hash('correct horse');
  assert.equal(await password.verify('wrong horse', h), false);
  assert.equal(await password.verify('', h), false);
});

test('malformed stored strings fail closed without throwing', async () => {
  const good = await password.hash('pw');
  const [, n, r, p, salt, key] = good.split('$');
  const bad = [
    '', 'garbage', 'scrypt', 'scrypt$', 'scrypt$zz$yy', 'scrypt$$', `bcrypt$${salt}$${key}`,
    `scrypt$${n}$${r}$${p}$${salt}`, `scrypt$${n}$${r}$${p}$${salt}$${key}$extra`,
    `scrypt$${n}$${r}$${p}$zz$${key}`, `scrypt$${n}$${r}$${p}$${salt}$`,
    `scrypt$-1$${r}$${p}$${salt}$${key}`, `scrypt$abc$${r}$${p}$${salt}$${key}`,
    `scrypt$16383$${r}$${p}$${salt}$${key}`, `scrypt$0$${r}$${p}$${salt}$${key}`,
    `scrypt$${n}$0$${p}$${salt}$${key}`, `scrypt$${n}$${r}$0$${salt}$${key}`,
  ];
  for (const s of bad) assert.equal(await password.verify('pw', s), false, s);
  assert.equal(await password.verify('pw', null), false);
  assert.equal(await password.verify('pw', undefined), false);
});

test('absurd cost params are refused before scrypt runs', async () => {
  const good = await password.hash('pw');
  const [, , , , salt, key] = good.split('$');
  const t = Date.now();
  for (const params of ['4194304$8$1', '1048576$8$1', '262144$8$1', '16384$1024$1', '16384$8$64', '999999999999$8$1']) {
    assert.equal(await password.verify('pw', `scrypt$${params}$${salt}$${key}`), false, params);
  }
  assert.ok(Date.now() - t < 1000);
});

test('old scrypt$salt$key hashes still verify and need a rehash', async () => {
  const h = legacyHash('old password');
  assert.equal(await password.verify('old password', h), true);
  assert.equal(await password.verify('nope', h), false);
  assert.equal(password.needsRehash(h), true);
});

test('needsRehash is true for other params and false for garbage', async () => {
  const [, , , , salt, key] = (await password.hash('pw')).split('$');
  assert.equal(password.needsRehash(`scrypt$8192$8$1$${salt}$${key}`), true);
  assert.equal(password.needsRehash(`scrypt$16384$8$2$${salt}$${key}`), true);
  assert.equal(password.needsRehash(`scrypt$16384$8$1$${salt}$${key}`), false);
  assert.equal(password.needsRehash('garbage'), false);
});

test('a hash made with other params verifies using its own params', async () => {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync('pw', salt, 64, { N: 8192, r: 8, p: 1 });
  const h = `scrypt$8192$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
  assert.equal(await password.verify('pw', h), true);
  assert.equal(password.needsRehash(h), true);
});

test('verifyDummy always returns false', async () => {
  assert.equal(await password.verifyDummy('anything'), false);
});
