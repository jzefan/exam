/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

// 1. Bypass list — checked BEFORE Workbox sees the request.
//    Bare `return` (no respondWith) means the browser handles natively.
const BYPASS_PATTERNS = [/^\/api\//];

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    url.origin === self.location.origin &&
    BYPASS_PATTERNS.some((re) => re.test(url.pathname))
  ) {
    return;
  }
});

// 2. Precache static assets (manifest injected at build time).
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// 3. Messaging — explicit, no clientsClaim().
self.addEventListener("message", (e) => {
  if (e.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (e.data?.type === "CLEAR_CACHES") {
    e.waitUntil(
      caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))),
    );
  }
});

// 4. DO NOT call clientsClaim() — it hot-swaps the controller on the active
//    exam tab and can break in-flight requests.
