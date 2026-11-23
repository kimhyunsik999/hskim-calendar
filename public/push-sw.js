// Imported into the generated service worker (vite-plugin-pwa workbox.importScripts).
self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(d.title || '4조 근무표', {
      body: d.body || '근무표가 변경되었습니다.',
      tag: d.tag,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: d.url || './' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const w = wins[0];
      if (w) return w.focus();
      return self.clients.openWindow(event.notification.data?.url || './');
    }),
  );
});
