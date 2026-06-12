const CACHE_NAME = "decibel-v6"; // Bumped to v6 to force update
const FILES_TO_CACHE = [
  "/Decibel/",
  "/Decibel/index.html",
  "/Decibel/style.css",
  "/Decibel/script.js",
  "/Decibel/manifest.json"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES_TO_CACHE))
  );
});

self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => response || fetch(e.request))
  );
});