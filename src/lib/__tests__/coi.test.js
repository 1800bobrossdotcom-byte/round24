import { describe, it, expect } from 'vitest';
import { coiStatus, daysToExpiry, coiSummary, vendorCoiOk } from '../coi.js';

const today = '2026-07-15';

describe('coiStatus — relative to a fixed today', () => {
  it('expired when past the date', () => {
    expect(coiStatus({ expires: '2026-06-01' }, today)).toBe('expired');
  });
  it('expiring within the 30-day window', () => {
    expect(coiStatus({ expires: '2026-08-01' }, today)).toBe('expiring'); // 17 days out
    expect(coiStatus({ expires: '2026-08-14' }, today)).toBe('expiring'); // 30 days out (boundary)
  });
  it('active beyond the window', () => {
    expect(coiStatus({ expires: '2026-12-31' }, today)).toBe('active');
  });
  it('unknown with no expiry on file', () => {
    expect(coiStatus({ expires: null }, today)).toBe('unknown');
    expect(coiStatus({}, today)).toBe('unknown');
  });
});

describe('daysToExpiry', () => {
  it('counts down and goes negative once lapsed', () => {
    expect(daysToExpiry({ expires: '2026-07-25' }, today)).toBe(10);
    expect(daysToExpiry({ expires: '2026-07-05' }, today)).toBe(-10);
    expect(daysToExpiry({ expires: null }, today)).toBe(null);
  });
});

describe('coiSummary', () => {
  const certs = [
    { holderName: 'A', expires: '2026-12-31' }, // active
    { holderName: 'B', expires: '2026-08-01' }, // expiring
    { holderName: 'C', expires: '2026-06-01' }, // expired
    { holderName: 'D', expires: null },         // unknown
  ];
  it('counts each bucket', () => {
    const s = coiSummary(certs, today);
    expect(s.count).toEqual({ total: 4, active: 1, expiring: 1, expired: 1, unknown: 1 });
  });
  it('surfaces attention items soonest-first (lapsed before future)', () => {
    const s = coiSummary(certs, today);
    expect(s.attention.map((c) => c.holderName)).toEqual(['C', 'B', 'D']); // expired, expiring, undated
    expect(s.attention.find((c) => c.holderName === 'A')).toBeUndefined();  // active isn't flagged
  });
  it('not compliant while anything is lapsed/expiring/undated', () => {
    expect(coiSummary(certs, today).compliant).toBe(false);
    expect(coiSummary([{ expires: '2027-01-01' }], today).compliant).toBe(true);
  });
});

describe('vendorCoiOk — dispatch gate', () => {
  const certs = [
    { holderType: 'vendor', holderName: 'Ace Plumbing', expires: '2026-12-31' },
    { holderType: 'vendor', holderName: 'Old HVAC', expires: '2026-01-01' },
    { holderType: 'tenant', holderName: 'Basin & Co', expires: '2026-12-31' },
  ];
  it('ok when the vendor has a current cert', () => {
    expect(vendorCoiOk(certs, 'Ace Plumbing', today).ok).toBe(true);
  });
  it('blocks a vendor with a lapsed cert', () => {
    expect(vendorCoiOk(certs, 'Old HVAC', today)).toEqual({ ok: false, reason: 'COI expired' });
  });
  it('blocks a vendor with nothing on file', () => {
    expect(vendorCoiOk(certs, 'Nobody', today)).toEqual({ ok: false, reason: 'no COI on file' });
  });
});
