import { useState, useEffect, useRef } from 'react';
import { AuthGate, SignOutButton, AccountButton, useAuth } from './components/AuthGate.jsx';
import TopStrip from './components/TopStrip.jsx';
import { useStore } from './lib/store.js';
import OrgLogo from './components/OrgLogo.jsx';
import { Mark, BrandLockup, IcDash, IcClock, IcBuilding, IcUsers, IcImport, IcCal, IcWrench, IcReceipt, IcDoc, IcPlug, IcMore, IcBell, IcX, IcChat, IcGear, IcClip, IcShield, IcTag, IcChart, IcTable, IcChevron, IcTrend, IcSync } from './components/ui.jsx';
import { isPlatformAdmin, isConfigured } from './lib/backend/supabase.js';
import Dashboard from './views/Dashboard.jsx';
import DayOverview from './views/DayOverview.jsx';
import Chat from './views/Chat.jsx';
import Field from './views/Field.jsx';
import Properties from './views/Properties.jsx';
import Leasing from './views/Leasing.jsx';
import Team from './views/Team.jsx';
import Import from './views/Import.jsx';
import WorkOrders from './views/WorkOrders.jsx';
import Maintenance from './views/Maintenance.jsx';
import Turns from './views/Turns.jsx';
import Requests from './views/Requests.jsx';
import ResidentRequest from './views/ResidentRequest.jsx';
import ResidentJoin from './views/ResidentJoin.jsx';
import ResidentHome from './views/ResidentHome.jsx';
import Residents from './views/Residents.jsx';
import Calendar from './views/Calendar.jsx';
import Purchases from './views/Purchases.jsx';
import Documents from './views/Documents.jsx';
import Integrations from './views/Integrations.jsx';
import Access from './views/Access.jsx';
import Compliance from './views/Compliance.jsx';
import Economics from './views/Economics.jsx';
import CAM from './views/CAM.jsx';
import COI from './views/COI.jsx';
import Handbook from './views/Handbook.jsx';
import Amenities from './views/Amenities.jsx';
import PLStatement from './views/PLStatement.jsx';
import Forecast from './views/Forecast.jsx';
import Timesheet from './views/Timesheet.jsx';
import Vendors from './views/Vendors.jsx';
import Settings from './views/Settings.jsx';
import Platform from './views/Platform.jsx';
import DeveloperShell from './layer1-developer/DeveloperShell.jsx';

// which roles see which tools: the Crew portal (tech) gets field work —
// orders, timer, receipts, shared docs. The Office portal (admin/manager)
// runs the whole operation. RLS + getdek enforce the same split server-side.
// `primary` tabs surface directly in the mobile bottom bar; the rest fold
// into a "More" sheet so the bar never overflows.
// nav categories: as the tool count grows, the rail groups into collapsible
// sections instead of one long list. Order here is the order they render.
const NAV_CATS = [
  { id: 'overview', label: 'Overview' },
  { id: 'work', label: 'Work' },
  { id: 'operations', label: 'Operations' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'money', label: 'Money' },
  { id: 'people', label: 'People' },
  { id: 'data', label: 'Data & setup' },
  { id: 'files', label: 'Files' },
  { id: 'account', label: 'Account' },
];

const TABS = [
  { id: 'dash', label: 'Dashboard', Icon: IcDash, View: Dashboard, roles: ['admin', 'manager', 'viewer'], cat: 'overview', primary: true },
  { id: 'today', label: 'Today', Icon: IcCal, View: DayOverview, roles: ['admin', 'manager'], cat: 'overview', primary: true },
  // Field timer is a CREW tool only — office dispatches, it doesn't run timers.
  { id: 'field', label: 'Field', Icon: IcClock, View: Field, roles: ['tech'], cat: 'work', primary: true },
  { id: 'timesheet', label: 'Timesheet', Icon: IcTable, View: Timesheet, roles: ['admin', 'manager', 'tech'], cat: 'work', primary: true },
  { id: 'wo', label: 'Orders', Icon: IcWrench, View: WorkOrders, roles: ['admin', 'manager', 'tech', 'viewer'], cat: 'work', primary: true },
  { id: 'maint', label: 'Maintenance', Icon: IcClip, View: Maintenance, roles: ['admin', 'manager'], cat: 'work' },
  { id: 'turns', label: 'Make-ready', Icon: IcSync, View: Turns, roles: ['admin', 'manager'], cat: 'work' },
  { id: 'requests', label: 'Requests', Icon: IcChat, View: Requests, roles: ['admin', 'manager'], cat: 'work' },
  { id: 'chat', label: 'Chat', Icon: IcChat, View: Chat, roles: ['admin', 'manager', 'tech', 'viewer'], cat: 'work', primary: true },
  { id: 'cal', label: 'Calendar', Icon: IcCal, View: Calendar, roles: ['admin', 'manager', 'viewer'], cat: 'work' },
  { id: 'pur', label: 'Purchases', Icon: IcReceipt, View: Purchases, roles: ['admin', 'manager', 'tech'], cat: 'money', primary: true },
  { id: 'pnl', label: 'Per-door P&L', Icon: IcChart, View: Economics, roles: ['admin', 'manager', 'viewer'], cat: 'money' },
  // CAM is commercial-owner reconciliation → Enterprise (OWNER_TABS) only, not the maintenance Office.
  { id: 'statement', label: 'P&L statement', Icon: IcDoc, View: PLStatement, roles: ['admin', 'manager', 'viewer'], cat: 'money' },
  { id: 'forecast', label: 'Forecast', Icon: IcTrend, View: Forecast, roles: ['admin', 'manager', 'viewer'], cat: 'money' },
  { id: 'leasing', label: 'Rent Roll', Icon: IcBuilding, View: Leasing, roles: ['admin', 'manager', 'viewer'], cat: 'portfolio' },
  { id: 'props', label: 'Properties', Icon: IcBuilding, View: Properties, roles: ['admin', 'manager', 'viewer'], cat: 'portfolio' },
  { id: 'vendors', label: 'Vendors', Icon: IcTag, View: Vendors, roles: ['admin', 'manager', 'tech', 'viewer'], cat: 'portfolio' },
  { id: 'coi', label: 'Insurance', Icon: IcShield, View: COI, roles: ['admin', 'manager'], cat: 'portfolio' },
  { id: 'handbook', label: 'Handbook', Icon: IcDoc, View: Handbook, roles: ['admin', 'manager'], cat: 'portfolio' },
  { id: 'amenities', label: 'Amenities', Icon: IcCal, View: Amenities, roles: ['admin', 'manager'], cat: 'portfolio' },
  { id: 'team', label: 'Team', Icon: IcUsers, View: Team, roles: ['admin', 'manager'], cat: 'people' },
  { id: 'residents', label: 'Residents', Icon: IcUsers, View: Residents, roles: ['admin', 'manager'], cat: 'people' },
  { id: 'access', label: 'Access', Icon: IcUsers, View: Access, roles: ['admin', 'manager'], cat: 'people' },
  { id: 'import', label: 'Import', Icon: IcImport, View: Import, roles: ['admin', 'manager'], cat: 'data' },
  { id: 'integrations', label: 'Integrations', Icon: IcPlug, View: Integrations, roles: ['admin', 'manager'], cat: 'data' },
  { id: 'compliance', label: 'Compliance', Icon: IcClip, View: Compliance, roles: ['admin', 'manager'], cat: 'data' },
  { id: 'docs', label: 'Docs', Icon: IcDoc, View: Documents, roles: ['admin', 'manager', 'tech', 'viewer'], cat: 'files' },
  { id: 'settings', label: 'Settings', Icon: IcGear, View: Settings, roles: ['admin', 'manager', 'tech', 'viewer'], cat: 'account' },
];

// Owner persona: a landlord with a handful of properties who IS the whole
// operation. Same admin role, streamlined shell — portfolio-first, no
// crew/dispatch/team apparatus. Labels reframed for a solo owner.
const OWNER_TABS = [
  { id: 'leasing', label: 'Portfolio', Icon: IcBuilding, View: Leasing, cat: 'portfolio', primary: true },
  { id: 'props', label: 'Buildings', Icon: IcBuilding, View: Properties, cat: 'portfolio', primary: true },
  { id: 'pnl', label: 'P&L', Icon: IcChart, View: Economics, cat: 'money', primary: true },
  { id: 'cam', label: 'CAM', Icon: IcChart, View: CAM, cat: 'money' },
  { id: 'statement', label: 'P&L statement', Icon: IcDoc, View: PLStatement, cat: 'money' },
  { id: 'pur', label: 'Expenses', Icon: IcReceipt, View: Purchases, cat: 'money' },
  { id: 'forecast', label: 'Forecast', Icon: IcTrend, View: Forecast, cat: 'money' },
  { id: 'wo', label: 'Maintenance', Icon: IcWrench, View: WorkOrders, cat: 'operations', primary: true },
  { id: 'maint', label: 'Schedule', Icon: IcClip, View: Maintenance, cat: 'operations' },
  { id: 'cal', label: 'Calendar', Icon: IcCal, View: Calendar, cat: 'operations' },
  { id: 'vendors', label: 'Vendors', Icon: IcTag, View: Vendors, cat: 'operations' },
  { id: 'coi', label: 'Insurance', Icon: IcShield, View: COI, cat: 'operations' },
  { id: 'handbook', label: 'Handbook', Icon: IcDoc, View: Handbook, cat: 'operations' },
  { id: 'amenities', label: 'Amenities', Icon: IcCal, View: Amenities, cat: 'operations' },
  { id: 'docs', label: 'Docs', Icon: IcDoc, View: Documents, cat: 'files' },
  { id: 'settings', label: 'Settings', Icon: IcGear, View: Settings, cat: 'account' },
];

const MAX_BAR = 5; // slots in the mobile bottom bar (incl. a possible "More")

// every tab id the app can ever route to — hash routing accepts these even
// before async gates (isPlat, operator seat) have resolved, so a deep link to
// #platform or #field survives the first render instead of being clobbered.
const KNOWN_TAB_IDS = new Set([...TABS.map((t) => t.id), ...OWNER_TABS.map((t) => t.id), 'platform', 'myhome']);
const hashTab = () => window.location.hash.replace(/^#\/?/, '');

// dual-hat: staff who ALSO hold a residency (founder / crew who lives in a
// building) get their Caliper Community home as a tab inside the shell.
function MyHomeView() {
  const { resident } = useAuth();
  return resident ? <ResidentHome resident={resident} embedded /> : null;
}

function Shell() {
  const store = useStore();
  const { role, orgKind, resident } = useAuth();
  const [isPlat, setIsPlat] = useState(false);
  useEffect(() => { isPlatformAdmin().then(setIsPlat).catch(() => {}); }, []);
  let roleTabs = orgKind === 'owner' ? OWNER_TABS : TABS.filter((t) => t.roles.includes(role));
  // dual-hat access: an OFFICE user (admin/manager) who ALSO holds an operator seat
  // does field work too — surface the Field timer for them even though it's a crew
  // tool by default. Gated on the seat (store.operatorId), not just the role, so a
  // normal admin without a seat never sees it. A tech already has Field via roles.
  if (store.operatorId && !roleTabs.some((t) => t.id === 'field')) {
    const fieldTab = TABS.find((t) => t.id === 'field');
    if (fieldTab) roleTabs = [fieldTab, ...roleTabs];
  }
  // an unrecognized/empty role (stale membership, a role added server-side we
  // don't map yet) must never leave the shell tab-less — Settings is the floor.
  const baseTabs = roleTabs.length ? roleTabs : TABS.filter((t) => t.id === 'settings');
  const tabs = [
    ...baseTabs,
    // resident dual-hat: staff who also live in a building get their Community home
    ...(resident ? [{ id: 'myhome', label: 'My Home', Icon: IcBuilding, View: MyHomeView, cat: 'account' }] : []),
    ...(isPlat ? [{ id: 'platform', label: 'Platform', Icon: IcShield, View: Platform, cat: 'account' }] : []),
  ];
  // hash routing: the active tab lives in the URL (#timesheet, #wo…), so views
  // are linkable, refresh keeps your place, and back/forward walk tab history.
  const [tab, setTab] = useState(() => (KNOWN_TAB_IDS.has(hashTab()) ? hashTab() : tabs[0]?.id));
  const [moreOpen, setMoreOpen] = useState(false);
  // collapsible nav categories — compress the rail as the tool count grows
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try { return JSON.parse(localStorage.getItem('caliper_nav_collapsed')) || {}; } catch { return {}; }
  });
  const toggleCat = (id) => setNavCollapsed((c) => {
    const n = { ...c, [id]: !c[id] };
    try { localStorage.setItem('caliper_nav_collapsed', JSON.stringify(n)); } catch { /* no storage */ }
    return n;
  });
  const [seeding, setSeeding] = useState(false);
  const [focus, setFocus] = useState(null); // drill-down params for the target tab
  const isOffice = role === 'admin' || role === 'manager';

  // switch tabs, optionally carrying a focus payload (e.g. a property to open).
  // ignores targets the current role can't see, so a drill-down never bounces.
  const navigate = (id, params = null) => {
    if (!tabs.some((t) => t.id === id)) return;
    setTab(id); setFocus(params); setMoreOpen(false);
    if (hashTab() !== id) window.location.hash = id; // pushes a history entry → back button works
  };

  // back/forward (and hand-typed hashes) drive the tab
  useEffect(() => {
    const onHash = () => {
      const h = hashTab();
      if (h && KNOWN_TAB_IDS.has(h)) { setTab(h); setFocus(null); setMoreOpen(false); }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  // keep the URL honest when the tab changes by other paths (role guard, seed)
  useEffect(() => {
    if (tab && hashTab() !== tab) window.history.replaceState(null, '', '#' + tab);
  }, [tab]);

  const seedDemo = async () => {
    setSeeding(true);
    try { await store.loadSampleData({ kind: orgKind }); navigate(orgKind === 'owner' ? 'leasing' : 'dash'); }
    finally { setSeeding(false); }
  };
  useEffect(() => {
    // reset only truly unknown ids — a KNOWN id this shell can't show yet (e.g.
    // #platform before isPlat resolves, #field before the seat loads) renders
    // the fallback view meanwhile and activates once its gate opens.
    if (!tabs.some((t) => t.id === tab) && !KNOWN_TAB_IDS.has(tab)) setTab(tabs[0]?.id);
  }, [role]); // role change (re-login) can invalidate the active tab
  const Active = (tabs.find((t) => t.id === tab) || tabs[0])?.View || Settings;

  // notification badges: opening a tab clears its badge
  const { badges, markSeen } = store;
  useEffect(() => { markSeen(tab); }, [tab, markSeen]);
  // this device runs the staff shell — future splashes use the ops tagline
  // (a #myhome deep link still gets the Community one via the hash check)
  useEffect(() => { try { localStorage.setItem('caliper_shell_hint', 'staff'); } catch { /* no storage */ } }, []);
  const badgeFor = (id) => badges?.[id] || 0;
  const overflowBadges = (list) => list.reduce((a, t) => a + badgeFor(t.id), 0);

  // mobile bottom bar: show every tab directly if they fit; otherwise
  // fill the first slots and fold the rest into "More" (no wasted slot
  // for a lone overflow item).
  const fits = tabs.length <= MAX_BAR;
  const primary = fits ? tabs : tabs.slice(0, MAX_BAR - 1);
  const overflow = fits ? [] : tabs.slice(MAX_BAR - 1);

  // group a tab list into its categories, preserving NAV_CATS order
  const groupByCat = (list) => NAV_CATS
    .map((c) => ({ ...c, items: list.filter((t) => (t.cat || 'account') === c.id) }))
    .filter((g) => g.items.length);
  const navGroups = groupByCat(tabs);
  const overflowGroups = groupByCat(overflow);

  // live task-list notifications (priority changes, new assignments)
  const { woNotice, clearWoNotice } = store;
  useEffect(() => {
    if (!woNotice) return;
    const t = setTimeout(clearWoNotice, 7000);
    return () => clearTimeout(t);
  }, [woNotice]);

  // My Home is a room of its own — a dual-hat user who taps it leaves the ops
  // nav entirely for the clean Community surface, with one way back to work.
  // (A pure resident never reaches here; AuthGate gives them the full-screen home.)
  if (tab === 'myhome' && resident) {
    const backTo = (baseTabs[0]?.id) || 'settings';
    const backLabel = orgKind === 'owner' ? 'portfolio' : role === 'tech' ? 'crew' : 'office';
    return (
      <div className="app desk community-scope" style={{ minHeight: '100vh' }}>
        <TopStrip />
        <div style={{ maxWidth: 620, margin: '0 auto', padding: '10px 16px 60px', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 2px 12px' }}>
            <button className="btn ghost sm" style={{ width: 'auto' }} onClick={() => navigate(backTo)}>← Back to {backLabel}</button>
            <span style={{ flex: 1 }} />
            <OrgLogo logo={store.orgLogo} name={store.meta?.org} height={30}
              fallback={<span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800 }}><Mark /> Caliper</span>} />
          </div>
          <ResidentHome resident={resident} embedded />
        </div>
      </div>
    );
  }

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

      {/* desktop side rail — grouped into collapsible categories */}
      <nav className="tabbar nav-desktop">
        <div className="desk-brand"><Mark /> Caliper</div>
        {navGroups.map((g) => {
          const hasActive = g.items.some((t) => t.id === tab);
          const open = !navCollapsed[g.id] || hasActive; // active category is always visible
          const catBadge = overflowBadges(g.items);
          return (
            <div className="nav-cat" key={g.id}>
              <button className="nav-cat-head" onClick={() => toggleCat(g.id)} aria-expanded={open}>
                <IcChevron className={'nav-cat-chev' + (open ? ' open' : '')} width={12} height={12} />
                <span>{g.label}</span>
                {!open && catBadge > 0 && <span className="nav-cat-badge">{catBadge}</span>}
              </button>
              {open && g.items.map(({ id, label, Icon }) => (
                <button key={id} className={'nav-cat-item' + (tab === id ? ' active' : '')} onClick={() => navigate(id)}>
                  <span className="nav-ic">{Icon && <Icon width={20} height={20} />}{badgeFor(id) > 0 && <span className="nav-badge">{badgeFor(id)}</span>}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          );
        })}
      </nav>

      <div style={{ flex: 1, minWidth: 0 }}>
        <header className="topbar">
          <div className="brand"><OrgLogo logo={store.orgLogo} name={store.meta?.org} height={34} fallback={<><Mark /> Caliper</>} /> <span className="sub" style={tab === 'myhome' ? { color: '#C96F3B' } : undefined}>{tab === 'myhome' ? 'home' : orgKind === 'owner' ? 'portfolio' : role === 'tech' ? 'crew' : role === 'viewer' ? 'viewer' : 'office'}</span></div>
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
            <div className="sheet-scroll">
              {overflowGroups.map((g) => (
                <div className="sheet-cat" key={g.id}>
                  <div className="sheet-cat-head">{g.label}</div>
                  <div className="sheet-grid">
                    {g.items.map(({ id, label, Icon }) => (
                      <button key={id} className={tab === id ? 'active' : ''} onClick={() => navigate(id)}>
                        <span className="nav-ic"><Icon width={24} height={24} />{badgeFor(id) > 0 && <span className="nav-badge">{badgeFor(id)}</span>}</span>
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {/* sample data is a demo-only affordance — a live org never injects
                test data (go-live: keep the real workspace clean) */}
            {isOffice && !isConfigured() && (
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
function SplashIntro({ onDone, community = false }) {
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(false);
  const finish = () => { if (doneRef.current) return; doneRef.current = true; setLeaving(true); setTimeout(onDone, 480); };
  useEffect(() => {
    // the intro always plays its full run (it's brief + click-to-skip); the
    // dissolve keeps blur/scale mild so it's comfortable regardless of settings
    const t = setTimeout(finish, 2450);
    return () => clearTimeout(t);
  }, []);
  // heading home ≠ heading to work: the resident-facing launch drops the ops
  // tagline for a Community one.
  const tag = community ? 'welcome home' : 'labor, measured true';
  return (
    <div className={`splash ${leaving ? 'leaving' : ''}`} onClick={finish} role="img" aria-label={`Caliper — ${tag}`}>
      <div className="splash-inner">
        <BrandLockup className="bl-hero" />
        <div className="splash-tag">{tag}</div>
      </div>
    </div>
  );
}

export default function App() {
  const [intro, setIntro] = useState(true);
  // Layer 1 (#developer) — hooks live above the early returns below so hook
  // order stays stable; the return itself is after the public-form routes.
  const [devMode, setDevMode] = useState(() => window.location.hash.startsWith('#developer'));
  useEffect(() => {
    const onHash = () => setDevMode(window.location.hash.startsWith('#developer'));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  // public resident request form: caliper.solutions/?request=<orgId>[&b=<building>]
  // renders unauthenticated, before the login gate — residents have no account.
  const params = new URLSearchParams(window.location.search);
  const reqOrg = params.get('request');
  if (reqOrg) return <ResidentRequest orgId={reqOrg} building={params.get('b') || ''} />;
  // Caliper Community: caliper.solutions/?join=<orgId>[&b=…] — resident signup +
  // unit claim. Manages its own auth; the office verifies every claim.
  const joinOrg = params.get('join');
  if (joinOrg) return <ResidentJoin orgId={joinOrg} building={params.get('b') || ''} />;
  // Layer 1 Developer console — intercepts before AuthGate/Shell and their
  // hashTab routing ('developer' is not in KNOWN_TAB_IDS, so nothing else
  // ever claims this hash).
  if (devMode) return <DeveloperShell onExit={() => { window.location.hash = ''; }} />;
  // Community splash: heading to #myhome, or a device that last ran as a
  // standalone resident, gets "welcome home" instead of the ops tagline.
  const communitySplash = (() => {
    try { return hashTab() === 'myhome' || localStorage.getItem('caliper_shell_hint') === 'resident'; }
    catch { return hashTab() === 'myhome'; }
  })();
  return (
    <>
      {intro && <SplashIntro community={communitySplash} onDone={() => setIntro(false)} />}
      <AuthGate>
        <Shell />
      </AuthGate>
    </>
  );
}
