# أسبوعي (my-week)

Arabic RTL weekly habit tracker: grid of habits x 7 days (done / missed / empty) plus "start" and "end" notes per habit. Week starts Saturday. Accounts (name, email, password); data is saved per user in MongoDB. The owner writes to you in Arabic: reply in Arabic.

## Commands
- `pnpm install`, `pnpm dev` (http://localhost:3000, needs `.env`), `pnpm test`
- `pnpm test` is plain `node --test`. Do NOT pass `server/`: on Node 22 it runs `server/index.js` as a module and runs zero tests.
- `pnpm db:index` is optional; indexes are built automatically on connect.
- Load test and e2e procedures: `docs/TESTING.md`. Deploy steps and env vars: `README.md`.

## Architecture contracts (read before changing sync, auth or data)
- No build step. Client is one IIFE in `public/app.js`. The Express app is exported from `server/app.js` and used by `server/index.js` (local) and `api/index.js` (Vercel serverless).
- Data is two collections, not one document: `Settings` (habit rows, one per user) and `Week` (one doc per user per week). The client loads only the week on screen plus the previous one (needed for the inherited "start" value) and fetches others on navigation.
- Saves are per-field deltas, debounced 600 ms: the client's `dirty` map tracks `checks|start|end` ids, the server turns them into a flat `$set` (`checks.<id>`). Never "simplify" to sending the whole week or whole state: that loses edits made on another device.
- `server/validate.js` is the only trust boundary; everything from the client is rebuilt there. A new field needs `cleanWeek` + `weekFieldPaths` + `serializers.js` + `limits.js`.
- Size limits live in `server/limits.js`; the client mirrors some (`maxlength`, the 100-row cap in `public/app.js`). Change both.
- Week keys are `YYYY-MM-DD`, Saturdays only, 2020-01-01..2100-12-31 (`isWeekKey`).
- The CSP exists twice and must stay identical: `server/app.js` (helmet, covers `/api`) and `vercel.json` (covers the static page). `style-src` needs `'unsafe-inline'` (the rows use `style=""`). Any new external origin goes in both.
- Auth: 30-day JWT in httpOnly cookie `mw_token`, renewed by `GET /api/session`. `JWT_SECRET` under 32 chars makes the server refuse to load. `POST /api/auth/logout` is registered before the DB middleware on purpose (must work when Mongo is down).
- Passwords: scrypt in `server/password.js` (params stored in each hash). Do not use bcrypt/bcryptjs: it blocks the event loop.
- JWT: `server/middleware/auth.js` passes jsonwebtoken a `KeyObject`, never the raw secret string. With a string it throws while trying to parse a PEM key on every sign/verify (a third of request CPU, measured).
- Serverless: one cached Mongo connection with pool 5 in `server/db.js`. Don't open connections elsewhere.
- Express 5: async handler errors reach the error handler by themselves; `req.body` can be undefined (`app.js` defaults it to `{}`).

## Gotchas
- IMPORTANT: `.env` holds real Atlas credentials. Never read, print or commit it. The Atlas password was pasted in a chat earlier: it must be rotated before deploying.
- Never run `loadtest/seed.js` or load tests against Atlas (the seed refuses non-localhost hosts). E2E/smoke accounts must use `@test.com` or `@loadtest.invalid` emails and be deleted afterwards.
- On Windows git-bash a long heredoc containing Arabic and quotes failed once (`unexpected EOF`): create files with the Write tool instead.
- UI strings and error messages are Arabic. Prefer logical CSS properties (`inset-inline`, `margin-inline`) over left/right.
- k6 `__ITER` is per VU: pick the user with `exec.scenario.iterationInTest`. A burst of hundreds of new connections at the same instant is refused on a saturated Windows process; ramp arrivals (see `docs/TESTING.md`).
- No git commits exist yet; don't commit unless asked.

## Before saying "done"
Run `pnpm test`, then the API smoke and browser e2e checklists in `docs/TESTING.md` for anything touching sync, auth or the client. Unit tests do not cover `public/app.js`.

## More context
- Product requirements: `docs/PRD.md` (Arabic)
- System design, API, sync protocol: `docs/ARCHITECTURE.md`
- Design direction: @.impeccable.md
