/* eslint-disable no-restricted-globals */
import { clientsClaim } from 'workbox-core';
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate } from 'workbox-strategies';

clientsClaim();

// CRA injects the manifest of files here at build time
precacheAndRoute(self.__WB_MANIFEST);

// Make SPA routing work offline
registerRoute(
  ({ request }) => request.mode === 'navigate',
  createHandlerBoundToURL(process.env.PUBLIC_URL + '/index.html')
);

// Cache images a bit
registerRoute(
  ({ request }) => request.destination === 'image',
  new StaleWhileRevalidate({ cacheName: 'images' })
);

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
