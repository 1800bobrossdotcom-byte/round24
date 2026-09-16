import { useEffect, useMemo, useState } from 'react';
import { attentionItems } from '../lib/attention.js';
import { todayISO } from '../lib/dates.js';
import { ago, browserPermission, requestBrowserPermission } from '../lib/notify.js';
import { totals } from '../lib/rollups.js';
import { IcBell, IcX, IcWrench, IcChat, IcReceipt, IcBuilding, IcClock, IcCheck } from './ui.jsx';

// The bell in the top bar: unread count, and a panel with two halves —
// "Needs attention" (live, computed from the data: urgent orders, receipts to
// review, lapsed insurance…) and "Activity" (the persisted feed every realtime
// event lands in). Tap a row to jump to that tab. Browser notifications are
// opt-in from the footer — never requested on load.
const KIND_ICON = { wo: IcWrench, chat: IcChat, purchase: IcReceipt, request: IcBuilding, clock: IcClock };

export default function NotificationBell({ store, navigate }) {
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState(() => browserPermission());
  const {
    notifications = [], unreadCount = 0, markNotificationRead, markNotificationsRead, clearNotifications,
    role, myName, timers = [], workOrders = [], purchases = [], maintRequests = [], cois = [], maintSchedules = [],
    bookings = [], vendors = [], timerQueueCount,
  } = store;

  const today = todayISO();
  const unallocatedHrs = useMemo(() => totals(timers.filter((t) => !t.propId)).hrs, [timers]);
  const attention = useMemo(() => attentionItems({
    role, myName, today, workOrders, purchases, maintRequests, cois, maintSchedules, bookings, vendors,
    unallocatedHrs, queuedTimers: typeof timerQueueCount === 'function' ? timerQueueCount() : 0,
  }), [role, myName, today, workOrders, purchases, maintRequests, cois, maintSchedules, bookings, vendors, unallocatedHrs, timerQueueCount, open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape closes; re-check system permission whenever the panel opens
  useEffect(() => {
    if (!open) return undefined;
    setPerm(browserPermission());
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const go = (tab) => { setOpen(false); if (tab && navigate) navigate(tab); };
  const enable = async () => setPerm(await requestBrowserPermission());
  const attentionCount = attention.reduce((a, i) => a + (i.priority === 'info' ? 0 : i.count), 0);
  const badge = unreadCount + attentionCount;

  return (
    <div className="nbell-wrap">
      <button className="btn ghost sm icon-btn nbell" onClick={() => setOpen((o) => !o)} aria-label={`Notifications${badge ? ` (${badge})` : ''}`} aria-expanded={open} title="Notifications">
        <IcBell width={16} height={16} />
        {badge > 0 && <span className="nav-badge">{badge > 99 ? '99+' : badge}</span>}
      </button>
      {open && (
        <>
          <div className="nbell-backdrop" onClick={() => setOpen(false)} />
          <div className="nbell-panel" role="dialog" aria-label="Notifications">
            <div className="nbell-head">
              <span>Notifications</span>
              <span style={{ flex: 1 }} />
              {unreadCount > 0 && <button className="lnk" onClick={markNotificationsRead}>Mark all read</button>}
              <button className="btn ghost sm icon-btn" onClick={() => setOpen(false)} aria-label="Close"><IcX width={14} height={14} /></button>
            </div>
            <div className="nbell-scroll">
              <div className="nbell-sec">Needs attention</div>
              {attention.length === 0
                ? <p className="note nbell-empty"><IcCheck width={13} height={13} /> You’re caught up.</p>
                : attention.map((a) => (
                  <button key={a.id} className={`nbell-item att prio-${a.priority}`} onClick={() => go(a.tab)}>
                    <span className="n mono">{a.count}</span>
                    <span className="body"><span className="t">{a.title}</span></span>
                    <span className="when">›</span>
                  </button>
                ))}
              <div className="nbell-sec">Activity</div>
              {notifications.length === 0
                ? <p className="note nbell-empty">Nothing yet — new work orders, receipts, resident requests, messages and clock-ins land here.</p>
                : notifications.slice(0, 60).map((n) => {
                  const Ic = KIND_ICON[n.kind] || IcBell;
                  return (
                    <button key={n.id} className={`nbell-item prio-${n.priority || 'info'}${n.read ? '' : ' unread'}`} onClick={() => { markNotificationRead?.(n.id); go(n.tab); }}>
                      <span className="ic"><Ic width={14} height={14} /></span>
                      <span className="body"><span className="t">{n.title}</span>{n.body && <span className="s">{n.body}</span>}</span>
                      <span className="when mono">{ago(n.ts)}</span>
                    </button>
                  );
                })}
            </div>
            <div className="nbell-foot">
              {perm === 'granted' ? <span className="note"><IcCheck width={12} height={12} /> Browser notifications on</span>
                : perm === 'denied' ? <span className="note">Browser notifications are blocked for this site — allow them in your browser settings.</span>
                : perm === 'unsupported' ? <span className="note">This browser can’t show system notifications.</span>
                : <button className="btn ghost sm" onClick={enable}>Enable browser notifications</button>}
              <span style={{ flex: 1 }} />
              {notifications.length > 0 && <button className="lnk" onClick={clearNotifications}>Clear</button>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
