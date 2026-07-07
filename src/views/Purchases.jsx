import { useState, useMemo } from 'react';
import { fmtMoneyC } from '../lib/rollups.js';
import { isConfigured, signedFileUrl } from '../lib/backend/supabase.js';

// crew: submit material purchases with a receipt photo → office approves.
// materials land on the same job-cost spine as labor.
const STATUS_COLORS = { pending: 'var(--warn)', approved: 'var(--money)', rejected: 'var(--danger)' };

const inputStyle = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)',
  color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, padding: 11, borderRadius: 10,
};

export default function Purchases({ store }) {
  const { purchases, addPurchase, setPurchaseStatus, properties, workOrders, role, purBackend } = store;
  const isStaff = role === 'admin' || role === 'manager';
  const [draft, setDraft] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  const openWos = useMemo(() => workOrders.filter((w) => w.status === 'open' || w.status === 'in_progress'), [workOrders]);
  const pending = purchases.filter((p) => p.status === 'pending');
  const decided = purchases.filter((p) => p.status !== 'pending');
  const approvedTotal = purchases.filter((p) => p.status === 'approved').reduce((a, p) => a + (p.amount || 0), 0);

  const save = async () => {
    setBusy(true);
    try { await addPurchase({ ...draft, amount: parseFloat(draft.amount) }, file); setDraft(null); setFile(null); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div className="view-head">
        <h1>Purchases</h1>
        <p>{isStaff ? 'Material spend, receipt-backed — approve to add it to job cost' : 'Bought materials? Snap the receipt, get reimbursed'}</p>
      </div>

      {purBackend === 'local' && (
        <div className="offline">◐ Stored on this device — syncs to the cloud once the purchases migration is applied.</div>
      )}

      {isStaff && (
        <div className="grid g3" style={{ marginBottom: 'var(--gap)' }}>
          <div className="card"><div className="stat"><span className="k">Approved spend</span><span className="v mono sm money">{fmtMoneyC(approvedTotal)}</span></div></div>
          <div className="card"><div className="stat"><span className="k">Awaiting review</span><span className="v mono sm">{pending.length}</span></div></div>
          <div className="card"><div className="stat"><span className="k">Receipts</span><span className="v mono sm">{purchases.length}</span></div></div>
        </div>
      )}

      {!draft && (
        <button className="btn grad" style={{ marginBottom: 'var(--gap)' }} onClick={() => setDraft({ vendor: '', amount: '', note: '' })}>
          + New purchase
        </button>
      )}

      {draft && (
        <div className="card" style={{ marginBottom: 'var(--gap)' }}>
          <span className="field-label">New purchase</span>
          <div className="grid g2" style={{ marginTop: 8 }}>
            <div>
              <div className="field-label">Vendor</div>
              <input style={inputStyle} value={draft.vendor} onChange={(e) => setDraft({ ...draft, vendor: e.target.value })} placeholder="Home Depot" />
            </div>
            <div>
              <div className="field-label">Amount</div>
              <input style={inputStyle} type="number" step="0.01" inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} placeholder="0.00" />
            </div>
            <div>
              <div className="field-label">Property</div>
              <select style={inputStyle} value={draft.propLabel || ''} onChange={(e) => setDraft({ ...draft, propLabel: e.target.value || null })}>
                <option value="">— pick property —</option>
                {properties.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <div className="field-label">Work order (optional)</div>
              <select style={inputStyle} value={draft.workOrderId || ''} onChange={(e) => setDraft({ ...draft, workOrderId: e.target.value || null })}>
                <option value="">— none —</option>
                {openWos.map((w) => <option key={w.id} value={w.id}>{w.task}</option>)}
              </select>
            </div>
          </div>
          <div style={{ height: 12 }} />
          <div className="field-label">Note</div>
          <input style={inputStyle} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="what it was for" />
          <div style={{ height: 12 }} />
          <div className="field-label">Receipt photo</div>
          <input type="file" accept="image/*" capture="environment" onChange={(e) => setFile(e.target.files[0] || null)}
            style={{ ...inputStyle, padding: 9 }} />
          {file && <p className="note" style={{ marginTop: 6 }}>📎 {file.name}</p>}
          {!isConfigured() && <p className="note" style={{ marginTop: 6 }}>Photo uploads activate once connected to the cloud.</p>}

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="btn ghost" style={{ flex: 1 }} onClick={() => { setDraft(null); setFile(null); }}>Cancel</button>
            <button className="btn grad" style={{ flex: 2 }} onClick={save} disabled={busy || !(parseFloat(draft.amount) > 0)}>
              {busy ? 'Saving…' : 'Submit purchase'}
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <span className="field-label">{isStaff ? `Awaiting review (${pending.length})` : `Submitted (${pending.length})`}</span>
        {pending.length === 0 && <p className="note">Nothing pending.</p>}
        {pending.map((p) => <PurRow key={p.id} p={p} isStaff={isStaff} setPurchaseStatus={setPurchaseStatus} />)}
      </div>

      {decided.length > 0 && (
        <div className="card" style={{ marginTop: 'var(--gap)' }}>
          <span className="field-label">History ({decided.length})</span>
          {decided.map((p) => <PurRow key={p.id} p={p} isStaff={isStaff} setPurchaseStatus={setPurchaseStatus} decided />)}
        </div>
      )}
    </div>
  );
}

function PurRow({ p, isStaff, setPurchaseStatus, decided }) {
  const [receiptUrl, setReceiptUrl] = useState(null);
  const viewReceipt = async () => {
    try { const url = await signedFileUrl('receipts', p.receiptPath); window.open(url, '_blank'); }
    catch { setReceiptUrl('err'); }
  };
  return (
    <div className="row">
      <div className="lead">
        <div className="t">{p.vendor || 'Purchase'} — <span className="mono money">{fmtMoneyC(p.amount || 0)}</span></div>
        <div className="s">
          {[p.propLabel, p.note, p.submittedBy && `by ${p.submittedBy}`, new Date(p.createdAt).toLocaleDateString()].filter(Boolean).join(' · ')}
          {p.receiptPath && <> · <a onClick={viewReceipt} style={{ color: 'var(--info)', cursor: 'pointer' }}>receipt</a></>}
          {receiptUrl === 'err' && ' (unavailable)'}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span className="chip" style={{ color: STATUS_COLORS[p.status] }}>{p.status}</span>
        {isStaff && !decided && (
          <>
            <button className="btn ghost sm" style={{ color: 'var(--money)' }} onClick={() => setPurchaseStatus(p.id, 'approved')}>✓</button>
            <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => setPurchaseStatus(p.id, 'rejected')}>✕</button>
          </>
        )}
      </div>
    </div>
  );
}
