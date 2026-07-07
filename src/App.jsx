import { useState, useEffect } from 'react';
import { AuthGate, SignOutButton, AccountButton, useAuth } from './components/AuthGate.jsx';
import { useStore } from './lib/store.js';
import { Mark, IcDash, IcClock, IcBuilding, IcUsers, IcImport, IcCal, IcWrench, IcReceipt, IcDoc, IcPlug } from './components/ui.jsx';
import Dashboard from './views/Dashboard.jsx';
import Field from './views/Field.jsx';
import Properties from './views/Properties.jsx';
import Team from './views/Team.jsx';
import Import from './views/Import.jsx';
import WorkOrders from './views/WorkOrders.jsx';
import Calendar from './views/Calendar.jsx';
import Purchases from './views/Purchases.jsx';
import Documents from './views/Documents.jsx';
import Integrations from './views/Integrations.jsx';

// which roles see which tools: the Crew portal (tech) gets field work —
// orders, timer, receipts, shared docs. The Office portal (admin/manager)
// runs the whole operation. RLS + getdek enforce the same split server-side.
const TABS = [
  { id: 'dash', label: 'Dashboard', Icon: IcDash, View: Dashboard, roles: ['admin', 'manager', 'viewer'] },
  { id: 'field', label: 'Field', Icon: IcClock, View: Field, roles: ['admin', 'manager', 'tech'] },
  { id: 'wo', label: 'Work Orders', Icon: IcWrench, View: WorkOrders, roles: ['admin', 'manager', 'tech', 'viewer'] },
  { id: 'pur', label: 'Purchases', Icon: IcReceipt, View: Purchases, roles: ['admin', 'manager', 'tech'] },
  { id: 'docs', label: 'Docs', Icon: IcDoc, View: Documents, roles: ['admin', 'manager', 'tech', 'viewer'] },
  { id: 'cal', label: 'Calendar', Icon: IcCal, View: Calendar, roles: ['admin', 'manager', 'viewer'] },
  { id: 'props', label: 'Properties', Icon: IcBuilding, View: Properties, roles: ['admin', 'manager', 'viewer'] },
  { id: 'team', label: 'Team', Icon: IcUsers, View: Team, roles: ['admin', 'manager'] },
  { id: 'import', label: 'Import', Icon: IcImport, View: Import, roles: ['admin', 'manager'] },
  { id: 'integrations', label: 'Integrations', Icon: IcPlug, View: Integrations, roles: ['admin', 'manager'] },
];

function Shell() {
  const store = useStore();
  const { role } = useAuth();
  const tabs = TABS.filter((t) => t.roles.includes(role));
  const [tab, setTab] = useState(tabs[0].id);
  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) setTab(tabs[0].id);
  }, [role]); // role change (re-login) can invalidate the active tab
  const Active = (tabs.find((t) => t.id === tab) || tabs[0]).View;

  // live task-list notifications (priority changes, new assignments)
  const { woNotice, clearWoNotice } = store;
  useEffect(() => {
    if (!woNotice) return;
    const t = setTimeout(clearWoNotice, 6000);
    return () => clearTimeout(t);
  }, [woNotice]);

  return (
    <div className="app desk">
      {woNotice && (
        <div className="toast" onClick={clearWoNotice}>📣 {woNotice.msg}</div>
      )}
      {/* desktop side rail brand (hidden on mobile) */}
      <nav className="tabbar">
        <div className="desk-brand"><Mark /> Caliper</div>
        {tabs.map(({ id, label, Icon }) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            <Icon /> <span>{label}</span>
          </button>
        ))}
      </nav>

      <div style={{ flex: 1, minWidth: 0 }}>
        <header className="topbar">
          <div className="brand"><Mark /> Caliper <span className="sub">{role === 'tech' ? 'crew' : role === 'viewer' ? 'viewer' : 'office'}</span></div>
          <div className="spacer" />
          <div className="org-pill">{store.meta.org}</div>
          <AccountButton />
          <SignOutButton />
        </header>
        <main className="content"><Active store={store} /></main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthGate>
      <Shell />
    </AuthGate>
  );
}
