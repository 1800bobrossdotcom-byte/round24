import { useState, useEffect, useRef, useCallback } from 'react';
import {
  submitMaintenanceRequest, getOrgBranding, listMyRequests, listAnnouncements, signOut,
} from '../lib/backend/supabase.js';
import { Mark } from '../components/ui.jsx';
import OrgLogo from '../components/OrgLogo.jsx';

const inp = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)',
  color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 16, padding: 12, borderRadius: 10,
};

// downscale a photo client-side (same approach as the anonymous request form)
function resizePhoto(file, maxDim = 1000, quality = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      try { resolve(c.toDataURL('image/jpeg', quality)); } catch { resolve(null); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

// resident-facing status for a request → its work order
function statusChip(r) {
  if (r.status === 'declined') return ['Declined', 'var(--text-faint)'];
  if (r.status === 'new') return ['Received', 'var(--warn)'];
  // converted → mirror the work order
  if (r.woStatus === 'done') return ['Done ✓', 'var(--money)'];
  if (r.woStatus === 'in_progress') return ['In progress', 'var(--accent)'];
  if (r.woStatus === 'cancelled') return ['Closed', 'var(--text-faint)'];
  return ['Scheduled', 'var(--info)'];
}
const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

// Caliper Community — the signed-in resident's home. Their identity (building +
// unit) comes from the verified residency, so reporting an issue is 2 fields.
// `embedded` renders it inside the staff shell (dual-hat: a founder/crew member
// who also lives in a building) — no logo header or sign-out, the shell has both.
export default function ResidentHome({ resident, embedded = false }) {
  const [brand, setBrand] = useState(null);
  const [requests, setRequests] = useState(null);   // null = loading
  const [anns, setAnns] = useState([]);
  const [showReport, setShowReport] = useState(false);

  // report form
  const [desc, setDesc] = useState('');
  const [photos, setPhotos] = useState([]);
  const [dictating, setDictating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);
  const [err, setErr] = useState(null);
  const recogRef = useRef(null);
  const MAX_PHOTOS = 6;

  const refresh = useCallback(() => {
    listMyRequests().then(setRequests).catch(() => setRequests([]));
    listAnnouncements(resident.orgId).then(setAnns).catch(() => {});
  }, [resident.orgId]);
  useEffect(() => {
    getOrgBranding(resident.orgId).then(setBrand).catch(() => {});
    refresh();
    const t = setInterval(refresh, 60000);   // keep "My requests" live-ish
    return () => clearInterval(t);
  }, [resident.orgId, refresh]);

  const onPhoto = async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = '';
    const room = MAX_PHOTOS - photos.length;
    const add = [];
    for (const f of files.slice(0, room)) { const d = await resizePhoto(f); if (d) add.push(d); }
    if (add.length) setPhotos((p) => [...p, ...add]);
  };
  const toggleDictation = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setErr('Voice typing needs Chrome, Edge, or Safari.'); return; }
    if (dictating) { try { recogRef.current?.stop(); } catch { /* */ } return; }
    setErr(null);
    const rec = new SR(); recogRef.current = rec;
    rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true;
    const base = desc.trim();
    rec.onresult = (e) => {
      let text = ''; for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      text = text.replace(/\s+/g, ' ').trim();
      if (text) { const s = text.charAt(0).toUpperCase() + text.slice(1); setDesc(base ? `${base} ${s}` : s); }
    };
    rec.onerror = () => setDictating(false);
    rec.onend = () => setDictating(false);
    try { rec.start(); setDictating(true); } catch { setDictating(false); }
  };
  useEffect(() => () => { try { recogRef.current?.stop(); } catch { /* */ } }, []);

  const submit = async () => {
    if (!desc.trim() || photos.length === 0) return;
    setBusy(true); setErr(null);
    try {
      await submitMaintenanceRequest(resident.orgId, {
        propLabel: resident.propLabel, unit: resident.unit,
        tenantName: resident.name, tenantContact: resident.email,
        description: desc.trim(), photos, residentId: resident.id,
      });
      setDesc(''); setPhotos([]); setShowReport(false);
      setFlash('Request sent — the office will follow up.'); setTimeout(() => setFlash(null), 5000);
      refresh();
    } catch { setErr('Could not submit — check your connection and try again.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={embedded ? { display: 'flex', justifyContent: 'center' } : { minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 480, padding: embedded ? '4px 0 24px' : '24px 18px 60px' }}>
        {!embedded && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
            <OrgLogo logo={brand?.logo} name={brand?.name} height={64} poweredBy centered
              fallback={<span style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Mark className="mark" /><span style={{ fontWeight: 800, fontSize: 19 }}>Caliper</span></span>} />
          </div>
        )}

        {/* who/where + status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          <span style={{ fontWeight: 800 }}>{resident.propLabel || 'Your building'}{resident.unit ? ` · Unit ${resident.unit}` : ''}</span>
          <span className="chip" style={{ color: resident.status === 'verified' ? 'var(--money)' : 'var(--warn)' }}>
            {resident.status === 'verified' ? 'verified resident' : resident.status}
          </span>
        </div>
        {resident.status === 'pending' && (
          <div className="card" style={{ marginBottom: 14, borderColor: 'color-mix(in srgb, var(--warn) 40%, var(--line))' }}>
            <p className="note" style={{ margin: 0 }}>⏳ The office is verifying your residency against the lease — usually within a day. You can already report repairs.</p>
          </div>
        )}
        {flash && <div className="card" style={{ marginBottom: 14, borderColor: 'var(--money)' }}><p className="note" style={{ margin: 0 }}>✓ {flash}</p></div>}

        {/* report an issue */}
        {!showReport ? (
          <button className="btn grad" style={{ width: '100%', padding: 14, fontSize: 16, marginBottom: 14 }} onClick={() => setShowReport(true)}>⚒ Report a maintenance issue</button>
        ) : (
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="field-label" style={{ margin: 0 }}>What's wrong?</span>
              <button type="button" onClick={toggleDictation}
                style={{ border: '1px solid var(--line)', background: dictating ? 'var(--danger)' : 'var(--surface-2)', color: dictating ? '#fff' : 'var(--text)', fontFamily: 'var(--font)', fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 8, cursor: 'pointer' }}>
                {dictating ? '● Listening…' : '🎙 Speak'}
              </button>
            </div>
            <textarea style={{ ...inp, minHeight: 90, marginTop: 6 }} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Kitchen sink is leaking under the cabinet" />
            <div className="field-label" style={{ marginTop: 10 }}>Photos <span style={{ color: 'var(--danger)' }}>· required</span> {photos.length > 0 && <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>({photos.length}/{MAX_PHOTOS})</span>}</div>
            {photos.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, margin: '4px 0 8px' }}>
                {photos.map((p, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={p} alt={`issue ${i + 1}`} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 10, border: '1px solid var(--line)' }} />
                    <button onClick={() => setPhotos((x) => x.filter((_, idx) => idx !== i))} aria-label="Remove photo"
                      style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, border: 'none', background: '#000a', color: '#fff', fontSize: 13, lineHeight: '22px', cursor: 'pointer' }}>×</button>
                  </div>
                ))}
              </div>
            )}
            {photos.length < MAX_PHOTOS && (
              <label className="btn ghost" style={{ width: '100%', justifyContent: 'center', cursor: 'pointer' }}>
                {photos.length ? '📷 Add another photo' : '📷 Add photos'}
                <input type="file" accept="image/*" capture="environment" multiple onChange={onPhoto} style={{ display: 'none' }} />
              </label>
            )}
            {err && <div className="note" style={{ color: 'var(--danger)', marginTop: 8 }}>{err}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button className="btn ghost" style={{ flex: 1 }} onClick={() => { setShowReport(false); setErr(null); }}>Cancel</button>
              <button className="btn grad" style={{ flex: 2 }} onClick={submit} disabled={busy || !desc.trim() || photos.length === 0}>{busy ? 'Sending…' : 'Send to the office'}</button>
            </div>
          </div>
        )}

        {/* my requests */}
        <div className="card" style={{ marginBottom: 14 }}>
          <span className="field-label" style={{ display: 'block', marginBottom: 6 }}>My requests</span>
          {requests === null ? <p className="note">Loading…</p>
            : requests.length === 0 ? <p className="note">Nothing yet. When you report an issue, you'll see it here and can follow it to done.</p>
            : requests.map((r) => {
              const [label, color] = statusChip(r);
              return (
                <div key={r.id} className="row" style={{ alignItems: 'center' }}>
                  <div className="lead">
                    <div className="t" style={{ fontSize: 14 }}>{r.description.length > 64 ? r.description.slice(0, 64) + '…' : r.description}</div>
                    <div className="s">{fmtWhen(r.createdAt)}</div>
                  </div>
                  <span className="chip" style={{ color }}>{label}</span>
                </div>
              );
            })}
        </div>

        {/* announcements */}
        {anns.length > 0 && (
          <div className="card" style={{ marginBottom: 14 }}>
            <span className="field-label" style={{ display: 'block', marginBottom: 6 }}>📣 From your management office</span>
            {anns.map((a) => (
              <div key={a.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{a.urgent && <span style={{ color: 'var(--danger)' }}>⚠ </span>}{a.title}</div>
                {a.body && <div className="s" style={{ marginTop: 2, whiteSpace: 'pre-wrap' }}>{a.body}</div>}
                <div className="s" style={{ color: 'var(--text-faint)', marginTop: 2 }}>{fmtWhen(a.createdAt)}</div>
              </div>
            ))}
          </div>
        )}

        {/* settings — the staff shell has its own sign-out, skip when embedded */}
        {!embedded && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
            <button className="btn ghost sm" style={{ width: 'auto' }} onClick={async () => { await signOut().catch(() => {}); window.location.href = '/'; }}>Sign out</button>
          </div>
        )}
        <p className="note" style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: 12, marginTop: 16 }}>Powered by Caliper Community</p>
      </div>
    </div>
  );
}
