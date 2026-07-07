import { useState, useRef, useMemo } from 'react';
import { parseWorkbook, toTimers } from '../lib/importParser.js';
import { fmtMoney, fmtHrs } from '../lib/rollups.js';
import { IcCheck, IcImport } from '../components/ui.jsx';

const STEPS = ['Upload', 'Select sheets', 'Review & assign', 'Done'];

// street-type words that don't identify a building on their own
const PROP_STOP = new Set(['st', 'street', 'ave', 'avenue', 'rd', 'road', 'dr', 'drive', 'ln', 'lane', 's', 'n', 'e', 'w', 'south', 'north', 'east', 'west', 'the', 'apt', 'unit']);

// build a matcher that resolves a row's text cells → a known building id.
// A row is "allocated" when its text names a building (by distinctive word
// or street number). Anything else is left for the uploader to fix.
function buildMatcher(properties) {
  const idx = properties.map((p) => ({
    id: p.id,
    num: (p.name.match(/^\d+/) || [])[0],
    words: p.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !PROP_STOP.has(w) && !/^\d+$/.test(w)),
  }));
  return (texts) => {
    if (!texts || !texts.length) return null;
    const hay = ' ' + texts.join(' ').toLowerCase() + ' ';
    let best = null, score = 0;
    for (const p of idx) {
      let s = p.words.filter((w) => hay.includes(w)).length;
      if (p.num && new RegExp(`\\b${p.num}\\b`).test(hay)) s += 2;
      if (s > score) { score = s; best = p; }
    }
    return score > 0 ? best.id : null;
  };
}

export default function Import({ store }) {
  const [step, setStep] = useState(0);
  const [sheets, setSheets] = useState([]);
  const [selected, setSelected] = useState([]);
  const [rates, setRates] = useState({}); // techName -> rate
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null);
  const fileRef = useRef();

  const handleFile = async (file) => {
    setErr(null);
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseWorkbook(buf);
      const withData = parsed.filter((s) => s.entryCount > 0);
      setSheets(parsed);
      setSelected(withData.filter((s) => s.looksPayLog).map((s) => s.name));
      // seed rates from any sane sheet rate
      const seed = {};
      for (const s of withData) {
        const r = s.entries.find((e) => e.rate)?.rate;
        if (r) seed[s.techName] = r;
      }
      setRates(seed);
      setStep(1);
    } catch (e) {
      setErr('Could not read that file. Make sure it\'s a .xlsx spreadsheet.');
    }
  };

  const toggle = (name) =>
    setSelected((s) => (s.includes(name) ? s.filter((n) => n !== name) : [...s, name]));

  // techs represented in selected sheets, and whether they need a rate
  const techsNeeding = useMemo(() => {
    const map = new Map();
    for (const s of sheets) {
      if (!selected.includes(s.name)) continue;
      const worked = s.entries.filter((e) => e.hours > 0);
      const noRate = worked.filter((e) => !e.rate).length;
      const cur = map.get(s.techName) || { name: s.techName, hours: 0, entries: 0, missing: 0 };
      cur.hours += worked.reduce((a, e) => a + e.hours, 0);
      cur.entries += worked.length;
      cur.missing += noRate;
      map.set(s.techName, cur);
    }
    return [...map.values()].sort((a, b) => b.hours - a.hours);
  }, [sheets, selected]);

  const matcher = useMemo(() => buildMatcher(store.properties), [store.properties]);

  // how many selected workdays are allocated to a building vs skipped
  const alloc = useMemo(() => {
    let allocated = 0, skipped = 0; const byProp = new Set();
    for (const s of sheets) {
      if (!selected.includes(s.name)) continue;
      for (const e of s.entries) {
        if (e.hours <= 0) continue;
        const pid = matcher(e.texts);
        if (pid) { allocated++; byProp.add(pid); } else skipped++;
      }
    }
    return { allocated, skipped, propCount: byProp.size };
  }, [sheets, selected, matcher]);

  const runImport = () => {
    // apply assigned rates onto entries missing them
    const patched = sheets.map((s) => ({
      ...s,
      entries: s.entries.map((e) => ({ ...e, rate: e.rate || rates[e.tech] || 0 })),
    }));
    const { timers, skipped } = toTimers(patched, selected, (e) => matcher(e.texts));
    const withRate = timers.filter((t) => t.rate > 0);
    const hrs = withRate.reduce((a, t) => a + t.durationHrs, 0);
    const cost = withRate.reduce((a, t) => a + t.durationHrs * t.rate, 0);
    const techCount = new Set(timers.map((t) => t.techName)).size;
    const propCount = new Set(timers.map((t) => t.propId)).size;
    store.addImported(timers);     // land it on the chart spine — Dashboard/Calendar/Team pick it up
    setResult({ count: timers.length, skipped, hrs, cost, techCount, propCount });
    setStep(3);
  };

  const totalMissing = techsNeeding.reduce((a, t) => a + t.missing, 0);
  const rateSet = techsNeeding.every((t) => rates[t.name] > 0);
  const canImport = rateSet && alloc.allocated > 0;

  return (
    <div>
      <div className="view-head">
        <h1>Import from Excel</h1>
        <p>Bring your existing pay logs in — nothing leaves your browser</p>
      </div>

      <div className="stepper">
        {STEPS.map((s, i) => (
          <div key={s} className={`st${i === step ? ' on' : ''}${i < step ? ' done' : ''}`}>
            <span className="n">{i < step ? <IcCheck width={12} height={12} /> : i + 1}</span><span className="lbl">{s}</span>
          </div>
        ))}
      </div>

      {err && <div className="offline" style={{ color: 'var(--danger)', borderColor: '#ff5a5a33', background: '#ff5a5a12' }}>{err}</div>}

      {/* STEP 0 — upload */}
      {step === 0 && (
        <>
          <div
            className={`dropzone${drag ? ' drag' : ''}`}
            onClick={() => fileRef.current.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
          >
            <div className="ic" style={{ color: 'var(--text-faint)', display: 'flex', justifyContent: 'center' }}><IcImport width={34} height={34} /></div>
            <div className="big">Drop your pay-log spreadsheet here</div>
            <div className="sm">or tap to browse · .xlsx files</div>
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={(e) => handleFile(e.target.files[0])} />
          <p className="note">Works with your real Evolution24 workbook — every pay-log tab, both formats. It reads hours, dates, pay periods, and rates, then shows you everything before saving a thing.</p>
        </>
      )}

      {/* STEP 1 — select sheets */}
      {step === 1 && (
        <>
          <p className="note" style={{ marginTop: 0, marginBottom: 14 }}>
            Found {sheets.filter((s) => s.entryCount > 0).length} sheets with data. We pre-selected the pay logs — uncheck anything you don't want.
          </p>
          {sheets.filter((s) => s.entryCount > 0).map((s) => (
            <div key={s.name} className={`sheet-card${selected.includes(s.name) ? ' sel' : ''}${!s.looksPayLog ? ' skip' : ''}`} onClick={() => toggle(s.name)}>
              <div className="cb">{selected.includes(s.name) ? <IcCheck width={14} height={14} /> : ''}</div>
              <div className="info">
                <div className="n">{s.techName}</div>
                <div className="m">{s.name}{!s.looksPayLog ? ' · not a pay log?' : ''}</div>
              </div>
              <div className="stat-mini">
                <div className="h">{fmtHrs(s.totalHours)}h</div>
                <div className="p">{s.entryCount} days</div>
              </div>
            </div>
          ))}
          <div className="wizard-actions">
            <button className="btn ghost" onClick={() => setStep(0)}>Back</button>
            <button className="btn grad" onClick={() => setStep(2)} disabled={!selected.length}>Continue ({selected.length})</button>
          </div>
        </>
      )}

      {/* STEP 2 — review & assign rates */}
      {step === 2 && (
        <>
          <div className="flagbar">
            <div className="flag-pill ok"><IcCheck width={13} height={13} /> {alloc.allocated} allocated to {alloc.propCount} {alloc.propCount === 1 ? 'building' : 'buildings'}</div>
            {alloc.skipped > 0
              ? <div className="flag-pill warn">! {alloc.skipped} rows with no building — will be skipped</div>
              : <div className="flag-pill ok"><IcCheck width={13} height={13} /> every row is allocated</div>}
            {totalMissing > 0 && <div className="flag-pill warn">! {totalMissing} missing a rate</div>}
          </div>

          {alloc.allocated === 0 && (
            <div className="offline" style={{ color: 'var(--danger)', borderColor: '#ff5a5a33', background: '#ff5a5a12' }}>
              No rows name a building. Caliper ingests allocated work only — add the property (name or street number) on each row in your sheet, then re-upload.
            </div>
          )}

          <div className="card">
            <span className="field-label">Confirm hourly rate per operator</span>
            <p className="note" style={{ marginTop: 4, marginBottom: 12 }}>
              Only rows allocated to a building are imported. Set each person's loaded rate so those hours become real cost.
            </p>
            {techsNeeding.map((t) => (
              <div className="assign-row" key={t.name}>
                <div className="who">{t.name}
                  <div className="cnt">{fmtHrs(t.hours)} hrs · {t.entries} days{t.missing > 0 ? ` · ${t.missing} need rate` : ''}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>$</span>
                  <input
                    className={rates[t.name] > 0 ? '' : 'need'}
                    type="number" step="0.5" placeholder="0.00"
                    value={rates[t.name] || ''}
                    onChange={(e) => setRates((r) => ({ ...r, [t.name]: parseFloat(e.target.value) || 0 }))}
                  />
                  <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>/hr</span>
                </div>
              </div>
            ))}
          </div>

          <div className="wizard-actions">
            <button className="btn ghost" onClick={() => setStep(1)}>Back</button>
            <button className="btn grad" onClick={runImport} disabled={!canImport}>
              {!rateSet ? 'Set all rates to continue' : alloc.allocated === 0 ? 'Nothing allocated to import' : `Import ${alloc.allocated} allocated`}
            </button>
          </div>
        </>
      )}

      {/* STEP 3 — done */}
      {step === 3 && result && (
        <>
          <div className="card" style={{ textAlign: 'center', padding: 30 }}>
            <div style={{ color: 'var(--money)', display: 'flex', justifyContent: 'center' }}><IcCheck width={38} height={38} /></div>
            <div className="v mono grad-text settle" style={{ fontSize: 34, fontWeight: 700, margin: '10px 0' }}>{result.count.toLocaleString()}</div>
            <div style={{ color: 'var(--text-dim)', fontWeight: 700 }}>work entries imported</div>
          </div>
          <div className="grid g4" style={{ marginTop: 'var(--gap)' }}>
            <div className="card"><div className="stat"><span className="k">Hours</span><span className="v mono sm">{fmtHrs(result.hrs)}</span></div></div>
            <div className="card"><div className="stat"><span className="k">Labor cost</span><span className="v mono sm money">{fmtMoney(result.cost)}</span></div></div>
            <div className="card"><div className="stat"><span className="k">Buildings</span><span className="v mono sm">{result.propCount}</span></div></div>
            <div className="card"><div className="stat"><span className="k">Operators</span><span className="v mono sm">{result.techCount}</span></div></div>
          </div>
          {result.skipped > 0 && (
            <div className="offline" style={{ marginTop: 'var(--gap)' }}>
              ! {result.skipped} rows had no building and were skipped. Add a property to those rows in your sheet and re-upload to include them.
            </div>
          )}
          <div className="offline" style={{ marginTop: 'var(--gap)', color: 'var(--money)', borderColor: '#4ade8033', background: '#4ade8012' }}>
            <IcCheck width={14} height={14} /> Allocated to buildings and live in your charts — every imported hour lands on a property. Check Dashboard, Calendar, and Properties.
          </div>
          <div className="wizard-actions">
            <button className="btn ghost" onClick={() => { setStep(0); setSheets([]); setSelected([]); setResult(null); }}>Import another file</button>
          </div>
        </>
      )}
    </div>
  );
}
