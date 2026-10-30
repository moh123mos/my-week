export const $ = selector => document.querySelector(selector);

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
// Everything that isn't a constant goes through this before reaching innerHTML.
export const esc = s => String(s).replace(/[&<>"']/g, c => ESCAPES[c]);

export const cls = (...names) => names.filter(Boolean).join(' ');
