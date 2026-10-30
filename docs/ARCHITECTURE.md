# Architecture

Audience: Claude and developers changing the code. Product intent lives in `PRD.md`.

## Shape

```
Browser (public/: index.html, style.css, app.js)
   |  fetch /api/*  (same origin, httpOnly cookie)
   v
Vercel: static files from the CDN  +  one serverless function (api/index.js -> server/app.js)
   |  mongoose, pool 5, cached connection
   v
MongoDB Atlas   collections: users, settings, weeks
```

Locally `server/index.js` serves both the API and `public/`.

## Data model

| Collection | Doc | Key points |
| --- | --- | --- |
| `users` | `name`, `email` (unique, lowercase), `passwordHash` | hash format `scrypt$N$r$p$salt$key` |
| `settings` | `userId` (unique), `items: [{id, name, period, track}]` | the habit rows; `period` is one of sobh, dhuhr, asr, maghrib, isha |
| `weeks` | `userId`, `week` (`YYYY-MM-DD`, a Saturday), `checks`, `start`, `end` | unique index `{userId, week}`. `checks: {itemId: [7 x 0|1|2]}` (0 empty, 1 done, 2 missed); `start`/`end`: `{itemId: text}` |

`checks`, `start`, `end`, `items` are `Mixed` in Mongoose: shape rules live only in `server/validate.js`. Item ids match `[A-Za-z0-9_-]{1,40}` (they become Mongo field names, so no dots or `$`; `__proto__` is rejected). Deleting a habit keeps its old week data on purpose.

"Start" of a week defaults to the previous week's "end" for the same item (computed on the client, shown with the `inh` class).

## API

All under `/api`, JSON, `Cache-Control: no-store`. All except register/login/logout need the `mw_token` cookie.

| Method and path | Purpose |
| --- | --- |
| `POST /auth/register` `{name,email,password}` | create account, sets cookie |
| `POST /auth/login` `{email,password}` | sets cookie; same error for unknown email and wrong password |
| `POST /auth/logout` | clears cookie; works without the DB |
| `GET /session?weeks=a,b` | page load in one request: `{user, items|null, weeks}`; renews the cookie. `items: null` means a brand-new account |
| `GET /data/weeks?keys=a,b` | weeks the user navigated to (max 4 keys) |
| `PUT /data` `{items?, weeks?}` | delta save; `weeks` is `{key: {checks?, start?, end?}}` with only changed fields, max 20 weeks |
| `GET /data/export` | full backup `{v:1, items, weeks}` |
| `PUT /data/import` `{state}` | replace everything (backup restore or first-login upload of old localStorage data); 4 MB body limit, auth required before parsing |
| `DELETE /data` | wipe the user's data |

## Client sync protocol (public/app.js)

State: `state = {items, weeks}` is a cache; `loaded` is the set of week keys fetched; `dirty` maps week -> field sets still to send; `dirtyItems` flags the rows list.

- **Load:** `start()` -> `loadSession()` calls `/session?weeks=<this week>,<previous>`. New account: defaults are created and saved; if old localStorage data exists the user is asked once per device (`my-week:legacy-offered`) whether to upload it.
- **Edit:** a click or keystroke updates `state` in place (no re-render), calls `markDirty`, and `schedulePush` (600 ms debounce). `push()` builds the delta with `weeksDelta`, sends rows and weeks as separate requests (chunks of 20 weeks), and shows "تم الحفظ".
- **Failure:** network, 5xx, 408, 429 -> `remerge` the delta (current values, not the stale body) and retry in 5 s with a banner. Other 4xx -> drop the delta and show a "limits" banner (retrying would block every later save). 401 -> `showAuth`.
- **Page hide:** `push(true)` uses `keepalive` and ignores the single-flight rule; per-field writes make ordering safe, except that overlapping requests are re-marked dirty and re-sent.
- **Return to tab:** `resync()` (at most every 30 s) refetches the displayed weeks, merges only fields that are not dirty, replaces `items` only if not dirty and the edit dialog is closed, drops other loaded weeks, and re-renders only if something changed.
- **Navigation:** `goTo(key)` loads the week and its previous one (`loadWeeks` dedupes through `pendingLoads`), `target` makes a quick double click move two weeks, `navSeq` discards superseded navigations.
- **Account switch:** every async path captures `epoch`; `showAuth` bumps it and wipes the DOM, so a stale response can never touch the next user's state.
- **Logout/import/reset:** `flush()` / `quiesce()` first. Logout asks for confirmation if edits are still unsaved, and does not lock the screen if the server could not clear the session.

## Server notes

- Middleware order in `server/app.js`: helmet(CSP) -> cookieParser -> import route (`requireAuth` then 4 MB json) -> 100 KB json -> `req.body ||= {}` -> no-store -> `POST /auth/logout` -> DB connect -> routers -> 404 -> error handler (413 and 400 mapped, rest 500).
- Writes use `bulkWrite` with upserts. `/import` writes new weeks, then settings, then deletes leftover weeks, so a failure midway never leaves the user with nothing.
- Per-field writes are never pruned; see "Known limits" in `README.md`.

## Why it looks like this (so nobody undoes it)

- Per-week documents + lazy loading: a year of history is ~52 docs per user; page load reads 2, a save writes ~200 bytes.
- Per-field `$set`: two devices editing different boxes of the same week both survive.
- scrypt on the libuv pool, not bcryptjs: no event-loop blocking during login bursts.
- One `/session` request: fewer round trips to a possibly distant database.
- Pool 5 + `serverMonitoringMode: 'poll'`: many serverless instances must not exhaust Atlas' connection cap.
