/* FullShot — the §4 population nobody seeds: a record whose `acts` block is v3.
   ==========================================================================

   `pages/db.js` grew `fsUpgradeActs` for exactly this population — a correct
   reading by a build that could not see five of the things v4 reports, whose
   five missing fields are UNKNOWABLE rather than zero. §4 puts the translation
   at the store boundary so that no page can read an un-normalised block even by
   accident.

   Every suite in this repository seeds the OTHER populations: v2-ledger,
   ancient `pixels: "none"`, ancient `pixels` anything, and no block at all.
   test/pixel-sim seeds a v3 acts block but hands it to result.js through its
   own fake FSDB, so it never crosses the door the translation lives in.

   This probe seeds one, through the extension's own FSDB, and then opens the
   two pages that read the store. It asserts nothing about wording: it asks
   whether the record can be opened at all.

   Usage:  node v3acts-probe.mjs        (PORT=... to move the static server)
*/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { serve, prepareTestExtension, setSettings, EXT_DIR } from './claim-lib.mjs';

const PORT = Number(process.env.PORT || 8145);
const BASE = 'http://127.0.0.1:' + PORT;
const FIX = BASE + '/test/e2e/fixtures/';

const R = { pass: 0, fail: 0, fails: [] };
function check(label, ok, extra) {
  if (ok) R.pass++; else { R.fail++; R.fails.push(label + (extra != null ? '  — ' + extra : '')); }
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label + (extra != null ? '  — ' + extra : ''));
}
const say = t => console.log('        ' + t);

(async () => {
  const TEST_EXT = prepareTestExtension();
  const srv = await serve(EXT_DIR, PORT);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullshot-v3acts-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: !process.env.HEADFUL,
    viewport: { width: 1280, height: 800 },
    args: ['--disable-extensions-except=' + TEST_EXT, '--load-extension=' + TEST_EXT]
  });
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
    await setSettings(sw, { redactPII: true });
    const extBase = sw.url().replace(/background\.js.*$/, '');

    /* A real capture first, so the seeded record has real segments behind it
       and the pages have something to render. */
    const page = await ctx.newPage();
    await page.goto(FIX + 'control-pii.html', { waitUntil: 'load' });
    await page.bringToFront();
    await page.waitForTimeout(900);
    const wait = ctx.waitForEvent('page', {
      predicate: p => p.url().includes('pages/result.html'), timeout: 300000
    });
    wait.catch(() => {});
    await sw.evaluate(async (u) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(t => t.url === u) || tabs.find(t => (t.url || '').startsWith('http'));
      await chrome.tabs.update(tab.id, { active: true });
      await new Promise(r => setTimeout(r, 200));
      const res = await startCapture(tab, 'full', 0);
      if (!res || !res.ok) throw new Error('startCapture failed: ' + (res && res.error));
    }, FIX + 'control-pii.html');
    const result = await wait;
    await result.waitForSelector('#view:not([hidden])', { timeout: 300000 });
    await result.waitForTimeout(1200);


    /* SEED AND READ BACK IN ONE PASS. One evaluate, because the pages under
       test re-render themselves and a second call can land after the context
       has gone; and not the service worker, because MV3 evicts it mid-call.
       `redaction.v` is 3 (the block shape this build writes) and `acts.v` is 3
       (what a build one release older wrote). That is the only difference from
       a live record. */
    const seeded = { ids: ['v3acts-plain', 'v3acts-derived'] };
    const liveId = await result.evaluate(() => new URLSearchParams(location.search).get('id'));
    await result.close().catch(() => {});
    await page.close().catch(() => {});
    const work = await ctx.newPage();
    await work.goto(extBase + 'pages/history.html', { waitUntil: 'load' });
    await work.waitForTimeout(1200);
    const readBack = await work.evaluate(async (id) => {
      const live = await FSDB.get('shots', id);
      const V3 = () => ({ v: 3, matched: 3, painted: 3, verifiedOpaque: 3,
                          walkComplete: true, truncatedBy: null, ledger: 'present' });
      const mk = async (newId, extra) => {
        const rec = Object.assign({}, live, { id: newId, title: 'v3-acts ' + newId }, extra || {});
        rec.redaction = { v: 3, requested: true, acts: V3(), kinds: { email: 2 }, marks: [] };
        await FSDB.put('shots', rec);
      };
      await mk('v3acts-plain');
      await mk('v3acts-derived', { derivedFrom: id });
      /* RACED AGAINST A CLOCK, because the failure mode being looked for is not
         a rejection. `FSDB.get` resolves inside the IndexedDB success handler;
         a throw in there settles nothing at all, so the promise HANGS and a
         try/catch never runs. A probe without this clock does not report the
         bug, it joins it. */
      const race = p => Promise.race([
        p.then(v => ({ ok: true, v }), e => ({ ok: false, error: String((e && e.message) || e) })),
        new Promise(r => setTimeout(() => r({ ok: false, error: 'NEVER SETTLED (5s)' }), 5000))
      ]);
      const errs = [];
      self.addEventListener('error', e => errs.push(String(e.message || e)));
      const out = {};
      for (const k of ['v3acts-plain', 'v3acts-derived']) {
        const r = await race(FSDB.get('shots', k));
        out[k] = r.ok
          ? { ok: true, acts: JSON.parse(JSON.stringify((r.v.redaction || {}).acts || null)) }
          : { ok: false, error: r.error };
      }
      const l = await race(FSDB.getShotsNewestFirst());
      out.__list = l.ok ? { ok: true, n: l.v.length } : { ok: false, error: l.error };
      out.__errors = errs.slice(0, 4);
      return out;
    }, liveId);
    await work.close().catch(() => {});
    for (const id of seeded.ids) {
      say(id + ' -> ' + JSON.stringify(readBack[id]));
      check('FSDB.get returns a normalised record for ' + id, readBack[id].ok,
        readBack[id].error);
      if (readBack[id].ok) {
        check('...normalised to v4, with the five unknowable fields null for ' + id,
          readBack[id].acts && readBack[id].acts.v === 4 &&
          readBack[id].acts.matchedComplete === null,
          JSON.stringify(readBack[id].acts));
      }
    }
    say('getShotsNewestFirst -> ' + JSON.stringify(readBack.__list));
    check('the History listing survives one such record in the store',
      readBack.__list.ok, readBack.__list.error);

    /* THE PAGES. A store boundary that throws takes every reader with it. */
    for (const id of seeded.ids) {
      const p = await ctx.newPage();
      const errs = [];
      p.on('pageerror', e => errs.push(String(e && e.message || e)));
      p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
      await p.goto(extBase + 'pages/result.html?id=' + id, { waitUntil: 'load' });
      await p.waitForTimeout(2500);
      const shown = await p.evaluate(() => ({
        view: !!document.querySelector('#view:not([hidden])'),
        body: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 180)
      }));
      say('result.html?id=' + id + ' -> view=' + shown.view + '  "' + shown.body + '"');
      check('result.html opens ' + id, shown.view, shown.body + ' | errors: ' + errs.slice(0, 2).join(' | '));
      await p.close();
    }
    {
      const p = await ctx.newPage();
      const errs = [];
      p.on('pageerror', e => errs.push(String(e && e.message || e)));
      await p.goto(extBase + 'pages/history.html', { waitUntil: 'load' });
      await p.waitForTimeout(2500);
      const n = await p.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200));
      say('history.html -> "' + n + '"');
      check('history.html lists the library with one such record in it',
        /screenshot/i.test(n) && errs.length === 0, n + ' | errors: ' + errs.slice(0, 2).join(' | '));
      await p.close();
    }
  } catch (e) {
    check('probe ran to completion', false, String((e && e.stack) || e));
  } finally {
    await ctx.close();
    srv.close();
  }
  if (R.fails.length) { console.log('\n=== FAILURES ==='); for (const f of R.fails) console.log('  ' + f); }
  console.log('\n' + R.pass + ' pass, ' + R.fail + ' fail');
  process.exit(R.fail ? 1 : 0);
})();
