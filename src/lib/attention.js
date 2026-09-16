// ============================================================
// "Needs attention" — the live to-do the notification bell shows above the
// activity feed. Pure: derived from store slices + today, so it's always
// current and never has to be marked read. Ordered urgent → high → info.
// ============================================================
import { coiSummary } from './coi.js';

const RANK = { urgent: 0, high: 1, info: 2 };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const openish = (w) => w.status === 'open' || w.status === 'in_progress';

export function attentionItems({
  role = 'admin', myName = '', today,
  workOrders = [], purchases = [], maintRequests = [], cois = [], maintSchedules = [],
  bookings = [], vendors = [], queuedTimers = 0, unallocatedHrs = 0,
} = {}) {
  const staff = role === 'admin' || role === 'manager';
  const out = [];
  const add = (id, tab, priority, count, title) => { if (count > 0) out.push({ id, tab, priority, count, title }); };

  if (staff) {
    const urgent = workOrders.filter((w) => openish(w) && (w.priority ?? 3) === 1).length;
    add('wo-urgent', 'wo', 'urgent', urgent, `${plural(urgent, 'urgent work order')} open`);
    const overdue = today ? workOrders.filter((w) => openish(w) && w.due && w.due < today).length : 0;
    add('wo-overdue', 'wo', 'high', overdue, `${plural(overdue, 'work order')} past due`);
    const reports = workOrders.filter((w) => w.status === 'pending').length;
    add('wo-triage', 'wo', 'high', reports, `${plural(reports, 'field report')} to triage`);
    const requests = maintRequests.filter((r) => r.status === 'new').length;
    add('requests', 'requests', 'high', requests, `${plural(requests, 'resident request')} waiting`);
    const receipts = purchases.filter((p) => p.status === 'pending').length;
    add('purchases', 'pur', 'info', receipts, `${plural(receipts, 'receipt')} awaiting review`);
    if (cois.length && today) {
      const s = coiSummary(cois, today);
      add('coi-expired', 'coi', 'high', s.count.expired, `${plural(s.count.expired, 'insurance certificate')} lapsed`);
      add('coi-expiring', 'coi', 'info', s.count.expiring, `${plural(s.count.expiring, 'certificate')} expiring within 30 days`);
    }
    const due = today ? maintSchedules.filter((m) => m.active !== false && m.nextDue && m.nextDue <= today).length : 0;
    add('maint-due', 'maint', 'info', due, `${plural(due, 'recurring task')} due`);
    const holds = bookings.filter((b) => b.status === 'pending').length;
    add('bookings', 'amenities', 'info', holds, `${plural(holds, 'amenity request')} to confirm`);
    const pendingVendors = vendors.filter((v) => v.approved === false).length;
    add('vendors', 'vendors', 'info', pendingVendors, `${plural(pendingVendors, 'vendor')} awaiting approval`);
    if (unallocatedHrs > 0) add('unalloc', 'dash', 'info', 1, `${Math.round(unallocatedHrs * 10) / 10}h not yet allocated to a building`);
  } else {
    const mine = workOrders.filter((w) => openish(w) && myName && w.assigneeLabel === myName);
    const urgentMine = mine.filter((w) => (w.priority ?? 3) <= 2).length;
    add('my-urgent', 'wo', 'urgent', urgentMine, `${plural(urgentMine, 'priority job')} assigned to you`);
    const dueMine = today ? mine.filter((w) => w.due && w.due <= today).length : 0;
    add('my-due', 'wo', 'high', dueMine, `${plural(dueMine, 'job')} due today or past due`);
    add('queued', 'timesheet', 'high', queuedTimers, `${plural(queuedTimers, 'timer entry', 'timer entries')} waiting to sync`);
  }
  return out.sort((a, b) => RANK[a.priority] - RANK[b.priority]);
}
