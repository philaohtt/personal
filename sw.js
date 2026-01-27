const CACHE = "financeflow-v1";
const ASSETS = [
  "/personal/",
  "/personal/index.html",
  // add your core css/js files here (the ones needed to render the app shell)
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request))
  );
});
