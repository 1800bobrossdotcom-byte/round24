// caliper measurement mark — stylized caliper jaws
export function Mark({ className = 'mark' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="cg" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ff3d3d" /><stop offset=".25" stopColor="#ff7a18" />
          <stop offset=".5" stopColor="#ffd21a" /><stop offset=".7" stopColor="#4ade80" />
          <stop offset=".85" stopColor="#38bdf8" /><stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      {/* pathLength=1 normalizes each stroke so the draw-in animation
          (see .brand-lockup .mk-seg) is uniform regardless of real length */}
      <path className="mk-seg" pathLength="1" d="M3 4v13a3 3 0 0 0 3 3h1V4H3Z" stroke="url(#cg)" strokeWidth="1.6" />
      <path className="mk-seg" pathLength="1" d="M21 4v9a3 3 0 0 1-3 3h-1V4h4Z" stroke="url(#cg)" strokeWidth="1.6" />
      <path className="mk-seg" pathLength="1" d="M7 9h10" stroke="url(#cg)" strokeWidth="1.6" strokeLinecap="round" />
      <path className="mk-seg" pathLength="1" d="M12 9v11" stroke="url(#cg)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// Animated hero lockup for the login / onboarding screens: the caliper
// strokes draw in and connect, "Caliper" reveals with a brushed-metal fill,
// and a glint sweeps across once it forms. Purely CSS (see .brand-lockup in
// app.css), so it replays whenever the component mounts (e.g. switching portals).
export function BrandLockup({ className = '' }) {
  return (
    <div className={`brand-lockup ${className}`.trim()}>
      <Mark className="mark bl-mark" />
      <span className="bl-word">Caliper</span>
      <span className="bl-glint" aria-hidden="true" />
    </div>
  );
}

const P = (d) => (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
       strokeLinecap="round" strokeLinejoin="round" {...props}>{d}</svg>
);
export const IcDash = P(<><path d="M3 13h8V3H3zM13 21h8V3h-8zM3 21h8v-6H3z"/></>);
export const IcClock = P(<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>);
export const IcBuilding = P(<><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01M9 16h6"/></>);
export const IcUsers = P(<><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 6a3 3 0 0 1 0 6M21 20a6 6 0 0 0-5-5.9"/></>);
export const IcPlay = P(<><path d="M6 4l14 8-14 8z"/></>);
export const IcImport = P(<><path d="M12 3v12M8 11l4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></>);
export const IcCal = P(<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></>);
export const IcWrench = P(<><path d="M20.3 5.1a5 5 0 0 1-6.6 6.6L7 18.4a2.1 2.1 0 0 1-3-3l6.7-6.7a5 5 0 0 1 6.6-6.6l-3.2 3.2 2.1 2.1 3.2-3.2z"/></>);
export const IcTag = P(<><path d="M20.6 13.4 12.4 21.6a1.4 1.4 0 0 1-2 0L3 14.2V4h10.2l7.4 7.4a1.4 1.4 0 0 1 0 2z"/><circle cx="7.5" cy="7.5" r="1.4"/></>);
export const IcReceipt = P(<><path d="M5 3h14v18l-2.3-1.5L14.4 21l-2.4-1.5L9.6 21l-2.3-1.5L5 21zM9 8h6M9 12h6"/></>);
export const IcDoc = P(<><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 13h6M9 17h6"/></>);
export const IcPlug = P(<><path d="M9 2v6M15 2v6M7 8h10v3a5 5 0 0 1-10 0zM12 16v6"/></>);
export const IcMore = P(<><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>);
export const IcLogout = P(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></>);
export const IcGear = P(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>);
export const IcMic = P(<><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 19v3M8 22h8"/></>);
export const IcCoffee = P(<><path d="M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 9h2a2 2 0 0 1 0 4h-2M7 1v2M11 1v2M15 1v2"/></>);
export const IcUtensils = P(<><path d="M4 2v7a3 3 0 0 0 3 3v10M7 2v6M10 2v6M18 2c-1.7 0-3 2-3 5.5S16.3 13 18 13v9"/></>);
export const IcClip = P(<><path d="M21 8l-9.6 9.6a4 4 0 0 1-5.7-5.7l9.2-9.2a2.5 2.5 0 0 1 3.5 3.5l-9.1 9.1a1 1 0 0 1-1.4-1.4l8.4-8.4"/></>);
export const IcCheck = P(<><path d="M20 6L9 17l-5-5"/></>);
export const IcX = P(<><path d="M18 6L6 18M6 6l12 12"/></>);
export const IcSync = P(<><path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v5h-5"/></>);
export const IcUpload = P(<><path d="M12 15V3M7 8l5-5 5 5M5 21h14"/></>);
export const IcChart = P(<><path d="M3 3v18h18"/><path d="M8 14v4M13 9v9M18 5v13"/></>);
export const IcBell = P(<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></>);
export const IcActivity = P(<><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></>);
export const IcChevron = P(<><path d="M9 18l6-6-6-6"/></>);
export const IcChat = P(<><path d="M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-6.5A8 8 0 1 1 21 12z"/><path d="M8 11h.01M12 11h.01M16 11h.01"/></>);
export const IcSend = P(<><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></>);
export const IcTrash = P(<><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></>);
export const IcSparkle = P(<><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 3v4M21 5h-4"/></>);
export const IcCreditCard = P(<><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/></>);
export const IcImage = P(<><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></>);
export const IcSun = P(<><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>);
export const IcMoon = P(<><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></>);
export const IcShield = P(<><path d="M12 3l8 3v6c0 4.4-3 7.6-8 9-5-1.4-8-4.6-8-9V6z"/><path d="M9 12l2 2 4-4"/></>);
export const IcCamera = P(<><path d="M3 7h3l2-2.5h8L18 7h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></>);
export const IcCopy = P(<><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>);

const PALS = ['#ff7a18', '#ff3d81', '#4ade80', '#38bdf8', '#a855f7', '#ffd21a', '#ff5a5a', '#22d3ee'];
export function Avatar({ name, i = 0 }) {
  const init = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return <div className="avatar" style={{ background: PALS[i % PALS.length] }}>{init}</div>;
}

export function Stat({ k, v, d, hero, sm, grad, settle = true }) {
  return (
    <div className={`stat${hero ? ' hero' : ''}`}>
      <span className="k">{k}</span>
      <span className={`v mono${sm ? ' sm' : ''}${grad ? ' grad-text' : ''}${settle ? ' settle' : ''}`}>{v}</span>
      {d && <span className="d">{d}</span>}
    </div>
  );
}
