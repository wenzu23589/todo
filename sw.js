// Daybook service worker — caches the app shell so the installed app opens
// instantly and works offline. The task list itself is kept on each device by
// the app (see "offline copy on this device" in index.html) and synced with
// GitHub whenever a connection is available; this worker only serves the page.

const CACHE_NAME = "daybook-shell-v2";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Only handle same-origin requests (the app shell itself). Everything else —
  // GitHub Contents API, Google Calendar API, Google Identity, Google Fonts —
  // must always go straight to the network so data stays live.
  if (url.origin !== self.location.origin) return;

  const isNavigation = req.mode === "navigate";

  event.respondWith(
    // ignoreSearch on page loads, so e.g. "/?source=pwa" still finds the cached page.
    caches.match(req, isNavigation ? { ignoreSearch: true } : undefined).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => {
        if (cached) return cached;
        // Offline and this exact address was never cached: any page load still gets the app.
        if (isNavigation) return caches.match("./index.html");
        return Response.error();
      });
      // Stale-while-revalidate: serve cache immediately if we have it, refresh in background.
      return cached || network;
    })
  );
});
