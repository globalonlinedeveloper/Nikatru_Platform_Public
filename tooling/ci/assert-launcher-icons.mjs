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
// `company/logo/logo-usage.md` recorded that "the same refresh was rolled out
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
// 🔴 AND "THE SDK" IS NOT ONE DIRECTORY, which this guard learned the hard way on
// its FIRST RUN. Reading only
// `$FLUTTER_ROOT/packages/flutter_tools/templates/app/` it reported
// `33 icon(s) compared` and flagged Android alone — while iOS, macOS and Windows
// silently compared against ZERO-BYTE placeholders and could never have matched.
// Every `.img.tmpl` in the SDK is empty; the real bytes are overlaid from the
// `flutter_template_images` package. `flutter-stock-assets.mjs` is the one place
// that knows this, and it refuses to return an empty stock asset at all.
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
//
// ⚠️ WHAT THIS GUARD CANNOT SEE, stated plainly so nobody reads green as safe:
//   · WHETHER THE ICON IS THE RIGHT BRAND. It proves "not Flutter's", not "the
//     app's" — a blank square passes limbs 1-3. The seed-colour limb of
//     `assert-stamp-brand-assets.mjs` is the check that says whose it is, and it
//     only applies to stamped apps, which have a machine-readable seed.
//   · LINUX. Measured 2026-08-04: the Flutter SDK ships NO icon in
//     `templates/app/linux.tmpl` at all, the generated GTK runner sets no window
//     icon, and this repo has no `snapcraft.yaml` or `.desktop` file — so there
//     is no artefact to compare and nothing to be identical to. Every app that
//     ships `linux/` is PRINTED on every run rather than silently counted as
//     covered.
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
 * Where a platform's stock icons live in the SDK app template, where they live
 * in an app, and which files in that subtree are icons.
 *
 * `keep` is applied to the SHIPPED relative name (template suffixes already
 * stripped), so it describes the filename an app carries rather than the
 * template's. Paths are POSIX-style because that is the key `readStockAssets`
 * returns and the form these messages print.
 */
const PLATFORMS = [
  {
    id: 'android',
    sdk: 'android.tmpl/app/src/main/res',
    app: 'android/app/src/main/res',
    // Only the launcher icon. `res/` also holds drawables and XML that are not
    // icons and have nothing to be identical to.
    keep: (rel) => /(^|\/)ic_launcher[^/]*\.png$/.test(rel),
  },
  {
    id: 'ios',
    sdk: 'ios.tmpl/Runner/Assets.xcassets/AppIcon.appiconset',
    app: 'ios/Runner/Assets.xcassets/AppIcon.appiconset',
    keep: (rel) => rel.endsWith('.png'),
  },
  {
    id: 'macos',
    sdk: 'macos.tmpl/Runner/Assets.xcassets/AppIcon.appiconset',
    app: 'macos/Runner/Assets.xcassets/AppIcon.appiconset',
    keep: (rel) => rel.endsWith('.png'),
  },
  {
    id: 'windows',
    sdk: 'windows.tmpl/runner/resources',
    app: 'windows/runner/resources',
    keep: (rel) => rel.endsWith('.ico'),
  },
  {
    id: 'web',
    // Web has no `.tmpl` suffix on the directory — it is copied verbatim.
    sdk: 'web',
    app: 'web',
    keep: (rel) => rel.endsWith('.png'),
  },
];

/** Platforms an app can ship that the SDK gives this guard nothing to compare
 *  against. Printed on every run, never silently counted as covered. */
const UNCOMPARABLE = new Map([
  [
    'linux',
    'the SDK ships no icon in templates/app/linux.tmpl, the generated GTK runner sets no window icon, and ' +
      'this repo has no snapcraft.yaml or .desktop file — so there is no artefact to compare. A Linux ' +
      'launcher icon is a PACKAGING concern; when a snap/flatpak recipe lands, give it a limb here.',
  ],
]);

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
      stockCache.set(p.id, readStockAssets({ sdkRoot, relDir: p.sdk, keep: p.keep }));
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
const linuxOnly = [];

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
        `apps/${slug} ships ${p.id}/ but the SDK template "templates/app/${p.sdk}" yielded ZERO icons.`,
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

  if (nativeHere) appsWithNative += 1;
  for (const [id, why] of UNCOMPARABLE) {
    if (existsSync(join(appDir, id))) linuxOnly.push(`apps/${slug} ships ${id}/ — UNCHECKED: ${why}`);
  }
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
  'stock bytes come from the LIVE SDK + its flutter_template_images overlay, never pinned hashes — the ' +
    'comparison cannot go stale, and an empty stock asset is refused rather than compared',
);
prints.push(
  'this guard proves an icon is NOT Flutter\'s; it does NOT prove it is the app\'s. A blank square passes. ' +
    'assert-stamp-brand-assets.mjs owns the seed-colour limb for stamped apps.',
);
for (const s of icoSizes) prints.push(`ico entries — ${s}`);
for (const l of linuxOnly) prints.push(l);

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
