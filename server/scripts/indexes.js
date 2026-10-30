// Optional: indexes are also built automatically (autoIndex) when the server connects.
// Run this to build them up front or to see an index error right away: pnpm db:index
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const connect = require('../db');

(async () => {
  await connect();
  for (const name of ['User', 'Settings', 'Week']) {
    const M = require(`../models/${name}`);
    await M.createIndexes();
    console.log(name, 'indexes ok');
  }
  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
