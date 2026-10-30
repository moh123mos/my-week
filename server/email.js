const { MAX_EMAIL } = require('./limits');

// Linear on purpose: dots are excluded from the domain labels, so the groups can't overlap
// (the old /^[^\s@]+@[^\s@]+\.[^\s@]+$/ backtracked quadratically on hostile input).
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;

// Length first, so the regex never sees a huge string.
const isEmail = e => typeof e === 'string' && e.length <= MAX_EMAIL && EMAIL_RE.test(e);

module.exports = { isEmail, EMAIL_RE };
