import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './AuthGate.jsx';
import { notificationState, enableNotifications, disableNotificationsHere, pushAvailable } from '../lib/notify.js';
import { iosNeedsInstall } from '../lib/push.js';
import { IcCheck } from './ui.jsx';

// One "notifications on this device" control, shared by the bell footer and
// Settings so the two never disagree. States (see lib/notify.js):
//   off · local (system pings while Caliper is open) · push (even when closed)
//   denied · unsupported
export function useNotifyState() {
  const { orgId } = useAuth();
  const [state, setState] = useState('off');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    notificationState().then((st) => { if (alive) setState(st); });
    return () => { alive = false; };
  }, []);
  const run = useCallback(async (fn) => { setBusy(true); try { setState(await fn()); } finally { setBusy(false); } }, []);
  const enable = useCallback(() => run(() => enableNotifications({ orgId })), [run, orgId]);
  const disable = useCallback(() => run(disableNotificationsHere), [run]);
  return { state, busy, enable, disable, canPush: pushAvailable(), iosInstall: iosNeedsInstall() };
}

export function notifyHint({ state, canPush, iosInstall }) {
  if (state === 'push') return 'On for this device — even when Caliper is closed';
  if (state === 'local') return canPush ? 'On while Caliper is open — enable push to get pinged when it’s closed' : 'On while Caliper is open';
  if (state === 'denied') return 'Blocked for this site — allow notifications in your browser settings';
  if (state === 'unsupported') return iosInstall ? 'On iPhone: Share → Add to Home Screen, then enable from the installed app' : 'Not available in this browser';
  return canPush ? 'Get pinged on this device, even when Caliper is closed' : 'Get pinged when Caliper is in the background';
}

// inline flavour for the bell footer
export default function NotifyControl() {
  const { state, busy, enable, disable, canPush, iosInstall } = useNotifyState();
  if (state === 'push') {
    return (
      <span className="note"><IcCheck width={12} height={12} /> Push on for this device
        <button className="lnk" onClick={disable} disabled={busy}>Turn off</button>
      </span>
    );
  }
  if (state === 'local' && !canPush) return <span className="note"><IcCheck width={12} height={12} /> Browser notifications on</span>;
  if (state === 'denied') return <span className="note">Notifications are blocked for this site — allow them in your browser settings.</span>;
  if (state === 'unsupported') {
    return <span className="note">{iosInstall ? 'On iPhone: Share → Add to Home Screen, then enable notifications from the installed app.' : 'This browser can’t show system notifications.'}</span>;
  }
  return (
    <button className="btn ghost sm" onClick={enable} disabled={busy}>
      {busy ? 'Enabling…' : state === 'local' ? 'Enable push on this device' : 'Enable notifications'}
    </button>
  );
}
