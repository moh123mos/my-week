const mongoose = require('mongoose');

// One small doc per user: the list of habit rows.
const settingsSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  items: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true, minimize: false });

module.exports = mongoose.models.Settings || mongoose.model('Settings', settingsSchema);
