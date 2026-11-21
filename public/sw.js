// Minimaler Service-Worker: macht die Seite als App installierbar (Chrome/Android). Kein Cache – es wird immer die aktuelle Version geladen.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {}); // bewusst ohne respondWith: der Browser holt alles direkt aus dem Netz
