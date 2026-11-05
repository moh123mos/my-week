const mongoose = require('mongoose');

// What an admin did to whom. The actor's and the target's name/email are copied in, so the record still reads
// correctly after either account is renamed or deleted. Never holds passwords or habit content.
const auditSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true },
  actorEmail: { type: String, default: '' },
  action: { type: String, required: true },
  targetId: { type: mongoose.Schema.Types.ObjectId },
  targetEmail: { type: String, default: '' },
  targetName: { type: String, default: '' },
  // Small facts about the change, e.g. { field: 'role', from: 'user', to: 'admin' }.
  meta: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: { createdAt: true, updatedAt: false } });

auditSchema.index({ createdAt: -1 });
auditSchema.index({ targetId: 1, createdAt: -1 });

module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', auditSchema);
