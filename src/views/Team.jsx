import { useState, useEffect, useRef } from 'react';
import { byTech, byPeriod, totals, fmtMoney, fmtHrs, periodKey } from '../lib/rollups.js';
import { Avatar, IcBuilding } from '../components/ui.jsx';
import { disperseSalary, monthlyOf, annualOf, SALARY_PERIODS } from '../lib/salary.js';

const GRAINS = ['day', 'week', 'month', 'year'];
const money0 = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString();

export default function Team({ store, focus, navigate }) {
  const { timers = [], techById = {}, techs = [], propById = {}, salaries = {}, setSalary, setOperatorActive, setOperatorRate, role,
    orgMembers = [], operators = [], setMemberFieldWork } = store;
  const [rateEdit, setRateEdit] = useState(null); // techId whose hourly rate is being set
  const isOffice = role === 'admin' || role === 'manager';
  const [salEdit, setSalEdit] = useState(null); // techId being edited
  const go = navigate || (() => {});
  // a period row → the Calendar month it falls in (week/day keys carry a date)
  const monthOf = (key) => (grain === 'year' ? `${key}-01` : key.slice(0, 7));
  const [grain, setGrain] = useState('week');
  const [hl, setHl] = useState(null); // operator highlighted from a drill-down
  const cardRefs = useRef({});
  const isInactive = (key) => techById[key]?.active === false;
  // active operators up top; departed operators keep their tab but sink to the
  // bottom under a divider (their history still counts — they're just off the roster).
  const allRows = byTech(timers).sort((a, b) => b.cost - a.cost);
  const rows = allRows.filter((r) => !isInactive(r.key));
  const goneRows = allRows.filter((r) => isInactive(r.key));
  // office logins (admin/manager) — candidates to also get field access. Crew
  // (tech) already have the Field timer, so they're not listed here.
  const officeMembers = orgMembers.filter((m) => m.role === 'admin' || m.role === 'manager');

  // opening from a Dashboard drill-down: scroll to the operator and flash it
  useEffect(() => {
    const id = focus?.operatorId;
    if (!id) return;
    setHl(id);
    const el = cardRefs.current[id];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(() => setHl(null), 2400);
    return () => clearTimeout(t);
  }, [focus]);

  // one operator's tab. `inactive` greys it and swaps the demote/reactivate control.
  const renderOperator = (r, i, inactive) => {
    const tt = timers.filter((t) => t.techId === r.key);
    const periods = byPeriod(tt, grain, 6);
    const t = totals(tt);
    const tech = techById[r.key] || { name: 'Unknown operator', role: 'tech', rate: 0 };
    const maxc = Math.max(...periods.map((p) => p.cost), 1);
    const sal = salaries[r.key];
    const hoursByBuilding = Object.entries(tt.reduce((m, x) => {
      const n = propById[x.propId]?.name || x.propLabel || 'Unassigned'; m[n] = (m[n] || 0) + (x.durationHrs || 0); return m;
    }, {})).map(([name, hours]) => ({ name, hours }));
    const disp = sal ? disperseSalary(sal, hoursByBuilding, 30.44) : null;
    return (
      <div className="card" key={r.key} ref={(el) => { cardRefs.current[r.key] = el; }}
        style={{ marginBottom: 'var(--gap)', transition: 'border-color .3s, box-shadow .3s',
          ...(inactive ? { opacity: 0.6 } : null),
          ...(hl === r.key ? { borderColor: 'var(--accent, #a855f7)', boxShadow: '0 0 0 1px var(--accent, #a855f7)' } : null) }}>
        <div className="row" style={{ paddingTop: 0 }}>
          <Avatar name={tech.name} i={i} />
          <div className="lead">
            <div className="t">{tech.name}
              {sal && <span className="chip" style={{ marginLeft: 8, color: 'var(--accent)' }}>salaried</span>}
              {inactive && <span className="chip" style={{ marginLeft: 8, color: 'var(--text-dim)' }}>former</span>}
            </div>
            <div className="s" style={{ textTransform: 'capitalize' }}>{tech.role} · {sal ? `${money0(annualOf(sal.amount, sal.period))}/yr` : `$${tech.rate}/hr`}</div>
          </div>
          <div className="val">
            {sal
              ? <><div className="big money">{money0(monthlyOf(sal.amount, sal.period))}<span className="small" style={{ fontWeight: 400 }}>/mo</span></div><div className="small">{fmtHrs(t.hrs)} hrs logged</div></>
              : <><div className="big money">{fmtMoney(t.cost)}</div><div className="small">{fmtHrs(t.hrs)} hrs · {t.count} jobs</div></>}
          </div>
        </div>

        {isOffice && (
          <div style={{ marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {salEdit === r.key
              ? <SalaryEditor initial={sal} onCancel={() => setSalEdit(null)} onSave={(v) => { setSalary(r.key, v); setSalEdit(null); }} />
              : rateEdit === r.key
              ? <RateEditor initial={tech.rate} onCancel={() => setRateEdit(null)} onSave={(v) => { setOperatorRate?.(r.key, v); setRateEdit(null); }} />
              : <>
                  {!sal && <button className="btn ghost sm" onClick={() => setRateEdit(r.key)}>{tech.rate > 0 ? `Rate · $${tech.rate}/hr` : 'Set hourly rate'}</button>}
                  <button className="btn ghost sm" onClick={() => setSalEdit(r.key)}>{sal ? 'Edit salary' : 'Set salaried'}</button>
                  {inactive
                    ? <button className="btn ghost sm" onClick={() => setOperatorActive?.(r.key, true)}>Reactivate</button>
                    : <button className="btn ghost sm" style={{ color: 'var(--danger)' }}
                        onClick={() => { if (window.confirm(`Mark ${tech.name} as no longer active? Their labor history stays; they drop off the assignment roster.`)) setOperatorActive?.(r.key, false); }}>Mark inactive</button>}
                </>}
          </div>
        )}

        {sal && (
          <div className="card" style={{ background: 'var(--surface-2)', marginTop: 10, marginBottom: 4 }}>
            <span className="field-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
              <IcBuilding width={12} height={12} /> Salary dispersed by property · ~{money0(disp.total)}/mo, by hours worked
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {disp.byBuilding.map((b) => (
                <div key={b.name} style={{ display: 'grid', gridTemplateColumns: '150px 1fr auto', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                  <span className="rr-occbar" style={{ height: 8 }}><span style={{ width: Math.max(2, b.share * 100) + '%', background: 'var(--accent)' }} /></span>
                  <span className="mono" style={{ fontSize: 12, minWidth: 92, textAlign: 'right' }}>{Math.round(b.share * 100)}% · <b className="money">{money0(b.cost)}</b></span>
                </div>
              ))}
            </div>
            <p className="note" style={{ margin: '8px 0 0' }}>Their fixed salary lands on the doors they actually worked — flowing into each building's per-door P&amp;L instead of a lump of overhead.</p>
          </div>
        )}

        <hr className="hr" />
        <table className="tbl">
          <thead><tr><th>{grain[0].toUpperCase() + grain.slice(1)}</th><th className="num">Jobs</th><th className="num">Hours</th><th className="num">Labor cost</th></tr></thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.key} onClick={() => go('cal', { month: monthOf(p.key) })} style={{ cursor: 'pointer' }}>
                <td className="barcell"><div className="bar" style={{ width: `${(p.cost / maxc) * 100}%` }} />
                  <span className="bar-label mono" style={{ fontSize: 12 }}>{p.label}</span></td>
                <td className="num">{p.count}</td>
                <td className="num">{fmtHrs(p.hrs)}</td>
                <td className="num money" style={{ fontWeight: 700 }}>{fmtMoney(p.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div>
      <div className="view-head"><h1>Team</h1><p>Hours &amp; labor cost per operator</p></div>

      <div className="rangebar">
        <span className="lbl">Totals by</span>
        <div className="seg">
          {GRAINS.map((g) => <button key={g} className={grain === g ? 'on' : ''} onClick={() => setGrain(g)}>{g}</button>)}
        </div>
        <span className="lbl" style={{ marginLeft: 'auto' }}>week starts Saturday · matches your pay period</span>
      </div>

      {rows.map((r, i) => renderOperator(r, i, false))}

      {goneRows.length > 0 && (
        <>
          <div className="view-head" style={{ marginTop: 24, marginBottom: 8 }}>
            <h1 style={{ fontSize: 16, color: 'var(--text-dim)' }}>No longer active</h1>
            <p>Former operators — labor history preserved, off the assignment roster</p>
          </div>
          {goneRows.map((r, i) => renderOperator(r, i, true))}
        </>
      )}
      {isOffice && officeMembers.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <span className="field-label" style={{ display: 'block', marginBottom: 4 }}>Field access · office people who also work the field</span>
          <p className="note" style={{ margin: '0 0 12px' }}>
            Turn this on and an office login also gets the crew Field timer — one account for someone who dispatches <em>and</em> turns a wrench. Their logged time attributes to them in both views.
          </p>
          {officeMembers.map((m) => (
            <FieldAccessRow
              key={m.userId}
              member={m}
              seat={operators.find((o) => o.userId === m.userId) || null}
              onEnable={(name, rate) => setMemberFieldWork?.(m.userId, true, { name, rate })}
              onDisable={() => setMemberFieldWork?.(m.userId, false)}
            />
          ))}
        </div>
      )}

      <p className="note">Every operator's tab in one place — daily through yearly, no per-person spreadsheet, no "PAID BY BRENT" reconciliation notes. Salaried or hourly, the cost lands on the right doors. Export to payroll is one tap (coming in the build).</p>
    </div>
  );
}

// one office member's field-access toggle: enable creates/reactivates their
// operator seat (with a rate); turning off deactivates it (history preserved).
function FieldAccessRow({ member, seat, onEnable, onDisable }) {
  const [rate, setRate] = useState('');
  const [busy, setBusy] = useState(false);
  const name = member.name || (member.email ? member.email.split('@')[0] : 'Member');
  const on = seat && seat.status !== 'inactive';
  return (
    <div className="row" style={{ alignItems: 'center' }}>
      <div className="lead">
        <div className="t">{name} <span className="chip" style={{ marginLeft: 6, textTransform: 'capitalize' }}>{member.role}</span></div>
        <div className="s">{member.email}{on ? ` · field work on${seat.rate ? ` · $${seat.rate}/hr` : ''}` : ''}</div>
      </div>
      {on ? (
        <button className="btn ghost sm" disabled={busy} onClick={async () => { setBusy(true); await onDisable(); setBusy(false); }}>Turn off</button>
      ) : (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ color: 'var(--text-dim)' }}>$</span>
          <input style={{ ...salInput, width: 66 }} type="number" min="0" step="0.25" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="rate" />
          <button className="btn grad sm" disabled={busy} onClick={async () => { setBusy(true); await onEnable(name, rate === '' ? null : parseFloat(rate)); setBusy(false); }}>Enable field work</button>
        </div>
      )}
    </div>
  );
}

const salInput = { background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, padding: 9, borderRadius: 9 };
function RateEditor({ initial, onSave, onCancel }) {
  const [rate, setRate] = useState(initial ? String(initial) : '');
  const ok = parseFloat(rate) >= 0 && rate !== '';
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', background: 'var(--surface-2)', padding: 10, borderRadius: 10 }}>
      <span className="field-label" style={{ margin: 0 }}>Hourly rate</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ color: 'var(--text-dim)' }}>$</span>
        <input style={{ ...salInput, width: 90 }} type="number" min="0" step="0.25" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="23" autoFocus />
        <span style={{ color: 'var(--text-dim)' }}>/hr</span>
      </div>
      <button className="btn grad sm" disabled={!ok} onClick={() => onSave(parseFloat(rate))}>Save</button>
      <button className="btn ghost sm" onClick={onCancel}>Cancel</button>
    </div>
  );
}
function SalaryEditor({ initial, onSave, onCancel }) {
  const [amount, setAmount] = useState(initial?.amount || '');
  const [period, setPeriod] = useState(initial?.period || 'year');
  const ok = parseFloat(amount) > 0;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', background: 'var(--surface-2)', padding: 10, borderRadius: 10 }}>
      <span className="field-label" style={{ margin: 0 }}>Salary</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ color: 'var(--text-dim)' }}>$</span>
        <input style={{ ...salInput, width: 110 }} type="number" min="0" step="1000" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="65000" autoFocus />
      </div>
      <select style={salInput} value={period} onChange={(e) => setPeriod(e.target.value)}>
        {SALARY_PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <button className="btn grad sm" disabled={!ok} onClick={() => onSave({ amount: parseFloat(amount), period })}>Save</button>
      {initial && <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => onSave(null)}>To hourly</button>}
      <button className="btn ghost sm" onClick={onCancel}>Cancel</button>
    </div>
  );
}
