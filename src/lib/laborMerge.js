// ============================================================
// Labor spine merge — the pure core of `allTimers`, the single labor stream the
// office dashboards, per-door P&L and CAM all read. Extracted from the store so
// it's testable: a regression here double-counts hours into building cost, or
// rolls unapproved work-order hours into the P&L. Pure + dependency-free.
// ============================================================

// Content signature for a labor entry — used to drop an import-SPINE row that is
// really the SAME hours as a live timers-TABLE row (different ids, same work), so
// the office never counts them twice. Keyed on the operator's FIRST name (a
// pay-log "Gianni" matches the seat "Gianni Arone"), building, date, and hours.
// A first-name collision on identical building/date/hours is vanishingly rare and
// far preferable to a silent double-count.
export function laborSig(t, techById, propById) {
  const nm = ((techById?.[t.techId]?.name || t.techId || '') + '').toLowerCase().trim().split(/\s+/)[0];
  const bld = ((t.propLabel || propById?.[t.propId]?.name || '') + '').toLowerCase().trim();
  return `${nm}|${bld}|${t.date}|${Math.round((Number(t.durationHrs) || 0) * 100)}`;
}

// Merge live timer-table rows with the import spine: table rows win; a spine row
// is dropped when it duplicates a live row by id (dbId||id) OR by content
// signature. Returns live rows first, then the surviving spine rows.
export function mergeLabor(live = [], spine = [], techById = {}, propById = {}) {
  const seenId = new Set(live.map((t) => t.dbId || t.id));
  const seenSig = new Set(live.map((t) => laborSig(t, techById, propById)));
  return [
    ...live,
    ...spine.filter((t) => !seenId.has(t.dbId || t.id) && !seenSig.has(laborSig(t, techById, propById))),
  ];
}

// Cost-accounting gate: hours logged against a work order still PENDING approval
// (or DISMISSED/cancelled) don't roll into building cost / the P&L. The worker is
// still PAID (the pay memo keeps them) — only the building-cost attribution waits
// for the office to approve the WO. Hours with no work order always count.
export function costEligible(timers = [], woStatusById = {}) {
  return timers.filter((t) => {
    const st = t.workOrderId ? woStatusById[t.workOrderId] : undefined;
    return !(st === 'pending' || st === 'cancelled');
  });
}
