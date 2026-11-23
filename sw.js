const CACHE_NAME = "browndy-predicts-v3";

const APP_FILES = [
  "/",
  "/manifest.json",
  "/icons/icon.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      await Promise.all(
        APP_FILES.map(async file => {
          try {
            await cache.add(file);
          } catch (error) {
            console.log("Could not cache:", file);
          }
        })
      );

      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys
          .filter(key =>
            key.startsWith("browndy-predicts-") &&
            key !== CACHE_NAME
          )
          .map(key => caches.delete(key))
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/account") ||
    url.pathname.startsWith("/functions/")
  ) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      if (request.mode === "navigate") {
        try {
          const response = await fetch(request);

          if (response.ok) {
            await cache.put("/", response.clone());
          }

          return response;
        } catch (error) {
          return (
            await cache.match("/") ||
            new Response(
              "Browndy Predicts is offline. Please reconnect.",
              { headers: { "Content-Type": "text/plain" } }
            )
          );
        }
      }

      const cached = await cache.match(request);

      if (cached) return cached;

      try {
        const response = await fetch(request);

        if (response.ok) {
          await cache.put(request, response.clone());
        }

        return response;
      } catch (error) {
        return new Response("You are offline.", { status: 503 });
      }
    })()
  );
});
