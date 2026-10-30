// k6 run -e BASE=http://localhost:3000 -e USERS=10000 -e VUS=500 loadtest/scenario.js
// Each iteration is a DIFFERENT user: open the app -> tick boxes -> browse weeks -> edit text -> reopen and verify.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Trend } from 'k6/metrics';
import exec from 'k6/execution';

const data = new SharedArray('t', () => [JSON.parse(open('./tokens.json'))]);
const { tokens, weeks } = data[0];
const BASE = __ENV.BASE || 'http://localhost:3000';
const USERS = Number(__ENV.USERS) || tokens.length;
const THINK = Number(__ENV.THINK) || 0; // seconds between actions, 0 = pure stress
const RAMP = Number(__ENV.RAMP) || 15;   // users arrive over this many seconds, as they do in real life

export const options = {
  scenarios: {
    users: { executor: 'shared-iterations', vus: Number(__ENV.VUS) || 500, iterations: USERS, maxDuration: '30m' },
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    'http_req_duration{kind:view}': ['p(95)<800'],
    'http_req_duration{kind:edit}': ['p(95)<800'],
  },
};

const open_ = new Trend('open_app_ms', true);
const edit_ = new Trend('edit_ms', true);

export default function () {
  // Real users don't all connect in the same millisecond: an instant burst of hundreds of new connections is
  // refused by a single saturated Windows process even though sustained load of the same size is served fine.
  if (exec.vu.iterationInScenario === 0) sleep(Math.random() * RAMP);
  // __ITER counts per VU, so every VU would start at user 0 and only ~USERS/VUS users would be exercised.
  const idx = exec.scenario.iterationInTest % tokens.length;
  const H = { headers: { Cookie: `mw_token=${tokens[idx]}`, 'Content-Type': 'application/json' } };
  const cur = weeks[0], prev = weeks[1];

  // 1. open the app: one request returns user + rows + current & previous week
  let r = http.get(`${BASE}/api/session?weeks=${cur},${prev}`, { ...H, tags: { kind: 'view' } });
  // A failed request must be counted, not crash the iteration (r.json() on an empty body throws).
  const opened = check(r, { 'session 200': x => x.status === 200 });
  if (!opened) return;
  open_.add(r.timings.duration);
  check(r, { 'has items': x => (x.json('items') || []).length === 7 });
  sleep(THINK);

  // 2. tick a few boxes (what the UI sends: only the changed week)
  const checks = {}; for (let i = 0; i < 7; i++) checks['it' + i] = [1, 0, 2, 1, 0, 0, 1];
  for (let n = 0; n < 4; n++) {
    r = http.put(`${BASE}/api/data`, JSON.stringify({ weeks: { [cur]: { checks, start: { it0: 'a' + n }, end: { it0: 'z' + n } } } }), { ...H, tags: { kind: 'edit' } });
    edit_.add(r.timings.duration);
    check(r, { 'edit 200': x => x.status === 200 });
    sleep(THINK);
  }

  // 3. browse older weeks (lazy load)
  for (const w of [weeks[2], weeks[5], weeks[12]]) {
    r = http.get(`${BASE}/api/data/weeks?keys=${w},${weeks[Math.min(weeks.indexOf(w) + 1, weeks.length - 1)]}`, { ...H, tags: { kind: 'view' } });
    check(r, { 'weeks 200': x => x.status === 200 });
    sleep(THINK);
  }

  // 4. edit the row list
  const items = Array.from({ length: 7 }, (_, i) => ({ id: 'it' + i, name: 'معدّل ' + i, period: 'sobh', track: true }));
  r = http.put(`${BASE}/api/data`, JSON.stringify({ items }), { ...H, tags: { kind: 'edit' } });
  check(r, { 'items 200': x => x.status === 200 });

  // 5. reopen: the edit must have persisted for THIS user
  r = http.get(`${BASE}/api/session?weeks=${cur},${prev}`, { ...H, tags: { kind: 'view' } });
  check(r, {
    'persisted edit': x => x.json(`weeks.${cur}.start.it0`) === 'a3',
    'persisted items': x => x.json('items.0.name') === 'معدّل 0',
  });
}
