import { useState, useMemo } from 'react';
import { fmtMoneyC } from '../lib/rollups.js';
import { isConfigured, signedFileUrl, scanReceipt } from '../lib/backend/supabase.js';
import { IcClip, IcCheck, IcX, IcReceipt } from '../components/ui.jsx';

// read a File into a base64 data: URL for the OCR call
function fileToDataUrl(f) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(f);
  });
}

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
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState(null);   // { kind:'err'|'ok', text }
  const [flags, setFlags] = useState([]);          // AI price-match flags

  const openWos = useMemo(() => workOrders.filter((w) => w.status === 'open' || w.status === 'in_progress'), [workOrders]);
  const pending = purchases.filter((p) => p.status === 'pending');
  const decided = purchases.filter((p) => p.status !== 'pending');
  const approvedTotal = purchases.filter((p) => p.status === 'approved').reduce((a, p) => a + (p.amount || 0), 0);

  const save = async () => {
    setBusy(true);
    try { await addPurchase({ ...draft, amount: parseFloat(draft.amount) }, file); reset(); }
    finally { setBusy(false); }
  };

  const reset = () => { setDraft(null); setFile(null); setScanMsg(null); setFlags([]); };

  // pick a receipt photo, read it with Claude, prefill the form
  const onPickReceipt = async (f) => {
    setFile(f || null);
    setScanMsg(null); setFlags([]);
    if (!f || !isConfigured()) return;
    setScanning(true);
    try {
      const dataUrl = await fileToDataUrl(f);
      const r = await scanReceipt(dataUrl, f.type || 'image/jpeg');
      setDraft((d) => ({
        ...d,
        vendor: r.vendor || d.vendor,
        amount: r.total ? String(r.total) : d.amount,
        note: d.note || (r.lineItems?.length ? r.lineItems.map((li) => li.description).slice(0, 3).join(', ') : ''),
        category: r.category || d.category,
        date: r.date || d.date,
      }));
      setFlags(r.priceFlags || []);
      setScanMsg({ kind: 'ok', text: `Read ${r.lineItems?.length || 0} line items${r.priceFlags?.length ? ` · ${r.priceFlags.length} price flag${r.priceFlags.length > 1 ? 's' : ''}` : ''}` });
    } catch (e) {
      setScanMsg({ kind: 'err', text: e.message || 'Could not read receipt' });
    } finally {
      setScanning(false);
    }
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
        <button className="btn grad" style={{ marginBottom: 'var(--gap)' }} onClick={() => setDraft({ vendor: '', amount: '', note: '', category: '', date: '' })}>
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
          <div className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <IcReceipt width={12} height={12} /> Receipt photo {isConfigured() && <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>— we read it for you</span>}
          </div>
          <input type="file" accept="image/*" capture="environment" onChange={(e) => onPickReceipt(e.target.files[0] || null)}
            style={{ ...inputStyle, padding: 9 }} />
          {file && <p className="note" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 5 }}><IcClip width={12} height={12} /> {file.name}</p>}
          {scanning && <p className="note" style={{ marginTop: 6 }}>◐ Reading receipt with AI…</p>}
          {scanMsg && <p className="note" style={{ marginTop: 6, color: scanMsg.kind === 'err' ? 'var(--danger)' : 'var(--money)' }}>{scanMsg.text}</p>}
          {!isConfigured() && <p className="note" style={{ marginTop: 6 }}>Photo uploads and AI receipt reading activate once connected to the cloud.</p>}

          {flags.length > 0 && (
            <div className="card" style={{ marginTop: 12, borderColor: '#ffb02033', background: 'var(--surface-2)' }}>
              <span className="field-label" style={{ color: 'var(--warn)' }}>Price check — review before approving</span>
              {flags.map((f, i) => (
                <div className="note" key={i} style={{ margin: '4px 0 0' }}>
                  <b>{f.item}</b> — paid <span className="mono money">{fmtMoneyC(f.paid || 0)}</span>
                  {f.typical ? <> · typical ~<span className="mono">{fmtMoneyC(f.typical)}</span></> : null}
                  {f.note ? ` · ${f.note}` : ''}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="btn ghost" style={{ flex: 1 }} onClick={reset}>Cancel</button>
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
            <button className="btn ghost sm icon-btn" style={{ color: 'var(--money)' }} onClick={() => setPurchaseStatus(p.id, 'approved')} aria-label="Approve"><IcCheck width={15} height={15} /></button>
            <button className="btn ghost sm icon-btn" style={{ color: 'var(--danger)' }} onClick={() => setPurchaseStatus(p.id, 'rejected')} aria-label="Reject"><IcX width={15} height={15} /></button>
          </>
        )}
      </div>
    </div>
  );
}
