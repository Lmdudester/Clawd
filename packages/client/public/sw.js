// Take over immediately when updated — don't wait for tabs to close
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function logToClients(message) {
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      client.postMessage({ type: 'sw-log', message });
    }
  });
}

self.addEventListener('push', (event) => {
  if (!event.data) return;

  const { title, body, url } = event.data.json();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      const visibleClient = windowClients.find(
        (c) => c.visibilityState === 'visible' && c.url.includes(self.location.origin),
      );

      if (visibleClient) {
        logToClients(`[SW] push suppressed (app visible): "${title}" — "${body}"`);
        return;
      }

      logToClients(`[SW] push showing: "${title}" — "${body}"`);
      return self.registration.showNotification(title || 'Clawd', {
        body: body || '',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: `clawd-${Date.now()}`,
        data: { url },
      }).then(() => navigator.setAppBadge?.(1));
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin)) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
