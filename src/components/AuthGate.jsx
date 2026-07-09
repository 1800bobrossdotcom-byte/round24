import { useState, useEffect, createContext, useContext } from 'react';
import { supabase, isConfigured, signIn, signUp, signOut, getSession, onAuthChange, updatePassword, fetchMembership, redeemInvite, requestBeta, isPlatformAdmin } from '../lib/backend/supabase.js';
import { Mark, BrandLockup, IcGear, IcLogout, IcWrench, IcChart, IcX, IcCheck, IcChevron } from './ui.jsx';
import Platform from '../views/Platform.jsx';

// invite links land as ?invite=CODE. Capture it, stash it, strip it from the
// URL, and it gets redeemed the moment the person is authenticated.
const INVITE_KEY = 'caliper_pending_invite';
function capturePendingInvite() {
  try {
    const u = new URL(window.location.href);
    const code = u.searchParams.get('invite');
    if (code) {
      localStorage.setItem(INVITE_KEY, code.trim().toUpperCase());
      u.searchParams.delete('invite');
      window.history.replaceState({}, '', u.pathname + (u.search || '') + (u.hash || ''));
    }
    return localStorage.getItem(INVITE_KEY);
  } catch { return null; }
}
const getPendingInvite = () => { try { return localStorage.getItem(INVITE_KEY); } catch { return null; } };
const clearPendingInvite = () => { try { localStorage.removeItem(INVITE_KEY); } catch { /* no-op */ } };

// role drives which tools are visible: admin/manager see the full suite
// incl. financials; tech (contractors) get field tools only; viewer is
// read-only. RLS + getdek enforce the same boundary server-side.
const AuthCtx = createContext({ session: null, role: 'admin', orgId: null, orgName: null, orgKind: 'company' });
export const useAuth = () => useContext(AuthCtx);

// Wraps the app. Three states:
//  - not configured  → demo mode (seed data), small banner, no gate
//  - configured + no session → login screen
//  - configured + session → app, with sign-out available
export function AuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [mem, setMem] = useState(null);       // { org_id, role }
  const [memReady, setMemReady] = useState(false);
  const [invite, setInvite] = useState(null); // pending invite code

  useEffect(() => {
    if (!isConfigured()) { setReady(true); return; }
    setInvite(capturePendingInvite());
    getSession().then((s) => { setSession(s); setReady(true); });
    const { data } = onAuthChange(setSession);
    return () => data?.subscription?.unsubscribe();
  }, []);

  useEffect(() => {
    if (!isConfigured() || !session) { setMem(null); setMemReady(false); return; }
    let on = true;
    (async () => {
      let m = await fetchMembership().catch(() => null);
      // brand-new user with an invite code → place them into the org now
      if (!m && getPendingInvite()) {
        try { await redeemInvite(getPendingInvite()); clearPendingInvite(); setInvite(null); m = await fetchMembership().catch(() => null); }
        catch { /* bad/used/expired invite — stays unonboarded */ }
      }
      if (on) { setMem(m); setMemReady(true); }
    })();
    return () => { on = false; };
  }, [session]);

  if (!ready) return null;

  // demo mode — backend not wired yet, app runs on seed data with full suite
  if (!isConfigured()) {
    return (
      <AuthCtx.Provider value={{ session: null, role: 'admin', orgId: null }}>
        <div style={{ background: '#38bdf812', borderBottom: '1px solid #38bdf833', color: 'var(--info)',
          fontSize: 12, fontWeight: 700, textAlign: 'center', padding: '7px 12px', fontFamily: 'var(--font)' }}>
          ◑ Demo mode · sample data · connect Supabase to enable secure login &amp; real data
        </div>
        {children}
      </AuthCtx.Provider>
    );
  }

  if (!session) return <Login invite={invite} />;
  if (!memReady) {
    // don't flash the wrong toolset while the role loads
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--text-faint)', fontFamily: 'var(--font)', fontSize: 13, fontWeight: 700 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Mark /> loading your workspace…</div>
      </div>
    );
  }

  // signed in but not part of any workspace yet → let them redeem an invite
  if (!mem) return <NeedsAccess />;

  return (
    <AuthCtx.Provider value={{ session, role: mem.role, orgId: mem.org_id, orgName: mem.orgName, orgKind: mem.orgKind || 'company' }}>
      {children}
    </AuthCtx.Provider>
  );
}

// signed in, no org yet. Platform superadmins get the provisioning console;
// everyone else joins by invite or requests a workspace (approval-gated beta).
function NeedsAccess() {
  const [plat, setPlat] = useState(null);   // null = checking
  const [tab, setTab] = useState('join');   // 'join' | 'request'
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [kind, setKind] = useState('company');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [sent, setSent] = useState(false);

  useEffect(() => { isPlatformAdmin().then(setPlat).catch(() => setPlat(false)); }, []);

  const join = async () => {
    setErr(null); setBusy(true);
    try { await redeemInvite(code.trim().toUpperCase()); window.location.reload(); }
    catch (e) { setErr(e.message || 'That invite code isn’t valid or has been used.'); setBusy(false); }
  };
  const request = async () => {
    setErr(null); setBusy(true);
    try { await requestBeta({ orgName: name.trim(), note: note.trim() || null, kind }); setSent(true); }
    catch (e) { setErr(e.message || 'Could not send your request.'); }
    finally { setBusy(false); }
  };

  // superadmin without an org → the platform console (provision / approve)
  if (plat) {
    return (
      <div className="app desk" style={{ minHeight: '100vh' }}>
        <header className="topbar" style={{ position: 'static' }}>
          <div className="brand"><Mark /> Caliper <span className="sub">platform</span></div>
          <div className="spacer" />
          <SignOutButton />
        </header>
        <main className="content"><Platform /></main>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 360, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}><BrandLockup /></div>
        <div style={{ fontWeight: 800, fontSize: 17, marginTop: 12 }}>Almost there</div>
        <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: '6px 0 14px' }}>You’re signed in — join a workspace with an invite, or request one.</p>

        {sent ? (
          <div className="offline" style={{ color: 'var(--money)', borderColor: '#4ade8033', background: 'var(--money-dim)' }}>
            <IcCheck width={14} height={14} /> Request sent. You’ll get an invite link once it’s approved.
          </div>
        ) : (
          <>
            <div className="seg" style={{ marginBottom: 16 }}>
              <button className={tab === 'join' ? 'on' : ''} onClick={() => { setTab('join'); setErr(null); }}>Join with invite</button>
              <button className={tab === 'request' ? 'on' : ''} onClick={() => { setTab('request'); setErr(null); }}>Request a workspace</button>
            </div>

            {err && <div className="offline" style={{ color: 'var(--danger)', borderColor: '#ff5a5a33', background: '#ff5a5a12' }}>{err}</div>}

            {tab === 'join' ? (
              <>
                <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="INVITE CODE"
                  onKeyDown={(e) => e.key === 'Enter' && code && join()} style={{ ...inputStyle, textAlign: 'center', letterSpacing: '.15em', fontFamily: 'var(--mono)' }} />
                <div style={{ height: 14 }} />
                <button className="btn grad" onClick={join} disabled={busy || !code}>{busy ? 'Joining…' : 'Join workspace'}</button>
              </>
            ) : (
              <>
                <div className="seg" style={{ marginBottom: 10 }}>
                  <button className={kind === 'company' ? 'on' : ''} onClick={() => setKind('company')}>Company + crew</button>
                  <button className={kind === 'owner' ? 'on' : ''} onClick={() => setKind('owner')}>I own properties</button>
                </div>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'owner' ? 'Your name / portfolio' : 'Company name'} style={inputStyle} />
                <div style={{ height: 10 }} />
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything we should know? (optional)" style={inputStyle} />
                <div style={{ height: 14 }} />
                <button className="btn grad" onClick={request} disabled={busy || !name.trim()}>{busy ? 'Sending…' : 'Request beta invite'}</button>
                <p className="note" style={{ marginTop: 10 }}>Caliper is in private beta — we’ll send an invite once approved.</p>
              </>
            )}
          </>
        )}
        <p className="note" style={{ marginTop: 16 }}><a onClick={signOut} style={{ color: 'var(--info)', cursor: 'pointer' }}>Sign out</a></p>
      </div>
    </div>
  );
}

// ---- two front doors, one secure backend ----
// the portal choice themes the login; after sign-in the ROLE decides the
// actual toolset (a contractor who picks Office still lands in Crew tools).
const PORTALS = {
  crew: {
    title: 'Crew Portal',
    tagline: 'Clock in. Get your orders. Snap your receipts.',
    points: ['Your work orders', 'Job timer', 'Receipt reimbursement'],
  },
  office: {
    title: 'Office Portal',
    tagline: 'The whole operation, measured true.',
    points: ['Dashboards & financials', 'Dispatch work orders', 'Documents & purchasing'],
  },
};

function Login({ invite }) {
  const [portal, setPortal] = useState(() => localStorage.getItem('caliper_portal') || null);
  const [beta, setBeta] = useState(false);
  const pick = (p) => { localStorage.setItem('caliper_portal', p); setPortal(p); };

  if (beta) return <BetaRequest onBack={() => setBeta(false)} />;

  if (!portal) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 640 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
            <BrandLockup />
          </div>
          <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13, marginBottom: 26 }}>Labor, measured true. Pick your door.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'stretch' }}>
            {Object.entries(PORTALS).map(([key, p]) => (
              <button key={key} onClick={() => pick(key)} className="card portal-card" style={{
                flex: '1 1 240px', minWidth: 0, marginTop: 0,
                cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font)', color: 'var(--text)',
                border: '1px solid var(--line)', padding: 22,
              }}>
                <div style={{ marginBottom: 10, color: 'var(--accent)' }}>
                  {key === 'crew' ? <IcWrench width={26} height={26} /> : <IcChart width={26} height={26} />}
                </div>
                <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>{p.title}</div>
                <div className="p-tag" style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 12 }}>{p.tagline}</div>
                <div className="p-points">
                  {p.points.map((pt) => (
                    <div key={pt} style={{ fontSize: 12, color: 'var(--text-faint)', fontWeight: 600, padding: '2px 0' }}>· {pt}</div>
                  ))}
                </div>
              </button>
            ))}
          </div>
          <p className="note" style={{ textAlign: 'center', marginTop: 22 }}>
            Not invited yet? <a onClick={() => setBeta(true)} style={{ color: 'var(--info)', cursor: 'pointer', fontWeight: 700 }}>Request a beta invite →</a>
          </p>
        </div>
      </div>
    );
  }
  return <LoginForm portal={portal} invite={invite} onBeta={() => setBeta(true)} onSwitch={() => { localStorage.removeItem('caliper_portal'); setPortal(null); }} />;
}

// public beta-invite request — no account needed. Lands in the superadmin queue.
function BetaRequest({ onBack }) {
  const [f, setF] = useState({ name: '', email: '', company: '', kind: 'company', note: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [sent, setSent] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    setErr(null);
    if (!f.email.trim()) { setErr('Please add an email so we can send your invite.'); return; }
    setBusy(true);
    try {
      await requestBeta({ email: f.email.trim(), contactName: f.name.trim() || null, orgName: f.company.trim() || null, kind: f.kind, note: f.note.trim() || null });
      setSent(true);
    } catch (e) { setErr(e.message || 'Could not send your request.'); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}><BrandLockup /></div>
        <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 18, marginTop: 10 }}>Request a beta invite</div>
        <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13, margin: '6px 0 16px' }}>Caliper is in private beta. Tell us a bit about you and we’ll send an invite.</p>

        {sent ? (
          <>
            <div className="offline" style={{ color: 'var(--money)', borderColor: '#4ade8033', background: 'var(--money-dim)', display: 'flex', gap: 8 }}>
              <IcCheck width={16} height={16} /> Thanks{f.name ? `, ${f.name.split(' ')[0]}` : ''} — you’re on the list. We’ll email an invite to <b>{f.email}</b>.
            </div>
            <p className="note" style={{ textAlign: 'center', marginTop: 14 }}><a onClick={onBack} style={{ color: 'var(--info)', cursor: 'pointer' }}>← Back to sign in</a></p>
          </>
        ) : (
          <>
            <div className="seg" style={{ marginBottom: 12 }}>
              <button className={f.kind === 'company' ? 'on' : ''} onClick={() => set('kind', 'company')}>Company + crew</button>
              <button className={f.kind === 'owner' ? 'on' : ''} onClick={() => set('kind', 'owner')}>I own properties</button>
            </div>
            {err && <div className="offline" style={{ color: 'var(--danger)', borderColor: '#ff5a5a33', background: '#ff5a5a12' }}>{err}</div>}
            <input value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="Email *" type="email" autoComplete="email" style={inputStyle} />
            <div style={{ height: 10 }} />
            <input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Your name" style={inputStyle} />
            <div style={{ height: 10 }} />
            <input value={f.company} onChange={(e) => set('company', e.target.value)} placeholder={f.kind === 'owner' ? 'Portfolio name (optional)' : 'Company name (optional)'} style={inputStyle} />
            <div style={{ height: 10 }} />
            <input value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="How many properties? Anything else? (optional)" style={inputStyle} />
            <div style={{ height: 16 }} />
            <button className="btn grad" onClick={submit} disabled={busy}>{busy ? 'Sending…' : 'Request invite'}</button>
            <p className="note" style={{ textAlign: 'center', marginTop: 12 }}><a onClick={onBack} style={{ color: 'var(--info)', cursor: 'pointer' }}>← Back to sign in</a></p>
          </>
        )}
      </div>
    </div>
  );
}

function LoginForm({ portal, onSwitch, onBeta, invite }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [mode, setMode] = useState(invite ? 'signup' : 'signin'); // invited → create account
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const p = PORTALS[portal];
  const isSignup = mode === 'signup';

  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      if (isSignup) await signUp(email, pw);   // invite is redeemed post-auth by AuthGate
      else await signIn(email, pw);
    } catch (e) { setErr(e.message || (isSignup ? 'Could not create account' : 'Sign-in failed')); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', marginBottom: 8 }}>
          <BrandLockup />
          <span className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {portal === 'crew' ? <IcWrench width={12} height={12} /> : <IcChart width={12} height={12} />}
            {portal === 'crew' ? 'crew' : 'office'}
          </span>
        </div>
        <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13, marginBottom: 20 }}>{p.tagline}</p>

        {invite && isSignup && (
          <div className="offline" style={{ color: 'var(--money)', borderColor: '#4ade8033', background: 'var(--money-dim)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <IcCheck width={14} height={14} /> You’ve been invited — create your account to join.
          </div>
        )}
        {err && <div className="offline" style={{ color: 'var(--danger)', borderColor: '#ff5a5a33', background: '#ff5a5a12' }}>{err}</div>}

        <div className="field-label">Email</div>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email"
          onKeyDown={(e) => e.key === 'Enter' && submit()} style={inputStyle} />
        <div style={{ height: 14 }} />
        <div className="field-label">Password</div>
        <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" autoComplete={isSignup ? 'new-password' : 'current-password'}
          onKeyDown={(e) => e.key === 'Enter' && submit()} style={inputStyle} />
        <div style={{ height: 20 }} />
        <button className="btn grad" onClick={submit} disabled={busy || !email || pw.length < 6}>
          {busy ? (isSignup ? 'Creating…' : 'Signing in…') : isSignup ? `Create account & join` : `Sign in to ${p.title}`}
        </button>

        {isSignup && (
          <p className="note" style={{ textAlign: 'center', marginTop: 12 }}>
            By creating an account you agree to our{' '}
            <a href="/legal/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--info)' }}>Terms</a> and{' '}
            <a href="/legal/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--info)' }}>Privacy Policy</a>.
          </p>
        )}

        <p className="note" style={{ textAlign: 'center', marginTop: 14 }}>
          <a onClick={() => { setMode(isSignup ? 'signin' : 'signup'); setErr(null); }} style={{ color: 'var(--info)', cursor: 'pointer' }}>
            {isSignup ? 'Already have an account? Sign in' : 'Have an invite? Create your account'}
          </a>
        </p>
        {onBeta && <p className="note" style={{ textAlign: 'center', marginTop: 6 }}>
          No invite? <a onClick={onBeta} style={{ color: 'var(--info)', cursor: 'pointer', fontWeight: 700 }}>Request beta access</a>
        </p>}
        <p className="note" style={{ textAlign: 'center', marginTop: 6 }}>
          Protected by row-level security. Sensitive data is AES-256 encrypted at rest.
        </p>
        <p className="note" style={{ textAlign: 'center', marginTop: 6 }}>
          <a onClick={onSwitch} style={{ color: 'var(--info)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {portal === 'crew' ? 'Office staff? Switch portal' : 'On the crew? Switch portal'}
            <IcChevron width={12} height={12} />
          </a>
        </p>
        <p className="note" style={{ textAlign: 'center', marginTop: 18, color: 'var(--text-faint)' }}>
          <a href="/legal/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>Terms</a>
          {'  ·  '}
          <a href="/legal/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>Privacy</a>
        </p>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)',
  color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 15, padding: 13, borderRadius: 10,
};

export function SignOutButton() {
  if (!isConfigured()) return null;
  return (
    <button className="btn ghost sm icon-btn" onClick={signOut} title="Sign out" aria-label="Sign out">
      <IcLogout width={16} height={16} /> <span className="btn-label">Sign out</span>
    </button>
  );
}

export function AccountButton({ onOpen }) {
  const [open, setOpen] = useState(false);
  if (!isConfigured()) return null;
  return (
    <>
      <button className="btn ghost sm icon-btn" onClick={() => (onOpen ? onOpen() : setOpen(true))} title="Settings" aria-label="Settings">
        <IcGear width={16} height={16} /> <span className="btn-label">Settings</span>
      </button>
      {open && <ChangePasswordModal onClose={() => setOpen(false)} />}
    </>
  );
}

function ChangePasswordModal({ onClose }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(false);

  const mismatch = pw2 && pw !== pw2;
  const tooShort = pw && pw.length < 6;
  const canSubmit = pw.length >= 6 && pw === pw2 && !busy;

  const submit = async () => {
    setErr(null); setBusy(true);
    try { await updatePassword(pw); setDone(true); }
    catch (e) { setErr(e.message || 'Could not update password'); }
    finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 100,
      display: 'grid', placeItems: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 360,
        background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 18 }}>
          <span style={{ fontWeight: 800, fontSize: 16 }}>Change password</span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost sm icon-btn" onClick={onClose} aria-label="Close"><IcX width={15} height={15} /></button>
        </div>

        {done ? (
          <>
            <p style={{ color: 'var(--text)', fontSize: 14, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}><IcCheck width={16} height={16} /> Password updated.</p>
            <button className="btn grad" onClick={onClose}>Done</button>
          </>
        ) : (
          <>
            {err && <div className="offline" style={{ color: 'var(--danger)', borderColor: '#ff5a5a33',
              background: '#ff5a5a12', marginBottom: 14 }}>{err}</div>}

            <div className="field-label">New password</div>
            <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" autoComplete="new-password"
              style={inputStyle} />
            {tooShort && <p className="note" style={{ color: 'var(--danger)', marginTop: 6 }}>At least 6 characters.</p>}
            <div style={{ height: 14 }} />
            <div className="field-label">Confirm new password</div>
            <input value={pw2} onChange={(e) => setPw2(e.target.value)} type="password" autoComplete="new-password"
              onKeyDown={(e) => e.key === 'Enter' && canSubmit && submit()}
              style={inputStyle} />
            {mismatch && <p className="note" style={{ color: 'var(--danger)', marginTop: 6 }}>Passwords don't match.</p>}
            <div style={{ height: 20 }} />
            <button className="btn grad" onClick={submit} disabled={!canSubmit}>
              {busy ? 'Updating…' : 'Update password'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
