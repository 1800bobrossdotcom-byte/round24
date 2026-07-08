import { useState, useEffect, useRef } from 'react';
import { AuthGate, SignOutButton, AccountButton, useAuth } from './components/AuthGate.jsx';
import TopStrip from './components/TopStrip.jsx';
import { useStore } from './lib/store.js';
import { Mark, BrandLockup, IcDash, IcClock, IcBuilding, IcUsers, IcImport, IcCal, IcWrench, IcReceipt, IcDoc, IcPlug, IcMore, IcBell, IcX, IcChat, IcGear, IcClip } from './components/ui.jsx';
import Dashboard from './views/Dashboard.jsx';
import DayOverview from './views/DayOverview.jsx';
import Chat from './views/Chat.jsx';
import Field from './views/Field.jsx';
import Properties from './views/Properties.jsx';
import Team from './views/Team.jsx';
import Import from './views/Import.jsx';
import WorkOrders from './views/WorkOrders.jsx';
import Calendar from './views/Calendar.jsx';
import Purchases from './views/Purchases.jsx';
import Documents from './views/Documents.jsx';
import Integrations from './views/Integrations.jsx';
import Access from './views/Access.jsx';
import Compliance from './views/Compliance.jsx';
import Settings from './views/Settings.jsx';

// which roles see which tools: the Crew portal (tech) gets field work —
// orders, timer, receipts, shared docs. The Office portal (admin/manager)
// runs the whole operation. RLS + getdek enforce the same split server-side.
// `primary` tabs surface directly in the mobile bottom bar; the rest fold
// into a "More" sheet so the bar never overflows.
const TABS = [
  { id: 'dash', label: 'Dashboard', Icon: IcDash, View: Dashboard, roles: ['admin', 'manager', 'viewer'], primary: true },
  { id: 'today', label: 'Today', Icon: IcCal, View: DayOverview, roles: ['admin', 'manager'], primary: true },
  // Field timer is a CREW tool only — office dispatches, it doesn't run timers.
  { id: 'field', label: 'Field', Icon: IcClock, View: Field, roles: ['tech'], primary: true },
  { id: 'wo', label: 'Orders', Icon: IcWrench, View: WorkOrders, roles: ['admin', 'manager', 'tech', 'viewer'], primary: true },
  { id: 'chat', label: 'Chat', Icon: IcChat, View: Chat, roles: ['admin', 'manager', 'tech', 'viewer'], primary: true },
  { id: 'pur', label: 'Purchases', Icon: IcReceipt, View: Purchases, roles: ['admin', 'manager', 'tech'], primary: true },
  { id: 'docs', label: 'Docs', Icon: IcDoc, View: Documents, roles: ['admin', 'manager', 'tech', 'viewer'] },
  { id: 'cal', label: 'Calendar', Icon: IcCal, View: Calendar, roles: ['admin', 'manager', 'viewer'] },
  { id: 'props', label: 'Properties', Icon: IcBuilding, View: Properties, roles: ['admin', 'manager', 'viewer'] },
  { id: 'team', label: 'Team', Icon: IcUsers, View: Team, roles: ['admin', 'manager'] },
  { id: 'import', label: 'Import', Icon: IcImport, View: Import, roles: ['admin', 'manager'] },
  { id: 'integrations', label: 'Integrations', Icon: IcPlug, View: Integrations, roles: ['admin', 'manager'] },
  { id: 'access', label: 'Access', Icon: IcUsers, View: Access, roles: ['admin', 'manager'] },
  { id: 'compliance', label: 'Compliance', Icon: IcClip, View: Compliance, roles: ['admin', 'manager'] },
  { id: 'settings', label: 'Settings', Icon: IcGear, View: Settings, roles: ['admin', 'manager', 'tech', 'viewer'] },
];

const MAX_BAR = 5; // slots in the mobile bottom bar (incl. a possible "More")

function Shell() {
  const store = useStore();
  const { role } = useAuth();
  const tabs = TABS.filter((t) => t.roles.includes(role));
  const [tab, setTab] = useState(tabs[0].id);
  const [moreOpen, setMoreOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [focus, setFocus] = useState(null); // drill-down params for the target tab
  const isOffice = role === 'admin' || role === 'manager';

  // switch tabs, optionally carrying a focus payload (e.g. a property to open).
  // ignores targets the current role can't see, so a drill-down never bounces.
  const navigate = (id, params = null) => {
    if (!tabs.some((t) => t.id === id)) return;
    setTab(id); setFocus(params); setMoreOpen(false);
  };

  const seedDemo = async () => {
    setSeeding(true);
    try { await store.loadSampleData(); navigate('dash'); }
    finally { setSeeding(false); }
  };
  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) setTab(tabs[0].id);
  }, [role]); // role change (re-login) can invalidate the active tab
  const Active = (tabs.find((t) => t.id === tab) || tabs[0]).View;

  // notification badges: opening a tab clears its badge
  const { badges, markSeen } = store;
  useEffect(() => { markSeen(tab); }, [tab, markSeen]);
  const badgeFor = (id) => badges?.[id] || 0;
  const overflowBadges = (list) => list.reduce((a, t) => a + badgeFor(t.id), 0);

  // mobile bottom bar: show every tab directly if they fit; otherwise
  // fill the first slots and fold the rest into "More" (no wasted slot
  // for a lone overflow item).
  const fits = tabs.length <= MAX_BAR;
  const primary = fits ? tabs : tabs.slice(0, MAX_BAR - 1);
  const overflow = fits ? [] : tabs.slice(MAX_BAR - 1);

  // live task-list notifications (priority changes, new assignments)
  const { woNotice, clearWoNotice } = store;
  useEffect(() => {
    if (!woNotice) return;
    const t = setTimeout(clearWoNotice, 7000);
    return () => clearTimeout(t);
  }, [woNotice]);

  return (
    <div className="app desk">
      <TopStrip />
      {woNotice && (
        <div className={`toast prio-${woNotice.priority || 'info'}`} role="alert" onClick={clearWoNotice}>
          <IcBell width={18} height={18} />
          <span className="toast-msg">{woNotice.msg}</span>
          <IcX width={15} height={15} className="toast-x" />
        </div>
      )}

      {/* desktop side rail — all tabs (vertical, scrolls) */}
      <nav className="tabbar nav-desktop">
        <div className="desk-brand"><Mark /> Caliper</div>
        {tabs.map(({ id, label, Icon }) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => navigate(id)}>
            <span className="nav-ic">{Icon && <Icon width={22} height={22} />}{badgeFor(id) > 0 && <span className="nav-badge">{badgeFor(id)}</span>}</span>
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div style={{ flex: 1, minWidth: 0 }}>
        <header className="topbar">
          <div className="brand"><Mark /> Caliper <span className="sub">{role === 'tech' ? 'crew' : role === 'viewer' ? 'viewer' : 'office'}</span></div>
          <div className="spacer" />
          <div className="org-pill">{store.meta.org}</div>
          <AccountButton onOpen={() => navigate('settings')} />
          <SignOutButton />
        </header>
        <main className="content"><Active store={store} navigate={navigate} focus={focus} /></main>
      </div>

      {/* mobile bottom bar — primary tabs + More */}
      <nav className="tabbar nav-mobile">
        {primary.map(({ id, label, Icon }) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => navigate(id)}>
            <span className="nav-ic"><Icon width={22} height={22} />{badgeFor(id) > 0 && <span className="nav-badge">{badgeFor(id)}</span>}</span>
            <span>{label}</span>
          </button>
        ))}
        {overflow.length > 0 && (
          <button className={overflow.some((t) => t.id === tab) ? 'active' : ''} onClick={() => setMoreOpen(true)}>
            <span className="nav-ic"><IcMore width={22} height={22} />{overflowBadges(overflow) > 0 && <span className="nav-badge">{overflowBadges(overflow)}</span>}</span>
            <span>More</span>
          </button>
        )}
      </nav>

      {moreOpen && (
        <div className="sheet-backdrop" onClick={() => setMoreOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grip" />
            <div className="sheet-grid">
              {overflow.map(({ id, label, Icon }) => (
                <button key={id} className={tab === id ? 'active' : ''} onClick={() => navigate(id)}>
                  <span className="nav-ic"><Icon width={24} height={24} />{badgeFor(id) > 0 && <span className="nav-badge">{badgeFor(id)}</span>}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
            {isOffice && (
              <button className="btn grad" style={{ margin: '14px 4px 4px', width: 'auto' }} onClick={seedDemo} disabled={seeding}>
                {seeding ? 'Filling…' : 'Load sample data'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Full-screen intro that plays once on load: the brand forms (~2.5s), holds,
// then dissolves to reveal the app booting underneath. Click/tap skips it.
function SplashIntro({ onDone }) {
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(false);
  const finish = () => { if (doneRef.current) return; doneRef.current = true; setLeaving(true); setTimeout(onDone, 480); };
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(finish, reduce ? 900 : 2450);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className={`splash ${leaving ? 'leaving' : ''}`} onClick={finish} role="img" aria-label="Caliper — labor, measured true">
      <div className="splash-inner">
        <BrandLockup className="bl-hero" />
        <div className="splash-tag">labor, measured true</div>
      </div>
    </div>
  );
}

export default function App() {
  const [intro, setIntro] = useState(true);
  return (
    <>
      {intro && <SplashIntro onDone={() => setIntro(false)} />}
      <AuthGate>
        <Shell />
      </AuthGate>
    </>
  );
}
