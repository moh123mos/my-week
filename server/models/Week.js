const mongoose = require('mongoose');

// One doc per user per week, so an edit rewrites ~1KB instead of the whole notebook.
const weekSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  week: { type: String, required: true },
  checks: { type: mongoose.Schema.Types.Mixed, default: {} },
  start: { type: mongoose.Schema.Types.Mixed, default: {} },
  end: { type: mongoose.Schema.Types.Mixed, default: {} },
  // This week's own habit rows. A doc without it predates per-week rows and reads Settings.items.
  items: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true, minimize: false });

weekSchema.index({ userId: 1, week: 1 }, { unique: true });
// The admin dashboard looks at recent weeks across all users. `week` never changes after the insert, so unlike an
// index on updatedAt this one costs nothing on the hot save path.
weekSchema.index({ week: 1 });

module.exports = mongoose.models.Week || mongoose.model('Week', weekSchema);
