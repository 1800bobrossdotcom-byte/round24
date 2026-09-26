import { useMemo, useState } from 'react';
import { todayISO } from '../lib/dates.js';
import { sortBookings, bookingSummary } from '../lib/amenity.js';
import { useAuth } from '../components/AuthGate.jsx';
import { IcBuilding, IcCheck, IcX } from '../components/ui.jsx';

const inp = { width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, padding: 9, borderRadius: 3 };
const isLand = (u) => u.type === 'land' || u.status === 'held';
const fmtDate = (d) => (!d ? '' : new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }));
const fmtTime = (t) => (!t ? '' : (() => { const [h, m] = t.split(':').map(Number); const ap = h < 12 ? 'a' : 'p'; const hh = h % 12 || 12; return `${hh}:${String(m).padStart(2, '0')}${ap}`; })());
const slot = (b) => (b.startTime ? `${fmtTime(b.startTime)}–${fmtTime(b.endTime)}` : 'all day');

// Amenity reservations (staff) — define bookable spaces, and confirm/decline the
// requests residents & tenants send in.
export default function Amenities({ store }) {
  const { amenities = [], bookings = [], saveAmenity, removeAmenity, setBooking, leasing = [] } = store;
  const { role } = useAuth();
  const canEdit = role === 'admin' || role === 'manager';
  const [today] = useState(() => todayISO());
  const [edit, setEdit] = useState(null);

  const nameOf = useMemo(() => Object.fromEntries(amenities.map((a) => [a.id, a])), [amenities]);
  const sum = useMemo(() => bookingSummary(bookings, today), [bookings, today]);
  const pending = useMemo(() => sortBookings(bookings.filter((b) => b.status === 'pending')), [bookings]);
  const upcoming = useMemo(() => sortBookings(bookings.filter((b) => b.status === 'confirmed' && (b.date || '') >= today)), [bookings, today]);
  const buildings = useMemo(() => [...new Set(leasing.filter((u) => !isLand(u) && u.building).map((u) => u.building))].sort(), [leasing]);

  // default to building-wide ('') so scoping DOWN to one building is a deliberate
  // choice — otherwise a shared space silently binds to the first building and
  // hides from every other building's residents (audit #19)
  const startAdd = () => setEdit({ name: '', building: '', description: '', capacity: '', hours: '', requiresApproval: true, active: true });
  const dset = (k, v) => setEdit((e) => ({ ...e, [k]: v }));
  const save = () => { saveAmenity({ ...edit, name: edit.name.trim(), capacity: edit.capacity === '' ? null : Number(edit.capacity) }); setEdit(null); };

  const bookingRow = (b, actions) => {
    const a = nameOf[b.amenityId];
    return (
      <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{a?.name || 'Amenity'} <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>· {b.bookedBy}</span></div>
          <div className="note" style={{ margin: '2px 0 0' }}>{fmtDate(b.date)} · {slot(b)}{b.building ? ` · ${b.building}${b.unit ? ' ' + b.unit : ''}` : ''}{b.notes ? ` — ${b.notes}` : ''}</div>
        </div>
        {actions}
      </div>
    );
  };

  return (
    <div>
      <div className="view-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1>Amenities</h1>
          <p>Bookable shared spaces — conference rooms, the roof, the community room, laundry. Residents and tenants request; you confirm.</p>
        </div>
        {canEdit && <button className="btn grad" style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={startAdd}>+ New space</button>}
      </div>

      <div className="rr-kpis">
        <div className="kpi-c"><span className="v mono">{amenities.filter((a) => a.active).length}</span><span className="k">bookable spaces</span></div>
        <div className="kpi-c"><span className="v mono" style={{ color: sum.pending ? 'var(--warn)' : 'var(--text-faint)' }}>{sum.pending}</span><span className="k">pending requests</span></div>
        <div className="kpi-c"><span className="v mono" style={{ color: 'var(--money)' }}>{sum.confirmedUpcoming}</span><span className="k">upcoming holds</span></div>
      </div>

      {edit && canEdit && (
        <div className="card" style={{ border: '1px solid var(--accent)' }}>
          <div className="field-label" style={{ marginTop: 0 }}>{edit.id ? 'Edit space' : 'New bookable space'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <label>Name<input style={inp} value={edit.name} onChange={(e) => dset('name', e.target.value)} placeholder="Conference room" /></label>
            <label>Building
              {buildings.length ? (
                <select style={inp} value={edit.building} onChange={(e) => dset('building', e.target.value)}>
                  <option value="">Any / building-wide</option>
                  {buildings.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              ) : <input style={inp} value={edit.building} onChange={(e) => dset('building', e.target.value)} />}
            </label>
            <label>Capacity<input type="number" style={inp} value={edit.capacity} onChange={(e) => dset('capacity', e.target.value)} placeholder="—" /></label>
            <label>Hours<input style={inp} value={edit.hours} onChange={(e) => dset('hours', e.target.value)} placeholder="8:00a–6:00p" /></label>
          </div>
          <label style={{ display: 'block', marginTop: 10 }}>Description<input style={inp} value={edit.description} onChange={(e) => dset('description', e.target.value)} placeholder="Optional" /></label>
          <div style={{ display: 'flex', gap: 18, marginTop: 12, flexWrap: 'wrap' }}>
            <label className="rr-check" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={edit.requiresApproval} onChange={(e) => dset('requiresApproval', e.target.checked)} /> Requires office approval</label>
            <label className="rr-check" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={edit.active} onChange={(e) => dset('active', e.target.checked)} /> Bookable</label>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
            {edit.id && <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => { removeAmenity(edit.id); setEdit(null); }}>Delete</button>}
            <span style={{ flex: 1 }} />
            <button className="btn ghost sm" onClick={() => setEdit(null)}>Cancel</button>
            <button className="btn grad sm" onClick={save} disabled={!edit.name.trim()}>Save</button>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div className="card">
          <span className="field-label" style={{ display: 'block' }}>Requests to review ({pending.length})</span>
          {pending.map((b) => bookingRow(b, canEdit && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn grad sm" style={{ width: 'auto' }} onClick={() => setBooking(b.id, 'confirmed')}><IcCheck width={13} height={13} /> Confirm</button>
              <button className="btn ghost sm" style={{ width: 'auto', color: 'var(--danger)' }} onClick={() => setBooking(b.id, 'declined')}><IcX width={13} height={13} /></button>
            </div>
          )))}
        </div>
      )}

      <div className="card">
        <span className="field-label" style={{ display: 'block' }}>Upcoming ({upcoming.length})</span>
        {upcoming.length === 0 && <p className="note" style={{ margin: '8px 0 0' }}>No upcoming reservations.</p>}
        {upcoming.map((b) => bookingRow(b, canEdit && <button className="btn ghost sm" style={{ width: 'auto' }} onClick={() => setBooking(b.id, 'cancelled')}>Cancel</button>))}
      </div>

      <div className="card">
        <span className="field-label" style={{ display: 'block', marginBottom: 4 }}>Bookable spaces</span>
        {amenities.length === 0 && <p className="note">No spaces yet.{canEdit ? ' Add one above.' : ''}</p>}
        {amenities.map((a) => (
          <div key={a.id} className={canEdit ? 'rr-link' : ''} onClick={canEdit ? () => setEdit({ ...a, capacity: a.capacity ?? '', building: a.building || '', description: a.description || '', hours: a.hours || '' }) : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)', cursor: canEdit ? 'pointer' : 'default', opacity: a.active ? 1 : 0.5 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{a.name}{!a.active && <span className="chip" style={{ marginLeft: 8 }}>off</span>}</div>
              <div className="note" style={{ margin: '2px 0 0' }}>
                {a.building && <><IcBuilding width={11} height={11} style={{ verticalAlign: -1 }} /> {a.building} · </>}
                {a.capacity ? `seats ${a.capacity} · ` : ''}{a.hours || 'hours n/a'}{a.requiresApproval ? ' · approval required' : ' · instant'}
              </div>
            </div>
            {canEdit && <span className="lnk" style={{ color: 'var(--text-faint)', fontSize: 12 }}>edit</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
