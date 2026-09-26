import { useState, useEffect } from 'react';
import {
  isConfigured, getSession, onAuthChange, signIn, signUp,
  getOrgBranding, getOrgProperties, getMyResident, claimResidency,
} from '../lib/backend/supabase.js';
import { Mark } from '../components/ui.jsx';
import OrgLogo from '../components/OrgLogo.jsx';

const inp = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)',
  color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 16, padding: 12, borderRadius: 3,
};

// Round24 Community — join your building: round24.app/?join=<orgId>[&b=…]
// Three steps in one page: sign in / create account → claim your unit → pending.
// The office verifies every claim against the lease, so possession of the link
// only lets you ASK — verification is the gate.
export default function ResidentJoin({ orgId, building = '' }) {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [brand, setBrand] = useState(null);
  const [props, setProps] = useState([]);
  const [resident, setResident] = useState(null);

  // auth form
  const [mode, setMode] = useState('signup'); // 'signup' | 'signin'
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [confirmSent, setConfirmSent] = useState(false);
  // claim form
  const [bld, setBld] = useState(building);
  const [unit, setUnit] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!isConfigured()) { setReady(true); return undefined; }   // demo/unconfigured: no auth client
    let on = true;
    getOrgBranding(orgId).then((b) => { if (on) setBrand(b); }).catch(() => {});
    getOrgProperties(orgId).then((p) => { if (on) setProps(p); }).catch(() => {});
    getSession().then(async (s) => {
      if (!on) return;
      setSession(s);
      if (s) { const r = await getMyResident().catch(() => null); if (on) setResident(r); }
      setReady(true);
    });
    const { data } = onAuthChange((s) => setSession(s));
    return () => { on = false; data?.subscription?.unsubscribe(); };
  }, [orgId]);

  const auth = async () => {
    setErr(null); setBusy(true);
    try {
      if (mode === 'signup') {
        await signUp(email.trim(), pw);
        const s = await getSession();
        if (!s) { setConfirmSent(true); return; } // email confirmation required
        setSession(s);
      } else {
        await signIn(email.trim(), pw);
        setSession(await getSession());
        const r = await getMyResident().catch(() => null); setResident(r);
      }
    } catch (e) {
      // e.g. a staff/crew member who also lives here — same login works for both
      if (/already registered/i.test(e.message || '')) {
        setMode('signin');
        setErr('You already have a Round24 account with this email — sign in with your usual password and it works for both.');
      } else setErr(e.message || 'Could not sign in.');
    }
    finally { setBusy(false); }
  };

  const claim = async () => {
    setErr(null); setBusy(true);
    try {
      const r = await claimResidency(orgId, { propLabel: bld.trim() || null, unit: unit.trim() || null, name: name.trim() || null, email: session?.user?.email || null });
      setResident(r);
    } catch (e) { setErr(e.message?.includes('duplicate') ? 'You already have a residency with this office.' : (e.message || 'Could not submit.')); }
    finally { setBusy(false); }
  };

  const logo = (
    <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'center' }}>
      <OrgLogo logo={brand?.logo} name={brand?.name} height={76} poweredBy centered
        fallback={<span style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Mark className="mark" /><span style={{ fontWeight: 800, fontSize: 20 }}>Round24</span></span>} />
    </div>
  );

  const shell = (inner) => (
    <div className="community-scope" style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 420, padding: '28px 20px 60px' }}>{logo}{inner}
        <p className="note" style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: 12, marginTop: 18 }}>Round24 Community · your info is only shared with your building's management office.</p>
      </div>
    </div>
  );

  if (!isConfigured()) return shell(<div className="card"><p className="note">This link isn't active yet — ask your management office for a new one.</p></div>);
  if (!ready) return shell(<div className="card"><p className="note">Loading…</p></div>);

  if (confirmSent) return shell(
    <div className="card" style={{ textAlign: 'center', padding: 26 }}>
      <div style={{ fontSize: 34, marginBottom: 6 }}>✉️</div>
      <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 6 }}>Check your email</div>
      <p className="note">We sent a confirmation link to <b>{email}</b>. Tap it, then come back to this page to finish joining your building.</p>
    </div>
  );

  // signed in + already claimed → status / gateway to the resident home
  if (session && resident) return shell(
    <div className="card" style={{ textAlign: 'center', padding: 26 }}>
      <div style={{ fontSize: 34, marginBottom: 6 }}>{resident.status === 'verified' ? '✓' : '⏳'}</div>
      <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 6 }}>
        {resident.status === 'verified' ? 'You’re verified' : resident.status === 'pending' ? 'Waiting on the office' : 'Residency ' + resident.status}
      </div>
      <p className="note">{resident.propLabel || 'Your building'}{resident.unit ? ` · Unit ${resident.unit}` : ''}
        {resident.status === 'pending' ? ' — the office checks your claim against the lease, usually within a day. You can already report repairs.' : ''}</p>
      {/* #myhome lands dual-hat staff on their resident tab; pure residents get
          their full-screen home regardless of hash */}
      <button className="btn grad" style={{ marginTop: 16 }} onClick={() => { window.location.href = '/#myhome'; }}>Open my home</button>
    </div>
  );

  // signed in, no residency yet → claim a unit
  if (session) return shell(
    <>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 6px' }}>Claim your unit</h1>
      <p className="note" style={{ margin: '0 0 16px' }}>Tell us where you live — the office confirms it against the lease.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div><div className="field-label">Building</div>
          {props.length > 0 ? (
            <select style={{ ...inp, appearance: 'auto' }} value={bld} onChange={(e) => setBld(e.target.value)}>
              <option value="">Select your building…</option>
              {props.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          ) : <input style={inp} value={bld} onChange={(e) => setBld(e.target.value)} placeholder="e.g. 121 Park" />}
        </div>
        <div><div className="field-label">Unit</div><input style={inp} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. 4B" /></div>
        <div><div className="field-label">Your name</div><input style={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="As it appears on the lease" autoCapitalize="words" /></div>
        {err && <div className="note" style={{ color: 'var(--danger)' }}>{err}</div>}
        <button className="btn grad" style={{ padding: 13, fontSize: 15 }} onClick={claim} disabled={busy || !bld.trim() || !unit.trim() || !name.trim()}>{busy ? 'Submitting…' : 'Submit for verification'}</button>
      </div>
    </>
  );

  // not signed in → create account / sign in
  return shell(
    <>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 6px' }}>Join your building</h1>
      <p className="note" style={{ margin: '0 0 16px' }}>Create a free account to report repairs, follow them to done, and hear from your management office.</p>
      <div className="pick" style={{ marginBottom: 12 }}>
        <button className={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')}>Create account</button>
        <button className={mode === 'signin' ? 'on' : ''} onClick={() => setMode('signin')}>Sign in</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div><div className="field-label">Email</div><input style={inp} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoCapitalize="none" autoCorrect="off" inputMode="email" /></div>
        <div><div className="field-label">Password</div><input style={inp} type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'} /></div>
        {err && <div className="note" style={{ color: 'var(--danger)' }}>{err}</div>}
        <button className="btn grad" style={{ padding: 13, fontSize: 15 }} onClick={auth} disabled={busy || !email.trim() || pw.length < 8}>{busy ? '…' : mode === 'signup' ? 'Create account' : 'Sign in'}</button>
      </div>
    </>
  );
}
