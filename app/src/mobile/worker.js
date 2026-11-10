/* Build substitutes the content-derived cache version. Only these two data-free
   resources enter CacheStorage; visited pages and API responses never do. */
const CACHE = "brag-static-__VERSION__";
const FILES = ["/pwa/offline.html", "/pwa/offline.js"];
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const responses = await Promise.all(
        FILES.map(async (file) => {
          const url = new URL(file, self.location.origin).href;
          const response = await fetch(url, {
            credentials: "omit",
            cache: "no-store",
            redirect: "error",
          });
          if (!response.ok || response.url !== url || response.type !== "basic")
            throw new Error("Offline resource unavailable");
          return response;
        }),
      );
      const cache = await caches.open(CACHE);
      await Promise.all(FILES.map((file, index) => cache.put(file, responses[index])));
    })(),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("brag-static-") && key !== CACHE)
          .map((key) => caches.delete(key)),
      );
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (FILES.includes(url.pathname) && !url.search) {
    event.respondWith(
      caches
        .open(CACHE)
        .then((cache) => cache.match(url.pathname))
        .then((cached) => cached || fetch(request)),
    );
    return;
  }
  if (
    request.mode !== "navigate" ||
    /^\/(api|health|_next|pwa|catalogue|sign-in)(\/|$)/.test(url.pathname)
  )
    return;
  event.respondWith(
    fetch(request, { cache: "no-store" }).catch(async () => {
      const cached = await (await caches.open(CACHE)).match("/pwa/offline.html");
      return cached || Response.error();
    }),
  );
});
