import { describe, it, expect } from 'vitest';
import { itemsFromTemplate, scoreItems, inspectionSummary, templateByKey, TEMPLATES } from '../inspection.js';

describe('templates', () => {
  it('every template has a key and non-empty items', () => {
    expect(TEMPLATES.length).toBeGreaterThan(0);
    expect(TEMPLATES.every((t) => t.key && t.items.length > 0)).toBe(true);
  });
  it('itemsFromTemplate copies labels with blank status', () => {
    const items = itemsFromTemplate('move_in');
    expect(items.length).toBe(templateByKey('move_in').items.length);
    expect(items.every((i) => i.status === '' && i.note === '')).toBe(true);
  });
  it('unknown key yields an empty list', () => {
    expect(itemsFromTemplate('nope')).toEqual([]);
  });
});

describe('scoreItems', () => {
  const items = [
    { label: 'a', status: 'pass' },
    { label: 'b', status: 'fail' },
    { label: 'c', status: 'na' },
    { label: 'd', status: '' },
  ];
  it('counts each status and computes completion', () => {
    const s = scoreItems(items);
    expect(s).toMatchObject({ total: 4, pass: 1, fail: 1, na: 1, done: 3, hasFails: true, complete: false });
    expect(s.pct).toBe(75);
  });
  it('complete only when every item has a status', () => {
    expect(scoreItems([{ status: 'pass' }, { status: 'na' }]).complete).toBe(true);
    expect(scoreItems([]).complete).toBe(false);
  });
});

describe('inspectionSummary', () => {
  const inspections = [
    { status: 'complete', items: [{ status: 'pass' }, { status: 'fail' }] },
    { status: 'in_progress', items: [{ status: 'fail' }, { status: '' }] },
  ];
  it('rolls up open/completed and outstanding fails', () => {
    const s = inspectionSummary(inspections);
    expect(s).toEqual({ open: 1, completed: 1, failsOpen: 2, total: 2 });
  });
});
