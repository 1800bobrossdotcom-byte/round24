import { useState, useMemo } from 'react';
import { IcBuilding, IcWrench, IcReceipt, IcCheck, IcX, IcTrash, IcChevron, IcSparkle } from '../components/ui.jsx';

// trades / categories a vendor can cover — used for chips + the add form
const TRADES = ['plumbing', 'electrical', 'hvac', 'doors', 'roofing', 'general', 'appliance', 'landscaping', 'paint', 'other'];
const tradeLabel = (t) => (t ? t[0].toUpperCase() + t.slice(1) : 'Other');
const money = (n) => (n == null || n === '' ? '—' : '$' + Number(n).toFixed(2));

// tidy a phone number as it's typed: strip the stray characters a numeric keypad
// leaves behind and format US 10-digit numbers as (585) 424-4710. A leading +
// (international) is left alone so those aren't mangled.
function formatPhone(raw) {
  const s = String(raw || '');
  if (s.trimStart().startsWith('+')) return s.replace(/\s+/g, ' ');
  let d = s.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);   // drop US country code
  d = d.slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

const inputStyle = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)',
  color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, padding: 9, borderRadius: 3,
};

function Stars({ n }) {
  const c = Math.max(0, Math.min(5, Math.round(Number(n) || 0))); // out-of-range/typed rating must never RangeError on .repeat
  if (!c) return null;
  return <span style={{ color: 'var(--warn)', fontSize: 12, letterSpacing: 1 }}>{'★'.repeat(c)}<span style={{ color: 'var(--line)' }}>{'★'.repeat(5 - c)}</span></span>;
}

function FavBtn({ on, onClick, label }) {
  return (
    <button onClick={onClick} title={on ? 'Unfavorite' : 'Favorite'} aria-label={label}
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: on ? 'var(--warn)' : 'var(--text-faint)', fontSize: 18, lineHeight: 1, padding: 2 }}>
      {on ? '★' : '☆'}
    </button>
  );
}

export default function Vendors({ store, navigate }) {
  const { vendors = [], vendorProducts = [], canEditVendors, canAddVendors = false,
    saveVendor, removeVendor, setVendorField, saveProduct, removeProduct, setProductField } = store;
  const [tab, setTab] = useState('vendors');     // vendors | products
  const [kind, setKind] = useState('all');       // all | contractor | supplier | favorite
  const [trade, setTrade] = useState('all');
  const [q, setQ] = useState('');
  const [editV, setEditV] = useState(null);      // vendor draft being added/edited
  const [editP, setEditP] = useState(null);      // product draft
  const [callNote, setCallNote] = useState(null); // { id, text } — logging a call against a vendor

  // open the work-order composer prefilled with this vendor's contact
  const woForVendor = (v) => navigate?.('wo', { newFor: {
    task: '', detail: `Vendor: ${v.name}${v.phone ? ` · ${v.phone}` : ''}${v.email ? ` · ${v.email}` : ''}`,
    category: v.trade && v.trade !== 'other' ? v.trade : 'general',
  } });
  // prepend a timestamped call note to the vendor's notes (office keeps the log)
  const saveCallNote = () => {
    const t = (callNote?.text || '').trim();
    const v = vendors.find((x) => x.id === callNote?.id);
    if (!t || !v) { setCallNote(null); return; }
    const stamp = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    setVendorField(v.id, { notes: `☎ ${stamp} — ${t}${v.notes ? `\n${v.notes}` : ''}` });
    setCallNote(null);
  };

  const vName = (id) => vendors.find((v) => v.id === id)?.name || '';

  const shownVendors = useMemo(() => {
    const query = q.trim().toLowerCase();
    return vendors
      .filter((v) => {
        if (kind === 'favorite') { if (!v.favorite) return false; }
        else if (kind !== 'all' && v.kind !== kind) return false;
        if (trade !== 'all' && v.trade !== trade) return false;
        if (query && !(`${v.name} ${v.trade} ${v.contactName} ${v.notes}`.toLowerCase().includes(query))) return false;
        return true;
      })
      .sort((a, b) => (Number(b.favorite) - Number(a.favorite)) || (a.name || "").localeCompare(b.name || ""));
  }, [vendors, kind, trade, q]);

  const shownProducts = useMemo(() => {
    const query = q.trim().toLowerCase();
    return vendorProducts
      .filter((p) => (kind === 'favorite' ? p.favorite : true))
      .filter((p) => (trade !== 'all' ? p.category === trade : true))
      .filter((p) => (query ? `${p.name} ${p.category} ${vName(p.vendorId)} ${p.notes}`.toLowerCase().includes(query) : true))
      .sort((a, b) => (Number(b.favorite) - Number(a.favorite)) || (a.name || "").localeCompare(b.name || ""));
  }, [vendorProducts, kind, trade, q, vendors]);

  const favCount = vendors.filter((v) => v.favorite).length + vendorProducts.filter((p) => p.favorite).length;

  const startVendor = () => setEditV({ name: '', kind: 'contractor', trade: 'plumbing', contactName: '', phone: '', email: '', website: '', license: '', rating: '', approved: canEditVendors, favorite: false, notes: '' });
  const startProduct = () => setEditP({ name: '', vendorId: '', category: 'plumbing', sku: '', price: '', url: '', favorite: true, notes: '' });
  const commitVendor = async () => { if (!editV.name.trim()) return; const r = editV.rating ? Math.max(1, Math.min(5, Math.round(Number(editV.rating)))) : null; await saveVendor({ ...editV, name: editV.name.trim(), rating: Number.isFinite(r) ? r : null }); setEditV(null); };
  const commitProduct = async () => { if (!editP.name.trim()) return; await saveProduct({ ...editP, name: editP.name.trim(), price: editP.price === '' ? null : Number(editP.price), vendorId: editP.vendorId || null }); setEditP(null); };

  return (
    <div>
      <div className="view-head">
        <h1>Vendors</h1>
        <p>Your approved rolodex — trusted contractors by trade, specialty suppliers, and the products you reorder. Shared across everyone in the workspace.</p>
      </div>

      {/* top controls */}
      <div className="seg" style={{ marginBottom: 10 }}>
        <button className={tab === 'vendors' ? 'on' : ''} onClick={() => { setTab('vendors'); setTrade('all'); }}>Contractors & suppliers</button>
        <button className={tab === 'products' ? 'on' : ''} onClick={() => { setTab('products'); setTrade('all'); }}>Favorite products {vendorProducts.length ? `(${vendorProducts.length})` : ''}</button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'vendors' ? 'Search vendors…' : 'Search products…'} style={{ ...inputStyle, flex: 1, minWidth: 160, maxWidth: 300 }} />
        {tab === 'vendors' && (
          <div className="rr-filters" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[['all', 'All'], ['contractor', 'Contractors'], ['supplier', 'Suppliers'], ['favorite', `★ Favorites${favCount ? ` (${favCount})` : ''}`]].map(([k, l]) => (
              <button key={k} className={'fchip' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>{l}</button>
            ))}
          </div>
        )}
        {(canEditVendors || (canAddVendors && tab === 'vendors')) && (
          <button className="btn grad sm" style={{ marginLeft: 'auto' }} onClick={() => (tab === 'vendors' ? startVendor() : startProduct())}>+ {tab === 'vendors' ? 'New vendor' : 'New product'}</button>
        )}
      </div>

      {/* trade filter chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        <button className={'fchip' + (trade === 'all' ? ' on' : '')} onClick={() => setTrade('all')}>All trades</button>
        {TRADES.map((t) => (
          <button key={t} className={'fchip' + (trade === t ? ' on' : '')} onClick={() => setTrade(t)}>{tradeLabel(t)}</button>
        ))}
      </div>

      {/* add/edit vendor form */}
      {editV && (
        <div className="card" style={{ marginBottom: 'var(--gap)', borderColor: 'var(--accent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="field-label" style={{ margin: 0 }}>{editV.id ? 'Edit vendor' : 'New vendor'}</span>
            <button className="btn ghost sm" onClick={() => setEditV(null)}><IcX width={13} height={13} /></button>
          </div>
          <div className="grid g2" style={{ gap: 10, marginTop: 10 }}>
            <div><div className="field-label">Name</div><input style={inputStyle} value={editV.name} onChange={(e) => setEditV({ ...editV, name: e.target.value })} placeholder="Rapids Plumbing Co." autoComplete="organization" autoCapitalize="words" enterKeyHint="next" /></div>
            <div><div className="field-label">Type</div>
              <select style={inputStyle} value={editV.kind} onChange={(e) => setEditV({ ...editV, kind: e.target.value })}>
                <option value="contractor">Contractor</option><option value="supplier">Supplier</option>
              </select></div>
            <div><div className="field-label">Trade / category</div>
              <select style={inputStyle} value={editV.trade} onChange={(e) => setEditV({ ...editV, trade: e.target.value })}>
                {TRADES.map((t) => <option key={t} value={t}>{tradeLabel(t)}</option>)}
              </select></div>
            <div><div className="field-label">Rating (1–5)</div><input style={inputStyle} type="number" min="1" max="5" inputMode="numeric" value={editV.rating} onChange={(e) => setEditV({ ...editV, rating: e.target.value })} placeholder="—" /></div>
            <div><div className="field-label">Contact</div><input style={inputStyle} value={editV.contactName} onChange={(e) => setEditV({ ...editV, contactName: e.target.value })} placeholder="Dave Marino" autoComplete="name" autoCapitalize="words" enterKeyHint="next" /></div>
            <div><div className="field-label">Phone</div><input style={inputStyle} type="tel" inputMode="tel" autoComplete="tel" enterKeyHint="next" value={editV.phone} onChange={(e) => setEditV({ ...editV, phone: formatPhone(e.target.value) })} placeholder="(585) 555-0311" /></div>
            <div><div className="field-label">Email</div><input style={inputStyle} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" value={editV.email} onChange={(e) => setEditV({ ...editV, email: e.target.value.replace(/\s+/g, '').toLowerCase() })} placeholder="orders@ferguson.com" /></div>
            <div><div className="field-label">Website</div><input style={inputStyle} inputMode="url" autoComplete="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={editV.website} onChange={(e) => setEditV({ ...editV, website: e.target.value })} placeholder="ferguson.com" /></div>
            <div><div className="field-label">License / insurance</div><input style={inputStyle} value={editV.license} onChange={(e) => setEditV({ ...editV, license: e.target.value })} placeholder="NY PL-44219 · insured" autoCapitalize="characters" /></div>
          </div>
          <div className="field-label" style={{ marginTop: 10 }}>Notes</div>
          <textarea style={{ ...inputStyle, minHeight: 54 }} value={editV.notes} onChange={(e) => setEditV({ ...editV, notes: e.target.value })} placeholder="Preferred for emergencies; trade pricing on file…" />
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            {canEditVendors ? (
              <>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={editV.approved} onChange={(e) => setEditV({ ...editV, approved: e.target.checked })} /> Approved</label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={editV.favorite} onChange={(e) => setEditV({ ...editV, favorite: e.target.checked })} /> Favorite</label>
              </>
            ) : (
              <span className="note" style={{ margin: 0, color: 'var(--text-faint)' }}>Submitted for office approval — it joins the directory once approved.</span>
            )}
            <button className="btn grad sm" style={{ marginLeft: 'auto' }} onClick={commitVendor} disabled={!editV.name.trim()}>{canEditVendors ? 'Save vendor' : 'Submit vendor'}</button>
          </div>
        </div>
      )}

      {/* add/edit product form */}
      {editP && (
        <div className="card" style={{ marginBottom: 'var(--gap)', borderColor: 'var(--accent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="field-label" style={{ margin: 0 }}>{editP.id ? 'Edit product' : 'New favorite product'}</span>
            <button className="btn ghost sm" onClick={() => setEditP(null)}><IcX width={13} height={13} /></button>
          </div>
          <div className="grid g2" style={{ gap: 10, marginTop: 10 }}>
            <div><div className="field-label">Product</div><input style={inputStyle} value={editP.name} onChange={(e) => setEditP({ ...editP, name: e.target.value })} placeholder="Moen 1225 cartridge" /></div>
            <div><div className="field-label">Vendor</div>
              <select style={inputStyle} value={editP.vendorId} onChange={(e) => setEditP({ ...editP, vendorId: e.target.value })}>
                <option value="">— none —</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select></div>
            <div><div className="field-label">Category</div>
              <select style={inputStyle} value={editP.category} onChange={(e) => setEditP({ ...editP, category: e.target.value })}>
                {TRADES.map((t) => <option key={t} value={t}>{tradeLabel(t)}</option>)}
              </select></div>
            <div><div className="field-label">Price</div><input style={inputStyle} type="number" step="0.01" value={editP.price} onChange={(e) => setEditP({ ...editP, price: e.target.value })} placeholder="24.97" /></div>
            <div><div className="field-label">SKU / model</div><input style={inputStyle} value={editP.sku} onChange={(e) => setEditP({ ...editP, sku: e.target.value })} /></div>
            <div><div className="field-label">Link</div><input style={inputStyle} value={editP.url} onChange={(e) => setEditP({ ...editP, url: e.target.value })} placeholder="https://…" /></div>
          </div>
          <div className="field-label" style={{ marginTop: 10 }}>Notes</div>
          <textarea style={{ ...inputStyle, minHeight: 44 }} value={editP.notes} onChange={(e) => setEditP({ ...editP, notes: e.target.value })} placeholder="Turnover standard; reorder in packs of 5…" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <button className="btn grad sm" onClick={commitProduct} disabled={!editP.name.trim()}>Save product</button>
          </div>
        </div>
      )}

      {/* vendor cards */}
      {tab === 'vendors' && (
        shownVendors.length === 0
          ? <div className="card"><p className="note">No vendors yet{q || kind !== 'all' || trade !== 'all' ? ' for this filter' : ''}. {canEditVendors && !q ? 'Add your first approved contractor or supplier.' : ''}</p></div>
          : <div className="grid g2" style={{ gap: 'var(--gap)' }}>
              {shownVendors.map((v) => (
                <div className="card" key={v.id} style={{ marginTop: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ color: v.kind === 'supplier' ? 'var(--info)' : 'var(--accent)', marginTop: 2 }}>{v.kind === 'supplier' ? <IcReceipt width={18} height={18} /> : <IcWrench width={18} height={18} />}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 800, fontSize: 15 }}>{v.name}</span>
                        {v.approved
                          ? <span className="chip" style={{ color: 'var(--money)', display: 'inline-flex', alignItems: 'center', gap: 3 }}><IcCheck width={11} height={11} /> Approved</span>
                          : <span className="chip" style={{ color: 'var(--warn)' }}>Pending</span>}
                        <span className="chip">{tradeLabel(v.trade)}</span>
                      </div>
                      <div style={{ marginTop: 3 }}><Stars n={v.rating} /></div>
                      <div className="note" style={{ margin: '4px 0 0' }}>
                        {[v.contactName, v.phone].filter(Boolean).join(' · ')}
                        {v.website && <> · <a href={/^https?:/.test(v.website) ? v.website : `https://${v.website}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--info)' }}>{v.website.replace(/^https?:\/\//, '')}</a></>}
                      </div>
                      {v.license && <div className="note" style={{ margin: '2px 0 0', color: 'var(--text-faint)' }}>{v.license}</div>}
                      {v.notes && <div className="note" style={{ margin: '6px 0 0' }}>{v.notes}</div>}
                    </div>
                    <FavBtn on={v.favorite} label="Favorite vendor" onClick={() => setVendorField(v.id, { favorite: !v.favorite })} />
                  </div>
                  {(v.phone || v.email) && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      {v.phone && (
                        <a className="btn ghost sm" href={`tel:${String(v.phone).replace(/[^\d+]/g, '')}`} style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                          Call
                        </a>
                      )}
                      {v.email && (
                        <a className="btn ghost sm" href={`mailto:${v.email}`} style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>
                          Email
                        </a>
                      )}
                      {navigate && <button className="btn ghost sm" onClick={() => woForVendor(v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IcWrench width={12} height={12} /> New WO</button>}
                      {canEditVendors && <button className="btn ghost sm" onClick={() => setCallNote({ id: v.id, text: '' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>Log call</button>}
                    </div>
                  )}
                  {callNote?.id === v.id && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <input autoFocus style={{ ...inputStyle, flex: 1 }} value={callNote.text} placeholder="Call notes — quote, ETA, follow-up…"
                        onChange={(e) => setCallNote({ id: v.id, text: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveCallNote(); if (e.key === 'Escape') setCallNote(null); }} />
                      <button className="btn grad sm" onClick={saveCallNote} disabled={!callNote.text.trim()}>Save</button>
                      <button className="btn ghost sm" onClick={() => setCallNote(null)}><IcX width={13} height={13} /></button>
                    </div>
                  )}
                  {canEditVendors && (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
                      {!v.approved && (
                        <button className="btn grad sm" onClick={() => setVendorField(v.id, { approved: true })} style={{ marginRight: 'auto' }}><IcCheck width={13} height={13} /> Approve</button>
                      )}
                      <button className="btn ghost sm" onClick={() => setEditV({ ...v, rating: v.rating ?? '' })}>Edit</button>
                      <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => removeVendor(v.id)} aria-label="Delete vendor"><IcTrash width={13} height={13} /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
      )}

      {/* product cards */}
      {tab === 'products' && (
        shownProducts.length === 0
          ? <div className="card"><p className="note">No favorite products yet{q || trade !== 'all' ? ' for this filter' : ''}. {canEditVendors && !q ? 'Add the items you reorder — cartridges, paint, thermostats.' : ''}</p></div>
          : <div className="grid g2" style={{ gap: 'var(--gap)' }}>
              {shownProducts.map((p) => (
                <div className="card" key={p.id} style={{ marginTop: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 800, fontSize: 15 }}>{p.name}</span>
                        <span className="chip">{tradeLabel(p.category)}</span>
                        <span className="mono" style={{ fontWeight: 700 }}>{money(p.price)}</span>
                      </div>
                      <div className="note" style={{ margin: '4px 0 0' }}>
                        {p.vendorId ? <>from <b>{vName(p.vendorId)}</b></> : <span style={{ color: 'var(--text-faint)' }}>no vendor set</span>}
                        {p.sku && <> · <span className="mono">{p.sku}</span></>}
                        {p.url && <> · <a href={/^https?:/.test(p.url) ? p.url : `https://${p.url}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--info)' }}>link</a></>}
                      </div>
                      {p.notes && <div className="note" style={{ margin: '6px 0 0' }}>{p.notes}</div>}
                    </div>
                    <FavBtn on={p.favorite} label="Favorite product" onClick={() => setProductField(p.id, { favorite: !p.favorite })} />
                  </div>
                  {canEditVendors && (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
                      <button className="btn ghost sm" onClick={() => setEditP({ ...p, price: p.price ?? '' })}>Edit</button>
                      <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => removeProduct(p.id)} aria-label="Delete product"><IcTrash width={13} height={13} /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
      )}
    </div>
  );
}
