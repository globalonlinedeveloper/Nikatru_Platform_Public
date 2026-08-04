// ─────────────────────────────────────────────────────────────────────────────
// chrome-raster.mjs — the ONE answer to "turn this markup into a PNG of exactly
// these dimensions, with or without an alpha channel".
//
// Two callers: tooling/store/render-play-graphics.mjs (composes the feature
// graphic and the store icon) and tooling/store/capture-play-screenshots.mjs
// (flattens WebDriver's RGBA screenshots into the 24-bit PNGs Play requires).
// A private copy in either would be the second declaration and the first to
// drift — the same reasoning that keeps `storeMetadataContract` in the register
// rather than inside its guard, and that gave `flutter-stock-assets.mjs` its
// own file.
//
// 🔴 WHY CHROME AND NOT AN IMAGE LIBRARY. This repository has no image
// dependency and adding one to resize a PNG would be a supply-chain edge for
// arithmetic. Chrome is ALREADY a build dependency — the web target builds with
// it, the nightly integration_test suite drives it — so the rasteriser costs
// nothing new to install and is the same engine that renders the app itself.
//
// 🔴 `--default-background-color` IS THE ALPHA SWITCH, and it is the difference
// between a compliant file and a rejected upload:
//     opaque (default)  → PNG colour type 2, 24-bit, NO alpha
//     00000000          → PNG colour type 6, 32-bit, WITH alpha
// Google requires the first for the feature graphic and for screenshots, and the
// second for the store icon — opposite directions, one flag apart. Verified
// empirically on Chrome 150 in BOTH directions before either caller was written,
// because "I assumed PNG output is always RGBA" is exactly the kind of belief
// that ships a file the Play Console silently refuses.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

/** Thrown rather than exiting, so each caller can phrase its own refusal. */
export class RasterUnavailable extends Error {
  constructor(lines) {
    super(lines[0]);
    this.lines = lines;
  }
}

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export function chromeBinary() {
  const fromEnv = process.env.CHROME_EXECUTABLE || process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const found = CANDIDATES.find((c) => existsSync(c));
  if (!found) {
    throw new RasterUnavailable([
      'no Chrome binary was found and none was named in CHROME_EXECUTABLE.',
      'Chrome is the rasteriser for every Play graphic in this repo. Set CHROME_EXECUTABLE, or install',
      'Chrome — it is already required to build the web target and to run the nightly e2e suite.',
      `looked at: ${CANDIDATES.join(', ')}`,
    ]);
  }
  return found;
}

/**
 * Render `markup` (an `.svg` or `.html` document) to `out` at exactly
 * `width` x `height` device pixels.
 *
 * `--force-device-scale-factor=1` is not optional: without it a host with a
 * scaled display writes a screenshot at the host's DPR, so the same command
 * produces 1024x500 on one machine and 1536x750 on another. That is a listing
 * asset whose size depends on whose laptop rendered it.
 */
export function render({ markup, ext, out, width, height, alpha = false }) {
  const chrome = chromeBinary();
  // A SHORT working directory on purpose. Chrome nests its GPU cache deeply
  // under --user-data-dir; pointed at a long scratch path it exceeded Windows'
  // 260-character limit and logged a cache error on every single run. Noisy
  // enough that a working pipeline gets abandoned as "flaky". This repo already
  // sets core.longpaths for the same class of problem.
  const work = join(tmpdir(), `nk-raster-${randomBytes(4).toString('hex')}`);
  mkdirSync(work, { recursive: true });
  const page = join(work, `page.${ext}`);
  writeFileSync(page, markup, 'utf8');
  const args = [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${width},${height}`,
    `--user-data-dir=${work}`,
    `--screenshot=${out}`,
    '--virtual-time-budget=4000',
  ];
  if (alpha) args.push('--default-background-color=00000000');
  args.push(`file://${page.replace(/\\/g, '/')}`);
  mkdirSync(dirname(out), { recursive: true });
  try {
    execFileSync(chrome, args, { stdio: 'pipe' });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * IHDR only — width, height, bit depth, colour type, and whether a `tRNS` chunk
 * is present.
 *
 * A full PNG decoder is not needed to answer the four questions Google asks, and
 * `tooling/ci/assert-listing-assets.mjs` reads the same fields the same way so
 * the generator and the guard cannot disagree about what a file is.
 *
 * `tRNS` counts as transparency even on a colour type without an alpha channel:
 * a palette or greyscale image can be transparent through that chunk alone.
 * Checking only the colour type would pass a transparent palette PNG — which is
 * exactly what Android's stock `ic_launcher.png` is, so it is not a theoretical
 * shape (see assert-launcher-icons.mjs limb 4).
 */
export function pngHeader(buf) {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 26 || !SIG.every((v, i) => buf[i] === v)) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  const header = {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    depth: buf[24],
    colourType: buf[25],
    bytes: buf.length,
  };
  if (header.width === 0 || header.height === 0) return null;
  let off = 8;
  let tRNS = false;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'tRNS') tRNS = true;
    if (type === 'IEND') break;
    off += 12 + len;
  }
  header.tRNS = tRNS;
  header.hasAlpha = header.colourType === 4 || header.colourType === 6 || tRNS;
  return header;
}

/**
 * Re-emit a PNG with its alpha channel removed, at its own pixel size.
 *
 * WebDriver hands back RGBA (colour type 6) and Google requires screenshots to
 * be a "24-bit PNG (no alpha)". Rather than carry a PNG codec, the image is
 * drawn 1:1 into an opaque page and re-photographed: same engine, same pixels,
 * no resampling (`image-rendering: pixelated` and an exact-size box), and the
 * alpha channel is gone because the page underneath is opaque.
 */
export function flattenToOpaque({ src, out, width, height }) {
  const b64 = src.toString('base64');
  const markup = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#000}
img{display:block;width:${width}px;height:${height}px;image-rendering:pixelated}
</style><img src="data:image/png;base64,${b64}" width="${width}" height="${height}">`;
  render({ markup, ext: 'html', out, width, height, alpha: false });
}
