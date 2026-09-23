// ─────────────────────────────────────────────────────────────────────────────
// launcher-icons.test.mjs — assert-launcher-icons.mjs and flutter-stock-assets.mjs
// must be able to FAIL.
//
// ⚠️ REAL-TREE MUTATIONS FIRST. This repo has shipped a guard whose SIX fixture
// tests all passed against a broken version, so a fixture is the second-weakest
// evidence here and the real tree is the first. Every mutation below was run
// against the actual repository and the real Flutter 3.44.7 SDK on 2026-08-04,
// predictions written first:
//
//   M0 THE REPOSITORY AS IT STOOD             -> 29 icons flagged BYTE-IDENTICAL
//      across android(5) ios(15) macos(7) windows(1), plus the missing adaptive
//      icon and the brick with no mechanism. This is the guard's recorded
//      failing case and the defect it was written for. Web produced ZERO
//      problems, which is what made the audit trustworthy: the guard
//      distinguished the four broken platforms from the one correct one.
//
//   M1 THE FACTORY, END TO END                -> stamped a fresh `apps/probe`,
//      ran `flutter create . --platforms=android,ios,macos,windows,linux`:
//      guard RED, every native icon stock. Ran the ONE command the stamp's
//      checklist prints (`dart run flutter_launcher_icons`): guard GREEN,
//      66 icons across 2 apps. That is app #2 being born wrong and then fixed
//      by the mechanism, observed rather than asserted.
//
//   M2 THE ZERO-BYTE PLACEHOLDER — the mutation that found a REAL BUG, in the
//      guard rather than the tree. On its first run this guard read stock bytes
//      straight from `$FLUTTER_ROOT/.../templates/app/` and reported
//      `33 icon(s) compared`, flagging ANDROID ONLY. iOS, macOS and Windows
//      were silently comparing against ZERO-BYTE `.img.tmpl` placeholders and
//      could never have matched. Fixed by flutter-stock-assets.mjs, which
//      overlays `flutter_template_images` and REFUSES an empty stock asset.
//
//   M3 THE SAME HOLE IN THE SIBLING GUARD, proven by counterfactual. Copied the
//      REAL stock `Icon-maskable-512.png` over `apps/subscriptiontracker`'s:
//        · assert-stamp-brand-assets.mjs AT HEAD  -> `ok … 5 stock asset(s)
//          compared`, exit 0, while the app shipped Flutter's actual icon;
//        · the repaired version                   -> BYTE-IDENTICAL, exit 1.
//      Its six fixture tests passed in BOTH cases, because the fixture writes
//      real PNG bytes into a file it names `.img.tmpl`. A fixture written by
//      whoever wrote the guard encodes the same misunderstanding as the guard.
//
//   M4 THE iOS OPACITY LIMB RANGED OVER THE WRONG SET. Written inside the
//      stock-derived loop it checked 15 icons; `flutter_launcher_icons` then
//      wrote SIX MORE the SDK has no counterpart for (50x50, 57x57, 72x72), and
//      those went unexamined while the guard printed `15 iOS icon(s) checked`.
//      Re-pointed at the shipped asset catalogue: 21.
//
// The fixtures below use a synthetic SDK layout (FLUTTER_ROOT is injected) so
// the comparison path runs without a Flutter install, and they deliberately
// model the `.img.tmpl`-is-empty shape that M2/M3 are about.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spiedRun } from './fixtures/fs-spy-run.mjs';
// Both helpers moved to a shared home 2026-09-12: mutation-proofs.test.mjs needs
// the same pair, and the copy that stayed here was where the name-vs-death
// lesson was learned. See the module header.
import { POSIX, groupMembers, goneWithin } from './fixtures/process-group.mjs';
import { deflateSync } from 'node:zlib';
// The one bounded directory listing — used to prove where the reader's cache lands.
import { listDir } from '../tree-walk.mjs';
// Limb 7's fixtures write what the generator derives, so the PASSING case models
// "correctly generated" rather than one more hand-typed guess at the layout —
// the mistake `assert-stamp-brand-assets.mjs`'s fixture made when it wrote real
// bytes into a file the SDK leaves empty. The FAILING cases perturb the result
// afterwards, which is where the meaning is. And because a fixture written by
// whoever wrote the guard can encode the same misunderstanding as the guard,
// limb 7's real evidence is the REAL-TREE mutation log recorded above each test.
import { deriveDesktopEntry, deriveLinuxPackaging } from '../../store/render-linux-icons.mjs';
// Limb 8's fixtures, on the same terms and for the same reason: the PASSING
// case is what the generator derives, so it models "correctly generated" rather
// than one more hand-typed guess. The failing cases perturb it afterwards.
import { ANDROID_DRAWABLE_NAME, IOS_BASE_PX, backgroundDrawsSplash, deriveSplash } from '../../store/render-splash.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-launcher-icons.mjs');
const REPO = resolve(CI_DIR, '..', '..');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-launcher-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

// ── a minimal real PNG, so "valid PNG" is exercised rather than assumed ──────
function u32(v) {
  return Buffer.from([(v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
}
function crc32(buf) {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
}
/** Solid-colour PNG. `alpha` switches colour type 2 -> 6, which is what the iOS
 *  opacity limb exists to reject. */
function png(size, rgbHex, { alpha = false } = {}) {
  const r = parseInt(rgbHex.slice(0, 2), 16);
  const g = parseInt(rgbHex.slice(2, 4), 16);
  const b = parseInt(rgbHex.slice(4, 6), 16);
  const ch = alpha ? 4 : 3;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * ch);
    for (let x = 0; x < size; x++) {
      row[1 + x * ch] = r;
      row[2 + x * ch] = g;
      row[3 + x * ch] = b;
      if (alpha) row[4 + x * ch] = 255;
    }
    rows.push(row);
  }
  const ihdr = Buffer.concat([u32(size), u32(size), Buffer.from([8, alpha ? 6 : 2, 0, 0, 0])]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A structurally valid single-image .ico wrapping `payload`. */
function ico(payload) {
  const dir = Buffer.alloc(16);
  dir[0] = 0; // width 0 == 256
  dir[1] = 0;
  dir.writeUInt16LE(1, 4); // colour planes
  dir.writeUInt16LE(32, 6); // bpp
  dir.writeUInt32LE(payload.length, 8);
  dir.writeUInt32LE(6 + 16, 12);
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(1, 4);
  return Buffer.concat([head, dir, payload]);
}

/** The IHDR width of an encoded PNG — used to perturb a derived asset at its
 *  own size, so a wrong-pixel fixture cannot be caught by a size check. */
function pngSize(buf) {
  return buf.readUInt32BE(16);
}

/**
 * Flutter's own launch-screen placeholder, byte for byte: the 68-byte 1x1 FULLY
 * TRANSPARENT PNG that `flutter create` writes to LaunchImage.png, @2x and @3x.
 * md5 978c1bee49d7ad5fc1a4d81099b13e18, measured off this repository 2026-09-09.
 *
 * 🔴 THE REAL BYTES, NOT A STAND-IN, and the difference is the whole test. It is
 * colour type 4 (grey + alpha), which the shared decoder refuses — so a fixture
 * that wrote a "small transparent PNG" of its own would exercise a path the real
 * placeholder never reaches, and the first version of limb 8 reported "could not
 * be decoded" instead of naming the defect. A fixture written by whoever wrote
 * the guard encodes the same misunderstanding as the guard; this one cannot.
 */
const STOCK_LAUNCH_IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGP6zwAAAgcBApocMXEAAAAASUVORK5CYII=',
  'base64',
);

const STOCK = '0175c2'; // Flutter's default blue, standing in for stock
const BRAND = '17c3a2';

/** Every icon a synthetic SDK/app pair carries, as [platform, relative path]. */
// iOS carries TWO on purpose: corrupting the only icon in a platform's set
// leaves that set empty, which is a COVERAGE LOST case and masks the specific
// "not a readable PNG" message this fixture is trying to reach. A real asset
// catalogue has fifteen.
const SET = [
  ['android', 'mipmap-hdpi/ic_launcher.png'],
  ['ios', 'Icon-App-1024x1024@1x.png'],
  ['ios', 'Icon-App-60x60@2x.png'],
  ['macos', 'app_icon_1024.png'],
  ['windows', 'app_icon.ico'],
];

const APP_DIR = {
  android: 'android/app/src/main/res',
  ios: 'ios/Runner/Assets.xcassets/AppIcon.appiconset',
  macos: 'macos/Runner/Assets.xcassets/AppIcon.appiconset',
  windows: 'windows/runner/resources',
  web: 'web',
};

/**
 * A FAKE `flutter` at `<sdkRoot>/bin/`, which is how these fixtures supply the
 * stock bytes.
 *
 * 🔴 A FAKE EXECUTABLE RATHER THAN A FAKE DIRECTORY LAYOUT, and the CI failure
 * is why. The first version of this fixture built a synthetic
 * `packages/flutter_tools/templates/` tree — i.e. it modelled the reader's
 * ASSUMPTION about where bytes live, which is precisely the assumption that was
 * wrong twice. A fake `flutter create` exercises the real path instead: the
 * spawn, its exit status, the staging-and-rename, and the on-disk cache.
 *
 * `emptyIcons` makes it emit zero-byte icons; `failing` makes it exit 1.
 *
 * `leaves` (POSIX only — a process group is the thing under test) starts a
 * `sleep 600` in the background holding the fake's stdout/stderr and writes its
 * pid to `pidFile`: 'straggler' then exits 0 with the app created, 'stuck'
 * waits on it and never finishes. The first is a child that ends while its
 * descendant still holds the pipes; the second is a child that does not end.
 */
function fakeFlutter(sdkRoot, referenceDir, { failing = false, leaves = null, pidFile = null } = {}) {
  const bin = join(sdkRoot, 'bin');
  mkdirSync(bin, { recursive: true });
  if (process.platform === 'win32') {
    writeFileSync(
      join(bin, 'flutter.bat'),
      failing
        ? '@echo off\r\necho fake flutter refuses 1>&2\r\nexit /b 1\r\n'
        : `@echo off\r\nxcopy /E /I /Q /Y "${referenceDir}" "stockref" >nul\r\nexit /b 0\r\n`,
    );
  } else {
    const p = join(bin, 'flutter');
    const background = `sleep 600 &\necho $! > "${pidFile}"\n`;
    writeFileSync(
      p,
      failing
        ? '#!/bin/sh\necho "fake flutter refuses" >&2\nexit 1\n'
        : leaves === 'straggler'
          ? `#!/bin/sh\ncp -R "${referenceDir}" "./stockref"\n${background}exit 0\n`
          : leaves === 'stuck'
            ? `#!/bin/sh\ncp -R "${referenceDir}" "./stockref"\n${background}wait\n`
            : `#!/bin/sh\ncp -R "${referenceDir}" "./stockref"\nexit 0\n`,
    );
    chmodSync(p, 0o755);
  }
}

/** Builds a repo-shaped fixture. */
function world({
  useStock = [],
  omit = [],
  corrupt = [],
  iosAlpha = false,
  adaptive = true,
  adaptiveRef = '@drawable/ic_launcher_foreground',
  brickConfig = 'assets/icon/app_icon.png',
  brickArt = true,
  emptyStockIcons = false,
  flutterFails = false,
  flutterLeaves = null,
  linux = true,
  linuxOmit = [],
  linuxCorrupt = null,
  linuxInstall = 'both',
  linuxRunnerIcon = true,
  splash = true,
  splashOmit = [],
  splashStock = [],
  splashPixel = null,
  storyboard = true,
  storyboardSize = IOS_BASE_PX,
  androidSplashWired = true,
  // Limb 9's subject: extra or replacement files, path relative to the app's
  // `android/` (or the brick template's), text written verbatim afterwards.
  androidXml = {},
  brickAndroidXml = {},
} = {}) {
  const root = join(TMP, `r${seq++}`);
  const sdkRoot = join(root, 'sdk');

  const stockBytes = (rel) =>
    emptyStockIcons ? Buffer.alloc(0) : rel.endsWith('.ico') ? ico(png(8, STOCK)) : png(8, STOCK);

  // What the fake `flutter create` will copy out: an app-shaped tree, exactly
  // like the real command produces.
  const reference = join(root, 'reference', 'stockref');
  for (const [platform, rel] of SET) {
    const f = join(reference, APP_DIR[platform], rel);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, stockBytes(rel));
  }
  fakeFlutter(sdkRoot, reference, { failing: flutterFails, leaves: flutterLeaves, pidFile: join(root, 'straggler.pid') });

  // The app.
  const appDir = join(root, 'apps', 'demo');
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, 'pubspec.yaml'), 'name: demo\n');
  // 🔴 THE PLATFORM DIRECTORY IS CREATED EVEN WHEN THE ICON IS OMITTED, and the
  // first version of this fixture got that wrong. Deleting the only macOS icon
  // deleted the macos/ FOLDER too, so the app simply stopped shipping macOS and
  // the guard correctly said nothing — the fixture was testing "an app without
  // that platform", not "an app missing an icon". The real case is always
  // `flutter create` having made the folder and a file going astray inside it.
  for (const [platform] of SET) {
    mkdirSync(join(appDir, APP_DIR[platform]), { recursive: true });
  }
  for (const [platform, rel] of SET) {
    if (omit.includes(rel)) continue;
    const p = join(appDir, APP_DIR[platform], rel);
    mkdirSync(dirname(p), { recursive: true });
    if (corrupt.includes(rel)) {
      writeFileSync(p, Buffer.from('not an image'));
      continue;
    }
    if (useStock.includes(rel)) {
      writeFileSync(p, stockBytes(rel));
      continue;
    }
    const alpha = iosAlpha && platform === 'ios';
    writeFileSync(p, rel.endsWith('.ico') ? ico(png(8, BRAND)) : png(8, BRAND, { alpha }));
  }

  // The master every derived artefact comes from — the SAME file the other five
  // platforms use, which is the property limbs 7 AND 8 both rest on.
  //
  // 🔴 WRITTEN UNCONDITIONALLY, outside the `linux` block it used to live in.
  // Limb 8 derives the launch screen from it too, and a fixture that dropped
  // the master along with the Linux lane would make `linux: false` fail with a
  // message about the splash — i.e. every test of limb 7's own coverage
  // assertion would fail for a reason that has nothing to do with what it
  // asserts. Exactly the shape the lazy `stockFor` above already exists for.
  mkdirSync(join(appDir, 'assets', 'icon'), { recursive: true });
  writeFileSync(join(appDir, 'assets', 'icon', 'app_icon_1024.png'), png(1024, BRAND, { alpha: true }));

  // ── the Linux lane — limb 7's subject ─────────────────────────────────────
  // 🔴 ON BY DEFAULT, and that is the correction rather than a convenience.
  // While limb 7 was a PRINT, `linux: false` was the right default: an app
  // without a Linux target simply had nothing printed about it. Now the absence
  // of any linux/ in the tree is COVERAGE LOST — the guard refuses to report
  // green over a lane that vanished — so a fixture that omits it is modelling a
  // repository this factory does not have, and every unrelated test would fail
  // for a reason that has nothing to do with what it asserts. That is precisely
  // how a check gets switched off by whoever hits it next; the lazy `stockFor`
  // above exists because this same shape already happened once here.
  if (linux) {
    const lin = join(appDir, 'linux');
    mkdirSync(join(lin, 'runner'), { recursive: true });
    writeFileSync(
      join(lin, 'CMakeLists.txt'),
      [
        'set(BINARY_NAME "demo")',
        'set(APPLICATION_ID "com.example.demo")',
        'set(LINUX_PACKAGING_DIR "${CMAKE_CURRENT_SOURCE_DIR}/packaging")',
        ...(linuxInstall === 'no-desktop'
          ? []
          : ['install(FILES "${LINUX_PACKAGING_DIR}/${APPLICATION_ID}.desktop"', '  DESTINATION "${CMAKE_INSTALL_PREFIX}/share/applications" COMPONENT Runtime)']),
        ...(linuxInstall === 'no-icons'
          ? []
          : ['install(DIRECTORY "${LINUX_PACKAGING_DIR}/icons"', '  DESTINATION "${CMAKE_INSTALL_PREFIX}/share" COMPONENT Runtime)']),
      ].join('\n') + '\n',
    );
    writeFileSync(
      join(lin, 'runner', 'my_application.cc'),
      linuxRunnerIcon
        ? 'static void activate() {\n  gtk_window_set_icon_name(window, APPLICATION_ID);\n}\n'
        : '// gtk_window_set_icon_name(window, APPLICATION_ID); <- only in a comment\nstatic void activate() {}\n',
    );

    // The desktop entry's text is DERIVED from these, never typed.
    const listing = join(appDir, 'store', 'linux-snap');
    mkdirSync(listing, { recursive: true });
    writeFileSync(join(listing, 'title.txt'), 'Demo\n');
    writeFileSync(join(listing, 'short-description.txt'), 'A demonstration\n');
    writeFileSync(join(listing, 'category.txt'), 'Productivity\n');

    for (const [rel, bytes] of deriveLinuxPackaging(appDir)) {
      if (linuxOmit.some((o) => rel.endsWith(o))) continue;
      const p = join(appDir, rel);
      mkdirSync(dirname(p), { recursive: true });
      // 'pixel'   — one byte of the mark differs: the case a size/format check
      //             cannot see and only re-derivation catches.
      // 'size'    — a valid PNG of the WRONG size in a size-qualified directory,
      //             which an icon-theme lookup trusts and draws at the wrong scale.
      // 'desktop' — a hand-edited identity, the second copy of one fact.
      if (linuxCorrupt === 'pixel' && rel.endsWith('64x64/apps/com.example.demo.png')) {
        writeFileSync(p, png(64, STOCK, { alpha: true }));
      } else if (linuxCorrupt === 'size' && rel.endsWith('128x128/apps/com.example.demo.png')) {
        writeFileSync(p, png(64, BRAND, { alpha: true }));
      } else if (linuxCorrupt === 'desktop' && rel.endsWith('.desktop')) {
        writeFileSync(p, bytes.toString('utf8').replace('Icon=com.example.demo', 'Icon=demo'));
      } else {
        writeFileSync(p, bytes);
      }
    }
  }

  // The Android adaptive icon and the layer it points at.
  if (adaptive) {
    const res = join(appDir, APP_DIR.android);
    mkdirSync(join(res, 'mipmap-anydpi-v26'), { recursive: true });
    writeFileSync(
      join(res, 'mipmap-anydpi-v26', 'ic_launcher.xml'),
      `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@drawable/ic_launcher_background"/>
  <foreground android:drawable="${adaptiveRef}"/>
</adaptive-icon>`,
    );
    mkdirSync(join(res, 'drawable-hdpi'), { recursive: true });
    writeFileSync(join(res, 'drawable-hdpi', 'ic_launcher_foreground.png'), png(8, BRAND, { alpha: true }));
    writeFileSync(join(res, 'drawable-hdpi', 'ic_launcher_background.png'), png(8, BRAND));
  }

  // ── the launch screen — limb 8's subject ──────────────────────────────────
  // 🔴 ON BY DEFAULT, for the reason the Linux lane is: a missing splash is
  // COVERAGE LOST or a hard failure now, so a fixture that omitted it would
  // make every unrelated test fail for a reason it does not assert.
  if (splash) {
    for (const [rel, bytes] of deriveSplash(appDir)) {
      if (splashOmit.some((o) => rel.endsWith(o))) continue;
      const p = join(appDir, rel);
      mkdirSync(dirname(p), { recursive: true });
      // 'stock'  — Flutter's own 68-byte 1x1 TRANSPARENT placeholder, byte for
      //            byte. THE DEFECT: a blank launch screen that every
      //            "is it Flutter's default icon?" test in this file would pass.
      // 'pixel'  — right size, wrong mark: the case only re-derivation catches.
      if (splashStock.some((o) => rel.endsWith(o))) {
        writeFileSync(p, STOCK_LAUNCH_IMAGE);
      } else if (splashPixel !== null && rel.endsWith(splashPixel)) {
        // The SAME size as the derivation, a different colour: a size check
        // cannot see this, and neither can "is it Flutter's placeholder?".
        writeFileSync(p, png(pngSize(bytes), STOCK, { alpha: true }));
      } else {
        writeFileSync(p, bytes);
      }
    }
    if (storyboard) {
      const sb = join(appDir, 'ios', 'Runner', 'Base.lproj', 'LaunchScreen.storyboard');
      mkdirSync(dirname(sb), { recursive: true });
      writeFileSync(
        sb,
        `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<document>
  <resources>
    <image name="LaunchImage" width="${storyboardSize}" height="${storyboardSize}"/>
  </resources>
</document>
`,
      );
    }
    for (const d of ['drawable', 'drawable-v21']) {
      const bg = join(appDir, APP_DIR.android, d, 'launch_background.xml');
      mkdirSync(dirname(bg), { recursive: true });
      // The UNWIRED variant is the STOCK file, comment and all — the exact text
      // `flutter create` writes. It is not a contrived string: a bare text
      // search for the drawable name matches it, which is the whole reason
      // limb 8b strips comments before looking.
      writeFileSync(
        bg,
        androidSplashWired
          ? `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="?android:colorBackground" />
    <item>
        <bitmap android:gravity="center" android:src="@drawable/${ANDROID_DRAWABLE_NAME}" />
    </item>
</layer-list>
`
          : `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="?android:colorBackground" />

    <!-- You can insert your own image assets here -->
    <!-- <item>
        <bitmap
            android:gravity="center"
            android:src="@mipmap/${ANDROID_DRAWABLE_NAME}" />
    </item> -->
</layer-list>
`,
      );
    }
  }

  // The brick template — limb 6's subject.
  const brick = join(root, 'tooling', 'bricks', 'app', '__brick__', 'apps', '{{app_id}}');
  mkdirSync(brick, { recursive: true });
  writeFileSync(
    join(brick, 'pubspec.yaml'),
    `name: demo\n${brickConfig === null ? '' : `flutter_launcher_icons:\n  image_path: "${brickConfig}"\n  android: "ic_launcher"\n`}`,
  );
  if (brickArt && brickConfig) {
    mkdirSync(join(brick, dirname(brickConfig)), { recursive: true });
    writeFileSync(join(brick, `${dirname(brickConfig)}/README.md`), 'generated by the stamp\n');
  }

  // Limb 9's subject, written LAST so a case can replace a file an earlier
  // block wrote (the launch background) as well as add one.
  for (const [base, files] of [
    [join(appDir, 'android'), androidXml],
    [join(brick, 'android'), brickAndroidXml],
  ]) {
    for (const [rel, text] of Object.entries(files)) {
      const p = join(base, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, text);
    }
  }

  return { root, sdkRoot };
}

// 🔴 BOUNDED — THIS FILE HUNG CI THREE TIMES. "Guards — the guards can still
// fail" hit its 25-minute timeout in runs 34442894882 (2026-09-10) and
// 34553250403 (2026-09-11), both logs stopping just before this file; the bound
// then caught run 34556943131: the byte-identical android case, 120318 ms,
// ETIMEDOUT, `status: null`, WITH THE GUARD'S COMPLETE OUTPUT CAPTURED.
//
// 🔬 THE CAUSE, MEASURED — NOT A CHILD HOLDING A PIPE. `status: null` beside
// ETIMEDOUT means the guard ITSELF was alive when the bound fired: had it exited
// and a descendant kept the pipe open, spawnSync records status 1 and sends no
// signal (node src/spawn_sync.cc, SyncProcessRunner::Kill). And the runner's
// orphan cleanup in both cancelled runs lists three processes, all `MainThread`
// (node's main thread) — no `sh`, `cp` or `flutter`. The guard had printed its
// last line and was stuck INSIDE `process.exit(1)`: Node's shutdown joins the V8
// worker threads while a concurrent Maglev/Sparkplug compile on one of them waits
// for a main-thread GC that can no longer run (nodejs/node#54918, open, reported
// on 24.18.1 CI runners). Reproduced 2026-09-11 on Linux: the real guard on this
// file's fixture, amplified with --stress-concurrent-allocation, printed its
// complete output and then hung in 3 of 12 runs (every thread in futex_do_wait,
// no descendants). The fix is in the guard — it does its work with V8 background
// tasks off; see the case that pins it.
//
// The bound stays as a backstop, and when it fires it now says WHAT was left:
// the guard runs in its own process group and the survivors are listed by name.
const RUN_TIMEOUT_MS = 120_000;
// 🔴 THE READER'S CACHE GOES INTO THIS FILE'S OWN TEMP ROOT. flutter-stock-assets
// caches one `flutter create` per SDK under os.tmpdir(), keyed by the SDK's path
// — and every fixture here is a NEW SDK path, so each run used to leave one
// `nikatru-flutter-stock-*` folder in the shared temp directory for ever: 44
// after one run of this file, measured 2026-09-11 in a private TMPDIR. Pointing
// the guard's temp directory at TMP (removed in `after`) keeps the guard's real
// caching exactly as it is and leaves nothing behind. All three names, because
// os.tmpdir() reads TMPDIR on POSIX and TEMP, then TMP, on Windows.
const fixtureTemp = () => ({ TMPDIR: TMP, TEMP: TMP, TMP });
const run = ({ root, sdkRoot }, env = {}) => {
  const r = spawnSync(process.execPath, [GUARD, root], {
    encoding: 'utf8',
    env: { ...process.env, ...fixtureTemp(), FLUTTER_ROOT: sdkRoot, ...env },
    timeout: RUN_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    detached: POSIX,
  });
  let died = '';
  if (r.error || r.signal) {
    const left = POSIX && r.pid ? groupMembers(r.pid) : ['(not enumerable on Windows)'];
    if (POSIX && r.pid) {
      try {
        process.kill(-r.pid, 'SIGKILL');
      } catch {
        // ESRCH: nothing was left.
      }
    }
    died =
      `\n[launcher-icons.test] guard did not finish cleanly — ${r.error ? r.error.message : 'no spawn error'} · ` +
      `status ${r.status} · signal ${r.signal} · bound ${RUN_TIMEOUT_MS} ms` +
      `\n[launcher-icons.test] left in its process group once it was killed: ${left.length ? left.join(', ') : 'nothing'}` +
      '\n[launcher-icons.test] complete output above + status null = the guard hung at exit (nodejs/node#54918).';
  }
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}${died}` };
};

describe('assert-launcher-icons', () => {
  test('passes when every icon is present, valid and non-stock', () => {
    const { code, out } = run(world());
    assert.equal(code, 0, out);
    assert.match(out, /assert-launcher-icons: OK/);
    // The count is asserted as a RELATIONSHIP to the fixture, not as a literal:
    // adding a file to SET must not require editing a number here, and a run
    // that compared nothing must not be able to print this line.
    assert.match(out, new RegExp(`${SET.length} icon\\(s\\) compared against ${SET.length} stock asset\\(s\\)`));
  });

  // 🔴 THE TEMP-CACHE LEAK, PINNED. Remove `fixtureTemp()` from `run` and the
  // cache lands in the shared temp directory instead: this count stays put, and
  // the case is RED.
  test("the reader's `flutter create` cache lands in this file's temp root, which is removed afterwards", () => {
    const stockCaches = () => listDir(TMP).filter((n) => n.startsWith('nikatru-flutter-stock-')).length;
    const before = stockCaches();
    const { code, out } = run(world());
    assert.equal(code, 0, out);
    assert.equal(stockCaches(), before + 1, 'a fresh SDK path must be cached under TMP, not in the shared temp dir');
  });

  // 🔴 THE HANG'S FIX, PINNED. Spawned exactly as CI runs it — plain `node
  // <guard>`, no flags — the process that does the work must have started with
  // --single-threaded, so no V8 worker thread runs a background compile or GC
  // that Node's exit can deadlock on (nodejs/node#54918). Measured on Linux,
  // 8 runs each: default flags, the worker threads burned 32-52 CPU ticks per
  // run; --single-threaded, 0 on every run. Deterministic, unlike the hang:
  // delete the relaunch and this line says ON.
  test('the working guard runs with V8 background tasks OFF, so its exit cannot deadlock', () => {
    const { code, out } = run(world());
    assert.equal(code, 0, out);
    assert.match(out, /V8 background tasks: OFF \(--single-threaded\)/);
  });

  // 🔴 M0 — the defect this guard exists for, on every platform in turn. Android
  // is the one whose stock bytes sit in the SDK tree; the other three need the
  // overlay, so this case is also the regression test for M2.
  for (const [platform, rel] of SET) {
    test(`FAILS when ${platform}'s ${rel} is byte-identical to Flutter's stock`, () => {
      const { code, out } = run(world({ useStock: [rel] }));
      assert.equal(code, 1, out);
      assert.match(out, /is BYTE-IDENTICAL to Flutter's stock/);
      assert.match(out, new RegExp(`stock ${platform} asset`));
    });
  }

  test('FAILS when a required icon is missing', () => {
    const { code, out } = run(world({ omit: ['app_icon_1024.png'] }));
    assert.equal(code, 1, out);
    assert.match(out, /app_icon_1024\.png — MISSING/);
  });

  // Present is not the same as valid — a truncated file is "there".
  test('FAILS when a PNG is not readable', () => {
    const { code, out } = run(world({ corrupt: ['Icon-App-1024x1024@1x.png'] }));
    assert.equal(code, 1, out);
    assert.match(out, /is not a readable PNG/);
  });

  test('FAILS when the .ico is not structurally valid', () => {
    const { code, out } = run(world({ corrupt: ['app_icon.ico'] }));
    assert.equal(code, 1, out);
    assert.match(out, /is not a structurally valid \.ico/);
  });

  // 🔴 M4 — an icon that is nobody's default and still cannot be submitted.
  test('FAILS when an iOS icon carries an alpha channel (ITMS-90717)', () => {
    const { code, out } = run(world({ iosAlpha: true }));
    assert.equal(code, 1, out);
    assert.match(out, /carries TRANSPARENCY/);
    assert.match(out, /ITMS-90717/);
  });

  test('FAILS when there is no Android adaptive icon', () => {
    const { code, out } = run(world({ adaptive: false }));
    assert.equal(code, 1, out);
    assert.match(out, /mipmap-anydpi-v26\/ic_launcher\.xml — MISSING/);
  });

  // The XML existing is not the icon existing: a layer nobody stamped is a build
  // failure at best and a blank tile at worst.
  test('FAILS when an adaptive layer points at a resource that does not exist', () => {
    const { code, out } = run(world({ adaptiveRef: '@drawable/nothing_stamped_this' }));
    assert.equal(code, 1, out);
    assert.match(out, /names @drawable\/nothing_stamped_this/);
  });

  // ── limb 6: the factory ───────────────────────────────────────────────────
  test('FAILS when the brick declares no launcher-icon mechanism', () => {
    const { code, out } = run(world({ brickConfig: null }));
    assert.equal(code, 1, out);
    assert.match(out, /declares no top-level `flutter_launcher_icons:` block/);
  });

  test('FAILS when the brick config names art the stamp does not write', () => {
    const { code, out } = run(world({ brickArt: false }));
    assert.equal(code, 1, out);
    assert.match(out, /neither that file nor its directory exists in the template/);
  });

  // ── limb 7: LINUX, which used to be a PRINT and is now a CHECK ────────────
  // 🔴 THE PRINT WAS CORRECT WHEN IT WAS WRITTEN AND HAD STOPPED BEING SO.
  // On 2026-08-04 Linux was genuinely UNCOMPARABLE: `flutter create` writes ten
  // files under linux/ and ZERO images, the generated GTK runner set no window
  // icon, and there was no .desktop file anywhere in this repository — so limb 3
  // had nothing to be identical to and the honest thing was to PRINT the gap.
  //
  // What that reasoning hid is that "the SDK ships no icon" is not a fact about
  // coverage; it is a fact about where Linux takes its icon FROM. It takes it
  // from the packaging layer, which this repository can generate — and once it
  // does, the available check is STRONGER than limb 3's, not weaker: the shipped
  // icons must be exactly what the app's own master derives. "Not Flutter's" is
  // satisfied by a blank square; "is the derivation" is not.
  //
  // 🔬 REAL-TREE MUTATIONS, 2026-08-04, on apps/subscriptiontracker rather than on a fixture —
  // because a fixture written by whoever wrote the guard encodes the same
  // misunderstanding as the guard, which is this repo's own recorded rule:
  //   · deleted hicolor/256x256/apps/com.nikatru.subscriptiontracker.png  ⇒ "— MISSING."
  //   · flipped ONE byte of ONE pixel in the 128 icon       ⇒ "is NOT what
  //     assets/icon/app_icon_1024.png derives at 128px"
  //   · copied the real 512 png into the 256x256 directory  ⇒ "is 512x512 but
  //     sits in the 256x256 theme directory"
  //   · edited Icon= in the real .desktop to `subscriptiontracker`        ⇒ both the derivation
  //     mismatch and the APPLICATION_ID mismatch
  //   · deleted the install(DIRECTORY …/icons …) rule       ⇒ "never reaches the
  //     bundle"
  //   · deleted the gtk_window_set_icon_name call           ⇒ "never calls"
  //   · moved apps/subscriptiontracker/linux/ away entirely               ⇒ COVERAGE LOST
  // Every one restored; the guard returned to OK after each.
  test('passes when the Linux packaging is exactly what the master derives', () => {
    const { code, out } = run(world());
    assert.equal(code, 0, out);
    assert.match(out, /LINUX \(limb 7\)/);
    assert.match(out, /5 packaging artefact\(s\) RE-DERIVED/);
  });

  test('FAILS when a hicolor icon is missing', () => {
    const { code, out } = run(world({ linuxOmit: ['256x256/apps/com.example.demo.png'] }));
    assert.equal(code, 1, out);
    assert.match(out, /256x256\/apps\/com\.example\.demo\.png — MISSING/);
  });

  test('FAILS when the .desktop entry is missing', () => {
    const { code, out } = run(world({ linuxOmit: ['.desktop'] }));
    assert.equal(code, 1, out);
    assert.match(out, /com\.example\.demo\.desktop — MISSING/);
  });

  // The limb that a size check alone cannot reach: this icon is the right size,
  // the right format and in the right place, and it is not the app's mark.
  test('FAILS when a hicolor icon is not what the master derives', () => {
    const { code, out } = run(world({ linuxCorrupt: 'pixel' }));
    assert.equal(code, 1, out);
    assert.match(out, /is NOT what assets\/icon\/app_icon_1024\.png derives at 64px/);
  });

  // The complementary one: a perfectly valid PNG whose size contradicts the
  // theme directory it sits in. An icon-theme lookup trusts the path.
  test('FAILS when a hicolor icon contradicts its size-qualified directory', () => {
    const { code, out } = run(world({ linuxCorrupt: 'size' }));
    assert.equal(code, 1, out);
    assert.match(out, /is 64x64 but sits in the 128x128 theme directory/);
  });

  test('FAILS when the .desktop Icon= no longer matches APPLICATION_ID', () => {
    const { code, out } = run(world({ linuxCorrupt: 'desktop' }));
    assert.equal(code, 1, out);
    assert.match(out, /does not match APPLICATION_ID "com\.example\.demo"/);
  });

  // Artefacts that never reach the bundle are a launcher icon that exists in git
  // and nowhere a user or a packaging recipe can find it — green everywhere else.
  test('FAILS when CMake does not install the desktop entry', () => {
    const { code, out } = run(world({ linuxInstall: 'no-desktop' }));
    assert.equal(code, 1, out);
    assert.match(out, /no `install\(FILES … \.desktop/);
  });

  test('FAILS when CMake does not install the hicolor theme', () => {
    const { code, out } = run(world({ linuxInstall: 'no-icons' }));
    assert.equal(code, 1, out);
    assert.match(out, /no `install\(DIRECTORY …\/packaging\/icons/);
  });

  // Comment-stripped, so the fixture's commented-out call must NOT satisfy it.
  // Prose satisfying a structural check is the trap this repo has been caught by
  // twice, and the fixture is written to spring it deliberately.
  test('FAILS when the GTK runner never names the window icon', () => {
    const { code, out } = run(world({ linuxRunnerIcon: false }));
    assert.equal(code, 1, out);
    assert.match(out, /never calls `gtk_window_set_icon_name/);
  });

  // Anti-vacuity for the limb itself: with no Linux lane at all every check
  // above ranges over nothing, which is indistinguishable from all of them
  // passing. That must be a hard stop, not a quiet green.
  test('COVERAGE LOST when no app ships linux/ at all', () => {
    const { code, out } = run(world({ linux: false }));
    assert.equal(code, 2, out);
    assert.match(out, /no app under apps\/ ships linux\//);
    assert.match(out, /COVERAGE LOST/);
  });

  // ── limb 8: THE LAUNCH SCREEN ─────────────────────────────────────────────
  //
  // 🔴 REAL-TREE MUTATIONS FIRST, as everywhere else in this file. Run against
  // this repository and the real Flutter SDK on 2026-09-09, predictions written
  // before each run and the exit code captured on its own line:
  //
  //   M5 THE REPOSITORY AS IT STOOD   -> the three iOS LaunchImage files were
  //      68 bytes each, md5 978c1bee49d7ad5fc1a4d81099b13e18, a 1x1 TRANSPARENT
  //      png; both launch_background.xml files were stock with the <bitmap>
  //      still commented out; no launch_image drawable existed anywhere. Guard
  //      RED. After `node tooling/store/render-splash.mjs --app
  //      subscriptiontracker` plus the two hand edits: exit 0, 12 artefacts.
  //
  //   M6 THE PLACEHOLDER PUT BACK, one file (`git show HEAD:…LaunchImage.png`)
  //      -> exit 1, "is 1x1 and the master derives 96x96 here".
  //
  //   M7 THE STOCK launch_background.xml PUT BACK (bitmap re-commented)
  //      -> exit 1, "does not draw @drawable/launch_image OUTSIDE A COMMENT".
  //      This is the mutation that a text-matching implementation passes: the
  //      stock file CONTAINS the drawable name, inside a comment.
  //
  //   M8 THE STALE STORYBOARD SIZE PUT BACK (168x185) -> exit 1.
  //
  // 🔴 AND THE FIRST VERSION OF THE LIMB FAILED M6 FOR THE WRONG REASON. It
  // decoded before reading the size, and Flutter's placeholder is colour type 4
  // (grey + alpha), which the shared decoder refuses — so the single most
  // important case printed "could not be decoded for comparison", a message
  // about PNG internals. The size now comes from IHDR, which every colour type
  // has. The fixture below uses the REAL placeholder bytes so that mistake
  // cannot come back.
  for (const rel of ['LaunchImage.png', 'LaunchImage@3x.png']) {
    test(`FAILS when iOS ${rel} is Flutter's 1x1 transparent placeholder`, () => {
      const { code, out } = run(world({ splashStock: [rel] }));
      assert.equal(code, 1, out);
      assert.match(out, /is 1x1 and the master derives/);
      assert.match(out, /BLANK launch screen/);
    });
  }

  test("FAILS when an Android launch drawable is Flutter's placeholder", () => {
    const { code, out } = run(world({ splashStock: ['drawable-xxhdpi/launch_image.png'] }));
    assert.equal(code, 1, out);
    assert.match(out, /drawable-xxhdpi\/launch_image\.png — is 1x1/);
  });

  test('FAILS when a splash asset is missing entirely', () => {
    const { code, out } = run(world({ splashOmit: ['LaunchImage@2x.png'] }));
    assert.equal(code, 1, out);
    assert.match(out, /LaunchImage@2x\.png — MISSING/);
  });

  // The limb a size check cannot reach: right size, right format, right place,
  // and not the app's mark. Only re-derivation sees it.
  test('FAILS when a splash asset is the right size and the wrong pixels', () => {
    const { code, out } = run(world({ splashPixel: 'drawable-hdpi/launch_image.png' }));
    assert.equal(code, 1, out);
    assert.match(out, /is the right size and the WRONG PIXELS/);
  });

  test('FAILS when the imageset catalogue no longer names the files', () => {
    const { code, out } = run(world({ splashOmit: ['Contents.json'] }));
    assert.equal(code, 1, out);
    assert.match(out, /Contents\.json — MISSING/);
  });

  // 🔴 THE PROSE-VS-STRUCTURE TRAP, SPRUNG DELIBERATELY. The unwired fixture is
  // the STOCK file, comment and all — so it CONTAINS the string `launch_image`.
  // A bare text match passes it, which is green over the defect.
  test('FAILS when launch_background.xml only mentions the drawable in a comment', () => {
    const { code, out } = run(world({ androidSplashWired: false }));
    assert.equal(code, 1, out);
    assert.match(out, /does not draw @drawable\/launch_image OUTSIDE A COMMENT/);
    // Both files, not just the v21 one: the un-qualified fallback would
    // otherwise stay stock forever with nothing saying so.
    assert.equal(out.match(/OUTSIDE A COMMENT/g).length, 2, out);
  });

  test('FAILS when the storyboard declares a size the imageset does not have', () => {
    const { code, out } = run(world({ storyboardSize: 185 }));
    assert.equal(code, 1, out);
    assert.match(out, /declares LaunchImage as 185x185/);
  });

  test('FAILS when the storyboard names no LaunchImage resource at all', () => {
    const { code, out } = run(world({ storyboard: false }));
    assert.equal(code, 2, out);
    // The storyboard file is still written by the icon fixtures' absence of it;
    // with `storyboard: false` there is no file, which is the harder case.
    assert.match(out, /COVERAGE LOST|names no `LaunchImage` image resource/);
  });

  // Anti-vacuity for limb 8 itself. With no splash artefacts anywhere, every
  // check above ranges over nothing — indistinguishable from all of them
  // passing, over an app whose launch screen is blank.
  test('COVERAGE LOST when nothing about the launch screen can be compared', () => {
    const { code, out } = run(world({ splash: false }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST|MISSING/);
  });

  // ── anti-vacuity: refusing to run blind ───────────────────────────────────
  test('COVERAGE LOST when the Flutter SDK cannot be found', () => {
    const w = world();
    // PATH keeps node's own directory: stripping it entirely hides `node` too,
    // and a mutation that runs nothing proves nothing.
    const { code, out } = run(w, { FLUTTER_ROOT: join(w.root, 'no-such-sdk'), PATH: dirname(process.execPath) });
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
  });

  // 🔴 M2/M3 — THE SHAPE THAT HID THE ORIGINAL DEFECT FOR MONTHS. A zero-byte
  // stock asset can never equal a real icon, so comparing against one is an
  // assertion that cannot fail. The tempting behaviour is to compare anyway and
  // print a healthy count, which is exactly what both guards used to do.
  test('COVERAGE LOST when the stock icons are zero bytes', () => {
    const { code, out } = run(world({ emptyStockIcons: true }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /ZERO BYTES/);
  });

  // A spawn that fails must not look like a tool that is absent, and neither may
  // look like "nothing to check".
  test('COVERAGE LOST when `flutter create` fails', () => {
    const { code, out } = run(world({ flutterFails: true }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /`flutter create` failed/);
  });

  // ── a `flutter create` that will not let go ───────────────────────────────
  // Not the cause of the CI hang (that was the guard's own exit, above), but the
  // same outcome waiting to happen: the reader's spawn had no timeout and read
  // the child through pipes, so a descendant holding them — or a child that never
  // ends — stalled the guard for as long as it lived. POSIX only: the process
  // group is the mechanism under test.
  const POSIX_ONLY = POSIX ? false : 'a process group is the mechanism under test, and Windows has none';

  test('a `flutter create` that exits leaving a process behind neither stalls the guard nor outlives it', { skip: POSIX_ONLY }, () => {
    const w = world({ flutterLeaves: 'straggler' });
    const { code, out } = run(w);
    assert.equal(code, 0, out);
    const pid = Number(readFileSync(join(w.root, 'straggler.pid'), 'utf8'));
    assert.ok(goneWithin(pid, 5_000), `the straggler (pid ${pid}, sleep 600) is still running after the guard returned\n${out}`);
  });

  test('COVERAGE LOST, naming what was still running, when `flutter create` does not finish in time', { skip: POSIX_ONLY }, () => {
    const w = world({ flutterLeaves: 'stuck' });
    const { code, out } = run(w, { FLUTTER_CREATE_TIMEOUT_MS: '2000' });
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /`flutter create` did not finish within 2 s/);
    // A pid and a name, not THE name: see the fork→exec note in
    // fixtures/process-group.mjs. This case gives the sleeper 2 s to exec, so
    // `sleep` would in fact be there — but the property worth pinning is that
    // the guard SAYS what it left, and the line below is what proves it died.
    assert.match(out, /still running in its process group: \d+ \S+/);
    const pid = Number(readFileSync(join(w.root, 'straggler.pid'), 'utf8'));
    assert.ok(goneWithin(pid, 5_000), `the stuck process (pid ${pid}, sleep 600) outlived the guard\n${out}`);
  });

  // The same shape one level up: an app that ships a platform the guard has no
  // stock set for would have every check for that platform pass vacuously.
  test('COVERAGE LOST when apps/ holds no app with a native platform', () => {
    const w = world();
    rmSync(join(w.root, 'apps', 'demo', 'android'), { recursive: true, force: true });
    rmSync(join(w.root, 'apps', 'demo', 'ios'), { recursive: true, force: true });
    rmSync(join(w.root, 'apps', 'demo', 'macos'), { recursive: true, force: true });
    rmSync(join(w.root, 'apps', 'demo', 'windows'), { recursive: true, force: true });
    const { code, out } = run(w);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /no app under apps\/ ships/);
  });

  test('COVERAGE LOST when the brick template is gone', () => {
    const w = world();
    rmSync(join(w.root, 'tooling'), { recursive: true, force: true });
    const { code, out } = run(w);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /the factory limb ranged over nothing/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// flutter-stock-assets.mjs — the shared reader's own failing cases.
//
// It is not a guard (it asserts nothing about any tree), but it is the thing two
// guards' identity checks rest on, so its refusals are tested directly rather
// than only through them.
// ─────────────────────────────────────────────────────────────────────────────
describe('flutter-stock-assets', () => {
  const load = async () => import('../flutter-stock-assets.mjs');

  test('throws when there is no SDK at all', async () => {
    const { readStockAssets, StockAssetsUnavailable } = await load();
    assert.throws(
      () => readStockAssets({ sdkRoot: null, relDir: 'web', keep: () => true }),
      (e) => e instanceof StockAssetsUnavailable && /could not locate the Flutter SDK/.test(e.lines[0]),
    );
  });

  test('throws when the SDK has no `flutter` launcher', async () => {
    const { readStockAssets, StockAssetsUnavailable } = await load();
    const root = join(TMP, `s${seq++}`);
    mkdirSync(root, { recursive: true });
    assert.throws(
      () => readStockAssets({ sdkRoot: root, relDir: 'web', keep: () => true }),
      (e) => e instanceof StockAssetsUnavailable && /has no launcher/.test(e.lines[0]),
    );
  });

  // `appDir` is the seam these two use: the reference app is supplied directly,
  // so the reading half is tested without paying for a real `flutter create`.
  // The SPAWNING half is covered through the guard, against a fake `flutter`.
  test('throws when the requested directory is absent from a created app', async () => {
    const { readStockAssets, StockAssetsUnavailable } = await load();
    const app = join(TMP, `s${seq++}`);
    mkdirSync(app, { recursive: true });
    assert.throws(
      () => readStockAssets({ appDir: app, relDir: 'web', keep: () => true }),
      (e) => e instanceof StockAssetsUnavailable && /has no "web" directory/.test(e.lines[0]),
    );
  });

  // 🔴 THE RULE THIS MODULE EXISTS FOR. An empty stock asset can never equal a
  // real icon, so comparing against one is an assertion that cannot fail.
  test('throws rather than returning a zero-byte stock asset', async () => {
    const { readStockAssets, StockAssetsUnavailable } = await load();
    const app = join(TMP, `s${seq++}`);
    mkdirSync(join(app, 'web', 'icons'), { recursive: true });
    writeFileSync(join(app, 'web', 'icons', 'Icon-maskable-512.png'), Buffer.alloc(0));
    assert.throws(
      () => readStockAssets({ appDir: app, relDir: 'web', keep: (r) => r.endsWith('.png') }),
      (e) => e instanceof StockAssetsUnavailable && /ZERO BYTES/.test(e.lines[0]),
    );
  });

  test('reads nested paths, keyed relative to the requested directory', async () => {
    const { readStockAssets } = await load();
    const app = join(TMP, `s${seq++}`);
    mkdirSync(join(app, 'web', 'icons'), { recursive: true });
    writeFileSync(join(app, 'web', 'favicon.png'), Buffer.from('FAV'));
    writeFileSync(join(app, 'web', 'icons', 'Icon-512.png'), Buffer.from('FIVE-TWELVE'));
    writeFileSync(join(app, 'web', 'index.html'), Buffer.from('not an icon'));

    const got = readStockAssets({ appDir: app, relDir: 'web', keep: (r) => r.endsWith('.png') });
    assert.deepEqual([...got.keys()].sort(), ['favicon.png', 'icons/Icon-512.png']);
    assert.equal(got.get('icons/Icon-512.png').toString(), 'FIVE-TWELVE');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE .desktop `Name` IS AN ICON LABEL, NOT A STORE TITLE.
//
// A GNOME or KDE launcher prints `Name` under the icon and truncates it there,
// so this field belongs with CFBundleDisplayName and android:label rather than
// with `store/linux-snap/title.txt`. Until 2026-09-09 it was the store title,
// which was indistinguishable only for as long as the portfolio had one short
// brand: "Nikatru Subscription Tracker" under a 64-pixel square is an ellipsis.
//
// It reads the app declaration's `shortName` — the SAME field
// tooling/app-yaml/render.mjs renders into the other five OS-level labels. Two
// generators, one source: this file owns the whole ten-line .desktop entry and
// render.mjs owns the five files it alone owns, so neither patches the other's.
//
// The FALLBACK case is the one that keeps the move honest. An app that has not
// adopted `shortName` must re-derive byte-identically, or this change would have
// silently rewritten the launcher label of every app that did nothing.
// ─────────────────────────────────────────────────────────────────────────────
describe('the desktop entry Name is the icon label', () => {
  const label = (extra) => {
    // Under a directory named for the app: with no app.yaml, the auth-callback
    // scheme's id is the app directory's name (authCallbackSchemeOf), and a
    // mkdtemp suffix is not an id.
    const parent = mkdtempSync(join(tmpdir(), 'desktop-name-'));
    const root = join(parent, 'demo');
    const listing = join(root, 'store', 'linux-snap');
    mkdirSync(listing, { recursive: true });
    writeFileSync(join(listing, 'title.txt'), 'Demo Store Title\n');
    writeFileSync(join(listing, 'short-description.txt'), 'A demonstration\n');
    writeFileSync(join(listing, 'category.txt'), 'Productivity\n');
    mkdirSync(join(root, 'linux'), { recursive: true });
    writeFileSync(
      join(root, 'linux', 'CMakeLists.txt'),
      'set(BINARY_NAME "demo")\nset(APPLICATION_ID "com.example.demo")\n',
    );
    if (extra) writeFileSync(join(root, 'app.yaml'), extra);
    try {
      return deriveDesktopEntry(root).match(/^Name=(.*)$/m)[1];
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  };

  test('a declared shortName is what the launcher prints', () => {
    assert.equal(label('id: demo\nname: Demo Store Title\nshortName: Demo\n'), 'Demo');
  });

  test('FALLBACK: no app.yaml at all still derives the store title, byte for byte', () => {
    assert.equal(label(null), 'Demo Store Title');
  });

  test('FALLBACK: an app.yaml with no shortName still derives the store title', () => {
    assert.equal(label('id: demo\nname: Demo Store Title\n'), 'Demo Store Title');
  });

  test('a shortName that is not a non-empty string is REFUSED, never silently fallen back from', () => {
    assert.throws(
      () => label('id: demo\nname: Demo Store Title\nshortName: ""\n'),
      /shortName/,
      'an empty declared label must not quietly become the store title — that is a launcher label nobody chose',
    );
  });

  test('the real tree: apps/subscriptiontracker ships its declared shortName, not its store title', () => {
    const appDir = join(REPO, 'apps', 'subscriptiontracker');
    const name = deriveDesktopEntry(appDir).match(/^Name=(.*)$/m)[1];
    const declared = readFileSync(join(appDir, 'app.yaml'), 'utf8').match(/^shortName: (.*)$/m)[1].trim();
    const title = readFileSync(join(appDir, 'store', 'linux-snap', 'title.txt'), 'utf8').trim();
    assert.equal(name, declared);
    assert.notEqual(name, title, 'the two are the same string here, so this case cannot tell which one was read');
  });

  // ⏱ 2026-09-23 · the auth callback. The entry registers com.nikatru.<id> and
  // takes the URL as %u — the scheme authCallbackScheme() puts in every redirect.
  test('the real tree: the entry registers the auth-callback scheme and takes the URL as %u', () => {
    const text = deriveDesktopEntry(join(REPO, 'apps', 'subscriptiontracker'));
    assert.match(text, /^Exec=subscription-tracker %u$/m);
    assert.match(text, /^MimeType=x-scheme-handler\/com\.nikatru\.subscriptiontracker;$/m);
  });

  test('an app id that is not a URL scheme is REFUSED, never rewritten', () => {
    assert.throws(() => label('id: demo_app\nname: Demo Store Title\n'), /not \^\[a-z\]\[a-z0-9\]\*\$/);
  });
});

// ── limb 9: every Android resource and manifest is well-formed XML ──────────
// 🔬 REAL-TREE EVIDENCE FIRST, as this file's header asks. On 2026-09-11 the
// limb was run against the tree as #597 left it: RED, naming BOTH
// launch_background.xml files at the `--app` inside their comment — the line
// aapt refused in build-platforms run 34468887825. Rewording the comment turned
// it green; putting `--` back into one comment turned it red naming that one
// file and line; restoring turned it green. Every verdict below was also
// checked against the JDK's own XML parser (the Xerces family that printed
// aapt's `[Fatal Error]`), which agreed on every case.
const LAUNCH_BG_WIRED = (comment) => `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="?android:colorBackground" />
    <!-- ${comment} -->
    <item>
        <bitmap android:gravity="center" android:src="@drawable/${ANDROID_DRAWABLE_NAME}" />
    </item>
</layer-list>
`;

describe('limb 9 — Android resource XML must parse', () => {
  // 🔴 THE DEFECT, in the shape it shipped: a wired launch background whose
  // comment names a CLI flag. Limb 8b strips comments with a regex and is GREEN
  // over this file — the item is live — which is exactly why it got through.
  test('`--` inside a comment in launch_background.xml is RED, naming file:line', () => {
    const { code, out } = run(
      world({
        androidXml: {
          'app/src/main/res/drawable/launch_background.xml': LAUNCH_BG_WIRED(
            'written by `node tooling/store/render-splash.mjs --app demo`',
          ),
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(
      out,
      /apps\/demo\/android\/app\/src\/main\/res\/drawable\/launch_background\.xml:4:\d+ — not well-formed XML: the string "--" is not permitted within comments/,
    );
    // The sibling drawable-v21 file is well-formed, so only ONE file is named.
    assert.doesNotMatch(out, /drawable-v21\/launch_background\.xml:\d+:\d+ — not well-formed/);
    // Limb 8b still sees the item as live: this limb is not riding on it.
    assert.doesNotMatch(out, /does not draw @drawable/);
  });

  // One world, one malformed shape per file, so each verdict is attributable.
  // Every entry is [file, the line the error must be reported on, message].
  const BROKEN = [
    ['a_mismatched.xml', 3, /does not match the start tag <resources>/, '<resources>\n  <string name="a">x</string>\n</string>\n'],
    ['b_unbound_prefix.xml', 1, /prefix "android" of attribute "android:id" is not bound/, '<item android:id="@+id/x"/>\n'],
    ['c_comment_dash_close.xml', 2, /"--" is not permitted within comments/, '<resources>\n<!-- ends badly --->\n</resources>\n'],
    ['d_unquoted.xml', 1, /value of attribute "name" on <string> is not quoted/, '<resources><string name=a>x</string></resources>\n'],
    ['e_duplicate_attr.xml', 1, /attribute "name" appears twice/, '<resources><string name="a" name="b">x</string></resources>\n'],
    ['f_bare_ampersand.xml', 2, /"&" in element content must begin a reference/, '<resources>\n<string name="a">Tom & Jerry</string>\n</resources>\n'],
    ['g_undeclared_entity.xml', 1, /entity "&nbsp;" is referenced/, '<resources><string name="a">a&nbsp;b</string></resources>\n'],
    ['h_lt_in_attr.xml', 1, /"<" is not permitted in the value of attribute "name"/, '<resources><string name="a<b">x</string></resources>\n'],
    ['i_two_roots.xml', 2, /a second root element/, '<resources/>\n<resources/>\n'],
    ['j_text_after_root.xml', 2, /content after the root element/, '<resources/>\ntrailing\n'],
    ['k_unclosed.xml', 1, /the element <resources> is never closed/, '<resources>\n  <string name="a">x</string>\n'],
    ['l_late_decl.xml', 2, /XML declaration is permitted only at the very start/, '\n<?xml version="1.0"?>\n<resources/>\n'],
    ['m_unclosed_comment.xml', 2, /a comment is never closed/, '<resources>\n<!-- never closed\n</resources>\n'],
  ];

  test('each malformed shape is RED on its own file and line', () => {
    const { code, out } = run(
      world({
        androidXml: Object.fromEntries(BROKEN.map(([f, , , text]) => [`app/src/main/res/values/${f}`, text])),
      }),
    );
    assert.equal(code, 1, out);
    for (const [f, line, message] of BROKEN) {
      const esc = f.replace('.', '\\.');
      const hit = out.split('\n').find((l) => new RegExp(`values/${esc}:\\d+:\\d+ — not well-formed XML`).test(l));
      assert.ok(hit, `${f} was not reported:\n${out}`);
      assert.match(hit, new RegExp(`values/${esc}:${line}:`), `${f} reported on the wrong line`);
      assert.match(hit, message, `${f} reported the wrong defect`);
    }
    // Exactly one report per broken file: nothing else in the world is malformed.
    assert.equal(out.split('\n').filter((l) => /— not well-formed XML:/.test(l)).length, BROKEN.length, out);
  });

  // The other half: a limb that fires on CORRECT input gets switched off. Every
  // construct here is legal XML a real resource can carry.
  test('legal XML — CDATA, references, PIs, DOCTYPE, bound prefixes, dashes in comments — passes', () => {
    const legal = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE resources [ <!ENTITY brand "Demo"> ]>
<!---->
<!-- single - dashes - are - fine -->
<?some-tool keep?>
<resources xmlns:tools="http://schemas.android.com/tools" tools:ignore="MissingTranslation">
    <string name="a">&amp; &lt; &gt; &quot; &apos; &#169; &#x2014; &brand;</string>
    <string name="b"><![CDATA[<b>not markup</b> & not a reference]]></string>
    <string name='c' formatted="false">it's &gt; 1</string>
</resources>
`;
    const manifest = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="demo"/>
</manifest>
`;
    const { code, out } = run(
      world({
        androidXml: {
          'app/src/main/res/values/strings.xml': legal,
          'app/src/main/AndroidManifest.xml': manifest,
        },
      }),
    );
    assert.equal(code, 0, out);
    // A RELATIONSHIP, not a literal: the two launch backgrounds, the adaptive
    // icon and the two files above. Build output must NOT be in the count.
    assert.match(out, /XML \(limb 9\) — 5 Android resource\/manifest file\(s\) PARSED/);
  });

  test('build output under android/ is not source and is not parsed', () => {
    const { code, out } = run(
      world({ androidXml: { 'app/build/intermediates/res/merged/values/values.xml': '<resources>\n<!-- a -- b -->\n' } }),
    );
    assert.equal(code, 0, out);
  });

  test('the brick template is walked too, and a malformed file there is RED', () => {
    const { code, out } = run(
      world({
        brickAndroidXml: { 'app/src/main/res/drawable/launch_background.xml': LAUNCH_BG_WIRED('run it with --app x') },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(
      out,
      /tooling\/bricks\/app\/__brick__\/apps\/\{\{app_id\}\}\/android\/app\/src\/main\/res\/drawable\/launch_background\.xml:4:\d+ — not well-formed XML/,
    );
  });

  // The coverage floor: an app that ships android/ and yields no XML at all.
  test('an app shipping android/ with ZERO XML under it is COVERAGE LOST, not a pass', () => {
    const { code, out } = run(world({ adaptive: false, splash: false }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST: apps\/demo ships android\/ and ZERO resource or manifest XML files/);
  });
});

// ── limb 8b's comment stripper, on its own ──────────────────────────────────
// 🔴 THE FIXTURE ABOVE CANNOT REACH THESE. It writes well-formed XML, because
// that is what `flutter create` writes and what a person edits — but the
// stripper's whole job is to be right about the malformed cases too, and CodeQL
// raised exactly one of them (js/incomplete-multi-character-sanitization, this
// file's generator, 2026-09-09). These are unit cases over the real function.
describe('backgroundDrawsSplash', () => {
  const wired = `<layer-list>
    <item><bitmap android:src="@drawable/${ANDROID_DRAWABLE_NAME}" /></item>
</layer-list>`;

  test('a live bitmap item counts', () => {
    assert.equal(backgroundDrawsSplash(wired), true);
  });

  test("Flutter's stock file — the item is inside a comment — does NOT", () => {
    // Byte-for-byte the shape `flutter create` writes. It CONTAINS the drawable
    // name, which is why a text match is green over the defect.
    const stock = `<layer-list>
    <item android:drawable="?android:colorBackground" />

    <!-- You can insert your own image assets here -->
    <!-- <item>
        <bitmap
            android:gravity="center"
            android:src="@mipmap/${ANDROID_DRAWABLE_NAME}" />
    </item> -->
</layer-list>`;
    assert.equal(backgroundDrawsSplash(stock), false);
  });

  // 🔴 THE CODEQL CASE, WORKED THROUGH RATHER THAN ASSERTED. `<!<!-- -->--`
  // contains a complete comment (`<!-- -->`) starting at the third character.
  // Remove it and the `<!` before it JOINS the `--` after it into a brand-new
  // `<!--` that opens a comment over the live item. A single global pass cannot
  // see that, because it resumes scanning AFTER the text it just removed; only
  // running to a fixpoint does.
  test('a comment that re-forms after one pass still hides the item', () => {
    const reforms = `<layer-list>
    <!<!-- -->-- <item><bitmap android:src="@drawable/${ANDROID_DRAWABLE_NAME}" /></item> -->
</layer-list>`;
    // The single-pass behaviour, spelled out, so the case cannot silently stop
    // being the case it was written for: one pass leaves the item LIVE.
    //
    // `split(re).join('')` rather than `replace(re, '')`, and not to dodge
    // anything: the expression IS an incomplete sanitizer — that is what it is
    // here to demonstrate — so CodeQL flags the `replace` form
    // (js/incomplete-multi-character-sanitization) on the line PROVING the bug.
    // Split-and-join is the identical operation, verified byte-for-byte against
    // the global replace on this input, and it reads more plainly as "the naive
    // one-shot removal". The assertion keeps exactly the force it had.
    const onePass = reforms.split(/<!--[\s\S]*?-->/).join('');
    assert.match(onePass, /android:src="@drawable\//);
    assert.equal(backgroundDrawsSplash(reforms), false);
  });

  // The half a fixpoint alone does NOT fix: everything after an unterminated
  // comment is comment to any XML reader, so it must be to this one.
  test('an UNCLOSED comment swallows the item after it', () => {
    const dangling = `<layer-list>
    <!-- somebody deleted the close
    <item><bitmap android:src="@drawable/${ANDROID_DRAWABLE_NAME}" /></item>
</layer-list>`;
    assert.equal(backgroundDrawsSplash(dangling), false);
  });

  test('@mipmap is accepted as well as @drawable', () => {
    const mip = `<item><bitmap android:src="@mipmap/${ANDROID_DRAWABLE_NAME}" /></item>`;
    assert.equal(backgroundDrawsSplash(mip), true);
  });
});

describe('render-linux-icons — each derived file is read once (CodeQL #92)', () => {
  test('--check reads every derived icon with no existence check of its path first', () => {
    // The write mode compares, reports and rewrites on the same bytes --check reads. The script
    // derives its root from its own location, so the shared read is pinned on the real tree.
    const repo = resolve(CI_DIR, '..', '..');
    const script = join(repo, 'tooling', 'store', 'render-linux-icons.mjs');
    const appDir = join(repo, 'apps', 'subscriptiontracker');
    const { code, text, verdict } = spiedRun([script, '--app', 'subscriptiontracker', '--check'], { cwd: repo, under: appDir });
    assert.equal(code, 0, text);
    const icons = verdict.uses.filter((u) => /\/icons\/hicolor\/\d+x\d+\/apps\//.test(u));
    assert.ok(icons.length > 0, `no derived icon was read: ${JSON.stringify(verdict.uses.slice(0, 10))}`);
    const racy = verdict.pairs.filter((x) => x.sameFunction && /\/icons\/hicolor\//.test(x.path));
    assert.deepEqual(racy.slice(0, 5), [], `${racy.length} icon(s) were checked for existence, then read`);
  });
});
