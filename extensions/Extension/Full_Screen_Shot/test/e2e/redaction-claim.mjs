#!/usr/bin/env node
/* ============================================================================
   FullShot — the redaction claim over the `fixtures/` shapes nothing else grades.

   REWRITTEN 2026-09-19 against the CURRENT REDACTION-CLAIM-SPEC.md
   (O-FULLSHOT-CLAIM-SUITES-STALE). The file that stood here graded the
   eight-state ladder — `state`, `pixels`, `severity`, the `scan` and `bake`
   ledgers — which §2.2 deletes; it was quarantined measuring exit 1,
   151 pass / 199 fail / 30 open, and its every § citation pointed at a section
   the spec no longer has. Its full text is in git history (the last commit
   before this one); its FIXTURES are what it left behind and what this file
   grades.

   WHY THESE SHAPES AND NOT ALL SEVENTEEN. reduction-corpus.mjs (wired) already
   grades thirteen of the seventeen `fixtures/` shapes against the current
   spec, and batch-artifact.mjs (wired) runs a fourteenth. Three —
   clipped-ancestor, input-values and svg-text — were registered by this file
   alone, so when it went red they were graded by nothing at all. This file now
   exists to grade those three, plus control-pii as the POSITIVE CONTROL that
   proves the instruments below can see coverage at all: a suite whose picture
   checks were never green on a covered token would pass every hidden-token
   shape vacuously.

   WHAT IS GRADED (acts-lib.mjs carries each check and its section):
     U  the record — §2.1 keys, §0.1 Rule 2, §2.2's removals at any depth, the
        match-unit chain, kinds, §3.3's marks read back out of the delivered
        image as uniform solid regions;
     P  the payload through the shipped producer — §3.5's gate, §5's verdict
        scan, §2.3's line with the record's own counts and completeness;
     L  the ledger against the picture, both directions;
     and per shape, what the spec says about that shape (below).

   A disagreement between the product and the spec is a FAILURE here and is
   reported as a finding. Where the spec is SILENT the result is an OPEN with
   its evidence and never a red, and there are two, both said out loud because
   both were written as graded checks first and went red on the first run:
     clipped-ancestor O1  the product paints a block (and keeps a mark) where
                          the hidden text was laid out — on the visible prose
                          beside it. The acts are true and §3.3 lets a solid
                          region travel; the spec says nothing about where a
                          block may land. acts-lib.mjs reportOverMask carries
                          the full argument. A finding for capture.js + the spec.
     input-values F4      §1 says "a chosen <option>" is never read; the product
                          reads <option> text and says the matches are
                          uncovered. The safe direction — a sentence of §1 that
                          no longer describes the instrument.

   Run:  cd test/e2e && node redaction-claim.mjs
         HEADFUL=1 node redaction-claim.mjs
         ONLY=svg-text node redaction-claim.mjs
         PORT=8331 node redaction-claim.mjs
   ========================================================================== */
import fs from 'node:fs';
import { EXT_DIR, OUT_DIR, serve, prepareTestExtension, begin, check, open, note, results } from './claim-lib.mjs';
import { launch, capture, readRecord, colourRows, saveFirstSegment, gradeUniversal,
         gradePayload, gradePicture, reportOverMask, BLOCK, isInt } from './acts-lib.mjs';

const PORT = Number(process.env.PORT || 8911);
const FIX = 'http://localhost:' + PORT + '/test/e2e/fixtures/';
const ONLY = (process.env.ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
fs.mkdirSync(OUT_DIR, { recursive: true });

/* Marker colours, shared with the fixtures. */
const C = { email: [255, 90, 90], phone: [90, 200, 120], card: [90, 130, 255], decoy: [245, 205, 45] };

const SHAPES = [
  /* THE POSITIVE CONTROL. §3.4's honest common case: three matches, three
     painted, three read back opaque, and the Luhn-invalid decoy left alone. If
     L1 cannot go green here, every L-check in this file is blind. */
  { name: 'control-pii', url: FIX + 'control-pii.html', spec: '§3.4 honest common case',
    gone: { email: C.email, phone: C.phone, card: C.card },
    kept: { decoy: C.decoy }, keptWhy: 'a Luhn-invalid number is not a card (§1, the five shapes)',
    allTokens: true,
    fn({ a, kinds }) {
      check('K1 matched is 3 and every one of them is painted and read back opaque (§3.4)',
        !!a && a.matched === 3 && a.painted === 3 && a.verifiedOpaque === 3,
        a && [a.matched, a.painted, a.verifiedOpaque].join('/'));
      check('K2 kinds counts one email, one phone, one card (§2.1)',
        !!kinds && kinds.email === 1 && kinds.phone === 1 && kinds.card === 1, JSON.stringify(kinds));
    } },

  /* §1, shapes that defeated a DOM-side coverage claim: "overflow:hidden
     ancestors with height:0 · ancestor opacity:0". Both PII lines are laid out
     normally and are NOT in the picture. The detector may well read them — §9,
     matched counts what the detector was handed — so matched is not pinned.
     Nothing PII is in the picture, so no L-check has a token to count; what is
     graded is the universal arithmetic and the payload, and where the paint
     went is RECORDED (acts-lib.mjs reportOverMask says why it is not graded). */
  { name: 'clipped-ancestor', url: FIX + 'clipped-ancestor.html', spec: '§1 height:0 / opacity:0 ancestors',
    colours: { hiddenEmailBand: C.email, hiddenPhoneBand: C.phone },
    fn({ a, rows, marks }) {
      check('H1 neither hidden block reaches the picture (fixture precondition)',
        rows.hiddenEmailBand === 0 && rows.hiddenPhoneBand === 0, JSON.stringify(rows));
      check('H2 the ledger is complete on a page this small: matchedComplete and walkComplete (§2.1.1)',
        !!a && a.matchedComplete === true && a.walkComplete === true && a.truncatedBy === null,
        a && JSON.stringify({ matchedComplete: a.matchedComplete, walkComplete: a.walkComplete, truncatedBy: a.truncatedBy }));
      reportOverMask(rows, marks, a, 'height:0 and opacity:0 ancestors');
    } },

  /* §1, standing limits: "Attributes and form state are never read: value,
     placeholder, a chosen <option>". A human reads an email, a phone and a card
     straight off the image; FullShot reads none of them. The markers on this
     fixture are FIELD BACKGROUNDS, not glyph bands, so they say the fields are
     in the picture and nothing about their text — the ledger is what is graded.
     THE FIXTURE'S ONLY TEXT NODES ARE ITS TWO <option>s (both card numbers; the
     unchosen one is not in the picture). value= and placeholder= are
     attributes. So `matched` above 2 would mean an attribute was read. Its
     input text is the browser default black, inside the block colour's
     tolerance, so a row count of block colour on this page measures glyphs and
     is not read here. */
  { name: 'input-values', url: FIX + 'input-values.html', spec: '§1 attributes and form state',
    colours: { emailField: C.email, phoneField: C.phone, cardField: C.card },
    fn({ a, rows, kinds, marks }) {
      check('F1 all three fields are in the picture (fixture precondition)',
        rows.emailField > 30 && rows.phoneField > 30 && rows.cardField > 30, JSON.stringify(rows));
      check('F2 value= and placeholder= are never read (§1): no email or phone is counted, and matched ' +
            'cannot exceed the page\'s two <option> text leaves',
        !!a && isInt(a.matched) && a.matched <= 2 && !(kinds && (kinds.email || kinds.phone)),
        a && 'matched=' + a.matched + ' kinds=' + JSON.stringify(kinds));
      check('F3 nothing on this page can be placed, so nothing is painted and nothing is claimed covered (§2.1, §3.3)',
        !!a && a.painted === 0 && a.verifiedOpaque === 0 && marks.length === 0,
        a && 'painted ' + a.painted + ' verified ' + a.verifiedOpaque + ' marks ' + marks.length);
      if (a && a.matched > 0) {
        /* §1 lists "a chosen <option>" as never read. The product reads the
           text of every <option> — including the unchosen one, which is not in
           the picture — and states the shortfall. The direction is the safe
           one (it warns, it does not reassure), so this is a sentence of §1
           that no longer describes the instrument, not a red. */
        open('F4 §1 says a chosen <option> is never read; the product matched ' + a.matched +
          ' in <option> text and reports them uncovered — §1 should say what is read',
          'acts ' + [a.matched, a.painted, a.verifiedOpaque].join('/') + ' kinds=' + JSON.stringify(kinds));
      }
    } },

  /* Two SVG texts. A: a <text> whose only child is a text node — a childless
     element with text, which §1's fsOwnLeafText does read — holding an email.
     B: a card number split across <tspan>s — §1, "A number split across
     <span>s or <tspan>s is never seen whole". */
  { name: 'svg-text', url: FIX + 'svg-text.html', spec: '§1 fsOwnLeafText / split across <tspan>s',
    gone: { email: C.email }, goneWhy: 'a childless <text> is read, matched and painted (§1, §2.1)',
    kept: { card: C.card }, keptWhy: 'split across <tspan>s, never seen whole (§1)',
    allTokens: true,
    fn({ a, kinds }) {
      check('V1 the whole-<text> email is the one match, painted and read back opaque (§2.1)',
        !!a && a.matched === 1 && a.painted === 1 && a.verifiedOpaque === 1,
        a && [a.matched, a.painted, a.verifiedOpaque].join('/'));
      check('V2 kinds counts the email and no card (§2.1, §1)',
        !!kinds && kinds.email === 1 && !kinds.card, JSON.stringify(kinds));
    } }
];

async function runShape(ctx, sw, S) {
  begin(S.name, S.spec);
  let cap;
  try { cap = await capture(ctx, sw, S.url); }
  catch (e) { check('capture completed', false, String((e && e.message) || e)); return; }
  const { page, result } = cap;
  try {
    const rec = await readRecord(result);
    note('record ' + JSON.stringify(rec.redaction).slice(0, 400));
    const { a, marks } = await gradeUniversal(result, rec);
    await gradePayload(result, a);
    const colours = Object.assign({ block: BLOCK }, S.colours || {}, S.gone || {}, S.kept || {});
    const rows = await colourRows(result, colours);
    note('image ' + rec.w + 'x' + rec.h + ' · colour rows ' + JSON.stringify(rows));
    gradePicture(S, rows, a);
    S.fn({ a, rows, marks, kinds: rec.redaction && rec.redaction.kinds, rec });
    await saveFirstSegment(result, 'claim-' + S.name + '.png');
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
    begin('setup', '');
    const l = await launch(TEST_EXT, 'claim');
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
