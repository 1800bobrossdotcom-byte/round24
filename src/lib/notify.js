// ============================================================
// Notification helpers shared by the bell, Settings and the store.
// Browser (system) notifications are opt-in: we never call
// requestPermission() on load — only from a button the person tapped.
// ============================================================

import { pushSupported, pushConfigured, registerServiceWorker, subscribePush, unsubscribePush, getPushSubscription, subscriptionRow } from './push.js';
import { isConfigured, savePushSubscription, deletePushSubscription } from './backend/supabase.js';

// What the controls show for THIS device:
//   'unsupported' · 'denied' · 'off' (not enabled yet)
//   'local'  — system notifications while Round24 is open (no push endpoint)
//   'push'   — this device receives pushes even with Round24 closed
export async function notificationState() {
  const perm = browserPermission();
  if (perm === 'unsupported' || perm === 'denied') return perm;
  if (perm !== 'granted') return 'off';
  if (!pushAvailable()) return 'local';
  try { return (await getPushSubscription()) ? 'push' : 'local'; } catch { return 'local'; }
}
// push needs: a browser that can, VAPID keys in the build, and a connected org to store the endpoint
export const pushAvailable = () => pushSupported() && pushConfigured() && isConfigured();

// the single enable flow: permission → (when push is available) subscribe + save the endpoint
export async function enableNotifications({ orgId } = {}) {
  const perm = await requestBrowserPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  if (!pushAvailable()) return 'local';
  try {
    await registerServiceWorker();
    const sub = await subscribePush();
    await savePushSubscription(orgId, subscriptionRow(sub));
    return 'push';
  } catch { return 'local'; }
}
// stop pushes to this device (permission itself stays — that's the browser's to change)
export async function disableNotificationsHere() {
  const endpoint = await unsubscribePush().catch(() => null);
  if (endpoint && isConfigured()) await deletePushSubscription(endpoint).catch(() => {});
  return browserPermission() === 'granted' ? 'local' : 'off';
}

export function browserPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

export async function requestBrowserPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

// fire a system notification if allowed. Quiet when the tab is in front unless
// it's urgent — the in-app toast already covers the visible case.
export function systemNotify(title, { body, priority = 'info', tag } = {}) {
  if (browserPermission() !== 'granted') return false;
  const hidden = typeof document !== 'undefined' && document.visibilityState !== 'visible';
  if (!hidden && priority !== 'urgent') return false;
  try { new Notification(title, { body: body || undefined, tag, icon: '/icon-192.png', badge: '/icon-192.png' }); return true; }
  catch { return false; } // mobile browsers need a service worker; the toast + feed still show it
}

// "just now · 4m · 2h · yesterday · Sep 12"
export function ago(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
