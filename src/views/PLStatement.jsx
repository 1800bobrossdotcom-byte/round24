import { useMemo, useState, useEffect, useRef } from 'react';
import { buildStatement } from '../lib/pnlStatement.js';
import { IcChart, IcChevron } from '../components/ui.jsx';

const nk = (s) => (s || '').toLowerCase().trim();
const money = (v) => (v == null ? '—' : (v < 0 ? '-$' : '$') + Math.abs(Math.round(v)).toLocaleString());
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const thisMonth = () => new Date().toISOString().slice(0, 7);
const stepMonth = (m, d) => {
  const [y, mo] = (m || thisMonth()).split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(mo)) return thisMonth();
  const dt = new Date(Date.UTC(y, mo - 1 + d, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
};
const fmtMonth = (m) => { const [y, mo] = String(m || '').split('-').map(Number); return Number.isFinite(mo) && MONTHS[mo - 1] ? `${MONTHS[mo - 1]} ${y}` : '—'; };

export default function PLStatement({ store }) {
  const { leasing = [], allTimers = [], purchases = [], propById = {}, plConfig = {}, setPlLine } = store;

  const buildings = useMemo(
    () => [...new Set(leasing.filter((u) => !(u.type === 'land' || u.status === 'held')).map((u) => u.building))].sort(),
    [leasing],
  );
  const [building, setBuilding] = useState('');
  useEffect(() => { if ((!building || !buildings.includes(building)) && buildings.length) setBuilding(buildings[0]); }, [buildings]);

  // default to the most recent month that has labor or receipts, else this month
  const dataMonths = useMemo(() => {
    const s = new Set();
    allTimers.forEach((t) => t.date && s.add(t.date.slice(0, 7)));
    purchases.forEach((p) => { const d = p.date || p.createdAt; if (d) s.add(String(d).slice(0, 7)); });
    return [...s].sort();
  }, [allTimers, purchases]);
  const [month, setMonth] = useState('');
  const pickedRef = useRef(false); // once the user steps months, stop auto-defaulting
  useEffect(() => { if (!pickedRef.current) setMonth(dataMonths[dataMonths.length - 1] || thisMonth()); }, [dataMonths]);

  const inMonth = (d) => (d || '').slice(0, 7) === month;
  const rent = useMemo(() => leasing.filter((u) => nk(u.building) === nk(building) && u.status === 'leased' && !(u.type === 'land' || u.status === 'held')).reduce((a, u) => a + (u.rent || 0), 0), [leasing, building]);
  const laborCost = useMemo(() => allTimers.filter((t) => inMonth(t.date) && nk(propById[t.propId]?.name || t.propLabel) === nk(building)).reduce((a, t) => a + (t.durationHrs || 0) * (t.rate || 0), 0), [allTimers, building, month, propById]);
  const repairsCost = useMemo(() => purchases.filter((p) => (!p.status || p.status === 'approved') && inMonth(p.date || p.createdAt) && nk(p.propLabel) === nk(building)).reduce((a, p) => a + (p.amount || 0), 0), [purchases, building, month]);

  const cfg = plConfig[building] || {};
  const stmt = useMemo(() => buildStatement({ rent, laborCost, repairsCost, config: cfg }), [rent, laborCost, repairsCost, cfg]);

  if (!buildings.length) {
    return (
      <div>
        <div className="view-head"><h1>P&amp;L statement</h1><p>Auto-assembled from rent, labor, and receipts.</p></div>
        <div className="card"><p className="note">Add a rent roll first — then Caliper builds each building's monthly P&amp;L from the connected data.</p></div>
      </div>
    );
  }

  const editLine = (key, val) => setPlLine && setPlLine(building, { [key]: val === '' ? 0 : Math.round(parseFloat(val) * 100) / 100 });
  const cellInput = { width: 96, background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 13, padding: '5px 7px', borderRadius: 7, textAlign: 'right' };

  const Line = ({ l }) => (
    <tr>
      <td style={{ paddingLeft: 18, color: 'var(--text-dim)' }}>
        {l.label}
        {l.auto && <span className="pl-auto" title="Pulled from your connected data">auto</span>}
      </td>
      <td className="num">
        {l.edit && setPlLine
          ? <input key={`${building}-${month}-${l.key}`} style={cellInput} type="number" step="1" inputMode="decimal" defaultValue={l.value || ''} onBlur={(e) => editLine(l.key, e.target.value)} placeholder="0" />
          : <span className="mono" style={{ color: l.auto ? 'var(--accent)' : 'var(--text)', fontWeight: l.auto ? 700 : 400 }}>{money(l.value)}</span>}
      </td>
    </tr>
  );

  return (
    <div>
      <div className="view-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div><h1>P&amp;L statement</h1><p>Rent, labor, and receipts fill in automatically. Enter the fixed lines once — Caliper does the math.</p></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn ghost sm icon-btn" onClick={() => { pickedRef.current = true; setMonth((m) => stepMonth(m, -1)); }} aria-label="Previous month"><IcChevron width={15} height={15} style={{ transform: 'rotate(180deg)' }} /></button>
          <span className="mono" style={{ fontWeight: 700, minWidth: 88, textAlign: 'center' }}>{month ? fmtMonth(month) : '—'}</span>
          <button className="btn ghost sm icon-btn" onClick={() => { pickedRef.current = true; setMonth((m) => stepMonth(m, 1)); }} aria-label="Next month"><IcChevron width={15} height={15} /></button>
        </div>
      </div>

      <div className="rangebar" style={{ marginBottom: 'var(--gap)' }}>
        <span className="lbl">Property</span>
        <select className="seg" value={building} onChange={(e) => setBuilding(e.target.value)}
          style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text)', fontFamily: 'var(--font)', fontWeight: 700, fontSize: 14, padding: '8px 10px', borderRadius: 9 }}>
          {buildings.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      <div className="rr-kpis">
        <div className="kpi-c"><span className="v mono">{money(stmt.gross)}</span><span className="k">gross income</span></div>
        <div className="kpi-c"><span className="v mono" style={{ color: 'var(--danger)' }}>{money(stmt.opex)}</span><span className="k">operating exp.</span></div>
        <div className="kpi-c"><span className="v mono" style={{ color: stmt.noi >= 0 ? 'var(--money)' : 'var(--danger)' }}>{money(stmt.noi)}</span><span className="k">NOI</span></div>
        <div className="kpi-c"><span className="v mono" style={{ color: stmt.btcf >= 0 ? 'var(--money)' : 'var(--danger)' }}>{money(stmt.btcf)}</span><span className="k">cash flow</span></div>
        <div className="kpi-c"><span className="v mono" style={{ color: stmt.dscr == null ? 'var(--text-faint)' : stmt.dscr >= 1.2 ? 'var(--money)' : 'var(--warn)' }}>{stmt.dscr == null ? '—' : stmt.dscr.toFixed(2)}</span><span className="k">DSCR</span></div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="pl-tbl">
          <tbody>
            <tr className="pl-head"><td>Income</td><td className="num">{fmtMonth(month)}</td></tr>
            {stmt.income.map((l) => <Line key={l.key} l={l} />)}
            <tr className="pl-total"><td>Gross income</td><td className="num mono">{money(stmt.gross)}</td></tr>

            <tr className="pl-head"><td>Operating expenses</td><td className="num" /></tr>
            {stmt.expenses.map((l) => <Line key={l.key} l={l} />)}
            <tr className="pl-total"><td>Operating expenses</td><td className="num mono" style={{ color: 'var(--danger)' }}>{money(stmt.opex)}</td></tr>

            <tr className="pl-total pl-noi"><td>Net operating income</td><td className="num mono" style={{ color: stmt.noi >= 0 ? 'var(--money)' : 'var(--danger)' }}>{money(stmt.noi)}</td></tr>
            <tr>
              <td style={{ paddingLeft: 18, color: 'var(--text-dim)' }}>Debt service</td>
              <td className="num">{setPlLine
                ? <input key={`${building}-ds`} style={cellInput} type="number" step="1" inputMode="decimal" defaultValue={cfg.debtService || ''} onBlur={(e) => editLine('debtService', e.target.value)} placeholder="0" />
                : <span className="mono">{money(stmt.debtService)}</span>}</td>
            </tr>
            <tr className="pl-total"><td>Before-tax cash flow</td><td className="num mono" style={{ color: stmt.btcf >= 0 ? 'var(--money)' : 'var(--danger)' }}>{money(stmt.btcf)}</td></tr>
            <tr className="pl-total"><td>DSCR</td><td className="num mono">{stmt.dscr == null ? '—' : stmt.dscr.toFixed(2)}</td></tr>
          </tbody>
        </table>
      </div>

      <p className="note">
        <span className="pl-auto" style={{ marginLeft: 0 }}>auto</span> lines come straight from the connected data — <b>Rent</b> from the rent roll, <b>Maintenance labor</b> from the crew's timers, <b>Repairs</b> from approved receipts, <b>Management</b> as {stmt.mgmtPct}% of gross. The rest you set once per property.
        <br /><span style={{ color: 'var(--text-faint)' }}>Rent reflects the <b>current</b> roll; labor &amp; repairs are what's logged for {fmtMonth(month)} so far — NOI firms up as the month closes.</span>
      </p>
    </div>
  );
}
