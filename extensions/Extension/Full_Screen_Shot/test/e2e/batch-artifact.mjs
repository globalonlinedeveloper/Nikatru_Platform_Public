#!/usr/bin/env node
/* FullShot — A BATCH JOB THAT SAYS "DONE" HAS PRODUCED A SCREENSHOT.
   Real Chromium, the shipped extension, the real queue.

   WHY THIS FILE EXISTS AND WHY NO NODE TIER CAN REPLACE IT.
   V2-FEATURE-COMPLETE-PLAN.md §9.1 R-12 / P-5: the batch arm reported a job
   done from FS_DONE — frames captured — while the only thing in the product
   that turns frames into a `shots` row is pages/result.js, which the batch arm
   never opened. Fifty urls produced fifty green ticks, fifty dead "open" links
   and an empty History. The fix opens the result page HIDDEN (active:false) and
   waits for the row.

   P-5 attaches a MANDATORY CAVEAT to exactly that: "active:false result tabs
   are throttled by Chrome and the stitcher does canvas work across awaits. The
   on-device check in Appendix B item 3 is mandatory, not optional." A fake DOM
   cannot answer that question — test/background-sim.node.js models the result
   page as three database operations, which is the right model for grading the
   WORKER and says nothing at all about whether a real background tab gets round
   to running them. This file is where that is answered, in the only place it
   can be: a browser, with the tab genuinely in the background.

   Run:  cd test/e2e && node batch-artifact.mjs
         HEADFUL=1 node batch-artifact.mjs      (watch the queue work)
*/
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EXT_DIR, serve, prepareTestExtension, setSettings,
         begin, check, note, results } from './claim-lib.mjs';

/* Its own port: run.mjs is on 8907, redaction-claim on 8911, claim-reduction
   and adversarial-claim on 8913. Two suites sharing one fail with EADDRINUSE
   rather than with a finding. */
const PORT = 8921;
const FIX = 'http://localhost:' + PORT + '/test/e2e/fixtures/';
/* Two ordinary multi-frame pages. Nothing exotic: the question here is whether
   the ordinary case produces an artifact, and an exotic fixture would only add
   a second reason for a red. */
const URLS = [FIX + 'control-clean.html', FIX + 'before-content.html'];

/* The queue's own hard caps, plus room for two page loads. Past this the queue
   is not slow, it is stuck. */
const QUEUE_TIMEOUT = 300000;

const store = (sw) => sw.evaluate(async () => ({
  shots: await FSDB.keys('shots'),
  frames: await FSDB.keys('frames'),
  captures: await FSDB.keys('captures')
}));

(async () => {
  const TEST_EXT = prepareTestExtension();
  const srv = await serve(EXT_DIR, PORT);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullshot-batch-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: !process.env.HEADFUL,
    viewport: { width: 1280, height: 800 },
    args: ['--disable-extensions-except=' + TEST_EXT, '--load-extension=' + TEST_EXT]
  });
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
    /* Redaction ON, because that is the slower stitch and the one whose result
       page does the most work before it writes the row — if anything is going to
       lose a race with a throttled background tab, it is this. */
    await setSettings(sw, { redactPII: true });

    begin('batch produces artifacts', 'V2 §9.1 R-12 / P-5');

    const before = await store(sw);
    check('the database starts with no screenshots in it',
      before.shots.length === 0, JSON.stringify(before));

    /* Not awaited inside the page context: runBatch resolves only when the whole
       queue has drained, and the point of the poll below is to watch it drain. */
    const t0 = Date.now();
    await sw.evaluate((urls) => { runBatch(urls); }, URLS);

    let state = null;
    while (Date.now() - t0 < QUEUE_TIMEOUT) {
      state = await sw.evaluate(() => ({
        running: batchRunning,
        jobs: currentBatch ? currentBatch.jobs.map(j => ({
          url: j.url, status: j.status, error: j.error, shotId: j.shotId })) : null
      }));
      if (state.jobs && !state.running && state.jobs.every(j => j.status === 'done' || j.status === 'error')) break;
      await new Promise(r => setTimeout(r, 500));
    }
    const took = Date.now() - t0;
    note('queue of ' + URLS.length + ' drained in ' + took + ' ms');

    const jobs = (state && state.jobs) || [];
    check('the queue settled every job rather than stalling',
      jobs.length === URLS.length && state && state.running === false,
      JSON.stringify(jobs.map(j => j.status)));

    /* THE HEADLINE. Under the old code this was `done` for every job with an
       empty `shots` store behind it. */
    check('every job reports done',
      jobs.length === URLS.length && jobs.every(j => j.status === 'done' && !j.error),
      JSON.stringify(jobs.map(j => j.status + (j.error ? ':' + j.error : ''))));

    const after = await store(sw);
    check('...and there is one screenshot in the database for each of them',
      after.shots.length === URLS.length && jobs.every(j => after.shots.indexOf(j.shotId) >= 0),
      JSON.stringify({ shots: after.shots, ids: jobs.map(j => j.shotId) }));
    /* THE THROTTLING QUESTION, ANSWERED. The row only exists because a tab that
       was never in front of anybody ran the stitcher to completion. */
    check('...which means the hidden result tab really did stitch',
      after.shots.length === URLS.length, after.shots.length + ' rows');
    check('...and it consumed the frames and the capture rows on its way out',
      after.frames.length === 0 && after.captures.length === 0,
      after.frames.length + ' frames / ' + after.captures.length + ' capture rows');

    check('the queue left no tab of its own open',
      ctx.pages().every(p => !p.url().includes('pages/result.html')),
      ctx.pages().map(p => p.url()).join(' | ') || 'no pages');

    /* The record is a screenshot, not an empty row with the right key. */
    const recs = [];
    for (const j of jobs) {
      recs.push(await sw.evaluate(async (id) => {
        const s = await FSDB.get('shots', id);
        if (!s) return { id, missing: true };
        return {
          id, segs: (s.segments || []).length, w: s.w, h: s.h,
          bytes: (s.segments || []).reduce((a, g) => a + ((g && g.blob && g.blob.size) || 0), 0),
          url: s.url || ''
        };
      }, j.shotId));
    }
    check('each record holds real pixels, not an empty row with the right key',
      recs.length === URLS.length &&
      recs.every(r => !r.missing && r.segs >= 1 && r.w > 0 && r.h > 0 && r.bytes > 2000),
      JSON.stringify(recs));
    check('...and each one names the page it was taken from',
      recs.every((r, i) => r.url === URLS[i]), JSON.stringify(recs.map(r => r.url)));

    /* THE LINK THE BATCH PAGE ACTUALLY RENDERS. pages/batch.js builds
       result.html?shot=<id>, which resolves against `shots` and nothing else —
       so this is the exact click that used to land on "This screenshot no longer
       exists." Driven rather than reasoned about. */
    /* Built by cutting the worker's own url, not with `new URL(...).origin` —
       chrome-extension: is not a special scheme, so URL reports its origin as
       the string "null" and the navigation fails with something that reads like
       a browser fault rather than like a test that built a bad address. */
    const extRoot = sw.url().replace(/^(chrome-extension:\/\/[^/]+\/).*$/, '$1');
    const p = await ctx.newPage();
    await p.goto(extRoot + 'pages/result.html?shot=' + encodeURIComponent(jobs[0].shotId));
    let opened = false;
    try {
      await p.waitForSelector('#view:not([hidden])', { timeout: 30000 });
      opened = true;
    } catch (_) { /* graded below */ }
    const shown = await p.evaluate(() => ({
      view: !document.getElementById('view').hidden,
      empty: !document.getElementById('empty').hidden,
      emptyText: (document.getElementById('empty').innerText || '').replace(/\s+/g, ' ').trim()
    }));
    check('the "open" link the batch page renders shows the screenshot',
      opened && shown.view === true && shown.empty === false, JSON.stringify(shown));
    await p.close();

    /* CONTROL: the queue is not simply refusing to finish. A pessimistic fix —
       one that never ticks anything — would satisfy "no false done" and be
       useless, so the greens above are only worth anything next to this. */
    check('CONTROL: not one job was failed on the way to that',
      jobs.every(j => j.status === 'done'), JSON.stringify(jobs.map(j => j.error)));
  } finally {
    await ctx.close();
    srv.close();
  }

  if (results.fails.length) {
    console.log('\n=== FAILURES ===');
    for (const f of results.fails) console.log('  ' + f);
  }
  console.log('\n' + results.pass + ' pass, ' + results.fail + ' fail');
  process.exit(results.fail ? 1 : 0);
})();
