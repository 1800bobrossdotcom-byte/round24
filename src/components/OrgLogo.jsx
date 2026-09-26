import { useState, useEffect } from 'react';
import { Mark } from './ui.jsx';

// Whitelabel logo. Shows the workspace's own logo (a URL from its per-org
// branding) when one is set AND the image loads; otherwise falls back to the
// Round24 lockup — so a workspace with no logo, or a broken URL, degrades
// cleanly and never shows another tenant's brand. `poweredBy` adds a small
// "powered by Round24" line; `centered` centers the stack.
export default function OrgLogo({ logo, name, height = 26, poweredBy = false, centered = false, fallback = null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [logo]); // a new logo gets a fresh chance to load
  if (!logo || failed) {
    return fallback ?? (<span className="ol-caliper"><Mark /> <span className="ol-word">Round24</span></span>);
  }
  return (
    <span className="ol-wrap" style={centered ? { alignItems: 'center' } : undefined}>
      <img className="ol-img" src={logo} alt={name || 'logo'} style={{ height }} onError={() => setFailed(true)} />
      {poweredBy && <span className="ol-powered">powered by Round24</span>}
    </span>
  );
}
