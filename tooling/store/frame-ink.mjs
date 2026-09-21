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
// `selfTestInkMetric` for the same relationship in miniature). The worst
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

/**
 * 🔴 THE METRIC PROVES ITSELF ON EVERY RUN, and this is what stops the floor
 * from being edited into something that never fires.
 *
 * The failure that costs everything here is not the threshold being slightly
 * wrong. It is `inkFraction` being changed into something that returns a large
 * constant, or the comparison being inverted — at which point every frame
 * clears every floor forever and the limb prints ok while measuring nothing.
 * The same argument this guard's account-address detector already makes about
 * its one regular expression.
 *
 * So two frames are built here, in memory, on every invocation: the same layout
 * with glyph-shaped strokes and without them. The strokes must lift the reading
 * above `minFraction` of the text-bearing frame, and their absence must drop it
 * below — the EXACT relationship the register's floors encode, so a metric that
 * can no longer tell the two apart is reported before any real frame is read.
 */
export function selfTestInkMetric(minFraction) {
  const withText = inkFraction(inkFixtureFrame({ width: 360, height: 640, glyphs: true }));
  const textless = inkFraction(inkFixtureFrame({ width: 360, height: 640, glyphs: false }));
  const floor = withText * minFraction;
  return {
    withText,
    textless,
    floor,
    ok: withText > 0 && textless < floor && withText >= floor,
  };
}
