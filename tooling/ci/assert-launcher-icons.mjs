#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-launcher-icons.mjs — a SHIPPED app must not carry Flutter's icon.
//
// 🔴 WHY THIS EXISTS — measured on the real tree 2026-08-04, not read anywhere.
// Every native launcher icon in `apps/subly` was BYTE-IDENTICAL to what
// `flutter create` emits. All of them, on four platforms at once:
//
//     android   5/5 mipmap ic_launcher.png     identical to stock
//     ios      18/18 AppIcon.appiconset PNGs   identical to stock
//     macos     7/7 app_icon_*.png             identical to stock
//     windows   1/1 runner/resources/app_icon.ico  identical to stock
//     web       0/5  — the brand refresh DID land here
//
// The 23-July brand refresh reached `web/` and nothing else, while
// `nikatru/logo/logo-usage.md` recorded that "the same refresh was rolled out
// across the app (Subly)". It had not been. FIVE OF SIX PLATFORMS WERE WRONG
// AND ONE DOCUMENT SAID THEY WERE RIGHT — which is why this is a guard and not
// a correction to that sentence.
//
// It is also the most visible possible "unfinished" signal: the launcher icon is
// the first thing a store reviewer and every user sees, and Google Play rejects
// a submission that ships the stock Flutter mark.
//
// 🔬 AND IT IS A FACTORY DEFECT. The Mason brick under `tooling/bricks/app`
// carries NO native platform folders — the owner adds them with `flutter create
// . --platforms=…` after stamping, which is precisely the command that writes
// Flutter's icons. So every one of the 50 planned apps is born with this,
// exactly like `assert-desktop-runner-identity.mjs`'s three `--org` fields.
// Fixing only Subly fixes one instance of a defect the template reproduces on
// demand. Limb 5 below is the half that stops it recurring.
//
// ── THE COMPARISON IS AGAINST THE LIVE SDK, NEVER PINNED HASHES ─────────────
// The obvious implementation is a list of known-bad sha256 values. It rots
// SILENTLY: Flutter changes its default assets, the pinned hashes stop matching
// anything, and the guard goes on printing ok while stock icons ship again — a
// scanner that quietly stopped scanning, this repo's single most repeated
// failure. The stock bytes are read instead from the SDK that BUILDS the app.
// That relationship cannot go stale, because it IS the thing being compared.
// Same reasoning as `assert-stamp-brand-assets.mjs` — which covers the STAMPED
// app's web assets; this guard covers the SHIPPED apps' native ones.
//
// 🔴 AND "THE SDK's STOCK BYTES" TOOK THREE ATTEMPTS TO READ CORRECTLY, two of
// which were GREEN WHILE BROKEN. Reading the template directory reported
// `33 icon(s) compared` while iOS, macOS and Windows compared against ZERO-BYTE
// placeholders; resolving the `flutter_template_images` overlay worked locally
// and died in CI, where a prebuilt SDK has no package config to resolve it from.
// `flutter-stock-assets.mjs` now RUNS `flutter create` and reads the app it
// produces — the literal question, so the literal answer. Its header records all
// three attempts, because the failure mode was identical each time.
//
// ⚠️ SO IT REFUSES TO RUN BLIND. No SDK, no overlay, or an empty stock asset →
// COVERAGE LOST, exit 1. "I could not check" must never read as "nothing was
// wrong". That is why this runs in the `app_brick` lane (the one with Flutter on
// PATH) and not beside the static guards in `platform`.
//
// 🔬 THE REQUIRED FILE SET IS DERIVED FROM THE SDK, NOT TYPED HERE. Listing the
// five Android densities and the eighteen iOS sizes by hand makes a list that is
// correct on the day it is written; Flutter adds a density and the new file is
// unchecked forever, while the guard reports full coverage. Whatever icon the
// SDK template carries for a platform is what the app must carry, and must not
// match. If a platform's template directory yields ZERO icons, that is COVERAGE
// LOST for that platform — a Flutter layout change looks exactly like every
// icon being correct.
//
// ── WHAT IS CHECKED ─────────────────────────────────────────────────────────
//   1. PRESENCE — every icon the SDK template carries exists in the app.
//   2. VALIDITY — it is a real PNG (signature + IHDR + non-zero dimensions) or a
//      real ICO (structural header + in-bounds entries). Present ≠ valid: a
//      0-byte or truncated file would otherwise pass limbs 1 and 3 together.
//   3. IDENTITY — it is not byte-identical to the SDK's stock asset. THE DEFECT.
//   4. iOS OPACITY — no iOS AppIcon PNG carries an alpha channel. The App Store
//      rejects those (ITMS-90717 "Invalid App Store Icon"), so a build that
//      passes every other check here still cannot be submitted. Verified not to
//      fire on correct input: the SDK's own stock iOS icons are colour type 2,
//      no alpha — so the stock set passes this limb, which is what makes it a
//      test of the APP rather than a test of Flutter.
//   5. ANDROID ADAPTIVE ICON — `mipmap-anydpi-v26/ic_launcher.xml` exists and
//      every layer it names RESOLVES to a real resource. Android 8+ (2017) draws
//      the legacy square through a system mask when there is no adaptive icon,
//      which is how a correct-looking icon ends up shaved on a round-mask
//      launcher. The reference-resolution half is the point: an `<foreground>`
//      pointing at a drawable nobody stamped is a build failure at best and a
//      blank icon at worst, and the XML alone cannot tell you which.
//   6. THE FACTORY — the brick's app template declares a launcher-icon
//      MECHANISM whose `image_path` names a file the stamp really writes. See
//      the block for why this is not a "the brick has icons" check.
//   7. LINUX — the desktop entry and the hicolor icon theme, RE-DERIVED from the
//      app's own master rather than merely counted. See the limb.
//
// ── 🔴 LIMB 7 REPLACED A PRINT, AND THE PRINT WAS RIGHT WHEN IT WAS WRITTEN ──
// Until 2026-08-04 this header said Linux "has no artefact to compare and
// nothing to be identical to", and every app shipping `linux/` was PRINTED as
// UNCHECKED. Both halves were true of the SDK and neither was true of the
// requirement: the Flutter SDK ships no Linux icon because Linux does not take
// one from the toolkit, it takes one from the PACKAGING layer. So the absence of
// a stock asset is not the absence of a check — it means the identity comparison
// that limb 3 performs is the wrong shape here, not that nothing can be proved.
//
// What limb 7 proves instead is STRONGER than "not Flutter's": the shipped icons
// must be exactly what the app's own 1024 master derives. Not-stock is satisfied
// by a blank square; re-derivation is satisfied only by the app's mark. That is
// possible on Linux and not on the other five precisely because these artefacts
// are generated here rather than by a third-party tool.
//
// ⚠️ WHAT THIS GUARD CANNOT SEE, stated plainly so nobody reads green as safe:
//   · WHETHER THE ICON IS THE RIGHT BRAND, on the four platforms limbs 1-3
//     cover. It proves "not Flutter's", not "the app's" — a blank square passes
//     them. The seed-colour limb of `assert-stamp-brand-assets.mjs` is the check
//     that says whose it is, and it only applies to stamped apps, which have a
//     machine-readable seed. (Limb 7 does not have this hole: it re-derives.)
//   · WHETHER A .desktop FILE IS VALID BEYOND THE KEYS DERIVED. `Categories`
//     membership of the freedesktop registry is enforced at generation time by a
//     sourced map, not here; `desktop-file-validate` is the tool that checks the
//     whole grammar and it is not on these runners.
//   · THE PIXELS INSIDE AN `.ico`. Byte-identity and structure are checked; the
//     embedded images are not decoded. The entry sizes are printed.
//   · ADAPTIVE-ICON GEOMETRY. Limb 5 proves the layers resolve, not that the
//     foreground respects the 66% safe zone — that is geometry, and asserting it
//     would need a real rasteriser and an invented tolerance.
//
// Usage:  node tooling/ci/assert-launcher-icons.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
// NOT `readdirSync` — a raw listing descends into a nested checkout (a git
// worktree, a submodule, a stray clone) and reads another repository's files as
// this tree's. Green in CI, which creates no worktrees; red on the one machine
// actually looking at it. `listDir` is the single place that knows which entries
// belong to the tree under test.
import { listDir } from './tree-walk.mjs';
// The ONE answer to "what bytes does `flutter create` write for this asset?",
// including the `flutter_template_images` overlay without which three of the
// five platforms below compare against nothing. See that file's header.
import { flutterSdkRoot, readStockAssets, StockAssetsUnavailable } from './flutter-stock-assets.mjs';
// Limb 7's right-hand side. Imported rather than reimplemented: the sizes, the
// downscale and the desktop-entry text have ONE definition, in the generator
// that writes them. A guard with its own idea of what the icons should be is a
// guard that certifies its own misunderstanding — and this repo has already paid
// for a fixture that encoded the same mistake as the check it was testing.
import {
  HICOLOR_SIZES,
  PACKAGING_DIR,
  deriveLinuxPackaging,
  readLinuxIdentity,
  LinuxBrandUnavailable,
} from '../store/render-linux-icons.mjs';
// The shared PNG decoder, so "what is in this picture" has one answer across the
// guards. Limb 7 compares DECODED PIXELS rather than file bytes — see the limb.
import { decodeRgba, PngUnreadable } from '../store/png-codec.mjs';

const repoRoot = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? process.cwd());
const APPS = join(repoRoot, 'apps');

/** The brick's app template — limb 6's subject. Same path constant as
 *  `assert-stamp-platforms.mjs`, deliberately: two guards disagreeing about
 *  where the template lives is how one of them starts checking nothing. */
const BRICK_APP = join(repoRoot, 'tooling', 'bricks', 'app', '__brick__', 'apps', '{{app_id}}');
const BRICK_APP_REL = 'tooling/bricks/app/__brick__/apps/{{app_id}}';

const problems = [];
const prints = [];

/** Structural failure — the scan itself is broken, so nothing below it means
 *  anything. Exits immediately rather than joining the problem list. */
function coverageLost(lines) {
  console.error(`COVERAGE LOST: ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
}

// ── locate the SDK's stock assets ───────────────────────────────────────────
const sdkRoot = flutterSdkRoot();

/**
 * Where each platform's launcher icons live INSIDE AN APP, and which files in
 * that subtree are icons.
 *
 * One path per platform, not two: the reference the stock bytes come from is a
 * created app, so the shipped app and the reference share a layout. There is no
 * template path to keep in step with an app path. Paths are POSIX-style,
 * matching the keys `readStockAssets` returns and the form these messages print.
 */
const PLATFORMS = [
  {
    id: 'android',
    app: 'android/app/src/main/res',
    // Only the launcher icon. `res/` also holds drawables and XML that are not
    // icons and have nothing to be identical to.
    keep: (rel) => /(^|\/)ic_launcher[^/]*\.png$/.test(rel),
  },
  {
    id: 'ios',
    app: 'ios/Runner/Assets.xcassets/AppIcon.appiconset',
    keep: (rel) => rel.endsWith('.png'),
  },
  {
    id: 'macos',
    app: 'macos/Runner/Assets.xcassets/AppIcon.appiconset',
    keep: (rel) => rel.endsWith('.png'),
  },
  {
    id: 'windows',
    app: 'windows/runner/resources',
    keep: (rel) => rel.endsWith('.ico'),
  },
  {
    id: 'web',
    app: 'web',
    keep: (rel) => rel.endsWith('.png'),
  },
];

/** Linux is NOT in PLATFORMS above, and that is a statement about the SDK rather
 *  than about coverage: `flutter create` writes no Linux image, so there is
 *  nothing for limb 3 to be identical to. Limb 7 checks it by re-derivation
 *  instead. The constant is here so the two lists are visibly one decision. */
const LINUX_DIR = 'linux';

// ── read the stock icon set, per platform, LAZILY ───────────────────────────
// Through the shared reader, so the `flutter_template_images` overlay and the
// zero-byte refusal are applied identically here and in
// assert-stamp-brand-assets.mjs. Two guards with two ideas of "the stock bytes"
// is how one of them stops comparing.
//
// 🔴 LAZY, AND THE FIXTURE IS WHY. The first version read all five platforms up
// front, so an SDK missing ANY template directory — including one for a platform
// no app in the tree ships — exited COVERAGE LOST and took the whole run with
// it. Every real Flutter install has all five, so it never fired here; it fired
// immediately against a fixture that only models the four native ones. A guard
// that fails for a reason which does not apply gets disabled by whoever hits it
// next, which is how a check stops checking. Read on demand: a platform an app
// actually ships and the SDK cannot describe is still a hard stop, which is the
// case that matters.
/** platform id → Map<shipped relative path, stock bytes>. Memoised. */
const stockCache = new Map();
function stockFor(p) {
  if (!stockCache.has(p.id)) {
    try {
      stockCache.set(p.id, readStockAssets({ sdkRoot, relDir: p.app, keep: p.keep }));
    } catch (e) {
      if (!(e instanceof StockAssetsUnavailable)) throw e;
      coverageLost([...e.lines, `platform = ${p.id}`]);
    }
  }
  return stockCache.get(p.id);
}

// ── PNG / ICO readers: enough to prove the file is what it claims to be ─────
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** IHDR fields plus the chunk names present. `null` when the bytes are not a
 *  PNG at all — the caller reports that rather than skipping, because an
 *  unreadable icon is a file this guard cannot vouch for. */
function readPng(buf) {
  if (buf.length < 8 || !PNG_SIG.every((v, i) => buf[i] === v)) return null;
  let off = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colourType = -1;
  const chunks = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    chunks.push(type);
    if (type === 'IHDR' && len >= 13) {
      width = buf.readUInt32BE(off + 8);
      height = buf.readUInt32BE(off + 12);
      depth = buf[off + 16];
      colourType = buf[off + 17];
    }
    if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!chunks.includes('IHDR')) return null;
  return { width, height, depth, colourType, chunks };
}

/**
 * Does this PNG carry transparency?
 *
 * Colour types 4 (grey+alpha) and 6 (RGBA) have an alpha CHANNEL; types 0, 2
 * and 3 can still be transparent through a `tRNS` chunk. Both count — Apple
 * rejects the icon either way, and checking only the colour type would pass a
 * palette icon with a transparent index, which is exactly what Android's stock
 * `ic_launcher.png` is.
 */
const hasAlpha = (png) => png.colourType === 4 || png.colourType === 6 || png.chunks.includes('tRNS');

/**
 * The image directory of a Windows `.ico`: `reserved(0) type(1) count`, then
 * `count` 16-byte entries. Returns the entry sizes, or `null` when the bytes are
 * not a structurally valid ICO — including an entry whose data runs off the end
 * of the file, which is what a truncated write produces.
 *
 * A `0` in the width/height byte means 256 — the format stores the dimension in
 * one byte, so 256 cannot be written literally.
 */
function readIco(buf) {
  if (buf.length < 6) return null;
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return null;
  const count = buf.readUInt16LE(4);
  if (count === 0 || buf.length < 6 + count * 16) return null;
  const sizes = [];
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16;
    const w = buf[off] === 0 ? 256 : buf[off];
    const h = buf[off + 1] === 0 ? 256 : buf[off + 1];
    const bytes = buf.readUInt32LE(off + 8);
    const at = buf.readUInt32LE(off + 12);
    if (at + bytes > buf.length) return null;
    sizes.push(`${w}x${h}`);
  }
  return sizes;
}

// ── the scan ────────────────────────────────────────────────────────────────
if (!existsSync(APPS)) {
  coverageLost([
    `${APPS} does not exist.`,
    'If apps/ moved, re-point this guard. Do not delete it.',
  ]);
}

let appsWithNative = 0;
let iconsCompared = 0;
let iosOpacityChecked = 0;
let adaptiveChecked = 0;
const icoSizes = [];
/** Limb 7's own accounting. Separate counters for "apps that ship linux/" and
 *  "artefacts actually compared", because they fail differently: zero apps means
 *  the Linux lane was dropped, zero artefacts over one or more apps means the
 *  derivation stopped reaching the tree while still reporting a clean run. */
let linuxApps = 0;
let linuxChecked = 0;

for (const slug of listDir(APPS).sort()) {
  const appDir = join(APPS, slug);
  const pubspec = join(appDir, 'pubspec.yaml');
  if (!existsSync(pubspec) || !statSync(pubspec).isFile()) continue;

  let nativeHere = false;

  for (const p of PLATFORMS) {
    const dir = join(appDir, p.app);
    if (!existsSync(dir)) continue; // this app does not ship that platform
    if (p.id !== 'web') nativeHere = true;

    const expected = stockFor(p);
    // A platform the app ships and the SDK gave us nothing for: the PLATFORMS
    // entry no longer matches the SDK layout, and every check for that platform
    // has quietly become vacuous.
    if (expected.size === 0) {
      coverageLost([
        `apps/${slug} ships ${p.id}/ but a freshly created app yielded ZERO icons under "${p.app}".`,
        'Presence, validity and identity for that whole platform would range over nothing and pass.',
        'The SDK layout changed under the PLATFORMS table in this guard — teach it the new one.',
      ]);
    }

    for (const [rel, stockBytes] of expected) {
      const path = join(dir, rel);
      const where = `apps/${slug}/${p.app}/${rel}`.replace(/\\/g, '/');

      // ── limb 1: presence ──────────────────────────────────────────────────
      if (!existsSync(path)) {
        problems.push(
          `${where} — MISSING. \`flutter create\` writes this file for ${p.id}, so a build either falls back ` +
            'to a lower density or fails outright; either way nobody chose what ships.',
        );
        continue;
      }
      const bytes = readFileSync(path);

      // ── limb 2: validity ──────────────────────────────────────────────────
      if (rel.endsWith('.ico')) {
        const sizes = readIco(bytes);
        if (sizes === null) {
          problems.push(
            `${where} — is not a structurally valid .ico (${bytes.length} bytes). Present is not the same as ` +
              'valid: a truncated or empty file passes an existence check and ships a blank icon.',
          );
          continue;
        }
        icoSizes.push(`${where} → ${sizes.join(', ')}`);
      } else {
        const png = readPng(bytes);
        if (png === null || png.width === 0 || png.height === 0) {
          problems.push(
            `${where} — is not a readable PNG (${bytes.length} bytes). Present is not the same as valid.`,
          );
          continue;
        }
      }

      // ── limb 3: identity — THE DEFECT ─────────────────────────────────────
      iconsCompared += 1;
      if (stockBytes.length === bytes.length && stockBytes.equals(bytes)) {
        problems.push(
          `${where} — is BYTE-IDENTICAL to Flutter's stock ${p.id} asset. This is the default Flutter logo ` +
            "shipped under the app's own name: the first thing a store reviewer sees, and a Google Play " +
            'rejection. It is what `flutter create` writes, so it arrives by doing nothing rather than by ' +
            'anyone choosing it.',
        );
      }
    }

    // ── limb 4: iOS opacity ─────────────────────────────────────────────────
    // 🔴 OVER THE WHOLE APPICON SET, NOT OVER THE STOCK-DERIVED LIST, and the
    // difference is not theoretical. This limb was written inside the loop above
    // — i.e. only over the 15 names the SDK template carries — and on the very
    // first real run `flutter_launcher_icons` wrote SIX MORE icons the SDK has
    // no counterpart for (`Icon-App-50x50`, `-57x57`, `-72x72`, the legacy
    // iPhone/iPad sizes). Those six went to App Store review completely
    // unexamined, while the guard printed `15 iOS icon(s) checked`.
    //
    // The identity limb is right to range over the SDK's set — you can only be
    // identical to something that exists. This one must range over what SHIPS,
    // because Apple validates the asset catalogue, not Flutter's template.
    if (p.id === 'ios') {
      // Counted PER APP. A single cumulative counter would let one app with a
      // healthy asset catalogue satisfy the coverage check for a second app
      // whose catalogue is entirely unreadable — the empty-domain shape, hidden
      // by a neighbour.
      let checkedHere = 0;
      for (const f of listDir(dir).filter((f) => f.endsWith('.png')).sort()) {
        const where = `apps/${slug}/${p.app}/${f}`;
        const png = readPng(readFileSync(join(dir, f)));
        if (png === null) continue; // limb 2 already reported it, if it knew of it
        iosOpacityChecked += 1;
        checkedHere += 1;
        if (hasAlpha(png)) {
          problems.push(
            `${where} — carries TRANSPARENCY (colour type ${png.colourType}` +
              `${png.chunks.includes('tRNS') ? ' + tRNS' : ''}). App Store Connect rejects an app icon with ` +
              'an alpha channel (ITMS-90717), so this build UPLOADS and then fails validation — late, ' +
              'remotely, with a message that does not mention icons. Generate iOS icons with alpha ' +
              'removed; flutter_launcher_icons calls it `remove_alpha_ios`.',
          );
        }
      }
      if (checkedHere === 0) {
        coverageLost([
          `apps/${slug} ships ios/ but its AppIcon.appiconset holds no readable PNG.`,
          'The one check that stands between this repo and an ITMS-90717 rejection ranged over nothing.',
        ]);
      }
    }

    // ── limb 5: the Android adaptive icon ───────────────────────────────────
    if (p.id === 'android') {
      const res = dir;
      const xml = join(res, 'mipmap-anydpi-v26', 'ic_launcher.xml');
      if (!existsSync(xml)) {
        problems.push(
          `apps/${slug}/${p.app}/mipmap-anydpi-v26/ic_launcher.xml — MISSING, so this app has NO adaptive ` +
            'icon. Every Android since 8.0 (2017) applies a system mask — circle, squircle, teardrop — and ' +
            'with no adaptive icon it masks the legacy square directly, shaving the mark. `flutter create` ' +
            'has never emitted one, so an app only has it if something put it there.',
        );
      } else {
        adaptiveChecked += 1;
        const text = readFileSync(xml, 'utf8');
        // Parsed as ATTRIBUTES, not grepped: this file's prose could name a
        // drawable in a comment and satisfy a bare text match. `<monochrome>` is
        // included when present (Android 13 themed icons) but never required —
        // requiring it would fire on correct input.
        const refs = [...text.matchAll(/android:drawable\s*=\s*"@([a-z]+)\/([A-Za-z0-9_]+)"/g)];
        if (refs.length === 0) {
          problems.push(
            `apps/${slug}/${p.app}/mipmap-anydpi-v26/ic_launcher.xml declares NO \`android:drawable\` layer. ` +
              'An adaptive icon with no foreground and no background draws nothing; the file existing is not ' +
              'the same as the icon existing.',
          );
        }
        for (const [, kind, name] of refs) {
          // A layer resolves if ANY resource directory carries a file of that
          // name (density-qualified `mipmap-hdpi/`, `drawable-v21/`, a `values/`
          // colour, …). Android's own resolution is qualifier-based, so
          // insisting on one exact directory would fail on correct input.
          const resolved =
            listDir(res).some(
              (d) =>
                d.startsWith(`${kind}`) &&
                statSync(join(res, d)).isDirectory() &&
                listDir(join(res, d)).some((f) => f.replace(/\.[^.]+$/, '') === name),
            ) ||
            // `@color/x` normally lives as a `<color name="x">` in values/*.xml
            // rather than as a file.
            listDir(res).some(
              (d) =>
                d.startsWith('values') &&
                statSync(join(res, d)).isDirectory() &&
                listDir(join(res, d)).some(
                  (f) =>
                    f.endsWith('.xml') &&
                    new RegExp(`<${kind}\\s+name\\s*=\\s*"${name}"`).test(
                      readFileSync(join(res, d, f), 'utf8'),
                    ),
                ),
            );
          if (!resolved) {
            problems.push(
              `apps/${slug}/${p.app}/mipmap-anydpi-v26/ic_launcher.xml names @${kind}/${name}, and no ` +
                `resource of that name exists under ${p.app}/. The adaptive icon references a layer nobody ` +
                'stamped — aapt fails the build, or the launcher draws a blank tile.',
            );
          }
        }
      }
    }
  }

  // ── limb 7: LINUX — the desktop entry and the hicolor icon theme ────────
  // Reached from the per-app loop rather than the PLATFORMS loop because Linux
  // has no stock counterpart to iterate against; see the constant above.
  if (existsSync(join(appDir, LINUX_DIR))) {
    linuxApps += 1;
    // Deliberately NOT `nativeHere = true`. `appsWithNative` guards the limbs
    // that compare against the SDK, and Linux has no SDK counterpart — folding
    // it in would let a Linux-only app satisfy a coverage assertion about a
    // comparison that never ran for it. Limb 7 carries its own counter below.

    let derived;
    let identity;
    try {
      identity = readLinuxIdentity(appDir);
      derived = deriveLinuxPackaging(appDir);
    } catch (e) {
      if (!(e instanceof LinuxBrandUnavailable)) throw e;
      // NOT a `problems.push`. If the derivation itself cannot run, every
      // comparison below ranges over nothing and would report a branded Linux
      // build over an app that has no icon at all.
      coverageLost([
        `apps/${slug} ships ${LINUX_DIR}/ and its Linux packaging could not be DERIVED, so nothing about it was checked.`,
        ...e.lines,
      ]);
    }
    if (derived.size === 0) {
      coverageLost([
        `apps/${slug} ships ${LINUX_DIR}/ and the derivation produced ZERO artefacts.`,
        'Presence and content for the whole Linux lane would range over nothing and pass.',
      ]);
    }

    for (const [rel, expected] of derived) {
      const where = `apps/${slug}/${rel}`;
      const path = join(appDir, rel);

      // ── presence ──────────────────────────────────────────────────────────
      if (!existsSync(path)) {
        problems.push(
          `${where} — MISSING. Linux takes its launcher icon from the PACKAGING layer (a .desktop entry ` +
            'plus a hicolor icon theme), not from the Flutter embedder, so an app without these ships ' +
            'with no icon at all: a generic placeholder in the dock, the app grid and the Snap listing. ' +
            '`flutter create` cannot write them, which is exactly why nothing noticed.',
        );
        continue;
      }
      const actual = readFileSync(path);

      if (rel.endsWith('.desktop')) {
        // 🔴 COMPARED AS PARSED KEYS, NOT AS TEXT. A desktop entry is a
        // key/value file whose comments and blank lines are insignificant, so
        // a raw string compare would fail on a harmless reflow AND — worse —
        // could be satisfied by a comment quoting the right `Icon=` line. The
        // prose-vs-structure trap this repo has already been caught by twice.
        const parse = (text) =>
          new Map(
            text
              .split('\n')
              .map((l) => l.trim())
              .filter((l) => l !== '' && !l.startsWith('#') && l.includes('='))
              .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
          );
        const want = parse(expected.toString('utf8'));
        const got = parse(actual.toString('utf8'));
        if (!actual.toString('utf8').includes('[Desktop Entry]')) {
          problems.push(`${where} — has no \`[Desktop Entry]\` group header, so no desktop reads it as an entry at all.`);
        }
        for (const [k, v] of want) {
          if (got.get(k) !== v) {
            problems.push(
              `${where} — \`${k}\` is ${JSON.stringify(got.get(k) ?? null)} and the app's own declarations ` +
                `derive ${JSON.stringify(v)}. This file's text comes from store/linux-snap/ and ` +
                'linux/CMakeLists.txt; a hand edit here is a second copy of the app\'s identity, and two ' +
                'copies of one fact is how the wrong one ships. Regenerate: ' +
                `node tooling/store/render-linux-icons.mjs --app ${slug}`,
            );
          }
        }
        // The three-way agreement the icon actually resolves through: the file
        // is NAMED for the application id, its `Icon=` carries that same id,
        // and the theme paths below use it. Any two of the three agreeing is
        // not enough — the odd one out is the one that silently wins.
        if (got.get('Icon') !== identity.applicationId) {
          problems.push(
            `${where} — \`Icon=${got.get('Icon') ?? ''}\` does not match APPLICATION_ID ` +
              `"${identity.applicationId}" from linux/CMakeLists.txt. The icon is looked up by that name ` +
              'in the icon theme, so a mismatch installs cleanly and resolves to nothing.',
          );
        }
        linuxChecked += 1;
        continue;
      }

      // ── the hicolor PNGs ──────────────────────────────────────────────────
      const png = readPng(actual);
      if (png === null) {
        problems.push(`${where} — is not a readable PNG (${actual.length} bytes). Present is not the same as valid.`);
        continue;
      }
      // The size is in the PATH, and a theme lookup TRUSTS the path. A 1024
      // master copied into `256x256/` is the classic freedesktop mistake: it
      // is a perfectly valid PNG, it passes every existence check, and the
      // desktop draws it at the wrong scale or skips it.
      const declared = Number(/hicolor\/(\d+)x\1\//.exec(rel)?.[1] ?? 0);
      if (png.width !== declared || png.height !== declared) {
        problems.push(
          `${where} — is ${png.width}x${png.height} but sits in the ${declared}x${declared} theme directory. ` +
            'An icon theme lookup trusts the path, so this is drawn at the wrong scale or ignored.',
        );
        continue;
      }

      // 🔴 COMPARED AS DECODED PIXELS, NOT AS FILE BYTES. Byte-identity would
      // be the stronger-looking check and the wrong one: zlib's output is not
      // guaranteed identical across Node releases, so a byte compare goes red
      // on a developer's machine for a file that is pixel-for-pixel correct —
      // and a guard that cries wolf where a human is watching is a guard that
      // gets switched off. The pixels ARE the artefact.
      let same = false;
      try {
        const a = decodeRgba(actual);
        const b = decodeRgba(expected);
        same = a.width === b.width && a.height === b.height && a.rgba.equals(b.rgba);
      } catch (e) {
        if (!(e instanceof PngUnreadable)) throw e;
        problems.push(`${where} — could not be decoded for comparison: ${e.lines[0]}`);
        continue;
      }
      linuxChecked += 1;
      if (!same) {
        problems.push(
          `${where} — is NOT what assets/icon/app_icon_1024.png derives at ${declared}px. Either the master ` +
            'changed and these were never regenerated, or somebody hand-placed an icon here. Both ship a ' +
            'Linux mark that no longer matches the other five platforms, and nothing else in the tree ' +
            `would say so. Regenerate: node tooling/store/render-linux-icons.mjs --app ${slug}`,
        );
      }
    }

    // ── limb 7b: the artefacts must REACH THE BUNDLE ────────────────────────
    // Files that exist in git and are never installed are a launcher icon
    // nobody can see — green here, generic placeholder on the desktop. Parsed
    // with comments stripped, because the block added to that file EXPLAINS
    // these two rules in prose directly above them.
    const cmakePath = join(appDir, LINUX_DIR, 'CMakeLists.txt');
    const cmake = readFileSync(cmakePath, 'utf8')
      .split('\n')
      .map((l) => l.replace(/#.*$/, ''))
      .join('\n');
    // 🔴 `${...}` REFERENCES ARE RESOLVED BEFORE MATCHING, not matched as text.
    // The real rules are written the way CMake is written — `install(DIRECTORY
    // "${LINUX_PACKAGING_DIR}/icons" …)` — so a check looking for the literal
    // string "packaging/icons" fails on the CORRECT file and passes on a
    // hard-coded path, i.e. exactly backwards. Two expansion passes: the
    // variables here are one level deep (`LINUX_PACKAGING_DIR` refers to
    // `CMAKE_CURRENT_SOURCE_DIR`), and an unbounded loop over a file that can
    // define a self-reference would not terminate.
    const vars = new Map([...cmake.matchAll(/(^|\n)\s*set\s*\(\s*([A-Za-z0-9_]+)\s+"([^"]*)"\s*\)/g)].map((m) => [m[2], m[3]]));
    // CMake's own builtin, never `set()` in this file. Bound to the directory it
    // actually denotes here so that the expansion below lands on a path this
    // guard can compare; without it the source side stays an unexpanded
    // `${CMAKE_CURRENT_SOURCE_DIR}/…` and the check silently matches nothing.
    vars.set('CMAKE_CURRENT_SOURCE_DIR', LINUX_DIR);
    const expand = (s) => {
      let out = s;
      for (let pass = 0; pass < 2; pass++) out = out.replace(/\$\{([A-Za-z0-9_]+)\}/g, (whole, n) => vars.get(n) ?? whole);
      return out;
    };
    const installs = [...cmake.matchAll(/install\s*\(\s*(FILES|DIRECTORY)\s+([\s\S]*?)\)/g)].map((m) => ({
      kind: m[1],
      body: expand(m[2]),
    }));
    // The SOURCE side names the packaging directory and the DESTINATION side the
    // freedesktop location. Requiring both is what stops a rule that installs the
    // right file to the wrong place — which installs cleanly and resolves to
    // nothing — from reading as coverage.
    const desktopFile = `${identity.applicationId}.desktop`;
    const installsDesktop = installs.some(
      (i) =>
        i.kind === 'FILES' &&
        i.body.includes(`${LINUX_DIR}/packaging/${desktopFile}`) &&
        /DESTINATION[^)]*share\/applications/.test(i.body),
    );
    const installsIcons = installs.some(
      (i) =>
        i.kind === 'DIRECTORY' &&
        i.body.includes(`${LINUX_DIR}/packaging/icons`) &&
        /DESTINATION[^)]*share/.test(i.body),
    );
    if (!installsDesktop) {
      problems.push(
        `apps/${slug}/${LINUX_DIR}/CMakeLists.txt has no \`install(FILES … .desktop … DESTINATION …/share/` +
          'applications)\` rule, so the desktop entry never leaves the source tree. The icon then exists in ' +
          'git and nowhere a user or a packaging recipe can find it.',
      );
    }
    if (!installsIcons) {
      problems.push(
        `apps/${slug}/${LINUX_DIR}/CMakeLists.txt has no \`install(DIRECTORY …/packaging/icons … DESTINATION ` +
          '…/share)\` rule, so the hicolor theme never reaches the bundle. `Icon=` then names an icon that ' +
          'is not installed, which resolves to the generic placeholder — silently, since a missing icon is ' +
          'not an error anywhere in the stack.',
      );
    }

    // ── limb 7c: the RUNNER names the icon ─────────────────────────────────
    // `flutter create` emits no set-icon call at all, so without this the
    // running window falls back to whatever the desktop infers, which varies
    // by compositor. Comment-stripped for the same reason as above — the block
    // added there describes the call it makes.
    const runnerPath = join(appDir, LINUX_DIR, 'runner', 'my_application.cc');
    if (!existsSync(runnerPath)) {
      coverageLost([
        `apps/${slug}/${LINUX_DIR}/runner/my_application.cc does not exist, so limb 7c ranged over nothing.`,
        'That file is the GTK runner. Its absence is not "nothing to check" — it is the subject being gone.',
      ]);
    }
    const runner = readFileSync(runnerPath, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');
    if (!/gtk_window_set_icon_name\s*\(\s*window\s*,\s*APPLICATION_ID\s*\)/.test(runner)) {
      problems.push(
        `apps/${slug}/${LINUX_DIR}/runner/my_application.cc never calls ` +
          '`gtk_window_set_icon_name(window, APPLICATION_ID)`. The installed theme is then only reachable ' +
          'through the desktop entry, which some compositors use for the window icon and some do not — so ' +
          'the app shows its mark on one desktop and a placeholder on the next, which is worse than either.',
      );
    }
  }

  if (nativeHere) appsWithNative += 1;
}

// ── limb 6: THE FACTORY ─────────────────────────────────────────────────────
// 🔴 NOT "the brick stamps icons". It does not stamp native platforms at all —
// `assert-stamp-platforms.mjs` holds the claim to `web` and would fail if the
// brick grew an `android/` folder that CI does not build. So requiring platform
// folders here would put two guards in direct contradiction, and the one that
// lost would be weakened rather than the design being fixed.
//
// What the brick MUST carry is the MECHANISM: the config and the source image
// that turn `flutter create . --platforms=…` followed by one command into
// branded icons. Without it, app #2 repeats app #1 exactly — stamp, add
// platforms, ship the Flutter logo.
//
// The check is a RELATIONSHIP, not a spelling: the config names an `image_path`,
// and that path must resolve to a file the stamp really writes. A config
// pointing at art nobody generates is a mechanism that fails on first use, and
// its failure mode is the stock icon surviving — silently, again.
{
  const pubspecPath = join(BRICK_APP, 'pubspec.yaml');
  if (!existsSync(pubspecPath)) {
    coverageLost([
      `${BRICK_APP_REL}/pubspec.yaml could not be read, so the factory limb ranged over nothing.`,
      'The brick template IS the factory. A missing template is not "no apps to check" — it is the subject',
      'of the check being gone, which must never read as a pass.',
    ]);
  }
  const tmpl = readFileSync(pubspecPath, 'utf8');
  // Comment-stripped and column-anchored. The template carries explanatory prose
  // about icons, and a bare `includes('flutter_launcher_icons')` stays green
  // after the real block is deleted because the comment explaining it survives —
  // the prose-vs-structure trap `assert-stamp-platforms.mjs` has already been
  // caught by twice.
  const code = tmpl
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trimEnd())
    .join('\n');
  const blockAt = code.split('\n').findIndex((l) => /^flutter_launcher_icons:\s*$/.test(l));
  if (blockAt === -1) {
    problems.push(
      `${BRICK_APP_REL}/pubspec.yaml declares no top-level \`flutter_launcher_icons:\` block. The brick ` +
        'stamps no native platform folders — the owner adds them with `flutter create . --platforms=…`, ' +
        'which is the command that writes Flutter\'s icons. With no config there is nothing to run ' +
        'afterwards, so every app the factory produces is born with the stock mark exactly as Subly was.',
    );
  } else {
    const body = code.split('\n').slice(blockAt + 1);
    const end = body.findIndex((l) => l.trim() !== '' && !/^\s/.test(l));
    const block = (end === -1 ? body : body.slice(0, end)).join('\n');
    const img = block.match(/^\s+image_path:\s*["']?([^"'\n]+?)["']?\s*$/m);
    if (!img) {
      problems.push(
        `${BRICK_APP_REL}/pubspec.yaml has a \`flutter_launcher_icons:\` block with no \`image_path:\`. ` +
          'The generator has no source image, so it fails on first use and the stock icons survive.',
      );
    } else {
      const src = join(BRICK_APP, img[1]);
      // The stamp GENERATES its icon master (post_gen → brand_assets.dart), so
      // the file is absent from the template on purpose and its DIRECTORY is
      // what proves the path is real. A `.gitkeep` is how an otherwise-empty
      // generated directory survives git.
      const dir = dirname(src);
      if (!existsSync(src) && !existsSync(dir)) {
        problems.push(
          `${BRICK_APP_REL}/pubspec.yaml points \`image_path\` at "${img[1]}", and neither that file nor its ` +
            `directory exists in the template. The config names art nobody stamps: \`dart run ` +
            'flutter_launcher_icons\` fails on first use, and the failure mode is the stock icon surviving.',
        );
      }
    }
  }
}

// ── COVERAGE, not "pass" ────────────────────────────────────────────────────
// A guard that evaluated nothing must never be green. Each counter answers a
// different way the scan can silently stop reaching the tree.
if (appsWithNative === 0) {
  coverageLost([
    'no app under apps/ ships android/, ios/, macos/ or windows/.',
    'Every launcher icon in the factory is then unchecked. If native platforms were dropped, retire this',
    'guard deliberately; do not let it report green over an empty set.',
  ]);
}
if (iconsCompared === 0) {
  coverageLost([
    'apps ship native platforms but ZERO icon files were compared against the SDK.',
    'The stock set was read and matched nothing in any app — which looks exactly like every icon being',
    'correct. The SDK layout or the app layout moved under the PLATFORMS table.',
  ]);
}
// 🔴 LIMB 7'S OWN REQUIRED_COVERAGE, and it is the assertion that stops this
// limb decaying the way the print it replaced did. `linuxApps === 0` is a real
// possibility worth stating rather than assuming: if the Linux lane is dropped
// from every app, every check above becomes vacuous while still printing ok, so
// the retirement has to be deliberate.
if (linuxApps === 0) {
  coverageLost([
    'no app under apps/ ships linux/, so limb 7 evaluated nothing.',
    'The Linux launcher icon is a packaging artefact that no other check in this repository covers. If the',
    'Linux target was dropped, retire this limb deliberately; do not let it report green over an empty set.',
  ]);
}
if (linuxChecked === 0) {
  coverageLost([
    `${linuxApps} app(s) ship linux/ and ZERO Linux artefacts were compared against the derivation.`,
    'Presence, size and pixel identity all ranged over nothing, which is indistinguishable from every',
    'Linux icon being correct — and the whole point of limb 7 is that nothing else would ever say so.',
  ]);
}

const totalStock = [...stockCache.values()].reduce((n, m) => n + m.size, 0);
prints.push(
  `${appsWithNative} app(s) with a native platform · ${iconsCompared} icon(s) compared against ` +
    `${totalStock} stock asset(s) resolved from the Flutter SDK at ${sdkRoot}`,
);
prints.push(
  `${iosOpacityChecked} iOS icon(s) checked for an alpha channel (App Store ITMS-90717) · ` +
    `${adaptiveChecked} adaptive-icon manifest(s) resolved`,
);
prints.push(
  'stock bytes come from RUNNING `flutter create` with this SDK, never pinned hashes and never a guess ' +
    'at the template layout — the comparison cannot go stale, and an empty stock asset is refused ' +
    'rather than compared',
);
prints.push(
  'this guard proves an icon is NOT Flutter\'s; it does NOT prove it is the app\'s. A blank square passes. ' +
    'assert-stamp-brand-assets.mjs owns the seed-colour limb for stamped apps.',
);
prints.push(
  `LINUX (limb 7) — ${linuxApps} app(s) ship linux/ · ${linuxChecked} packaging artefact(s) RE-DERIVED from ` +
    `the app's own 1024 master and compared as decoded pixels (hicolor ${HICOLOR_SIZES.join(', ')}) · ` +
    `source of truth: ${PACKAGING_DIR}/, written by tooling/store/render-linux-icons.mjs`,
);
prints.push(
  'limb 7 is STRONGER than limbs 1-3, not weaker: re-derivation is satisfied only by the app\'s own mark, ' +
    'where "not identical to Flutter\'s" is satisfied by a blank square. It can be, because these artefacts ' +
    'are generated in this repo rather than by a third-party tool.',
);
for (const s of icoSizes) prints.push(`ico entries — ${s}`);

if (problems.length) {
  console.error('assert-launcher-icons: FAIL');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error('');
  console.error('  The launcher icon is the first thing a store reviewer and every user sees. Shipping the');
  console.error('  stock Flutter mark is a Google Play rejection and the loudest possible "unfinished" signal.');
  console.error('  It arrives by doing nothing: `flutter create` writes it, so an app has a real icon only if');
  console.error('  something put one there. Regenerate with `dart run flutter_launcher_icons`.');
  for (const p of prints) console.error(`  · ${p}`);
  process.exit(1);
}

console.log('assert-launcher-icons: OK');
for (const p of prints) console.log(`  · ${p}`);
