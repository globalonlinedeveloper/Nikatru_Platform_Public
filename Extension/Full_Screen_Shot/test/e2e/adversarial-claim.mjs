#!/usr/bin/env node
/* ============================================================================
   SUPERSEDED — THIS SUITE GRADES A DESIGN THAT NO LONGER EXISTS.

   Every assertion below is written against the eight-state ladder
   (`state`, `pixels`, `severity`, the two "baked" entrances and the sentence
   table keyed by them). REDACTION-CLAIM-SPEC.md deleted all of it: the product
   no longer says whether the image is clean, it states three counts and shows
   the person the picture. Running this file today reddens on the absence of
   fields whose absence is the deliverable.

   MEASURED 2026-08-25 and again 2026-08-26 on the same tree, alone:
   exit 1, 102 pass / 65 fail / 3 open, 0 ESCAPES, over 11 fixtures. 44 of the
   65 are four universals repeated per fixture (U2 the closed state set, U5 and
   U6 the scan and bake ledger sums, U7 the state sentence). U9 fails because
   §3.3 now persists `redaction.marks` for verified-opaque blocks ON PURPOSE —
   it grades an absolute the spec deliberately retired.

   QUARANTINED in .github/workflows/e2e.yml, which carries the same numbers.

   ITS ASSERTIONS ARE REPLACED by reduction-corpus.mjs (wired, green), which
   grades the reduced design. ITS SHAPES ARE NOT. `fixtures-adv/` holds
   THIRTEEN shapes, eleven of them in the list below; reduction-corpus.mjs
   reaches five of the thirteen — details-closed, object-door, split-token,
   wrapped-token, mixed-owntext — and claim-reduction.mjs three of those same
   five. canvas-combo, cv-tabs, frame-pii, honest-article, honest-pii,
   late-frame, late-swap and shadow-closed-frame reach NO wired suite, and
   frame-pii is not in the list below either, so it has never had one.
   That hole closes by writing a suite from the CURRENT
   REDACTION-CLAIM-SPEC.md over `fixtures-adv/`, not by re-arming this file:
   the § numbers below (§2.6, §3.7, §5.4, §6.1, §7.1, E8, E13) are sections of
   the pre-reduction spec, rewritten in place, and none of them exists today.

   TWO FAILURES HERE ARE NOT RECORD-SHAPE and outlive the retirement, because
   they are read off the delivered PNG: on cv-tabs the VISIBLE panel's marker
   is 0 rows beside 33 rows of block colour, and on details-closed 23 rows of
   block colour beside a PII marker of 0 — an opaque block painted at
   coordinates taken from a subtree the renderer never drew, landing on
   rendered text that held no PII. Under the reduced design that is NOT a false
   coverage claim (`1 matched / 1 painted / 1 verifiedOpaque` are each true), so
   it is not what reddens this suite and must not be graded by re-arming it. It
   belongs to whoever owns content/capture.js.

   This file is kept, unrun, for one reason: the FIXTURES are the accumulated
   record of shapes that beat six fixes, and they are worth more than the
   assertions wrapped around them. Harvest from it; do not repair it.

   ─────────────────────────────────────────────────────────────────────────
   APPENDED 2026-08-26. Everything above stood when it was written and is left
   standing verbatim; this block says only what changed since, and when.

   THE NUMBERS MOVED. Re-measured twice back to back on 6ee4c73, alone, 8913
   confirmed free before each: exit 1, **106 pass / 61 fail / 3 open**, 0
   ESCAPES, 11 fixtures, identical both times. `102 / 65 / 3` above was taken
   before PR #23; four checks that failed then pass now.

   🟢 THE CAPTURE-FIDELITY LIMB IS ANSWERED — read the "TWO FAILURES HERE ARE
   NOT RECORD-SHAPE" paragraph as history, not as an open ask. Clause 3b in
   content/capture.js (5121633, merged as 6ee4c73) gave `measure()` a liveness
   test, and those two shapes now come back:

     details-closed  block rows 0 · marks [] · kinds {} (was 23 rows)
     cv-tabs         block rows 10 · marks [] · kinds {} · and the VISIBLE
                     panel's phone marker at 10 rows, not 0 (was 33 / 0)

   The residue of 10 on cv-tabs is the FIXTURE, not the product: subpixel
   antialiasing on its tab-button labels breaks the tolerance rule
   test/e2e/README.md states, and it measures 10 in a plain browser with no
   extension at all. The owner of content/capture.js was asked by that
   paragraph and has replied.

   🔬 THAT LAST CLAUSE IS THE LOAD-BEARING ONE — "10 in a plain browser with no
   extension at all" is the whole reason these rows are the fixture's fault and
   not the product's — so HOW IT WAS MEASURED is written here beside it, and
   not only what it came to. It was asserted before it was ever run, which is
   this corpus's most expensive recurring defect: a number and a claim that
   agree while only the NUMBER was ever checked. Re-run it; do not trust it.

   MEASURED 2026-08-26. Recipe, in full:
     · headless Chromium — this directory's own playwright — with NO extension
       loaded. No --load-extension, no persistent context, nothing from
       prepareTestExtension(). A default browser.
     · viewport 1280x800, matching the capture width the suite drives.
     · the fixture served from the extension root over plain HTTP at
       /test/e2e/fixtures-adv/cv-tabs.html; waitUntil networkidle, then 400ms.
     · page.screenshot() straight to a PNG buffer. Nothing in content/capture.js
       or result.js touches the pixels — that is the point of the control.
     · rows counted by the SAME predicate claim-lib.mjs countColours() uses, so
       the two numbers are commensurable rather than merely similar: block
       colour [17,17,17], per-channel tolerance 20, sampled x += 4, and a row
       counts ONCE if any sample in it hits. The inner test, verbatim:

         Math.abs(d[o]   - 17) <= 20 &&
         Math.abs(d[o+1] - 17) <= 20 &&
         Math.abs(d[o+2] - 17) <= 20

   RESULT — identical for viewport and fullPage screenshots, both 1280x800:

     cv-tabs          10 rows of block colour
     details-closed    0 rows of block colour     <- the control

   details-closed is what makes the pair mean anything. It is the other shape
   whose extension-side residue went to 0 under clause 3b, and the same recipe
   over it finds NOTHING — so 10 is a property of cv-tabs, not an artefact of
   the tolerance, the sampling stride, or the screenshot path. Had the control
   also come back non-zero, the claim above would be unsupported and the ten
   rows would still be owed to content/capture.js.

   WHAT DID NOT MOVE is the record-shape limb, and U9 is the sharpest case.
   It fails on exactly ONE fixture of the eleven — honest-pii, the only shape
   in this corpus that produces a verified-opaque block. Its ledger reads:

     acts  matched 3 · painted 3 · verifiedOpaque 3
     marks [{x:24,y:165,w:189,h:23},{x:132,y:253,w:145,h:23},
            {x:175,y:392,w:171,h:23}]

   U9 asserts `no rectangle geometry travels on the record` and matches on
   `{"x":<int>,"y":`. Spec §3.3 today REQUIRES exactly that geometry — "Only
   verified-opaque blocks are marked, and only verified-opaque blocks are
   persisted … The old absolute — *the rectangles never travel* — held because
   the stored set included both kinds." So U9 is red BECAUSE THE PRODUCT IS
   NOW CORRECT. On the other ten fixtures nothing is verified opaque, no marks
   are persisted, and U9 passes — which is the cleanest proof available that
   it grades a retired absolute and not a defect.

   ON THE § NUMBERS, line 31 names the right sections and understates the
   drift. Parsed: this file cites 24 distinct § numbers, 17 of which have no
   heading in REDACTION-CLAIM-SPEC.md today (1.1, 2.4, 2.5, 2.6, 3.7, 3.9,
   3.9.1, 3.9.2, 4.2, 5.1, 5.2, 5.4, 6.1, 6.3, 7.1, 7.4, 7.6), and E8 · E12 ·
   E13 · E16 are gone with them — the current spec carries no E-numbered list
   at all. The 7 that still resolve (2.1, 2.2, 2.3, 3, 3.2, 3.3, 3.4) are
   numbers REUSED for different content, not sections that stayed put.

   THE COVERAGE HOLE IS UNCHANGED. giveup-verify.mjs was wired on 2026-08-26,
   and it reads `fixtures-giveup/` and `fixtures/` — no `fixtures-adv/` shape —
   so the eight named at line 26 are still eight, still graded by nothing.
   ─────────────────────────────────────────────────────────────────────────
   APPENDED 2026-08-26, LATER. Everything above stood when it was written and
   is left standing verbatim, including the sentence this block corrects. Not
   one assertion in this file was touched: the counts below are the third and
   fourth measurements of the same code.

   MEASURED AGAIN, alone, `PORT=8332` (8913 confirmed free, and the override
   this file gained earlier today exercised for the first time since):
   exit 1, 106 pass / 61 fail / 3 open, 0 ESCAPES, 11 fixtures. Unmoved.

   🔴 LINE 26 AND LINE 28 ARE WRONG ABOUT frame-pii, AND SO ARE THE TWO OTHER
   PLACES THAT COPY THEM. "frame-pii is not in the list below either, so it
   has never had one" counts frame-pii.html as a PAGE SHAPE. It is not one.
   Nothing navigates to it. It is the CHILD DOCUMENT that three fixtures in
   this corpus load:

     late-frame.html:55           f.src = 'frame-pii.html';
     object-door.html:27          <object type="text/html" data="frame-pii.html">
     object-door.html:30          <embed  type="text/html" src="frame-pii.html">
     shadow-closed-frame.html:46  f.src = 'frame-pii.html';

   object-door.html is registered by TWO WIRED SUITES — reduction-corpus.mjs
   and claim-reduction.mjs — and object-door.html carries NO PII OF ITS OWN:
   read it, the host page is a nav, an <h1>, THREE <h2>s and THREE filler
   paragraphs. (An earlier draft of this block said two and two, in three
   files at once, from memory rather than from grep -c. Corrected here and in
   both of the others.) Every PII TOKEN in its capture comes out of
   frame-pii.html — the host page text is chrome and filler the detector
   matches nothing in, which is why the fixture is shaped that way. So
   frame-pii is LOADED AND CAPTURED inside runs those two wired suites grade,
   the only way it is ever used, and it is off the ungraded list for that.

   🔴 THAT IS NOT THE SAME SENTENCE AS ITS CONTENT IS GRADED, and an earlier
   draft of this block wrote the second one. NOTHING ASSERTS THE PII
   frame-pii CONTRIBUTES. The object-door row in reduction-corpus.mjs (line
   210 of that file) carries no `det`; its `gone` and `kept` maps are both
   `{}`, so the pixel grader returns before it looks at the image; and its
   `visible: 6` — a count the host page cannot supply on its own, which is
   the mechanical proof the child document is in the picture — is consumed
   ONLY by `note(...)`. The workflow that runs these suites states in its own
   words that NOTE IS NOT GRADED. So GRADED, in the guard below, means
   REACHES A GRADED SUITE and has never meant ITS CONTENT IS ASSERTED; a row
   that asserts it still has to be written by somebody who owns that file.
   THE FIGURE IS SEVEN TOP-LEVEL SHAPES, NOT EIGHT:
   canvas-combo, cv-tabs, honest-article, honest-pii, late-frame, late-swap,
   shadow-closed-frame. Nothing was retired, deleted or quarantined to get
   there — one name was mis-classified by three filename-level parses in a
   row, and fixtures/iframe-child.html was mis-classified the same way for the
   same reason.

   frame-pii.html IS DELIBERATELY NOT ADDED TO THE LIST BELOW, and the
   argument matters more than the decision. Registering it here would add
   nine or so assertions against the eight-state ladder — guaranteed red,
   manufactured on purpose, in a suite this header says to harvest and not to
   repair — and it would move the 106/61/3 that three other files quote,
   while moving the shape not one inch closer to a WIRED grader. A shape is
   covered when a graded suite runs it. This suite is not one.

   🔬 late-swap DID NOT REPRODUCE ON THIS RUN, and the suite says so itself
   rather than reporting a finding:

     late-swap :: L3 inconclusive run — not graded  — setup=false legible=true

   L1 exists precisely for this: `setupOk` demands `fixture.fired === true`
   AND `matched === 0`, and without both the run is inconclusive. So the
   trigger did not fire. THAT IS A PROPERTY OF THE FIXTURE, NOT OF THE
   RETIRED ASSERTIONS AROUND IT, and it outlives the retirement exactly the
   way the capture-fidelity limb did: whoever writes the replacement suite
   over fixtures-adv/ inherits a shape that cannot be graded by anybody until
   its swap is made deterministic. It is recorded here because a reader
   harvesting this corpus would otherwise write a row for it and get an
   intermittent green.

   THE COUNT IS NO LONGER DERIVED BY HAND. A `fixture-coverage` guard in
   .github/workflows/e2e.yml parses every registration idiom in this
   directory, subtracts the quarantine, resolves child documents through a
   quoted `src=` / `data=` value, and reddens the job when the set of shapes
   reaching no wired suite GROWS. Measured by that guard on this tree: 42
   shapes, 6 wired suites, 4 quarantined, 15 shapes reaching no wired suite —
   of which seven are this corpus. The eight-that-are-seven above went three
   derivations without anybody noticing; that is what the guard exists to
   prevent, and it grades nothing and closes nothing.

   THREE LIMITS OF THAT SENTENCE, because this file has been burned by
   sentences that promised more than they delivered.
   (a) The parent has to write the URL as a QUOTED LITERAL. One built from a
       variable is invisible, and the child is then called UNGRADED — a FALSE
       RED, not a missed cover. No fixture here builds one today; measured.
       A quoted value IS resolved against the directory of the file that
       loads it, `../` and all, so a cross-directory parent is seen.
   (b) HTML comments are stripped from the fixtures first, so a commented-out
       <iframe src="x.html"> does not mark x.html covered. An earlier draft
       stripped comments from the .mjs sources and not from the fixture HTML,
       which is the same disease one file type over. None was present either
       way.
   (c) WHEN it bites is NOT the commit that breaks it. That workflow is
       weekly / workflow_dispatch / run-e2e label and its own header says it
       never blocks a PR by default, so the red arrives on the next Monday
       run, or whenever somebody dispatches it or labels a PR. Between those,
       a newly orphaned shape is countable but uncounted.
   ─────────────────────────────────────────────────────────────────────────
   ───────────────────────────────────────────────────────────────────────── */
/* FullShot — ATTEMPT SIX at the redaction claim. Adversarial corpus.
 *
 * Premise, taken from the brief and from the bug's own history: five fixes have
 * passed their own tests and been defeated by a page shape nobody enumerated,
 * and every genuine escape was found in a REAL BROWSER and missed by the fake
 * DOM. So: real Chromium, real extension, real record, and page shapes built by
 * COMBINING features rather than exercising them one at a time — which is where
 * the fixtures/ corpus stops.
 *
 * Three verdicts and one extra category:
 *   PASS/FAIL — the spec says what must happen.
 *   OPEN      — the spec is silent; printed with evidence, never graded.
 *   ESCAPE    — evidence that the DELIVERED IMAGE contains legible sensitive
 *               text while the record claims `pixels: "baked"`. Counted
 *               separately from FAIL because a mechanism can be disclosed in
 *               §5.1 and still be the shipping bug: the project's own
 *               definition of the defect is "the product tells the user a
 *               protection happened when it did not", and disclosure in a
 *               design document is not a thing the user is shown.
 *
 * Run:  cd test/e2e && node adversarial-claim.mjs
 *       HEADFUL=1 node adversarial-claim.mjs
 *       ONLY=mixed-owntext,honest-pii node adversarial-claim.mjs
 *
 * Reuses claim-lib.mjs read-only. Touches no product file and no existing test.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  EXT_DIR, OUT_DIR, serve, prepareTestExtension, setSettings, capture,
  begin, check, open, note, results, num, totalOf, MUTATION_PROBE
} from './claim-lib.mjs';

/* run.mjs 8907, redaction-claim 8911. 8913 is SHARED with claim-reduction.mjs,
   so the two can never run at once — and until 2026-08-26 this was a bare
   literal, which made the commoner failure unescapable: a run killed mid-flight
   leaves its listener holding 8913, and the next run dies on EADDRINUSE with no
   way out but hunting the orphan process down. Overridable now, the way
   giveup-verify.mjs and v3acts-probe.mjs already were. The DEFAULT is unchanged
   and no assertion is touched — re-measured either side of this line, the suite
   is exit 1, 106 pass / 61 fail / 3 open, 0 ESCAPES, both times. */
const PORT = Number(process.env.PORT || 8913);
const BASE = 'http://localhost:' + PORT + '/test/e2e/fixtures-adv/';
const ONLY = (process.env.ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
fs.mkdirSync(OUT_DIR, { recursive: true });

/* ---------------- the spec, transcribed (§3.7) ---------------- */
const STATES = ['off', 'blocks-painted', 'read-no-match', 'no-coverable-text',
                'incomplete', 'pass-not-run', 'derived', 'unknown'];
const PIXELS_FOR = {
  'off': 'none', 'blocks-painted': 'baked', 'read-no-match': 'baked',
  'no-coverable-text': 'unknown', 'incomplete': 'unknown',
  'pass-not-run': 'unknown', 'derived': 'unknown', 'unknown': 'unknown'
};
const BAKED_ENTRANCES = ['blocks-painted', 'read-no-match'];
const ANCHOR = {
  'blocks-painted': /drawn as a picture was not read/i,
  'read-no-match': /matched none of the five patterns it looks for/i,
  'no-coverable-text': /found no readable text in this image/i,
  'incomplete': /could not finish checking this page/i,
  'unknown': /cannot show that the redaction pass ran/i,
  'pass-not-run': /redaction runs on full-page captures/i,
  'derived': /edited after capture/i
};
const RETIRED = [
  [/found nothing to hide/i, '§3.3 — a verdict on the page, not a report of the act'],
  [/draws its text as a picture/i, '§3.4 — the retired inference'],
  [/of text on this page/i, '§3.3 — claims a total the instrument does not have']
];
/* §3.3's blind-spot clause — the sentence that must appear when unplaced.total > 0 */
const BLINDSPOT = /further spans/i;

/* marker colours, matched to fixtures-adv/_kit.css */
const C = {
  email: [255, 90, 90], phone: [90, 200, 120], card: [90, 130, 255],
  ssn: [160, 110, 255], decoy: [245, 205, 45], late: [255, 120, 200],
  frame: [0, 200, 200], block: [17, 17, 17]
};
const VISIBLE = 8;    /* a marker band that survived into the image */
const COVERED = 6;    /* residue tolerated on a band that was painted over */

/* ---------------- ESCAPE ledger ---------------- */
const escapes = [];
function escape(label, evidence) {
  escapes.push({ group: currentGroup, label, evidence });
  console.log('  ESCAPE  ' + label + (evidence ? '  — ' + evidence : ''));
}
let currentGroup = '';
const beginG = (n, s) => { currentGroup = n; begin(n, s); };

/* ---------------- accessors ---------------- */
const L = r => r && r.ledger;
const S = r => { const l = L(r); return l && l.scan; };
const B = r => { const l = L(r); return l && l.bake; };
const stateOf = r => { const l = L(r); return l && l.state; };
const pixelsOf = r => { const l = L(r); return l && l.pixels; };
const lineOf = s => (s.lineText || '') + ' ' + (s.toastText || '');
const anySurface = s => ((s.lineText || '') + ' ' + (s.toastText || '') + ' ' + (s.bodyText || ''));

/* ================= universals — every fixture, every shape ================= */
function universals(rec, surfaces) {
  const l = L(rec), s = S(rec), b = B(rec);
  const st = stateOf(rec), px = pixelsOf(rec);

  check('U1 the record carries a redaction ledger at the spec\'s key (§3.9.1)',
    !!l, l ? 'v=' + l.v + ' state=' + st : 'record top keys: ' + JSON.stringify(rec.topKeys));
  if (!l) return null;

  check('U2 state is inside the closed set (§3)', STATES.includes(st), String(st));
  check('U3 pixels matches the §3.7 mapping for the state',
    px === PIXELS_FOR[st], st + ' -> ' + px + ' (table says ' + PIXELS_FOR[st] + ')');
  check('U4 pixels:"baked" has exactly the two entrances §3.7 lists',
    px !== 'baked' || BAKED_ENTRANCES.includes(st), st + ' -> ' + px);

  /* §2.1's invariant, asserted by the tiers per the spec's own instruction */
  if (s) {
    const up = totalOf(s.unplaced), fed = num(s.fed), placed = num(s.placed);
    check('U5 Σ unplaced + placed === fed (§2.1)',
      up !== undefined && fed !== undefined && placed !== undefined && up + placed === fed,
      'unplaced ' + up + ' + placed ' + placed + ' = ' + (up + placed) + ' vs fed ' + fed);
  } else check('U5 Σ unplaced + placed === fed (§2.1)', false, 'no scan ledger');

  /* §2.4 — the bake's outcome set must be total: every handed box got a named fate */
  if (b) {
    const h = num(b.handed), p = num(b.painted), u = num(b.unplaced), o = num(b.outOfRange);
    check('U6 painted + unplaced + outOfRange === handed (§2.4 — every box gets a named outcome)',
      [h, p, u, o].every(v => v !== undefined) && p + u + o === h,
      'painted ' + p + ' + unplaced ' + u + ' + outOfRange ' + o + ' = ' + (p + u + o) + ' vs handed ' + h);
  } else check('U6 painted + unplaced + outOfRange === handed (§2.4)', false, 'no bake ledger');

  /* U6b — THE OTHER END OF THE SAME PIPE, and it is here because it was
     observed happening, not because the spec asks for it. `bakeOk` contains
     `bake.handed === scan.boxes`, so a mismatch is caught by the STATE; nothing
     anywhere reports it as an event. On one of four full runs of this corpus,
     three consecutive box-bearing fixtures came back with scan.boxes = 1/1/3
     and bake.handed = 0/0/0 — the boxes the scan emitted never reached the
     compositor, nothing was painted, and the PII was plainly legible in the
     delivered image on a page that paints correctly every other time.
     §2.4's counters cannot see it: `unplaced` counts boxes the bake DISCARDED,
     and these never arrived to be discarded. */
  if (s && b) {
    check('U6b every box the scan emitted reached the bake (scan.boxes === bake.handed)',
      num(s.boxes) === num(b.handed),
      'scan.boxes=' + num(s.boxes) + ' bake.handed=' + num(b.handed) +
      (num(s.boxes) > num(b.handed) ? '  — boxes lost between the scan and the compositor' : ''));

    /* U6c — §2.6's severity ladder has no term for the loss above. `exposed`
       means "FullShot positively knows there is PII it did not cover"; finding
       three secrets and covering none is the definitive case, and it scores
       `unread`, which per §3.7 means the permanent line and NO TOAST. */
    if (num(s.boxes) > 0 && num(b.painted) === 0) {
      check('U6c found PII and covered none of it raises the EXPOSED severity (§2.6)',
        l.severity === 'exposed',
        'severity=' + l.severity + ' scan.boxes=' + num(s.boxes) + ' painted=' + num(b.painted) +
        ' — §2.6 exposed reads bake.unplaced / verifyFailed / boxesFromUnplaced / movedUncovered / ' +
        'lateMatched, and none of them can see a box that never arrived');
    }
  }

  /* §3.9.2 — a PERMANENT line, surviving the settle, not only a 12s toast */
  const anchor = ANCHOR[st];
  const body = anySurface(surfaces);
  check('U7 the state\'s §3.x sentence is on a permanent surface (§3.9.2)',
    !!anchor && (anchor.test(surfaces.lineText || '') || anchor.test(body)),
    'line=' + JSON.stringify((surfaces.lineText || '').slice(0, 150)));

  for (const [re, why] of RETIRED) {
    check('U8 retired phrasing absent: ' + why, !re.test(body), re.source);
  }

  /* §3.9.1 — counts and areas, NEVER geometry */
  const flat = JSON.stringify(l);
  check('U9 no rectangle geometry travels on the record (§3.9.1)',
    !/"piiBoxes"|"boxesXY"|"rects"/.test(flat) &&
    !/\{"x":\s*-?\d+,\s*"y":/.test(flat), flat.length + ' bytes of ledger');

  /* §3.9 / §1.1 q3 — a counter nobody can see is a counter nobody can check */
  if (s) {
    const want = ['fed', 'chars', 'placed', 'matched', 'boxes', 'boxesFromUnplaced',
                  'unplacedChars', 'inkPx', 'declinedChars', 'walks', 'walksCompleted',
                  'remeasured', 'movedUncovered', 'budgetMs', 'sealed'];
    const missing = want.filter(k => s[k] === undefined);
    check('U10 the scan ledger is PERSISTED whole, not summarised (§3.9.1)',
      missing.length === 0, missing.length ? 'missing: ' + missing.join(',') : Object.keys(s).length + ' fields');
    const groups = ['unplaced', 'declined', 'truncated', 'frames'];
    const gm = groups.filter(k => !s[k] || typeof s[k] !== 'object');
    check('U11 every per-reason counter group survives persistence (§2.1)',
      gm.length === 0, gm.length ? 'missing: ' + gm.join(',') : groups.join(','));
  }

  /* §3.3 — the reassurance sentence is graded BY THE EVIDENCE, not by taste.
     unplaced.total > 0 obliges the blind-spot clause; === 0 forbids inventing
     one. This is the check that stops a future edit softening the wording while
     leaving `pixels` alone, which §3.7 names as the rule's blind side. */
  if (st === 'read-no-match' && s) {
    const up = totalOf(s.unplaced);
    const hasClause = BLINDSPOT.test(body);
    check('U12 the §3.3 sentence form matches unplaced.total',
      (up > 0) === hasClause, 'unplaced.total=' + up + ' blindSpotClause=' + hasClause);
    check('U13 the read-no-match sentence states the quantity it read (§3.3)',
      /\d/.test(surfaces.lineText || body), (surfaces.lineText || '').slice(0, 140));
  }
  return { st, px, s, b };
}

/* helper: is a marker colour still legible in the delivered image? */
function shown(pix, key) { return (pix.rows[key] || 0) >= VISIBLE; }
function gone(pix, key) { return (pix.rows[key] || 0) <= COVERED; }

/* the shared body of the content-visibility family (see the fixtures) */
function cvFamily(rec, surfaces, pix, p, what) {
  const s = S(rec), b = B(rec), l = L(rec), st = stateOf(rec);
  note('matched=' + num(s && s.matched) + ' boxes=' + num(s && s.boxes) +
       ' boxesFromUnplaced=' + num(s && s.boxesFromUnplaced) +
       ' matchedNoBox=' + num(s && s.matchedNoBox) +
       ' unplaced=' + JSON.stringify(s && s.unplaced) +
       ' bake=' + JSON.stringify(b) + ' severity=' + (l && l.severity));

  check(p + '1 the hidden text is NOT in the delivered image (precondition)',
    !shown(pix, 'email'), 'email marker rows=' + pix.rows.email);

  /* The claim. `blocks-painted` is the strongest sentence the product has —
     "FullShot covered N places in this image" — and here N places were covered
     in a subtree the renderer skipped. Nothing was covered. */
  const painted = num(b && b.painted) || 0;
  check(p + '2 ' + what + ' does not produce a "covered N places" claim over text that is not in the image',
    !(st === 'blocks-painted' && painted > 0 && !shown(pix, 'email')),
    'state=' + st + ' painted=' + painted + ' line=' +
    JSON.stringify((surfaces.lineText || '').slice(0, 140)));

  /* And the block is not harmless: it is opaque paint at coordinates derived
     from a subtree that was never rendered, landing on whatever IS rendered
     there. §2.6 added boxesFromUnplaced precisely to stop a block being painted
     from text that is not in the picture; it reads 0 here because the six
     clauses all say the span is placed. */
  check(p + '3 no opaque block is painted at coordinates taken from unrendered content',
    (pix.rows.block || 0) === 0,
    'block rows=' + pix.rows.block + ' boxesFromUnplaced=' + num(s && s.boxesFromUnplaced));

  check(p + '4 the guard that exists for exactly this case fires (§2.6 boxesFromUnplaced)',
    num(s && s.matched) === 0 || num(s && s.boxesFromUnplaced) > 0 ||
    num(s && s.matchedNoBox) > 0 || totalOf(s && s.unplaced) > 0,
    'matched=' + num(s && s.matched) + ' boxesFromUnplaced=' + num(s && s.boxesFromUnplaced) +
    ' unplaced.total=' + totalOf(s && s.unplaced) +
    ' — all six §2.2 clauses pass: the rect is full size, the font-size agrees, ' +
    'and every composed ancestor reports overflow:visible / opacity:1 / contentVisibility:visible');
}

/* ================= fixtures ================= */
/* PREDICTION is written before the run and printed beside the result, so a
   check that comes back the unexpected colour is visible as a surprise rather
   than quietly rationalised afterwards. */
const FIX = [

{ name: 'mixed-owntext', file: 'mixed-owntext.html', spec: '§7.1 G / §5.1 / §3.3',
  colours: { email: C.email, card: C.card, ssn: C.ssn, block: C.block },
  predict: 'read-no-match / baked, matched 0, all three tokens legible in the PNG',
  fn(rec, surfaces, pix) {
    const s = S(rec), st = stateOf(rec), px = pixelsOf(rec);
    note('fed=' + num(s && s.fed) + ' chars=' + num(s && s.chars) +
         ' placed=' + num(s && s.placed) + ' matched=' + num(s && s.matched) +
         ' boxes=' + num(s && s.boxes) + ' unplaced.total=' + totalOf(s && s.unplaced));
    const legible = shown(pix, 'email') || shown(pix, 'card') || shown(pix, 'ssn');
    check('M1 the three tokens are actually in the delivered image (fixture precondition)',
      legible, JSON.stringify(pix.rows));
    check('M2 nothing was painted over them', (pix.rows.block || 0) === 0,
      'block rows ' + pix.rows.block);
    check('M3 the detector was never handed the paragraphs\' own text (shape precondition)',
      num(s && s.matched) === 0, 'matched=' + num(s && s.matched));
    if (px === 'baked' && legible) {
      escape('a Visa card, an email and a tax ID are legible in the image and the record says pixels:"baked"',
        'state=' + st + ' matched=0 boxes=' + num(s && s.boxes) +
        ' colour rows email/card/ssn=' + pix.rows.email + '/' + pix.rows.card + '/' + pix.rows.ssn);
      check('M4 a page whose visible PII was never read does not reach a "baked" claim',
        false, 'state=' + st + ' pixels=' + px + ' — §7.1 G, "not a shape at all, it is every page"');
    } else {
      check('M4 a page whose visible PII was never read does not reach a "baked" claim',
        true, 'state=' + st + ' pixels=' + px);
    }
    const up = totalOf(s && s.unplaced);
    if (st === 'read-no-match' && up === 0) {
      note('§3.3 renders the UNQUALIFIED reassurance form here: unplaced.total=0, ' +
           'so the sentence carries no blind-spot clause at all.');
    }
  } },

{ name: 'split-token', file: 'split-token.html', spec: '§7.1 H / §5.1',
  colours: { card: C.card, email: C.email, ssn: C.ssn, block: C.block },
  predict: 'read-no-match / baked, matched 0, card + email + tspan SSN legible',
  fn(rec, surfaces, pix) {
    const s = S(rec), st = stateOf(rec), px = pixelsOf(rec);
    note('fed=' + num(s && s.fed) + ' chars=' + num(s && s.chars) +
         ' matched=' + num(s && s.matched) + ' boxes=' + num(s && s.boxes));
    const legible = shown(pix, 'card') || shown(pix, 'email') || shown(pix, 'ssn');
    check('P1 the fragmented tokens are in the delivered image (precondition)', legible,
      JSON.stringify(pix.rows));
    check('P2 the fragments individually match nothing (shape precondition)',
      num(s && s.matched) === 0, 'matched=' + num(s && s.matched));
    if (px === 'baked' && legible) {
      escape('a card number and an email split across inline elements are legible and the record says pixels:"baked"',
        'state=' + st + ' card rows=' + pix.rows.card + ' email rows=' + pix.rows.email);
    }
    check('P3 the arrangement limit is named on the surface the user reads, not only in the spec',
      /arranged|split|drawn as a picture|patterns it looks for/i.test(anySurface(surfaces)),
      (surfaces.lineText || '').slice(0, 160));
  } },

{ name: 'object-door', file: 'object-door.html', spec: '§5.4 / E12',
  colours: { frame: C.frame, email: C.email, block: C.block },
  predict: 'frames counters all 0 (the counter only knows IFRAME/FRAME) -> read-no-match / baked',
  fn(rec, surfaces, pix) {
    const s = S(rec), st = stateOf(rec), px = pixelsOf(rec);
    const fr = (s && s.frames) || {};
    note('frames=' + JSON.stringify(fr) + ' fed=' + num(s && s.fed) +
         ' placed=' + num(s && s.placed) + ' matched=' + num(s && s.matched));
    const legible = shown(pix, 'email') || shown(pix, 'frame');
    check('O1 the embedded document is in the delivered image (precondition)', legible,
      JSON.stringify(pix.rows));
    check('O2 a same-origin nested browsing context is COUNTED AS A DOOR (§5.4)',
      num(fr.sameOrigin) > 0 || num(fr.crossOrigin) > 0,
      'frames=' + JSON.stringify(fr) + ' — <object>/<embed> create nested browsing contexts; ' +
      'the counter recognises only the tag names IFRAME and FRAME');
    check('O3 an unscanned reachable surface breaks scanOk (§5.4 / E12)',
      st !== 'read-no-match' && st !== 'blocks-painted',
      'state=' + st + ' pixels=' + px);
    if (px === 'baked' && legible) {
      escape('an <object>/<embed>-hosted same-origin document carrying an email and a card is legible and the record says pixels:"baked"',
        'state=' + st + ' frames=' + JSON.stringify(fr));
    }
  } },

{ name: 'late-swap', file: 'late-swap.html', spec: '§2.3 / §7.1 D',
  colours: { email: C.email, card: C.card, block: C.block },
  predict: 'trigger fires inside the scan walk; matched 0; PII painted into a later frame -> read-no-match / baked',
  fn(rec, surfaces, pix, truth) {
    const s = S(rec), st = stateOf(rec), px = pixelsOf(rec);
    const F = truth && truth.fixture;
    note('trigger=' + JSON.stringify(F) + ' matched=' + num(s && s.matched) +
         ' lateTextPlaced=' + num(s && s.lateTextPlaced) + ' lateMatched=' + num(s && s.lateMatched) +
         ' remeasured=' + num(s && s.remeasured) + ' movedUncovered=' + num(s && s.movedUncovered));
    /* SETUP CHECK, and it is the thing that makes this fixture trustworthy: if
       the swap had beaten the scan the paragraph would have MATCHED. matched===0
       with fired===true is proof the scan ran first. Without both, the run is
       inconclusive and says so rather than reporting a finding. */
    const setupOk = !!(F && F.fired) && num(s && s.matched) === 0;
    check('L1 setup: the swap fired and the scan demonstrably ran before it',
      setupOk, 'fired=' + (F && F.fired) + ' reads=' + (F && F.reads) + ' matched=' + num(s && s.matched));
    const legible = shown(pix, 'email') || shown(pix, 'card');
    check('L2 the late content reached the delivered image (precondition)', legible,
      JSON.stringify(pix.rows));
    if (!setupOk || !legible) { open('L3 inconclusive run — not graded', 'setup=' + setupOk + ' legible=' + legible); return; }
    check('L3 text that rendered after the scan cannot leave a "baked" claim standing (§2.3)',
      px !== 'baked', 'state=' + st + ' pixels=' + px);
    if (px === 'baked') {
      escape('an email and a card inserted after the scan are legible in the image and the record says pixels:"baked"',
        'state=' + st + ' lateTextPlaced=' + num(s && s.lateTextPlaced) +
        ' lateMatched=' + num(s && s.lateMatched) + ' rows email/card=' + pix.rows.email + '/' + pix.rows.card);
    }
  } },

{ name: 'late-frame', file: 'late-frame.html', spec: '§2.3 + §5.4',
  colours: { frame: C.frame, email: C.email, block: C.block },
  predict: 'the door itself arrives after the walk -> frames all 0 -> read-no-match / baked',
  fn(rec, surfaces, pix, truth) {
    const s = S(rec), st = stateOf(rec), px = pixelsOf(rec);
    const F = truth && truth.fixture, fr = (s && s.frames) || {};
    note('trigger=' + JSON.stringify(F) + ' frames=' + JSON.stringify(fr) +
         ' matched=' + num(s && s.matched));
    const setupOk = !!(F && F.fired);
    const legible = shown(pix, 'email') || shown(pix, 'frame');
    check('N1 setup: the frame mounted after the scan walk started', setupOk,
      'fired=' + (F && F.fired) + ' reads=' + (F && F.reads));
    check('N2 the late frame reached the delivered image (precondition)', legible,
      JSON.stringify(pix.rows));
    if (!setupOk || !legible) { open('N3 inconclusive run — not graded', 'setup=' + setupOk + ' legible=' + legible); return; }
    check('N3 a door that opened after the walk does not leave a "baked" claim standing',
      px !== 'baked', 'state=' + st + ' pixels=' + px + ' frames=' + JSON.stringify(fr));
    if (px === 'baked') {
      escape('a same-origin iframe mounted after the scan is legible in the image and the record says pixels:"baked"',
        'state=' + st + ' frames=' + JSON.stringify(fr));
    }
  } },

{ name: 'shadow-closed-frame', file: 'shadow-closed-frame.html', spec: '§7.1 I + §7.1 A + §5.4',
  colours: { frame: C.frame, email: C.email, block: C.block },
  predict: 'closed root is not descended and the frame inside it is not counted -> read-no-match / baked',
  fn(rec, surfaces, pix) {
    const s = S(rec), st = stateOf(rec), px = pixelsOf(rec);
    const fr = (s && s.frames) || {};
    note('frames=' + JSON.stringify(fr) + ' fed=' + num(s && s.fed) +
         ' placed=' + num(s && s.placed) + ' matched=' + num(s && s.matched));
    const legible = shown(pix, 'email') || shown(pix, 'frame');
    check('D1 the component\'s content is in the delivered image (precondition)', legible,
      JSON.stringify(pix.rows));
    check('D2 the closed shadow root is counted as a door somewhere in the ledger (§5.4)',
      Object.keys(s || {}).some(k => /shadow|closed|door/i.test(k)) ||
      num(fr.sameOrigin) > 0 || num(fr.crossOrigin) > 0,
      'ledger keys: ' + Object.keys(s || {}).join(',') + ' frames=' + JSON.stringify(fr));
    check('D3 an unreachable surface holding the page\'s content breaks the positive claim',
      px !== 'baked', 'state=' + st + ' pixels=' + px);
    if (px === 'baked' && legible) {
      escape('a closed shadow root wrapping a same-origin iframe hides both the text AND the door; email + card legible, record says pixels:"baked"',
        'state=' + st + ' frames=' + JSON.stringify(fr));
    }
  } },

{ name: 'canvas-combo', file: 'canvas-combo.html', spec: '§5.2 / §7.4 / §7.6',
  colours: { email: C.email, card: C.card, block: C.block },
  predict: 'chrome + sr-only supply fed/placed; canvas body holds the PII -> read-no-match or no-coverable-text',
  fn(rec, surfaces, pix) {
    const s = S(rec), st = stateOf(rec), px = pixelsOf(rec);
    note('fed=' + num(s && s.fed) + ' chars=' + num(s && s.chars) +
         ' placed=' + num(s && s.placed) + ' unplaced=' + JSON.stringify(s && s.unplaced) +
         ' inkPx=' + num(s && s.inkPx) + ' capturedPx=' + num(s && s.capturedPx));
    const legible = shown(pix, 'email') || shown(pix, 'card');
    check('K1 the canvas-painted PII is in the delivered image (precondition)', legible,
      JSON.stringify(pix.rows));
    /* §7.4's cheap improvement: the SECOND TERM. Not graded — §7.4 is the
       Critic section and §3.3's normative sentence does not require it. Printed
       because §7.4's argument stands: the character count on its own asks the
       reader to perform a comparison the product has not given them the second
       term for, and this fixture is the case the argument was written about. */
    const body = anySurface(surfaces);
    open('K2 §7.4 second term (inkPx/capturedPx) on the surface the user reads',
      String(/%|\bof the (captured|image)\b|inkPx/i.test(body)) +
      ' — inkPx=' + num(s && s.inkPx) + ' is in the ledger; the sentence shows only the char count');
    check('K3 the "anything drawn as a picture was not read" clause is present when pixels are claimed baked',
      px !== 'baked' || /drawn as a picture was not read|patterns it looks for/i.test(body),
      'state=' + st + ' line=' + (surfaces.lineText || '').slice(0, 140));
    if (px === 'baked' && legible) {
      escape('canvas-painted email + card legible; record says pixels:"baked" (§7.6 calls this the single most dangerous outcome in the design)',
        'state=' + st + ' chars=' + num(s && s.chars) + ' placed=' + num(s && s.placed));
    }
  } },

/* --- the content-visibility family. Two fixtures, one mechanism. ---------
   A closed <details> gets `content-visibility: hidden` from Chrome's UA
   stylesheet, applied to a `::details-content` PSEUDO-ELEMENT. An author's
   inactive tab panel gets the same declaration directly. In both cases Chrome
   LAYS THE SUBTREE OUT and simply does not paint it, so the leaf reports:
   a full-size rect, visibility:visible, opacity:1, contentVisibility:visible,
   and a font-size that agrees with the rect — while every composed ancestor
   reports overflow:visible/opacity:1/contentVisibility:visible too, because
   the hiding lives on a pseudo-element that is not in the ancestor chain.

   All six §2.2 clauses therefore pass, `placed` counts it, a box is emitted,
   the bake paints it, and the read-back confirms it opaque. The engine's own
   answer — `element.checkVisibility()` — is `false`. */
{ name: 'details-closed', file: 'details-closed.html', spec: '§2.2 clauses 1-6 / §3.2',
  colours: { email: C.email, block: C.block },
  predict: 'unknown before the run — either unplaced.degenerate (safe) or fully `placed` (a block over nothing)',
  fn(rec, surfaces, pix) { cvFamily(rec, surfaces, pix, 'C', 'a collapsed <details>'); } },

{ name: 'cv-tabs', file: 'cv-tabs.html', spec: '§2.2 clauses 1-6 / §3.2',
  colours: { email: C.email, phone: C.phone, block: C.block },
  predict: 'same mechanism, author-written: the hidden panel\'s block lands on the VISIBLE panel\'s text',
  fn(rec, surfaces, pix) {
    cvFamily(rec, surfaces, pix, 'T', 'an inactive content-visibility:hidden tab panel');
    /* the visible panel's own marker is the thing that gets destroyed */
    check('T5 the VISIBLE panel\'s text survives the capture',
      shown(pix, 'phone'), 'visible-panel marker rows=' + pix.rows.phone +
      ' — the hidden panel\'s box is computed at the same coordinates');
  } },

{ name: 'honest-article', file: 'honest-article.html', spec: '§6.3 E8 — SHIP GATE',
  colours: { block: C.block },
  predict: 'read-no-match / baked, chars > 1000, no toast, no warning language',
  fn(rec, surfaces, pix, truth) {
    const s = S(rec), st = stateOf(rec), px = pixelsOf(rec);
    const body = anySurface(surfaces);
    note('fed=' + num(s && s.fed) + ' chars=' + num(s && s.chars) +
         ' placed=' + num(s && s.placed) + ' unplaced=' + JSON.stringify(s && s.unplaced) +
         ' innerText=' + (truth && truth.innerTextLen));
    check('H1 E8: a clean article with real text is read-no-match', st === 'read-no-match', String(st));
    check('H2 E8: pixels is "baked"', px === 'baked', String(px));
    check('H3 E8: chars > 1000 and the number is rendered in the sentence',
      num(s && s.chars) > 1000 && /\d{3,}/.test(surfaces.lineText || body),
      'chars=' + num(s && s.chars) + ' line=' + (surfaces.lineText || '').slice(0, 160));
    check('H4 E8: no warning language on the honest case',
      !/may still be visible|treat the image as unredacted|could not finish/i.test(body),
      body.slice(0, 200));
    check('H5 E8: no toast on read-no-match (§3.7)',
      !surfaces.toastShown || !Object.values(ANCHOR).some(re => re.test(surfaces.toastText || '')),
      'toastShown=' + surfaces.toastShown + ' ' + JSON.stringify((surfaces.toastText || '').slice(0, 120)));
    check('H6 E8: nothing was blacked out on a page with no PII',
      (pix.rows.block || 0) === 0, 'block rows=' + pix.rows.block);
    if (truth && truth.innerTextLen) {
      open('H7 E16 magnitude: chars vs innerText on ORDINARY markup',
        num(s && s.chars) + ' / ' + truth.innerTextLen + ' = ' +
        Math.round(100 * num(s && s.chars) / truth.innerTextLen) + '% — the rest is own text of ' +
        'elements that have an element child, which is never fed');
    }
  } },

{ name: 'honest-pii', file: 'honest-pii.html', spec: '§3.2 / §2.5 — SHIP GATE',
  colours: { email: C.email, phone: C.phone, card: C.card, decoy: C.decoy, block: C.block },
  predict: 'blocks-painted / baked, 3 tokens covered and verified, decoy untouched',
  fn(rec, surfaces, pix) {
    const s = S(rec), b = B(rec), st = stateOf(rec), px = pixelsOf(rec);
    note('matched=' + num(s && s.matched) + ' boxes=' + num(s && s.boxes) +
         ' bake=' + JSON.stringify(b));
    check('G1 the feature still works: blocks-painted', st === 'blocks-painted', String(st));
    check('G2 pixels is "baked"', px === 'baked', String(px));
    check('G3 every box the scan emitted was painted AND read back opaque (§2.5)',
      !!b && num(b.painted) === num(b.handed) && num(b.verified) === num(b.painted) &&
      num(b.painted) > 0 && num(b.verifyFailed) === 0 && num(b.verifySkipped) === 0,
      JSON.stringify(b));
    check('G4 the email is covered in the delivered image', gone(pix, 'email'), 'rows=' + pix.rows.email);
    check('G5 the phone is covered in the delivered image', gone(pix, 'phone'), 'rows=' + pix.rows.phone);
    check('G6 the card is covered in the delivered image', gone(pix, 'card'), 'rows=' + pix.rows.card);
    check('G7 the Luhn-invalid decoy is LEFT ALONE — refusing everything is not a fix',
      shown(pix, 'decoy'), 'rows=' + pix.rows.decoy);
    check('G8 blocks were actually painted into the image', (pix.rows.block || 0) > 0,
      'block rows=' + pix.rows.block);
    check('G9 no toast on the positive state (§3.7)',
      !surfaces.toastShown || !Object.values(ANCHOR).some(re => re.test(surfaces.toastText || '')),
      'toastShown=' + surfaces.toastShown);
    check('G10 the §3.2 sentence keeps the "drawn as a picture" clause on the strongest state',
      /drawn as a picture was not read/i.test(anySurface(surfaces)),
      (surfaces.lineText || '').slice(0, 180));
  } }

];

/* ================= runner ================= */
(async () => {
  const srv = await serve(EXT_DIR, PORT);
  const TEST_EXT = prepareTestExtension();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullshot-adv-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: !process.env.HEADFUL,
    viewport: { width: 1280, height: 800 },
    args: ['--disable-extensions-except=' + TEST_EXT, '--load-extension=' + TEST_EXT]
  });

  try {
    await ctx.addInitScript(MUTATION_PROBE);
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
    begin('setup', '');
    currentGroup = 'setup';
    check('extension service worker started', !!sw, sw && sw.url());
    /* §4.2 — the setting selects `off` and nothing else; the whole corpus runs
       with it ON so the setting can never be the reason a claim appears. */
    await setSettings(sw, { redactPII: true });

    const census = [];
    for (const F of FIX) {
      if (ONLY.length && !ONLY.includes(F.name)) continue;
      beginG(F.name, F.spec);
      note('PREDICTED: ' + F.predict);
      let out;
      try {
        out = await capture(ctx, sw, 'adv-' + F.name, BASE + F.file, F.colours || {}, {});
      } catch (e) {
        check('capture completed', false, String((e && e.message) || e));
        census.push({ fixture: F.name, state: 'CAPTURE-FAILED', pixels: '-' });
        continue;
      }
      note('image ' + out.pix.width + '×' + out.pix.height + '  colour rows ' + JSON.stringify(out.pix.rows));
      note('LEDGER ' + JSON.stringify(L(out.rec)));
      try {
        universals(out.rec, out.surfaces);
        F.fn(out.rec, out.surfaces, out.pix, out.truth);
      } catch (e) {
        check('assertions ran to completion', false, String((e && e.message) || e));
      }
      const l = L(out.rec);
      census.push({ fixture: F.name, state: stateOf(out.rec), pixels: pixelsOf(out.rec),
                    severity: l && l.severity });
    }

    console.log('\n=== census ===');
    for (const c of census) {
      console.log('  ' + c.fixture.padEnd(22) + (String(c.state)).padEnd(20) +
                  String(c.pixels).padEnd(10) + (c.severity || ''));
    }
  } finally {
    await ctx.close();
    srv.close();
  }

  console.log('\n================ RESULT ================');
  console.log('pass ' + results.pass + '   fail ' + results.fail + '   open ' + results.open +
              '   ESCAPES ' + escapes.length);
  if (results.fails.length) {
    console.log('\n--- failures ---');
    results.fails.forEach(f => console.log('  ' + f));
  }
  if (escapes.length) {
    console.log('\n--- ESCAPES: legible sensitive text under a "baked" claim ---');
    escapes.forEach(e => console.log('  ' + e.group + ' :: ' + e.label + '\n      ' + e.evidence));
  }
  if (results.opens.length) {
    console.log('\n--- open ---');
    results.opens.forEach(o => console.log('  ' + o));
  }
  process.exit(results.fail || escapes.length ? 1 : 0);
})();
