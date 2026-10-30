require('dotenv').config({ quiet: true });
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const connect = require('./db');
const { requireAuth, clear } = require('./middleware/auth');
const { BODY_LIMIT, IMPORT_BODY_LIMIT } = require('./limits');

const app = express();
app.set('trust proxy', 1);
// Keep in sync with the "headers" block in vercel.json: on Vercel the page itself is served from the CDN, not from here.
// style-src needs 'unsafe-inline' for the style="" attributes in the rendered rows.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://unpkg.com', 'data:'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
}));
app.use(cookieParser());
// Restoring a backup needs a big body, but only a signed-in user may make the server parse one (this parser wins).
app.use('/api/data/import', requireAuth, express.json({ limit: IMPORT_BODY_LIMIT }));
app.use(express.json({ limit: BODY_LIMIT }));
app.use((req, res, next) => { req.body ||= {}; next(); });
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Before the database middleware: signing out must work even when Mongo is down.
app.post('/api/auth/logout', (req, res) => { clear(res); res.json({ ok: true }); });

app.use('/api', async (req, res, next) => {
  try { await connect(); next(); } catch (e) { next(e); }
});
app.use('/api/auth', require('./routes/auth'));
app.use('/api/session', require('./routes/session'));
app.use('/api/data', require('./routes/data'));

app.use('/api', (req, res) => res.status(404).json({ error: 'غير موجود' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'الحجم كبير جدًا' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'طلب غير صالح' });
  console.error(err);
  res.status(500).json({ error: 'خطأ في الخادم' });
});

module.exports = app;
