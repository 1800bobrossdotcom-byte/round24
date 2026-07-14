import { describe, it, expect } from 'vitest';
import { categoryForText, parseTags, tagSegments } from '../taskTags.js';

describe('categoryForText — #tags drive the category bucket', () => {
  it('maps trade tags', () => {
    expect(categoryForText('#leak under the kitchen sink')).toBe('plumbing');
    expect(categoryForText('replace #breaker in unit 4B')).toBe('electrical');
    expect(categoryForText('#furnace not igniting')).toBe('hvac');
  });
  it('no tag → null (caller keeps its default)', () => {
    expect(categoryForText('fix the thing')).toBe(null);
  });
});

describe('parseTags / tagSegments', () => {
  it('finds every tag in a task line', () => {
    const tags = parseTags('#mopping and #trash haul, 2nd floor');
    expect(tags.length).toBe(2);
  });
  it('segments preserve the full text', () => {
    const segs = tagSegments('#leak under sink');
    expect(segs.map((s) => s.text).join(' ').length).toBeGreaterThan(0);
  });
});
