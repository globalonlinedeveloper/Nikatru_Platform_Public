#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// render-play-graphics.mjs — the two Play listing graphics that are DERIVABLE,
// derived. One command, no hand-editing, no model in the loop.
//
// [pipeline D-5] "store listing metadata is generated from the spec and lives in
//                 the repo … so a listing can be regenerated, audited, localized
//                 and diffed, and is never hand-typed into a store console as
//                 the only copy."
//
// D-5 has always exempted graphics — apps/subly/store/*/screenshots/README.md
// says "screenshots are the one listing field that cannot be derived from a spec
// var". That is true of SCREENSHOTS. It was never true of the FEATURE GRAPHIC or
// the STORE ICON, and treating all three as one category is why Play's two
// mandatory, fully-derivable graphics had no repo representation at all while
// the listing text had a guard on every field.
//
// ── WHAT PLAY REQUIRES, AND WHERE THE NUMBER COMES FROM ─────────────────────
// Every dimension below is quoted from ONE primary page, fetched 2026-08-04:
//   https://support.google.com/googleplay/android-developer/answer/9866151
//
//   Feature graphic  "You must provide a feature graphic to publish your store
//                     listing." · "JPEG or 24-bit PNG (no alpha)"
//                   · "Dimensions: 1024px by 500px"
//   App icon         "You must provide an app icon to publish your store
//                     listing." · "32-bit PNG (with alpha)"
//                   · "Dimensions: 512px by 512px" · "Maximum file size: 1024KB"
//
// 🔴 THE TWO FORMATS ARE OPPOSITES AND THAT IS NOT A TYPO. The feature graphic
// must have NO alpha channel; the icon MUST have one. A single rasteriser
// setting decides it (`--default-background-color`), so getting it backwards is
// one flag away and produces a file that looks perfect and is rejected at
// upload. tooling/ci/assert-listing-assets.mjs checks the PNG colour type of
// both, in opposite directions, for exactly this reason.
//
// ── DERIVED FROM THE BRAND, PARSED NOT RETYPED ──────────────────────────────
// 🔴 THE GRADIENT STOPS AND THE MARK GEOMETRY ARE READ OUT OF THE COMMITTED
// BRAND SVGs, never copied into this file. `apps/subly/assets/icon/
// app_icon_foreground.svg` and `app_icon_background.svg` are the same files
// `flutter_launcher_icons` builds every launcher icon from, so the feature
// graphic and the app's icon cannot drift apart: re-colour the brand and the
// next run of this script re-colours the listing.
//
// A copy would have been three lines shorter and would have become the second
// declaration and the first to drift — the same reasoning that keeps
// `storeMetadataContract` in the register instead of inside its guard, and the
// same reasoning behind `flutter-stock-assets.mjs` reading the live SDK instead
// of pinned hashes. If the parse yields nothing, this script REFUSES rather than
// falling back to a built-in default: a silent fallback would render a
// correct-looking graphic in colours nobody chose, which is precisely the
// failure mode that is invisible afterwards.
//
// ── ⬜ NO WORDMARK, AND THAT IS A RECORDED GAP RATHER THAN A DESIGN CHOICE ───
// The brand wordmark is Montserrat ExtraBold (SIL OFL). THE FACE IS NOT IN THIS
// REPOSITORY — measured 2026-08-04, `apps/subly/pubspec.yaml` bundles no fonts
// at all (the `fonts:` block is commented out) and no .ttf/.otf exists anywhere
// in the tree. Three options were considered and two were rejected:
//
//   ✗ Render text with a CSS font stack. Chrome would substitute whatever the
//     host has — Segoe UI here, DejaVu Sans on an ubuntu runner — so the same
//     command would produce a DIFFERENT graphic on every machine. An artefact
//     that changes when it is regenerated is exactly the hand-maintained drift
//     this whole tree exists to prevent.
//   ✗ Vendor the OFL face. Legitimate — OFL 1.1 permits redistribution — but it
//     needs a cleared row in tooling/legal/content-licence-register.json, whose
//     own README records that OFL subsetting makes a Modified Version and that
//     a row without a `basis` and `clauseText` "certifies the wrong thing".
//     That is owner legal sign-off, not a side effect of a graphics script.
//   ✓ Compose from geometry alone. Fully deterministic, zero licence surface,
//     and it is what Google's own guidance on this page steers toward anyway:
//     "Do not use prominent branding that is similar to your app icon… Optimize
//     for branding elements that serve as an extension of your app icon."
//
// The app NAME is not lost by leaving it out — Play renders `title.txt` and the
// icon beside the feature graphic on every surface that shows it. The guard
// PRINTS this gap on every run so it stays a decision somebody can revisit.
//
// ⚠️ WHAT THIS SCRIPT CANNOT JUDGE: whether the result is GOOD. It proves the
// bytes are the right size, format and colour space and that they came from the
// brand; "does this make somebody install the app" is a human call, and the
// guard says so rather than implying green means approved.
//
// Usage:  node tooling/store/render-play-graphics.mjs [--app subly] [--check]
//         --check renders to a temp dir and DIFFS against the committed files
//         instead of overwriting them, so CI can prove they are still the
//         output of this script rather than something somebody dropped in.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { render, pngHeader, RasterUnavailable } from './chrome-raster.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(HERE, '..', '..'));

const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const app = (() => {
  const i = argv.indexOf('--app');
  return i !== -1 && argv[i + 1] ? argv[i + 1] : 'subly';
})();

/** Play's numbers. Each one carries the page it came from and the day it was
 *  read, because an invented limit fires on CORRECT input — this repo has
 *  already rejected its own fixture at 129 characters against a made-up "120 or
 *  fewer". Nothing here may be edited without re-fetching the page. */
const PLAY = {
  source: 'https://support.google.com/googleplay/android-developer/answer/9866151',
  fetched: '2026-08-04',
  featureGraphic: { width: 1024, height: 500, alpha: false, quote: 'JPEG or 24-bit PNG (no alpha) · Dimensions: 1024px by 500px' },
  appIcon: { width: 512, height: 512, alpha: true, maxBytes: 1024 * 1024, quote: '32-bit PNG (with alpha) · Dimensions: 512px by 512px · Maximum file size: 1024KB' },
};

const fail = (lines) => {
  console.error(`render-play-graphics: REFUSING — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

// ── the brand, read out of the committed SVGs ───────────────────────────────
const BRAND_DIR = join(ROOT, 'apps', app, 'assets', 'icon');
const FG = join(BRAND_DIR, 'app_icon_foreground.svg');
const BG = join(BRAND_DIR, 'app_icon_background.svg');
for (const p of [FG, BG]) {
  if (!existsSync(p)) {
    fail([
      `${p.replace(ROOT, '.')} does not exist.`,
      'The brand gradients and the mark geometry are READ from these files rather than copied into this',
      'script, so that a re-colour propagates. With the source gone there is nothing to derive from, and',
      'rendering a built-in fallback would emit a listing graphic in colours nobody chose.',
    ]);
  }
}
const fgSvg = readFileSync(FG, 'utf8');
const bgSvg = readFileSync(BG, 'utf8');

/** `<stop offset="X" stop-color="#RRGGBB" [stop-opacity="O"]/>` inside the named
 *  gradient. Parsed from the gradient's own element, never by grepping the file
 *  for colours: both SVGs carry explanatory prose ABOVE the markup that names
 *  hex values, and a bare colour regex would happily read the comment. That is
 *  the prose-vs-structure trap assert-clone-contract.mjs was written for. */
function gradientStops(svg, id) {
  const open = new RegExp(`<(linear|radial)Gradient[^>]*\\bid="${id}"[^>]*>`);
  const m = svg.match(open);
  if (!m) return null;
  const from = svg.indexOf(m[0]) + m[0].length;
  const close = svg.indexOf(`</${m[1]}Gradient>`, from);
  if (close === -1) return null;
  const body = svg.slice(from, close);
  const stops = [...body.matchAll(/<stop\b([^>]*)\/?>/g)].map((s) => ({
    offset: (s[1].match(/\boffset="([^"]+)"/) ?? [])[1],
    color: (s[1].match(/\bstop-color="([^"]+)"/) ?? [])[1],
    opacity: (s[1].match(/\bstop-opacity="([^"]+)"/) ?? [])[1],
  }));
  return stops.length ? stops : null;
}

/** The mark itself: the single stroked `<path d="…">` of the foreground layer,
 *  with its stroke width. Taken as data — the same path string the launcher
 *  icons are drawn from. */
function markPath(svg) {
  const m = svg.match(/<path\b[^>]*\bd="([^"]+)"[^>]*>/);
  if (!m) return null;
  const attrs = m[0];
  const width = (attrs.match(/\bstroke-width="([^"]+)"/) ?? [])[1];
  return width ? { d: m[1], strokeWidth: Number(width) } : null;
}

const MONO = gradientStops(fgSvg, 'MONO');
const TILE = gradientStops(bgSvg, 'TILE');
const GLOW = gradientStops(bgSvg, 'GLOW');
const MARK = markPath(fgSvg);

// 🔴 REFUSE, never fall back. Each of these four is the whole visual identity of
// the graphic; a missing one silently renders a different brand.
for (const [name, v] of [['MONO', MONO], ['TILE', TILE], ['GLOW', GLOW], ['mark path', MARK]]) {
  if (!v) {
    fail([
      `could not parse the ${name} out of the committed brand SVGs.`,
      'The SVG structure changed under this parser. Rendering anyway would emit a listing graphic whose',
      'colours came from this script instead of from the brand — correct-looking, and wrong in a way',
      'nobody would spot until it was on the store.',
    ]);
  }
}

const stopsXml = (stops) =>
  stops
    .map((s) => `<stop offset="${s.offset}" stop-color="${s.color}"${s.opacity !== undefined ? ` stop-opacity="${s.opacity}"` : ''}/>`)
    .join('');

// ── the feature graphic ─────────────────────────────────────────────────────
// Composition, and the reason for each piece (Google's own "Highly recommended"
// guidance on the SAME page the dimensions came from):
//
//   · "Keep prominent visuals and the focal point towards the center of the
//     graphic" and "Avoid placing key elements … in the cutoff zones"  → the
//     mark is centred and occupies the middle half; nothing load-bearing is
//     within 190px of either edge.
//   · "Restrict background elements to the edges of the graphic"      → the
//     oversized ghost mark bleeds off the right edge at 6% opacity and carries
//     no information.
//   · "avoid using pure white or dark gray… Consider using more vibrant colors" →
//     the brand TILE navy is kept as the base (it IS the brand and is a
//     saturated navy, not gray) and the MONO blue→teal is used at strength as a
//     glow so the graphic reads vibrant rather than flat dark.
//   · "Do not use prominent branding that is similar to your app icon, as this
//     will cause duplications when shown in context with your app icon"  → the
//     rounded icon TILE is deliberately NOT reproduced. The mark appears on the
//     open gradient field, which is the "extension of your app icon" the same
//     paragraph asks for.
function featureGraphicSvg() {
  const { width: W, height: H } = PLAY.featureGraphic;
  const markBox = 1024; // the brand SVGs' own viewBox
  const scale = 300 / markBox; // painted extent of the mark is ~52% of the box
  const tx = W / 2 - (markBox * scale) / 2;
  const ty = H / 2 - (markBox * scale) / 2;
  const ghost = 900 / markBox;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<linearGradient id="TILE" x1="0" y1="0" x2="0.35" y2="1">${stopsXml(TILE)}</linearGradient>
<radialGradient id="GLOW" cx="0.5" cy="0.05" r="0.9">${stopsXml(GLOW)}</radialGradient>
<linearGradient id="MONO" x1="0.05" y1="1" x2="0.95" y2="0">${stopsXml(MONO)}</linearGradient>
<radialGradient id="ACCENT" cx="0.5" cy="0.5" r="0.5">
<stop offset="0" stop-color="${MONO[1].color}" stop-opacity="0.34"/>
<stop offset="1" stop-color="${MONO[1].color}" stop-opacity="0"/>
</radialGradient>
<radialGradient id="ACCENT2" cx="0.5" cy="0.5" r="0.5">
<stop offset="0" stop-color="${MONO[2].color}" stop-opacity="0.26"/>
<stop offset="1" stop-color="${MONO[2].color}" stop-opacity="0"/>
</radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#TILE)"/>
<rect width="${W}" height="${H}" fill="url(#GLOW)"/>
<ellipse cx="${W * 0.5}" cy="${H * 0.52}" rx="${W * 0.42}" ry="${H * 0.62}" fill="url(#ACCENT)"/>
<ellipse cx="${W * 0.82}" cy="${H * 0.18}" rx="${W * 0.3}" ry="${H * 0.5}" fill="url(#ACCENT2)"/>
<g transform="translate(${W * 0.78} ${H * 0.5}) scale(${ghost}) translate(${-markBox / 2} ${-markBox / 2})" opacity="0.06">
<path d="${MARK.d}" fill="none" stroke="${MONO[2].color}" stroke-width="${MARK.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<g transform="translate(${tx} ${ty}) scale(${scale})">
<path d="${MARK.d}" fill="none" stroke="url(#MONO)" stroke-width="${MARK.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>
</g>
</svg>`;
}

// ── the 512 store icon ──────────────────────────────────────────────────────
// 🔴 DERIVED FROM app_icon_1024.png, THE SAME MASTER flutter_launcher_icons
// USES — not re-drawn from the SVG layers. Google: "The app icon does not
// replace your app's launcher icon but should be a higher-fidelity,
// higher-resolution version", so the store icon and the launcher icon have to be
// the SAME artwork. Re-composing the rounded tile from the two adaptive layers
// would reproduce it approximately and diverge the first time the master is
// regenerated with anything the layers do not carry.
//
// The downscale is 1024 → 512, an exact 2:1, so the resampler has no room to
// invent detail. Chrome does it; there is no image library in this repo and
// adding one to halve a PNG would be a dependency for arithmetic.
function storeIconHtml() {
  const master = join(BRAND_DIR, 'app_icon_1024.png');
  if (!existsSync(master)) {
    fail([
      `${master.replace(ROOT, '.')} does not exist.`,
      'That file is the launcher-icon master. The Play store icon is REQUIRED to be the same artwork, so',
      'there is nothing honest to render without it.',
    ]);
  }
  const b64 = readFileSync(master).toString('base64');
  const { width: W, height: H } = PLAY.appIcon;
  // Explicit margin:0 — an HTML document (unlike an SVG document) gets the UA's
  // 8px body margin, which would offset the icon and clip 8px off two edges
  // while still producing a 512x512 file. Correct size, wrong picture.
  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent}
img{display:block;width:${W}px;height:${H}px;image-rendering:auto}
</style><img src="data:image/png;base64,${b64}" width="${W}" height="${H}">`;
}

// ── the rasteriser ──────────────────────────────────────────────────────────
// Shared with tooling/store/capture-play-screenshots.mjs. See that module's
// header for why `--default-background-color` is the whole alpha story and why
// Chrome is the rasteriser rather than an image dependency.

/** Verify what was just written against the SOURCED requirement. A renderer
 *  that silently emitted 1023x500 would still "work"; the Play Console is where
 *  it would be found out, which is the whole failure mode this repo removes. */
function verify(label, file, spec) {
  const buf = readFileSync(file);
  const h = pngHeader(buf);
  if (!h) fail([`${label}: the rasteriser did not produce a readable PNG (${buf.length} bytes).`]);
  const problems = [];
  if (h.width !== spec.width || h.height !== spec.height) {
    problems.push(`is ${h.width}x${h.height} and Play requires exactly ${spec.width}x${spec.height} — "${spec.quote}" (${PLAY.source}, fetched ${PLAY.fetched})`);
  }
  const hasAlpha = h.colourType === 4 || h.colourType === 6;
  if (hasAlpha !== spec.alpha) {
    problems.push(
      spec.alpha
        ? `has NO alpha channel (PNG colour type ${h.colourType}) and Play requires a "32-bit PNG (with alpha)"`
        : `HAS an alpha channel (PNG colour type ${h.colourType}) and Play requires a "24-bit PNG (no alpha)"`,
    );
  }
  if (spec.maxBytes && buf.length > spec.maxBytes) {
    problems.push(`is ${buf.length} bytes and Play's maximum is ${spec.maxBytes}`);
  }
  if (problems.length) fail([`${label} does not meet Play's requirement.`, ...problems]);
  return { ...h, bytes: buf.length };
}

// ── run ─────────────────────────────────────────────────────────────────────
const outDir = join(ROOT, 'apps', app, 'store', 'android-play');
const targets = [
  {
    label: 'feature graphic',
    file: join(outDir, 'feature-graphic.png'),
    markup: featureGraphicSvg(),
    ext: 'svg',
    spec: PLAY.featureGraphic,
  },
  {
    label: 'store icon',
    file: join(outDir, 'store-icon-512.png'),
    markup: storeIconHtml(),
    ext: 'html',
    spec: PLAY.appIcon,
  },
];

const stage = CHECK ? join(tmpdir(), `nk-play-check-${randomBytes(4).toString('hex')}`) : null;
if (stage) mkdirSync(stage, { recursive: true });

let drifted = 0;
for (const t of targets) {
  const dest = stage ? join(stage, t.label.replace(/\s+/g, '-') + '.png') : t.file;
  try {
    render({ markup: t.markup, ext: t.ext, out: dest, width: t.spec.width, height: t.spec.height, alpha: t.spec.alpha });
  } catch (e) {
    if (e instanceof RasterUnavailable) fail(e.lines);
    throw e;
  }
  const h = verify(t.label, dest, t.spec);
  if (stage) {
    if (!existsSync(t.file)) {
      console.error(`FAIL ${t.file.replace(ROOT, '.')} does not exist — this script produces it. Run without --check.`);
      drifted++;
      continue;
    }
    // Bytes, not pixels. Chrome is deterministic for the same input on the same
    // build, so a byte difference means the brand source moved and the committed
    // graphic was not regenerated with it — which is the drift worth catching.
    const a = readFileSync(dest);
    const b = readFileSync(t.file);
    if (!a.equals(b)) {
      console.error(`FAIL ${t.file.replace(ROOT, '.')} is NOT what this script currently renders (${b.length} vs ${a.length} bytes).`);
      console.error('     The brand SVGs or this composition changed and the committed graphic was not regenerated.');
      console.error('     Run: node tooling/store/render-play-graphics.mjs');
      drifted++;
    } else {
      console.log(`ok   ${t.label} — committed file matches a fresh render (${h.width}x${h.height}, colour type ${h.colourType}, ${h.bytes} bytes)`);
    }
  } else {
    console.log(`ok   ${t.label} → ${t.file.replace(ROOT, '.')} (${h.width}x${h.height}, colour type ${h.colourType}, ${h.bytes} bytes)`);
  }
}
if (stage) rmSync(stage, { recursive: true, force: true });

console.log('');
console.log(`   brand source: apps/${app}/assets/icon/app_icon_{foreground,background}.svg + app_icon_1024.png`);
console.log(`   Play requirements: ${PLAY.source} (fetched ${PLAY.fetched})`);
console.log('   ⬜ no wordmark — Montserrat ExtraBold is not in this repo and a CSS font stack would render');
console.log('      differently on every machine. See this file\'s header for the two rejected alternatives.');
console.log('   ⚠️ this script proves SIZE, FORMAT and PROVENANCE. Whether the graphic is any good is a');
console.log('      human judgement it does not make.');

if (drifted) {
  console.error('\nrender-play-graphics: DRIFTED');
  process.exit(1);
}
console.log('\nrender-play-graphics: ok');
