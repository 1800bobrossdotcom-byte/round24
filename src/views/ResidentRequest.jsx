import { useState } from 'react';
import { submitMaintenanceRequest } from '../lib/backend/supabase.js';
import { Mark } from '../components/ui.jsx';
import OrgLogo from '../components/OrgLogo.jsx';

// downscale a photo client-side to a reasonable data URL (a phone photo is huge;
// the office only needs to see what's wrong).
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

const inp = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)',
  color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 16, padding: 12, borderRadius: 10,
};

// public, unauthenticated resident maintenance-request form. orgId (+ optional
// prefilled building) come from the link the office shares.
export default function ResidentRequest({ orgId, building = '' }) {
  const [bld, setBld] = useState(building);
  const [unit, setUnit] = useState('');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [desc, setDesc] = useState('');
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(null);

  const onPhoto = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setPhoto(await resizePhoto(f));
  };
  const submit = async () => {
    if (!desc.trim()) return;
    setBusy(true); setErr(null);
    try {
      await submitMaintenanceRequest(orgId, {
        propLabel: bld.trim() || null, unit: unit.trim() || null,
        tenantName: name.trim() || null, tenantContact: contact.trim() || null,
        description: desc.trim(), photo,
      });
      setDone(true);
    } catch { setErr('Could not submit — please check your connection and try again.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 440, padding: '28px 20px 60px' }}>
        <div style={{ marginBottom: 18 }}>
          <OrgLogo orgId={orgId} height={76} poweredBy
            fallback={<span style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Mark className="mark" /><span style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-0.02em' }}>Caliper</span></span>} />
        </div>

        {done ? (
          <div className="card" style={{ textAlign: 'center', padding: 30 }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>✓</div>
            <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 6 }}>Request submitted</div>
            <p className="note" style={{ margin: '0 auto', maxWidth: 320 }}>Thanks — the maintenance office has your request{photo ? ' and photo' : ''} and will follow up. You can close this page.</p>
            <button className="btn ghost" style={{ marginTop: 18 }} onClick={() => { setDone(false); setDesc(''); setPhoto(null); setUnit(''); }}>Submit another</button>
          </div>
        ) : (
          <>
            <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 6px' }}>Report a maintenance issue</h1>
            <p className="note" style={{ margin: '0 0 18px' }}>Tell us what's wrong and add a photo if you can. The office will create a work order and follow up.</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div><div className="field-label">Building / address</div><input style={inp} value={bld} onChange={(e) => setBld(e.target.value)} placeholder="e.g. 121 Park" autoCapitalize="words" /></div>
              <div><div className="field-label">Unit</div><input style={inp} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. 4B" /></div>
              <div><div className="field-label">What's wrong?</div><textarea style={{ ...inp, minHeight: 96 }} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Kitchen sink is leaking under the cabinet" /></div>
              <div>
                <div className="field-label">Photo (optional)</div>
                <label className="btn ghost" style={{ width: '100%', justifyContent: 'center', cursor: 'pointer' }}>
                  {photo ? 'Change photo' : '📷 Add a photo'}
                  <input type="file" accept="image/*" capture="environment" onChange={onPhoto} style={{ display: 'none' }} />
                </label>
                {photo && <img src={photo} alt="issue" style={{ marginTop: 8, width: '100%', borderRadius: 10, border: '1px solid var(--line)' }} />}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><div className="field-label">Your name</div><input style={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" autoCapitalize="words" /></div>
                <div><div className="field-label">Phone or email</div><input style={inp} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Optional" autoCapitalize="none" autoCorrect="off" /></div>
              </div>
              {err && <div className="note" style={{ color: 'var(--danger)' }}>{err}</div>}
              <button className="btn grad" style={{ padding: 14, fontSize: 16 }} onClick={submit} disabled={busy || !desc.trim()}>{busy ? 'Submitting…' : 'Submit request'}</button>
              <p className="note" style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>Powered by Caliper · your info is only shared with your maintenance office.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
