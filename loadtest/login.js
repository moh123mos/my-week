// Password hashing is the CPU-heavy path: k6 run -e BASE=http://localhost:3000 loadtest/login.js
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';

const BASE = __ENV.BASE || 'http://localhost:3000';
export const options = {
  scenarios: { login: { executor: 'shared-iterations', vus: Number(__ENV.VUS) || 50, iterations: Number(__ENV.N) || 500, maxDuration: '10m' } },
  thresholds: { http_req_failed: ['rate<0.001'] },
};

export default function () {
  const r = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email: `lt${exec.scenario.iterationInTest}@loadtest.invalid`, password: 'password123' }), { headers: { 'Content-Type': 'application/json' } });
  check(r, { 'login 200': x => x.status === 200 });
}
