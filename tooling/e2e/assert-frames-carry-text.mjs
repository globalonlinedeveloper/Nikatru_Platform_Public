#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-frames-carry-text.mjs — the frames the drive just produced have GLYPHS
// in them, measured, not assumed.
//
//   node tooling/e2e/assert-frames-carry-text.mjs <dir> [<dir> …]
//
// ── WHY IT EXISTS ───────────────────────────────────────────────────────────
// A staging step can be present and still stage the wrong thing, and a
// `flutter drive -d web-server` run whose fallback fonts never arrived EXITS 0:
// the dev server answers the missing `fallback-fonts/…` request with index.html
// (HTTP 200, text/html) rather than a 404, CanvasKit draws no Latin glyph, and
// the bundled MaterialIcons asset keeps rendering — so the artifact is
// iconography on blank rows and every other check in the lane is green. That is
// exactly the state the store listing was in from #567 to #854, and the only
// thing that catches it is a reading of the PIXELS.
//
// tooling/ci/test/web-drive-stages-fonts.test.mjs proves the STEP IS THERE.
// This proves THE TEXT ARRIVED.
//
// ── WHAT IT COMPARES ────────────────────────────────────────────────────────
// For every frame, `measureFrameInk` gives its ink fraction and the ink
// fraction of the SAME frame with its glyphs voted away by the 9×9 mode filter.
// Their difference is the frame's REMOVED ink. The verdict is on the RUN:
//
//     median over the run's frames of (measured − textlessControl)
//        >=  tooling/e2e-leg-register.json framesCarryText.minMedianRemovedInk
//
// 🔴 WHY THE RUN AND NOT EACH FRAME — MEASURED 2026-09-23. The first version
// compared each frame to itself (textless < measured × 0.7). Real frames of the
// live app captured the way this lane captures them (430x932, DPR 1), with the
// font requests answered 200 text/html, read a textless/measured RATIO of
// 0.135–0.922: at DPR 1 the filter also removes hairlines, field underlines,
// checkbox outlines and icon strokes, so most of the defect passed. Per frame,
// removed ink separates only 1.33x. Fonts that did not arrive, though, are
// missing from EVERY page at once, and the run medians sit 2.97x under and
// 2.95x over the floor. The full table is in the register block's `_why`.
//
// 🔴 ITS OWN THRESHOLD, NOT THE STORE ONE. The store block's 0.7
// (channel-register.json …inkFloor.minFractionOfMeasured) is how far a
// recapture of a recorded store frame may drift. Borrowing it made this guard
// fail a correct frame on origin/main. The two numbers answer different
// questions and now live in different registers.
//
// 🔴 ONE WIDTH. Removed ink is a fraction of pixels and falls roughly as 1/DPR,
// so the floor holds only at the width it was measured at. A frame of another
// width is COVERAGE LOST, never judged.
//
// 🔴 EXIT CODES. 0 green. 1 a finding — the run carries no text. 2 COVERAGE
// LOST: no directory, no frames, an undecodable frame, a frame at a width the
// floor was not measured at, a register that no longer carries the block or
// carries it against a different metric, or an ink metric that fails its own
// self-test. A run that could not look is not a run that found nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeRgba } from '../store/png-codec.mjs';
import { METRIC_ID, measureFrameInk, inkFixtureFrame } from '../store/frame-ink.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const REGISTER = 'tooling/e2e-leg-register.json';
const BLOCK = 'framesCarryText';

/** Could not do the duty. NEVER a pass, and never exit 1: a finding means the
 *  run was read and judged, and it was not. */
function coverageLost(lines) {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const line of lines.slice(1)) console.error(`  ${line}`);
  process.exit(2);
}

/** Removed ink of one decoded frame: what the glyph filter takes away. */
function removedInk(img) {
  const { measured, textlessControl } = measureFrameInk(img);
  return { measured, textlessControl, removed: Number((measured - textlessControl).toFixed(6)) };
}

/** The median of a non-empty list of numbers. */
function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Number(((s[mid - 1] + s[mid]) / 2).toFixed(6));
}

const dirs = process.argv.slice(2).filter((a) => !a.startsWith('--'));

if (dirs.length === 0) {
  coverageLost([
    'no directory given, so no frame was read.',
    'usage: node tooling/e2e/assert-frames-carry-text.mjs <dir-of-frames> [<dir> …]',
    'e.g.   node tooling/e2e/assert-frames-carry-text.mjs apps/subscriptiontracker/screenshots',
    'Exiting 0 here would certify a drive whose screenshots this never opened.',
  ]);
}

// ── the threshold, off the register ─────────────────────────────────────────
let register;
try {
  register = JSON.parse(readFileSync(join(ROOT, REGISTER), 'utf8'));
} catch (err) {
  coverageLost([
    `${REGISTER} could not be read or parsed: ${err.message}`,
    'The measured floor lives there and is deliberately not duplicated here, so without it this guard has',
    'no threshold to compare against and must not invent one.',
  ]);
}

const block = register?.[BLOCK];
if (!block || typeof block !== 'object') {
  coverageLost([
    `${REGISTER} no longer carries "${BLOCK}".`,
    'That block is where the measured floor, its metric and its width live. A threshold read off a key',
    'that no longer exists would arrive as undefined and compare nothing.',
  ]);
}

if (block.metric !== METRIC_ID) {
  coverageLost([
    `${REGISTER} ${BLOCK} records its floor against metric ${JSON.stringify(block.metric ?? null)} and this guard computes "${METRIC_ID}".`,
    'The floor is a separation MEASURED by one definition of ink. Applying it to another compares two',
    'different quantities and reports a verdict about neither.',
  ]);
}

const floor = block.minMedianRemovedInk;
if (!Number.isFinite(floor) || floor <= 0 || floor >= 1) {
  coverageLost([
    `${REGISTER} ${BLOCK}.minMedianRemovedInk is ${JSON.stringify(floor ?? null)}, which is not a fraction strictly between 0 and 1.`,
    'At 0 or below no run can fail, including a blank one. At 1 or above every run fails, including a',
    'correct one. Either way the comparison below stops being a comparison.',
  ]);
}

const width = block.calibratedWidth;
if (!Number.isInteger(width) || width <= 0) {
  coverageLost([
    `${REGISTER} ${BLOCK}.calibratedWidth is ${JSON.stringify(width ?? null)}, not a positive integer.`,
    'Removed ink is a fraction of pixels and moves with the device pixel ratio; without the width the',
    'floor was measured at, no frame can be judged against it.',
  ]);
}

// 🔴 THE METRIC PROVES ITSELF, AGAINST THIS GUARD'S OWN FLOOR, BEFORE A REAL
// FRAME IS READ. The failure that costs everything is not a floor slightly
// wrong, it is `inkFraction` or `textlessFrame` edited into something that
// returns a constant — every run then passes, or fails, forever. The synthetic
// frame is the one frame-ink.mjs owns; its readings are in the register `_why`.
const withText = removedInk(inkFixtureFrame({ width: 360, height: 640, glyphs: true })).removed;
const without = removedInk(inkFixtureFrame({ width: 360, height: 640, glyphs: false })).removed;
if (!(withText >= floor && without < floor)) {
  coverageLost([
    'the ink metric FAILED ITS OWN SELF-TEST against this guard\'s floor, and no frame was measured.',
    `the synthetic frame carrying glyph-shaped strokes lost ${withText} of its ink to the glyph filter (needs >= ${floor}),`,
    `and the same layout with no strokes lost ${without} (needs < ${floor}).`,
    'The metric can no longer tell a frame with text from one without, so it would judge every real run',
    'for the same wrong reason, silently.',
  ]);
}

// ── the frames ──────────────────────────────────────────────────────────────
const judged = [];

for (const dir of dirs) {
  const abs = resolve(dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    coverageLost([
      `${dir} is not a directory, so its frames were not read.`,
      'The drive writes its per-page screenshots here. A missing directory after a successful drive is a',
      'lane that produced nothing, which is the state this guard exists to name rather than to skip.',
    ]);
  }
  for (const file of readdirSync(abs).filter((f) => f.toLowerCase().endsWith('.png')).sort()) {
    const rel = `${basename(abs)}/${file}`;
    let img;
    try {
      img = decodeRgba(readFileSync(join(abs, file)));
    } catch (err) {
      // An unreadable PNG is a could-not-look, not a verdict about its text.
      coverageLost([
        `${rel} could not be decoded: ${err.message}`,
        'A frame this guard cannot open is a frame it cannot judge, and treating it as green would certify',
        'the one file most likely to be truncated by a failed capture.',
      ]);
    }
    if (img.width !== width) {
      coverageLost([
        `${rel} is ${img.width}x${img.height}; the floor in ${REGISTER} ${BLOCK} was measured on frames ${width} wide.`,
        'Removed ink falls roughly as 1/DPR, so a floor measured at one width says nothing at another. If the',
        'drive\'s --window-size or DPR changed, re-measure the block in the same change; do not stretch the floor.',
      ]);
    }
    judged.push({ rel, width: img.width, height: img.height, ...removedInk(img) });
  }
}

// 🔴 AN EMPTY SUBJECT IS A REFUSAL, NEVER A PASS. `judged.length === 0` with
// exit 0 is precisely the shape of the defect: a lane reporting success over an
// artifact that does not exist.
if (judged.length === 0) {
  coverageLost([
    `no .png frame under ${dirs.join(', ')}.`,
    'The drive is supposed to have written one screenshot per page here. Zero frames means the capture did',
    'not happen, or it wrote somewhere else — either way nothing was judged, and a green line over nothing',
    'is the exact failure this guard was added to end.',
  ]);
}

for (const f of judged) {
  console.log(
    `  ${f.rel} (${f.width}x${f.height}) measured ${f.measured}, textless ${f.textlessControl}, removed ${f.removed}`,
  );
}

const runMedian = median(judged.map((f) => f.removed));
const carriesText = runMedian >= floor;

if (!carriesText) {
  console.error('');
  console.error(
    `✗ the run's ${judged.length} frame(s) carry no text: the median ink removed by the glyph filter is ${runMedian}, ` +
      `below the ${floor} floor (${REGISTER} ${BLOCK}.minMedianRemovedInk, metric ${METRIC_ID}).`,
  );
  console.error(
    '  Removing the glyphs took almost nothing away from the typical page because there were almost no',
  );
  console.error('  glyphs — the pages rendered their icons and their boxes and drew no Latin character.');
  console.error('');
  console.error(
    '  The fallback fonts the bootstrap points at did not arrive. Check the staging step before the drive',
  );
  console.error('  (tooling/store/capture-fallback-fonts.mjs --stage), and DO NOT lower the floor.');
  process.exit(1);
}

console.log('');
console.log(
  `✓ the run's ${judged.length} frame(s) carry drawn text — median removed ink ${runMedian} >= ${floor}, ` +
    `metric ${METRIC_ID}, ${width} px wide.`,
);
