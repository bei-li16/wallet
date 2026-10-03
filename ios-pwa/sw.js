/* Release the entire shell together; a waiting worker activates only on user request. */
"use strict";
const VERSION = "1.5.0-1";
const BASE = new URL("./", self.location.href);
const PREFIX = "wallet-pwa:" + BASE.pathname + ":";
const CACHE = PREFIX + VERSION;
const SHELL = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/vendor/vue.global.prod.js",
  "./js/vendor/echarts.min.js",
  "./js/domain/core.js",
  "./js/storage.js",
  "./js/icons.js",
  "./js/charts.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
].map((path) => new URL(path, BASE).href);
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(SHELL.map((url) => new Request(url, { cache: "reload" }))),
      ),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(PREFIX) && key !== CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") self.skipWaiting();
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== BASE.origin ||
    !url.pathname.startsWith(BASE.pathname)
  )
    return;
  // Only application shell files are cached, never imported/exported financial data.
  if (
    event.request.mode === "navigate" &&
    (url.pathname === BASE.pathname ||
      url.pathname === BASE.pathname + "index.html")
  ) {
    event.respondWith(
      caches
        .open(CACHE)
        .then((cache) => cache.match(new URL("./index.html", BASE).href))
        .then((cached) => cached || fetch(event.request)),
    );
    return;
  }
  const key = url.origin + url.pathname;
  if (SHELL.includes(key))
    event.respondWith(
      caches
        .open(CACHE)
        .then((cache) => cache.match(key))
        .then((cached) => cached || fetch(event.request)),
    );
});
