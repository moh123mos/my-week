// Fills a TEST database with N users (+ rows + WEEKS weeks of history each) and writes their session tokens.
//   MONGODB_URI=mongodb://127.0.0.1:27555/mw-load JWT_SECRET=... node loadtest/seed.js 10000
// Refuses to run against any host other than localhost unless ALLOW_REMOTE=1, so it can't pollute a real database by accident.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../server/models/User');
const Settings = require('../server/models/Settings');
const Week = require('../server/models/Week');
const password = require('../server/password');

const N = Number(process.argv[2]) || 10000;
const WEEKS = Number(process.env.WEEKS) || 26;
const uri = process.env.MONGODB_URI;
// Every host in the URI must be local; a missing or unparsable URI is refused too.
const hosts = ((uri || '').match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]*)/) || [, ''])[1]
  .split(',').map(h => h.replace(/:\d*$/, '').replace(/^\[|\]$/g, '').toLowerCase());
const isLocal = hosts.every(h => h === 'localhost' || h === '127.0.0.1' || h === '::1');
if (!isLocal && !process.env.ALLOW_REMOTE) { console.error('Refusing to seed a non-local DB (set ALLOW_REMOTE=1 to override).'); process.exit(1); }

const PERIODS = ['sobh', 'dhuhr', 'asr', 'maghrib', 'isha'];
const items = Array.from({ length: 7 }, (_, i) => ({ id: 'it' + i, name: 'بند ' + i, period: PERIODS[i % 5], track: i % 2 === 0 }));
const pad = x => String(x).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayIdx = d => (d.getDay() + 1) % 7;
function weekKeys(n) {
  const t = new Date(); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() - dayIdx(t));
  return Array.from({ length: n }, (_, i) => { const d = new Date(t); d.setDate(d.getDate() - 7 * i); return keyOf(d); });
}
const mkWeek = () => ({
  checks: Object.fromEntries(items.map(it => [it.id, Array.from({ length: 7 }, () => Math.floor(Math.random() * 3))])),
  start: Object.fromEntries(items.filter(i => i.track).map(i => [i.id, 'بداية'])),
  end: Object.fromEntries(items.filter(i => i.track).map(i => [i.id, 'نهاية'])),
});

(async () => {
  await mongoose.connect(uri);
  await Promise.all([User, Settings, Week].map(M => M.createIndexes()));
  await Promise.all([User.deleteMany({ email: /@loadtest\.invalid$/ })]);
  const hash = await password.hash('password123');
  const keys = weekKeys(WEEKS);
  const ids = Array.from({ length: N }, () => new mongoose.Types.ObjectId());
  const B = 1000;
  for (let s = 0; s < N; s += B) {
    const part = ids.slice(s, s + B);
    await User.insertMany(part.map((_id, j) => ({ _id, name: 'مستخدم ' + (s + j), email: `lt${s + j}@loadtest.invalid`, passwordHash: hash })), { ordered: false });
    await Settings.insertMany(part.map(userId => ({ userId, items })), { ordered: false });
    await Week.insertMany(part.flatMap(userId => keys.map(week => ({ userId, week, ...mkWeek() }))), { ordered: false });
    process.stdout.write(`\rseeded ${Math.min(s + B, N)}/${N}`);
  }
  const tokens = ids.map(id => jwt.sign({ sub: String(id) }, process.env.JWT_SECRET, { expiresIn: '1d' }));
  fs.writeFileSync(path.join(__dirname, 'tokens.json'), JSON.stringify({ tokens, weeks: keys }));
  console.log(`\n${N} users, ${N * WEEKS} week docs, tokens.json written`);
  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
