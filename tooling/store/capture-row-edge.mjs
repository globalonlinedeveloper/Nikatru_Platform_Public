// capture-row-edge.mjs — no card in a store frame is cut by the page's bottom
// edge with nothing drawn over the cut.
//
// ⏱ 2026-09-22 (store-frame-followup). O-STORE-FRAME-FAB-COVERS-A-PRICE-ROW: the phone frames
// showed a price row sliced by the fold, a hard horizontal line through a
// card. The fix is a fade in `app_shell.dart` that ends in a solid band of the
// page ground; this module is the check that the PIXELS agree, without a human
// eye.
//
// THE READING. Just above the fold, the page is either showing a GAP between
// cards (ground) or the fade's solid tail (ground). Anything else in those rows
// is ink that the frame edge cuts: a card with no fade over it. So the check is
// simple and has no threshold to tune beyond a dither tolerance: the
// `FOLD_ROWS` device rows just above the fold must all be ground, across the
// page's width, except the spans an overlay (the rail FAB) is known to sit on.
//
// WHERE THE FOLD IS comes from the suite, not from here: the PNG does not know
// where the page ends. `integration_test/store_frame_fold.dart` publishes a
// `folds` list into `binding.reportData`, the driver writes it whole into the
// viewport's board file, and `capture-play-screenshots.mjs` hands the matching
// entry to `foldLineProblems` beside the offline-banner scan.
//
// THE ROUNDING IS THE DART SIDE'S, MIRRORED: the fold row is floored, the
// content span is taken inward, the skip spans outward. A band that slipped one
// row down would read the shell's own ground and pass on every frame whatever
// the page did, which is why the self-test paints the shell a different colour.

import { decodeRgba, encodeRgba } from './png-codec.mjs';

/** Device rows read just above the fold. */
export const FOLD_ROWS = 3;

/** Largest per-channel difference from the ground still read as ground.
 *  2, the same margin `test/width_shell_fab_test.dart` allows for dithering. */
export const FOLD_TOLERANCE = 2;

/**
 * Read rows `[foldY - FOLD_ROWS, foldY)` of a straight RGBA buffer and count
 * the pixels whose largest channel difference from `groundRgb` exceeds `tol`.
 *
 * @param {Uint8Array} rgba      width*height*4 bytes
 * @param {number} width         pixels per row
 * @param {number} foldY         first device row that is NOT page
 * @param {number[]} groundRgb   [r, g, b]
 * @param {number} [tol]
 * @param {{xFrom?: number, xTo?: number, skip?: number[][]}} [span]
 *        columns `[xFrom, xTo)` are read, minus each `[left, right)` in `skip`
 * @returns {{rows: number[], examined: number, off: number, worst: number,
 *            first: null | {x: number, y: number, rgb: number[]}, edge: boolean}}
 */
export function scanFoldLine(rgba, width, foldY, groundRgb, tol = FOLD_TOLERANCE, { xFrom = 0, xTo = width, skip = [] } = {}) {
  const y0 = Math.max(0, foldY - FOLD_ROWS);
  const height = Math.floor(rgba.length / (width * 4));
  const y1 = Math.min(foldY, height);
  const [gr, gg, gb] = groundRgb;
  let examined = 0;
  let off = 0;
  let worst = 0;
  let first = null;
  for (let y = y0; y < y1; y++) {
    for (let x = Math.max(0, xFrom); x < Math.min(xTo, width); x++) {
      if (skip.some(([l, r]) => x >= l && x < r)) continue;
      const i = (y * width + x) * 4;
      const d = Math.max(Math.abs(rgba[i] - gr), Math.abs(rgba[i + 1] - gg), Math.abs(rgba[i + 2] - gb));
      examined++;
      if (d > worst) worst = d;
      if (d > tol) {
        off++;
        if (!first) first = { x, y, rgb: [rgba[i], rgba[i + 1], rgba[i + 2]] };
      }
    }
  }
  return { rows: [y0, y1], examined, off, worst, first, edge: off > 0 };
}

/** The fold entries a board record carries, or null when it carries none. */
export function foldsOf(record) {
  const f = record?.folds;
  return Array.isArray(f) && f.length > 0 ? f : null;
}

/** The fold entry for one PNG (`01-home.png` -> frame `01-home`), or null. */
export function foldFor(folds, pngName) {
  const frame = pngName.replace(/\.png$/, '');
  return folds?.find((f) => f?.frame === frame) ?? null;
}

/** The Dart side's device mapping, mirrored. See `store_frame_fold.dart`. */
export function deviceGeometry(fold) {
  const { dpr } = fold;
  return {
    foldY: Math.floor(fold.foldTopLogical * dpr),
    xFrom: Math.ceil(fold.contentLeftLogical * dpr),
    xTo: Math.floor(fold.contentRightLogical * dpr),
    skip: (fold.skipLogical ?? []).map(([l, r]) => [Math.floor(l * dpr), Math.ceil(r * dpr)]),
    width: Math.round(fold.viewWidthLogical * dpr),
    ground: [(fold.pageGroundArgb >>> 16) & 0xff, (fold.pageGroundArgb >>> 8) & 0xff, fold.pageGroundArgb & 0xff],
  };
}

/**
 * Every problem with one decoded frame's fold line, as sentences, plus the scan
 * (null when the geometry could not be applied). `img` is `{width, height, rgba}`.
 */
export function foldLineProblems(img, fold, label, tol = FOLD_TOLERANCE) {
  const g = deviceGeometry(fold);
  if (img.width !== g.width) {
    return {
      scan: null,
      problems: [
        `${label} is ${img.width} px wide and its fold record says the view is ${fold.viewWidthLogical} logical px ` +
          `at ${fold.dpr}x = ${g.width} px. The PNG is not at the scale the geometry was measured in, so every row ` +
          'index the row-edge check would read is wrong; it was NOT examined for a cut card.',
      ],
    };
  }
  if (g.foldY - FOLD_ROWS < 0 || g.foldY > img.height) {
    return {
      scan: null,
      problems: [`${label}: fold row ${g.foldY} is outside the ${img.height}-row frame, so it was NOT examined for a cut card.`],
    };
  }
  const scan = scanFoldLine(img.rgba, img.width, g.foldY, g.ground, tol, g);
  if (!scan.edge) return { scan, problems: [] };
  const f = scan.first;
  return {
    scan,
    problems: [
      `${label} has a CARD CUT BY THE FOLD: ${scan.off} of ${scan.examined} pixels in device rows ` +
        `${scan.rows[0]}..${scan.rows[1] - 1} (just above the page's bottom edge) are off the page ground ` +
        `rgb(${g.ground.join(',')}) by more than ${tol}, worst ${scan.worst}; first at x=${f.x}, y=${f.y}, ` +
        `rgb(${f.rgb.join(',')}). Those rows should be a gap or the fade's solid tail. A hard line through a ` +
        'card at the frame edge is O-STORE-FRAME-FAB-COVERS-A-PRICE-ROW; the fade that removes it is `AppShell.foldFadeKey` in ' +
        '`app_shell.dart`.',
    ],
  };
}

/**
 * Three synthetic frames, round-tripped through the real PNG codec, that the
 * detector must call correctly before any real frame is trusted to it.
 *
 * The shell below the fold is painted a DIFFERENT colour from the ground, so a
 * band that slipped one row down turns the two GREEN cases RED; a card that
 * reaches the fold turns the straddle case RED only if the band reaches it.
 */
export function selfTestFoldLineDetector() {
  const W = 64;
  const H = 64;
  const FOLD = 40;
  const ground = [247, 248, 250];
  const card = [255, 255, 255];
  const shell = [30, 34, 40];
  const frame = (paint) => {
    const rgba = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = y >= FOLD ? shell : paint(x, y) ?? ground;
        const i = (y * W + x) * 4;
        rgba[i] = c[0];
        rgba[i + 1] = c[1];
        rgba[i + 2] = c[2];
        rgba[i + 3] = 255;
      }
    }
    return decodeRgba(encodeRgba({ width: W, height: H, rgba }, { opaque: true }));
  };
  const inCard = (x) => x >= 8 && x < 56;
  // A card from row 28 running under the fold: the edge cuts it.
  const straddle = frame((x, y) => (inCard(x) && y >= 28 ? card : null));
  // A card that ends at row 30: ground above the fold.
  const gap = frame((x, y) => (inCard(x) && y >= 18 && y < 30 ? card : null));
  // The same straddling card, with a fade over its last rows ending in solid ground.
  const faded = frame((x, y) => {
    if (!inCard(x) || y < 28) return null;
    if (y >= FOLD - FOLD_ROWS) return ground;
    const t = (y - 28) / (FOLD - FOLD_ROWS - 28);
    return card.map((v, k) => Math.round(v + (ground[k] - v) * t));
  });
  const run = (img) => scanFoldLine(img.rgba, img.width, FOLD, ground, FOLD_TOLERANCE);
  const r = { straddle: run(straddle), gap: run(gap), faded: run(faded) };
  return { ok: r.straddle.edge && !r.gap.edge && !r.faded.edge, ...r };
}
