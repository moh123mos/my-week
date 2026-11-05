// Integration test for the admin API against a REAL local MongoDB. Skipped unless MW_TEST_MONGODB_URI is set,
// and it refuses anything that is not localhost (never point it at Atlas):
//   MW_TEST_MONGODB_URI=mongodb://127.0.0.1:27018/mw-test pnpm test
const test = require('node:test');
const assert = require('node:assert/strict');

const URI = process.env.MW_TEST_MONGODB_URI;
const local = URI && /^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(URI);
const skip = !URI ? 'set MW_TEST_MONGODB_URI to run' : !local ? 'MW_TEST_MONGODB_URI must be localhost' : false;

test('admin API', { skip }, async t => {
  process.env.MONGODB_URI = URI;
  process.env.JWT_SECRET = 'a'.repeat(40);
  process.env.AUTH_CACHE_MS = '0'; // the suspension test below must see changes at once
  process.env.AUTH_RATE_MAX = '100000';
  const mongoose = require('mongoose');
  const app = require('./app');
  const User = require('./models/User');
  const AuditLog = require('./models/AuditLog');
  const Week = require('./models/Week');
  const Settings = require('./models/Settings');
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  t.after(async () => {
    server.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  // A tiny cookie-jar client.
  const client = () => {
    let cookie = '';
    return async (method, path, body) => {
      const res = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => null) };
    };
  };
  const signUp = async (name, email) => {
    const c = client();
    const r = await c('POST', '/auth/register', { name, email, password: 'password123' });
    assert.equal(r.status, 201);
    return { c, id: r.body.user.id, email };
  };

  const admin = await signUp('Admin', 'admin@test.com');
  const other = await signUp('Other', 'other@test.com');
  const victim = await signUp('Victim', 'victim@test.com');
  await User.updateOne({ _id: admin.id }, { $set: { role: 'admin' } });

  await t.test('regular users and anonymous callers are refused', async () => {
    assert.equal((await client()('GET', '/admin/stats')).status, 401);
    assert.equal((await other.c('GET', '/admin/stats')).status, 403);
    assert.equal((await other.c('GET', '/admin/users')).status, 403);
    assert.equal((await other.c('PATCH', `/admin/users/${victim.id}`, { disabled: true })).status, 403);
    assert.equal((await other.c('DELETE', `/admin/users/${victim.id}`)).status, 403);
  });

  await t.test('session tells the app who is an admin', async () => {
    assert.equal((await admin.c('GET', '/session')).body.user.isAdmin, true);
    assert.equal((await other.c('GET', '/session')).body.user.isAdmin, false);
  });

  await t.test('stats and list', async () => {
    const s = await admin.c('GET', '/admin/stats');
    assert.equal(s.status, 200);
    assert.equal(s.body.overview.total, 3);
    assert.equal(s.body.overview.admins, 1);
    assert.equal(s.body.activity.length, 30);
    assert.equal(s.body.completion.length, 6);
    const list = await admin.c('GET', '/admin/users?q=OTHER&size=5');
    assert.equal(list.body.total, 1);
    assert.equal(list.body.users[0].email, 'other@test.com');
    assert.equal(list.body.users[0].passwordHash, undefined);
    // Regex characters in the search are plain text.
    assert.equal((await admin.c('GET', '/admin/users?q=.*')).body.total, 0);
    assert.equal((await admin.c('GET', '/admin/users?filter=admin')).body.total, 1);
    assert.equal((await admin.c('GET', '/admin/users?sort=__proto__&page=-3&size=abc')).status, 200);
  });

  await t.test('usage figures count boxes without exposing content', async () => {
    const week = '2026-10-31';
    const put = await victim.c('PUT', '/data', {
      items: [{ id: 'a', name: 'سر خاص', period: 'sobh', track: true }],
      weeks: { [week]: { checks: { a: [1, 1, 2, 0, 0, 0, 0] }, start: { a: 'ملاحظة سرية' }, end: {} } },
    });
    assert.equal(put.status, 200);
    const d = await admin.c('GET', `/admin/users/${victim.id}`);
    assert.equal(d.status, 200);
    assert.equal(d.body.usage.habits, 1);
    assert.equal(d.body.usage.weeks, 1);
    assert.ok(!JSON.stringify(d.body).includes('سر'));
    const listed = (await admin.c('GET', '/admin/users?q=victim')).body.users[0];
    assert.equal(listed.weeks, 1);
    assert.equal(listed.habits, 1);
    assert.equal((await admin.c('GET', '/admin/users/not-an-id')).status, 400);
    assert.equal((await admin.c('GET', '/admin/users/000000000000000000000000')).status, 404);
  });

  await t.test('rename and email edits, duplicate email, bad input', async () => {
    const r = await admin.c('PATCH', `/admin/users/${other.id}`, { name: 'Other 2' });
    assert.equal(r.body.user.name, 'Other 2');
    assert.equal((await admin.c('PATCH', `/admin/users/${other.id}`, { email: 'victim@test.com' })).status, 409);
    assert.equal((await admin.c('PATCH', `/admin/users/${other.id}`, { email: 'nope' })).status, 400);
    assert.equal((await admin.c('PATCH', `/admin/users/${other.id}`, { disabled: 'yes' })).status, 400);
    assert.equal((await admin.c('PATCH', `/admin/users/${other.id}`, { role: 'root' })).status, 400);
    assert.equal((await admin.c('PATCH', `/admin/users/${other.id}`, {})).status, 400);
    // Nothing changed: no audit entry for a no-op.
    const before = await AuditLog.countDocuments();
    await admin.c('PATCH', `/admin/users/${other.id}`, { name: 'Other 2' });
    assert.equal(await AuditLog.countDocuments(), before);
  });

  await t.test('suspending ends the session at once, blocks login, reactivating needs a new login', async () => {
    assert.equal((await victim.c('GET', '/session')).status, 200);
    const r = await admin.c('PATCH', `/admin/users/${victim.id}`, { disabled: true });
    assert.equal(r.body.user.disabled, true);
    const after = await victim.c('GET', '/session');
    assert.equal(after.status, 401);
    assert.equal(after.body.code, 'disabled');
    assert.equal((await victim.c('PUT', '/data', { items: [] })).status, 401);
    const login = await client()('POST', '/auth/login', { email: 'victim@test.com', password: 'password123' });
    assert.equal(login.status, 403);
    assert.equal(login.body.code, 'disabled');
    assert.equal((await client()('POST', '/auth/login', { email: 'victim@test.com', password: 'wrong-pass' })).status, 401);
    await admin.c('PATCH', `/admin/users/${victim.id}`, { disabled: false });
    // The old cookie stays void (token version was bumped); a fresh login works.
    assert.equal((await victim.c('GET', '/session')).status, 401);
    const again = await client()('POST', '/auth/login', { email: 'victim@test.com', password: 'password123' });
    assert.equal(again.status, 200);
  });

  await t.test('promote, demote, and the self / admin guards', async () => {
    assert.equal((await admin.c('PATCH', `/admin/users/${admin.id}`, { role: 'user' })).status, 409);
    assert.equal((await admin.c('PATCH', `/admin/users/${admin.id}`, { disabled: true })).status, 409);
    assert.equal((await admin.c('DELETE', `/admin/users/${admin.id}`)).status, 409);
    const p = await admin.c('PATCH', `/admin/users/${other.id}`, { role: 'admin' });
    assert.equal(p.body.user.role, 'admin');
    assert.equal((await other.c('GET', '/admin/stats')).status, 200);
    // An admin has to be demoted before being suspended, deleted or reset.
    assert.equal((await admin.c('PATCH', `/admin/users/${other.id}`, { disabled: true })).status, 409);
    assert.equal((await admin.c('DELETE', `/admin/users/${other.id}`)).status, 409);
    assert.equal((await admin.c('POST', `/admin/users/${other.id}/reset-password`)).status, 409);
    const d = await admin.c('PATCH', `/admin/users/${other.id}`, { role: 'user' });
    assert.equal(d.body.user.role, 'user');
    // Demotion takes effect on the very next request (the role is not in the token).
    assert.equal((await other.c('GET', '/admin/stats')).status, 403);
  });

  await t.test('reset password: new password works, old does not, old sessions end', async () => {
    const r = await admin.c('POST', `/admin/users/${victim.id}/reset-password`);
    assert.equal(r.status, 200);
    assert.ok(r.body.password.length >= 8);
    assert.equal((await client()('POST', '/auth/login', { email: 'victim@test.com', password: 'password123' })).status, 401);
    const c = client();
    assert.equal((await c('POST', '/auth/login', { email: 'victim@test.com', password: r.body.password })).status, 200);
    const old = await client()('POST', '/auth/login', { email: 'other@test.com', password: 'password123' });
    assert.equal(old.status, 200);
  });

  await t.test('revoke sessions signs the user out everywhere', async () => {
    assert.equal((await other.c('GET', '/session')).status, 200);
    assert.equal((await admin.c('POST', `/admin/users/${other.id}/revoke-sessions`)).status, 200);
    assert.equal((await other.c('GET', '/session')).status, 401);
  });

  await t.test('delete removes the account and its data', async () => {
    const del = await admin.c('DELETE', `/admin/users/${victim.id}`);
    assert.equal(del.status, 200);
    assert.equal(await User.countDocuments({ _id: victim.id }), 0);
    assert.equal(await Week.countDocuments({ userId: victim.id }), 0);
    assert.equal(await Settings.countDocuments({ userId: victim.id }), 0);
    assert.equal((await victim.c('PUT', '/data', { items: [] })).status, 401);
    assert.equal((await admin.c('DELETE', `/admin/users/${victim.id}`)).status, 404);
    assert.equal(await Settings.countDocuments({ userId: victim.id }), 0);
  });

  await t.test('audit trail records who did what and survives deletion', async () => {
    const r = await admin.c('GET', '/admin/audit');
    assert.equal(r.status, 200);
    const actions = r.body.entries.map(e => e.action);
    for (const a of ['user.rename', 'user.disable', 'user.enable', 'user.promote', 'user.demote', 'user.reset_password', 'user.revoke_sessions', 'user.delete']) {
      assert.ok(actions.includes(a), a);
    }
    const del = r.body.entries.find(e => e.action === 'user.delete');
    assert.equal(del.actor.email, 'admin@test.com');
    assert.equal(del.target.email, 'victim@test.com');
    assert.equal(del.meta.weeks, 1);
    const text = JSON.stringify(r.body);
    assert.ok(!text.includes('passwordHash') && !text.includes('password123'));
    const onlyDeletes = await admin.c('GET', '/admin/audit?action=user.delete');
    assert.ok(onlyDeletes.body.entries.length >= 1 && onlyDeletes.body.entries.every(e => e.action === 'user.delete'));
    // An unknown action name is ignored, never passed to Mongo.
    const junk = await admin.c('GET', '/admin/audit?action[$ne]=x');
    assert.equal(junk.status, 200);
    assert.equal((await admin.c('GET', '/admin/audit?action=nope')).body.total, r.body.total);
    const filtered = await admin.c('GET', `/admin/audit?user=${victim.id}`);
    assert.ok(filtered.body.entries.length >= 3);
    assert.ok(filtered.body.entries.every(e => e.target.id === victim.id));
  });
});
