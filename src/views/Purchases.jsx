import { useState, useMemo } from 'react';
import { fmtMoneyC } from '../lib/rollups.js';
import { isConfigured, signedFileUrl, scanReceipt, checkStock } from '../lib/backend/supabase.js';
import { IcClip, IcCheck, IcX, IcReceipt, IcSparkle, IcActivity, IcCreditCard } from '../components/ui.jsx';

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
  const { purchases, addPurchase, setPurchaseStatus, properties, workOrders, role, purBackend,
    cards, addCard, removeCard, matchCard } = store;
  const isStaff = role === 'admin' || role === 'manager';
  const [showCards, setShowCards] = useState(false);
  const [matched, setMatched] = useState(null); // {card, via last4}
  const [draft, setDraft] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState(null);   // { kind:'err'|'ok', text }
  const [flags, setFlags] = useState([]);          // AI price-match flags
  const [items, setItems] = useState([]);          // itemized line items from scan
  const [stock, setStock] = useState(null);        // [{name, availability, source, eta, note}]
  const [stockBusy, setStockBusy] = useState(false);
  const [stockErr, setStockErr] = useState(null);

  const openWos = useMemo(() => workOrders.filter((w) => w.status === 'open' || w.status === 'in_progress'), [workOrders]);
  const pending = purchases.filter((p) => p.status === 'pending');
  const decided = purchases.filter((p) => p.status !== 'pending');
  const approvedTotal = purchases.filter((p) => p.status === 'approved').reduce((a, p) => a + (p.amount || 0), 0);

  const save = async () => {
    setBusy(true);
    try { await addPurchase({ ...draft, amount: parseFloat(draft.amount), lineItems: items.length ? items : undefined }, file); reset(); }
    finally { setBusy(false); }
  };

  const reset = () => { setDraft(null); setFile(null); setScanMsg(null); setFlags([]); setItems([]); setStock(null); setStockErr(null); setMatched(null); };

  const runStock = async () => {
    setStockErr(null); setStockBusy(true);
    try { setStock(await checkStock(items.map((li) => ({ description: li.description, qty: li.qty })), draft?.propLabel || null)); }
    catch (e) { setStockErr(e.message || 'Could not check stock'); }
    finally { setStockBusy(false); }
  };

  // pick a receipt photo, read it with Claude, prefill the form
  const onPickReceipt = async (f) => {
    setFile(f || null);
    setScanMsg(null); setFlags([]); setMatched(null);
    if (!f || !isConfigured()) return;
    setScanning(true);
    try {
      const dataUrl = await fileToDataUrl(f);
      const r = await scanReceipt(dataUrl, f.type || 'image/jpeg');
      // auto-file to a property by the card used, if we know that card
      const card = r.cardLast4 ? matchCard(r.cardLast4) : null;
      if (card) setMatched({ propLabel: card.propLabel, last4: r.cardLast4 });
      setDraft((d) => ({
        ...d,
        vendor: r.vendor || d.vendor,
        amount: r.total ? String(r.total) : d.amount,
        note: d.note || (r.lineItems?.length ? r.lineItems.map((li) => li.description).slice(0, 3).join(', ') : ''),
        category: r.category || d.category,
        date: r.date || d.date,
        propLabel: card ? card.propLabel : (d.propLabel || null),
      }));
      setFlags(r.priceFlags || []);
      setItems(r.lineItems || []);
      setStock(null); setStockErr(null);
      const parts = [`Read ${r.lineItems?.length || 0} line items`];
      if (r.priceFlags?.length) parts.push(`${r.priceFlags.length} price flag${r.priceFlags.length > 1 ? 's' : ''}`);
      if (card) parts.push(`auto-filed to ${card.propLabel} via card ••${r.cardLast4}`);
      else if (r.cardLast4) parts.push(`card ••${r.cardLast4} (unregistered)`);
      setScanMsg({ kind: 'ok', text: parts.join(' · ') });
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
        <div style={{ marginBottom: 'var(--gap)' }}>
          <button className="btn ghost sm" onClick={() => setShowCards((v) => !v)}>
            <IcCreditCard width={14} height={14} /> Property cards {cards.length > 0 ? `(${cards.length})` : ''}
          </button>
          {showCards && <CardManager cards={cards} properties={properties} addCard={addCard} removeCard={removeCard} />}
        </div>
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
              <div className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>Property {matched && <span className="chip" style={{ color: 'var(--money)' }}><IcCreditCard width={11} height={11} /> card ••{matched.last4}</span>}</div>
              <select style={{ ...inputStyle, ...(matched ? { borderColor: 'var(--money)' } : null) }} value={draft.propLabel || ''} onChange={(e) => { setDraft({ ...draft, propLabel: e.target.value || null }); setMatched(null); }}>
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

          {items.length > 0 && (
            <div className="itemize">
              <div className="itemize-head">
                <span className="field-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}><IcSparkle width={13} height={13} /> Itemized · {items.length} {items.length === 1 ? 'item' : 'items'}</span>
                <span className="mono money" style={{ fontWeight: 700 }}>{fmtMoneyC(items.reduce((a, li) => a + (li.amount || 0), 0))}</span>
              </div>
              {items.map((li, i) => {
                const flagged = flags.find((f) => f.item && li.description && f.item.toLowerCase().includes(li.description.toLowerCase().slice(0, 8)));
                const s = stock?.[i];
                return (
                  <div className="item-row" key={i}>
                    <div className="ir-main">
                      <div className="ir-desc">{li.description}{flagged && <span className="chip warn sm" style={{ marginLeft: 6 }}>over</span>}</div>
                      <div className="ir-sub">{li.qty || 1} × {fmtMoneyC(li.unitPrice || 0)}{s && <> · <span className={'avail ' + s.availability}>{s.availability === 'pickup' ? 'Pickup' : 'Order'} · {s.source}{s.eta ? ` · ${s.eta}` : ''}</span></>}</div>
                    </div>
                    <div className="ir-amt mono money">{fmtMoneyC(li.amount || 0)}</div>
                  </div>
                );
              })}
              <div className="itemize-foot">
                {stock ? (
                  <span className="note" style={{ margin: 0 }}>
                    <b style={{ color: 'var(--money)' }}>{stock.filter((s) => s.availability === 'pickup').length} pickup</b> · <b style={{ color: 'var(--warn)' }}>{stock.filter((s) => s.availability === 'order').length} to order</b>
                  </span>
                ) : <span className="note" style={{ margin: 0 }}>Check what's in stock locally vs needs ordering</span>}
                <button className="btn ghost sm" onClick={runStock} disabled={stockBusy || !isConfigured()}>
                  <IcActivity width={13} height={13} /> {stockBusy ? 'Checking…' : stock ? 'Re-check stock' : 'Check local stock'}
                </button>
              </div>
              {stockErr && <p className="note" style={{ color: 'var(--danger)', margin: '6px 0 0' }}>{stockErr}</p>}
            </div>
          )}

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

// register each property's card so receipts auto-file by the card's last 4
function CardManager({ cards, properties, addCard, removeCard }) {
  const [last4, setLast4] = useState('');
  const [brand, setBrand] = useState('');
  const [propLabel, setPropLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => { setBusy(true); try { await addCard({ last4, brand, propLabel }); setLast4(''); setBrand(''); setPropLabel(''); } finally { setBusy(false); } };
  const ok = last4.replace(/\D/g, '').length === 4 && propLabel;
  return (
    <div className="card" style={{ marginTop: 8 }}>
      <span className="field-label">Cards on file — receipts auto-file to the matching building</span>
      {cards.length === 0 && <p className="note">No cards yet. Add each building's card so a scanned receipt files itself.</p>}
      {cards.map((c) => (
        <div className="row" key={c.id}>
          <div className="lead">
            <div className="t"><IcCreditCard width={13} height={13} style={{ verticalAlign: -2 }} /> {c.brand || 'Card'} ••{c.last4}</div>
            <div className="s">{c.propLabel}</div>
          </div>
          <button className="btn ghost sm icon-btn" style={{ color: 'var(--text-faint)' }} onClick={() => removeCard(c.id)} aria-label="Remove"><IcX width={14} height={14} /></button>
        </div>
      ))}
      <div className="grid g3" style={{ marginTop: 10, gap: 8 }}>
        <input style={{ ...inputStyle, padding: 9 }} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Last 4" inputMode="numeric" />
        <input style={{ ...inputStyle, padding: 9 }} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Visa (optional)" />
        <select style={{ ...inputStyle, padding: 9 }} value={propLabel} onChange={(e) => setPropLabel(e.target.value)}>
          <option value="">— building —</option>
          {properties.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
        </select>
      </div>
      <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={add} disabled={busy || !ok}>+ Add card</button>
    </div>
  );
}

function PurRow({ p, isStaff, setPurchaseStatus, decided }) {
  const [receiptUrl, setReceiptUrl] = useState(null);
  const [open, setOpen] = useState(false);
  const items = p.lineItems || [];
  const viewReceipt = async () => {
    // bundled sample receipts are plain URLs; uploaded ones are storage paths
    if (/^(\/|https?:)/.test(p.receiptPath)) { window.open(p.receiptPath, '_blank'); return; }
    try { const url = await signedFileUrl('receipts', p.receiptPath); window.open(url, '_blank'); }
    catch { setReceiptUrl('err'); }
  };
  return (
    <div className="pur-item">
      <div className="row">
        <div className="lead">
          <div className="t">{p.vendor || 'Purchase'} — <span className="mono money">{fmtMoneyC(p.amount || 0)}</span></div>
          <div className="s">
            {[p.propLabel, p.note, p.submittedBy && `by ${p.submittedBy}`, new Date(p.createdAt).toLocaleDateString()].filter(Boolean).join(' · ')}
            {p.receiptPath && <> · <a onClick={viewReceipt} style={{ color: 'var(--info)', cursor: 'pointer' }}>receipt</a></>}
            {items.length > 0 && <> · <a onClick={() => setOpen((o) => !o)} style={{ color: 'var(--accent)', cursor: 'pointer' }}>{open ? 'hide items' : `${items.length} items`}</a></>}
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
      {open && items.length > 0 && (
        <div className="pur-items">
          {items.map((li, i) => (
            <div className="pur-item-row" key={i}>
              <span className="pi-desc">{li.description}</span>
              <span className="pi-qty mono">{li.qty || 1} × {fmtMoneyC(li.unitPrice || 0)}</span>
              <span className="pi-amt mono money">{fmtMoneyC(li.amount || 0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
