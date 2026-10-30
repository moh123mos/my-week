# Testing

Audience: Claude and developers. Run what applies before calling a change done.

## 1. Unit tests (no database)

```
pnpm test
```

Covers `server/validate.js`, `server/password.js`, `server/email.js`. `public/app.js` has no automated tests: verify it with section 3.

## 2. API smoke (needs a server and a database)

Start `pnpm dev` and drive the API with a script (cookie jar + `fetch`). Cases that must pass:

- No cookie on `/session` and `/data` -> 401.
- Register ok; duplicate email 409; bad email 400; short password 400; wrong password and unknown email give the same 401 message.
- New account: `/session` returns `items: null`, no weeks; API sends `Cache-Control: no-store`.
- Delta save of items + a week, then a second week alone; `/session` returns both; overwriting one field keeps the others.
- Isolation: a second account sees none of the first account's data on `/session` and `/data/weeks`.
- Hostile input: ids with `.`, `$where`, `__proto__` dropped; check values clamped to 0/1/2; bad week key, 21 weeks, duplicate item ids, non-array items, 101 items -> 400; body over 100 KB -> 413; malformed JSON -> 400 (not 500); `{"$ne":null}` as email -> 401.
- Export, import (replaces everything), re-import of an export round-trips, invalid import 400, `DELETE /data`, logout then `/session` -> 401.

Use `@test.com` emails and delete the accounts and their `settings`/`weeks` afterwards.

## 3. Browser e2e (Chrome DevTools MCP, one isolated context per "device")

1. Auth form: empty name / bad email / short password messages; wrong login message.
2. Register through the UI; exactly one `/session` request on load; default habit rows appear.
3. Tick boxes and type start/end text (on narrow screens unfold the row's notes first): several edits become ONE `PUT /api/data` of a few hundred bytes; reload keeps everything and the user stays signed in.
4. Week navigation: only missing weeks are fetched; start value is inherited from the previous week's end; two quick clicks move two weeks; "this week" button returns.
5. Edit dialog: add, rename, change period, reorder, delete; persists after reload; "add" is disabled at 100 rows.
6. Reset, export, import (valid file, invalid file message in the in-page sheet).
7. Offline (`emulate` networkConditions Offline): banner appears, the edit stays on screen, logout asks for confirmation, and after going online the banner clears by itself and the edit reached the server.
8. Logout wipes the previous user's rows from the DOM; a second account sees nothing of the first; first account's data returns on login.
9. Two devices, same account (two isolated contexts): each ticks a different box of the same week without knowing about the other; the server keeps both; the stale device shows the other's edits after a `visibilitychange` event.
10. CSP: no `securitypolicyviolation`, Cairo, Aref Ruqaa and Phosphor fonts load.
11. Mobile (390x844): grid, edit dialog, and auth form have no horizontal scroll.
12. Console has no errors other than the expected 401 of the pre-login session check.

## 4. Load test (needs k6 and a LOCAL MongoDB)

```
MONGODB_URI=mongodb://127.0.0.1:27017/mw-load JWT_SECRET=<32+ chars> node loadtest/seed.js 10000
# start the server with the same MONGODB_URI / JWT_SECRET, AUTH_RATE_MAX=100000
k6 run -e BASE=http://localhost:3000 -e VUS=500 loadtest/scenario.js
k6 run -e BASE=http://localhost:3000 loadtest/login.js
```

`seed.js` creates N users with 7 habits and 26 weeks of history each and writes `loadtest/tokens.json` (git-ignored). `scenario.js` makes each iteration a different user: open (`/session`), 4 edits, 3 week loads, a rows edit, reopen and verify persistence. Thresholds: failed requests < 0.1 %, p95 < 800 ms for views and edits.

Never point the seed at Atlas.

### Results (2026-10-30)

Setup: Windows laptop (20 logical cores), local MongoDB 8.2.6 standalone (2 GB cache), ONE Node 22 process in production mode, 10,000 seeded users x 26 weeks (260k week docs). `AUTH_RATE_MAX` raised so the limiter doesn't interfere.

| Run | Result |
| --- | --- |
| 10,000 distinct users, 500 concurrent, no think time (`scenario.js`) | 100,000 requests, **0 failed**, all 120,000 checks passed including "edit persisted for THIS user"; **1,294 req/s** sustained; p95 **425 ms** for views and edits (threshold 800 ms) |
| Same, users arriving at a realistic pace (62 sessions/s, 160 s) | 0 failed, p95 about 6 ms |
| Ramped to 1,000 concurrent connections on one process | 0 failed, p95 1.16 s (the process is saturated at about 950 req/s, requests queue) |
| 1,000 logins, 50 concurrent (`login.js`) | 0 failed, about 67 logins/s (scrypt on the 4-thread libuv pool); while it ran, `/api/session` stayed at median 3.9 ms, i.e. hashing does not block the event loop |

Findings that shaped the code (keep these in mind when touching auth):
- `jsonwebtoken` given a string secret tries to parse it as a PEM key and throws on every sign and verify: 32 % of request CPU. Passing a `KeyObject` (made once in `server/middleware/auth.js`) made sign 36x and verify 60x faster; throughput on one process went from about 90 to about 1,000 req/s.
- A burst of hundreds of brand-new connections in the same instant is refused (`connectex ... actively refused`) by a single saturated Windows process, even with a larger listen backlog. The same load ramped in over a few seconds is served with zero failures. `scenario.js` staggers arrival (`RAMP`) for that reason.
- k6 `__ITER` is per VU. Using it to pick the user made all VUs hit the same ~20 users. Use `exec.scenario.iterationInTest`.

What these numbers do NOT show:
- Atlas. Latency to a remote cluster adds a round trip per query (a request does 1-3), and the free M0 tier is capped at about 100 operations/s and 500 connections. At 1-3 operations per request, M0 sustains roughly 30-60 requests/s, far below the local figure.
- Vercel serverless behaviour: cold starts (module load was seconds under the profiler on this machine), the number of instances and their pools, and the function region relative to the cluster.
- Mixed read/write at the data volume of a year of heavy use, or a cold database cache.

Capacity sketch (assumption, not a measurement): 10,000 active users opening the app about 3 times a day and saving about 10 debounced batches generate around 130,000 requests/day, i.e. roughly 2 requests/s on average and about 20/s at a prayer-time peak. That fits one process locally by a wide margin and fits M0's cap on average, but a sustained peak above about 30-60 requests/s needs a paid Atlas tier.
