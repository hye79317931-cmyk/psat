'use strict';

const RELEASE = 89;
const CACHE_NAME = `psat-random-note-v${RELEASE}`;
const APP_SHELL = new URL('index.html', self.registration.scope);
const APP_ENTRY = new URL(self.registration.scope);
const ASSETS = [
  `./styles.css?v=${RELEASE}`,
  `./app.js?v=${RELEASE}`,
  `./manifest.webmanifest?v=${RELEASE}`,
  './icon-192.png',
  './icon-512.png'
];
const assetUrls = new Set(ASSETS.map((asset) => new URL(asset, APP_ENTRY).href));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await fetch(APP_SHELL, { cache: 'no-store' });
    if (!shell.ok || !(await shell.clone().text()).includes(`src="app.js?v=${RELEASE}"`)) {
      throw new Error('App shell does not match the service worker release');
    }
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS.map((asset) => new Request(new URL(asset, APP_ENTRY), { cache: 'no-store' })));
    await cache.put(APP_SHELL, shell);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('psat-random-note-') && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'PSAT_GET_RELEASE') {
    event.source?.postMessage({ type: 'PSAT_RELEASE', release: RELEASE });
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    const url = new URL(request.url);
    if (url.origin === APP_ENTRY.origin && [APP_ENTRY.pathname, APP_SHELL.pathname].includes(url.pathname)) {
      event.respondWith(caches.match(APP_SHELL, { cacheName: CACHE_NAME }).then((shell) => shell || fetch(request)));
    }
    return;
  }

  if (assetUrls.has(request.url)) {
    event.respondWith(caches.match(request, { cacheName: CACHE_NAME }).then((asset) => asset || fetch(request)));
  }
});
