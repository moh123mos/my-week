const mongoose = require('mongoose');

// Cached across invocations so serverless doesn't open a new connection per request.
const cached = global._mongoose || (global._mongoose = { conn: null, promise: null });

async function connect() {
  if (cached.conn) return cached.conn;
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  cached.promise ||= mongoose.connect(process.env.MONGODB_URI, {
    bufferCommands: false,
    serverSelectionTimeoutMS: 8000,
    // Many serverless instances x the default pool of 100 would exhaust Atlas' connection limit.
    maxPoolSize: Number(process.env.DB_POOL) || 5,
    maxIdleTimeMS: 60000,
    // 'poll' = one heartbeat per check instead of a persistent streaming monitor connection per server,
    // which would otherwise cost every serverless instance an extra connection.
    serverMonitoringMode: 'poll',
    // createIndex is idempotent; building them in the background means a skipped manual step can never
    // leave the unique email index missing (duplicate accounts).
    autoIndex: true,
  });
  try { cached.conn = await cached.promise; }
  catch (e) { cached.promise = null; throw e; }
  return cached.conn;
}

module.exports = connect;
