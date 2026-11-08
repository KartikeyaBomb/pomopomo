const CACHE = 'pomopomo-shell-v5';
const SHELL = ['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable.png', '/icons/apple-touch-icon.png'];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Cache only the app shell, never sign-in redirects or API responses.
    for (const url of SHELL) {
      const response = await fetch(url, { credentials: 'same-origin', cache: 'reload' });
      if (!response.ok || response.redirected) throw new Error('App shell unavailable');
      await cache.put(url, response);
    }
    const page = await cache.match('/');
    const html = await page.text();
    const assets = [...html.matchAll(/(?:src|href)="([^"<>]+\.(?:js|css))"/g)].map(match => new URL(match[1], self.location.origin));
    await Promise.all(assets.filter(url => url.origin === self.location.origin).map(url => cache.add(url.href)));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter(key => key.startsWith('pomopomo-shell-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || /signin|signout|callback/.test(url.pathname)) return;
  if (request.mode === 'navigate' && url.pathname === '/') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok && !response.redirected) { const cache = await caches.open(CACHE); await cache.put('/', response.clone()); }
        return response;
      } catch { return await caches.match('/') || Response.error(); }
    })());
  } else if (['script', 'style', 'image', 'font'].includes(request.destination) || url.pathname === '/manifest.webmanifest') {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && !response.redirected) { const cache = await caches.open(CACHE); await cache.put(request, response.clone()); }
      return response;
    })());
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (app) return app.focus();
    return self.clients.openWindow('/');
  })());
});
