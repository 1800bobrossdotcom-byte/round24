// src/layer1-developer/sections/Workspaces.jsx
// Read-only list for task02. task03 adds: expandable org detail (member
// roles, invites), Enter as support / Open / End session buttons — all the
// backend calls already exist in layer1Api.js (layer1OrgDetail,
// layer1SetMemberRole, layer1RemoveMember, layer1CreateInvite,
// layer1JoinWorkspace, layer1LeaveWorkspace); this section just doesn't call
// them yet.
import { useEffect, useState } from 'react';
import { layer1ListOrgs } from '../../lib/backend/layer1Api.js';

export default function Workspaces() {
  const [orgs, setOrgs] = useState(null);

  useEffect(() => { layer1ListOrgs().then(setOrgs); }, []);

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font)', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--line)' }}>
            {['Workspace', 'Kind', 'Members', 'Properties', 'Open orders', 'Last activity'].map((h) => (
              <th key={h} style={{ textAlign: 'left', padding: '10px 14px', color: 'var(--text-faint)', fontWeight: 500, fontSize: 11 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!orgs && (
            <tr><td colSpan={6} style={{ padding: 14, color: 'var(--text-faint)' }} className="mono">···</td></tr>
          )}
          {orgs?.map((o) => (
            <tr key={o.id} style={{ borderBottom: '1px solid var(--line-soft)' }}>
              <td style={{ padding: '10px 14px', color: 'var(--text)' }}>{o.name}</td>
              <td style={{ padding: '10px 14px', color: 'var(--text-dim)' }}>{o.kind}</td>
              <td className="mono" style={{ padding: '10px 14px', color: 'var(--text)' }}>{o.members}</td>
              <td className="mono" style={{ padding: '10px 14px', color: 'var(--text)' }}>{o.properties}</td>
              <td className="mono" style={{ padding: '10px 14px', color: 'var(--text)' }}>{o.open_orders}</td>
              <td className="mono" style={{ padding: '10px 14px', color: 'var(--text-faint)', fontSize: 11 }}>
                {o.last_activity ? new Date(o.last_activity).toLocaleDateString() : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
