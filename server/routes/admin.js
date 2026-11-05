const express = require('express');
const User = require('../models/User');
const Settings = require('../models/Settings');
const Week = require('../models/Week');
const AuditLog = require('../models/AuditLog');
const password = require('../password');
const audit = require('../audit');
const stats = require('../adminStats');
const { requireAuth, requireAdmin, forget } = require('../middleware/auth');
const { isObjectId, escapeRegex, parseUserListQuery, cleanUserPatch, USER_SORTS } = require('../validate');
const { ADMIN_AUDIT_PAGE_SIZE } = require('../limits');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const MAX_MS = 8000;
const LIST_FIELDS = 'name email role disabled createdAt lastLoginAt';
const isSelf = (req, user) => String(user._id) === String(req.admin.id);
const pub = (u, usage) => ({
  id: u._id,
  name: u.name,
  email: u.email,
  role: u.role || 'user',
  disabled: !!u.disabled,
  createdAt: u.createdAt,
  lastLoginAt: u.lastLoginAt || null,
  ...(usage ? { weeks: usage.weeks, habits: usage.habits, lastActive: usage.lastActive } : {}),
});
const fail = (res, status, error) => res.status(status).json({ error });
const who = u => ({ id: u._id, email: u.email, name: u.name });

router.param('id', (req, res, next, id) => {
  if (!isObjectId(id)) return fail(res, 400, 'معرّف غير صالح');
  next();
});

router.get('/stats', async (req, res) => {
  res.json(await stats.dashboard());
});

router.get('/users', async (req, res) => {
  const { text, page, size, sort, filter } = parseUserListQuery(req.query);
  const where = {};
  if (text) {
    const rx = new RegExp(escapeRegex(text), 'i');
    where.$or = [{ name: rx }, { email: rx }];
  }
  if (filter === 'admin') where.role = 'admin';
  else if (filter === 'disabled') where.disabled = true;
  else if (filter === 'active') where.disabled = { $ne: true };
  const [total, users] = await Promise.all([
    User.countDocuments(where).maxTimeMS(MAX_MS),
    User.find(where).sort({ ...USER_SORTS[sort], _id: -1 }).skip((page - 1) * size).limit(size)
      .select(LIST_FIELDS).maxTimeMS(MAX_MS).lean(),
  ]);
  const usage = await stats.usageFor(users.map(u => u._id));
  res.json({ total, page, size, users: users.map(u => pub(u, usage.get(String(u._id)))) });
});

router.get('/users/:id', async (req, res) => {
  const user = await User.findById(req.params.id).select(LIST_FIELDS).lean();
  if (!user) return fail(res, 404, 'المستخدم غير موجود');
  res.json({ user: pub(user), usage: await stats.detailFor(user._id) });
});

// Rename, change email, suspend / reactivate, promote / demote. Each real change leaves an audit record.
router.patch('/users/:id', async (req, res) => {
  const patch = cleanUserPatch(req.body);
  if (!patch) return fail(res, 400, 'بيانات غير صالحة');
  const user = await User.findById(req.params.id).select(LIST_FIELDS).lean();
  if (!user) return fail(res, 404, 'المستخدم غير موجود');
  const self = isSelf(req, user);
  const role = user.role || 'user', disabled = !!user.disabled;
  // Nobody locks themselves out (which could leave no admin), and an admin has to be demoted before being suspended.
  if (self && (patch.disabled === true || patch.role === 'user')) {
    return fail(res, 409, 'لا يمكنك إيقاف حسابك أو خفض صلاحياتك بنفسك');
  }
  if (!self && role === 'admin' && patch.disabled === true) return fail(res, 409, 'اخفض صلاحيات هذا الأدمن أولًا');

  const set = {}, events = [];
  if (patch.name !== undefined && patch.name !== user.name) {
    set.name = patch.name;
    events.push(['user.rename', { from: user.name, to: patch.name }]);
  }
  if (patch.email !== undefined && patch.email !== user.email) {
    set.email = patch.email;
    events.push(['user.email', { from: user.email, to: patch.email }]);
  }
  if (patch.role !== undefined && patch.role !== role) {
    set.role = patch.role;
    events.push([patch.role === 'admin' ? 'user.promote' : 'user.demote']);
  }
  const bump = patch.disabled === true && !disabled;
  if (patch.disabled !== undefined && patch.disabled !== disabled) {
    set.disabled = patch.disabled;
    events.push([patch.disabled ? 'user.disable' : 'user.enable']);
  }
  if (!events.length) return res.json({ user: pub(user) });

  let updated;
  try {
    updated = await User.findByIdAndUpdate(
      user._id,
      // A suspended account's tokens are void even after reactivation: it has to sign in again.
      { $set: set, ...(bump ? { $inc: { tokenVersion: 1 } } : {}) },
      { returnDocument: 'after', runValidators: true },
    ).select(LIST_FIELDS).lean();
  } catch (e) {
    if (e.code === 11000) return fail(res, 409, 'هذا الإيميل مسجّل من قبل');
    throw e;
  }
  forget(user._id);
  stats.resetDashboardMemo();
  for (const [action, meta] of events) await audit.record(req.admin, action, who(updated), meta);
  res.json({ user: pub(updated) });
});

// A new random password, shown once to the admin. All of the user's sessions end.
router.post('/users/:id/reset-password', async (req, res) => {
  const user = await User.findById(req.params.id).select(LIST_FIELDS).lean();
  if (!user) return fail(res, 404, 'المستخدم غير موجود');
  if ((user.role || 'user') === 'admin') return fail(res, 409, 'اخفض صلاحيات هذا الأدمن أولًا');
  const temporary = password.generateTemporary();
  await User.updateOne({ _id: user._id }, {
    $set: { passwordHash: await password.hash(temporary) },
    $inc: { tokenVersion: 1 },
  });
  forget(user._id);
  await audit.record(req.admin, 'user.reset_password', who(user));
  res.json({ password: temporary });
});

router.post('/users/:id/revoke-sessions', async (req, res) => {
  const user = await User.findById(req.params.id).select(LIST_FIELDS).lean();
  if (!user) return fail(res, 404, 'المستخدم غير موجود');
  await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });
  forget(user._id);
  await audit.record(req.admin, 'user.revoke_sessions', who(user));
  res.json({ ok: true });
});

// Removes the account and all of its data. Data first: if this stops midway the account still exists and the
// request can simply be repeated (the reverse order would leave orphaned notebooks nobody can reach).
router.delete('/users/:id', async (req, res) => {
  const user = await User.findById(req.params.id).select(LIST_FIELDS).lean();
  if (!user) return fail(res, 404, 'المستخدم غير موجود');
  if (isSelf(req, user)) return fail(res, 409, 'لا يمكنك حذف حسابك بنفسك');
  if ((user.role || 'user') === 'admin') return fail(res, 409, 'اخفض صلاحيات هذا الأدمن أولًا');
  const [weeks] = await Promise.all([Week.deleteMany({ userId: user._id }), Settings.deleteOne({ userId: user._id })]);
  await User.deleteOne({ _id: user._id });
  forget(user._id);
  stats.resetDashboardMemo();
  await audit.record(req.admin, 'user.delete', who(user), { weeks: weeks.deletedCount });
  res.json({ ok: true });
});

router.get('/audit', async (req, res) => {
  const { page, size } = parseUserListQuery({ page: req.query.page, size: req.query.size || ADMIN_AUDIT_PAGE_SIZE });
  const where = isObjectId(req.query.user) ? { targetId: req.query.user } : {};
  // Only a known action name can reach the filter.
  if (typeof req.query.action === 'string' && audit.ACTIONS.includes(req.query.action)) where.action = req.query.action;
  const [total, entries] = await Promise.all([
    AuditLog.countDocuments(where).maxTimeMS(MAX_MS),
    AuditLog.find(where).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * size).limit(size).maxTimeMS(MAX_MS).lean(),
  ]);
  res.json({
    total, page, size,
    entries: entries.map(e => ({
      id: e._id, action: e.action, at: e.createdAt, meta: e.meta || null,
      actor: { id: e.actorId, email: e.actorEmail },
      target: e.targetId ? { id: e.targetId, email: e.targetEmail, name: e.targetName } : null,
    })),
  });
});

module.exports = router;
