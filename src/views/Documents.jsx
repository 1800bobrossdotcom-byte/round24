import { useState, useRef } from 'react';
import { isConfigured, signedFileUrl } from '../lib/backend/supabase.js';
import { IcUpload } from '../components/ui.jsx';

// org document shelf — leases, insurance certs, W-9s, house rules.
// staff upload (org-wide or staff-only); crew see org-visible docs.
const CATEGORIES = ['general', 'insurance', 'tax', 'lease', 'manual', 'safety'];

export default function Documents({ store }) {
  const { documents, addDocument, docBackend, role } = store;
  const isStaff = role === 'admin' || role === 'manager';
  const [cat, setCat] = useState('general');
  const [visibility, setVisibility] = useState('org');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const fileRef = useRef();

  const upload = async (file) => {
    if (!file) return;
    setErr(null); setBusy(true);
    try { await addDocument(file, { category: cat, visibility }); }
    catch (e) { setErr('Upload failed: ' + (e.message || 'storage not ready yet')); }
    finally { setBusy(false); }
  };

  const download = async (d) => {
    try { const url = await signedFileUrl('docs', d.path); if (!url) { setErr('Could not open that document.'); return; } window.open(url, '_blank'); }
    catch { setErr('Could not open that document.'); }
  };

  return (
    <div>
      <div className="view-head">
        <h1>Documents</h1>
        <p>{isStaff ? 'The paper trail — shared with the crew or kept office-only' : 'Docs shared with you — certs, manuals, house rules'}</p>
      </div>

      {!isConfigured() && <div className="offline">◐ Document storage activates once connected to the cloud.</div>}
      {isConfigured() && docBackend === 'none' && (
        <div className="offline">◐ Storage not provisioned yet — uploads activate once the documents migration is applied.</div>
      )}
      {err && <div className="offline" style={{ color: 'var(--danger)', borderColor: '#ff5a5a33', background: '#ff5a5a12' }}>{err}</div>}

      {isStaff && (
        <div className="card" style={{ marginBottom: 'var(--gap)' }}>
          <span className="field-label">Upload</span>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
            <div className="pick">
              {CATEGORIES.map((c) => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
            <div className="seg">
              <button className={visibility === 'org' ? 'on' : ''} onClick={() => setVisibility('org')}>everyone</button>
              <button className={visibility === 'staff' ? 'on' : ''} onClick={() => setVisibility('staff')}>office only</button>
            </div>
            <button className="btn grad sm" style={{ flex: 1 }} disabled={busy || docBackend !== 'db'} onClick={() => fileRef.current.click()}>
              <IcUpload width={15} height={15} /> {busy ? 'Uploading…' : 'Choose file'}
            </button>
          </div>
          <input ref={fileRef} type="file" hidden onChange={(e) => { upload(e.target.files[0]); e.target.value = ''; }} />
        </div>
      )}

      <div className="card">
        <span className="field-label">Library ({documents.length})</span>
        {documents.length === 0 && <p className="note">No documents yet.</p>}
        {documents.map((d) => (
          <div className="row" key={d.id}>
            <div className="lead">
              <div className="t">{d.name}</div>
              <div className="s">{d.category} · {new Date(d.createdAt).toLocaleDateString()}{d.visibility === 'staff' ? ' · office only' : ''}</div>
            </div>
            <button className="btn ghost sm" onClick={() => download(d)}>Open</button>
          </div>
        ))}
      </div>
    </div>
  );
}
