// Makes an existing account an admin (or takes it away). This is the only way to create the first admin:
// there is deliberately no public route for it.
//   pnpm admin:grant you@example.com
//   pnpm admin:revoke you@example.com
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const connect = require('../db');
const User = require('../models/User');
const audit = require('../audit');

async function main(command, rawEmail) {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!['grant', 'revoke'].includes(command) || !email) {
    console.error('Usage: node server/scripts/admin.js <grant|revoke> <email>');
    return 1;
  }
  await connect();
  const user = await User.findOne({ email }).select('name email role').lean();
  if (!user) { console.error('No account with that email.'); return 1; }
  const to = command === 'grant' ? 'admin' : 'user';
  if ((user.role || 'user') === to) { console.log(`Already ${to}.`); return 0; }
  if (to === 'user' && await User.countDocuments({ role: 'admin' }) <= 1) {
    console.error('Refusing to remove the last admin.');
    return 1;
  }
  await User.updateOne({ _id: user._id }, { $set: { role: to } });
  // The CLI has no signed-in actor: the record names the account itself and says it came from the command line.
  await audit.record({ id: user._id, email: user.email }, `admin.${command}`, { id: user._id, email: user.email, name: user.name }, { via: 'cli' });
  console.log(`${user.email} is now ${to === 'admin' ? 'an admin' : 'a regular user'}.`);
  return 0;
}

main(process.argv[2], process.argv[3])
  .catch(e => { console.error(e); return 1; })
  .then(async code => { await mongoose.disconnect(); process.exit(code); });
