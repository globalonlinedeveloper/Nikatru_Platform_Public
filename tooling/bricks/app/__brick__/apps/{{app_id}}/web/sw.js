// ─────────────────────────────────────────────────────────────────────────────
// sw.js — THE OFFLINE SHELL. Our own service worker, never Flutter's.
//
// [ADR 023] as amended 2026-09-30: "YES, a service worker … a train after
// offline-core". Until this file existed the web app was the one target that
// could not start offline: there was no worker, every entry point revalidates
// (`_headers`), so a cold load with the network off was the browser's own error
// page — while the read-through cache in packages/api_client held the user's
// list the whole time (row O-WEB-OFFLINE-COLD-LOAD-IS-BROWSER-ERROR).
//
// The amendment's five rules, and where each one lives:
//   1. OUR OWN WORKER. The build keeps `--pwa-strategy=none`, so Flutter emits no
//      worker of its own and its offline-first cache never exists; this file is
//      registered by web/sw-register.js, and nothing passes Flutter's loader a
//      `serviceWorkerSettings`.
//   2. ONLINE, THE NETWORK ALWAYS WINS. Every request this worker answers goes to
//      the network first; a cached copy is served ONLY when fetch() itself
//      rejects. An HTTP error is an answer and is passed through as one. So the
//      CFG-1 kill-switch and "the served build IS the deployed build" hold online
//      exactly as they did with no worker: what `_headers` makes the browser
//      revalidate, the network still answers.
//   3. ONE CACHE PER BUILD. The page registers `sw.js?build=<build_number>` from
//      the deployed version.json, so a new build is a new script URL, a new
//      install and a new cache; `activate` deletes this app's older caches.
//   4. THE SHARED ORIGIN. The app lives at nikatru.com/<id>/ beside the marketing
//      site and every other app, so: this script is at /<id>/sw.js, its scope is
//      /<id>/ (the most a script there may claim, so `Service-Worker-Allowed` is
//      never needed and never sent), it refuses to install under any other scope,
//      and every Cache Storage name it touches carries `nikatru-<id>-`. It opens
//      no IndexedDB at all. `caches.keys()` is the WHOLE origin's list, so
//      `activate` deletes only names under this app's prefix.
//   5. THE PROOF IS A RED CONTROL: tooling/smoke/smoke-web-artifact.mjs reloads
//      the built bundle with its server shut down, and the same reload with no
//      worker registered is the browser's error page and exits 1.
//
// 🔴 IT NEVER STORES AN API RESPONSE OR USER DATA. It answers only same-origin
// GETs inside its own scope — the static bundle. The API, sign-in and telemetry
// are other origins and are never intercepted; a request carrying credentials,
// a Range request, a `no-store` response and version.json (the deploy marker the
// post-deploy probe reads) are never stored. The user's data is #1075's cache,
// not this one's.
//
// tooling/ci/assert-web-cache-policy.mjs RUNS this file in a simulated worker
// scope and refuses one that serves a cached copy while the network answers, one
// whose cache name does not follow the build, or one that stores what it must not.
// The app brick's web/sw.js is the template this file is stamped from; the two
// differ in APP_ID alone, and tooling/ci/test/web-cache-policy.test.mjs holds them to it.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const APP_ID = '{{app_id}}';
/** Every Cache Storage name this worker creates, reads or deletes starts here. */
const CACHE_PREFIX = `nikatru-${APP_ID}-shell-`;
const BUILD = new URL(self.location.href).searchParams.get('build') ?? '';
const BUILD_OK = /^[0-9A-Za-z._-]{1,64}$/.test(BUILD);
const CACHE = `${CACHE_PREFIX}${BUILD}`;
const SCOPE = self.registration.scope;
/** Fetched on install, so the first online visit leaves a shell that can start. */
const SHELL = ['./', 'flutter_bootstrap.js'];
/** Paths inside the scope that are never answered or stored by this worker. */
const NEVER_STORED = new Set(['sw.js', 'version.json']);

/** True when this worker may answer `request`: a plain GET for the static bundle. */
function ownsRequest(request) {
  if (request.method !== 'GET') return false;
  if (request.headers.has('authorization') || request.headers.has('range')) return false;
  if (!request.url.startsWith(SCOPE)) return false;
  const rest = new URL(request.url).pathname.slice(new URL(SCOPE).pathname.length);
  return !NEVER_STORED.has(rest);
}

/** True when a network answer may be kept for the offline shell. */
function storable(response) {
  return (
    response.status === 200 &&
    response.type === 'basic' &&
    !/no-store/i.test(response.headers.get('cache-control') ?? '')
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      if (!BUILD_OK) throw new Error(`sw.js was registered without a build number (build=${JSON.stringify(BUILD)})`);
      if (decodeURIComponent(new URL(SCOPE).pathname) !== `/${APP_ID}/`) {
        throw new Error(`sw.js refuses scope ${SCOPE}: it serves /${APP_ID}/ only`);
      }
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL.map((path) => new Request(new URL(path, SCOPE).href, { cache: 'no-cache' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(CACHE_PREFIX) && name !== CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  // Not ours: no respondWith, so the browser handles it exactly as with no worker.
  if (!ownsRequest(event.request)) return;
  event.respondWith(networkFirst(event));
});

async function networkFirst(event) {
  const request = event.request;
  let response;
  try {
    response = await fetch(request);
  } catch (offline) {
    // The ONLY path that reads the cache: the network did not answer at all.
    const cache = await caches.open(CACHE);
    const cached =
      (await cache.match(request)) ?? (request.mode === 'navigate' ? await cache.match(SCOPE) : undefined);
    if (cached) return cached;
    throw offline;
  }
  if (storable(response)) {
    const copy = response.clone();
    event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
  }
  return response;
}

// The page (web/sw-register.js) lists what it loaded before this worker took
// control — main.dart.js, CanvasKit, the fonts — so ONE online visit leaves a
// shell that starts offline. Each is fetched from the network like any other
// request; one already held for this build is not fetched again.
self.addEventListener('message', (event) => {
  // Only this origin's own pages may ask; and every URL is re-checked by ownsRequest below.
  if (event.origin && event.origin !== self.location.origin) return;
  const data = event.data;
  if (!data || data.type !== 'nikatru-shell-warm' || !Array.isArray(data.urls)) return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      let held = 0;
      for (const href of data.urls.slice(0, 500)) {
        let request;
        try {
          request = new Request(new URL(String(href), SCOPE).href);
        } catch {
          continue;
        }
        if (!ownsRequest(request)) continue;
        if (await cache.match(request)) {
          held++;
          continue;
        }
        try {
          const response = await fetch(request);
          if (storable(response)) {
            await cache.put(request, response);
            held++;
          }
        } catch {
          // The network went away mid-warm: what is held is held.
        }
      }
      event.ports?.[0]?.postMessage({ type: 'nikatru-shell-warmed', cache: CACHE, held });
    })(),
  );
});
