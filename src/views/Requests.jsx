import { useState, useMemo } from 'react';
import { IcCheck, IcX, IcWrench, IcBuilding } from '../components/ui.jsx';

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function Requests({ store, navigate }) {
  const { maintRequests = [], setRequestStatus, convertRequestToWorkOrder, meta = {}, role } = store;
  const isOffice = role === 'admin' || role === 'manager';
  const [busy, setBusy] = useState(null);   // request id being acted on
  const [copied, setCopied] = useState(false);
  const [photo, setPhoto] = useState(null); // enlarged photo

  const orgId = store.orgId || '';
  const link = `${window.location.origin}/?request=${orgId}`;

  const { queue, handled } = useMemo(() => ({
    queue: maintRequests.filter((r) => r.status === 'new'),
    handled: maintRequests.filter((r) => r.status !== 'new'),
  }), [maintRequests]);

  if (!isOffice) {
    return <div><div className="view-head"><h1>Requests</h1></div><div className="card"><p className="note">Resident requests are triaged by the office.</p></div></div>;
  }

  const convert = async (r) => { setBusy(r.id); try { const wo = await convertRequestToWorkOrder(r); if (wo && navigate) navigate('wo'); } finally { setBusy(null); } };
  const decline = async (r) => { if (!window.confirm('Decline this request?')) return; setBusy(r.id); try { await setRequestStatus(r.id, 'declined'); } finally { setBusy(null); } };
  const copyLink = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ } };

  const card = (r, active) => (
    <div className="card" key={r.id} style={{ marginBottom: 'var(--gap)', opacity: active ? 1 : 0.7 }}>
      <div style={{ display: 'flex', gap: 12 }}>
        {r.photo && (
          <img src={r.photo} alt="issue" onClick={() => setPhoto(r.photo)}
            style={{ width: 76, height: 76, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)', cursor: 'zoom-in', flex: 'none' }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800 }}>{r.propLabel || 'Unknown building'}{r.unit ? ` · Unit ${r.unit}` : ''}</span>
            {r.status === 'converted' && <span className="chip" style={{ color: 'var(--money)' }}>→ work order</span>}
            {r.status === 'declined' && <span className="chip" style={{ color: 'var(--text-dim)' }}>declined</span>}
            <span className="chip" style={{ marginLeft: 'auto', color: 'var(--text-faint)' }}>{fmtWhen(r.createdAt)}</span>
          </div>
          <div style={{ margin: '5px 0', lineHeight: 1.45 }}>{r.description}</div>
          {(r.tenantName || r.tenantContact) && (
            <div className="note" style={{ margin: 0 }}>{[r.tenantName, r.tenantContact].filter(Boolean).join(' · ')}</div>
          )}
        </div>
      </div>
      {active && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
          <button className="btn ghost sm" style={{ color: 'var(--danger)' }} disabled={busy === r.id} onClick={() => decline(r)}><IcX width={13} height={13} /> Decline</button>
          <button className="btn grad sm" disabled={busy === r.id} onClick={() => convert(r)}><IcWrench width={13} height={13} /> {busy === r.id ? 'Creating…' : 'Create work order'}</button>
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div className="view-head">
        <h1>Resident requests</h1>
        <p>Maintenance issues residents report — triage each into a work order for the crew.</p>
      </div>

      {/* shareable intake link */}
      <div className="card" style={{ marginBottom: 'var(--gap)' }}>
        <span className="field-label" style={{ display: 'block', marginBottom: 4 }}>Resident request link</span>
        <p className="note" style={{ margin: '0 0 10px' }}>Post this link (or a QR of it) in buildings and on notices. Residents open it, describe the issue, snap a photo — no login needed. Requests land here.</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input readOnly value={link} onFocus={(e) => e.target.select()} className="mono"
            style={{ flex: 1, minWidth: 220, background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text)', fontSize: 13, padding: 10, borderRadius: 9 }} />
          <button className="btn ghost sm" onClick={copyLink}>{copied ? 'Copied ✓' : 'Copy link'}</button>
          <a className="btn ghost sm" href={link} target="_blank" rel="noreferrer">Preview</a>
        </div>
        <p className="note" style={{ margin: '8px 0 0', color: 'var(--text-faint)' }}>Tip: add <span className="mono">&amp;b=121%20Park</span> to prefill a specific building on a per-door link.</p>
      </div>

      {queue.length > 0 ? (
        <>
          <span className="field-label" style={{ display: 'block', margin: '0 0 8px', color: 'var(--warn)' }}>New ({queue.length})</span>
          {queue.map((r) => card(r, true))}
        </>
      ) : (
        <div className="card"><p className="note">No open resident requests. Share the link above so residents can report issues straight into your queue.</p></div>
      )}

      {handled.length > 0 && (
        <>
          <span className="field-label" style={{ display: 'block', margin: '18px 0 8px' }}>Handled ({handled.length})</span>
          {handled.slice(0, 30).map((r) => card(r, false))}
        </>
      )}

      {photo && (
        <div onClick={() => setPhoto(null)} style={{ position: 'fixed', inset: 0, background: '#000c', display: 'grid', placeItems: 'center', zIndex: 200, padding: 20, cursor: 'zoom-out' }}>
          <img src={photo} alt="issue" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 10 }} />
        </div>
      )}
    </div>
  );
}
