/* Round24 service worker — Web Push only (no caching yet; the offline queue
   lives in the app). Shows a system notification for each push and opens the
   app at the right tab when it's tapped. Payload shape (from the push-send
   edge function): { title, body, tag, url, tab, priority }. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { title: 'Round24', body: event.data ? event.data.text() : '' }; }
  const urgent = data.priority === 'urgent';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || undefined,          // same tag → replaces, never stacks duplicates
    renotify: !!data.tag,
    requireInteraction: urgent,          // an urgent job stays on screen until acted on
    vibrate: urgent ? [80, 40, 80] : [40],
    data: { url: data.url || '/', tab: data.tab || null },
  };
  event.waitUntil((async () => {
    if (!urgent) {
      // the app is in front → the in-app toast and feed already show it; a
      // system banner on top would be noise (Chrome allows skipping when focused)
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (wins.some((c) => c.visibilityState === 'visible' && c.focused)) return;
    }
    await self.registration.showNotification(data.title || 'Round24', options);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const client = list.find((c) => 'focus' in c);
      if (client) {
        // navigate() only works on clients this worker controls; fall back to a plain focus
        const nav = typeof client.navigate === 'function' ? client.navigate(url).catch(() => client) : Promise.resolve(client);
        return nav.then((c) => (c || client).focus());
      }
      return self.clients.openWindow(url);
    }),
  );
});
