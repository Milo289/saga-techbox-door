// Minimal service worker so the control panel can be installed as an app.
// It never caches anything: the panel always shows live data.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
