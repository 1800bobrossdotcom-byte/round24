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
      <path d="M3 4v13a3 3 0 0 0 3 3h1V4H3Z" stroke="url(#cg)" strokeWidth="1.6" />
      <path d="M21 4v9a3 3 0 0 1-3 3h-1V4h4Z" stroke="url(#cg)" strokeWidth="1.6" />
      <path d="M7 9h10" stroke="url(#cg)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 9v11" stroke="url(#cg)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
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
export const IcReceipt = P(<><path d="M5 3h14v18l-2.3-1.5L14.4 21l-2.4-1.5L9.6 21l-2.3-1.5L5 21zM9 8h6M9 12h6"/></>);
export const IcDoc = P(<><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 13h6M9 17h6"/></>);

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
