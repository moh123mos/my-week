// The admin trail. Failing to write a record must never undo or block what the admin just did, so it only logs.
const AuditLog = require('./models/AuditLog');

const ACTIONS = [
  'user.rename', 'user.email', 'user.disable', 'user.enable', 'user.promote', 'user.demote',
  'user.reset_password', 'user.revoke_sessions', 'user.delete', 'admin.grant', 'admin.revoke',
];

// actor / target: { id, email, name } (a User document or its lean form also works).
async function record(actor, action, target, meta) {
  try {
    await AuditLog.create({
      actorId: actor.id || actor._id,
      actorEmail: actor.email || '',
      action,
      targetId: target ? target.id || target._id : undefined,
      targetEmail: target ? target.email || '' : '',
      targetName: target ? target.name || '' : '',
      meta,
    });
  } catch (e) {
    console.error('audit failed', action, e);
  }
}

module.exports = { record, ACTIONS };
