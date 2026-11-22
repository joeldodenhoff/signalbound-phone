// Keeps the GPS test working with no signal: the network first, this copy
// when there is none. Nothing but the page's own files is stored.
"use strict";
const CACHE = "signalbound-gps-test-2";
const FILES = ["./", "index.html", "app.js", "serial.js", "manifest.json", "sb-theme.css", "fonts/KenneyPixel.ttf", "fonts/KenneyMini.ttf", "art/icon-192.png", "art/icon-512.png"];
self.addEventListener("install", ev => ev.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", ev => ev.waitUntil(self.clients.claim()));
self.addEventListener("fetch", ev => {
  if (ev.request.method !== "GET" || new URL(ev.request.url).origin !== location.origin) return;
  ev.respondWith(fetch(ev.request).then(r => {
    const copy = r.clone();
    caches.open(CACHE).then(c => c.put(ev.request, copy));
    return r;
  }).catch(() => caches.match(ev.request, { ignoreSearch: true })));
});
