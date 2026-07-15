// src/layer1-developer/DeveloperShell.jsx
// Layer 1 — Developer console. Restricted to platform_admins (Gianni + you).
//
// The real gate is server-side: every function in layer1Api.js checks
// is_platform_admin() and raises if the caller isn't one. The isPlatformAdmin()
// check below just avoids flashing the console at someone who'd get RPC
// errors anyway — it is not the security boundary, so don't rely on it as one.
//
// Mounted via a hash check (#developer) in App.jsx — see
// TASK02-CLAUDE-CODE-PROMPT.md for the two-line integration snippet. Deliberately
// NOT wired through AuthGate's product/portal picker state or its AuthCtx
// value — that's exactly where the last patch collided with Gianni's resident
// work. This is a parallel entry point that doesn't touch those lines at all.

import { useEffect, useState } from 'react';
import './theme.css';
import { isPlatformAdmin, getSession, layer1SweepSupport } from '../lib/backend/layer1Api.js';
import { Mark } from '../components/ui.jsx';

import Overview from './sections/Overview.jsx';
import GlobalUI from './sections/GlobalUI.jsx';
import Workspaces from './sections/Workspaces.jsx';
import Users from './sections/Users.jsx';
import Developers from './sections/Developers.jsx';
import Audit from './sections/Audit.jsx';

const SECTIONS = [
  { id: 'overview', label: 'Overview', Component: Overview },
  { id: 'workspaces', label: 'Workspaces', Component: Workspaces },
  { id: 'users', label: 'Users', Component: Users },
  { id: 'globalui', label: 'Global UI', Component: GlobalUI },
  { id: 'developers', label: 'Developers', Component: Developers },
  { id: 'audit', label: 'Audit', Component: Audit },
];

export default function DeveloperShell({ onExit }) {
  const [allowed, setAllowed] = useState(null); // null = still checking
  const [signedIn, setSignedIn] = useState(null); // null = still checking
  const [section, setSection] = useState('overview');

  useEffect(() => {
    let on = true;
    // fire-and-forget: clear any expired support seats so a dead session
    // can't linger as a half-live membership (see platform_sweep_support).
    layer1SweepSupport().catch(() => {});
    getSession().then((s) => { if (on) setSignedIn(!!s); }).catch(() => { if (on) setSignedIn(false); });
    isPlatformAdmin().then((v) => { if (on) setAllowed(v); });
    return () => { on = false; };
  }, []);

  if (allowed === null || signedIn === null) return <div className="layer1-root" />;

  if (!allowed) {
    // is_platform_admin() is always false for a signed-out client, so tell
    // that audience to sign in rather than to chase an allowlist seat.
    return (
      <div className="layer1-root" style={{ display: 'grid', placeItems: 'center', padding: 40 }}>
        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          <p style={{ fontFamily: 'var(--font)', color: 'var(--text)', fontWeight: 600, margin: 0 }}>
            {signedIn ? 'Not authorized' : 'Sign in first'}
          </p>
          <p style={{ fontFamily: 'var(--font)', color: 'var(--text-dim)', fontSize: 13, marginTop: 8 }}>
            {signedIn
              ? "This console is restricted to platform admins. If that's wrong, ask an existing admin to add you from the Developers tab."
              : 'The developer console needs a signed-in Caliper session. Go back, sign in as usual, then return here via the Developer link or #developer.'}
          </p>
          <button className="btn ghost sm" style={{ marginTop: 16 }} onClick={onExit}>Back to Caliper</button>
        </div>
      </div>
    );
  }

  const Active = SECTIONS.find((s) => s.id === section)?.Component ?? Overview;

  return (
    <div className="layer1-root">
      <div className="layer1-strip" />
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '18px 24px', borderBottom: '1px solid var(--line)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Mark />
          <span style={{ fontFamily: 'var(--font)', fontWeight: 700, color: 'var(--text)' }}>Caliper</span>
          <span style={{
            fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-faint)',
            border: '1px solid var(--line)', borderRadius: 999, padding: '2px 8px',
          }}>
            DEVELOPER
          </span>
        </div>
        <button className="btn ghost sm" onClick={onExit}>Exit to Caliper</button>
      </header>

      <nav style={{ padding: '16px 24px 0' }}>
        <div className="layer1-seg" role="tablist" aria-label="Developer console sections">
          {SECTIONS.map((s) => (
            <button key={s.id} role="tab" aria-selected={section === s.id} onClick={() => setSection(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      </nav>

      <main style={{ padding: 24 }}>
        <Active />
      </main>
    </div>
  );
}
