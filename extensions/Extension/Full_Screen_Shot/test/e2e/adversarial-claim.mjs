#!/usr/bin/env node
/* ============================================================================
   FullShot — the redaction claim over the COMBINED shapes of `fixtures-adv/`.

   REWRITTEN 2026-09-19 against the CURRENT REDACTION-CLAIM-SPEC.md
   (O-FULLSHOT-CLAIM-SUITES-STALE). The file that stood here graded the
   eight-state ladder that §2.2 deletes, plus an ESCAPE category keyed on
   `pixels: "baked"`, a field that no longer exists; it was quarantined at
   exit 1, 106 pass / 61 fail / 3 open, and its U9 graded an absolute §3.3
   deliberately retired. Its full text is in git history (the last commit
   before this one). Its fixtures — shapes built by COMBINING features rather
   than exercising them one at a time — are what it left behind.

   WHICH SHAPES. reduction-corpus.mjs (wired) grades details-closed,
   object-door, split-token, wrapped-token and mixed-owntext. The seven below
   were registered by this file alone and so were graded by nothing once it
   went red: canvas-combo, cv-tabs, honest-article, honest-pii, late-frame,
   late-swap, shadow-closed-frame. Two of them need the child document
   frame-pii.html, and this is the first suite that ASSERTS that child's
   content (its email and card markers) rather than merely loading it.

   TWO FIXTURES WERE REPAIRED FIRST, the same day, because a grading row over a
   fixture defect encodes the defect:
     cv-tabs    its tab-button labels were the browser default black, inside
                the block colour's tolerance, and left 10 rows of "block colour"
                in a plain browser with NO extension. Now #2a2a2a; the plain-
                browser control below measures it on every run (X1), beside
                details-closed as the control's own control.
     late-swap  (and late-frame, which shares the harness) fired on a wall
                clock and did not reproduce. fixtures-adv/_late.js now fires on
                a DOM event that only happens after the scan; see its header.

   WHAT IS GRADED (acts-lib.mjs carries each check and its section): U the
   record, P the payload, L the ledger against the picture — plus, per shape,
   what the spec says about that shape. A disagreement with the spec is a FAIL
   and a finding. Where the spec is SILENT the result is an OPEN with its
   evidence, never a red: acts-lib.mjs reportOverMask is the one such place,
   and it says why.

   Run:  cd test/e2e && node adversarial-claim.mjs
         HEADFUL=1 node adversarial-claim.mjs
         ONLY=honest-pii,late-swap node adversarial-claim.mjs
         PORT=8332 node adversarial-claim.mjs
   ========================================================================== */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { decodePng } from './png.mjs';
import { EXT_DIR, OUT_DIR, serve, prepareTestExtension, begin, check, open, note, results } from './claim-lib.mjs';
import { launch, capture, readRecord, colourRows, saveFirstSegment, gradeUniversal,
         gradePayload, gradePicture, reportOverMask, BLOCK } from './acts-lib.mjs';

/* Its own port. 8913 was shared with claim-reduction.mjs until 2026-09-19. */
const PORT = Number(process.env.PORT || 8919);
const ADV = 'http://localhost:' + PORT + '/test/e2e/fixtures-adv/';
const ONLY = (process.env.ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
fs.mkdirSync(OUT_DIR, { recursive: true });

/* marker colours, matched to fixtures-adv/_kit.css */
const C = {
  email: [255, 90, 90], phone: [90, 200, 120], card: [90, 130, 255],
  decoy: [245, 205, 45], frame: [0, 200, 200]
};

/* The late fixtures' shared precondition: the trigger fired AFTER the scan,
   and the late content is what fills the frame. */
function lateSetup(fixture, rows, names) {
  check('S1 the late trigger fired after the scan (fixture precondition, fixtures-adv/_late.js)',
    !!fixture && fixture.fired === true && fixture.trigger === 'after-scan',
    JSON.stringify(fixture && { trigger: fixture.trigger, fired: fixture.fired, firedAt: fixture.firedAt,
      firedScrollY: fixture.firedScrollY, slotTop: fixture.slotTop }));
  check('S2 the late content reached the delivered image (fixture precondition)',
    names.every(n => rows[n] >= 6), names.map(n => n + '=' + rows[n]).join(' '));
}

const SHAPES = [
  /* THE POSITIVE CONTROL of this corpus, and the shape the feature exists
     for: contact details marked up as leaves. §3.4's honest common case. */
  { name: 'honest-pii', file: 'honest-pii.html', spec: '§3.4 honest common case',
    gone: { email: C.email, phone: C.phone, card: C.card },
    kept: { decoy: C.decoy }, keptWhy: 'a Luhn-invalid number is not a card (§1, the five shapes)',
    allTokens: true,
    fn({ a, kinds }) {
      check('G1 matched 3, painted 3, read back opaque 3 (§3.4)',
        !!a && a.matched === 3 && a.painted === 3 && a.verifiedOpaque === 3,
        a && [a.matched, a.painted, a.verifiedOpaque].join('/'));
      check('G2 kinds counts one email, one phone, one card (§2.1)',
        !!kinds && kinds.email === 1 && kinds.phone === 1 && kinds.card === 1, JSON.stringify(kinds));
    } },

  /* The other honest case: real prose in ORDINARY markup, no PII at all.
     §3.4's second variant, and nothing may be painted on it. */
  { name: 'honest-article', file: 'honest-article.html', spec: '§3.4 variant "matched === 0"',
    fn({ a, rows, marks }) {
      check('A1 matched 0, painted 0, read back opaque 0 (§3.4)',
        !!a && a.matched === 0 && a.painted === 0 && a.verifiedOpaque === 0,
        a && [a.matched, a.painted, a.verifiedOpaque].join('/'));
      check('A2 nothing is painted into an image with nothing matched: no block colour, no mark (§2.1 painted)',
        (rows.block || 0) === 0 && marks.length === 0, 'block rows ' + rows.block + ', marks ' + marks.length);
    } },

  /* §1, standing limit: "Text drawn as pixels — canvas … — is never read."
     The chrome and an sr-only paragraph supply plenty of text; the only PII is
     painted on a canvas in marker colours. */
  { name: 'canvas-combo', file: 'canvas-combo.html', spec: '§1 text drawn as pixels',
    kept: { email: C.email, card: C.card }, keptWhy: 'drawn on a canvas, never read (§1)',
    allTokens: true,
    fn({ a, kinds }) {
      check('K1 nothing on the canvas is counted: no email, no card in kinds, nothing covered (§1, §2.1)',
        !!a && a.verifiedOpaque === 0 && !(kinds && (kinds.email || kinds.card)),
        a && 'acts ' + [a.matched, a.painted, a.verifiedOpaque].join('/') + ' kinds ' + JSON.stringify(kinds));
    } },

  /* §1: "content-visibility … subtrees". An inactive tab panel with
     `content-visibility: hidden` sits under the active one; its email is laid
     out and never painted. */
  { name: 'cv-tabs', file: 'cv-tabs.html', spec: '§1 content-visibility',
    colours: { hiddenEmail: C.email, visibleLine: C.phone },
    fn({ a, rows, marks }) {
      check('T1 the hidden panel\'s email is not in the picture (fixture precondition)',
        rows.hiddenEmail === 0, 'email marker rows ' + rows.hiddenEmail);
      check('T2 the ledger is complete on a page this small (§2.1.1)',
        !!a && a.matchedComplete === true && a.walkComplete === true, a && JSON.stringify(
          { matchedComplete: a.matchedComplete, walkComplete: a.walkComplete }));
      note('the visible panel\'s own (non-PII) line: ' + rows.visibleLine + ' marker rows');
      reportOverMask(rows, marks, a, 'content-visibility:hidden tab panel');
    } },

  /* §9: "`matched` counts what the detector was handed." Content that arrives
     after the scan is never handed to it — and here it is a whole same-origin
     frame, mounted after the walk, carrying frame-pii.html's email and card. */
  { name: 'late-frame', file: 'late-frame.html', spec: '§9 matched counts what the detector was handed',
    kept: { email: C.email, frameCard: C.frame }, keptWhy: 'arrived after the scan, never handed to the detector (§9)',
    allTokens: true,
    fn({ a, rows, fixture }) {
      lateSetup(fixture, rows, ['email', 'frameCard']);
      check('F1 nothing that arrived after the scan is counted or claimed covered (§9, §2.1)',
        !!a && a.matched === 0 && a.painted === 0 && a.verifiedOpaque === 0,
        a && [a.matched, a.painted, a.verifiedOpaque].join('/'));
    } },

  /* The same, one element instead of a frame: an email and a card swapped into
     a slot after the scan. */
  { name: 'late-swap', file: 'late-swap.html', spec: '§9 matched counts what the detector was handed',
    kept: { email: C.email, card: C.card }, keptWhy: 'arrived after the scan, never handed to the detector (§9)',
    allTokens: true,
    fn({ a, rows, fixture }) {
      lateSetup(fixture, rows, ['email', 'card']);
      check('W1 nothing that arrived after the scan is counted or claimed covered (§9, §2.1)',
        !!a && a.matched === 0 && a.painted === 0 && a.verifiedOpaque === 0,
        a && [a.matched, a.painted, a.verifiedOpaque].join('/'));
    } },

  /* §1: "closed shadow roots" and "same-origin iframes the walk never
     enters", stacked: a closed root wrapping a same-origin frame that holds
     frame-pii.html's email and card. */
  { name: 'shadow-closed-frame', file: 'shadow-closed-frame.html', spec: '§1 closed shadow roots + same-origin iframes',
    kept: { email: C.email, frameCard: C.frame }, keptWhy: 'behind a closed shadow root, never walked (§1)',
    allTokens: true,
    fn({ a, kinds }) {
      check('D1 nothing behind the closed root is counted or claimed covered (§1, §2.1)',
        !!a && a.verifiedOpaque === 0 && !(kinds && (kinds.email || kinds.card)),
        a && 'acts ' + [a.matched, a.painted, a.verifiedOpaque].join('/') + ' kinds ' + JSON.stringify(kinds));
    } }
];

/* X — THE PLAIN-BROWSER CONTROL for the cv-tabs repair. No extension, a
   default headless browser, 1280x800, and the rows of block colour counted by
   the same predicate the old suite recorded (tolerance 20, x += 4, a row
   counts once). details-closed is the control's control: it must read 0 too,
   or the tolerance and not the fixture is what is being measured. */
async function plainBrowserControl() {
  begin('plain-browser control', 'test/e2e/README.md colour-tolerance rule');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const out = {};
    for (const name of ['cv-tabs', 'details-closed']) {
      await page.goto(ADV + name + '.html', { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      const img = decodePng(await page.screenshot());
      let n = 0;
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x += 4) {
          const o = (y * img.width + x) * 4, d = img.data;
          if (Math.abs(d[o] - 17) <= 20 && Math.abs(d[o + 1] - 17) <= 20 && Math.abs(d[o + 2] - 17) <= 20) { n++; break; }
        }
      }
      out[name] = n;
    }
    check('X1 cv-tabs carries no text within tolerance of the block colour, measured with no extension',
      out['cv-tabs'] === 0, 'cv-tabs ' + out['cv-tabs'] + ' rows');
    check('X2 ...and neither does details-closed, the control (so the predicate is not what is measured)',
      out['details-closed'] === 0, 'details-closed ' + out['details-closed'] + ' rows');
  } finally {
    await browser.close();
  }
}

async function runShape(ctx, sw, S) {
  begin(S.name, S.spec);
  let cap;
  try { cap = await capture(ctx, sw, ADV + S.file); }
  catch (e) { check('capture completed', false, String((e && e.message) || e)); return; }
  const { page, result, fixture } = cap;
  try {
    const rec = await readRecord(result);
    note('record ' + JSON.stringify(rec.redaction).slice(0, 400));
    const { a, marks } = await gradeUniversal(result, rec);
    await gradePayload(result, a);
    const colours = Object.assign({ block: BLOCK }, S.colours || {}, S.gone || {}, S.kept || {});
    const rows = await colourRows(result, colours);
    note('image ' + rec.w + 'x' + rec.h + ' · colour rows ' + JSON.stringify(rows));
    gradePicture(S, rows, a);
    S.fn({ a, rows, marks, kinds: rec.redaction && rec.redaction.kinds, rec, fixture });
    await saveFirstSegment(result, 'adv-' + S.name + '.png');
  } catch (e) {
    check('assertions ran to completion', false, String((e && e.stack) || e));
  } finally {
    await result.close().catch(() => {});
    await page.close().catch(() => {});
  }
}

(async () => {
  const srv = await serve(EXT_DIR, PORT);
  const TEST_EXT = prepareTestExtension();
  let ctx;
  try {
    if (!ONLY.length || ONLY.includes('cv-tabs')) await plainBrowserControl();
    begin('setup', '');
    const l = await launch(TEST_EXT, 'adv');
    ctx = l.ctx;
    check('extension service worker started with redaction on', !!l.sw, l.sw && l.sw.url());
    const run = SHAPES.filter(S => !ONLY.length || ONLY.includes(S.name));
    check('the run grades at least one shape', run.length > 0, run.map(S => S.name).join(','));
    for (const S of run) await runShape(ctx, l.sw, S);
  } catch (e) {
    check('run completed', false, String((e && e.stack) || e));
  } finally {
    if (ctx) await ctx.close().catch(() => {});
    srv.close();
  }
  if (results.opens.length) {
    console.log('\n=== OPEN — the spec is silent; recorded, never graded ===');
    for (const o of results.opens) console.log('  ' + o);
  }
  if (results.fails.length) {
    console.log('\n=== FAILURES ===');
    for (const f of results.fails) console.log('  ' + f);
  }
  console.log('\n' + results.pass + ' pass, ' + results.fail + ' fail, ' + results.open + ' open');
  process.exit(results.fail ? 1 : 0);
})();
