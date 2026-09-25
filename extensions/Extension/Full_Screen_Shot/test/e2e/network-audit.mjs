/* ============================================================================
   network-audit.mjs — G11 (2026-09-24): the zero-network claim, graded at
   RUNTIME on the PACKED extension in real Chromium.

   scripts/policy-check.mjs greps the packaged JavaScript for network APIs and
   the manifest CSP says connect-src 'none'. Both are statements ABOUT the
   package. This suite runs it — every extension page, and one real capture
   end to end — and records what actually left:
     · the Chrome DevTools Protocol Network domain on every extension page, so
       an <img>, a stylesheet or a fetch is seen whatever API made it;
     · packed-lib.mjs's PAGE_RECORDER on every extension page: fetch, XHR,
       sendBeacon, WebSocket, EventSource, RTCPeerConnection, SharedWorker —
       the ones a Network log never shows (a peer connection is not a request);
     · the same wrappers in the service worker, from the moment the audit
       reaches it (its boot has already run — see LIMIT below);
     · every securitypolicyviolation, because a blocked load is also a load the
       code attempted.
   Allowed: chrome-extension://<this id>/, data: and blob:. Anything else is a
   finding, and so is ANY recorded network-API call or CSP violation on an
   audited page: the product makes none.

   TWO SENTINELS, AND A MISSING ONE IS EXIT 2 (COVERAGE LOST), NEVER A PASS.
   An audit whose instrument is off prints the same zero as a clean product.
     A  the audit loads packaged icons/icon16.png?g11-sentinel from a page it
        owns; the Network log MUST show it. Delete `Network.enable` and it
        does not, and the run refuses rather than reporting a clean zero.
     B  the audit calls fetch('data:...g11-sentinel') on that page; the
        recorder MUST record the call AND the connect-src violation it causes.
   The sentinel page is the audit's own; nothing it records is a finding.

   LIMIT, stated rather than hidden: the worker's top-level code has run before
   any driver can reach it, so a request made at worker BOOT is seen by the
   static scan and test/background-sim.node.js (whose fake fetch/XHR/WebSocket
   record every call), not by this suite.

   Exit: 0 clean · 1 a finding · 2 coverage lost.
   Run:  node network-audit.mjs   (FS_E2E_CHROMIUM=<path> to use a local binary)
   ========================================================================== */
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serve, FIXTURE_DIR } from './claim-lib.mjs';
import { packedExtension, coverageLost, PAGE_RECORDER } from './packed-lib.mjs';

const PORT = Number(process.env.PORT || 8931);
const SENTINEL = 'g11-sentinel';
const AUDITED = ['popup/popup.html', 'pages/options.html', 'pages/history.html', 'pages/batch.html'];
const findings = [];
const requests = [];          // { page, url }
let passes = 0;
const pass = (label, extra) => { passes++; console.log('  PASS  ' + label + (extra ? '  — ' + extra : '')); };
const finding = (label, extra) => { findings.push(label + (extra ? '  — ' + extra : '')); console.log('  FAIL  ' + label + (extra ? '  — ' + extra : '')); };

const ext = packedExtension('chromium');
const srv = await serve(FIXTURE_DIR, PORT);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullshot-g11-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  ...(process.env.FS_E2E_CHROMIUM ? { executablePath: process.env.FS_E2E_CHROMIUM } : { channel: 'chromium' }),
  headless: !process.env.HEADFUL,
  viewport: { width: 1280, height: 800 },
  args: ['--disable-extensions-except=' + ext.dir, '--load-extension=' + ext.dir]
});
let exitCode = 0;
try {
  await ctx.addInitScript(PAGE_RECORDER);
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  const extId = new URL(sw.url()).host;
  const base = 'chrome-extension://' + extId + '/';
  const allowed = u => u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:');

  /* Every extension page gets the Network domain BEFORE it navigates, so its
     first request is inside the log. */
  async function watch(page, name) {
    const s = await ctx.newCDPSession(page);
    await s.send('Network.enable');
    s.on('Network.requestWillBeSent', e => requests.push({ page: name, url: e.request.url }));
    return s;
  }
  async function openWatched(rel) {
    const page = await ctx.newPage();
    await watch(page, rel);
    await page.goto(base + rel, { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    return page;
  }
  const recOf = page => page.evaluate(() => window.__fsRec || null);

  /* ---- the worker's own wrappers, installed as early as a driver can ---- */
  await sw.evaluate(() => {
    const rec = self.__fsRec = { net: [] };
    const note = (api, a) => rec.net.push({ api, arg: String(a == null ? '' : (a.url || a)).slice(0, 200) });
    const orig = self.fetch;
    self.fetch = function (a) { note('fetch', a); return orig.apply(this, arguments); };
    for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource']) {
      const O = self[name];
      if (typeof O !== 'function') continue;
      const W = function (a) { note(name, a); return Reflect.construct(O, arguments, new.target || O); };
      W.prototype = O.prototype;
      self[name] = W;
    }
  });

  /* ---- sentinels, on a page the audit owns ---- */
  console.log('\n=== sentinels ===');
  const sent = await openWatched('pages/options.html');
  const rec0 = await recOf(sent);
  if (!rec0) coverageLost('PAGE_RECORDER is not installed on extension pages (window.__fsRec is absent) — no API call or CSP violation below could be seen');
  await sent.evaluate(s => new Promise(res => {
    const i = new Image();
    i.onload = i.onerror = () => res();
    i.src = chrome.runtime.getURL('icons/icon16.png') + '?' + s + '=1';
  }), SENTINEL);
  await sent.evaluate(s => fetch('data:text/plain,' + s).catch(() => {}), SENTINEL);
  await sent.waitForTimeout(500);
  const seenA = requests.some(r => r.url.includes(SENTINEL));
  const rec1 = await recOf(sent);
  const seenB = rec1.net.some(n => n.api === 'fetch' && n.arg.includes(SENTINEL)) &&
    rec1.csp.some(c => /connect-src/.test(c.directive));
  console.log('SENTINEL A (Network domain): ' + (seenA ? 'seen' : 'NOT SEEN'));
  console.log('SENTINEL B (page recorder + CSP listener): ' + (seenB ? 'seen' : 'NOT SEEN'));
  if (!seenA) coverageLost('sentinel A was not in the Network log: the audit is not observing requests, so a zero would mean nothing');
  if (!seenB) coverageLost('sentinel B was not recorded: the recorder or the securitypolicyviolation listener is not live');
  await sent.close();
  requests.length = 0;

  /* ---- the pages, opened cold ---- */
  console.log('\n=== extension pages ===');
  const pages = [];
  for (const rel of AUDITED) pages.push({ rel, page: await openWatched(rel) });

  /* ---- one real capture, end to end ---- */
  console.log('\n=== one capture ===');
  const fixtureUrl = 'http://127.0.0.1:' + PORT + '/control-clean.html';
  const tab = await ctx.newPage();
  await tab.goto(fixtureUrl, { waitUntil: 'load' });
  await tab.bringToFront();
  await tab.waitForTimeout(800);
  const resultWait = ctx.waitForEvent('page', { predicate: p => p.url().includes('pages/result.html'), timeout: 300000 });
  resultWait.catch(() => {});
  await sw.evaluate(async (pageUrl) => {
    const tabs = await chrome.tabs.query({});
    const t = tabs.find(x => x.url === pageUrl);
    if (!t) throw new Error('test tab not found');
    await chrome.tabs.update(t.id, { active: true });
    const res = await startCapture(t, 'full', 0);
    if (!res || !res.ok) throw new Error('startCapture failed: ' + (res && res.error));
  }, fixtureUrl);
  const result = await resultWait;
  await result.waitForSelector('#view:not([hidden])', { timeout: 300000 });
  /* The result page opened before the audit could attach, so it is watched
     now and RELOADED: its whole load happens inside the log. */
  await watch(result, 'pages/result.html');
  await result.reload({ waitUntil: 'load' });
  await result.waitForSelector('#view:not([hidden])', { timeout: 300000 });
  await result.waitForTimeout(1000);
  pages.push({ rel: 'pages/result.html', page: result });
  const shotId = await result.evaluate(async () => {
    const list = await FSDB.getAll('shots');
    return list.length ? list[list.length - 1].id : null;
  });
  if (!shotId) coverageLost('the capture produced no shot, so the editor, beautify and scroll-clip pages cannot be audited');
  for (const rel of ['pages/editor.html', 'pages/beautify.html', 'pages/scrollclip.html']) {
    pages.push({ rel, page: await openWatched(rel + '?shot=' + encodeURIComponent(shotId) + '&seg=0') });
  }

  /* ---- grading ---- */
  console.log('\n=== what left ===');
  const offsite = requests.filter(r => !allowed(r.url));
  if (offsite.length) finding('no extension page requested anything outside the package', offsite.map(r => r.page + ' -> ' + r.url).join(' | '));
  else pass('no extension page requested anything outside the package', requests.length + ' request(s), all chrome-extension://, data: or blob:');
  for (const { rel, page } of pages) {
    const rec = await recOf(page);
    if (!rec) { finding(rel + ' carries the recorder', 'window.__fsRec is absent, so this page was not audited'); continue; }
    if (rec.net.length) finding(rel + ' made no network-API call', rec.net.map(n => n.api + '(' + n.arg + ')').join(' | '));
    else pass(rel + ' made no network-API call');
    if (rec.csp.length) finding(rel + ' raised no CSP violation', rec.csp.map(c => c.directive + ' ' + c.uri + (c.sample ? ' "' + c.sample + '"' : '')).join(' | '));
    else pass(rel + ' raised no CSP violation');
  }
  const swRec = await sw.evaluate(() => self.__fsRec);
  if (swRec.net.length) finding('the service worker made no network-API call after boot', swRec.net.map(n => n.api + '(' + n.arg + ')').join(' | '));
  else pass('the service worker made no network-API call after boot');

  exitCode = findings.length ? 1 : 0;
  console.log('\n' + passes + ' pass · ' + findings.length + ' fail');
  if (findings.length) console.log('FINDINGS:\n  ' + findings.join('\n  '));
} catch (e) {
  console.log('COVERAGE LOST — the audit did not complete: ' + (e && e.stack || e));
  exitCode = 2;
} finally {
  await ctx.close().catch(() => {});
  srv.close();
}
process.exit(exitCode);
