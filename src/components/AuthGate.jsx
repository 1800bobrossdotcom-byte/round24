import { useState, useEffect, createContext, useContext } from 'react';
import { supabase, isConfigured, signIn, signUp, signOut, getSession, onAuthChange, updatePassword, fetchMembership, redeemInvite, inviteInfo, requestBeta, isPlatformAdmin, sendWelcomeEmail, getMyResident } from '../lib/backend/supabase.js';
import { Mark, BrandLockup, IcGear, IcLogout, IcWrench, IcChart, IcBuilding, IcX, IcCheck, IcChevron, IcMapPin, IcMic, IcReceipt, IcShield } from './ui.jsx';
import Platform from '../views/Platform.jsx';
import ResidentHome from '../views/ResidentHome.jsx';

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

  // welcome email: fire once, on the first session after signup (works whether
  // or not email confirmation delays the session). Flag set by the signup form.
  useEffect(() => {
    if (!session) return;
    try {
      if (localStorage.getItem('caliper_pending_welcome')) {
        localStorage.removeItem('caliper_pending_welcome');
        sendWelcomeEmail().catch(() => {});
      }
    } catch { /* ignore */ }
  }, [session]);

  const [resident, setResident] = useState(null); // Round24 Community: residency (no staff membership)
  useEffect(() => {
    if (!isConfigured() || !session) { setMem(null); setResident(null); setMemReady(false); return; }
    let on = true;
    (async () => {
      let m = await fetchMembership().catch(() => null);
      // brand-new user with an invite code → place them into the org now
      if (!m && getPendingInvite()) {
        try { await redeemInvite(getPendingInvite()); clearPendingInvite(); setInvite(null); m = await fetchMembership().catch(() => null); }
        catch { /* bad/used/expired invite — stays unonboarded */ }
      }
      // fetch any residency too — staff can ALSO live in a building they manage
      // (founder / crew-resident dual-hat). Without a seat it routes them to the
      // resident home; with one, the shell surfaces a "My Home" tab.
      const r = await getMyResident().catch(() => null);
      if (on) { setMem(m); setResident(r); setMemReady(true); }
    })();
    return () => { on = false; };
  }, [session]);

  // demo-only role (office = admin, crew = tech); remembered per device
  const [demoRole, setDemoRoleState] = useState(() => {
    try { return localStorage.getItem('caliper_demo_role') === 'tech' ? 'tech' : 'admin'; } catch { return 'admin'; }
  });
  const setDemoRole = (r) => { setDemoRoleState(r); try { localStorage.setItem('caliper_demo_role', r); } catch { /* no storage */ } };

  if (!ready) return null;

  // demo mode — backend not wired yet, app runs on seed data with full suite.
  // The banner carries an office/crew switch so a demo can show the field
  // tools (Field timer, crew timesheet) without a backend or a real seat.
  if (!isConfigured()) {
    return (
      <AuthCtx.Provider value={{ session: null, role: demoRole, orgId: null }}>
        <div className="demo-wrap">
          <div className="demo-banner">
            <span>◑ Demo<span className="long"> mode · sample data · connect Supabase for secure login &amp; real data</span></span>
            <span className="demo-role" role="group" aria-label="Demo role">
              <button type="button" className={demoRole === 'admin' ? 'on' : ''} onClick={() => setDemoRole('admin')}>Office</button>
              <button type="button" className={demoRole === 'tech' ? 'on' : ''} onClick={() => setDemoRole('tech')}>Crew</button>
            </span>
          </div>
          {children}
        </div>
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

  // a resident (Round24 Community) gets their own home — never the staff shell
  if (!mem && resident && resident.status !== 'declined') return <ResidentHome resident={resident} />;
  // signed in but not part of any workspace yet → let them redeem an invite
  if (!mem) return <NeedsAccess />;

  return (
    <AuthCtx.Provider value={{ session, role: mem.role, orgId: mem.org_id, orgName: mem.orgName, orgKind: mem.orgKind || 'company',
      theme: mem.theme || {}, patchOrg: (patch) => setMem((m) => (m ? { ...m, ...patch } : m)),
      resident: resident && resident.status !== 'declined' ? resident : null }}>
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

  // extract an org id from a pasted join link (or a bare id) → the resident flow
  const gotoJoin = (raw) => {
    const s = (raw || '').trim(); if (!s) return;
    const m = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    const org = m ? m[0] : (/^join=/.test(s) ? s.split('join=')[1] : null);
    if (org) window.location.href = `/?join=${encodeURIComponent(org)}`;
  };

  const join = async () => {
    setErr(null); setBusy(true);
    try { await redeemInvite(code.trim().toUpperCase()); clearPendingInvite(); window.location.reload(); }
    catch (e) { setErr(e.message || 'That invite code isn’t valid or has been used.'); setBusy(false); }
  };
  const request = async () => {
    setErr(null); setBusy(true);
    try { await requestBeta({ orgName: name.trim(), note: note.trim() || null, kind }); setSent(true); }
    catch (e) { setErr(e.message || 'Could not send your request.'); }
    finally { setBusy(false); }
  };

  // a resident who signed in via Community but hasn't joined a building yet →
  // point them at their office's link (or let them paste it) rather than the
  // staff invite/beta flow.
  let cameFromCommunity = false;
  try { cameFromCommunity = localStorage.getItem('caliper_product') === 'community'; } catch { /* no storage */ }
  if (cameFromCommunity && plat === false) {
    return (
      <div className="community-scope" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 380, textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}><BrandLockup /></div>
          <div style={{ fontWeight: 800, fontSize: 17, marginTop: 12 }}>Join your building</div>
          <p className="note" style={{ margin: '8px 0 16px' }}>You're signed in. To finish, open the join link your management office shared — or paste it below.</p>
          <input placeholder="Paste your building's join link" onKeyDown={(e) => { if (e.key === 'Enter') gotoJoin(e.currentTarget.value); }}
            id="join-paste" style={inputStyle} />
          <button className="btn grad" style={{ marginTop: 12 }} onClick={() => gotoJoin(document.getElementById('join-paste')?.value || '')}>Continue</button>
          <p className="note" style={{ marginTop: 16 }}><a onClick={() => { try { localStorage.removeItem('caliper_product'); } catch { /* */ } window.location.reload(); }} style={{ color: 'var(--text-dim)', cursor: 'pointer' }}>Not a resident? Switch</a></p>
          <div style={{ marginTop: 14 }}><SignOutButton /></div>
        </div>
      </div>
    );
  }

  // superadmin without an org → the platform console (provision / approve)
  if (plat) {
    return (
      <div className="app desk" style={{ minHeight: '100vh' }}>
        <header className="topbar" style={{ position: 'static' }}>
          <div className="brand"><Mark /> Round24 <span className="sub">platform</span></div>
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
          <div className="offline" style={{ color: 'var(--money)', borderColor: 'color-mix(in srgb, var(--money) 20%, transparent)', background: 'var(--money-dim)' }}>
            <IcCheck width={14} height={14} /> Request sent. You’ll get an invite link once it’s approved.
          </div>
        ) : (
          <>
            <div className="seg" style={{ marginBottom: 16 }}>
              <button className={tab === 'join' ? 'on' : ''} onClick={() => { setTab('join'); setErr(null); }}>Join with invite</button>
              <button className={tab === 'request' ? 'on' : ''} onClick={() => { setTab('request'); setErr(null); }}>Request a workspace</button>
            </div>

            {err && <div className="offline" style={{ color: 'var(--danger)', borderColor: 'color-mix(in srgb, var(--danger) 20%, transparent)', background: 'color-mix(in srgb, var(--danger) 7%, transparent)' }}>{err}</div>}

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
                  <button className={kind === 'owner' ? 'on' : ''} onClick={() => setKind('owner')}>I own / manage buildings</button>
                </div>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'owner' ? 'Company, estate, or portfolio' : 'Company name'} style={inputStyle} />
                <div style={{ height: 10 }} />
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything we should know? (optional)" style={inputStyle} />
                <div style={{ height: 14 }} />
                <button className="btn grad" onClick={request} disabled={busy || !name.trim()}>{busy ? 'Sending…' : 'Request beta invite'}</button>
                <p className="note" style={{ marginTop: 10 }}>Round24 is in private beta — we’ll send an invite once approved.</p>
              </>
            )}
          </>
        )}
        <p className="note" style={{ marginTop: 16 }}><a onClick={signOut} style={{ color: 'var(--info)', cursor: 'pointer' }}>Sign out</a></p>
      </div>
    </div>
  );
}

// ---- two products, one secure backend ----
// Round24 Enterprise → commercial estates: office parks & towers, many tenants
//                      and buildings (internal product key stays `portfolio`)
// Round24 Pro        → maintenance companies, split into Office + Crew portals
// The choice only themes the login; after sign-in the org's KIND and the user's
// ROLE decide the actual shell + toolset (server-enforced by RLS + getdek).
const PORTALS = {
  crew: {
    title: 'Crew Portal',
    tagline: 'Clock in. Get your orders. Snap your receipts.',
    points: ['Your work orders', 'Job timer', 'Receipt reimbursement'],
  },
  office: {
    title: 'Office Portal',
    tagline: 'The whole operation, around the clock.',
    points: ['Dashboards & financials', 'Dispatch work orders', 'Documents & purchasing'],
  },
};
// login branding per tier/portal — chip label, icon, tagline.
const BRANDS = {
  portfolio: { chip: 'enterprise', Icon: IcBuilding, tagline: 'The whole estate, around the clock.' },
  office: { chip: 'office', Icon: IcChart, tagline: 'The whole operation, around the clock.' },
  crew: { chip: 'crew', Icon: IcWrench, tagline: 'Clock in. Get your orders. Snap your receipts.' },
  community: { chip: 'community', Icon: IcBuilding, tagline: 'Your building, in your pocket.' },
};
// top-level product cards (the main page). Ordered as the ladder:
// Pro (operators) → Enterprise (commercial estates) → Community (tenants).
// NOTE: Enterprise keeps the internal `portfolio` product key — it's the same
// multi-building engine, one layer up. Commercial-specific features (CAM
// reconciliation, COI, commercial service requests) phase in on top.
const PRODUCTS = {
  pro: {
    title: 'Round24 Pro',
    Icon: IcChart,
    tagline: 'For maintenance companies & their crews.',
    points: ['Office: dashboards & dispatch', 'Crew: timers & receipts', 'Team, compliance & payroll'],
  },
  portfolio: {
    title: 'Round24 Enterprise',
    Icon: IcBuilding,
    tagline: 'For office parks & towers — many tenants, many buildings, one ledger.',
    points: ['Multi-building roll-ups & dashboards', 'Auditable operating cost per suite', 'Measured labor across the estate'],
  },
  community: {
    title: 'Round24 Community',
    Icon: IcBuilding,
    tagline: 'For residents & tenants — report repairs and reach your building.',
    points: ['Report a repair in seconds', 'Follow it to done', 'Hear from your management office'],
  },
};

// "What is Round24" — the landing page after the splash. Explains the product
// and routes to a beta invite request or the sign-in picker.
const LANDING_FEATURES = [
  { Icon: IcMapPin, title: 'Measured labor', body: 'Geofenced clock-in and a hands-free field timer put real hours on the right door — not a guess, not a spreadsheet after the fact.' },
  { Icon: IcChart, title: 'Connected money', body: 'Rent, receipts, and pay flow into per-door P&L, expense forecasts, and monthly statements that assemble themselves.' },
  { Icon: IcMic, title: 'Built for the field', body: 'Offline-safe and voice-driven on any phone. Import the pay logs and rent rolls you already keep — Round24 reads them.' },
  { Icon: IcBuilding, title: 'The whole building', body: 'Residents report repairs, follow them to done, and hear from the office — Round24 Community turns a ticket queue into a building that runs itself.' },
];
// a framed product screenshot (browser-chrome mockup). Images are captured from
// the app in DEMO mode — fictional company/buildings/people, sample numbers.
function Shot({ src, alt }) {
  return (
    <figure className="lp-frame" style={{ margin: 0 }}>
      <div className="lp-bar"><span /><span /><span /></div>
      <img src={src} alt={alt} loading="lazy" />
    </figure>
  );
}

// The fresh-visitor marketing funnel: info + proof + product, with sign-in and
// beta CTAs threaded throughout. Returning users skip this (see Login()).
function Landing({ onEnter, onBeta }) {
  const PRODS = [
    { Icon: IcChart, name: 'Round24 Pro', tag: 'Maintenance companies — office dispatch + a crew in the field.' },
    { Icon: IcBuilding, name: 'Round24 Enterprise', tag: 'Office parks & towers — many tenants and buildings, one measured ledger.' },
    { Icon: IcBuilding, name: 'Round24 Community', tag: 'Residents & tenants — report a repair, follow it to done, reach your building.' },
  ];
  return (
    <div className="lp">
      {/* sticky header — logo only; the hero carries the Sign in / Request beta
          CTAs, so header buttons would just double them up (and wrap on mobile) */}
      <header className="lp-head">
        <div className="lp-head-in">
          <BrandLockup />
        </div>
      </header>

      {/* hero */}
      <section className="lp-wrap lp-hero">
        <span className="lp-ey">Property maintenance · around the clock</span>
        <h1>The maintenance platform that <span className="grad-text">measures the labor</span>.</h1>
        <p className="lp-sub">Every hour, receipt, and door — reconciled automatically. Round24 turns the pay logs, rent rolls, and P&amp;L sheets your crew and office keep by hand into one connected, encrypted ledger — and gives your residents a way in, so the whole building runs on one system.</p>
        <div className="lp-cta">
          <button className="btn grad" onClick={onBeta}>Request beta access →</button>
          <button className="btn ghost" onClick={onEnter}>Sign in</button>
        </div>
        <p className="lp-trust">🔒 AES-256 encrypted · live in beta · built by the crew that had the problem</p>
        <Shot src="/shots/dash.png" alt="Round24 dashboard — true labor cost, reconciled to each building" />
      </section>

      {/* the problem */}
      <section className="lp-band"><div className="lp-wrap">
        <span className="lp-ey">The problem</span>
        <h2>The books say one thing. The field did another. Nobody could prove which.</h2>
        <p className="lp-p">Rent is tracked to the dollar. But the labor — the biggest controllable cost in the building — lives in pay logs, texts, and memory. When an owner asks what a unit actually cost to maintain, the honest answer is a guess. Round24 measures it.</p>
      </div></section>

      {/* how it works — the loop */}
      <section className="lp-wrap lp-sec">
        <span className="lp-ey">How it works</span>
        <h2>One connected ledger, from the timer in the field to the P&amp;L per door.</h2>
        <div className="lp-steps">
          <div className="lp-step"><div className="n">01 · Field</div><h3>Measure the hour</h3><p>Crews clock in with a geofenced, hands-free timer and snap receipts — real hours and materials, on the right door, not a spreadsheet after the fact.</p></div>
          <div className="lp-step"><div className="n">02 · Allocate</div><h3>Reconcile it automatically</h3><p>Every hour and dollar lands on the building and unit it was spent on — the allocation engine does the math the moment a timer closes.</p></div>
          <div className="lp-step"><div className="n">03 · Prove</div><h3>See the true cost</h3><p>Per-door P&amp;L, forecasts, and statements that assemble themselves — the one number nobody else in the category can produce.</p></div>
        </div>
      </section>

      {/* scene: per-door P&L */}
      <section className="lp-wrap lp-sec">
        <div className="lp-scene">
          <div className="lp-scene-txt">
            <span className="lp-ey">Per-door P&amp;L</span>
            <h3>The bottom line of every door — rent in, verified labor and materials out.</h3>
            <p>Change a rate or log a job and every building's P&amp;L moves. Labor comes straight from the crew's verified timers; materials from approved receipts. It's the connected ledger, end to end — and it's running today.</p>
          </div>
          <Shot src="/shots/pnl.png" alt="Per-door P&L — rent, labor, materials and net for each building" />
        </div>
      </section>

      {/* scene: work orders + mobile */}
      <section className="lp-wrap lp-sec">
        <div className="lp-scene rev">
          <div className="lp-scene-txt">
            <span className="lp-ey">Built for the field</span>
            <h3>Voice-driven, offline-safe, and mobile-first — for people who never had software.</h3>
            <p>Say a work order out loud. Report a repair with a photo. Split a day across four buildings from a phone in a stairwell. Import the pay logs and rent rolls you already keep — Round24 reads them.</p>
          </div>
          <div className="lp-phone"><img src="/shots/mobile-wo.png" alt="Round24 work orders on a phone" loading="lazy" /></div>
        </div>
      </section>

      {/* three products → portals */}
      <section className="lp-band"><div className="lp-wrap">
        <span className="lp-ey">Three products, one spine</span>
        <h2>Everyone in the building — priced to the person using it.</h2>
        <div className="lp-products">
          {PRODS.map((p) => (
            <button key={p.name} className="lp-prod" onClick={onEnter}>
              <div className="ic"><p.Icon width={24} height={24} /></div>
              <b>{p.name}</b>
              <div className="t">{p.tag}</div>
              <div className="go">Sign in →</div>
            </button>
          ))}
        </div>
      </div></section>

      {/* proof — honest */}
      <section className="lp-wrap lp-sec">
        <span className="lp-ey">Why trust it</span>
        <h2>Above-market security. Built inside a real operation.</h2>
        <div className="lp-steps">
          <div className="lp-step"><div className="n">Encrypted</div><h3>AES-256 + KMS</h3><p>Pay data and identity fields are field-encrypted with per-org keys; row-level security scopes every read and write at the database.</p></div>
          <div className="lp-step"><div className="n">Live</div><h3>Real beta, real data</h3><p>Round24 runs a working multi-building maintenance operation in production today — the design partner and first proving ground.</p></div>
          <div className="lp-step"><div className="n">Native</div><h3>Reads what you keep</h3><p>Excel-native onboarding. Rent Manager sync. No rip-and-replace — Round24 owns the operational ledger and syncs the rest.</p></div>
        </div>
      </section>

      {/* final CTA */}
      <section className="lp-final">
        <h2 style={{ margin: '0 auto', maxWidth: '20ch' }}>Every door, every round.</h2>
        <p className="lp-sub" style={{ margin: '14px auto 0' }}>Request a beta invite, or sign in to your portal.</p>
        <div className="lp-cta">
          <button className="btn grad" onClick={onBeta}>Request beta access →</button>
          <button className="btn ghost" onClick={onEnter}>Sign in</button>
        </div>
      </section>

      <footer className="lp-foot"><IcShield width={12} height={12} style={{ verticalAlign: -2 }} /> Private beta · AES-256 encrypted · screenshots use sample data</footer>
    </div>
  );
}

function Login({ invite }) {
  const [product, setProduct] = useState(() => localStorage.getItem('caliper_product') || null); // 'portfolio' | 'pro'
  const [portal, setPortal] = useState(() => localStorage.getItem('caliper_portal') || null);     // pro only: 'office' | 'crew'
  const [beta, setBeta] = useState(false);
  // round24.app IS the funnel: every signed-out visit lands on it — sign-in
  // is one tap away in the sticky header. Invite links skip straight to sign-in,
  // and once you head for sign-in it sticks for the browser session only, so a
  // mid-login refresh doesn't bounce you back to marketing.
  const [entered, setEntered] = useState(() => !!sessionStorage.getItem('caliper_signin') || !!invite);
  // only block on the invite lookup when we don't already know the tier; and
  // never hang on it — a slow/failed lookup falls through to the picker.
  const [resolving, setResolving] = useState(!!invite && !localStorage.getItem('caliper_product'));

  // an invite forces the matching tier: owner workspace → Portfolio, company → Pro
  useEffect(() => {
    if (!invite) return;
    let on = true;
    const stop = () => { if (on) setResolving(false); };
    const t = setTimeout(stop, 2500); // safety: login can't get stuck on the lookup
    inviteInfo(invite).then((info) => {
      if (!on) return;
      if (info?.kind === 'owner') { setProduct('portfolio'); localStorage.setItem('caliper_product', 'portfolio'); }
      else if (info?.kind) { setProduct('pro'); localStorage.setItem('caliper_product', 'pro'); }
      clearTimeout(t); setResolving(false);
    }).catch(() => { if (on) { clearTimeout(t); setResolving(false); } }); // a failed lookup shouldn't hang the splash
    return () => { on = false; clearTimeout(t); };
  }, [invite]);

  const pickProduct = (p) => { localStorage.setItem('caliper_product', p); setProduct(p); };
  const pickPortal = (p) => { localStorage.setItem('caliper_portal', p); setPortal(p); };
  const reset = () => { localStorage.removeItem('caliper_product'); localStorage.removeItem('caliper_portal'); setProduct(null); setPortal(null); };
  const backToProducts = () => { localStorage.removeItem('caliper_product'); localStorage.removeItem('caliper_portal'); setPortal(null); setProduct(null); };

  if (beta) return <BetaRequest onBack={() => setBeta(false)} />;
  if (resolving) return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--text-faint)', fontFamily: 'var(--font)', fontSize: 13, fontWeight: 700 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Mark /> opening your invite…</div>
    </div>
  );

  // landing — the marketing funnel, shown to everyone signed out (even with a
  // remembered product: they land here, and Sign in drops them into that login)
  if (!entered) {
    return <Landing onEnter={() => { sessionStorage.setItem('caliper_signin', '1'); setEntered(true); }} onBeta={() => setBeta(true)} />;
  }

  // level 1 — the sign-in page: choose a product
  if (!product) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        {/* Layer 1 discoverability link — fixed so it needs no positioned
            ancestor and no changes to the card layout below */}
        <a href="#developer" style={{
          position: 'fixed', top: 16, right: 16, zIndex: 10,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '7px 14px', borderRadius: 2,
          background: 'linear-gradient(var(--surface-2), var(--surface-2)) padding-box, var(--grad) border-box',
          border: '1.5px solid transparent',
          fontFamily: 'var(--font)', fontWeight: 700, fontSize: 12.5, color: 'var(--text)',
          textDecoration: 'none', cursor: 'pointer',
          boxShadow: '0 2px 10px -2px rgba(0,0,0,.15)',
        }}>
          <IcShield width={14} height={14} /> Developer
        </a>
        <div style={{ width: '100%', maxWidth: 720 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}><BrandLockup /></div>
          <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13, marginBottom: 26 }}>Around the clock. Which Round24 is yours?</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'stretch' }}>
            {Object.entries(PRODUCTS).map(([key, p]) => (
              <button key={key} onClick={() => pickProduct(key)} className="card portal-card" style={{
                flex: '1 1 260px', minWidth: 0, marginTop: 0,
                cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font)', color: 'var(--text)',
                border: '1px solid var(--line)', padding: 22,
              }}>
                <div style={{ marginBottom: 10, color: 'var(--accent)' }}><p.Icon width={26} height={26} /></div>
                <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>{p.title}</div>
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
            <span style={{ color: 'var(--text-faint)', margin: '0 8px' }}>·</span>
            <a onClick={() => { sessionStorage.removeItem('caliper_signin'); setEntered(false); }} style={{ color: 'var(--text-dim)', cursor: 'pointer' }}>What is Round24?</a>
          </p>
        </div>
      </div>
    );
  }

  // Community (residents) → its own warm-palette login. No beta gate; residents
  // arrive via a building join link, so sign-in routes to their home and the
  // no-residency fallback points them at their office's link.
  if (product === 'community') {
    return (
      <div className="community-scope" style={{ minHeight: '100vh' }}>
        <LoginForm brand="community" invite={invite} onSwitch={backToProducts} switchLabel="Not a resident? Choose a different Round24" community />
      </div>
    );
  }

  // Portfolio → straight to the branded login
  if (product === 'portfolio') {
    return <LoginForm brand="portfolio" invite={invite} onBeta={() => setBeta(true)} onSwitch={reset} switchLabel="Not enterprise? Choose a different Round24" />;
  }

  // Pro → level 2: pick Office or Crew
  if (!portal) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 640 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginBottom: 6 }}>
            <BrandLockup /><span className="chip">pro</span>
          </div>
          <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13, marginBottom: 26 }}>Pick your door.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'stretch' }}>
            {Object.entries(PORTALS).map(([key, p]) => (
              <button key={key} onClick={() => pickPortal(key)} className="card portal-card" style={{
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
            <a onClick={backToProducts} style={{ color: 'var(--info)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>← Back to products</a>
          </p>
        </div>
      </div>
    );
  }
  return <LoginForm brand={portal} invite={invite} onBeta={() => setBeta(true)} onSwitch={() => { localStorage.removeItem('caliper_portal'); setPortal(null); }}
    switchLabel={portal === 'crew' ? 'Office staff? Switch portal' : 'On the crew? Switch portal'} />;
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
        <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13, margin: '6px 0 16px' }}>Round24 is in private beta. Tell us a bit about you and we’ll send an invite.</p>

        {sent ? (
          <>
            <div className="offline" style={{ color: 'var(--money)', borderColor: 'color-mix(in srgb, var(--money) 20%, transparent)', background: 'var(--money-dim)', display: 'flex', gap: 8 }}>
              <IcCheck width={16} height={16} /> Thanks{f.name ? `, ${f.name.split(' ')[0]}` : ''} — you’re on the list. We’ll email an invite to <b>{f.email}</b>.
            </div>
            <p className="note" style={{ textAlign: 'center', marginTop: 14 }}><a onClick={onBack} style={{ color: 'var(--info)', cursor: 'pointer' }}>← Back to sign in</a></p>
          </>
        ) : (
          <>
            <div className="seg" style={{ marginBottom: 12 }}>
              <button className={f.kind === 'company' ? 'on' : ''} onClick={() => set('kind', 'company')}>Company + crew</button>
              <button className={f.kind === 'owner' ? 'on' : ''} onClick={() => set('kind', 'owner')}>I own / manage buildings</button>
            </div>
            {err && <div className="offline" style={{ color: 'var(--danger)', borderColor: 'color-mix(in srgb, var(--danger) 20%, transparent)', background: 'color-mix(in srgb, var(--danger) 7%, transparent)' }}>{err}</div>}
            <input value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="Email *" type="email" autoComplete="email" style={inputStyle} />
            <div style={{ height: 10 }} />
            <input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Your name" style={inputStyle} />
            <div style={{ height: 10 }} />
            <input value={f.company} onChange={(e) => set('company', e.target.value)} placeholder={f.kind === 'owner' ? 'Company / estate name (optional)' : 'Company name (optional)'} style={inputStyle} />
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

function LoginForm({ brand, onSwitch, onBeta, invite, switchLabel, community = false }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [mode, setMode] = useState(invite ? 'signup' : 'signin'); // invited → create account
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const b = BRANDS[brand] || BRANDS.office;
  const isSignup = mode === 'signup';

  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      if (isSignup) {
        await signUp(email, pw);   // invite is redeemed post-auth by AuthGate
        // mark for a welcome email on first authenticated session — sending now
        // would 401 when email confirmation is on (no session yet).
        try { localStorage.setItem('caliper_pending_welcome', '1'); } catch { /* ignore */ }
      } else await signIn(email, pw);
    } catch (e) { setErr(e.message || (isSignup ? 'Could not create account' : 'Sign-in failed')); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', marginBottom: 8 }}>
          <BrandLockup />
          <span className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <b.Icon width={12} height={12} />
            {b.chip}
          </span>
        </div>
        <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13, marginBottom: 20 }}>{b.tagline}</p>

        {invite && isSignup && (
          <div className="offline" style={{ color: 'var(--money)', borderColor: 'color-mix(in srgb, var(--money) 20%, transparent)', background: 'var(--money-dim)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <IcCheck width={14} height={14} /> You’ve been invited — create your account to join.
          </div>
        )}
        {err && <div className="offline" style={{ color: 'var(--danger)', borderColor: 'color-mix(in srgb, var(--danger) 20%, transparent)', background: 'color-mix(in srgb, var(--danger) 7%, transparent)' }}>{err}</div>}

        <div className="field-label">Email</div>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email"
          onKeyDown={(e) => e.key === 'Enter' && submit()} style={inputStyle} />
        <div style={{ height: 14 }} />
        <div className="field-label">Password</div>
        <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" autoComplete={isSignup ? 'new-password' : 'current-password'}
          onKeyDown={(e) => e.key === 'Enter' && submit()} style={inputStyle} />
        <div style={{ height: 20 }} />
        <button className="btn grad" onClick={submit} disabled={busy || !email || pw.length < (isSignup ? 10 : 6)}>
          {busy ? (isSignup ? 'Creating…' : 'Signing in…') : isSignup ? `Create account & join` : `Sign in`}
        </button>

        {isSignup && (
          <p className="note" style={{ textAlign: 'center', marginTop: 10, fontSize: 11.5 }}>
            By continuing you agree to our{' '}
            <a href="/legal/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--info)' }}>Terms</a> &amp;{' '}
            <a href="/legal/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--info)' }}>Privacy</a>.
          </p>
        )}

        {/* primary: switch sign-in ⇄ create, and the no-invite path — grouped together */}
        <div style={{ textAlign: 'center', marginTop: 16, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <a onClick={() => { setMode(isSignup ? 'signin' : 'signup'); setErr(null); }} style={{ color: 'var(--info)', cursor: 'pointer', fontSize: 13.5, fontWeight: 600 }}>
            {isSignup ? 'Already have an account? Sign in' : community ? 'New here? Create your account' : 'Have an invite? Create your account'}
          </a>
          {community ? (
            <span className="note" style={{ margin: 0 }}>Joining a building? Open the link your management office shared.</span>
          ) : onBeta && (
            <span className="note" style={{ margin: 0 }}>
              No invite? <a onClick={onBeta} style={{ color: 'var(--info)', cursor: 'pointer', fontWeight: 700 }}>Request beta access</a>
            </span>
          )}
        </div>

        {/* secondary: wrong persona */}
        <div style={{ borderTop: '1px solid var(--line)', margin: '16px 0 0' }} />
        <p className="note" style={{ textAlign: 'center', marginTop: 12 }}>
          <a onClick={onSwitch} style={{ color: 'var(--text-dim)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {switchLabel || 'Switch portal'}
            <IcChevron width={12} height={12} />
          </a>
        </p>

        {/* fine print: trust + legal, one muted line */}
        <p className="note" style={{ textAlign: 'center', marginTop: 14, color: 'var(--text-faint)', fontSize: 11 }}>
          🔒 AES-256 encrypted · row-level security
          <br />
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
  color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 15, padding: 13, borderRadius: 3,
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
  const tooShort = pw && pw.length < 10;
  const canSubmit = pw.length >= 10 && pw === pw2 && !busy;

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
        background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 4, padding: 24 }}>
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
            {err && <div className="offline" style={{ color: 'var(--danger)', borderColor: 'color-mix(in srgb, var(--danger) 20%, transparent)',
              background: 'color-mix(in srgb, var(--danger) 7%, transparent)', marginBottom: 14 }}>{err}</div>}

            <div className="field-label">New password</div>
            <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" autoComplete="new-password"
              style={inputStyle} />
            {tooShort && <p className="note" style={{ color: 'var(--danger)', marginTop: 6 }}>At least 10 characters.</p>}
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
