// Every server route the client uses. A hung request must not freeze saving: a timeout counts as a network failure.
import { MESSAGES, TIMING } from './config.js';

const timeoutSignal = ms => (typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined);

// The server's reason for ending a session ("your account was suspended"), kept for the one place that shows the
// login screen. Read once: it describes the failure that just happened, not later ones.
let authNotice = '';
export function takeAuthNotice() {
  const n = authNotice;
  authNotice = '';
  return n;
}

async function request(path, { method = 'GET', body, keepalive = false, timeoutMs = TIMING.REQUEST_TIMEOUT_MS } = {}) {
  let response, data = null;
  try {
    response = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      keepalive,
      signal: timeoutSignal(timeoutMs),
    });
    try { data = await response.json(); } catch (e) { if (response.ok) throw e; }
  } catch (_) {
    throw new Error(MESSAGES.OFFLINE);
  }
  if (!response.ok) {
    const e = new Error((data && data.error) || MESSAGES.GENERIC_ERROR);
    e.status = response.status;
    e.code = data && data.code;
    if (e.code === 'disabled') authNotice = e.message;
    throw e;
  }
  return data;
}

// Network trouble, 5xx, timeout (408) and rate limit (429) are worth retrying; any other 4xx will never succeed.
export const isPermanent = e => !!e.status && e.status < 500 && e.status !== 408 && e.status !== 429;

export const login = (email, password) => request('/auth/login', { method: 'POST', body: { email, password } });
export const register = (name, email, password) => request('/auth/register', { method: 'POST', body: { name, email, password } });
export const logout = () => request('/auth/logout', { method: 'POST' });

export const fetchSession = weekKeys => request(`/session?weeks=${weekKeys.join(',')}`);
export const fetchWeeks = weekKeys => request(`/data/weeks?keys=${weekKeys.join(',')}`);
export const saveData = (body, keepalive) => request('/data', { method: 'PUT', body, keepalive });

export const applyRowsForward = (week, items) => request('/data/apply-forward', { method: 'POST', body: { week, items } });

export const exportNotebook = () => request('/data/export', { timeoutMs: TIMING.BACKUP_TIMEOUT_MS });
export const importNotebook = state => request('/data/import', { method: 'PUT', body: { state }, timeoutMs: TIMING.BACKUP_TIMEOUT_MS });
export const deleteNotebook = () => request('/data', { method: 'DELETE' });

// Admin dashboard (public/admin.html). The server refuses these for anyone who is not an admin.
const qs = params => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();
  return q ? '?' + q : '';
};
export const adminStats = () => request('/admin/stats');
export const adminUsers = params => request('/admin/users' + qs(params));
export const adminUser = id => request(`/admin/users/${id}`);
export const adminUpdateUser = (id, patch) => request(`/admin/users/${id}`, { method: 'PATCH', body: patch });
export const adminResetPassword = id => request(`/admin/users/${id}/reset-password`, { method: 'POST' });
export const adminRevokeSessions = id => request(`/admin/users/${id}/revoke-sessions`, { method: 'POST' });
export const adminDeleteUser = id => request(`/admin/users/${id}`, { method: 'DELETE' });
export const adminAudit = params => request('/admin/audit' + qs(params));
