// The CSP fixture for tooling/ci/test/smoke-web-artifact.test.mjs. NOT a Flutter build.
//
// At boot it does the two things a Flutter web engine does that the app's policy has a
// clause for, then announces its first frame the way the engine does:
//   · it compiles WebAssembly (CanvasKit/skwasm), which needs 'wasm-unsafe-eval' in script-src;
//   · it starts a worker from a blob: URL, which needs blob: in worker-src.
// A refusal is SWALLOWED here on purpose. The ready signal fires either way, so a smoke that
// fails on a refusal is failing from its violation listener, not from a timeout.
(async function () {
  try {
    await WebAssembly.compile(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
  } catch (e) {
    // refused: see above
  }
  try {
    const url = URL.createObjectURL(new Blob(['postMessage(1);'], { type: 'text/javascript' }));
    await new Promise(function (done) {
      const w = new Worker(url);
      w.onmessage = function () { w.terminate(); done(); };
      w.onerror = function () { done(); };
      setTimeout(done, 3000);
    });
  } catch (e) {
    // refused: see above
  }
  window.dispatchEvent(new Event('flutter-first-frame'));
  // The installed-version read, the way package_info_plus makes it on web (it fetches
  // version.json) and the app publishes it (core publishVersionRead): the version string,
  // or null when the read fails. Published AFTER the first frame, as the app's is.
  let version = null;
  try {
    const r = await fetch('version.json', { cache: 'no-store' });
    const body = await r.json();
    version = typeof body.version === 'string' ? body.version : null;
  } catch (e) {
    // a failed read publishes null
  }
  window.__nikatruPackageVersion = version;
})();
