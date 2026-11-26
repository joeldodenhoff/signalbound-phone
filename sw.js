// Keeps the page working with no signal: the network first, this copy when
// there is none. Nothing but the page's own files is stored.
"use strict";
const CACHE = "signalbound-phone-20261125-smooth32-v7";
const FILES = ["./", "index.html", "style.css", "app.js", "manifest.json", "icon.svg", "assets/game.ttf", "assets/sigil.svg"];
self.addEventListener("install", ev => ev.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", ev => ev.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("signalbound-phone") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", ev => {
  if (ev.request.method !== "GET" || new URL(ev.request.url).origin !== location.origin) return;
  ev.respondWith(fetch(ev.request).then(r => {
    const copy = r.clone();
    caches.open(CACHE).then(c => c.put(ev.request, copy));
    return r;
  }).catch(() => caches.match(ev.request)));
});
