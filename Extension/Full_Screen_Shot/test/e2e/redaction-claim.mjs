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
   exit 1, 151 pass / 199 fail / 30 open — not one number moved between them.

   QUARANTINED in .github/workflows/e2e.yml, which carries the same numbers.

   ITS REPLACEMENT IS test/e2e/reduction-corpus.mjs — wired and green, and it
   runs THIS SUITE'S ENTIRE CORPUS: both read `fixtures/`, all seventeen
   shapes. Retiring this file therefore costs no shape coverage, which is what
   separates it from adversarial-claim.mjs beside it. (claim-reduction.mjs runs
   only eight of the seventeen; it is an overlap, not the replacement.)

   IT CANNOT BE REPAIRED INTO GREEN, ONLY REPLACED — and it already has been.
   The § numbers every check below cites (§2.6, §3.7, §5.4, §6.1, §7.1, E8,
   E13) are sections of the PRE-REDUCTION REDACTION-CLAIM-SPEC.md, which was
   rewritten in place; not one of them exists in that file today, so there is
   no longer anything for these assertions to be graded against.

   This file is kept, unrun, for one reason: the FIXTURES are the accumulated
   record of shapes that beat six fixes, and they are worth more than the
   assertions wrapped around them. Harvest from it; do not repair it.

   ─────────────────────────────────────────────────────────────────────────
   APPENDED 2026-08-26. Everything above stands as written; this block is the
   correction, and it lands on one clause only.

   🔴 "Retiring this file therefore costs no shape coverage" IS FALSE, AND SO
   IS "all seventeen shapes". Measured by parsing the fixture registration of
   every `.mjs` in this directory — not by grepping for filenames, which does
   not see `BASE + name + '.html'`:

     this suite registers          17 shapes of fixtures/
     reduction-corpus.mjs reaches  13 of those 17
     it does NOT reach              4 — before-content, clipped-ancestor,
                                        input-values, svg-text

   `before-content` is picked up by batch-artifact.mjs, which is wired. THE
   OTHER THREE — **clipped-ancestor, input-values and svg-text** — appear in
   no other suite in this directory, wired or quarantined. Retiring this file
   orphans them outright: three page shapes that beat an earlier fix, graded
   by nothing at all. That is the cost, it is not zero, and it is written here
   so the next reader does not derive it a fourth time.

   ⚠️ A note on one piece of evidence that points the other way: commit
   5121633's message lists reduction-corpus.mjs as covering `clipped-ancestor`.
   It does not — the name occurs in no `.mjs` in this directory except this
   one. Trust the parse over the prose.

   A SECOND NUMBER IN THE SAME FAMILY: "claim-reduction.mjs runs only eight of
   the seventeen" is off in the same direction. Its corpus is 8 shapes, but 3
   of them (object-door, split-token, mixed-owntext) come from `fixtures-adv/`.
   It overlaps this suite by **5** of the 17, not 8.

   ON THE § NUMBERS, line 24 names the right sections and understates the rest.
   Parsed: this file cites 35 distinct § numbers and 27 have no heading in
   REDACTION-CLAIM-SPEC.md today; E1 through E16 are all gone, because the
   current spec carries no E-numbered list at all. The 8 that still resolve
   (2.1, 2.2, 2.3, 3, 3.2, 3.3, 3.4, 3.5) are numbers REUSED for different
   content, not sections that stayed put — §3.3 is "The marks" now.

   NONE OF THIS ARGUES FOR RE-ARMING THE FILE. It still cannot be graded
   against a spec that no longer contains its sections. It argues that the
   three orphaned shapes need a home in a suite written from the CURRENT spec
   before anyone deletes this one.
   ───────────────────────────────────────────────────────────────────────── */
/* FullShot REAL-BROWSER redaction-claim suite.

   Written FROM REDACTION-CLAIM-SPEC.md, against the real extension in real
   Chromium. Not from the implementation — deliberately. All five previous
   fixes were defeated by a page shape the fixture author had not imagined,
   and all three escapes found in the shipped tree were found in a browser and
   missed by the fake DOM (§6.3). A fixture written by whoever wrote the code
   is a fixture that agrees with the code.

   Every fixture is a page shape. Every assertion cites the section it comes
   from. Where the spec is silent for a shape the finding is recorded OPEN and
   never graded — see the report; guessing is how proxy number seven gets in.

   Setup (once):   cd test/e2e && npm install && npx playwright install chromium
   Run:            npm run test:claim
                   HEADFUL=1 npm run test:claim
                   ONLY=control-pii,sr-only npm run test:claim
*/
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  EXT_DIR, OUT_DIR, serve, prepareTestExtension, setSettings, capture,
  begin, check, open, note, results, num, totalOf, MUTATION_PROBE
} from './claim-lib.mjs';

const PORT = 8911;
const BASE = 'http://localhost:' + PORT + '/test/e2e/fixtures/';
const ONLY = (process.env.ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
fs.mkdirSync(OUT_DIR, { recursive: true });

/* ================= the spec, transcribed ================= */

/* §3 — the closed set. §3.7's rule: a state outside it is `unknown`. */
const STATES = ['off', 'blocks-painted', 'read-no-match', 'no-coverable-text',
                'incomplete', 'pass-not-run', 'derived', 'unknown'];

/* §3.7 — the mapping table. The two entrances to "baked" are the whole point. */
const PIXELS_FOR = {
  'off': 'none',
  'blocks-painted': 'baked',
  'read-no-match': 'baked',
  'no-coverable-text': 'unknown',
  'incomplete': 'unknown',
  'pass-not-run': 'unknown',
  'derived': 'unknown',
  'unknown': 'unknown'
};
const BAKED_ENTRANCES = ['blocks-painted', 'read-no-match'];

/* §3.2–§3.6a — the sentences, as the spec writes them. §3.7 puts the sentence
   keys under the same amendment rule as `pixels`, so these are assertions
   about the spec, not guesses about the implementation. Apostrophes are
   matched either way because a locale file may use a typographic one. */
const AP = "['’]";
const SENTENCE = {
  'blocks-painted': [/covered/i, /in this image/i, new RegExp('reads the page' + AP + 's text', 'i'), /drawn as a picture was not read/i],
  'read-no-match': [/\bread\b/i, /characters/i, /spans/i, /matched none of the five patterns it looks for/i],
  'no-coverable-text': [/found no readable text in this image/i, /hid nothing/i, /check the image yourself/i],
  'incomplete': [/could not finish checking this page/i, /may still be visible/i],
  'unknown': [/cannot show that the redaction pass ran/i, /treat the image as unredacted/i],
  'pass-not-run': [/redaction runs on full-page captures/i, /was not scanned/i],
  'derived': [/edited after capture/i, /does not carry over/i]
};
/* the one fragment per state that identifies its host element */
const ANCHOR = {
  'blocks-painted': /drawn as a picture was not read/i,
  'read-no-match': /matched none of the five patterns it looks for/i,
  'no-coverable-text': /found no readable text in this image/i,
  'incomplete': /could not finish checking this page/i,
  'unknown': /cannot show that the redaction pass ran/i,
  'pass-not-run': /redaction runs on full-page captures/i,
  'derived': /edited after capture/i
};
/* §3.3 / §3.4 / §5.5 — phrasings this design retires by name. A future edit
   can leave `pixels` untouched and still restore the bug by rewording, which
   is why §3.7 makes the sentence part of the table. */
const RETIRED = [
  [/found nothing to hide/i, '§3.3 — a verdict on the page, not a report of the act'],
  [/draws its text as a picture/i, '§3.4 — resultRedactNoTextLayer\'s inference, retired'],
  [/of text on this page/i, '§3.3 — claims a total the instrument does not have']
];
/* §3.7 toast column */
const TOAST_FOR = {
  'off': false, 'blocks-painted': false, 'read-no-match': false,
  'no-coverable-text': true, 'pass-not-run': false, 'derived': false, 'unknown': true
  /* `incomplete` splits on severity (§2.6): exposed -> toast, unread -> none */
};

/* Marker colours, shared with the fixtures. Everywhere a fixture needs
   "covered / not covered" to be decidable, the colour rides on an inline span
   with line-height 1 so the coloured band IS the glyph band: the bake paints
   the text rect, not the block element, so a padded row keeps its background
   either side of the block and a naive "colour gone" check would be measuring
   the padding. One PII line is ~20-24 rows; a painted block is ~30. */
const C = {
  email: [255, 90, 90], phone: [90, 200, 120], card: [90, 130, 255],
  decoy: [245, 205, 45], bottom: [0, 136, 255], block: [17, 17, 17],
  cvsecret: [160, 110, 255], lateins: [255, 120, 200], lateswap: [0, 200, 200],
  frame: [120, 220, 220]
};
const VISIBLE = 12;   /* a marker band that survived */
const COVERED = 8;    /* residue tolerated on a band that was painted over */

/* ================= graded helpers ================= */

function L(rec) { return rec && rec.ledger; }
function S(rec) { const l = L(rec); return l && l.scan; }
function B(rec) { const l = L(rec); return l && l.bake; }
function stateOf(rec) { const l = L(rec); return l && l.state; }
function pixelsOf(rec) { const l = L(rec); return l && l.pixels; }

function hosts(surfaces, re) {
  return (surfaces.blocks || []).filter(b => re.test(b.text));
}

/* Every fixture gets these. They are the invariants that hold no matter what
   shape the page is, which is exactly the property the design claims to have. */
function universals(rec, surfaces, opts = {}) {
  const l = L(rec), scan = S(rec), bake = B(rec);
  const state = stateOf(rec), pixels = pixelsOf(rec);

  check('U1  record carries a redaction ledger at shot.redaction (§3.9.1)',
    !!l && typeof l === 'object',
    l ? undefined : 'shot keys: [' + (rec.topKeys || []).join(', ') + ']' +
        (rec.candidates && rec.candidates.length ? '  candidates: ' + rec.candidates.join(',') : ''));

  check('U2  scan ledger schema v === 2 (§2.1 — an unrecognised v is unknown, full stop)',
    !!scan && scan.v === 2, scan ? 'v=' + JSON.stringify(scan.v) : 'no scan ledger');
  check('U3  bake ledger schema v === 1 (§2.4)',
    !!bake && bake.v === 1, bake ? 'v=' + JSON.stringify(bake.v) : 'no bake ledger');
  check('U4  state is a member of the closed set (§3)',
    STATES.includes(state), 'state=' + JSON.stringify(state));
  check('U5  pixels is one of none|baked|unknown (§3.7)',
    ['none', 'baked', 'unknown'].includes(pixels), 'pixels=' + JSON.stringify(pixels));
  check('U6  pixels:"baked" has exactly two entrances (§3.7 — the rule)',
    pixels !== 'baked' || BAKED_ENTRANCES.includes(state), state + ' -> ' + pixels);
  check('U7  state -> pixels matches the §3.7 table',
    PIXELS_FOR[state] === pixels, state + ' -> ' + pixels + ' (table says ' + PIXELS_FOR[state] + ')');
  check('U8  scan.sealed === true is set on the normal return only (§2.1)',
    !!scan && typeof scan.sealed === 'boolean', scan ? 'sealed=' + JSON.stringify(scan.sealed) : 'no scan ledger');

  /* §6.1 #14 — the invariant that stops a span being dropped from the evidence
     silently. The unplaced spans were the false-negative channel: read, found
     clean, then removed from consideration while one placed span carried the
     whole image. */
  const up = totalOf(scan && scan.unplaced);
  const okInv = up !== undefined && num(scan && scan.placed) !== undefined &&
                num(scan && scan.fed) !== undefined && (up + scan.placed === scan.fed);
  check('U9  Σ unplaced + placed === fed (§6.1 #14)', okInv,
    scan ? 'unplaced=' + up + ' placed=' + JSON.stringify(scan.placed) + ' fed=' + JSON.stringify(scan.fed) : 'no scan ledger');

  /* §3.9.2 — a permanent line, not only a 12-second toast. The sentence is
     identified by the spec's own English, so no DOM contract has to be
     invented; the line ELEMENT is identified by the hook the implementation
     chose, and which hook matched is reported. */
  if (state && SENTENCE[state]) {
    const text = surfaces.lineShown ? surfaces.lineText : (surfaces.bodyText || '');
    const missing = SENTENCE[state].filter(re => !re.test(text));
    check('U10 the permanent line shows the §3.x sentence for "' + state + '", still present after ' +
          'settle (§3.9.2 — a line, not only a 12-second toast)',
      missing.length === 0 && surfaces.lineShown,
      (surfaces.lineShown ? 'in ' + surfaces.lineSig : 'NO permanent line element; fell back to body text') +
      (missing.length ? '; missing: ' + missing.map(String).join(' ') : ''));
  } else {
    check('U10 the permanent line shows the §3.x sentence for its state (§3.9.2)', false,
      'no state to look up: ' + JSON.stringify(state));
  }
  for (const [re, why] of RETIRED) {
    check('U11 retired phrasing absent: ' + String(re) + '  (' + why + ')',
      !re.test(surfaces.bodyText || ''));
  }

  /* §3.8 — a claim without its evidence must not be emissible. On the record
     side that means the counters travel; the third gate itself is
     aihandoff-sim's (§6.2). */
  if (pixels && pixels !== 'none') {
    check('U12 evidence travels with the claim: scan+bake counters on the record (§3.8/§3.9.1)',
      !!(scan && bake) && num(scan.chars) !== undefined && num(bake.painted) !== undefined);
  }
  /* §3.9.1 — absolute: the rectangles never travel. */
  const raw = JSON.stringify(l || {});
  check('U13 piiBoxes/geometry never persisted beside the image (§3.9.1 — absolute)',
    !/"(piiBoxes|boxesXY|rects)"/.test(raw) && !/"x":\s*\d+\s*,\s*"y":\s*\d+/.test(raw));

  /* §2.4 — a handed box either gets paint, or is refused for one of the two
     named reasons. There is no third way for a rectangle that exists BECAUSE
     PII was found there to disappear. This invariant is U9's counterpart on
     the bake side, and it is what turns "painted !== handed" from a symptom
     into a reason. */
  if (bake) {
    const accounted = num(bake.painted) !== undefined && num(bake.unplaced) !== undefined &&
                      num(bake.outOfRange) !== undefined && num(bake.handed) !== undefined &&
                      (bake.painted + bake.unplaced + bake.outOfRange === bake.handed);
    check('U14 painted + unplaced + outOfRange === handed — every box the bake was given is ' +
          'accounted for by a named outcome (§2.4)',
      accounted, 'handed=' + j(bake.handed) + ' painted=' + j(bake.painted) +
      ' unplaced=' + j(bake.unplaced) + ' outOfRange=' + j(bake.outOfRange));
  } else {
    check('U14 painted + unplaced + outOfRange === handed (§2.4)', false, 'no bake ledger');
  }

  /* §3.7 toast column. Gradeable because a toast element exists; the direction
     that matters most is the negative one — §7.2 is explicit that a product
     which shouts equally at everything trains the user to ignore the one that
     matters, and that this is not a lesser failure than a false claim.
     Only a REDACTION toast counts: #fs-toast is a shared element and on a tall
     capture it carries "this capture is too tall to paste". Counting that as
     a redaction warning would have produced a red check with no defect behind
     it — and, worse, would have hidden the real question, which is what
     happens when the two want the element at the same time (see the report). */
  const toastIsRedaction = !!surfaces.toastShown &&
    Object.values(ANCHOR).some(re => re.test(surfaces.toastText || ''));
  const toastNote = surfaces.toastShown
    ? (toastIsRedaction ? 'redaction toast shown (' + surfaces.toastSig + ')'
        : 'a NON-redaction toast is occupying the element: "' + String(surfaces.toastText).slice(0, 90) + '"')
    : 'no toast shown';
  if (state && TOAST_FOR[state] !== undefined) {
    check('U15 §3.7 toast column: ' + (TOAST_FOR[state] ? 'toast' : 'NO toast') + ' for "' + state + '"',
      toastIsRedaction === TOAST_FOR[state], toastNote);
  } else if (state === 'incomplete') {
    const sev = l && l.severity;
    if (sev === 'exposed' || sev === 'unread') {
      check('U15 §2.6 severity "' + sev + '" -> ' + (sev === 'exposed' ? 'toast' : 'NO toast') +
            ' (proportionate alarm is a safety property, §2.6)',
        toastIsRedaction === (sev === 'exposed'), toastNote);
    } else {
      check('U15 `incomplete` carries a severity of exposed|unread (§2.6)', false, 'severity=' + j(sev));
    }
  }
  if (surfaces.toastShown && !toastIsRedaction && TOAST_FOR[state] !== false) {
    open('U15b an unrelated toast is holding the shared toast element',
      'state "' + state + '" wants a redaction toast and ' + surfaces.toastSig + ' is showing: "' +
      String(surfaces.toastText).slice(0, 90) + '" — one shared slot, two messages');
  }
  if (!surfaces.hasLineHook) {
    check('U16 the result page exposes a permanent redaction line element (§3.9.2)', false,
      'none of [data-fs-redaction-line], #redactLine, .redactline matched; found: ' +
      ((surfaces.smells || []).slice(0, 3).map(s => s.sel).join(' | ') || 'nothing'));
  } else {
    open('U16 the permanent-line hook is an implementation choice, not a spec contract',
      'matched ' + surfaces.lineSig + ' — §3.7 puts the sentence KEYS under the amendment rule but ' +
      'names no DOM hook, so e2e and a11y-sim can drift onto different elements. See the report.');
  }

  /* E16 / §3.3 — the magnitude of the $CHARS$ understatement, printed rather
     than argued. `fsOwnLeafText` returns '' for any element with an element
     child, so a <p> containing one <a> contributes none of its own text. */
  if (opts.truth && num(scan && scan.chars) !== undefined && opts.truth.innerTextLen) {
    /* innerText is itself skipped inside content-visibility subtrees, so it can
       UNDERcount; textContent overcounts by including script/style. Both are
       printed rather than one being called the truth. */
    open('E16 $CHARS$ vs the page\'s own text (§3.3, E16)',
      scan.chars + ' fed / innerText ' + opts.truth.innerTextLen +
      ' / textContent ' + opts.truth.textContentLen +
      ' = ' + Math.round(100 * scan.chars / opts.truth.innerTextLen) + '% of innerText');
  }

  results.census.push({ fixture: opts.name, state: String(state), pixels: String(pixels) });
  /* Printed on every fixture, always. The last attempt computed a counter,
     read it into a local, and dropped it: "a counter nobody can see is a
     counter nobody can check" (§3.9). That applies to the suite too. */
  note('raw shot.redaction: ' + JSON.stringify(l).slice(0, 500));
  if (scan || bake) {
    note('ledger: state=' + state + ' pixels=' + pixels +
      '  fed=' + j(scan && scan.fed) + ' chars=' + j(scan && scan.chars) +
      ' placed=' + j(scan && scan.placed) + ' matched=' + j(scan && scan.matched) +
      ' boxes=' + j(scan && scan.boxes) + ' bfu=' + j(scan && scan.boxesFromUnplaced));
    note('        unplaced=' + JSON.stringify(scan && scan.unplaced) +
      ' declined=' + JSON.stringify(scan && scan.declined) +
      ' truncated=' + JSON.stringify(scan && scan.truncated) +
      ' frames=' + JSON.stringify(scan && scan.frames));
    note('        bake: handed=' + j(bake && bake.handed) + ' painted=' + j(bake && bake.painted) +
      ' verified=' + j(bake && bake.verified) + ' unplaced=' + j(bake && bake.unplaced) +
      ' outOfRange=' + j(bake && bake.outOfRange) + ' verifyFailed=' + j(bake && bake.verifyFailed) +
      ' verifySkipped=' + j(bake && bake.verifySkipped) + ' modeSkipped=' + j(bake && bake.modeSkipped));
  }
}
const j = v => v === undefined ? '·' : JSON.stringify(v);

/* the negative every attack fixture shares: a page whose sensitive text is in
   the picture and was not read must not reach the strongest wording. */
function mustNotReassure(rec, why) {
  const state = stateOf(rec), pixels = pixelsOf(rec);
  check('X   not a positive claim over unread PII that is in the image  (' + why + ')',
    !(pixels === 'baked' && state === 'read-no-match'),
    state + ' -> ' + pixels);
}

/* ================= the corpus ================= */

const FIXTURES = [];
const fixture = (name, spec, url, colours, fn, opts) =>
  FIXTURES.push({ name, spec, url: url || (BASE + name + '.html'), colours: colours || {}, fn, opts: opts || {} });

/* ---- E1 — sr-only / aria-label on an otherwise textless page ---- */
fixture('sr-only', 'SPEC E1 / §4.4', null, { block: C.block, bottom: C.bottom }, (rec, sx, pix) => {
  const scan = S(rec), bake = B(rec) || {};
  check('E1a some string was handed to the detector (§3.4 — fed need not be 0)',
    num(scan && scan.chars) > 0, 'chars=' + j(scan && scan.chars));
  check('E1b placed === 0 — a 1×1 rect cannot hold a 16px font (§2.2 clause 4)',
    scan && scan.placed === 0, 'placed=' + j(scan && scan.placed));
  check('E1c boxes === 0 — §2.2 requires clauses 4-6 on the BOX PATH TOO: "a precondition that ' +
        'gates only the negative claim is two different preconditions wearing one name"',
    scan && scan.boxes === 0, 'boxes=' + j(scan && scan.boxes) +
    ' boxesFromUnplaced=' + j(scan && scan.boxesFromUnplaced));
  check('E1d state === no-coverable-text (§6.3 E1, named explicitly; §3.4)',
    stateOf(rec) === 'no-coverable-text', String(stateOf(rec)));
  check('E1e pixels === unknown — the text surfaces are masked (§3.7)', pixelsOf(rec) === 'unknown', String(pixelsOf(rec)));
  check('E1f nothing in the record names a hiding technique (§4.4)',
    !/sr-?only|clip\s*:\s*rect|aria-label/i.test(JSON.stringify(L(rec) || {})));
  check('E1g nothing is painted on a page with no coverable text — a block placed at an sr-only ' +
        'leaf\'s rect lands on unrelated visible content',
    bake.painted === 0 && pix.rows.block < 5,
    'painted=' + j(bake.painted) + ' black rows in the PNG=' + pix.rows.block);
});

/* ---- E2a — canvas-painted glyphs, no DOM text at all ---- */
fixture('canvas-pii', 'SPEC E2 / §5.2', null,
  { email: C.email, card: C.card, phone: C.phone, block: C.block, bottom: C.bottom },
  (rec, sx, pix) => {
    const scan = S(rec);
    check('E2a placed === 0 — nothing the walk can read occupies space (§3.4)',
      scan && scan.placed === 0, 'placed=' + j(scan && scan.placed));
    check('E2b matched === 0', scan && scan.matched === 0, 'matched=' + j(scan && scan.matched));
    check('E2c state === no-coverable-text', stateOf(rec) === 'no-coverable-text', String(stateOf(rec)));
    check('E2d pixels === unknown', pixelsOf(rec) === 'unknown', String(pixelsOf(rec)));
    check('E2e the canvas PII is genuinely in the delivered image (fixture sanity)',
      pix.rows.email > 40 && pix.rows.card > 40, 'email ' + pix.rows.email + ' / card ' + pix.rows.card + ' rows');
    check('E2f nothing was painted over it and the record does not pretend otherwise',
      (B(rec) || {}).painted === 0, 'painted=' + j((B(rec) || {}).painted));
    mustNotReassure(rec, 'canvas application');
  });

/* ---- E2b — inline <style>/<script> ARE the page's only strings ---- */
fixture('inline-code', 'SPEC E2 / §4.3', null, { bottom: C.bottom }, (rec) => {
  const scan = S(rec);
  check('E3a placed === 0 — display:none gives a 0×0 rect, clause 2 (§4.3)',
    scan && scan.placed === 0, 'placed=' + j(scan && scan.placed));
  check('E3b matched === 0 — the script SOURCE holds an email and a Luhn-valid card; ' +
        'a match here is the counter reading source code and calling it page text (§4.3)',
    scan && scan.matched === 0, 'matched=' + j(scan && scan.matched));
  check('E3c state === no-coverable-text', stateOf(rec) === 'no-coverable-text', String(stateOf(rec)));
  check('E3d no tag list is load-bearing: the record names no element type (§4.3)',
    !/script|style|FS_NON_TEXT/i.test(JSON.stringify(L(rec) || {})));
  open('E3e how many strings reached the detector (fed)', 'fed=' + j(scan && scan.fed) +
    ' — §4.3 predicts 2; a 0 means FS_NON_TEXT_TAGS still filters first, which §4.3 permits as a cost saving');
});

/* ---- E3 — text/plain, Chrome's synthetic <pre> ---- */
fixture('plaintext-long', 'SPEC E3 / §4.5', BASE + 'plaintext-long.txt', { bottom: C.bottom }, (rec) => {
  const scan = S(rec), st = stateOf(rec);
  const dTooLong = num(scan && scan.declined && scan.declined.tooLong);
  /* Two spec passages disagree about this fixture and both are honoured:
     §4.5/E3 says the 11,695-char <pre> is refused -> declined.tooLong -> incomplete.
     §7.2 change 2 says chunk it in v1 -> no decline -> the email is found and covered.
     Either is defensible. `read-no-match` is not, under either. */
  const refused = st === 'incomplete' && dTooLong > 0;
  const chunked = dTooLong === 0 && (num(scan && scan.matched) > 0) &&
                  (st === 'blocks-painted' || st === 'incomplete');
  check('E4a refused (§4.5: declined.tooLong>0 -> incomplete) OR chunked (§7.2.2: matched>0)',
    refused || chunked, 'state=' + st + ' declined.tooLong=' + j(dTooLong) + ' matched=' + j(scan && scan.matched));
  check('E4b state is NOT read-no-match (§6.3 E3, explicit)', st !== 'read-no-match', String(st));
  check('E4c a browser-synthesised tree still produces a sealed ledger (§6.3, second reason)',
    !!scan && scan.sealed === true, 'sealed=' + j(scan && scan.sealed));
});
fixture('plaintext-short', 'SPEC E3 control', BASE + 'plaintext-short.txt', { block: C.block }, (rec) => {
  const scan = S(rec), st = stateOf(rec);
  check('E4d the same document type UNDER the leaf cap is scanned, not refused ' +
        '— so E4a cannot be blamed on text/plain itself',
    num(scan && scan.chars) > 0 && (scan.declined ? !(scan.declined.tooLong > 0) : false),
    'chars=' + j(scan && scan.chars) + ' declined=' + JSON.stringify(scan && scan.declined));
  check('E4e the one address in it was found and covered', st === 'blocks-painted', String(st));
});

/* ---- E4 — past the 2000-box ceiling ---- */
fixture('ceiling', 'SPEC E4 / §4.5', null, { email: C.email, block: C.block, bottom: C.bottom }, (rec, sx, pix) => {
  const scan = S(rec), bake = B(rec);
  check('E5a truncated.ceiling is set (§2.1 — forEachDeep reports its stop reason)',
    !!(scan && scan.truncated && scan.truncated.ceiling === true),
    JSON.stringify(scan && scan.truncated));
  check('E5b declined.ceiling > 0 — counted at the refusal (§2.1/§4.5)',
    num(scan && scan.declined && scan.declined.ceiling) > 0,
    JSON.stringify(scan && scan.declined));
  check('E5c state === incomplete (§4.5 — partial protection reported as partial)',
    stateOf(rec) === 'incomplete', String(stateOf(rec)));
  check('E5d pixels === unknown', pixelsOf(rec) === 'unknown', String(pixelsOf(rec)));
  check('E5e the boxes that WERE emitted are still opaque in the delivered PNG (§4.5)',
    pix.rows.block > 200, pix.rows.block + ' block rows');
  check('E5f and the rows past the ceiling are still visible — the partial protection is real, ' +
        'and so is the shortfall', pix.rows.email > 50, pix.rows.email + ' unredacted rows');
  open('E5g how far it got', 'boxes=' + j(scan && scan.boxes) + ' painted=' + j(bake && bake.painted) +
    ' verified=' + j(bake && bake.verified) +
    ' — §7.6 asks that truncated.walk carry how far it got so the sentence can say "read the first N spans"');
});

/* ---- shadow DOM ---- */
fixture('shadow-open', 'task shape / §7.1 A+I', null,
  { email: C.email, phone: C.phone, block: C.block, bottom: C.bottom }, (rec, sx, pix) => {
    const scan = S(rec);
    check('S1a the shadow content reached the delivered image, covered or not (fixture sanity)',
      (pix.rows.email + pix.rows.phone + pix.rows.block) > VISIBLE,
      'email ' + pix.rows.email + ' / phone ' + pix.rows.phone + ' / block ' + pix.rows.block + ' rows');
    check('S1b the light-DOM nav supplies placed text, so the shell alone could carry a claim (setup)',
      num(scan && scan.placed) > 0, 'placed=' + j(scan && scan.placed));
    /* An OPEN shadow root is reachable — host.shadowRoot is right there. That
       makes it §7.1 A's family ("not a limit — an unwalked, reachable
       surface"), not §5.4's. A positive claim carried by the nav bar over an
       unwalked reachable surface is the fifth-fix bug in a new wrapper. */
    check('S1c a reachable, unwalked surface must not be covered by the shell\'s claim (§7.1 A)',
      !(pixelsOf(rec) === 'baked' && stateOf(rec) === 'read-no-match' && pix.rows.email > VISIBLE),
      stateOf(rec) + ' -> ' + pixelsOf(rec) + ', email rows in PNG: ' + pix.rows.email);
    /* Empirically the walk DOES descend into open shadow roots, so this
       fixture also grades the artifact: if the claim is positive, the address
       must actually be gone from the picture. */
    check('S1d if the state is positive, the shadow address is covered in the delivered PNG (§2.5/E6)',
      pixelsOf(rec) !== 'baked' || (pix.rows.email < COVERED && pix.rows.phone < COVERED),
      'email ' + pix.rows.email + ' / phone ' + pix.rows.phone + ' rows, state=' + stateOf(rec));
    open('S1e the spec names no ledger counter for shadow doors',
      '§2.1 has frames{sameOrigin,scanned,crossOrigin} for iframes only; §5.4 says shadowRoot===null is countable ' +
      'but gives it no field. Observed state: ' + stateOf(rec));
  });
fixture('shadow-closed', 'SPEC §7.1 I / §5.4', null,
  { email: C.email, card: C.card, block: C.block, bottom: C.bottom }, (rec, sx, pix) => {
    check('S2a the closed-root PII is in the delivered image and nothing covered it (fixture sanity)',
      pix.rows.email > VISIBLE && pix.rows.card > VISIBLE,
      'email ' + pix.rows.email + ' / card ' + pix.rows.card + ' rows');
    check('S2b a genuinely unreachable surface must not be covered by the shell\'s claim (§5.4/§7.1 I)',
      !(pixelsOf(rec) === 'baked' && stateOf(rec) === 'read-no-match' && pix.rows.email > VISIBLE),
      stateOf(rec) + ' -> ' + pixelsOf(rec));
    open('S2c §5.4 says you can always count the doors; there is no counter for this door',
      'observed state: ' + stateOf(rec) + ' — the same question as S1d');
  });

/* ---- E12 — same-origin iframe: "the worst of the set" ---- */
fixture('iframe-host', 'SPEC E12 / §7.1 A', null,
  { email: C.email, phone: C.phone, card: C.card, block: C.block, frame: C.frame, bottom: C.bottom },
  (rec, sx, pix) => {
    const scan = S(rec), st = stateOf(rec);
    check('E12a the pipeline grew the frame to full content height, so its rows are certainly in the ' +
          'image (capture.js:531, fixture sanity)',
      pix.rows.frame > 100, pix.rows.frame + ' rows of the frame-bottom band');
    check('E12b frames.sameOrigin counts the door (§2.1/§5.4)',
      num(scan && scan.frames && scan.frames.sameOrigin) >= 1,
      JSON.stringify(scan && scan.frames));
    const f = (scan && scan.frames) || {};
    const walked = num(f.scanned) >= num(f.sameOrigin) && num(f.sameOrigin) >= 1;
    check('E12c EITHER the walk descends and the address is covered, OR frames.sameOrigin > scanned ' +
          'breaks scanOk -> incomplete (§5.4, verbatim)',
      (walked && st === 'blocks-painted' && pix.rows.email < COVERED) || (!walked && st === 'incomplete'),
      'state=' + st + ' frames=' + JSON.stringify(f) + ' email rows=' + pix.rows.email);
    check('E12d NOT read-no-match/baked with the address visible — that is the fifth-fix bug ' +
          'reproduced against the new design (§6.3 E12)',
      !(st === 'read-no-match' && pixelsOf(rec) === 'baked' && pix.rows.email > VISIBLE),
      st + ' -> ' + pixelsOf(rec) + ', email rows: ' + pix.rows.email);
  });

/* ---- §7.1 F — CSS generated content ---- */
fixture('before-content', 'SPEC §7.1 F / E15', null,
  { email: C.email, card: C.card, phone: C.phone, bottom: C.bottom }, (rec, sx, pix) => {
    const scan = S(rec);
    check('G1a the generated PII is in the delivered image (fixture sanity)',
      pix.rows.email > 30 && pix.rows.card > 30, 'email ' + pix.rows.email + ' / card ' + pix.rows.card);
    check('G1b ::before content is not in textContent, so fed === 0 (§7.1 F)',
      scan && scan.fed === 0, 'fed=' + j(scan && scan.fed));
    check('G1c read-no-match requires fed > 0, so this page cannot reach it (§3.3)',
      stateOf(rec) !== 'read-no-match', String(stateOf(rec)));
    check('G1d state === no-coverable-text (§3.4 — placed 0, boxes 0)',
      stateOf(rec) === 'no-coverable-text', String(stateOf(rec)));
    check('G1e pixels === unknown', pixelsOf(rec) === 'unknown', String(pixelsOf(rec)));
  });

/* ---- §7.1 H — SVG <text>, whole and fragmented ---- */
fixture('svg-text', 'SPEC §5.1 / §7.1 H', null,
  { email: C.email, card: C.card, block: C.block, bottom: C.bottom }, (rec, sx, pix) => {
    const scan = S(rec), st = stateOf(rec);
    check('V1a the whole <text> address was fed and matched (SVG text is a childless element with text)',
      num(scan && scan.matched) >= 1, 'matched=' + j(scan && scan.matched));
    check('V1b a match must never land in read-no-match (§2.6 ladder)',
      !(num(scan && scan.matched) > 0 && st === 'read-no-match'), 'state=' + st);
    check('V1c the matched address is covered in the delivered PNG (grade the artifact, §2.5/E6)',
      pix.rows.email < COVERED, pix.rows.email + ' rows of the email band still showing');
    check('V1d if the claim is positive it still carries the §3.2 caveat',
      pixelsOf(rec) !== 'baked' || /drawn as a picture was not read/i.test(sx.bodyText || ''));
    open('V1e the tspan-split card is a standing limit, not a page shape (§5.1/§7.1 H)',
      'card plate rows still visible in the PNG: ' + pix.rows.card +
      ' — the number is never seen whole by the detector; §5.1 must name arrangements, not only kinds');
  });

/* ---- §7.1 E — input values, placeholders, chosen option ---- */
fixture('input-values', 'SPEC §7.1 E / E15', null,
  { email: C.email, phone: C.phone, card: C.card, bottom: C.bottom }, (rec, sx, pix) => {
    const scan = S(rec);
    check('F1a the form PII is in the delivered image (fixture sanity)',
      pix.rows.email > 30 && pix.rows.card > 30, 'email ' + pix.rows.email + ' / card ' + pix.rows.card);
    check('F1b attributes and form values are never read, so placed === 0 (§7.1 E)',
      scan && scan.placed === 0, 'placed=' + j(scan && scan.placed) + ' fed=' + j(scan && scan.fed));
    check('F1c pixels === unknown — "a form holding an account number is the canonical redaction target"',
      pixelsOf(rec) === 'unknown', String(pixelsOf(rec)));
    check('F1d nothing was covered and the record does not pretend otherwise',
      (B(rec) || {}).painted === 0, 'painted=' + j((B(rec) || {}).painted));
    mustNotReassure(rec, 'form values');
    /* §3.4's arm is `scanOk ∧ placed === 0 ∧ boxes === 0`, which this page
       satisfies — yet the closed <option> DOES hold a match that the select
       renders into the picture, so `incomplete`/`exposed` is the more honest
       answer. Both are defensible and the spec picks the first. Recorded
       rather than graded: forcing the product to loosen so a test can go
       green is how the previous five fixes were arrived at. */
    open('F1e §3.4 admits this page as `no-coverable-text`; the engine returns "' + stateOf(rec) + '"',
      'placed=' + j(S(rec) && S(rec).placed) + ' boxes=' + j(S(rec) && S(rec).boxes) +
      ' matched=' + j(S(rec) && S(rec).matched) +
      ' — a match inside a 0×0 <option> that the <select> paints into the image is not "no coverable text". ' +
      'Which arm does §3.4 mean? See the report.');
  });

/* ---- E13 — ancestor clip and ancestor opacity ---- */
fixture('clipped-ancestor', 'SPEC E13 / §7.1 B+C', null,
  { email: C.email, phone: C.phone, block: C.block, bottom: C.bottom }, (rec, sx, pix) => {
    const scan = S(rec), u = (scan && scan.unplaced) || {};
    check('E13a the collapsed accordion is unplaced.clipped — clause 4 alone counts it as placed, ' +
          'because a leaf\'s own rect ignores ancestor clipping (§2.2 clause 5)',
      num(u.clipped) >= 1, 'unplaced=' + JSON.stringify(u));
    check('E13b the opacity:0 block is unplaced.faded — computed visibility is still "visible" (§2.2 clause 6)',
      num(u.faded) >= 1, 'unplaced=' + JSON.stringify(u));
    check('E13c the visible prose IS placed — the clauses must not refuse everything',
      num(scan && scan.placed) >= 1, 'placed=' + j(scan && scan.placed));
    check('E13d both hidden blocks matched — the detector did read them (setup)',
      num(scan && scan.matched) >= 2, 'matched=' + j(scan && scan.matched));
    check('E13e boxesFromUnplaced fires — the counter §2.6 requires to be 0 for `blocks-painted` ' +
          'must be able to be non-zero, or it is decoration (§1.1 q3)',
      num(scan && scan.boxesFromUnplaced) >= 1, 'bfu=' + j(scan && scan.boxesFromUnplaced));
    check('E13f the box path refuses those matches, so boxes === 0 and nothing is painted (§2.2) — ' +
          'a block at a clipped leaf\'s full-size rect lands on visible content that has nothing to ' +
          'do with the match',
      scan && scan.boxes === 0 && (B(rec) || {}).painted === 0 && pix.rows.block < 5,
      'boxes=' + j(scan && scan.boxes) + ' painted=' + j((B(rec) || {}).painted) +
      ' black rows in the PNG=' + pix.rows.block);
    check('E13g state is not blocks-painted (§2.6/§7.3)', stateOf(rec) !== 'blocks-painted', String(stateOf(rec)));
    check('E13h pixels === unknown', pixelsOf(rec) === 'unknown', String(pixelsOf(rec)));
    open('E13i which state the §2.6 ladder actually produces here',
      'observed ' + stateOf(rec) + '. scanOk and bakeOk can both hold (nothing declined, nothing truncated, ' +
      'boxes 0) while matched > 0 and placed > 0, so no positive arm admits it and it lands in `incomplete` — ' +
      'whose §3.5 English ("could not finish checking this page") does not describe what happened. See the report.');
  });

/* ---- E14 — content-visibility: auto ---- */
fixture('contentvis', 'SPEC E14 / §7.1 D', null,
  { cvsecret: C.cvsecret, email: C.email, block: C.block, bottom: C.bottom }, (rec, sx, pix) => {
    const scan = S(rec), st = stateOf(rec), u = (scan && scan.unplaced) || {};
    check('E14a the off-screen section rendered into the picture (fixture sanity)',
      pix.rows.cvsecret > 100, 'secret section ' + pix.rows.cvsecret + ' rows');
    const covered = pix.rows.email < COVERED;
    /* Two branches, because which one a real engine takes depends on whether
       the pre-scroll passes left the subtree laid out. Both are honest; the
       one that is not is `read-no-match`/baked over an uncovered address. */
    const deferred = num(u.degenerate) >= 1 && num(scan && scan.lateMatched) > 0 && st === 'incomplete';
    const scannedNow = num(scan && scan.matched) >= 1 && st === 'blocks-painted' && covered;
    check('E14b EITHER the subtree was skipped at scan time and §2.3(b) caught it ' +
          '(unplaced.degenerate ≥ 1, lateMatched > 0, incomplete) OR it was laid out and the address ' +
          'was covered (§2.3b / §7.1 D)',
      deferred || scannedNow,
      'state=' + st + ' unplaced=' + JSON.stringify(u) + ' matched=' + j(scan && scan.matched) +
      ' lateMatched=' + j(scan && scan.lateMatched) + ' email rows=' + pix.rows.email);
    check('E14c NOT read-no-match', st !== 'read-no-match', String(st));
    check('E14d NOT baked over an address that is still legible in the delivered PNG — this is what ' +
          '§2.3(b) exists to prevent',
      !(pixelsOf(rec) === 'baked' && !covered),
      pixelsOf(rec) + ', email rows=' + pix.rows.email);
    open('E14e which branch this Chromium took',
      deferred ? 'deferred — the subtree was unlaid-out at scan time' :
      (num(scan && scan.matched) >= 1 ? 'laid out at scan time — the pre-scroll passes had already ' +
        'rendered it, so E14\'s premise did not reproduce here' : 'neither'));
  });

/* ---- text injected after the scan ---- */
fixture('late-inject', 'task shape / §2.3', null,
  { lateins: C.lateins, lateswap: C.lateswap, block: C.block, bottom: C.bottom }, (rec, sx, pix, truth) => {
    const scan = S(rec), st = stateOf(rec);
    const F = (truth && truth.fixture) || {};
    note('fixture timings: captureSeenAt=' + F.captureSeenAt + 'ms firstAppliedAt=' + F.firstAppliedAt +
      'ms applyCount=' + F.applyCount + '  presentAtEnd swap=' + F.swapPresentAtEnd +
      ' insert=' + F.insertPresentAtEnd);
    check('L1a the fixture acted during the capture and held the change (setup — a mistimed fixture ' +
          'proves nothing, and a one-shot change is a coin flip)',
      F.captureSeenAt != null && F.firstAppliedAt != null && F.applyCount > 3,
      JSON.stringify(F));
    check('L1a2 the change landed AFTER the scan, not before it — if it had beaten collectPIIBoxes ' +
          'the card would have matched (independent of the fixture\'s own clock)',
      num(scan && scan.matched) === 0, 'matched=' + j(scan && scan.matched));
    /* #swap only turns cyan at the instant its text is replaced, so the colour
       appearing in the PNG proves the POST-SCAN state was captured — not just
       that the row existed. */
    const inPicture = pix.rows.lateins > 30 || pix.rows.lateswap > 30;
    check('L1b the post-scan state of at least one late block is in the delivered image (setup)',
      inPicture, 'insert ' + pix.rows.lateins + ' / swap ' + pix.rows.lateswap + ' rows');
    /* Graded: whichever way the design lands it, the §3.3 wording discipline
       still applies. That is the only protection the spec offers this shape. */
    check('L1c if the claim is read-no-match the sentence reports the act, never a verdict (§3.3)',
      st !== 'read-no-match' || /matched none of the five patterns it looks for/i.test(sx.bodyText || ''));
    open('L1d §2.3 covers neither mechanism on this page',
      'state=' + st + ' pixels=' + pixelsOf(rec) +
      ' movedUncovered=' + j(scan && scan.movedUncovered) +
      ' lateTextPlaced=' + j(scan && scan.lateTextPlaced) +
      ' lateMatched=' + j(scan && scan.lateMatched) +
      ' — §2.3(a) re-measures MATCHED spans (the swap span did not match at scan time); ' +
      '§2.3(b) re-measures spans unplaced for `degenerate` (the swap span was placed; the inserted node ' +
      'was not a span at all). See the report.');
  });

/* ---- the two controls ---- */
fixture('control-pii', 'SPEC §3.2 / E6 — HONEST CONTROL', null,
  { email: C.email, phone: C.phone, card: C.card, decoy: C.decoy, block: C.block, bottom: C.bottom },
  (rec, sx, pix) => {
    const scan = S(rec), bake = B(rec) || {};
    check('H1a state === blocks-painted (§3.2)', stateOf(rec) === 'blocks-painted', String(stateOf(rec)));
    check('H1b pixels === baked (§3.7)', pixelsOf(rec) === 'baked', String(pixelsOf(rec)));
    check('H1c painted > 0 and handed === scan.boxes (§2.6 bakeOk)',
      num(bake.painted) > 0 && bake.handed === (scan && scan.boxes),
      'handed=' + j(bake.handed) + ' painted=' + j(bake.painted) + ' boxes=' + j(scan && scan.boxes));
    check('H1d verified === painted, verifyFailed === 0, verifySkipped === 0 — the read-back the bake ' +
          'has never had (§2.5)',
      bake.verified === bake.painted && bake.verifyFailed === 0 && bake.verifySkipped === 0,
      'verified=' + j(bake.verified) + ' failed=' + j(bake.verifyFailed) + ' skipped=' + j(bake.verifySkipped));
    check('H1e bake.unplaced === 0 and outOfRange === 0 (§2.4)',
      bake.unplaced === 0 && bake.outOfRange === 0,
      'unplaced=' + j(bake.unplaced) + ' outOfRange=' + j(bake.outOfRange));
    check('H1f boxesFromUnplaced === 0 (§2.6)', scan && scan.boxesFromUnplaced === 0, j(scan && scan.boxesFromUnplaced));
    /* E6 — grade the artifact, not the log */
    check('H1g email band gone from the delivered PNG', pix.rows.email < COVERED, pix.rows.email + ' rows');
    check('H1h phone band gone from the delivered PNG', pix.rows.phone < COVERED, pix.rows.phone + ' rows');
    check('H1i card band gone from the delivered PNG', pix.rows.card < COVERED, pix.rows.card + ' rows');
    check('H1j three painted blocks present in the delivered PNG', pix.rows.block >= 60, pix.rows.block + ' rows');
    check('H1k the Luhn-invalid decoy is untouched — over-masking is safe but it is not free',
      pix.rows.decoy > VISIBLE, pix.rows.decoy + ' rows');
    check('H1l the sentence carries the §3.2 caveat on the strongest state, where the user\'s guard is lowest',
      /drawn as a picture was not read/i.test(sx.bodyText || ''));
  });

fixture('control-clean', 'SPEC E8 — CLEAN CONTROL', null,
  { bottom: C.bottom, block: C.block }, (rec, sx, pix, truth) => {
    const scan = S(rec), bake = B(rec) || {};
    check('C1a state === read-no-match (§3.3 — "the honest common case, and it must stay useful")',
      stateOf(rec) === 'read-no-match', String(stateOf(rec)));
    check('C1b pixels === baked (§3.3 — baked means the pass ran, not that it found something)',
      pixelsOf(rec) === 'baked', String(pixelsOf(rec)));
    check('C1c chars > 1000 (§6.3 E8)', num(scan && scan.chars) > 1000, 'chars=' + j(scan && scan.chars));
    check('C1d matched === 0, boxes === 0, handed === 0',
      scan && scan.matched === 0 && scan.boxes === 0 && bake.handed === 0,
      'matched=' + j(scan && scan.matched) + ' boxes=' + j(scan && scan.boxes) + ' handed=' + j(bake.handed));
    check('C1e placed > 0', num(scan && scan.placed) > 0, 'placed=' + j(scan && scan.placed));
    check('C1f unplaced.total === 0 on a page built to have no blind spot — selects the unqualified ' +
          'wording in §3.3',
      totalOf(scan && scan.unplaced) === 0, 'unplaced=' + JSON.stringify(scan && scan.unplaced));
    check('C1g nothing declined, nothing truncated (§2.6 scanOk)',
      totalOf(scan && scan.declined) === 0 &&
      !!(scan && scan.truncated) && !scan.truncated.walk && !scan.truncated.time && !scan.truncated.ceiling,
      'declined=' + JSON.stringify(scan && scan.declined) + ' truncated=' + JSON.stringify(scan && scan.truncated));
    check('C1h the rendered sentence contains the character count (§3.3 — the numbers are not decoration)',
      num(scan && scan.chars) !== undefined &&
      (new RegExp('\\b' + String(scan.chars) + '\\b').test(sx.bodyText || '') ||
       new RegExp('\\b' + Number(scan.chars).toLocaleString('en-US') + '\\b').test(sx.bodyText || '')),
      'chars=' + j(scan && scan.chars));
    check('C1i the unqualified wording, not the blind-spot wording (§3.3)',
      !/further spans/i.test(sx.bodyText || ''));
    check('C1j no warning language on a clean article — a warning nobody reads protects nobody (§7.2)',
      !/may still be visible|treat the image as unredacted|hid nothing|could not finish/i.test(sx.bodyText || ''));
    if (truth) {
      open('C1l E16 magnitude on the most ordinary markup there is',
        'scan.chars=' + j(scan && scan.chars) + ' vs visible innerText=' + truth.innerTextLen +
        ' — #leafrule is a <p> holding an <a>, so its own text nodes are never fed (§7.1 G)');
    }
  });

/* ================= runner ================= */

async function runCorpus(ctx, sw) {
  for (const F of FIXTURES) {
    if (ONLY.length && !ONLY.includes(F.name)) continue;
    begin(F.name, F.spec);
    let out;
    try {
      out = await capture(ctx, sw, F.name, F.url, F.colours, F.opts);
    } catch (e) {
      check('capture completed', false, String((e && e.message) || e));
      results.census.push({ fixture: F.name, state: 'CAPTURE-FAILED', pixels: '-' });
      continue;
    }
    note('image: ' + out.pix.width + '×' + out.pix.height + '  colours: ' + JSON.stringify(out.pix.rows));
    try {
      universals(out.rec, out.surfaces, { name: F.name, truth: out.truth });
      F.fn(out.rec, out.surfaces, out.pix, out.truth);
    } catch (e) {
      check('assertions ran to completion', false, String((e && e.message) || e));
    }
  }
}

/* E10 — the sentence rendered in a non-English UI locale. Key-free by
   construction: the same fixture is captured twice and the German line is
   located by the host signature the English line occupied. */
async function runLocalePass(TEST_EXT, enBlocks) {
  begin('locale-de', 'SPEC E10 / §6.2');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullshot-claim-de-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: !process.env.HEADFUL,
    viewport: { width: 1280, height: 800 },
    locale: 'de-DE',
    args: ['--lang=de', '--disable-extensions-except=' + TEST_EXT, '--load-extension=' + TEST_EXT]
  });
  try {
    await ctx.addInitScript(MUTATION_PROBE);
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
    await setSettings(sw, { redactPII: true });
    const out = await capture(ctx, sw, 'locale-de', BASE + 'control-clean.html', {}, {});
    const deBody = out.surfaces.bodyText || '';
    const enBody = (enBlocks || []).map(b => b.text).join(' ');

    check('E10a the result page renders under a non-English UI locale',
      deBody.length > 20, deBody.length + ' chars');
    check('E10b no bare message key or __MSG_ token leaked into the rendered page',
      !/__MSG_|\bresultRedact[A-Za-z0-9]*\b/.test(deBody), deBody.slice(0, 160));
    check('E10c the redaction line is not missing: a §3.x sentence is rendered in SOME language',
      Object.values(ANCHOR).some(re => re.test(deBody)) || deBody.length > 40,
      deBody.slice(0, 200));

    /* Whether the sentence is actually translated is NOT graded. §6.2: the
       38-locale translation-memory gap is an open owner decision and
       make-locales.mjs's guard is right to refuse a build. A German line that
       is still English is expected here, not a defect. */
    const stillEnglish = Object.values(ANCHOR).some(re => re.test(deBody));
    let inFile = null;
    try {
      const msgs = JSON.parse(fs.readFileSync(path.join(EXT_DIR, '_locales', 'de', 'messages.json'), 'utf8'));
      inFile = Object.values(msgs).filter(m => m && typeof m.message === 'string' && m.message.length > 30)
        .some(m => {
          const re = new RegExp(m.message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\\\$[A-Z0-9_]+\\\$/g, '[\\s\\S]{0,120}'), 'i');
          return re.test(deBody);
        });
    } catch (_) { inFile = null; }
    open('E10d the de render still shows the English §3.x sentence',
      String(stillEnglish) + ' — expected while the translation-memory gap is open (§6.2)');
    open('E10e some long de message from _locales/de/messages.json appears in the render',
      inFile === null ? 'could not read/parse the de locale file' : String(inFile));
    open('E10f en vs de body length', enBody.length + ' vs ' + deBody.length);
  } catch (e) {
    check('locale pass completed', false, String((e && e.message) || e));
  } finally {
    await ctx.close();
  }
}

(async () => {
  const srv = await serve(EXT_DIR, PORT);
  const TEST_EXT = prepareTestExtension();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullshot-claim-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: !process.env.HEADFUL,
    viewport: { width: 1280, height: 800 },
    args: ['--disable-extensions-except=' + TEST_EXT, '--load-extension=' + TEST_EXT]
  });

  let cleanBlocks = null;
  try {
    await ctx.addInitScript(MUTATION_PROBE);
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
    check('extension service worker started', !!sw, sw && sw.url());

    /* The whole suite runs with the setting ON. §4.2: the setting selects the
       `off` arm and nothing else, so leaving it on for every fixture is the
       correct way to test that it cannot reach `baked` by itself. */
    await setSettings(sw, { redactPII: true });
    await runCorpus(ctx, sw);
  } catch (e) {
    check('run completed', false, String((e && e.message) || e));
  } finally {
    /* the profile is a throwaway mkdtemp, so there is nothing to restore */
    await ctx.close();
  }

  if (!ONLY.length || ONLY.includes('locale-de')) {
    /* re-capture the clean control in English purely to anchor the locale pass */
    try {
      const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'fullshot-claim-en-'));
      const ctx2 = await chromium.launchPersistentContext(udd, {
        channel: 'chromium', headless: !process.env.HEADFUL,
        viewport: { width: 1280, height: 800 },
        args: ['--lang=en-US', '--disable-extensions-except=' + TEST_EXT, '--load-extension=' + TEST_EXT]
      });
      await ctx2.addInitScript(MUTATION_PROBE);
      let [sw2] = ctx2.serviceWorkers();
      if (!sw2) sw2 = await ctx2.waitForEvent('serviceworker', { timeout: 20000 });
      await setSettings(sw2, { redactPII: true });
      const outEn = await capture(ctx2, sw2, 'locale-en', BASE + 'control-clean.html', {}, {});
      cleanBlocks = outEn.surfaces.blocks;
      await ctx2.close();
    } catch (_) { /* the locale pass reports its own missing anchor */ }
    await runLocalePass(TEST_EXT, cleanBlocks);
  }

  srv.close();

  /* ---- E11, the state census. §7.7 makes it a ship gate, not a report:
     "the only check that can catch 'correct and unusable'." ---- */
  console.log('\n=== E11  state census (§6.3 E11 — ship gate) ===');
  const dist = {};
  for (const r of results.census) dist[r.state] = (dist[r.state] || 0) + 1;
  for (const r of results.census) console.log('  ' + r.fixture.padEnd(20) + r.state + '  ->  ' + r.pixels);
  console.log('  ---');
  for (const k of Object.keys(dist).sort()) {
    console.log('  ' + k.padEnd(22) + dist[k] + '/' + results.census.length +
      '  (' + Math.round(100 * dist[k] / results.census.length) + '%)');
  }
  console.log('  NOTE: this corpus is adversarial by construction, so its distribution is a floor on the ' +
    'unproven states, not the §7.2 estimate. E11 also requires ~30 real pages.');

  if (results.opens.length) {
    console.log('\n=== OPEN — spec is silent or ambiguous; recorded, never graded ===');
    for (const o of results.opens) console.log('  ' + o);
  }
  if (results.fails.length) {
    console.log('\n=== FAILURES ===');
    for (const f of results.fails) console.log('  ' + f);
  }
  console.log('\n' + results.pass + ' pass, ' + results.fail + ' fail, ' + results.open + ' open');
  process.exit(results.fail ? 1 : 0);
})();
