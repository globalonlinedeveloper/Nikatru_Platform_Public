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
//      REAL stock `Icon-maskable-512.png` over `apps/subly`'s:
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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-launcher-icons.mjs');

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

const SDK_DIR = {
  android: 'android.tmpl/app/src/main/res',
  ios: 'ios.tmpl/Runner/Assets.xcassets/AppIcon.appiconset',
  macos: 'macos.tmpl/Runner/Assets.xcassets/AppIcon.appiconset',
  windows: 'windows.tmpl/runner/resources',
  web: 'web',
};
const APP_DIR = {
  android: 'android/app/src/main/res',
  ios: 'ios/Runner/Assets.xcassets/AppIcon.appiconset',
  macos: 'macos/Runner/Assets.xcassets/AppIcon.appiconset',
  windows: 'windows/runner/resources',
  web: 'web',
};

/**
 * Builds a repo-shaped fixture.
 *
 * 🔴 `overlay` MODELS THE REAL SDK, and modelling it wrongly is the whole point
 * of M2/M3. In a real Flutter install every `.img.tmpl` is ZERO BYTES and the
 * bytes live in `flutter_template_images`, resolved through flutter_tools'
 * `package_config.json`. With `overlay: true` the fixture reproduces that split;
 * with `overlay: false` the SDK holds empty placeholders and nothing else, which
 * MUST be COVERAGE LOST rather than a pass.
 */
function world({
  useStock = [],
  omit = [],
  corrupt = [],
  iosAlpha = false,
  adaptive = true,
  adaptiveRef = '@drawable/ic_launcher_foreground',
  brickConfig = 'assets/icon/app_icon.png',
  brickArt = true,
  overlay = true,
} = {}) {
  const root = join(TMP, `r${seq++}`);
  const sdkRoot = join(root, 'sdk');
  const templates = join(sdkRoot, 'packages', 'flutter_tools', 'templates', 'app');
  const imagesRoot = join(root, 'template-images');

  const stockBytes = (rel) => (rel.endsWith('.ico') ? ico(png(8, STOCK)) : png(8, STOCK));

  for (const [platform, rel] of SET) {
    // The SDK tree. `.img.tmpl` is EMPTY for every platform except android,
    // whose stock icon is a plain file — exactly the real 3.44.7 layout.
    const sdkFile = join(templates, SDK_DIR[platform], platform === 'android' ? rel : `${rel}.img.tmpl`);
    mkdirSync(dirname(sdkFile), { recursive: true });
    writeFileSync(sdkFile, platform === 'android' ? stockBytes(rel) : Buffer.alloc(0));

    if (overlay && platform !== 'android') {
      const overlayFile = join(imagesRoot, 'templates', 'app', SDK_DIR[platform], rel);
      mkdirSync(dirname(overlayFile), { recursive: true });
      writeFileSync(overlayFile, stockBytes(rel));
    }
  }
  // The overlay's location comes from flutter_tools' own package_config.json.
  const dartTool = join(sdkRoot, 'packages', 'flutter_tools', '.dart_tool');
  mkdirSync(dartTool, { recursive: true });
  writeFileSync(
    join(dartTool, 'package_config.json'),
    JSON.stringify({
      configVersion: 2,
      packages: overlay
        ? [{ name: 'flutter_template_images', rootUri: `file:///${imagesRoot.replace(/\\/g, '/')}`, packageUri: 'lib/' }]
        : [],
    }),
  );

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

  return { root, sdkRoot };
}

const run = ({ root, sdkRoot }, env = {}) => {
  const r = spawnSync(process.execPath, [GUARD, root], {
    encoding: 'utf8',
    env: { ...process.env, FLUTTER_ROOT: sdkRoot, ...env },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
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

  // ── anti-vacuity: refusing to run blind ───────────────────────────────────
  test('COVERAGE LOST when the Flutter SDK cannot be found', () => {
    const w = world();
    // PATH keeps node's own directory: stripping it entirely hides `node` too,
    // and a mutation that runs nothing proves nothing.
    const { code, out } = run(w, { FLUTTER_ROOT: join(w.root, 'no-such-sdk'), PATH: dirname(process.execPath) });
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
  });

  // 🔴 M2/M3 — THE CASE THE OLD FIXTURE GOT WRONG. Without the overlay the SDK
  // holds zero-byte `.img.tmpl` placeholders, which can never equal a real icon.
  // The tempting behaviour is to compare anyway and print a healthy count.
  test('COVERAGE LOST when stock assets resolve to zero bytes (no overlay)', () => {
    const { code, out } = run(world({ overlay: false }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /resolved to ZERO BYTES/);
    assert.match(out, /flutter_template_images/);
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
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /no app under apps\/ ships/);
  });

  test('COVERAGE LOST when the brick template is gone', () => {
    const w = world();
    rmSync(join(w.root, 'tooling'), { recursive: true, force: true });
    const { code, out } = run(w);
    assert.equal(code, 1, out);
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

  test('strips every template suffix to the shipped filename', async () => {
    const { shippedName } = await load();
    assert.equal(shippedName('Icon-192.png.copy.tmpl'), 'Icon-192.png');
    assert.equal(shippedName('app_icon.ico.img.tmpl'), 'app_icon.ico');
    assert.equal(shippedName('ic_launcher.png'), 'ic_launcher.png');
  });

  test('throws when there is no SDK at all', async () => {
    const { readStockAssets, StockAssetsUnavailable } = await load();
    assert.throws(
      () => readStockAssets({ sdkRoot: null, relDir: 'web', keep: () => true }),
      (e) => e instanceof StockAssetsUnavailable && /could not locate the Flutter SDK/.test(e.lines[0]),
    );
  });

  test('throws when the template directory does not exist', async () => {
    const { readStockAssets, StockAssetsUnavailable } = await load();
    const root = join(TMP, `s${seq++}`);
    mkdirSync(root, { recursive: true });
    assert.throws(
      () => readStockAssets({ sdkRoot: root, relDir: 'web', keep: () => true }),
      (e) => e instanceof StockAssetsUnavailable && /neither/.test(e.lines[0]),
    );
  });

  // 🔴 THE RULE THIS MODULE EXISTS FOR. An empty stock asset can never equal a
  // real icon, so comparing against one is an assertion that cannot fail.
  test('throws rather than returning a zero-byte stock asset', async () => {
    const { readStockAssets, StockAssetsUnavailable } = await load();
    const root = join(TMP, `s${seq++}`);
    const dir = join(root, 'packages', 'flutter_tools', 'templates', 'app', 'web');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'Icon-maskable-512.png.img.tmpl'), Buffer.alloc(0));
    assert.throws(
      () => readStockAssets({ sdkRoot: root, relDir: 'web', keep: (r) => r.endsWith('.png') }),
      (e) => e instanceof StockAssetsUnavailable && /ZERO BYTES/.test(e.lines[0]),
    );
  });

  test('the overlay replaces an empty placeholder and wins nothing else', async () => {
    const { readStockAssets } = await load();
    const root = join(TMP, `s${seq++}`);
    const dir = join(root, 'packages', 'flutter_tools', 'templates', 'app', 'web');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'Icon-maskable-512.png.img.tmpl'), Buffer.alloc(0));
    writeFileSync(join(dir, 'Icon-512.png.copy.tmpl'), Buffer.from('REAL-SDK'));

    const images = join(root, 'images');
    const od = join(images, 'templates', 'app', 'web');
    mkdirSync(od, { recursive: true });
    writeFileSync(join(od, 'Icon-maskable-512.png'), Buffer.from('FROM-OVERLAY'));
    // The overlay also carries a name the SDK already has REAL bytes for; the
    // SDK's must win, because that is the copy `flutter create` uses.
    writeFileSync(join(od, 'Icon-512.png'), Buffer.from('OVERLAY-SHOULD-LOSE'));

    const got = readStockAssets({
      sdkRoot: root,
      relDir: 'web',
      keep: (r) => r.endsWith('.png'),
      imagesRoot: images,
    });
    assert.equal(got.get('Icon-maskable-512.png').toString(), 'FROM-OVERLAY');
    assert.equal(got.get('Icon-512.png').toString(), 'REAL-SDK');
  });
});
