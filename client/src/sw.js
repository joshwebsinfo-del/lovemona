import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';

// Workbox will inject the manifest here
// Runtime caching for video assets (mobile performance)
registerRoute(
  ({request}) => request.destination === 'video',
  new CacheFirst({
    cacheName: 'video-cache',
    plugins: [],
    // Keep videos for 30 days
    maxAgeSeconds: 30 * 24 * 60 * 60,
  })
);


// Handle Push Events
self.addEventListener('push', (event) => {
  if (!(self.Notification && self.Notification.permission === 'granted')) {
    return;
  }

  let data = { title: 'SecureLove', body: 'New message received.' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: 'SecureLove', body: event.data.text() };
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/securelove-icon.png',
    badge: data.badge || '/securelove-icon.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.data?.url || '/'
    },
    actions: [
      { action: 'open', title: 'Open World' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Handle Notification Clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data.url;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If a window is already open, focus it
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // If no window is open, open a new one
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
