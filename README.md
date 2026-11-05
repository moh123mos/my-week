# أسبوعي (my-week)

دفتر عادات أسبوعي بالعربية (RTL): شبكة بنود × أيام الأسبوع (أنجزت / فاتني / فارغة)، مع حقلي «بداية الأسبوع» و«نهاية الأسبوع» لكل بند، وإحصائيات الأسبوع. الأسبوع يبدأ يوم السبت. لكل مستخدم حساب وتُحفظ بياناته على الخادم تلقائيًا.

Weekly habit tracker. Vanilla JS client (`public/`), Node + Express 5 + Mongoose 9 API (`server/`), deployed on Vercel as one serverless function (`api/index.js`).

## Project layout

```
public/            index.html, style.css, js/ (ES modules, no build step; entry js/main.js)
test/client/       client unit tests (run by pnpm test)
api/index.js       Vercel entry: exports the Express app
server/app.js      Express app: security headers/CSP, body parsers, routes
server/index.js    local server (app + static files)
server/db.js       cached Mongo connection (serverless friendly)
server/routes/     auth (register/login), session (one-request page load), data (save/load/export/import), admin (dashboard API)
server/models/     User, Settings (the habit rows), Week (one doc per user per week), AuditLog (admin trail)
server/validate.js input cleaning, week key checks   server/limits.js  all size limits
server/password.js scrypt hashing (+ rehash)         server/email.js   email check
server/scripts/    indexes.js (optional manual index build), admin.js (grant / revoke the admin role)
public/admin.html  admin dashboard (modules in public/js/admin/)
loadtest/          k6 scripts + seed.js
```

## Environment variables

| Name | Required | Notes |
| --- | --- | --- |
| `MONGODB_URI` | yes | MongoDB / Atlas connection string |
| `JWT_SECRET` | yes | random string, **at least 32 characters** (the server refuses to start otherwise) |
| `SESSION_DAYS` | no | login lifetime in days, default 30 |
| `AUTH_RATE_MAX` | no | failed logins / registrations per IP per 15 min, default 30 |
| `AUTH_CACHE_MS` | no | how long a process remembers that an account is active and not suspended, default 5000. Suspending is instant on the instance that did it and reaches others within this time; 0 checks the database on every request |
| `DB_POOL` | no | Mongo `maxPoolSize` per instance, default 5 |
| `UV_THREADPOOL_SIZE` | no | tip for self-hosting under many logins: scrypt runs on libuv's thread pool (default 4), raise it (e.g. 8) on a multi-core host |

Copy `.env.example` to `.env` for local runs. Never commit `.env`.

## Run locally

```
pnpm install
pnpm dev            # http://localhost:3000, restarts on change
pnpm start
```

Requires Node >= 20.19.

### Admin dashboard

Sign up normally, then make that account an admin from the terminal (it uses `MONGODB_URI` from `.env`):

```
pnpm admin:grant you@example.com
pnpm admin:revoke you@example.com   # refuses to remove the last admin
```

An admin sees an admin-dashboard button in the settings dialog, which opens `/admin.html`: overview numbers and charts, the users list (search, suspend, rename, promote, reset password, end sessions, delete) and the audit trail. Indexes (unique email, unique user+week) are created automatically on connect; `pnpm db:index` builds them up front if you want to see an index error immediately.

## Tests

```
pnpm test           # node --test: validation, password hashing, email check, admin helpers. No database needed.
# The admin API integration test needs a LOCAL MongoDB and is skipped otherwise (refuses non-localhost):
MW_TEST_MONGODB_URI=mongodb://127.0.0.1:27018/mw-test pnpm test
```

## Deploy on Vercel

1. Import the repo; no build command is needed (`public/` is served statically, `/api/*` is rewritten to `api/index.js` by `vercel.json`).
2. Set `MONGODB_URI`, `JWT_SECRET` (>= 32 chars) and optionally the other variables above in Project Settings > Environment Variables.
3. MongoDB Atlas > Network Access: allow `0.0.0.0/0` (Vercel functions have no fixed IPs). The database user's password is then the only barrier, so use a strong one and a user limited to this database.
4. TODO (owner): set the Vercel function region next to the Atlas cluster region (Project Settings > Functions > Function Region). Every request makes several round trips to Mongo, so a cross-continent gap is the biggest latency cost. The region was not chosen here because it depends on where the cluster lives.
5. `vercel.json` also sends the Content-Security-Policy header for the static page; keep it in sync with the policy in `server/app.js`.

## Load testing

Needs [k6](https://k6.io) and a **local** test database (`seed.js` refuses any non-localhost URI unless `ALLOW_REMOTE=1`).

```
MONGODB_URI=mongodb://127.0.0.1:27017/mw-load JWT_SECRET=<32+ chars> node loadtest/seed.js 10000
k6 run -e BASE=http://localhost:3000 -e VUS=500 loadtest/scenario.js     # app usage, one user per iteration
k6 run -e BASE=http://localhost:3000 loadtest/login.js                    # password hashing (CPU heavy path)
```

`seed.js` writes `loadtest/tokens.json` (git-ignored). Start the server with the same `MONGODB_URI` and `JWT_SECRET`, plus `NODE_ENV=production` and a large `AUTH_RATE_MAX` so the limiter doesn't interfere. Results of the 10,000-user run and what they do not cover: `docs/TESTING.md`.

## Known limits

- **Rate limiting is per instance, in memory.** On Vercel every instance has its own counters, so the limiter only slows a single-instance attacker. For real protection use Vercel WAF rate limiting or a shared store such as Upstash.
- **No email verification and no password reset yet.** A forgotten password means a lost account.
- **No token revocation.** Logout clears the cookie, but the 30-day JWT itself stays valid until it expires if someone copied it.
- **Atlas M0 (free) caps:** about 500 connections, about 100 operations per second and 512 MB of storage. With many serverless instances the connection cap is the first limit to hit (hence `DB_POOL` defaults to 5).
- **Password hashing cost:** scrypt `N=16384, r=8, p=1`, chosen to keep login fast on small serverless CPUs. It is below current OWASP guidance (`N=2^17`). The parameters are stored in each hash, so they can be raised later and users are upgraded on their next login.
- **Concurrent edits:** last write wins per field (one checkbox, one text box), not per week. Two devices changing the same box at the same time keep whichever saved last. The list of habit rows is still saved as a whole, so the last device to edit the rows wins. Other devices see changes when they return to the tab (at most every 30 seconds) or reload.
- **Limits:** 100 habit rows, 100 characters per name, 300 per start/end text, weeks between 2020-01-01 and 2100-12-31 (Saturdays only), 20 weeks per save.
- **Per-field writes are not pruned.** A week document only ever gains fields (ids are checked for shape and count per request, not against the habit list), so a signed-in user who deliberately sends endless new ids can grow their own week documents. Deleting a habit keeps its old data on purpose.
