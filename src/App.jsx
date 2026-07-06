import { useState } from 'react';
import { AuthGate, SignOutButton, AccountButton } from './components/AuthGate.jsx';
import { useStore } from './lib/store.js';
import { Mark, IcDash, IcClock, IcBuilding, IcUsers, IcImport } from './components/ui.jsx';
import Dashboard from './views/Dashboard.jsx';
import Field from './views/Field.jsx';
import Properties from './views/Properties.jsx';
import Team from './views/Team.jsx';
import Import from './views/Import.jsx';

const TABS = [
  { id: 'dash', label: 'Dashboard', Icon: IcDash, View: Dashboard },
  { id: 'field', label: 'Field', Icon: IcClock, View: Field },
  { id: 'props', label: 'Properties', Icon: IcBuilding, View: Properties },
  { id: 'team', label: 'Team', Icon: IcUsers, View: Team },
  { id: 'import', label: 'Import', Icon: IcImport, View: Import },
];

export default function App() {
  const store = useStore();
  const [tab, setTab] = useState('dash');
  const Active = TABS.find((t) => t.id === tab).View;

  return (
    <AuthGate>
    <div className="app desk">
      {/* desktop side rail brand (hidden on mobile) */}
      <nav className="tabbar">
        <div className="desk-brand"><Mark /> Caliper</div>
        {TABS.map(({ id, label, Icon }) => (
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
    </AuthGate>
  );
}
