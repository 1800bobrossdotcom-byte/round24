import { describe, it, expect } from 'vitest';
import { buildStatement, MGMT_DEFAULT } from '../pnlStatement.js';

describe('buildStatement — NOI / DSCR / management %', () => {
  it('gross = rent + short-term + other; management = % of gross', () => {
    const s = buildStatement({ rent: 10000, config: { airbnb: 1000, otherIncome: 500, mgmtPct: 10 } });
    expect(s.gross).toBe(11500);
    expect(s.expenses.find((e) => e.key === 'mgmt').value).toBe(1150); // 10%
  });

  it('honors an explicit 0% management fee (not the 9% default)', () => {
    const zero = buildStatement({ rent: 10000, config: { mgmtPct: 0 } });
    expect(zero.mgmtPct).toBe(0);
    expect(zero.expenses.find((e) => e.key === 'mgmt').value).toBe(0);
    const def = buildStatement({ rent: 10000, config: {} });
    expect(def.mgmtPct).toBe(MGMT_DEFAULT); // omitted → 9
  });

  it('NOI = gross - opex; auto lines carry measured labor & repairs', () => {
    const s = buildStatement({ rent: 5000, laborCost: 800.6, repairsCost: 200.4, config: { mgmtPct: 0 } });
    expect(s.expenses.find((e) => e.key === 'maintenanceLabor').value).toBe(801); // rounded
    expect(s.expenses.find((e) => e.key === 'repairs').value).toBe(200);
    expect(s.noi).toBe(s.gross - s.opex);
  });

  it('DSCR is null at zero debt, rounded otherwise; btcf can go negative', () => {
    const noDebt = buildStatement({ rent: 5000, config: { mgmtPct: 0 } });
    expect(noDebt.dscr).toBe(null);
    const withDebt = buildStatement({ rent: 5000, config: { mgmtPct: 0, debtService: 2000 } });
    expect(withDebt.dscr).toBeCloseTo(withDebt.noi / 2000, 2);
    const under = buildStatement({ rent: 1000, config: { taxes: 3000, mgmtPct: 0, debtService: 500 } });
    expect(under.noi).toBeLessThan(0);
    expect(under.btcf).toBe(under.noi - 500);
  });

  it('coerces config values via Number(): numeric string ok, null/non-numeric → 0', () => {
    const s = buildStatement({ rent: 1000, config: { taxes: 1200, waterSewer: '900', insurance: null, trash: 'abc', mgmtPct: 0 } });
    expect(s.expenses.find((e) => e.key === 'taxes').value).toBe(1200);      // number
    expect(s.expenses.find((e) => e.key === 'waterSewer').value).toBe(900);  // numeric string
    expect(s.expenses.find((e) => e.key === 'insurance').value).toBe(0);     // null
    expect(s.expenses.find((e) => e.key === 'trash').value).toBe(0);         // non-numeric
  });
});
