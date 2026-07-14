import { useState, useRef, useEffect } from 'react';
import { submitMaintenanceRequest } from '../lib/backend/supabase.js';
import { Mark } from '../components/ui.jsx';
import OrgLogo from '../components/OrgLogo.jsx';

function blobToDataUrl(blob) {
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(blob); });
}

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
  const [voice, setVoice] = useState(null);          // optional voice-note data URL
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(null);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const MAX_PHOTOS = 6, MAX_SECS = 90;

  const onPhoto = async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = '';
    if (!files.length) return;
    const room = MAX_PHOTOS - photos.length;
    const add = [];
    for (const f of files.slice(0, room)) { const d = await resizePhoto(f); if (d) add.push(d); }
    if (add.length) setPhotos((p) => [...p, ...add]);
  };
  const removePhoto = (i) => setPhotos((p) => p.filter((_, idx) => idx !== i));

  // voice note via MediaRecorder — unauthenticated, so stored as a data URL
  const startRec = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      recRef.current = rec; chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        setVoice(await blobToDataUrl(blob));
      };
      rec.start(); setRecording(true); setRecSecs(0);
      timerRef.current = setInterval(() => setRecSecs((s) => { if (s + 1 >= MAX_SECS) stopRec(); return s + 1; }), 1000);
    } catch { setErr('Could not access the microphone. Check your browser permissions, or skip the voice note.'); }
  };
  const stopRec = () => { try { recRef.current?.stop(); } catch { /* */ } clearInterval(timerRef.current); setRecording(false); };
  useEffect(() => () => { try { recRef.current?.stop(); } catch { /* */ } clearInterval(timerRef.current); }, []);

  const submit = async () => {
    if (!desc.trim() || photos.length === 0) return;
    setBusy(true); setErr(null);
    try {
      await submitMaintenanceRequest(orgId, {
        propLabel: bld.trim() || null, unit: unit.trim() || null,
        tenantName: name.trim() || null, tenantContact: contact.trim() || null,
        description: desc.trim(), photos, voice,
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
            <p className="note" style={{ margin: '0 auto', maxWidth: 320 }}>Thanks — the maintenance office has your request{photos.length ? ` and ${photos.length} photo${photos.length > 1 ? 's' : ''}` : ''}{voice ? ' and voice note' : ''} and will follow up. You can close this page.</p>
            <button className="btn ghost" style={{ marginTop: 18 }} onClick={() => { setDone(false); setDesc(''); setPhotos([]); setVoice(null); setUnit(''); }}>Submit another</button>
          </div>
        ) : (
          <>
            <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 6px' }}>Report a maintenance issue</h1>
            <p className="note" style={{ margin: '0 0 18px' }}>Tell us what's wrong, add photos, and record a voice note if it's easier. The office will create a work order and follow up.</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div><div className="field-label">Building / address</div><input style={inp} value={bld} onChange={(e) => setBld(e.target.value)} placeholder="e.g. 121 Park" autoCapitalize="words" /></div>
              <div><div className="field-label">Unit</div><input style={inp} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. 4B" /></div>
              <div><div className="field-label">What's wrong?</div><textarea style={{ ...inp, minHeight: 96 }} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Kitchen sink is leaking under the cabinet" /></div>

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

              {/* voice note — optional */}
              <div>
                <div className="field-label">Voice note (optional)</div>
                {voice ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <audio controls src={voice} style={{ flex: 1, height: 40 }} />
                    <button className="btn ghost" style={{ width: 'auto' }} onClick={() => setVoice(null)}>Remove</button>
                  </div>
                ) : recording ? (
                  <button className="btn" onClick={stopRec} style={{ width: '100%', justifyContent: 'center', background: 'var(--danger)', color: '#fff', border: 'none' }}>
                    ● Recording {recSecs}s — tap to stop
                  </button>
                ) : (
                  <label className="btn ghost" style={{ width: '100%', justifyContent: 'center', cursor: 'pointer' }} onClick={startRec}>
                    🎙 Record a voice note
                  </label>
                )}
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
