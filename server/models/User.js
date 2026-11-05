const mongoose = require('mongoose');
const { MAX_USER_NAME, MAX_EMAIL } = require('../limits');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: MAX_USER_NAME },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: MAX_EMAIL },
  passwordHash: { type: String, required: true },
  // An account that predates these fields reads as a plain, active user with version 0.
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  disabled: { type: Boolean, default: false },
  // Written into every token. Bumping it signs the user out of every device (see middleware/auth.js).
  tokenVersion: { type: Number, default: 0 },
  lastLoginAt: { type: Date },
}, { timestamps: true });

userSchema.index({ createdAt: -1 });

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
