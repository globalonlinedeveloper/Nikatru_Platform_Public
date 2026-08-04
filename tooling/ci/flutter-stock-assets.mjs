// ─────────────────────────────────────────────────────────────────────────────
// flutter-stock-assets.mjs — THE ONE ANSWER TO "what bytes does `flutter create`
// write for this asset?"
//
// 🔴 WHY THIS FILE EXISTS — a guard that had stopped guarding, found 2026-08-04.
//
// `assert-stamp-brand-assets.mjs` compares a stamped app's five web icons
// against the SDK's stock ones, read from
// `$FLUTTER_ROOT/packages/flutter_tools/templates/app/web/`. Measured on the
// real Flutter 3.44.7 install that day:
//
//     favicon.png.copy.tmpl              917 bytes   ← real
//     icons/Icon-192.png.copy.tmpl      5292 bytes   ← real
//     icons/Icon-512.png.copy.tmpl      8252 bytes   ← real
//     icons/Icon-maskable-192.png.img.tmpl   0 bytes ← EMPTY
//     icons/Icon-maskable-512.png.img.tmpl   0 bytes ← EMPTY
//
// EVERY `.img.tmpl` IN THE SDK IS A ZERO-BYTE PLACEHOLDER. The real bytes live
// in the `flutter_template_images` pub package, which `flutter_tools` depends
// on and overlays at `create` time. So two of that guard's five comparisons were
// against an empty buffer — they could never match, no matter what the app
// shipped — while it printed `5 stock asset(s) compared` and exited 0.
//
// 🔬 AND ITS SIX FIXTURE TESTS ALL PASSED, because the fixture writes REAL PNG
// BYTES into a file it names `.img.tmpl`. A fixture written by whoever wrote the
// guard encodes the same misunderstanding as the guard. This repo has that rule
// on record — "a fixture passing is not a guard working, MUTATE THE REAL TREE" —
// and this is it happening again, one directory away.
//
// It matters far more for the NATIVE platforms than for web: iOS, macOS and
// Windows have NO `.copy.tmpl` assets at all. Every one of their stock icons is
// an `.img.tmpl`, so a native identity check reading only the SDK templates
// directory compares against nothing on three platforms at once and reports a
// healthy count. That is how `assert-launcher-icons.mjs` behaved on its very
// first run, before this module existed.
//
// ── THE TWO RULES THIS MODULE ENCODES ───────────────────────────────────────
//   1. OVERLAY. Stock bytes = the SDK template tree, with `flutter_template_
//      images` laid over it. The overlay's location is RESOLVED from
//      `flutter_tools/.dart_tool/package_config.json` — the SDK's own record of
//      where it resolved that package — never globbed out of the pub cache,
//      because a glob picks a version nobody chose and silently keeps working
//      when the SDK moves to another one.
//   2. AN EMPTY STOCK ASSET IS COVERAGE LOST, NEVER A COMPARISON. A zero-byte
//      buffer cannot equal any real icon, so comparing against one is an
//      assertion that cannot fail — worse than none, because it inflates the
//      count that makes coverage look real. This is the rule the incident above
//      is made of, and it is enforced here rather than left to each caller.
//
// Verified against ground truth the day it was written: the overlay's bytes for
// the iOS 1024, macOS 1024, Windows `.ico` and web maskable-512 assets are
// sha256-identical to what `flutter create` actually emitted into a throwaway
// app.
//
// Not a guard — it scans nothing of its own and asserts nothing about any tree.
// It is the shared reader two guards use, and it reports its own coverage
// failures to them by throwing `StockAssetsUnavailable`, whose message the
// caller prints. Its failing cases live in tooling/ci/test/launcher-icons.test.mjs.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
// NOT `readdirSync` — see tree-walk.mjs. Enforced lexically by
// assert-walks-bounded.mjs, which allows no other directory enumeration in
// tooling/ci.
import { listDir } from './tree-walk.mjs';

/**
 * Thrown when the stock bytes cannot be established. `lines` is a ready-to-print
 * COVERAGE LOST explanation; the caller decides how to surface it, because the
 * two callers exit with different framing.
 */
export class StockAssetsUnavailable extends Error {
  constructor(lines) {
    super(lines[0]);
    this.name = 'StockAssetsUnavailable';
    this.lines = lines;
  }
}

/** `Icon-192.png.copy.tmpl` → `Icon-192.png`. The name as it is WRITTEN INTO AN
 *  APP, which is the only key both trees and the app itself agree on. */
export const shippedName = (rel) => rel.replace(/\.(copy|img)\.tmpl$/, '').replace(/\.tmpl$/, '');

/**
 * The Flutter SDK root: `$FLUTTER_ROOT`, or the parent of the `bin/` directory
 * `flutter` lives in on PATH.
 *
 * Resolved WITHOUT spawning anything: a spawn that fails looks exactly like a
 * tool that is absent, and the two need different messages.
 */
export function flutterSdkRoot(env = process.env) {
  if (env.FLUTTER_ROOT) return env.FLUTTER_ROOT;
  for (const dir of (env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    if (!dir) continue;
    for (const exe of ['flutter', 'flutter.bat']) {
      if (existsSync(join(dir, exe)) && basename(dir) === 'bin') return resolve(dir, '..');
    }
  }
  return null;
}

/**
 * Where `flutter_template_images` is resolved for THIS SDK, from flutter_tools'
 * own `package_config.json`. `null` when it cannot be read — the caller turns
 * that into COVERAGE LOST only if an asset actually needs the overlay, so an SDK
 * layout that ever stops needing it does not fail for a reason that no longer
 * applies.
 */
export function templateImagesRoot(sdkRoot) {
  const cfg = join(sdkRoot, 'packages', 'flutter_tools', '.dart_tool', 'package_config.json');
  if (!existsSync(cfg)) return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(cfg, 'utf8'));
  } catch {
    return null;
  }
  const entry = (parsed.packages ?? []).find((p) => p && p.name === 'flutter_template_images');
  if (!entry || typeof entry.rootUri !== 'string') return null;
  try {
    // `rootUri` is a file: URI when the package is in the pub cache, and may be
    // relative to the config's own directory when it is not.
    const root = entry.rootUri.startsWith('file:')
      ? fileURLToPath(entry.rootUri)
      : resolve(join(sdkRoot, 'packages', 'flutter_tools', '.dart_tool'), entry.rootUri);
    return existsSync(root) ? root : null;
  } catch {
    return null;
  }
}

/** Every file under `dir`, relative to it. Recursive, through the one bounded
 *  listing. Returns `[]` when the directory is absent — the caller decides
 *  whether that is a problem, because one of the two trees is allowed to be. */
function walk(dir, rel = '') {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of listDir(dir, { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(join(dir, e.name), childRel));
    else out.push(childRel);
  }
  return out;
}

/**
 * The stock bytes `flutter create` writes under `relDir` of the app template.
 *
 * @param {object}   o
 * @param {string}   o.sdkRoot     the Flutter SDK root.
 * @param {string}   o.relDir      path under `templates/app`, e.g. `web` or
 *                                 `ios.tmpl/Runner/Assets.xcassets/AppIcon.appiconset`.
 * @param {Function} o.keep        predicate over the SHIPPED relative name.
 * @param {string?}  o.imagesRoot  overlay root; resolved from the SDK if omitted.
 * @returns {Map<string, Buffer>}  shipped relative path → stock bytes. Never
 *                                 contains an empty buffer: see rule 2.
 * @throws {StockAssetsUnavailable}
 */
export function readStockAssets({ sdkRoot, relDir, keep, imagesRoot }) {
  if (!sdkRoot) {
    throw new StockAssetsUnavailable([
      "could not locate the Flutter SDK, so there are no stock bytes to compare against.",
      `FLUTTER_ROOT=${process.env.FLUTTER_ROOT ?? '<unset>'}`,
      'Without the SDK a guard can only check that files EXIST, and reporting that as a pass would mean',
      '"I could not check" reads as "nothing was wrong". Run in a lane that has Flutter on PATH.',
    ]);
  }
  const templates = join(sdkRoot, 'packages', 'flutter_tools', 'templates', 'app');
  const overlayRoot = imagesRoot === undefined ? templateImagesRoot(sdkRoot) : imagesRoot;

  const sdkDir = join(templates, relDir);
  const overlayDir = overlayRoot ? join(overlayRoot, 'templates', 'app', relDir) : null;

  if (!existsSync(sdkDir) && !(overlayDir && existsSync(overlayDir))) {
    throw new StockAssetsUnavailable([
      `neither ${sdkDir} nor the flutter_template_images overlay holds a "${relDir}" template.`,
      'The SDK layout moved under this reader. Every comparison built on it would range over nothing',
      'and pass, which is indistinguishable from every asset being correct.',
    ]);
  }

  /** shipped name → { bytes, from } — the overlay WINS, because the SDK's copy
   *  of an `.img.tmpl` is the empty placeholder it replaces. */
  const found = new Map();
  for (const rel of walk(sdkDir)) {
    const name = shippedName(rel);
    if (keep(name)) found.set(name, { bytes: readFileSync(join(sdkDir, rel)), from: join(sdkDir, rel) });
  }
  if (overlayDir) {
    for (const rel of walk(overlayDir)) {
      const name = shippedName(rel);
      if (!keep(name)) continue;
      const bytes = readFileSync(join(overlayDir, rel));
      const have = found.get(name);
      // Only replace an EMPTY placeholder, never a real SDK asset. If both trees
      // carry real bytes for a name, the SDK's is what `create` copies and the
      // overlay is not consulted.
      if (!have || have.bytes.length === 0) found.set(name, { bytes, from: join(overlayDir, rel) });
    }
  }

  // ── rule 2: an empty stock asset is COVERAGE LOST, never a comparison ──────
  const empty = [...found.entries()].filter(([, v]) => v.bytes.length === 0).map(([k]) => k);
  if (empty.length) {
    throw new StockAssetsUnavailable([
      `${empty.length} stock asset(s) under "${relDir}" resolved to ZERO BYTES: ${empty.join(', ')}.`,
      'Every `.img.tmpl` in the Flutter SDK is an empty placeholder; the real bytes come from the',
      '`flutter_template_images` package, overlaid at `create` time.',
      `overlay root = ${overlayRoot ?? '<UNRESOLVED>'}`,
      overlayRoot === null
        ? 'It could not be resolved from flutter_tools/.dart_tool/package_config.json — that file appears when the SDK has been used at least once. Run `flutter --version` in this lane before the guard.'
        : 'It resolved but does not carry these names, so the overlay layout changed.',
      'A comparison against an empty buffer can never match. It is an assertion that CANNOT FAIL, and it',
      'inflates the count that makes coverage look real — so this is a hard stop, not a skip.',
    ]);
  }

  return new Map([...found].map(([k, v]) => [k, v.bytes]));
}
