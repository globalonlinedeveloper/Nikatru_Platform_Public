// ─────────────────────────────────────────────────────────────────────────────
// sw-register.js — registers THE OFFLINE SHELL (web/sw.js), [ADR 023] as amended
// 2026-09-30. Loaded by index.html, ABOVE the flutter_bootstrap.js tag and
// without `async`, so its first-frame listener exists before the engine can fire
// the event. It lives in its own file, not in flutter_bootstrap.js: that file is
// Flutter's template (CodeQL cannot parse it and its stamped bytes are pinned by
// sha256), and this one is ordinary JavaScript that CodeQL scans.
//
//  · UNDER THE APP SCOPE ONLY. The scope is the directory <base href> names
//    (/<id>/ in production). A page served at the origin root — the debug
//    `flutter drive -d web-server` leg — registers nothing.
//  · ONE CACHE PER BUILD. The build number is read from the deployed
//    version.json, uncached, and becomes the worker's script URL
//    (`sw.js?build=<n>`): a new deploy is a new script, so the browser installs
//    a new worker and that worker a new cache. `updateViaCache: 'none'` keeps the
//    HTTP cache out of the update check.
//  · NEVER FLUTTER'S WORKER. The build keeps `--pwa-strategy=none` and nothing
//    hands Flutter's loader a `serviceWorkerSettings`.
//  · OFFLINE, THIS DOES NOTHING. version.json cannot be fetched, so no register
//    call is made and the worker already installed keeps serving.
//
// Once the worker is active, and again after the first frame, the page lists the
// same-origin files it has loaded so far and posts the list to the worker, which
// keeps whichever of them it does not already hold. That is what lets ONE online
// visit leave a shell that starts offline: the files fetched before the worker
// took control never passed through it. The reply to the post made after the
// first frame is left on `window.__nikatruShellWarm`, which is the signal
// tooling/smoke/smoke-web-artifact.mjs waits for before it takes the network away.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  var scope = new URL('./', document.baseURI);
  if (scope.pathname === '/') return;

  var registration = null;
  var framed = false;

  function warm() {
    if (!registration || !registration.active) return;
    var afterFirstFrame = framed;
    var urls = [location.href];
    performance.getEntriesByType('resource').forEach(function (entry) {
      urls.push(entry.name);
    });
    var channel = new MessageChannel();
    channel.port1.onmessage = function (event) {
      if (afterFirstFrame) window.__nikatruShellWarm = event.data;
    };
    registration.active.postMessage({ type: 'nikatru-shell-warm', urls: urls }, [channel.port2]);
  }

  window.addEventListener('flutter-first-frame', function () {
    framed = true;
    warm();
  });

  window.addEventListener('load', function () {
    fetch(new URL('version.json', scope).href, { cache: 'no-store', credentials: 'omit' })
      .then(function (response) {
        if (!response.ok) throw new Error('version.json answered ' + response.status);
        return response.json();
      })
      .then(function (version) {
        var build = String((version && version.build_number) || '');
        if (!/^[0-9A-Za-z._-]{1,64}$/.test(build)) throw new Error('version.json carries no build_number');
        var script = new URL('sw.js', scope);
        script.searchParams.set('build', build);
        return navigator.serviceWorker.register(script.href, { scope: scope.href, updateViaCache: 'none' });
      })
      .then(function () {
        return navigator.serviceWorker.ready;
      })
      .then(function (ready) {
        registration = ready;
        warm();
      })
      .catch(function (error) {
        console.warn('offline shell not registered: ' + ((error && error.message) || error));
      });
  });
})();
