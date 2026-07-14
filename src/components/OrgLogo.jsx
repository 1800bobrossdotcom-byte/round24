import { useState } from 'react';
import { brandFor } from '../lib/brand.js';
import { Mark } from './ui.jsx';

// Whitelabel logo. Shows the org's custom logo when one is configured AND the
// image actually loads; otherwise falls back to the Caliper lockup (so an org
// with no logo, or a not-yet-uploaded file, degrades cleanly). `poweredBy` adds
// a small "powered by Caliper" line beneath a whitelabel logo.
export default function OrgLogo({ orgId, orgName, height = 26, poweredBy = false, fallback = null }) {
  const brand = brandFor(orgId, orgName);
  const [failed, setFailed] = useState(false);
  if (!brand || failed) {
    return fallback ?? (<span className="ol-caliper"><Mark /> <span className="ol-word">Caliper</span></span>);
  }
  return (
    <span className="ol-wrap">
      <img className="ol-img" src={brand.logo} alt={brand.name} style={{ height }} onError={() => setFailed(true)} />
      {poweredBy && <span className="ol-powered">powered by Caliper</span>}
    </span>
  );
}
