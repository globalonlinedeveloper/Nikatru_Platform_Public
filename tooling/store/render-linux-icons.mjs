#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// render-linux-icons.mjs — the Linux launcher icon, which is a PACKAGING
// artefact and therefore could not be produced the way the other five were.
//
// [pipeline S-14] "A stamp carries the app's brand assets, not Flutter's."
//
// ── WHY LINUX WAS THE ONE PLATFORM #149 DID NOT REACH ───────────────────────
// #149 branded Android, iOS, macOS, Windows and web from one master through
// `flutter_launcher_icons`. That tool has NO Linux target, and it is not an
// oversight on its part: Flutter's Linux embedder has no icon slot at all.
// Measured 2026-08-04 — a freshly created app has ten files under `linux/` and
// ZERO images, and the generated GTK runner never calls a set-icon function. So
// "add a file where the others are" has no where.
//
// On Linux the launcher icon is supplied by the DESKTOP ENTRY SPECIFICATION and
// the ICON THEME SPECIFICATION, and every packaging layer — snap, flatpak, deb,
// AppImage — consumes exactly those two things:
//
//   share/applications/<app-id>.desktop        `Icon=<name>`, no path, no suffix
//   share/icons/hicolor/<S>x<S>/apps/<name>.png    one file per declared size
//
// Sources, both read 2026-08-04:
//   https://specifications.freedesktop.org/desktop-entry-spec/latest/
//   https://specifications.freedesktop.org/icon-theme-spec/latest/
// The `Icon` key: "if the name is not an absolute path, the algorithm described
// in the Icon Theme Specification will be used to locate the icon" — which is
// why the value below is a bare NAME and why the PNG lives at a size-qualified
// theme path rather than next to the binary.
//
// That is packaging-layer-agnostic ON PURPOSE. `submit-snap.yml` records that
// there is no `snapcraft.yaml` yet and that writing one is deferred work; if
// this had been written as snap-specific art it would have to be rewritten the
// day a flatpak or a .deb is wanted, and the icon would be a snap concern rather
// than the app's. These two artefacts are the INPUT every recipe stages.
//
// ── WHY A DOWNSCALER AND NOT A RASTERISER ───────────────────────────────────
// The sibling generator (`render-play-graphics.mjs`) drives headless Chrome,
// which is right for laying out a 1024x500 feature graphic from markup and wrong
// here: there is no layout to do. The master `assets/icon/app_icon_1024.png` is
// already the app's mark, at the largest size anything asks for, and every size
// below is a pure downscale of it.
//
// 1024 divides EXACTLY by every declared size, so each output pixel is the mean
// of a whole f×f block — no resampling kernel, no phase, no invented tolerance,
// and byte-for-byte the same answer on every machine. That is what lets
// `assert-launcher-icons.mjs` RE-DERIVE the committed icons and refuse one that
// somebody dropped in by hand or that went stale when the master changed. A
// non-integer ratio would force a filter choice, and a filter choice is a number
// nobody sourced.
//
// 🔴 NO MODEL IS INVOLVED ANYWHERE, so [ADR 019]'s NO-IP-PROMPTING rule is
// obeyed by construction rather than by review — same property, same reason, as
// `tooling/bricks/app/hooks/brand_assets.dart`. The output is arithmetic over
// bytes already in the tree.
//
// ── WHAT THE .desktop FILE IS DERIVED FROM ──────────────────────────────────
// Its text is NOT typed here. `Name`, `Comment` and `Categories` come from the
// app's own `store/linux-snap/*.txt` — the same files the Snap listing is built
// from — and `Exec`/`Icon` come from `linux/CMakeLists.txt`'s `BINARY_NAME` and
// `APPLICATION_ID`. [pipeline D-5]'s rule, applied to the one listing-adjacent
// file that also ships inside the package: a second hand-typed copy of the app's
// name is the copy that goes stale.
//
// Usage:
//   node tooling/store/render-linux-icons.mjs --app subly            # write
//   node tooling/store/render-linux-icons.mjs --app subly --check    # verify
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// THE ONE PNG DECODER. Not a local copy: two readers with two ideas of what a
// PNG is is precisely how assert-stamp-brand-assets.mjs spent weeks comparing
// against empty buffers while printing a healthy count. See that module's header.
import { decodeRgba, encodeRgba, PngUnreadable } from './png-codec.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(HERE, '..', '..'));

/**
 * The hicolor sizes this factory ships, and THE ONE PLACE THEY ARE DECLARED.
 * `assert-launcher-icons.mjs` imports this array rather than repeating it — two
 * copies of "which sizes exist" is how a guard ends up certifying four files
 * while five ship, which is the empty-domain failure in miniature.
 *
 * Every one divides 1024 exactly (÷2, ÷4, ÷8, ÷16), which is the property the
 * header's re-derivation argument rests on. 48 and 32 are deliberately absent:
 * they do not divide 1024 into whole blocks, and GTK downscales from a larger
 * theme entry perfectly well.
 */
export const HICOLOR_SIZES = [512, 256, 128, 64];

/** Where an app's Linux packaging inputs live, relative to the app directory. */
export const PACKAGING_DIR = 'linux/packaging';

/**
 * Snap Store category → freedesktop `Categories` value.
 *
 * 🔴 A MAP, AND AN UNKNOWN KEY IS A HARD FAILURE, because the two vocabularies
 * are NOT the same and passing one through as the other produces a file that
 * validates nowhere. "Productivity" is a Snap Store category and is not a
 * registered freedesktop category at all; `desktop-file-validate` rejects it.
 * Guessing a mapping is the same class of mistake as an invented character
 * limit — it fires on correct input, silently, at package time.
 *
 * Registered categories, read 2026-08-04:
 * https://specifications.freedesktop.org/menu-spec/latest/apa.html
 */
const CATEGORY_MAP = new Map([['Productivity', 'Office']]);

/** Desktop Entry Specification version this file claims to follow. Not the
 *  app's version — the spec's. Source in the header. */
const DESKTOP_ENTRY_SPEC_VERSION = '1.5';

export class LinuxBrandUnavailable extends Error {
  constructor(lines) {
    super(lines[0]);
    this.lines = lines;
  }
}

// ── the one image operation this generator owns ────────────────────
// Decoding and encoding live in png-codec.mjs, which the guard reads too. What
// is specific to LAUNCHER ICONS is the downscale, and it stays here.

/**
 * Downscale RGBA by an INTEGER factor, averaging each f×f block.
 *
 * RGB is averaged ALPHA-WEIGHTED and then un-premultiplied. Averaging colour
 * straight would drag the mark's edge pixels toward whatever colour happens to
 * sit under a fully transparent pixel — usually black — and produce a dark halo
 * that only appears at the small sizes, i.e. exactly where nobody looks.
 */
export function boxDownscale({ width, height, rgba }, size) {
  if (width !== height) throw new LinuxBrandUnavailable([`master is ${width}x${height}, not square`]);
  if (width % size !== 0) {
    throw new LinuxBrandUnavailable([
      `${width} does not divide by ${size} into whole blocks.`,
      'Every declared size divides the master exactly so that each output pixel is the mean of a whole',
      'block — no kernel, no phase, no invented tolerance, and the same answer on every machine. That is',
      'what lets the guard re-derive these files instead of trusting them.',
    ]);
  }
  const f = width / size;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) {
          const i = ((y * f + dy) * width + (x * f + dx)) * 4;
          const av = rgba[i + 3];
          r += rgba[i] * av;
          g += rgba[i + 1] * av;
          b += rgba[i + 2] * av;
          a += av;
        }
      }
      const d = (y * size + x) * 4;
      // `a` is the SUM of alphas over the block; dividing the premultiplied
      // sums by it un-premultiplies and averages in one step. a === 0 means the
      // whole block is transparent, and there is no colour to recover.
      out[d] = a === 0 ? 0 : Math.round(r / a);
      out[d + 1] = a === 0 ? 0 : Math.round(g / a);
      out[d + 2] = a === 0 ? 0 : Math.round(b / a);
      out[d + 3] = Math.round(a / (f * f));
    }
  }
  return { width: size, height: size, rgba: out };
}

// ── reading the app's own declarations ──────────────────────────────────────

/**
 * `BINARY_NAME` and `APPLICATION_ID` out of an app's `linux/CMakeLists.txt`.
 *
 * 🔴 PARSED FROM `set(...)` CALLS WITH COMMENTS STRIPPED FIRST, never grepped.
 * That file's own comments name both variables in prose ("Change this to change
 * the on-disk name"), so a bare text match reads the explanation and not the
 * value — the failure `assert-clone-contract.mjs` already recorded once, where a
 * grep matched the comment saying why the key was absent.
 */
export function readLinuxIdentity(appDir) {
  const path = join(appDir, 'linux', 'CMakeLists.txt');
  if (!existsSync(path)) {
    throw new LinuxBrandUnavailable([`${path} does not exist — this app does not ship a Linux target.`]);
  }
  const code = readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.replace(/#.*$/, ''))
    .join('\n');
  const grab = (name) => {
    const m = code.match(new RegExp(`(^|\\n)\\s*set\\s*\\(\\s*${name}\\s+"([^"]+)"\\s*\\)`));
    return m ? m[2] : null;
  };
  const binaryName = grab('BINARY_NAME');
  const applicationId = grab('APPLICATION_ID');
  if (!binaryName || !applicationId) {
    throw new LinuxBrandUnavailable([
      `${path} does not set both BINARY_NAME and APPLICATION_ID as quoted literals.`,
      'They are the Exec and the Icon/desktop-file name. Deriving the desktop entry without them would',
      'mean inventing an identity, and a desktop entry under the wrong ID installs cleanly and launches',
      'nothing.',
    ]);
  }
  return { binaryName, applicationId };
}

/**
 * The desktop entry's TEXT, derived from the app's own listing files.
 *
 * Returned rather than written so that the guard can derive the same string and
 * compare, which is what makes a hand-edited desktop file detectable.
 */
export function deriveDesktopEntry(appDir) {
  const { binaryName, applicationId } = readLinuxIdentity(appDir);
  const listing = join(appDir, 'store', 'linux-snap');
  const field = (file) => {
    const p = join(listing, file);
    if (!existsSync(p)) {
      throw new LinuxBrandUnavailable([
        `${p} does not exist, and the desktop entry's text is DERIVED from the listing rather than typed.`,
        'A second hand-typed copy of the app name is the copy that goes stale — [pipeline D-5].',
      ]);
    }
    const v = readFileSync(p, 'utf8').trim();
    if (v === '') throw new LinuxBrandUnavailable([`${p} is empty; the desktop entry has no ${file} to carry.`]);
    return v;
  };
  const name = field('title.txt');
  const comment = field('short-description.txt');
  const storeCategory = field('category.txt');
  const categories = CATEGORY_MAP.get(storeCategory);
  if (!categories) {
    throw new LinuxBrandUnavailable([
      `store/linux-snap/category.txt says "${storeCategory}", which has no freedesktop equivalent recorded.`,
      'The Snap Store vocabulary and the freedesktop one are different registries — "Productivity" is a',
      'Snap category and is not a registered freedesktop category at all, so passing it through produces',
      'a file `desktop-file-validate` rejects. Add the mapping WITH its source rather than guessing one:',
      'https://specifications.freedesktop.org/menu-spec/latest/apa.html',
    ]);
  }
  // Field order is fixed so the derivation is a single string comparison.
  // `Icon` is a bare NAME: the spec resolves it through the icon theme, which is
  // what makes one entry serve every size and every packaging layer.
  return (
    [
      '[Desktop Entry]',
      `Version=${DESKTOP_ENTRY_SPEC_VERSION}`,
      'Type=Application',
      `Name=${name}`,
      `Comment=${comment}`,
      `Exec=${binaryName}`,
      `Icon=${applicationId}`,
      'Terminal=false',
      `Categories=${categories};`,
    ].join('\n') + '\n'
  );
}

/** Every artefact this generator owns for one app: relative path → bytes. */
export function deriveLinuxPackaging(appDir) {
  const { applicationId } = readLinuxIdentity(appDir);
  const masterPath = join(appDir, 'assets', 'icon', 'app_icon_1024.png');
  if (!existsSync(masterPath)) {
    throw new LinuxBrandUnavailable([
      `${masterPath} does not exist.`,
      'It is the SAME master the other five platforms are generated from, which is the point: a separate',
      'Linux source image would be a second place the brand lives, and two copies of one fact is how the',
      'wrong one ships.',
    ]);
  }
  // Translated rather than propagated: a caller of THIS function is asking about
  // an app's Linux packaging, and `PngUnreadable` leaking out would be answered
  // with a message about PNG internals that names neither the app nor the file.
  let master;
  try {
    master = decodeRgba(readFileSync(masterPath));
  } catch (e) {
    if (!(e instanceof PngUnreadable)) throw e;
    throw new LinuxBrandUnavailable([`${masterPath} could not be decoded — ${e.lines[0]}`, ...e.lines.slice(1)]);
  }
  const out = new Map();
  out.set(`${PACKAGING_DIR}/${applicationId}.desktop`, Buffer.from(deriveDesktopEntry(appDir), 'utf8'));
  for (const size of HICOLOR_SIZES) {
    out.set(
      `${PACKAGING_DIR}/icons/hicolor/${size}x${size}/apps/${applicationId}.png`,
      encodeRgba(boxDownscale(master, size)),
    );
  }
  return out;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
// Only when invoked directly. The guard imports the functions above, and a
// module that writes files on import would rewrite the tree it is checking.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const at = (n, d) => {
    const i = argv.indexOf(n);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : d;
  };
  const app = at('--app', 'subly');
  const check = argv.includes('--check');
  const appDir = join(ROOT, 'apps', app);

  let derived;
  try {
    derived = deriveLinuxPackaging(appDir);
  } catch (e) {
    if (!(e instanceof LinuxBrandUnavailable)) throw e;
    console.error('render-linux-icons: REFUSING');
    for (const l of e.lines) console.error(`  ${l}`);
    process.exit(1);
  }

  let drift = 0;
  for (const [rel, bytes] of derived) {
    const path = join(appDir, rel);
    const same = existsSync(path) && readFileSync(path).equals(bytes);
    if (check) {
      if (!same) {
        drift++;
        console.error(`FAIL apps/${app}/${rel} — ${existsSync(path) ? 'differs from' : 'is missing and would be'} the derivation`);
      }
      continue;
    }
    if (same) {
      console.log(`  = apps/${app}/${rel} (${bytes.length} bytes, unchanged)`);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    console.log(`  → apps/${app}/${rel} (${bytes.length} bytes)`);
  }

  if (check && drift > 0) {
    console.error('');
    console.error(`render-linux-icons: ${drift} artefact(s) are not what the master derives.`);
    console.error(`Regenerate with: node tooling/store/render-linux-icons.mjs --app ${app}`);
    process.exit(1);
  }
  console.log(`render-linux-icons: ok — ${derived.size} artefact(s)${check ? ' verified against the master' : ''}`);
}
