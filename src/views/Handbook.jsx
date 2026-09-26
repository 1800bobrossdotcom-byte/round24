import { useMemo, useState, useEffect } from 'react';
import { normalizeSections, templateSections, hasContent } from '../lib/handbook.js';
import { useAuth } from '../components/AuthGate.jsx';
import OrgLogo from '../components/OrgLogo.jsx';
import { Mark, IcBuilding } from '../components/ui.jsx';

const isLand = (u) => u.type === 'land' || u.status === 'held';
let _newId = 0; // draft-only section ids (React keys); real ids assigned on save/normalize
const inp = { width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, padding: 9, borderRadius: 3 };

// Building Handbook — a branded, per-building digital manual. Staff author it in
// Edit; the Reader is what a resident/tenant sees. (Residents also get a
// read-only copy in their Community home.)
export default function Handbook({ store }) {
  const { handbooks = [], saveHandbook, leasing = [] } = store;
  const { role, orgName, theme } = useAuth();
  const canEdit = role === 'admin' || role === 'manager';

  const buildings = useMemo(() => {
    const set = new Set(handbooks.map((h) => h.building));
    leasing.filter((u) => !isLand(u) && u.building).forEach((u) => set.add(u.building));
    return [...set].sort();
  }, [handbooks, leasing]);

  // land on a building that already has a handbook, else the first building
  const [building, setBuilding] = useState(() => handbooks[0]?.building || buildings[0] || '');
  const active = buildings.includes(building) ? building : buildings[0] || '';
  const current = useMemo(() => handbooks.find((h) => h.building === active) || null, [handbooks, active]);
  const sections = useMemo(() => normalizeSections(current?.sections || []), [current]);

  const [mode, setMode] = useState('reader'); // 'reader' | 'edit'
  const [draft, setDraft] = useState([]);
  // load the draft whenever the building or its saved content changes
  useEffect(() => { setDraft(current ? (current.sections || []).map((s) => ({ ...s })) : []); }, [active, current]);

  const dset = (i, k, v) => setDraft((d) => d.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const addSection = () => setDraft((d) => [...d, { id: `new_${(_newId += 1)}`, icon: '📄', title: '', body: '' }]);
  const removeSection = (i) => setDraft((d) => d.filter((_, j) => j !== i));
  const move = (i, dir) => setDraft((d) => { const j = i + dir; if (j < 0 || j >= d.length) return d; const c = [...d]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  const startTemplate = () => setDraft(templateSections());
  const save = () => { saveHandbook(active, normalizeSections(draft)); setMode('reader'); };

  if (buildings.length === 0) {
    return (
      <div>
        <div className="view-head"><h1>Building handbook</h1><p>A branded, per-building manual your residents and tenants can actually use.</p></div>
        <div className="card"><p className="note">Add a building to your rent roll first — then you can author its handbook here.</p></div>
      </div>
    );
  }

  const segBtn = (val, label) => (
    <button onClick={() => setMode(val)} className={mode === val ? 'on' : ''}>{label}</button>
  );

  return (
    <div>
      <div className="view-head no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1>Building handbook</h1>
          <p>The one place a resident or tenant finds who to call, the rules, what to do in an emergency, and how the building runs — branded to your office.</p>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div className="seg">{segBtn('reader', 'Reader')}{segBtn('edit', 'Edit')}</div>
            {mode === 'reader' && <button className="btn ghost" onClick={() => window.print()} style={{ width: 'auto' }}>Print</button>}
          </div>
        )}
      </div>

      <div className="card no-print" style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 240px' }}>
          <div className="field-label">Building</div>
          <select value={active} onChange={(e) => setBuilding(e.target.value)}
            style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 15, padding: 10, borderRadius: 3 }}>
            {buildings.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        {current?.updatedAt && <span className="note" style={{ paddingBottom: 6 }}>Updated {new Date(current.updatedAt).toLocaleDateString()}</span>}
      </div>

      {mode === 'edit' && canEdit ? (
        <div>
          {draft.length === 0 && (
            <div className="card" style={{ textAlign: 'center' }}>
              <p className="note" style={{ marginBottom: 12 }}>No handbook for {active} yet.</p>
              <button className="btn grad" style={{ width: 'auto' }} onClick={startTemplate}>Start from a template</button>
              <button className="btn ghost" style={{ width: 'auto', marginLeft: 8 }} onClick={addSection}>Add a blank section</button>
            </div>
          )}
          {draft.map((s, i) => (
            <div className="card" key={s.id || i} style={{ display: 'grid', gridTemplateColumns: '58px 1fr', gap: 12 }}>
              <div>
                <div className="field-label" style={{ marginTop: 0 }}>Icon</div>
                <input style={{ ...inp, textAlign: 'center', padding: 8 }} value={s.icon || ''} onChange={(e) => dset(i, 'icon', e.target.value)} maxLength={4} />
              </div>
              <div>
                <input style={{ ...inp, fontWeight: 700, fontSize: 15 }} value={s.title} onChange={(e) => dset(i, 'title', e.target.value)} placeholder="Section title" />
                <textarea style={{ ...inp, marginTop: 8, minHeight: 84, resize: 'vertical', lineHeight: 1.5 }} value={s.body} onChange={(e) => dset(i, 'body', e.target.value)} placeholder="What a resident or tenant needs to know…" />
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button className="btn ghost sm" style={{ width: 'auto' }} onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                  <button className="btn ghost sm" style={{ width: 'auto' }} onClick={() => move(i, 1)} disabled={i === draft.length - 1}>↓</button>
                  <span style={{ flex: 1 }} />
                  <button className="btn ghost sm" style={{ width: 'auto', color: 'var(--danger)' }} onClick={() => removeSection(i)}>Remove</button>
                </div>
              </div>
            </div>
          ))}
          {draft.length > 0 && (
            <div style={{ display: 'flex', gap: 10, marginTop: 4, alignItems: 'center' }}>
              <button className="btn ghost" style={{ width: 'auto' }} onClick={addSection}>+ Add section</button>
              <span style={{ flex: 1 }} />
              <button className="btn grad" style={{ width: 'auto' }} onClick={save}>Save handbook</button>
            </div>
          )}
        </div>
      ) : (
        <div className="hb-reader">
          <div className="print-title" style={{ display: 'none' }}>{active} — Building Handbook</div>
          <div className="hb-cover">
            <OrgLogo logo={theme?.logo} name={orgName} height={38}
              fallback={<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Mark style={{ width: 30, height: 30 }} /><span style={{ fontWeight: 800, fontSize: 18 }}>Round24</span></span>} />
            <div className="hb-cover-t"><IcBuilding width={15} height={15} style={{ verticalAlign: -2, marginRight: 6 }} />{active}</div>
            <div className="hb-cover-s">Building Handbook</div>
          </div>
          {!hasContent(sections) ? (
            <div className="card"><p className="note">No handbook for {active} yet.{canEdit ? ' Switch to Edit to create one.' : ''}</p></div>
          ) : sections.map((s) => (
            <section className="hb-sec" key={s.id}>
              <h2>{s.icon && <span className="hb-ic">{s.icon}</span>}{s.title}</h2>
              {s.body.split('\n').filter(Boolean).map((line, k) => <p key={k}>{line}</p>)}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
