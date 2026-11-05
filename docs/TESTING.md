# Testing

Audience: Claude and developers. Run what applies before calling a change done.

## 1. Unit tests (no database)

```
pnpm test
```

Covers `server/validate.js`, `server/password.js`, `server/email.js`, `server/adminStats.js`, and the client logic in `public/js/` (including `public/js/admin/format.js`) (`dates`, `week`, `sync`, plus limits mirrored from the server). `public/js/ui/` has no automated tests: verify it with section 3.

### 1b. Admin API integration (local MongoDB)

`server/admin.test.js` starts the real app on a random port and drives `/api/admin` with cookie jars. It runs only when `MW_TEST_MONGODB_URI` points at a **localhost** MongoDB (it drops that database afterwards, and refuses anything else, never Atlas):

```
mongod --dbpath <empty dir> --port 27018 --bind_ip 127.0.0.1
MW_TEST_MONGODB_URI=mongodb://127.0.0.1:27018/mw-test pnpm test
```

It covers: 401/403 for anonymous and regular users; stats and list (search text is not a regex, junk query values fall back); usage counts without leaking content; rename / email duplicate / invalid input / no-op writes no audit; suspend ends the session at once, blocks login (403), re-enable needs a new login; promote / demote and the self and admin-target guards; reset password; revoke sessions; delete removes weeks and settings; the audit trail survives deletion.

## 2. API smoke (needs a server and a database)

Start `pnpm dev` and drive the API with a script (cookie jar + `fetch`). Cases that must pass:

- No cookie on `/session` and `/data` -> 401.
- Register ok; duplicate email 409; bad email 400; short password 400; wrong password and unknown email give the same 401 message.
- New account: `/session` returns `items: null`, no weeks; API sends `Cache-Control: no-store`.
- Delta save of items + a week, then a second week alone; `/session` returns both; overwriting one field keeps the others.
- Isolation: a second account sees none of the first account's data on `/session` and `/data/weeks`.
- Hostile input: ids with `.`, `$where`, `__proto__` dropped; check values clamped to 0/1/2; bad week key, 21 weeks, duplicate item ids, non-array items, 101 items -> 400; body over 100 KB -> 413; malformed JSON -> 400 (not 500); `{"$ne":null}` as email -> 401.
- Per-week rows: a week with `items` returns `own: true`; an unwritten week follows the nearest earlier week with rows; `POST /data/apply-forward` overwrites later week docs only; bad `items` (duplicates, 101 rows, non-array) 400; `days` outside 1..127 falls back to 127.
- Export, import (replaces everything), re-import of an export round-trips, invalid import 400, `DELETE /data`, logout then `/session` -> 401.

- Admin (see 1b for the automated version): a regular account gets 403 on every `/admin` route; after `pnpm admin:grant` the same account gets 200 and `/session` returns `isAdmin: true`.

Use `@test.com` emails and delete the accounts and their `settings`/`weeks` afterwards (and, for admin tests, their `auditlogs`).

## 3. Browser e2e (Chrome DevTools MCP, one isolated context per "device")

1. Auth form: empty name / bad email / short password messages; wrong login message.
2. Register through the UI; exactly one `/session` request on load; default habit rows appear.
3. Tick boxes and type start/end text (on narrow screens unfold the row's notes first): several edits become ONE `PUT /api/data` of a few hundred bytes; reload keeps everything and the user stays signed in.
4. Week navigation: only missing weeks are fetched; start value is inherited from the previous week's end; two quick clicks move two weeks; "this week" button returns.
5. Edit dialog: add, rename, change period, reorder, delete; persists after reload; "add" is disabled at 100 rows. Day chips: the pill above the chips reads "تحديد الكل" and selects every day; when all are on it reads "إلغاء الكل" and clears all but Saturday (keyboard focus stays on it); the seven chips have 6px gaps and are about 46px wide at 390px. Switching days off fades those cells (grid keeps its shape), the count reads "x / n", the last day cannot be switched off. Per-week rows: editing this week leaves the previous week unchanged; the next week (never written) follows this one; "طبّق على الأسابيع القادمة" makes a later, already-edited week take this week's rows.
6. Reset, export, import (valid file, invalid file message in the in-page sheet).
7. Offline (`emulate` networkConditions Offline): banner appears, the edit stays on screen, logout asks for confirmation, and after going online the banner clears by itself and the edit reached the server.
8. Logout wipes the previous user's rows from the DOM; a second account sees nothing of the first; first account's data returns on login.
9. Two devices, same account (two isolated contexts): each ticks a different box of the same week without knowing about the other; the server keeps both; the stale device shows the other's edits after a `visibilitychange` event.
10. CSP: no `securitypolicyviolation`, Cairo, Aref Ruqaa and Phosphor fonts load.
11. Mobile (390x844): grid, edit dialog, and auth form have no horizontal scroll.
12. Console has no errors other than the expected 401 of the pre-login session check.
14. Admin dashboard (`/admin.html`, signed in as an admin; 390x844 and desktop): a regular account sees the "not authorised" gate and no admin button in settings; the admin sees the button. Overview numbers and the three charts render; users list searches, filters, sorts and pages; the account sheet renames, suspends (confirm dialog first), re-enables, promotes / demotes, resets a password (shown once, copy works) and deletes (confirm dialog). With a second isolated context signed in as the user being suspended: their next save locks the screen with the suspended-account message and their login says the same. The audit tab lists every action, filters by type, and its account links open the sheet. Reload with `#users/<id>` in the address reopens that account; back closes the sheet. Overview "موقوفون" opens the filtered list; tapping a chart bar names its day and value. No horizontal scroll, every control >= 44px, no CSP violation.
13. Share as image (`#shareBtn`, hidden while the notebook has no rows, disabled on a future week): the sheet opens with a preview and the three size chips (تلقائي shows the size it picked); toggling the notes checkbox and the size redraws; "حفظ الصورة" downloads `my-week-<week>.png` (1080 wide); "نسخ" puts a PNG on the clipboard; "مشاركة" appears only where `navigator.canShare({files})` is true and closing the system sheet shows no error. With 30+ rows the picture ends in "+ N بنود أخرى". The user's name appears top-left. No CSP violation (the preview is the canvas itself, never an `<img src=blob:>`). Check the picture on a real phone too: share to a chat app and open it.

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
