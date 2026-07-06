import { useState, useEffect } from 'react';
import { AuthGate, SignOutButton, AccountButton, useAuth } from './components/AuthGate.jsx';
import { useStore } from './lib/store.js';
import { Mark, IcDash, IcClock, IcBuilding, IcUsers, IcImport, IcCal, IcWrench } from './components/ui.jsx';
import Dashboard from './views/Dashboard.jsx';
import Field from './views/Field.jsx';
import Properties from './views/Properties.jsx';
import Team from './views/Team.jsx';
import Import from './views/Import.jsx';
import WorkOrders from './views/WorkOrders.jsx';
import Calendar from './views/Calendar.jsx';

// which roles see which tools: contractors (tech) get field tools only —
// no financials. RLS + getdek enforce the same split server-side.
const TABS = [
  { id: 'dash', label: 'Dashboard', Icon: IcDash, View: Dashboard, roles: ['admin', 'manager', 'viewer'] },
  { id: 'field', label: 'Field', Icon: IcClock, View: Field, roles: ['admin', 'manager', 'tech'] },
  { id: 'wo', label: 'Work Orders', Icon: IcWrench, View: WorkOrders, roles: ['admin', 'manager', 'tech', 'viewer'] },
  { id: 'cal', label: 'Calendar', Icon: IcCal, View: Calendar, roles: ['admin', 'manager', 'viewer'] },
  { id: 'props', label: 'Properties', Icon: IcBuilding, View: Properties, roles: ['admin', 'manager', 'viewer'] },
  { id: 'team', label: 'Team', Icon: IcUsers, View: Team, roles: ['admin', 'manager'] },
  { id: 'import', label: 'Import', Icon: IcImport, View: Import, roles: ['admin', 'manager'] },
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

  return (
    <div className="app desk">
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
          <div className="brand"><Mark /> Caliper <span className="sub">beta</span></div>
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
