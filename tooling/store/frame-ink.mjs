// ─────────────────────────────────────────────────────────────────────────────
// frame-ink.mjs — ONE reading of "there is text on this screen", for the defect
// that survived from #567 to #854 with every check in the tree green.
//
// ── WHAT HAPPENED, AND WHY NOTHING SAW IT ───────────────────────────────────
// The store capture fetched its fallback fonts at run time. In CI they never
// arrived, so Flutter drew NO GLYPHS AT ALL — not tofu boxes, nothing. The
// frames that shipped carried the real layout, the real cards, the real bundled
// icons and the real colours, with every title, label, amount and nav caption
// missing. `assert-listing-assets.mjs` passed them: right size, right colour
// type, posture "live", top band 0.009. Its own header said so in as many words
// — "ANY TEXT AT ALL, IN ANY FRAME … This is not a gap to close later" — and
// redirected the reader to the capture limb, which answers a DIFFERENT question
// (does a frame leak the signed-in account address) and would have passed a
// textless set exactly as it passed the one #567 shipped.
//
// #847 fixed the cause by bundling the fonts. This module is the other half:
// the instance was fixed, and the BLINDNESS is what let it run for weeks.
//
// ── THIS DOES NOT READ WORDS, AND IT IS NOT AN OCR PASS ─────────────────────
// 🔴 THE HEADER'S OLD ARGUMENT AGAINST A TEXT DETECTOR IS STILL CORRECT AND IS
// NOT BEING WAVED AWAY. A detector that READS some fonts and not others reports
// "clean" for the frames it cannot read — an assertion that cannot fail, wearing
// the appearance of one that can. Nothing here reads a word, a font or a glyph.
//
// What it measures is COVERAGE: the fraction of a frame's pixels that stand in
// local contrast to what is next to them. A glyph is thousands of small, sharp
// light/dark transitions spread over the frame; a card, a flat background and a
// gradient are none. So when the glyphs vanish and the bundled icons survive —
// which is precisely what a textless capture is — the number collapses, and it
// collapses whether the missing script is Latin, Devanagari or emoji, because
// no part of this asks what was drawn.
//
// ── THE DEFINITION ──────────────────────────────────────────────────────────
// A pixel is INK when it differs from its RIGHT neighbour or its DOWN neighbour
// by more than `INK_DELTA` on any one channel. `inkFraction` is the count of
// those divided by the pixel count, so it is comparable between the phone and
// tablet frames, which are different sizes.
//
// ⚠️ WHY NOT THE BYTE SIZE, WHICH IS WHAT THE INCIDENT WAS SPOTTED BY. The row
// records the sizes either way (home 459549 vs 381194, calendar 157296 vs 65609,
// insights 129114 vs 73649, budget 153442 vs 73806) and they are a real signal —
// but they are a signal about the COMPRESSOR. A palette change, a different PNG
// encoder or a longer gradient moves them with no text involved either way, so a
// byte floor would fire on correct input, which this repository has already paid
// for once (a made-up "120 characters or fewer" rejecting its own fixture at
// 129). The pixels are the property that actually changes.
//
// ⚠️ WHY NOT A RUN-LENGTH OR "FLAT REGION" READING, WHICH WAS TRIED FIRST.
// Counting pixels outside long runs of one exact colour scores a GRADIENT as
// solid ink: measured on the real set, `01-home.png` came to 0.378 against
// 0.084 for `03-insights.png`, a 4.5x spread between two frames that carry
// comparable amounts of text, because home's hero panel is a gradient and
// insights' is not. Local contrast ignores a gradient — consecutive pixels in
// one differ by 1 or 2 — and the same two frames come to 0.0254 and 0.0168.
//
// ── WHERE THE NUMBER 24 COMES FROM ──────────────────────────────────────────
// Not picked. Measured, on 2026-09-21, over the eight committed frames at
// origin/main 9f548515 and over a textless control built from each (see
// `inkFixtureFrame`). The worst
// text-bearing-to-textless ratio across all eight frames, by threshold:
//
//     delta    8    16    24    32    48    64
//     worst  1.71  1.83  1.95  1.92  1.71  1.53
//
// 16, 24 and 32 all separate every frame from its own textless control by the
// same margin, so this is a plateau and not a cliff edge somebody tuned to. 24
// is the middle of it. Below 8 the anti-aliasing on a card edge starts counting;
// above 48 the lighter-weight labels stop counting.
// ─────────────────────────────────────────────────────────────────────────────
import { decodeRgba, encodeRgba } from './png-codec.mjs';

/** The metric's name, written into the register beside every floor. A floor
 *  recorded against a metric this module no longer computes is a number whose
 *  meaning changed underneath it, and the guard refuses it rather than comparing
 *  today's reading to yesterday's definition. */
export const METRIC_ID = 'local-contrast-ink-v1';

/** Per-channel difference, 0-255, above which two adjacent pixels count as a
 *  transition. See the table in this file's header: 16 through 32 give the same
 *  verdict on every measured frame. */
export const INK_DELTA = 24;

/**
 * The fraction of `img`'s pixels that stand in local contrast to the pixel to
 * their right or below them.
 *
 * Returned as a NUMBER, never a boolean: every caller prints what it measured,
 * so a comfortable pass can be told apart from one that nearly fired.
 */
export function inkFraction(img) {
  const { width: w, height: h, rgba } = img;
  if (w < 2 || h < 2) return 0;
  let ink = 0;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const r = i + 4;
      const d = i + w * 4;
      if (
        Math.abs(rgba[i] - rgba[r]) > INK_DELTA ||
        Math.abs(rgba[i + 1] - rgba[r + 1]) > INK_DELTA ||
        Math.abs(rgba[i + 2] - rgba[r + 2]) > INK_DELTA ||
        Math.abs(rgba[i] - rgba[d]) > INK_DELTA ||
        Math.abs(rgba[i + 1] - rgba[d + 1]) > INK_DELTA ||
        Math.abs(rgba[i + 2] - rgba[d + 2]) > INK_DELTA
      ) {
        ink++;
      }
    }
  }
  return ink / (w * h);
}

/** The two halves of the self-test frame, built at any size so a caller can use
 *  the same pair as a screenshot fixture. `glyphs: false` is the textless one:
 *  IDENTICAL layout, identical card, identical filled icon block, no strokes —
 *  which is what a capture with no fonts produced. */
export function inkFixtureFrame({ width, height, glyphs }) {
  const rgba = Buffer.alloc(width * height * 4);
  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    rgba[i] = c[0];
    rgba[i + 1] = c[1];
    rgba[i + 2] = c[2];
    rgba[i + 3] = 0xff;
  };
  const fill = (x0, y0, x1, y1, c) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) put(x, y, c);
  };
  const BG = [0xf7, 0xf7, 0xfb];
  const CARD = [0xff, 0xff, 0xff];
  const ICON = [0x25, 0x63, 0xeb];
  const TEXT = [0x1f, 0x29, 0x37];
  fill(0, 0, width, height, BG);
  // Three big flat cards and a filled icon block per card — the parts of a real
  // frame that SURVIVED the missing fonts, so the textless half is not an empty
  // canvas that any metric would separate.
  const cardH = Math.floor(height / 5);
  for (let c = 0; c < 3; c++) {
    const top = Math.floor(height * 0.1) + c * Math.floor(height * 0.28);
    fill(Math.floor(width * 0.05), top, Math.floor(width * 0.95), top + cardH, CARD);
    fill(Math.floor(width * 0.08), top + 12, Math.floor(width * 0.08) + 48, top + 60, ICON);
    if (!glyphs) continue;
    // Stroke-shaped marks, the size and spacing body text comes to at the DPR
    // the capture uses: 4px stems, 28px tall, 18px apart, over two label rows.
    for (let row = 0; row < 2; row++) {
      const y0 = top + 20 + row * 44;
      for (let x = Math.floor(width * 0.2); x < Math.floor(width * 0.9); x += 18) {
        fill(x, y0, x + 4, y0 + 28, TEXT);
      }
    }
  }
  // Round-tripped through the encoder and the decoder rather than handed over as
  // a raw buffer: the real input arrives as PNG bytes, so a decoder that broke
  // would otherwise pass this on a buffer it never encoded.
  return decodeRgba(encodeRgba({ width, height, rgba }, { opaque: true }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE TEXTLESS CONTROL HAD NO PRODUCER IN THE TREE, AND THE ROWS DEPEND ON IT.
//
// `channel-register.json …inkFloor.source` says `textlessControl` is "the same
// frame with its glyphs removed by a 9x9 mode filter". That sentence is the
// whole justification for every floor: `assert-listing-assets.mjs` REFUSES a
// floor at or below its own frame's textless reading, on the stated grounds
// that such a floor could not have caught the set that shipped. Until now
// nothing in this repository computed it — the eight numbers were produced by a
// script that was never committed.
//
// So the rows could be READ and could not be RE-TAKEN. The first recapture that
// moves a frame's ink by more than 30% — which the register itself says is the
// intended maintenance cost — would arrive with a `measured` anybody can
// reproduce and a `textlessControl` nobody can, and the honest options would be
// to keep a control that describes a DIFFERENT frame or to invent one. This
// repository already refuses "a dimension that arrives WITHOUT a source"; a
// control that cannot be re-derived is the same defect one step further back.
//
// ── 🔴 AND WHAT THE RE-DERIVATION MEASURED, WHICH IS A FINDING RATHER THAN A
//       CONFIRMATION. Run 2026-09-21 over the same eight frames at 9f548515,
//       `measured` and `textlessControl` side by side with the recorded rows:
//
//   frame                            measured  recorded    textless  recorded
//   screenshots/01-home              0.025445  0.025445    0.017809  0.013069
//   screenshots/02-calendar          0.017765  0.017765    0.006943  0.006713
//   screenshots/03-insights          0.016806  0.016806    0.007232  0.007159
//   screenshots/04-budget            0.016896  0.016896    0.008001  0.007669
//   screenshots-tablet/01-home       0.016420  0.016420    0.006433  0.005209
//   screenshots-tablet/02-calendar   0.005503  0.005503    0.001146  0.001039
//   screenshots-tablet/03-insights   0.005301  0.005301    0.001377  0.001305
//   screenshots-tablet/04-budget     0.008408  0.008408    0.003466  0.003374
//
// `measured` reproduces to the last recorded digit on all eight, so
// `inkFraction` IS the committed half and this harness reads the same frames
// the register does. `textlessControl` does NOT reproduce: every reading here
// is HIGHER than the recorded one, by 3% on the phone calendar and by 36% on
// the phone home. Whatever produced the recorded column removed more than a
// per-channel 9x9 mode does, and the register's one sentence about it is not
// enough to say what.
//
// ⚠️ SO THE RECORDED COLUMN IS LEFT EXACTLY AS IT IS. Those numbers belong to
// the frames #856 measured; overwriting them from here would be re-deriving a
// committed row with a different instrument and calling it maintenance. What
// this function is for is the NEXT set, where both halves are taken with one
// tool, on one day, from the same bytes.
//
// 🔴 AND THE DIRECTION OF THE DISAGREEMENT IS THE SAFE ONE, WHICH IS WHY THIS
// SHIPS RATHER THAN WAITING FOR THE OTHER SCRIPT TO BE FOUND. The guard refuses
// a floor at or below its frame's textless control, so a HIGHER control is a
// STRICTER bound: a row taken with this tool can only be harder to justify than
// one taken with whatever produced the recorded column, never easier. A control
// that is too permissive would be the dangerous error, and this is not it.
//
// ── HOW A ROW IS RE-TAKEN ───────────────────────────────────────────────────
// `tooling/store/measure-frame-ink.mjs` is the entry point: point it at an
// unzipped `play-screenshots-subscriptiontracker` artifact and it prints a
// paste-ready `inkFloor.frames` block for both device-type directories.
//
//   node tooling/store/measure-frame-ink.mjs
//     apps/subscriptiontracker/store/android-play/screenshots
//     apps/subscriptiontracker/store/android-play/screenshots-tablet
//
// It prints and never writes: the register is a sworn store contract, and a
// tool that edited it would let a recapture lower its own floor on the way
// past. Its own cases are in tooling/ci/test/measure-frame-ink.test.mjs.
// ─────────────────────────────────────────────────────────────────────────────
// ⏱ AMENDED 2026-09-24 (row O-STORE-INK-FLOOR-HAND-PASTED), appended rather than
// edited so the history above stays readable: the register no longer carries
// `inkFloor`. Its per-frame rows and their 0.7 fraction were replaced by
// `storeMetadataContract.inkRule`, which judges each device class's RUN median
// of removed ink against a floor `assert-listing-assets.mjs` computes from that
// class's calibration frames, using `areaDownscale` and `removedInkRunMedian`
// at the end of this file. `measure-frame-ink.mjs` prints that reading and no
// longer prints a block to paste. `selfTestInkMetric` was retired in the same
// change: the listing guard, its only caller, self-tests through the class
// arithmetic instead, and its doc described the per-frame floor.
// ─────────────────────────────────────────────────────────────────────────────

/** The neighbourhood the mode is taken over. 9 is the register's number, and it
 *  is the size at which a 4px stem at this DPR is outvoted by the card it sits
 *  on while a card EDGE — a boundary between two large flat regions — survives,
 *  which is what makes the result "the same frame with its glyphs removed"
 *  rather than a blur of everything. */
export const TEXTLESS_WINDOW = 9;

/**
 * [img] with its glyphs removed: each channel replaced by the most common value
 * in the [TEXTLESS_WINDOW]×[TEXTLESS_WINDOW] neighbourhood around it.
 *
 * ⚠️ A MODE FILTER, NOT A BLUR, AND THE DIFFERENCE IS THE POINT. A mean or a
 * Gaussian SMOOTHS an edge, which lowers the ink of the cards and the icons as
 * well as of the text — so a blurred control would be below a real frame for
 * reasons that have nothing to do with glyphs, and the floor derived from it
 * would be measuring the blur. The mode picks a value that is actually present
 * in the neighbourhood, so a flat card stays exactly its own colour, a card edge
 * stays a step, and only marks too small to win their own neighbourhood — which
 * is what body text is — are voted away.
 *
 * Alpha is carried through untouched: the frames are opaque by the time
 * anything here reads them, and averaging a constant would only invite the
 * question.
 */
export function textlessFrame(img) {
  const { width: w, height: h, rgba } = img;
  const out = Buffer.from(rgba);
  const r = (TEXTLESS_WINDOW - 1) / 2;
  // One scratch histogram, reused. Only the bins this pixel touched are zeroed
  // again, so the per-pixel cost is the window and not 256.
  const bins = new Int32Array(256);
  const touched = new Int32Array(TEXTLESS_WINDOW * TEXTLESS_WINDOW);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      for (let c = 0; c < 3; c++) {
        let n = 0;
        let best = -1;
        let bestCount = 0;
        for (let yy = y0; yy <= y1; yy++) {
          const rowBase = yy * w * 4 + c;
          for (let xx = x0; xx <= x1; xx++) {
            const v = rgba[rowBase + xx * 4];
            const count = ++bins[v];
            touched[n++] = v;
            // ⚠️ STRICTLY GREATER, so a tie is broken by the value that reached
            // the count FIRST — i.e. by scan order, which is deterministic.
            // `>=` would make the result depend on which of two equally common
            // values happened to be visited last, and two runs over the same
            // bytes must give the same number.
            if (count > bestCount) {
              bestCount = count;
              best = v;
            }
          }
        }
        out[(y * w + x) * 4 + c] = best;
        for (let i = 0; i < n; i++) bins[touched[i]] = 0;
      }
    }
  }
  return { width: w, height: h, rgba: out };
}

/** The pair the register records for one frame: what it measures, and what the
 *  same frame measures with its glyphs voted away.
 *
 *  Returned together rather than separately because a row carrying one without
 *  the other is a floor whose ability to fire nobody checked — which is exactly
 *  what `assert-listing-assets.mjs` refuses. */
export function measureFrameInk(img) {
  return {
    measured: Number(inkFraction(img).toFixed(6)),
    textlessControl: Number(inkFraction(textlessFrame(img)).toFixed(6)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 REMOVED INK IS A FRACTION OF PIXELS, SO IT MOVES WITH THE DEVICE PIXEL
// RATIO — and the store frames are captured at two of them. Measured 2026-09-24
// at 7dd09500 with the metric above, unchanged: the committed phone set
// (1080x1920, DPR 3) has a run median of removed ink of 0.00871 at native size
// and 0.035093 once each frame is area-averaged down to its 360 CSS pixels; the
// tablet set (1800x3200, DPR 2) reads 0.004313 native and 0.008659 at 900. At
// native size both text-bearing sets sat UNDER the e2e floor (0.011, measured
// at 430 CSS pixels, DPR 1), so a floor can only be compared at the size the
// layout was drawn at — and even there the tablet class reads 0.79x of the e2e
// floor, which is why `assert-listing-assets.mjs` computes one floor PER DEVICE
// CLASS, from that class's own calibration frames, rather than borrowing one.
//
// The two helpers below are the whole of that normalisation. The metric itself
// (`inkFraction`, `INK_DELTA`, `textlessFrame`, `TEXTLESS_WINDOW`) is untouched:
// a frame is resized to its CSS width and then measured exactly as before.
// ─────────────────────────────────────────────────────────────────────────────

/** One axis of an area average: for each of `dst` output cells, the source
 *  indices it covers and the share of the cell each one contributes. The
 *  shares of one cell sum to 1, so a flat region keeps its exact colour. */
function areaTaps(src, dst) {
  const scale = src / dst;
  const out = [];
  for (let o = 0; o < dst; o++) {
    const a = o * scale;
    const b = (o + 1) * scale;
    const taps = [];
    for (let s = Math.floor(a); s < Math.min(src, Math.ceil(b)); s++) {
      const w = Math.min(b, s + 1) - Math.max(a, s);
      if (w > 0) taps.push([s, w / scale]);
    }
    out.push(taps);
  }
  return out;
}

/**
 * [img] area-averaged down to `targetWidth` pixels wide, the height scaled by
 * the same factor and rounded: `round(height * targetWidth / width)`. Returned
 * in the shape `decodeRgba` returns, so every reading above takes it as it is.
 *
 * An AREA AVERAGE, because that is what a display of lower density does to the
 * same layout: each output pixel is the mean of the source pixels it covers,
 * weighted by how much of each it covers. At an integer factor (1080 -> 360,
 * 1800 -> 900) that is a plain box of 3x3 or 2x2. A target equal to the width
 * is the frame itself, pixel for pixel.
 *
 * ⚠️ THE TARGET IS AN INTEGER THE CALLER READ, NEVER `width / dpr` COMPUTED
 * HERE. A class declares its CSS width in the register, and a floating-point
 * quotient would put a frame 1px off that width on the other side of a
 * rounding edge without anybody having chosen it. So a non-integer, a
 * non-positive and an UPWARD target are refused rather than approximated.
 */
export function areaDownscale(img, targetWidth) {
  const { width: w, height: h, rgba } = img;
  if (!Number.isInteger(targetWidth) || targetWidth <= 0) {
    throw new RangeError(`areaDownscale: the target width must be a positive integer, got ${JSON.stringify(targetWidth)}`);
  }
  if (targetWidth > w) {
    throw new RangeError(`areaDownscale: ${w}px wide cannot be area-averaged UP to ${targetWidth}px`);
  }
  const tw = targetWidth;
  const th = Math.max(1, Math.round((h * tw) / w));
  const xs = areaTaps(w, tw);
  const ys = areaTaps(h, th);
  // Horizontal pass first, kept in floating point so the vertical pass averages
  // exact values and the one rounding happens once, at the end.
  const mid = new Float64Array(h * tw * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < tw; x++) {
      const o = (y * tw + x) * 4;
      for (const [sx, share] of xs[x]) {
        const i = (y * w + sx) * 4;
        mid[o] += rgba[i] * share;
        mid[o + 1] += rgba[i + 1] * share;
        mid[o + 2] += rgba[i + 2] * share;
        mid[o + 3] += rgba[i + 3] * share;
      }
    }
  }
  const out = Buffer.alloc(tw * th * 4);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const o = (y * tw + x) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const [sy, share] of ys[y]) {
        const i = (sy * tw + x) * 4;
        r += mid[i] * share;
        g += mid[i + 1] * share;
        b += mid[i + 2] * share;
        a += mid[i + 3] * share;
      }
      out[o] = Math.min(255, Math.round(r));
      out[o + 1] = Math.min(255, Math.round(g));
      out[o + 2] = Math.min(255, Math.round(b));
      out[o + 3] = Math.min(255, Math.round(a));
    }
  }
  return { width: tw, height: th, rgba: out };
}

/**
 * The median, over a run of frames, of each frame's REMOVED ink —
 * `measured - textlessControl` from `measureFrameInk` — after each frame is
 * area-averaged to `targetWidth`. The statistic
 * `tooling/e2e/assert-frames-carry-text.mjs` judges, at a size the caller
 * names, so a store class and the e2e lane read one quantity.
 *
 * The median of an even count is the mean of the middle two, rounded to the
 * same six places `measureFrameInk` rounds to. An EMPTY run is refused: a
 * median of nothing returned as 0 or NaN would compare as a reading, and a
 * floor computed from it would be a floor nobody measured.
 */
export function removedInkRunMedian(imgs, targetWidth) {
  if (!Array.isArray(imgs) || imgs.length === 0) {
    throw new RangeError('removedInkRunMedian: a run median needs at least one frame, and got none');
  }
  const removed = imgs
    .map((img) => {
      const { measured, textlessControl } = measureFrameInk(areaDownscale(img, targetWidth));
      return Number((measured - textlessControl).toFixed(6));
    })
    .sort((a, b) => a - b);
  const mid = removed.length >> 1;
  return removed.length % 2 ? removed[mid] : Number(((removed[mid - 1] + removed[mid]) / 2).toFixed(6));
}
