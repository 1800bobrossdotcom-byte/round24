import { useState, useEffect, useCallback } from 'react';
import ConfirmButton from '../components/ConfirmButton.jsx';
import {
  listResidents, setResidentStatus, listAnnouncements, postAnnouncement, deleteAnnouncement,
} from '../lib/backend/supabase.js';
import { qrPosterDataUrl, downloadDataUrl } from '../lib/qr.js';
import { IcCheck, IcX, IcTrash, IcUsers } from '../components/ui.jsx';

const inp = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)',
  color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, padding: 9, borderRadius: 9,
};
const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const STATUS_COLOR = { pending: 'var(--warn)', verified: 'var(--money)', declined: 'var(--text-faint)', moved_out: 'var(--text-dim)' };

// Caliper Community · office side — verify resident claims against the lease,
// keep the roster, share the join link, and post announcements.
export default function Residents({ store }) {
  const { orgId, role } = store;
  const isOffice = role === 'admin' || role === 'manager';
  const [residents, setResidents] = useState(null);
  const [anns, setAnns] = useState([]);
  const [busy, setBusy] = useState(null);
  const [copied, setCopied] = useState(false);
  const [posterBusy, setPosterBusy] = useState(false);
  const [draft, setDraft] = useState(null); // announcement { title, body, urgent }

  const refresh = useCallback(() => {
    if (!orgId) { setResidents([]); return; }   // demo: nothing to load, never "Loading…"
    listResidents(orgId).then(setResidents).catch(() => setResidents([]));
    listAnnouncements(orgId).then(setAnns).catch(() => {});
  }, [orgId]);
  useEffect(() => { refresh(); }, [refresh]);

  if (!isOffice) {
    return <div><div className="view-head"><h1>Residents</h1></div><div className="card"><p className="note">Resident verification is handled by the office.</p></div></div>;
  }

  const link = orgId ? `${window.location.origin}/?join=${orgId}` : null; // demo has no org to join
  const copyLink = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ } };
  const dlPoster = async () => {
    setPosterBusy(true);
    try {
      const png = await qrPosterDataUrl(link, { heading: 'Join your building on Caliper' });
      downloadDataUrl(png, 'caliper-community-join-poster.png');
    } finally { setPosterBusy(false); }
  };

  const decide = async (r, status) => {
    setBusy(r.id);
    try { await setResidentStatus(r.id, status); store.audit?.(status === 'verified' ? 'verify_resident' : `resident_${status}`, `${r.propLabel || ''} ${r.unit || ''} · ${r.name || r.email || ''}`); refresh(); }
    finally { setBusy(null); }
  };

  const pending = (residents || []).filter((r) => r.status === 'pending');
  const roster = (residents || []).filter((r) => r.status === 'verified');
  const past = (residents || []).filter((r) => r.status === 'declined' || r.status === 'moved_out');

  const row = (r, actions) => (
    <div className="row" key={r.id} style={{ alignItems: 'center' }}>
      <div className="lead">
        <div className="t">{r.name || r.email || 'Resident'}
          <span className="chip" style={{ marginLeft: 8, color: STATUS_COLOR[r.status] }}>{r.status.replace('_', ' ')}</span>
        </div>
        <div className="s">{[r.propLabel, r.unit && `Unit ${r.unit}`, r.email, `joined ${fmtWhen(r.createdAt)}`].filter(Boolean).join(' · ')}</div>
      </div>
      {actions}
    </div>
  );

  return (
    <div>
      <div className="view-head">
        <h1>Residents</h1>
        <p>Caliper Community — verify who lives where, and keep the whole building in the loop.</p>
      </div>

      {/* join link */}
      <div className="card" style={{ marginBottom: 'var(--gap)' }}>
        <span className="field-label" style={{ display: 'block', marginBottom: 4 }}>Resident join link</span>
        <p className="note" style={{ margin: '0 0 10px' }}>Residents create a free account, claim their unit, and land in your verify queue. Verification against the lease is the gate — the link only lets them ask.</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input readOnly value={link || 'Available once your workspace is connected'} disabled={!link} onFocus={(e) => e.target.select()} className="mono"
            style={{ flex: 1, minWidth: 220, background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text)', fontSize: 13, padding: 10, borderRadius: 9 }} />
          <button className="btn ghost sm" onClick={copyLink} disabled={!link}>{copied ? 'Copied ✓' : 'Copy link'}</button>
          <button className="btn grad sm" onClick={dlPoster} disabled={posterBusy || !link}>{posterBusy ? 'Building…' : 'Download poster'}</button>
        </div>
      </div>

      {/* verify queue */}
      {pending.length > 0 && (
        <div className="card" style={{ marginBottom: 'var(--gap)', borderColor: 'color-mix(in srgb, var(--warn) 40%, var(--line))' }}>
          <span className="field-label" style={{ color: 'var(--warn)' }}>Waiting on verification ({pending.length}) — check each against the lease</span>
          {pending.map((r) => row(r, (
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn grad sm" disabled={busy === r.id} onClick={() => decide(r, 'verified')}><IcCheck width={13} height={13} /> Verify</button>
              <ConfirmButton className="btn ghost sm" style={{ color: 'var(--danger)' }} disabled={busy === r.id} label="Decline claim?" yes="Decline" onConfirm={() => decide(r, 'declined')}><IcX width={13} height={13} /> Decline</ConfirmButton>
            </div>
          )))}
        </div>
      )}

      {/* roster */}
      <div className="card" style={{ marginBottom: 'var(--gap)' }}>
        <span className="field-label" style={{ display: 'block', marginBottom: 4 }}>Verified residents ({roster.length})</span>
        {residents === null ? <p className="note">Loading…</p>
          : roster.length === 0 ? <p className="note"><IcUsers width={13} height={13} style={{ verticalAlign: -2 }} /> No verified residents yet. Share the join link (or post the QR in lobbies) and claims will land here.</p>
          : roster.map((r) => row(r, (
            <ConfirmButton className="btn ghost sm" disabled={busy === r.id} label="Moved out? Access ends, history stays." yes="Moved out" onConfirm={() => decide(r, 'moved_out')}>Moved out</ConfirmButton>
          )))}
        {past.length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary className="s" style={{ cursor: 'pointer', color: 'var(--text-faint)' }}>Declined / moved out ({past.length})</summary>
            {past.map((r) => row(r, null))}
          </details>
        )}
      </div>

      {/* announcements */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <span className="field-label" style={{ margin: 0 }}>Announcements to residents</span>
          {!draft && <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setDraft({ title: '', body: '', urgent: false })}>+ New announcement</button>}
        </div>
        {draft && (
          <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 12, marginBottom: 10 }}>
            <div className="field-label">Title</div>
            <input style={inp} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Water shut-off Thursday 9–11am" />
            <div className="field-label" style={{ marginTop: 8 }}>Details (optional)</div>
            <textarea style={{ ...inp, minHeight: 60 }} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 10 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" checked={draft.urgent} onChange={(e) => setDraft({ ...draft, urgent: e.target.checked })} /> Urgent
              </label>
              <span style={{ flex: 1 }} />
              <button className="btn ghost sm" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn grad sm" disabled={!draft.title.trim()} onClick={async () => { await postAnnouncement(orgId, draft).catch(() => {}); setDraft(null); refresh(); }}>Post</button>
            </div>
          </div>
        )}
        {anns.length === 0 ? <p className="note">Nothing posted yet. Announcements show on every resident's home — water shut-offs, inspections, lobby notices.</p>
          : anns.map((a) => (
            <div className="row" key={a.id} style={{ alignItems: 'center' }}>
              <div className="lead">
                <div className="t" style={{ fontSize: 14 }}>{a.urgent && <span style={{ color: 'var(--danger)' }}>⚠ </span>}{a.title}</div>
                <div className="s">{fmtWhen(a.createdAt)}{a.body ? ` · ${a.body.slice(0, 80)}${a.body.length > 80 ? '…' : ''}` : ''}</div>
              </div>
              <ConfirmButton className="btn ghost sm icon-btn" style={{ color: 'var(--text-faint)' }} label="Delete announcement?" yes="Delete" onConfirm={() => deleteAnnouncement(a.id).then(refresh).catch(() => {})} aria-label="Delete"><IcTrash width={13} height={13} /></ConfirmButton>
            </div>
          ))}
      </div>
    </div>
  );
}
