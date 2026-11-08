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

// 2. Precache the app shell only (manifest injected at build time).
//
//    The 244 hashed JS chunks used to be precached here too: every client
//    pulled ~6MB (2MB gzipped) on every release, eagerly, while the student was
//    still trying to log in — on a 3Mbps edge link that starved the login and
//    exam-start requests. Chunks are now runtime-cached (step 3) as they are
//    actually used, so a page is offline-capable once it has been opened.
//
//    Read the injected precache manifest once: workbox-build asserts on more
//    than one reference to it in swSrc, and the runtime route below needs it.

const PRECACHE_MANIFEST = self.__WB_MANIFEST;
cleanupOutdatedCaches();
precacheAndRoute(PRECACHE_MANIFEST);

// 3. Runtime cache for build output: cache-first.
//    Filenames are content-hashed, so a URL can never change content — a new
//    build ships new filenames. Revalidating on every hit would just re-download
//    immutable bytes over a 3Mbps link, so a hit is served straight from cache.
const RUNTIME_CACHE = "exam-assets-v1";
const RUNTIME_ASSET_PREFIX = "/assets/";
// Old builds' chunks linger after a release; keep the cache bounded.
const RUNTIME_MAX_ENTRIES = 400;

// URLs already handled by the precache route. Calling respondWith() for one of
// them would throw (the event is already being responded to) once Workbox's
// own listener has run, so the runtime route must skip them.
const PRECACHED_PATHS = new Set(
  (PRECACHE_MANIFEST as (string | { url: string })[]).map((entry) =>
    (typeof entry === "string" ? entry : entry.url).replace(/^\//, ""),
  ),
);

async function trimRuntimeCache(cache: Cache): Promise<void> {
  const keys = await cache.keys();
  if (keys.length <= RUNTIME_MAX_ENTRIES) {
    return;
  }
  await Promise.all(
    keys
      .slice(0, keys.length - RUNTIME_MAX_ENTRIES)
      .map((request) => cache.delete(request)),
  );
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(RUNTIME_ASSET_PREFIX) ||
    PRECACHED_PATHS.has(url.pathname.replace(/^\//, ""))
  ) {
    return;
  }

  event.respondWith(
    caches.open(RUNTIME_CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) {
        return cached;
      }
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          await cache.put(event.request, response.clone());
          void trimRuntimeCache(cache);
        }
        return response;
      } catch {
        // No cache entry and no network: let the page surface the real error.
        return Response.error();
      }
    }),
  );
});

// Drop runtime caches from previous naming schemes; leave Workbox's own
// precache caches alone (cleanupOutdatedCaches owns those).
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("exam-assets-") && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
});

// 4. Messaging — explicit, no clientsClaim().
self.addEventListener("message", (e) => {
  if (e.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (e.data?.type === "CLEAR_CACHES") {
    e.waitUntil(
      caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))),
    );
  }
});

// 5. DO NOT call clientsClaim() — it hot-swaps the controller on the active
//    exam tab and can break in-flight requests.
