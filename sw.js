'use strict';

const CACHE_NAME = 'psat-random-note-v88';
const ASSETS = [
  './?v=88',
  './index.html',
  './styles.css?v=88',
  './app.js?v=88',
  './manifest.webmanifest?v=88',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('psat-random-note-') && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request, { cache: 'no-store' });
        if (!response || !response.ok) throw new Error(`navigation HTTP ${response?.status || 0}`);
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', clone)).catch(() => {});
        return response;
      } catch (err) {
        return (await caches.match('./index.html')) ||
          (await caches.match('./?v=88')) ||
          Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (!response || !response.ok) throw new Error(`asset HTTP ${response?.status || 0}`);
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
      return response;
    } catch (err) {
      return cached || Response.error();
    }
  })());
});
