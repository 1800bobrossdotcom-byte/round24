import { useMemo, useState } from 'react';
import { fmtMoney, fmtHrs, cost } from '../lib/rollups.js';
import { IcX } from './ui.jsx';

// click-to-allocate: assign unallocated imported hours to a building (+ optional
// category / unit / note) so they move out of the amber pile and into true cost.
const CATS = ['plumbing', 'electrical', 'hvac', 'painting', 'turn', 'appliance', 'general'];

const inputStyle = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)',
  color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, padding: 10, borderRadius: 10,
};

export default function AllocateModal({ store, onClose }) {
  const { timers, properties, techById, allocateImported } = store;
  const unalloc = useMemo(() => timers.filter((t) => !t.propId), [timers]);

  const [sel, setSel] = useState(() => new Set(unalloc.map((t) => t.id)));
  const [building, setBuilding] = useState('');
  const [newBuilding, setNewBuilding] = useState('');
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState('');
  const [note, setNote] = useState('');

  const label = building === '__new__' ? newBuilding.trim() : building;
  const selList = unalloc.filter((t) => sel.has(t.id));
  const selCost = selList.reduce((a, t) => a + cost(t), 0);
  const canApply = label && sel.size > 0;

  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = sel.size === unalloc.length && unalloc.length > 0;
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(unalloc.map((t) => t.id)));

  const apply = () => {
    if (!canApply) return;
    allocateImported([...sel], { propLabel: label, category: category || undefined, unit: unit || undefined, note: note || undefined });
    // anything left unallocated stays open; if we cleared them all, close
    if (sel.size >= unalloc.length) onClose();
    else { setSel(new Set()); setBuilding(''); setNewBuilding(''); setUnit(''); setNote(''); }
  };

  return (
    <div className="sheet-backdrop alloc-backdrop" onClick={onClose}>
      <div className="alloc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="alloc-head">
          <div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>Allocate hours</div>
            <div className="note" style={{ margin: 0 }}>Assign these to a building so they count toward true cost</div>
          </div>
          <button className="btn ghost sm icon-btn" onClick={onClose} aria-label="Close"><IcX width={16} height={16} /></button>
        </div>

        {unalloc.length === 0 ? (
          <p className="note" style={{ padding: '20px 0' }}>Nothing unallocated — every hour is assigned to a building.</p>
        ) : (
          <>
            {/* assignment controls */}
            <div className="alloc-controls">
              <div>
                <div className="field-label">Building</div>
                <select style={inputStyle} value={building} onChange={(e) => setBuilding(e.target.value)}>
                  <option value="">— pick building —</option>
                  {properties.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                  <option value="__new__">＋ New building…</option>
                </select>
                {building === '__new__' && (
                  <input style={{ ...inputStyle, marginTop: 8 }} value={newBuilding} onChange={(e) => setNewBuilding(e.target.value)} placeholder="e.g. 379 S Main" autoFocus />
                )}
              </div>
              <div className="grid g2" style={{ marginTop: 10 }}>
                <div>
                  <div className="field-label">Category</div>
                  <select style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="">— keep as-is —</option>
                    {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <div className="field-label">Unit</div>
                  <input style={inputStyle} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="optional" />
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <div className="field-label">Notes</div>
                <input style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} placeholder="what these hours were for (optional)" />
              </div>
            </div>

            {/* entry list */}
            <div className="alloc-list-head">
              <button className="btn ghost sm" onClick={toggleAll}>{allSelected ? 'Clear' : 'Select all'}</button>
              <span className="note" style={{ margin: 0 }}>{sel.size} of {unalloc.length} · {fmtMoney(selCost)}</span>
            </div>
            <div className="alloc-list">
              {unalloc.map((t) => (
                <label className={'alloc-row' + (sel.has(t.id) ? ' on' : '')} key={t.id}>
                  <input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} />
                  <div className="lead">
                    <div className="t">{techById[t.techId]?.name || 'Operator'} · {t.date}</div>
                    <div className="s">{fmtHrs(t.durationHrs)}h · {t.category}{t.issue && t.issue !== 'imported from pay log' ? ` · ${t.issue}` : ''}</div>
                  </div>
                  <div className="val mono money">{fmtMoney(cost(t))}</div>
                </label>
              ))}
            </div>

            <button className="btn grad" style={{ marginTop: 14 }} onClick={apply} disabled={!canApply}>
              {canApply ? `Allocate ${sel.size} ${sel.size === 1 ? 'entry' : 'entries'} → ${label}` : 'Pick a building & entries'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
