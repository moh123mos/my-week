const test = require('node:test');
const assert = require('node:assert/strict');
const { isEmail } = require('./email');

test('isEmail accepts normal addresses', () => {
  for (const e of ['a@b.co', 'first.last@mail.example.com', 'smoke_a_1@test.com', 'q@q.co']) assert.equal(isEmail(e), true, e);
});

test('isEmail rejects malformed addresses', () => {
  for (const e of ['bad', 'a@b', 'a@@b.co', 'a b@c.co', '@b.co', 'a@.co', 'a@b..co', 'a@b.', '', null, undefined, {}]) assert.equal(isEmail(e), false, String(e));
});

test('isEmail rejects addresses over 254 chars', () => {
  assert.equal(isEmail('a@' + 'b'.repeat(250) + '.co'), false);
});

test('isEmail finishes fast on hostile input', () => {
  const inputs = ['a@' + 'a.'.repeat(50000), 'a'.repeat(100000), '@'.repeat(100000), 'a@' + 'a'.repeat(100000) + '!', ('a@a' + '.').repeat(30000)];
  for (const s of inputs) {
    const t = process.hrtime.bigint();
    assert.equal(isEmail(s), false);
    assert.ok(Number(process.hrtime.bigint() - t) / 1e6 < 100, 'took too long');
  }
});
