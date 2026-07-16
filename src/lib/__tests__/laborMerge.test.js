import { describe, it, expect } from 'vitest';
import { laborSig, mergeLabor, costEligible } from '../laborMerge.js';

const techById = { t1: { name: 'Gianni Arone' } };
const propById = { p1: { name: 'Alpha' } };

describe('laborSig — content signature', () => {
  it('keys on first name + building + date + hours (pay-log first name matches the seat)', () => {
    const table = { techId: 't1', propId: 'p1', date: '2026-01-05', durationHrs: 3 };
    const spine = { techId: 'Gianni', propLabel: 'Alpha', date: '2026-01-05', durationHrs: 3 };
    expect(laborSig(spine, techById, propById)).toBe(laborSig(table, techById, propById));
  });
  it('differs when hours, building, or date differ', () => {
    const a = { techId: 't1', propId: 'p1', date: '2026-01-05', durationHrs: 3 };
    expect(laborSig(a, techById, propById)).not.toBe(laborSig({ ...a, durationHrs: 4 }, techById, propById));
    expect(laborSig(a, techById, propById)).not.toBe(laborSig({ ...a, date: '2026-01-06' }, techById, propById));
  });
});

describe('mergeLabor — table wins, spine deduped by id and by content', () => {
  const live = [{ id: 'L1', dbId: 'db1', techId: 't1', propId: 'p1', date: '2026-01-05', durationHrs: 3 }];
  it('drops a spine row that is the SAME hours as a live row (no double-count)', () => {
    const spine = [{ id: 'S1', techId: 'Gianni', propLabel: 'Alpha', date: '2026-01-05', durationHrs: 3 }];
    const out = mergeLabor(live, spine, techById, propById);
    expect(out).toHaveLength(1);         // spine copy of the same work is dropped
    expect(out[0].id).toBe('L1');        // the table row wins
  });
  it('keeps a genuinely different spine row', () => {
    const spine = [{ id: 'S2', techId: 'Gianni', propLabel: 'Alpha', date: '2026-01-06', durationHrs: 2 }];
    expect(mergeLabor(live, spine, techById, propById)).toHaveLength(2);
  });
  it('drops a spine row that shares the live dbId/id', () => {
    const spine = [{ id: 'db1', techId: 'x', propLabel: 'Z', date: '2026-02-01', durationHrs: 9 }];
    expect(mergeLabor(live, spine, techById, propById)).toHaveLength(1);
  });
});

describe('costEligible — unapproved-WO hours stay out of building cost', () => {
  const timers = [
    { id: 'a', workOrderId: 'w1', durationHrs: 2 }, // pending WO
    { id: 'b', workOrderId: 'w2', durationHrs: 2 }, // cancelled WO
    { id: 'c', workOrderId: 'w3', durationHrs: 2 }, // done WO
    { id: 'd', durationHrs: 2 },                    // no WO
  ];
  const wo = { w1: 'pending', w2: 'cancelled', w3: 'done' };
  it('excludes pending & cancelled, keeps done and WO-less', () => {
    expect(costEligible(timers, wo).map((t) => t.id)).toEqual(['c', 'd']);
  });
});
