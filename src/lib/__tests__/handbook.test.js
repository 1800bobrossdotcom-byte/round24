import { describe, it, expect } from 'vitest';
import { templateSections, normalizeSections, hasContent, HANDBOOK_TEMPLATE } from '../handbook.js';

describe('templateSections', () => {
  it('mirrors the template with unique ids and empty bodies to fill in', () => {
    const s = templateSections();
    expect(s.length).toBe(HANDBOOK_TEMPLATE.length);
    expect(new Set(s.map((x) => x.id)).size).toBe(s.length); // ids unique
    expect(s.every((x) => x.body === '')).toBe(true);
    expect(s[0].title).toBe('Welcome');
  });
});

describe('normalizeSections', () => {
  it('drops fully-empty sections and coerces fields to strings', () => {
    const out = normalizeSections([
      { title: 'Contacts', body: 'Call 555' },
      { title: '', body: '' },            // dropped
      { title: 'Rules' },                 // kept (has title)
      { body: 'orphan body' },            // kept (has body)
    ]);
    expect(out.map((s) => s.title)).toEqual(['Contacts', 'Rules', '']);
    expect(out.every((s) => typeof s.body === 'string' && s.id)).toBe(true);
  });
  it('handles non-arrays safely', () => {
    expect(normalizeSections(null)).toEqual([]);
    expect(normalizeSections(undefined)).toEqual([]);
  });
  it('caps the icon length', () => {
    expect(normalizeSections([{ title: 'x', icon: '🚨🚨🚨🚨🚨' }])[0].icon.length).toBeLessThanOrEqual(4);
  });
});

describe('hasContent', () => {
  it('false for empty / all-blank, true when something is filled', () => {
    expect(hasContent([])).toBe(false);
    expect(hasContent([{ title: '', body: '' }])).toBe(false);
    expect(hasContent([{ title: 'Welcome', body: '' }])).toBe(true);
  });
});
