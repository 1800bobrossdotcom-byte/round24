// Shared date helpers. IMPORTANT: today's date must be computed in LOCAL time.
// `new Date().toISOString().slice(0,10)` formats in UTC, so after ~5pm PT / 7pm
// ET it rolls to "tomorrow" — shifting today-rings, day windows, expiry flags,
// and date stamps by a day. Calendar/COI/Inspections all hit that bug; this is
// the single local-time source they share.
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
