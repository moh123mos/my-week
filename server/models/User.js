const mongoose = require('mongoose');
const { MAX_USER_NAME, MAX_EMAIL } = require('../limits');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: MAX_USER_NAME },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: MAX_EMAIL },
  passwordHash: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
