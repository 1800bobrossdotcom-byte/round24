import { describe, it, expect } from 'vitest';
import { attentionItems } from '../attention.js';

const today = '2026-09-16';
const wo = (over) => ({ status: 'open', priority: 3, ...over });

describe('attentionItems — office', () => {
  it('counts the things the office must act on, urgent first', () => {
    const items = attentionItems({
      role: 'admin', today,
      workOrders: [wo({ priority: 1 }), wo({ priority: 1, status: 'in_progress' }), wo({ due: '2026-09-10' }), wo({ status: 'pending' }), wo({ status: 'done', priority: 1 })],
      purchases: [{ status: 'pending' }, { status: 'approved' }],
      maintRequests: [{ status: 'new' }, { status: 'converted' }],
      cois: [{ expires: '2026-08-01' }, { expires: '2026-10-01' }, { expires: '2027-01-01' }],
      maintSchedules: [{ active: true, nextDue: '2026-09-16' }, { active: true, nextDue: '2026-10-01' }, { active: false, nextDue: '2026-01-01' }],
      bookings: [{ status: 'pending' }],
      vendors: [{ approved: false }, { approved: true }],
      unallocatedHrs: 12.34,
    });
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId['wo-urgent'].count).toBe(2);          // done ones don't count
    expect(byId['wo-overdue'].count).toBe(1);
    expect(byId['wo-triage'].count).toBe(1);
    expect(byId.requests.count).toBe(1);
    expect(byId.purchases.count).toBe(1);
    expect(byId['coi-expired'].count).toBe(1);
    expect(byId['coi-expiring'].count).toBe(1);
    expect(byId['maint-due'].count).toBe(1);          // inactive + future excluded
    expect(byId.bookings.count).toBe(1);
    expect(byId.vendors.count).toBe(1);
    expect(byId.unalloc.title).toBe('12.3h not yet allocated to a building');
    expect(items[0].priority).toBe('urgent');
    expect(items[items.length - 1].priority).toBe('info');
    expect(byId['wo-urgent'].title).toBe('2 urgent work orders open');
    expect(byId.purchases.title).toBe('1 receipt awaiting review');
  });

  it('is empty when there is nothing to do', () => {
    expect(attentionItems({ role: 'manager', today })).toEqual([]);
  });
});

describe('attentionItems — crew', () => {
  it('only surfaces the crew member’s own jobs and their unsynced timers', () => {
    const items = attentionItems({
      role: 'tech', myName: 'Marco Rossi', today,
      workOrders: [wo({ priority: 1, assigneeLabel: 'Marco Rossi' }), wo({ priority: 1, assigneeLabel: 'Someone Else' }), wo({ assigneeLabel: 'Marco Rossi', due: '2026-09-16' })],
      purchases: [{ status: 'pending' }],          // office concern, not the crew's
      queuedTimers: 2,
    });
    const ids = items.map((i) => i.id);
    expect(ids).toEqual(['my-urgent', 'my-due', 'queued']);
    expect(items[2].title).toBe('2 timer entries waiting to sync');
    expect(ids).not.toContain('purchases');
  });
});
