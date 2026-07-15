// ============================================================
// Certificate of Insurance (COI) — status + summary helpers. Pure and
// dependency-free: the caller passes `today` so this stays testable and never
// touches the clock itself.
//
// A cert is:
//   expired   — past its expiration date
//   expiring  — within EXPIRING_DAYS of expiring (default 30)
//   active    — valid, beyond the window
//   unknown   — no expiration on file (can't vouch for it → treat as a gap)
// ============================================================

export const EXPIRING_DAYS = 30;

const day = 86400000;
const toDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v + (typeof v === 'string' && v.length === 10 ? 'T00:00:00' : ''));
  return Number.isNaN(d.getTime()) ? null : d;
};

// status of one cert relative to `today`. `today` is required (Date or ISO string).
export function coiStatus(cert, today, windowDays = EXPIRING_DAYS) {
  const t = toDate(today);
  const exp = toDate(cert?.expires);
  if (!t || !exp) return 'unknown';
  const days = Math.floor((exp - t) / day);
  if (days < 0) return 'expired';
  if (days <= windowDays) return 'expiring';
  return 'active';
}

// days until expiry (negative = lapsed, null = no date). Handy for sorting/labels.
export function daysToExpiry(cert, today) {
  const t = toDate(today);
  const exp = toDate(cert?.expires);
  if (!t || !exp) return null;
  return Math.floor((exp - t) / day);
}

// roll a list into counts + the certs that need attention, soonest first.
export function coiSummary(certs = [], today, windowDays = EXPIRING_DAYS) {
  const withStatus = certs.map((c) => ({ ...c, status: coiStatus(c, today, windowDays), _days: daysToExpiry(c, today) }));
  const count = { total: withStatus.length, active: 0, expiring: 0, expired: 0, unknown: 0 };
  for (const c of withStatus) count[c.status] += 1;
  // "needs attention" = expired, expiring, or undated — surfaced soonest-first
  const attention = withStatus
    .filter((c) => c.status !== 'active')
    .sort((a, b) => (a._days == null ? Infinity : a._days) - (b._days == null ? Infinity : b._days));
  // compliant = every cert active (nothing lapsed, expiring, or undated)
  const compliant = count.total > 0 && count.expired === 0 && count.expiring === 0 && count.unknown === 0;
  return { count, attention, compliant, certs: withStatus };
}

// a vendor is dispatch-safe only if it has at least one cert and none are lapsed.
// (used to warn before assigning a vendor with no/lapsed insurance on file)
export function vendorCoiOk(certs = [], vendorName, today) {
  const mine = certs.filter((c) => c.holderType === 'vendor' && (c.holderName || '').toLowerCase().trim() === (vendorName || '').toLowerCase().trim());
  if (mine.length === 0) return { ok: false, reason: 'no COI on file' };
  const bad = mine.find((c) => coiStatus(c, today) === 'expired');
  if (bad) return { ok: false, reason: 'COI expired' };
  return { ok: true };
}
