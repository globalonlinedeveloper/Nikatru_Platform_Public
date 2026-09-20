#!/usr/bin/env node
/* render-extension-graphics.mjs — the listing graphics that are DERIVABLE,
   derived. No browser, no font, no model in the loop.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/render-extension-graphics.mjs fullshot
     node scripts/render-extension-graphics.mjs --all
     node scripts/render-extension-graphics.mjs fullshot --check

   ── WHY IT EXISTS ──────────────────────────────────────────────────────────
   Capturing screenshots does NOT unblock the Chrome Web Store. Chrome REQUIRES
   a 440x280 small promotional tile and a 128x128 store icon; Edge REQUIRES a
   1:1 logo at a recommended 300x300. Measured 2026-09-20, before this script:
   no slot for any of the three existed anywhere under `extensions/` -- not in
   a tool's store/chrome, store/edge, store/firefox or store/_shared, and not in
   templates/tool/store either. `check-store-metadata.mjs`'s REQUIRED_SHARED was
   three text files and a README, and a comment at the top of that file knew the
   icon sizes while nothing graded them. A listing with five perfect screenshots
   and no tile is refused at upload.

   These are RENDER jobs, not capture jobs, and the precedent is the platform
   repo's `tooling/store/render-play-graphics.mjs`, which already derives Play's
   feature graphic and store icon. This is the same idea on the extension side
   of the tree, with the same three rules taken from it:

   ── 1. DERIVED FROM WHAT SHIPS, PARSED, NEVER RETYPED ──────────────────────
   The mark is the extension's OWN committed 128x128 icon, read from disk at the
   path the MANIFEST names (`icons["128"]`), and composited at its NATIVE size:
   no upscale anywhere, so no listing asset is softer than the icon the browser
   already shows. The colours are the `--accent` custom properties parsed out of
   the extension's own shipped stylesheets. Re-colour the product and the next
   run re-colours the listing. Neither fact is retyped here, and `--check` is
   what makes that testable rather than merely intended: it re-renders and
   compares the committed asset's PIXELS, so an icon or an accent that moved
   while the listing did not shows up as a named failure.
   If either parse yields nothing this script REFUSES (exit 2) rather
   than falling back to a built-in default -- a silent fallback renders a
   correct-looking graphic in colours nobody chose, which is the failure nobody
   can see afterwards.

   ── 2. NO TEXT, AND THAT IS A RECORDED GAP RATHER THAN AN OVERSIGHT ────────
   THERE IS NO FONT FILE IN THIS REPOSITORY. Rendering the product name with a
   CSS font stack would substitute whatever the host has -- Segoe UI on the
   owner's Windows box, DejaVu Sans on ubuntu-24.04 -- so the same command would
   produce a DIFFERENT tile on every machine, which is exactly the drift this
   tree exists to prevent. Vendoring an OFL face is legitimate and is owner
   legal sign-off, not a side effect of a graphics script. So the tiles are
   composed from GEOMETRY ALONE, which is also where Chrome's own guidance
   steers: the store renders `title.txt` beside the tile on every surface that
   shows it, so the name is not lost. This script PRINTS the gap on every run so
   it stays a decision somebody can revisit.

   ── 3. NO THIRD-PARTY MARK, AND NOTHING INVENTED ───────────────────────────
   Every pixel emitted comes from two places: the extension's own committed icon
   and the extension's own committed accent colours. No other image is read, no
   name is drawn, and no brand this project does not own can appear in the
   output -- there is no code path that could put one there.

   ⚠️ WHAT THIS SCRIPT CANNOT JUDGE: whether the result is GOOD. It proves the
   bytes are the right size and colour type and that they came from the tool's
   own assets. "Does this make somebody install the extension" is a human call.

   `--check` re-renders and compares the DECODED PIXELS of the committed file,
   not its bytes: a byte diff would also fail on a zlib version change between
   the machine that committed and the machine that checks, which says nothing
   about the picture.

   Exit codes: 0 rendered/agrees · 1 --check disagrees · 2 could not run. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Report, parseArgs, die } from './lib/report.mjs';
import { repoRoot, resolveTool, loadAllTools } from './lib/toolinfo.mjs';
import { decode, encode, resample } from './lib/png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPEC_REL = 'scripts/store-graphics.json';

const args = parseArgs(process.argv.slice(2));
args.rejectUnknown(['all', 'repo-root', 'check']);
const root = repoRoot(args);
const CHECK = args.bool('check');

/* The spec is resolved against THIS FILE, not against --repo-root: what a store
   requires belongs to the toolchain, and the tree being rendered is the
   subject. Same reasoning as check-store-metadata.mjs's schema resolution. */
const specAbs = path.join(HERE, 'store-graphics.json');
if (!fs.existsSync(specAbs)) die(SPEC_REL + ' does not exist, so there is nothing to render against.');
let SPEC;
try { SPEC = JSON.parse(fs.readFileSync(specAbs, 'utf8')); }
catch (e) { die('could not parse ' + SPEC_REL + ': ' + e.message); }
if (!Array.isArray(SPEC.assets) || !SPEC.assets.length) {
  die(SPEC_REL + ' declares no `assets`, so this script would render nothing and exit 0.');
}

let tools;
if (args.bool('all')) {
  const all = loadAllTools(root);
  if (all.errors.length) die('tool.json problems, so the tool set is not the tree:\n' + all.errors.map((e) => '  - ' + e).join('\n'));
  tools = all.tools;
} else {
  tools = [resolveTool(root, args.positional[0])];
}
if (!tools.length) die('no tool resolved — nothing to render.');

const r = new Report('render-extension-graphics · ' + tools.map((t) => t.id).join(', '));

/* ── the brand, parsed out of the product ────────────────────────────────── */
const HEX = /^#([0-9a-fA-F]{6})$/;
function rgbOf(hex) {
  const m = HEX.exec(hex.trim());
  if (!m) return null;
  return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
}
/* Every shipped stylesheet, in sorted path order so two machines read the same
   file first. `test/`, `publish/` and any node_modules are excluded: those are
   build-time trees and a fixture's colours are not the product's. */
function shippedStylesheets(dirAbs) {
  const out = [];
  const walk = (abs, rel) => {
    let kids;
    try { kids = fs.readdirSync(abs, { withFileTypes: true }); } catch (_) { return; }
    for (const k of kids.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (k.name === 'node_modules' || k.name === 'test' || k.name === 'publish' ||
          k.name === 'store' || k.name === 'Reference' || k.name[0] === '.') continue;
      const childAbs = path.join(abs, k.name);
      const childRel = rel ? rel + '/' + k.name : k.name;
      if (k.isDirectory()) walk(childAbs, childRel);
      else if (k.isFile() && k.name.endsWith('.css')) out.push({ abs: childAbs, rel: childRel });
    }
  };
  walk(dirAbs, '');
  return out;
}
function accentsOf(tool) {
  const seen = [];
  const where = [];
  for (const css of shippedStylesheets(tool.dirAbs)) {
    const text = fs.readFileSync(css.abs, 'utf8');
    for (const m of text.matchAll(/--accent\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
      const rgb = rgbOf(m[1]);
      if (!rgb) continue;
      const key = m[1].toLowerCase();
      if (seen.some((s) => s.key === key)) continue;
      seen.push({ key, rgb });
      where.push(css.rel + ' → ' + key);
    }
  }
  return { seen, where };
}

/* ── the mark, read from the path the manifest names ─────────────────────── */
function markOf(tool) {
  const mfRel = typeof tool.manifest === 'string' && tool.manifest ? tool.manifest : 'manifest.json';
  const mfAbs = path.join(tool.dirAbs, mfRel);
  if (!fs.existsSync(mfAbs)) return { error: mfRel + ' does not exist, so the icon path cannot be read from it.' };
  let mf;
  try { mf = JSON.parse(fs.readFileSync(mfAbs, 'utf8')); }
  catch (e) { return { error: mfRel + ' does not parse: ' + e.message }; }
  const rel = mf?.icons?.['128'];
  if (typeof rel !== 'string' || !rel) {
    return { error: mfRel + ' declares no icons["128"], and that is the only size this script composites at 1:1.' };
  }
  const abs = path.join(tool.dirAbs, rel);
  if (!fs.existsSync(abs)) return { error: mfRel + ' names icons["128"] = "' + rel + '" and no such file exists.' };
  let img;
  try { img = decode(fs.readFileSync(abs)); }
  catch (e) { return { error: rel + ' could not be decoded: ' + e.message }; }
  if (img.width !== 128 || img.height !== 128) {
    return { error: rel + ' is ' + img.width + 'x' + img.height + ' and the manifest files it as the 128 icon.' };
  }
  return { img, rel };
}

/* ── drawing, all of it analytic and all of it deterministic ─────────────── */
const SS = 4; /* coverage supersampling, per axis */
function canvas(w, h) { return { w, h, px: new Uint8ClampedArray(w * h * 4) }; }

/* Vertical two-stop gradient across the whole canvas, fully opaque. */
function gradient(c, top, bottom) {
  for (let y = 0; y < c.h; y++) {
    const t = c.h === 1 ? 0 : y / (c.h - 1);
    const r = Math.round(top[0] + (bottom[0] - top[0]) * t);
    const g = Math.round(top[1] + (bottom[1] - top[1]) * t);
    const b = Math.round(top[2] + (bottom[2] - top[2]) * t);
    for (let x = 0; x < c.w; x++) {
      const o = (y * c.w + x) * 4;
      c.px[o] = r; c.px[o + 1] = g; c.px[o + 2] = b; c.px[o + 3] = 255;
    }
  }
}

/* Signed coverage of a rounded rectangle, supersampled SSxSS per pixel. The
   shape is defined by a point test rather than by a path walk, so the same
   arithmetic runs on every machine and there is no rasteriser in the loop. */
function insideRound(px, py, x0, y0, x1, y1, rad) {
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  const cx = px < x0 + rad ? x0 + rad : px > x1 - rad ? x1 - rad : px;
  const cy = py < y0 + rad ? y0 + rad : py > y1 - rad ? y1 - rad : py;
  if (cx === px && cy === py) return true;
  const dx = px - cx, dy = py - cy;
  return dx * dx + dy * dy <= rad * rad;
}
/* 🔴 SOURCE-OVER, WRITTEN OUT IN FULL, BECAUSE THE SHORT FORM IS WRONG ON A
   TRANSPARENT BACKDROP. The familiar `dst*(1-a) + src*a` is correct only where
   the destination is opaque. Over the zeroed canvas the store icon is composed
   on, it multiplies every edge pixel's colour by its own alpha and leaves a
   dark halo around the mark -- a file that looks fine at 128px in a viewer and
   fringes black the moment the store composites it on anything. The Porter-Duff
   form divides that back out, and with an opaque destination it reduces to the
   short form, so one function serves both compositions. */
function over(px, d, rgb, a) {
  if (a <= 0) return;
  const da = px[d + 3] / 255;
  const oa = a + da * (1 - a);
  if (oa <= 0) { px[d] = px[d + 1] = px[d + 2] = px[d + 3] = 0; return; }
  px[d] = Math.round((rgb[0] * a + px[d] * da * (1 - a)) / oa);
  px[d + 1] = Math.round((rgb[1] * a + px[d + 1] * da * (1 - a)) / oa);
  px[d + 2] = Math.round((rgb[2] * a + px[d + 2] * da * (1 - a)) / oa);
  px[d + 3] = Math.round(oa * 255);
}
function roundRect(c, x0, y0, w, h, rad, rgb, alpha = 1) {
  const x1 = x0 + w, y1 = y0 + h;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(c.h, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(c.w, Math.ceil(x1)); x++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          if (insideRound(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS, x0, y0, x1, y1, rad)) hit++;
        }
      }
      if (!hit) continue;
      over(c.px, (y * c.w + x) * 4, rgb, alpha * (hit / (SS * SS)));
    }
  }
}

/* Source-over composite of an RGBA image at an integer offset. NO SCALING:
   the mark is placed at its native size or not at all. */
function blit(c, img, ox, oy) {
  for (let y = 0; y < img.height; y++) {
    const ty = oy + y;
    if (ty < 0 || ty >= c.h) continue;
    for (let x = 0; x < img.width; x++) {
      const tx = ox + x;
      if (tx < 0 || tx >= c.w) continue;
      const s = (y * img.width + x) * 4;
      over(c.px, (ty * c.w + tx) * 4, [img.rgba[s], img.rgba[s + 1], img.rgba[s + 2]], img.rgba[s + 3] / 255);
    }
  }
}

/* ── the three compositions ──────────────────────────────────────────────── */
function renderStoreIcon(asset, mark) {
  /* Chrome: 128x128 with the artwork in 96x96 and 16px of TRANSPARENT padding
     on every side. The mark is the only thing that is ever scaled by this
     script, and it is scaled DOWN (128 -> 96), which is the direction that
     loses nothing visible. */
  const box = asset.artworkBox;
  const c = canvas(asset.width, asset.height); /* zeroed = fully transparent */
  const small = resample(mark.img.rgba, mark.img.width, mark.img.height, box, box);
  blit(c, { width: box, height: box, rgba: small },
    Math.round((asset.width - box) / 2), Math.round((asset.height - box) / 2));
  return c;
}
function renderTile(asset, mark, accents) {
  /* Accent gradient, a white card, the mark at 1:1 on the card. The card is
     what keeps an indigo mark legible on an indigo field; without it the two
     brand colours sit on top of each other. */
  const c = canvas(asset.width, asset.height);
  gradient(c, accents[0].rgb, (accents[1] || accents[0]).rgb);
  const card = Math.min(asset.width, asset.height) - Math.round(Math.min(asset.width, asset.height) * 0.28);
  const cx = Math.round((asset.width - card) / 2), cy = Math.round((asset.height - card) / 2);
  roundRect(c, cx, cy, card, card, Math.round(card * 0.14), [255, 255, 255], 1);
  blit(c, mark.img, Math.round((asset.width - mark.img.width) / 2), Math.round((asset.height - mark.img.height) / 2));
  return c;
}

function compose(asset, mark, accents) {
  if (asset.id === 'store-icon-128') return renderStoreIcon(asset, mark);
  return renderTile(asset, mark, accents);
}

/* ── run ─────────────────────────────────────────────────────────────────── */
let rendered = 0, compared = 0;
for (const tool of tools) {
  const sm = tool.raw?.storeMetadata ?? tool.storeMetadata;
  const sharedDir = typeof sm?.sharedDir === 'string' ? sm.sharedDir : null;
  if (!sharedDir) {
    r.fail(tool.rel + ' declares storeMetadata.sharedDir',
      'the shared listing directory is where the shared assets go, and nothing names it.');
    continue;
  }
  const storeRootRel = path.posix.dirname(sharedDir.replace(/\\/g, '/'));

  const mark = markOf(tool);
  if (mark.error) { r.fail(tool.rel + ' has a readable 128x128 mark', mark.error); continue; }
  r.note(tool.rel + ': mark = ' + mark.rel + ' (128x128, composited at 1:1)');

  const { seen: accents, where } = accentsOf(tool);
  if (!accents.length) {
    r.fail(tool.rel + ' declares an --accent colour in a shipped stylesheet',
      'no `--accent: #rrggbb;` was found in any .css outside test/, publish/ and store/.\n' +
      'This script REFUSES rather than falling back to a built-in colour: a graphic rendered in a\n' +
      'colour nobody chose looks correct and is wrong, and nothing downstream can see it.');
    continue;
  }
  r.note(tool.rel + ': accents = ' + where.join(', '));

  for (const asset of SPEC.assets) {
    const relFromStore = asset.path;
    const outRel = storeRootRel === '.' ? relFromStore : storeRootRel + '/' + relFromStore;
    const outAbs = path.join(tool.dirAbs, outRel);
    const label = tool.rel + '/' + outRel;

    let c;
    try { c = compose(asset, mark, accents); }
    catch (e) { r.fail(label + ' renders', String(e && e.message || e)); continue; }
    /* The colour type is the FIRST entry the spec lists, not a decision made
       here: the spec's row is what the guard grades against, so a renderer that
       chose its own could emit a file its own guard refuses. */
    const colorType = asset.colorTypes[0];
    let bytes;
    try { bytes = encode({ width: c.w, height: c.h, rgba: c.px, colorType }); }
    catch (e) { r.fail(label + ' encodes', String(e && e.message || e)); continue; }

    if (CHECK) {
      compared++;
      if (!fs.existsSync(outAbs)) {
        r.fail(label + ' exists', 'the committed asset is absent, so there is nothing to compare this render against.');
        continue;
      }
      let have;
      try { have = decode(fs.readFileSync(outAbs)); }
      catch (e) { r.fail(label + ' decodes', String(e && e.message || e)); continue; }
      const want = decode(bytes);
      if (have.width !== want.width || have.height !== want.height) {
        r.fail(label + ' is the size this script renders',
          'committed ' + have.width + 'x' + have.height + ', rendered ' + want.width + 'x' + want.height);
        continue;
      }
      let diff = 0;
      for (let i = 0; i < want.rgba.length; i++) if (have.rgba[i] !== want.rgba[i]) diff++;
      if (diff) {
        r.fail(label + ' is this script\'s output',
          diff + ' of ' + want.rgba.length + ' RGBA bytes differ. Either the committed file was hand-edited or the\n' +
          'tool\'s icon/accents moved without the listing being re-rendered. Re-run without --check.');
      } else {
        r.pass(label, want.width + 'x' + want.height + ' — pixel-identical to this script\'s output');
      }
      continue;
    }

    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, bytes);
    rendered++;
    r.pass(label, c.w + 'x' + c.h + ', colour type ' + colorType + ', ' + bytes.length + ' bytes' +
      '  [required by: ' + (asset.requiredBy.join(', ') || 'nobody') + ']');
  }
}

if (!rendered && !compared) {
  die('zero assets were rendered or compared across ' + tools.length + ' tool(s).\n' +
    'Every tool refused above, or scripts/store-graphics.json declares assets this script cannot compose.');
}

r.blank();
r.note('NO WORDMARK IS DRAWN. There is no font file in this repository and a CSS font stack would');
r.note('substitute a different face on every host, so the tiles are geometry only. The store renders');
r.note('store/<store>/title.txt beside them. This gap prints on every run so it stays revisitable.');
r.note((CHECK ? compared + ' asset(s) compared' : rendered + ' asset(s) written') + ' across ' + tools.length + ' tool(s).');

process.exit(r.finish());
