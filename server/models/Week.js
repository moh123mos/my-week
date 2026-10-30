const mongoose = require('mongoose');

// One doc per user per week, so an edit rewrites ~1KB instead of the whole notebook.
const weekSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  week: { type: String, required: true },
  checks: { type: mongoose.Schema.Types.Mixed, default: {} },
  start: { type: mongoose.Schema.Types.Mixed, default: {} },
  end: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true, minimize: false });

weekSchema.index({ userId: 1, week: 1 }, { unique: true });

module.exports = mongoose.models.Week || mongoose.model('Week', weekSchema);
