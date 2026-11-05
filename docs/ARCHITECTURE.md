# Architecture

Audience: Claude and developers changing the code. Product intent lives in `PRD.md`.

## Shape

```
Browser (public/: index.html, style.css, js/)
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
| `users` | `name`, `email` (unique, lowercase), `passwordHash`, `role` (`user`\|`admin`), `disabled`, `tokenVersion`, `lastLoginAt` | hash format `scrypt$N$r$p$salt$key`. The last four are absent on older accounts and read as user / active / 0 / never. Index `{createdAt:-1}` |
| `settings` | `userId` (unique), `items: [{id, name, period, track, days}]` | the notebook's starting rows (new accounts, and weeks written before per-week rows). `period` is one of sobh, dhuhr, asr, maghrib, isha; `days` is a bitmask of tracked days (bit 0 = Saturday .. bit 6 = Friday, 1..127, default 127) |
| `weeks` | `userId`, `week` (`YYYY-MM-DD`, a Saturday), `checks`, `start`, `end` | unique index `{userId, week}`. `checks: {itemId: [7 x 0|1|2]}` (0 empty, 1 done, 2 missed); `start`/`end`: `{itemId: text}`; optional `items`: the week's own rows (same shape as `settings.items`) |

| `auditlogs` | `actorId`, `actorEmail`, `action`, `targetId`, `targetEmail`, `targetName`, `meta`, `createdAt` | what an admin did to whom. Emails and names are copied in so a record stays readable after the account is renamed or deleted. Never holds passwords or habit content. Indexes `{createdAt:-1}`, `{targetId, createdAt:-1}` |

`weeks` also has an index `{week:1}` for the admin dashboard (a week key never changes after insert, so it costs nothing on saves).

`checks`, `start`, `end`, `items` are `Mixed` in Mongoose: shape rules live only in `server/validate.js`. Item ids match `[A-Za-z0-9_-]{1,40}` (they become Mongo field names, so no dots or `$`; `__proto__` is rejected). Deleting a habit keeps its old week data on purpose.

**Rows per week.** Each week shows its own rows, resolved on the server (`server/weeks.js`): the week doc's `items` if present (`own: true`); a doc without `items` (written before this feature) reads `settings.items`; a week with no doc follows the nearest earlier week that has `items`, else `settings.items`. The client fixes a week's rows as its own the first time anything is written to it (`adoptRows` in sync.js), so editing an earlier week never changes a week that has data. Editing rows in the dialog changes only the week on screen; `POST /data/apply-forward` copies those rows to every later week doc (their boxes and notes are untouched). `settings.items` is no longer updated by item edits.

**Tracked days.** A day a habit isn't tracked on is drawn faded and can't be pressed; the grid keeps its shape. Counts, percentages and the seven moons use only tracked days (`dayOn`, `activeDays`, `doneIn` in week.js). Boxes already ticked on a day later switched off stay stored but count for nothing.

**Share as image (client only).** `share.js` (no DOM, tested) builds a model of the week on screen and computes the layout; `ui/shareCanvas.js` paints it on a 1080-wide canvas (no library, so the CSP is untouched and the preview is the canvas itself, never an `<img src=blob:>`); `ui/share.js` owns the button, the sheet and share / save / copy. Sizes: portrait 1350, story 1920, and "auto" (portrait while every row stays at least `SHARE.AUTO_MIN_ROW` tall, else story). Rows that don't fit collapse into "+ N". The picture is rendered and encoded when the sheet opens or an option changes, not on the click, because Safari rejects `navigator.share` once the click's user activation has lapsed. Canvas colours are copied from the `:root` tokens into `SHARE.COLORS` (a canvas can't read `var()`): change both together. Preferences (size, notes) live in `localStorage` only.

"Start" of a week defaults to the previous week's "end" for the same item (computed on the client, shown with the `inh` class).

## API

All under `/api`, JSON, `Cache-Control: no-store`. All except register/login/logout need the `mw_token` cookie.

| Method and path | Purpose |
| --- | --- |
| `POST /auth/register` `{name,email,password}` | create account, sets cookie |
| `POST /auth/login` `{email,password}` | sets cookie; same error for unknown email and wrong password |
| `POST /auth/logout` | clears cookie; works without the DB |
| `GET /session?weeks=a,b` | page load in one request: `{user, items|null, weeks}`; renews the cookie. `items: null` means a brand-new account. Every requested week comes back as `{checks, start, end, items, own}` |
| `GET /data/weeks?keys=a,b` | weeks the user navigated to (max 4 keys) |
| `PUT /data` `{items?, weeks?}` | delta save; `items` sets the starting rows; `weeks` is `{key: {checks?, start?, end?, items?}}` with only changed fields (`items` replaces that week's rows), max 20 weeks |
| `POST /data/apply-forward` `{week, items}` | sets `items` on that week and on every later week doc |
| `GET /data/export` | full backup `{v:1, items, weeks}` |
| `PUT /data/import` `{state}` | replace everything (backup restore or first-login upload of old localStorage data); 4 MB body limit, auth required before parsing |
| `DELETE /data` | wipe the user's data |

## Admin dashboard

Page `public/admin.html` (modules in `public/js/admin/`, styles in `admin.css`) talks to `/api/admin`, implemented in `server/routes/admin.js`. The page is only an interface: every route runs `requireAuth` then `requireAdmin`, which re-reads the role from the database on each request (never from the token, never cached), so demoting takes effect on the next request. There is no public way to become an admin: `pnpm admin:grant <email>` (`server/scripts/admin.js`) is the only way to create the first one; it refuses to remove the last admin.

| Method and path | Purpose |
| --- | --- |
| `GET /admin/stats` | `{overview, activity[30 days], completion[6 weeks]}`, remembered 30 s per process |
| `GET /admin/users?q&page&size&sort&filter` | page of accounts with weeks written, habit count and last activity. `q` is escaped text, `sort` and `filter` pick from fixed lists |
| `GET /admin/users/:id` | one account plus its last 6 weeks of completion (counts only) |
| `PATCH /admin/users/:id` | any of `name`, `email`, `disabled`, `role`; each real change writes an audit record, a no-op writes none |
| `POST /admin/users/:id/reset-password` | random 12-character password, returned once; ends every session of that user |
| `POST /admin/users/:id/revoke-sessions` | ends every session of that user |
| `DELETE /admin/users/:id` | deletes weeks and settings first, then the account |
| `GET /admin/audit?page&user&action` | the audit trail, newest first; `user` filters by target account, `action` by one known action name (anything else is ignored) |

**Page behaviour** (`public/js/admin/`). The place is in the URL hash (`route.js`, pure and tested): `#overview`, `#users`, `#users?filter=disabled|admin|active`, `#users/<id>` (account sheet open), `#audit`, so refresh, back/forward and pasted links land where the admin was. Overview numbers link to the filtered list. Chart bars are read by touch, mouse or arrow keys (a `title` tooltip never shows on a phone). The account sheet puts status and security actions first and keeps usage, edit form, the account's own audit history (loaded when opened) and delete in collapsible sections. Any 401/403 from an admin call shows the gate instead of a half-working page.

Guards: an admin cannot suspend, demote or delete themselves; an admin has to be demoted before being suspended, deleted or password-reset. The admin sees counts and timestamps only, never habit names or notes.

**Sessions and suspension.** Every token carries `tv` (the user's `tokenVersion`). `requireAuth` (server/middleware/auth.js) loads `{disabled, tokenVersion}` for the token's user and rejects the request (401, code `disabled` when suspended) if the account is gone, suspended or the version differs. Tokens from before this existed have no `tv` and count as 0. Suspending, resetting a password and "end all sessions" bump `tokenVersion`; deleting removes the account. The lookup is remembered per process for `AUTH_CACHE_MS` (default 5000, 0 = off): the instance that performed the admin action forgets the entry at once, other serverless instances catch up within that time. Login of a suspended account answers 403 only after the password was right.

**Usage numbers** (`server/adminStats.js`). "Active" = a week doc last written in the period; a doc keeps only its latest write time, so earlier days of the daily chart can under-count. Only the last ~5 weeks of week docs are scanned (the `{week:1}` index). Completion = ticked / (ticked + missed) boxes, counted inside Mongo.

## Client sync protocol (public/js/sync.js)

State: `state = {weeks}` is a cache and each loaded week carries `items` and `own`; `loaded` is the set of week keys fetched; `dirty` maps week -> field sets still to send; `itemWeeks` are the weeks whose rows changed; `baseItems` are the starting rows of a new notebook.

- **Load:** `start()` -> `loadSession()` calls `/session?weeks=<this week>,<previous>`. New account: defaults are created and saved; if old localStorage data exists the user is asked once per device (`my-week:legacy-offered`) whether to upload it.
- **Edit:** a click or keystroke updates `state` in place (no re-render), calls `markDirty`, and `schedulePush` (600 ms debounce). `push()` builds the delta with `weeksDelta`, sends rows and weeks as separate requests (chunks of 20 weeks), and shows "تم الحفظ".
- **Failure:** network, 5xx, 408, 429 -> `remerge` the delta (current values, not the stale body) and retry in 5 s with a banner. Other 4xx -> drop the delta and show a "limits" banner (retrying would block every later save). 401 -> `showAuth`.
- **Page hide:** `push(true)` uses `keepalive` and ignores the single-flight rule; per-field writes make ordering safe, except that overlapping requests are re-marked dirty and re-sent.
- **Return to tab:** `resync()` (at most every 30 s) refetches the displayed weeks, merges only fields that are not dirty, keeps the shown week's rows while they are dirty or the edit dialog is open, drops other loaded weeks, and re-renders only if something changed.
- **Navigation:** `goTo(key)` loads the week and its previous one (`loadWeeks` dedupes through `pendingLoads`; see `ui/nav.js`), `target` makes a quick double click move two weeks, `navSeq` discards superseded navigations.
- **Account switch:** every async path captures `epoch`; `showAuth` bumps it and wipes the DOM, so a stale response can never touch the next user's state.
- **Logout/import/reset:** logout calls `flush()`; import and reset run inside `whilePaused()` (no saves) with the edit dialog frozen. Logout asks for confirmation if edits are still unsaved, and does not lock the screen if the server could not clear the session.

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
