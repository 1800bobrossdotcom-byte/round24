import { useState, useRef, useEffect } from 'react';
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
  const [photos, setPhotos] = useState([]);          // required, multiple
  const [dictating, setDictating] = useState(false); // speech-to-text into desc
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(null);
  const recogRef = useRef(null);
  const MAX_PHOTOS = 6;

  const onPhoto = async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = '';
    if (!files.length) return;
    const room = MAX_PHOTOS - photos.length;
    const add = [];
    for (const f of files.slice(0, room)) { const d = await resizePhoto(f); if (d) add.push(d); }
    if (add.length) setPhotos((p) => [...p, ...add]);
  };
  const removePhoto = (i) => setPhotos((p) => p.filter((_, idx) => idx !== i));

  // voice-to-text: dictate the issue straight into the description (Web Speech
  // API). Appends to whatever's already typed, so speaking and typing mix.
  const toggleDictation = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setErr('Voice typing needs Chrome, Edge, or Safari. You can type the issue instead.'); return; }
    if (dictating) { try { recogRef.current?.stop(); } catch { /* */ } return; }
    setErr(null);
    const rec = new SR();
    recogRef.current = rec;
    rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true;
    const base = desc.trim();
    rec.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      text = text.replace(/\s+/g, ' ').trim();
      if (text) { const s = text.charAt(0).toUpperCase() + text.slice(1); setDesc(base ? `${base} ${s}` : s); }
    };
    rec.onerror = (ev) => { setDictating(false); if (ev.error === 'not-allowed') setErr('Microphone permission denied — you can type the issue instead.'); };
    rec.onend = () => setDictating(false);
    try { rec.start(); setDictating(true); } catch { setDictating(false); }
  };
  useEffect(() => () => { try { recogRef.current?.stop(); } catch { /* */ } }, []);

  const submit = async () => {
    if (!desc.trim() || photos.length === 0) return;
    setBusy(true); setErr(null);
    try {
      await submitMaintenanceRequest(orgId, {
        propLabel: bld.trim() || null, unit: unit.trim() || null,
        tenantName: name.trim() || null, tenantContact: contact.trim() || null,
        description: desc.trim(), photos,
      });
      setDone(true);
    } catch { setErr('Could not submit — please check your connection and try again.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 440, padding: '28px 20px 60px' }}>
        <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'center' }}>
          <OrgLogo orgId={orgId} height={92} poweredBy centered
            fallback={<span style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Mark className="mark" /><span style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-0.02em' }}>Caliper</span></span>} />
        </div>

        {done ? (
          <div className="card" style={{ textAlign: 'center', padding: 30 }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>✓</div>
            <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 6 }}>Request submitted</div>
            <p className="note" style={{ margin: '0 auto', maxWidth: 320 }}>Thanks — the maintenance office has your request{photos.length ? ` and ${photos.length} photo${photos.length > 1 ? 's' : ''}` : ''} and will follow up. You can close this page.</p>
            <button className="btn ghost" style={{ marginTop: 18 }} onClick={() => { setDone(false); setDesc(''); setPhotos([]); setUnit(''); }}>Submit another</button>
          </div>
        ) : (
          <>
            <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 6px' }}>Report a maintenance issue</h1>
            <p className="note" style={{ margin: '0 0 18px' }}>Tell us what's wrong — type it or tap Speak — and add photos. The office will create a work order and follow up.</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div><div className="field-label">Building / address</div><input style={inp} value={bld} onChange={(e) => setBld(e.target.value)} placeholder="e.g. 121 Park" autoCapitalize="words" /></div>
              <div><div className="field-label">Unit</div><input style={inp} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. 4B" /></div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div className="field-label">What's wrong?</div>
                  <button type="button" onClick={toggleDictation}
                    style={{ border: '1px solid var(--line)', background: dictating ? 'var(--danger)' : 'var(--surface-2)', color: dictating ? '#fff' : 'var(--text)', fontFamily: 'var(--font)', fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 8, cursor: 'pointer' }}>
                    {dictating ? '● Listening… tap to stop' : '🎙 Speak'}
                  </button>
                </div>
                <textarea style={{ ...inp, minHeight: 96 }} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Kitchen sink is leaking under the cabinet — or tap Speak and describe it" />
              </div>

              {/* photos — required, multiple */}
              <div>
                <div className="field-label">Photos <span style={{ color: 'var(--danger)' }}>· required</span> {photos.length > 0 && <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>({photos.length}/{MAX_PHOTOS})</span>}</div>
                {photos.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 8 }}>
                    {photos.map((p, i) => (
                      <div key={i} style={{ position: 'relative' }}>
                        <img src={p} alt={`issue ${i + 1}`} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 10, border: '1px solid var(--line)' }} />
                        <button onClick={() => removePhoto(i)} aria-label="Remove photo"
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
                {photos.length === 0 && <p className="note" style={{ margin: '6px 0 0', color: 'var(--text-faint)' }}>At least one photo is required — it's how the office sees the problem.</p>}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><div className="field-label">Your name</div><input style={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" autoCapitalize="words" /></div>
                <div><div className="field-label">Phone or email</div><input style={inp} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Optional" autoCapitalize="none" autoCorrect="off" /></div>
              </div>
              {err && <div className="note" style={{ color: 'var(--danger)' }}>{err}</div>}
              <button className="btn grad" style={{ padding: 14, fontSize: 16 }} onClick={submit} disabled={busy || !desc.trim() || photos.length === 0}>{busy ? 'Submitting…' : 'Submit request'}</button>
              <p className="note" style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>Powered by Caliper · your info is only shared with your maintenance office.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
