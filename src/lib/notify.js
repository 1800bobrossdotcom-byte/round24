// ============================================================
// Notification helpers shared by the bell, Settings and the store.
// Browser (system) notifications are opt-in: we never call
// requestPermission() on load — only from a button the person tapped.
// ============================================================

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
