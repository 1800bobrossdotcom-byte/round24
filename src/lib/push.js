// ============================================================
// Web Push — the browser side. A device subscribes once (after the person
// taps Enable), its subscription is saved to push_subscriptions, and the
// push-send edge function delivers to it even when Caliper isn't open.
// Configured by VITE_VAPID_PUBLIC_KEY (see docs/PUSH-SETUP.md); without it the
// app quietly falls back to in-app + local system notifications.
// ============================================================

export const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY || '').trim();
export const pushConfigured = () => VAPID_PUBLIC_KEY.length > 0;
export const pushSupported = () => typeof window !== 'undefined'
  && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// applicationServerKey wants the raw P-256 public key as bytes
export function urlBase64ToUint8Array(base64) {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const bin = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('/sw.js', { scope: '/' }); }
  catch { return null; }
}

// `ready` never settles when no worker is registered — bound the wait
function readyRegistration(ms = 3000) {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, rej) => setTimeout(() => rej(new Error('service worker not ready')), ms)),
  ]);
}

export async function getPushSubscription() {
  if (!pushSupported()) return null;
  const reg = await readyRegistration();
  return reg.pushManager.getSubscription();
}

export async function subscribePush() {
  const reg = await readyRegistration();
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
}

// returns the endpoint that was dropped (so the server row can go too), or null
export async function unsubscribePush() {
  const sub = await getPushSubscription().catch(() => null);
  if (!sub) return null;
  const { endpoint } = sub;
  try { await sub.unsubscribe(); } catch { /* the server row is still removed */ }
  return endpoint;
}

// the row shape push_subscriptions stores
export function subscriptionRow(sub) {
  const j = sub.toJSON ? sub.toJSON() : sub;
  return { endpoint: j.endpoint, p256dh: j.keys?.p256dh || null, auth: j.keys?.auth || null };
}

// iOS only delivers push to web apps installed on the Home Screen; in a Safari
// tab there is no Notification API at all, so the controls point people there
export function iosNeedsInstall() {
  if (typeof navigator === 'undefined') return false;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true
    || (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
  return ios && !standalone;
}
