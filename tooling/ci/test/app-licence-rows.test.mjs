// ─────────────────────────────────────────────────────────────────────────────
// app-licence-rows.test.mjs — gen-app-licence-rows.mjs must write the rows an
// app's web bundle needs, keep a person's prose, and be able to FAIL.
//
// LEAD RULING NP12B-R2 (LEAD RULING 34, ONE PIPELINE), 2026-09-27: the brick's
// stamp step writes the asset-register licence rows for every package asset an
// app ships, through a generator with a guard. What is pinned here:
//   · the pubspec reader (package-assets.mjs): the plain entry, the
//     `packages/<p>/…` entry that names <p>'s lib/, the `- path:` mapping with a
//     block or a flow `platforms:` list, fonts, commented-out blocks — and the
//     shapes it REFUSES (a `flavors:` filter, a mapping with no `path:`);
//   · the closure: runtime `dependencies` only (a dev dependency ships nothing),
//     workspace packages left to the shared rows, a non-web platform filter
//     dropped;
//   · --write is idempotent and keeps hand-edited prose byte for byte;
//   · 🔴 --check reds on a missing row, a stale row and a differing owned field,
//     each naming the file — the red controls of the rows' guard;
//   · COVERAGE LOST (exit 2) on no resolution, an app the resolver never saw,
//     a resolution older than the pubspec, and an unreadable declaration.
// The guard half (the bundle walk accepts what this writes, and refuses the
// file without it) is in licence-register.test.mjs, "ONE PIPELINE".
//
// No test is declared inside a loop (assert-no-loop-cases.mjs).
// Run:  node --single-threaded --test tooling/ci/test/app-licence-rows.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { flutterAssetEntries, pubspecDependencyNames } from '../package-assets.mjs';
import { OWNED, planAppLicenceRows } from '../gen-app-licence-rows.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GEN = join(CI_DIR, 'gen-app-licence-rows.mjs');

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-app-licence-rows-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const write = (root, rel, body) => {
  const abs = join(root, ...rel.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
};
const run = (root, ...args) => spawnSync(process.execPath, [GEN, root, ...args], { encoding: 'utf8' });
const out = (r) => `${r.stdout}${r.stderr}`;

const MIT = [
  'MIT License',
  'Permission is hereby granted, free of charge, to any person obtaining a copy',
  'of this software.',
  'The above copyright notice and this permission notice shall be included in all',
  'copies or substantial portions of the Software.',
].join('\n');
const APACHE = ['Apache License', 'Version 2.0, January 2004', 'TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION'].join('\n');

/** A resolved workspace: app `probe` → workspace package `nikatru_billing` →
 *  store_sdk (a web-only directory + an android-only one) and webview (a
 *  `packages/` entry) → webview_web; probe → icons (a font); probe's dev
 *  dependency devtool declares an asset and ships nothing. */
function fixture({ register = {}, graphPatch = null, storePubspec = null, storeLicence = MIT, appPubspec = null } = {}) {
  const root = join(TMP, `f${seq++}`);
  const cache = (pkg, rel, body) => write(root, `cache/${pkg}-1.0.0/${rel}`, body);
  write(
    root,
    'tooling/legal/asset-register.json',
    `${JSON.stringify({ derivation: { appRoots: ['apps'] }, assets: [{ id: 'shared-one' }], appScopedAssets: [], ...register }, null, 2)}\n`,
  );
  write(
    root,
    'apps/probe/pubspec.yaml',
    appPubspec ??
      'name: probe\ndependencies:\n  flutter:\n    sdk: flutter\n  icons: ^1.0.0\n  nikatru_billing:\n    path: ../../packages/billing\ndev_dependencies:\n  devtool: ^1.0.0\n',
  );
  write(root, 'apps/probe/.dart_tool/pub/workspace_ref.json', JSON.stringify({ workspaceRoot: '../../../..' }));
  write(root, 'packages/billing/pubspec.yaml', 'name: nikatru_billing\nflutter:\n  assets:\n    - assets/own.png\n');
  write(root, 'packages/billing/assets/own.png', 'x');
  cache(
    'store_sdk',
    'pubspec.yaml',
    storePubspec ??
      'name: store_sdk\nflutter:\n  plugin:\n    platforms:\n      web:\n        pluginClass: X\n  assets:\n    - path: assets/web/\n      platforms:\n        - web\n    - path: assets/android/\n      platforms: [android]\n',
  );
  cache('store_sdk', 'assets/web/mappings.js', 'x');
  cache('store_sdk', 'assets/android/a.json', 'x');
  cache('store_sdk', 'LICENSE', storeLicence);
  cache(
    'webview',
    'pubspec.yaml',
    'name: webview\nflutter:\n  assets:\n    - packages/webview/assets/page.html\n  # assets:\n  #  - commented/out.png\n',
  );
  cache('webview', 'lib/assets/page.html', 'x');
  cache('webview', 'LICENSE', APACHE);
  cache('webview_web', 'pubspec.yaml', 'name: webview_web\nflutter:\n  assets:\n    - packages/webview_web/assets/web/support.js\n');
  cache('webview_web', 'lib/assets/web/support.js', 'x');
  cache('webview_web', 'LICENSE', APACHE);
  cache('icons', 'pubspec.yaml', 'name: icons\nflutter:\n  fonts:\n    - family: Icons\n      fonts:\n        - asset: assets/Icons.ttf\n');
  cache('icons', 'assets/Icons.ttf', 'x');
  cache('icons', 'LICENSE', MIT);
  cache('devtool', 'pubspec.yaml', 'name: devtool\nflutter:\n  assets:\n    - assets/dev.png\n');
  cache('devtool', 'assets/dev.png', 'x');
  cache('devtool', 'LICENSE', MIT);
  write(root, 'sdk/packages/flutter/pubspec.yaml', 'name: flutter\n');
  const hosted = ['store_sdk', 'webview', 'webview_web', 'icons', 'devtool'];
  write(
    root,
    '.dart_tool/package_config.json',
    JSON.stringify({
      configVersion: 2,
      flutterRoot: pathToFileURL(join(root, 'sdk')).href,
      packages: [
        { name: 'probe', rootUri: '../apps/probe/', packageUri: 'lib/' },
        { name: 'nikatru_billing', rootUri: '../packages/billing/', packageUri: 'lib/' },
        { name: 'flutter', rootUri: pathToFileURL(join(root, 'sdk', 'packages', 'flutter')).href, packageUri: 'lib/' },
        ...hosted.map((n) => ({ name: n, rootUri: pathToFileURL(join(root, 'cache', `${n}-1.0.0`)).href, packageUri: 'lib/' })),
      ],
    }),
  );
  const graph = {
    roots: ['nikatru_billing', 'probe'],
    packages: [
      { name: 'probe', version: '1.0.0', dependencies: ['flutter', 'icons', 'nikatru_billing'], devDependencies: ['devtool'] },
      { name: 'nikatru_billing', version: '0.0.1', dependencies: ['flutter', 'store_sdk', 'webview'], devDependencies: [] },
      { name: 'flutter', version: '0.0.0', dependencies: [] },
      { name: 'store_sdk', version: '1.0.0', dependencies: ['flutter'] },
      { name: 'webview', version: '1.0.0', dependencies: ['webview_web'] },
      { name: 'webview_web', version: '1.0.0', dependencies: [] },
      { name: 'icons', version: '1.0.0', dependencies: [] },
      { name: 'devtool', version: '1.0.0', dependencies: [] },
    ],
    configVersion: 1,
  };
  write(root, '.dart_tool/package_graph.json', JSON.stringify(graphPatch ? graphPatch(graph) : graph));
  return root;
}
const register = (root) => JSON.parse(readFileSync(join(root, 'tooling', 'legal', 'asset-register.json'), 'utf8'));
const setRows = (root, rows) => {
  const reg = register(root);
  reg.appScopedAssets = rows;
  write(root, 'tooling/legal/asset-register.json', `${JSON.stringify(reg, null, 2)}\n`);
};

const DERIVED = [
  ['packages/icons/assets/Icons.ttf', 'icons', 'MIT'],
  ['packages/store_sdk/assets/web/mappings.js', 'store_sdk', 'MIT'],
  ['packages/webview/assets/page.html', 'webview', 'Apache-2.0'],
  ['packages/webview_web/assets/web/support.js', 'webview_web', 'Apache-2.0'],
];

describe('package-assets.mjs — a package\'s own declaration, read as Flutter keys it', () => {
  test('the plain, `packages/`-prefixed and mapping forms, with block and flow platform lists and fonts', () => {
    const d = flutterAssetEntries(
      [
        'name: x',
        'flutter:',
        '  plugin:',
        '    platforms:',
        '      web:',
        '        pluginClass: X',
        '  assets:',
        '    - assets/a.png',
        '    - packages/x/assets/b.html',
        '    - path: assets/web/',
        '      platforms:',
        '        - web',
        '    - path: "assets/native/"',
        '      platforms: [android, ios]',
        '  fonts:',
        '    - family: F',
        '      fonts:',
        '        - asset: fonts/F.ttf',
        '          weight: 700',
        '  # assets:',
        '  #   - never/this.png',
        'dev_dependencies:',
        '  assets: not-flutter',
      ].join('\n'),
    );
    assert.deepEqual(d.unread, []);
    assert.deepEqual(d.assets, [
      { entry: 'assets/a.png', platforms: null },
      { entry: 'packages/x/assets/b.html', platforms: null },
      { entry: 'assets/web/', platforms: ['web'] },
      { entry: 'assets/native/', platforms: ['android', 'ios'] },
    ]);
    assert.deepEqual(d.fonts, ['fonts/F.ttf']);
  });

  test('🔴 a `flavors:` filter and a mapping with no `path:` are REFUSED, never read as "ships nothing"', () => {
    const d = flutterAssetEntries(
      ['flutter:', '  assets:', '    - path: assets/paid/', '      flavors:', '        - paid', '    - platforms: [web]'].join('\n'),
    );
    assert.deepEqual(d.assets, []);
    assert.equal(d.unread.length, 2, d.unread.join('\n'));
    assert.match(d.unread[0], /assets\/paid\/ is filtered by `flavors:`/);
    assert.match(d.unread[1], /has no `path:`/);
  });

  test('🔴 `shaders:` entries are read (material_ui 1.4.0 ships ink_sparkle.frag that way), and a non-path shader line is REFUSED', () => {
    const d = flutterAssetEntries(
      ['flutter:', '  shaders:', '    - packages/material_ui/shaders/ink_sparkle.frag', '    - "shaders/own.frag"'].join('\n'),
    );
    assert.deepEqual(d.unread, []);
    assert.deepEqual(d.shaders, ['packages/material_ui/shaders/ink_sparkle.frag', 'shaders/own.frag']);
    const bad = flutterAssetEntries(['flutter:', '  shaders:', '    - path: shaders/x.frag'].join('\n'));
    assert.deepEqual(bad.shaders, []);
    assert.match(bad.unread.join('\n'), /a shader line `- path: shaders\/x\.frag` is not a plain list item/);
  });

  test('a pubspec with no flutter block declares nothing, and the dependency names are the top-level block only', () => {
    assert.deepEqual(flutterAssetEntries('name: x\ndependencies:\n  a: ^1.0.0\n'), { assets: [], fonts: [], shaders: [], unread: [] });
    assert.deepEqual(
      pubspecDependencyNames('name: x\ndependencies:\n  b: ^1.0.0\n  # c: ^1.0.0\n  a:\n    path: ../a\ndev_dependencies:\n  d: ^1.0.0\n'),
      ['a', 'b'],
    );
  });
});

describe('gen-app-licence-rows.mjs — the rows are born with the app', () => {
  test('--write derives one row per web-bundle package file: dev deps, workspace packages and non-web filters excluded', () => {
    const root = fixture();
    const r = run(root, '--write', '--app', 'probe');
    assert.equal(r.status, 0, out(r));
    const rows = register(root).appScopedAssets;
    assert.deepEqual(
      rows.map((x) => [x.bundlePath, x.package, x.licence]),
      DERIVED,
    );
    for (const x of rows) {
      assert.equal(x.scope, 'app:probe');
      assert.equal(x.origin, 'third-party');
      assert.equal(x.attributionRequired, true);
      assert.equal(x.attributedIn, 'bundle:NOTICES');
      assert.equal(x.contentFamily, null);
      assert.ok(x.contentFamilyWhy && x.source?.note && x.name && x.shippedIn, JSON.stringify(x));
    }
    assert.equal(rows[0].id, 'probe-icons-assets-Icons.ttf');
    assert.match(rows[1].shippedIn, /through probe → nikatru_billing → store_sdk, whose pubspec declares assets\/web\/ for the web platform/);
  });

  test('--write twice is byte-identical, and --check then exits 0', () => {
    const root = fixture();
    assert.equal(run(root, '--write', '--app', 'probe').status, 0);
    const first = readFileSync(join(root, 'tooling', 'legal', 'asset-register.json'), 'utf8');
    const again = run(root, '--write', '--app', 'probe');
    assert.equal(again.status, 0, out(again));
    assert.match(out(again), /already carried every derived row; nothing written/);
    assert.equal(readFileSync(join(root, 'tooling', 'legal', 'asset-register.json'), 'utf8'), first);
    const c = run(root, '--check');
    assert.equal(c.status, 0, out(c));
    assert.match(out(c), /ok  app:probe — 4 package file\(s\) in its web bundle; 4 row\(s\) kept/);
  });

  test('🔴 a hosted package\'s SHADER gets its row too — --check reds without it (train W55: material_ui\'s ink_sparkle.frag)', () => {
    const root = fixture({
      graphPatch: (g) => ({
        ...g,
        packages: [
          ...g.packages.map((p) => (p.name === 'webview' ? { ...p, dependencies: [...p.dependencies, 'sparkle'] } : p)),
          { name: 'sparkle', version: '1.0.0', dependencies: [] },
        ],
      }),
    });
    write(root, 'cache/sparkle-1.0.0/pubspec.yaml', 'name: sparkle\nflutter:\n  shaders:\n    - packages/sparkle/shaders/ink.frag\n');
    write(root, 'cache/sparkle-1.0.0/lib/shaders/ink.frag', 'x');
    write(root, 'cache/sparkle-1.0.0/LICENSE', MIT);
    const cfg = JSON.parse(readFileSync(join(root, '.dart_tool', 'package_config.json'), 'utf8'));
    cfg.packages.push({ name: 'sparkle', rootUri: pathToFileURL(join(root, 'cache', 'sparkle-1.0.0')).href, packageUri: 'lib/' });
    write(root, '.dart_tool/package_config.json', JSON.stringify(cfg));
    const graph = readFileSync(join(root, '.dart_tool', 'package_graph.json'), 'utf8');
    write(root, '.dart_tool/package_graph.json', graph); // newer than every pubspec above
    const r = run(root, '--write', '--app', 'probe');
    assert.equal(r.status, 0, out(r));
    const row = register(root).appScopedAssets.find((x) => x.bundlePath === 'packages/sparkle/shaders/ink.frag');
    assert.ok(row, `no shader row was written: ${out(r)}`);
    assert.deepEqual([row.package, row.licence, row.scope], ['sparkle', 'MIT', 'app:probe']);
    setRows(root, register(root).appScopedAssets.filter((x) => x !== null && x.bundlePath !== row.bundlePath));
    const red = run(root, '--check', '--app', 'probe');
    assert.equal(red.status, 1, out(red));
    assert.match(out(red), /packages\/sparkle\/shaders\/ink\.frag ships \(package sparkle, MIT\) and has NO row/);
  });

  test("a person's prose on a kept row survives --write byte for byte; only the owned fields are derived", () => {
    const root = fixture();
    run(root, '--write', '--app', 'probe');
    const rows = register(root).appScopedAssets;
    rows[2] = { ...rows[2], id: 'probe-trex-page', name: 'the T-Rex page, hand-named', note: 'a Chromium notice may be owed' };
    setRows(root, rows);
    const before = JSON.stringify(register(root));
    assert.equal(run(root, '--write', '--app', 'probe').status, 0);
    assert.equal(JSON.stringify(register(root)), before);
    assert.deepEqual(OWNED, ['package', 'licence', 'origin', 'attributionRequired', 'attributedIn']);
  });

  test('🔴 RED CONTROL: a shipped file with no row — --check exits 1 naming it and printing the row --write adds', () => {
    const root = fixture();
    run(root, '--write', '--app', 'probe');
    setRows(root, register(root).appScopedAssets.filter((x) => !x.bundlePath.includes('mappings.js')));
    const r = run(root, '--check', '--app', 'probe');
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /app:probe: packages\/store_sdk\/assets\/web\/mappings\.js ships \(package store_sdk, MIT\) and has NO row/);
    assert.match(out(r), /"scope":"app:probe","bundlePath":"packages\/store_sdk\/assets\/web\/mappings\.js","package":"store_sdk"/);
    assert.equal(run(root, '--write', '--app', 'probe').status, 0);
    assert.equal(run(root, '--check', '--app', 'probe').status, 0, 'restored by --write, the check is green');
  });

  test('🔴 a row for a file the app no longer ships is stale: --check names it, --write retires it', () => {
    const root = fixture();
    run(root, '--write', '--app', 'probe');
    const rows = register(root).appScopedAssets;
    setRows(root, [...rows, { ...rows[1], id: 'probe-android', bundlePath: 'packages/store_sdk/assets/android/a.json' }]);
    const r = run(root, '--check', '--app', 'probe');
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /row "probe-android" claims packages\/store_sdk\/assets\/android\/a\.json, and the app's resolved closure no longer ships it/);
    assert.equal(run(root, '--write', '--app', 'probe').status, 0);
    assert.deepEqual(register(root).appScopedAssets.map((x) => x.id), rows.map((x) => x.id));
  });

  test("🔴 a row whose licence differs from the package's LICENSE: --check names both, --write follows the package", () => {
    const root = fixture();
    run(root, '--write', '--app', 'probe');
    const rows = register(root).appScopedAssets;
    rows[1] = { ...rows[1], licence: 'Apache-2.0', source: { note: 'read by hand, wrongly' } };
    setRows(root, rows);
    const r = run(root, '--check', '--app', 'probe');
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /says licence "Apache-2\.0"; the resolved package reads licence "MIT"/);
    assert.equal(run(root, '--write', '--app', 'probe').status, 0);
    const fixed = register(root).appScopedAssets[1];
    assert.equal(fixed.licence, 'MIT');
    assert.match(fixed.source.note, /read through the resolved workspace's package_config\.json/);
  });

  test('🔴 a row scoped to an app that no longer exists: the all-app --check names it, --write retires it', () => {
    const root = fixture();
    run(root, '--write', '--app', 'probe');
    const rows = register(root).appScopedAssets;
    setRows(root, [...rows, { ...rows[0], id: 'gone-icons', scope: 'app:gone' }]);
    const r = run(root, '--check');
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /app:gone: row "gone-icons" is scoped to an app that no longer exists under apps/);
    const scoped = run(root, '--check', '--app', 'probe');
    assert.equal(scoped.status, 0, `one app's --check grades that app alone: ${out(scoped)}`);
    assert.equal(run(root, '--write').status, 0);
    assert.deepEqual(register(root).appScopedAssets.map((x) => x.id), rows.map((x) => x.id));
  });

  test("🔴 a LICENSE that reads as no licence it can name: exit 1, and the register is NOT written", () => {
    const root = fixture({ storeLicence: 'All rights reserved. Ask us.' });
    const before = readFileSync(join(root, 'tooling', 'legal', 'asset-register.json'), 'utf8');
    const r = run(root, '--write', '--app', 'probe');
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /store_sdk-1\.0\.0\/LICENSE reads as no licence this reader can name/);
    assert.equal(readFileSync(join(root, 'tooling', 'legal', 'asset-register.json'), 'utf8'), before);
  });

  test('planAppLicenceRows is the CLI without the exit: the same four rows, changed, nothing lost', () => {
    const plan = planAppLicenceRows(fixture(), { app: 'probe' });
    assert.deepEqual(plan.lost, []);
    assert.equal(plan.changed, true);
    assert.deepEqual(plan.next.appScopedAssets.map((x) => x.bundlePath), DERIVED.map(([p]) => p));
  });
});

describe('gen-app-licence-rows.mjs — COVERAGE LOST is never a pass', () => {
  test('no resolution — `pub get` never ran — exits 2 and says where to run it', () => {
    const root = fixture();
    rmSync(join(root, '.dart_tool'), { recursive: true, force: true });
    const r = run(root, '--check');
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /COVERAGE LOST/);
    assert.match(out(r), /Run `flutter pub get` AT THE REPO ROOT/);
  });

  test('an app the resolver never saw exits 2', () => {
    const root = fixture({ graphPatch: (g) => ({ ...g, packages: g.packages.filter((p) => p.name !== 'probe') }) });
    const r = run(root, '--check', '--app', 'probe');
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /is not in \.dart_tool\/package_graph\.json: the workspace was resolved before this app joined it/);
  });

  test('🔴 a resolution older than the pubspec exits 2 — it would derive the closure the app USED to have', () => {
    const root = fixture({
      graphPatch: (g) => ({
        ...g,
        packages: g.packages.map((p) => (p.name === 'probe' ? { ...p, dependencies: ['flutter', 'icons'] } : p)),
      }),
    });
    const r = run(root, '--check', '--app', 'probe');
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /pubspec\.yaml depends on nikatru_billing, and \.dart_tool\/package_graph\.json does not/);
  });

  test('a package declaration this reader cannot place exits 2, naming the pubspec', () => {
    const root = fixture({ storePubspec: 'name: store_sdk\nflutter:\n  assets:\n    - path: assets/web/\n      flavors: [paid]\n' });
    const r = run(root, '--check', '--app', 'probe');
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /store_sdk-1\.0\.0\/pubspec\.yaml: the asset assets\/web\/ is filtered by `flavors:`/);
  });

  test('--app naming no app, no mode, and both modes each exit 2', () => {
    const root = fixture();
    const ghost = run(root, '--check', '--app', 'ghost');
    assert.equal(ghost.status, 2, out(ghost));
    assert.match(out(ghost), /--app ghost names no app/);
    const none = run(root);
    assert.equal(none.status, 2, out(none));
    assert.match(out(none), /pass exactly one of --write or --check/);
    const both = run(root, '--write', '--check');
    assert.equal(both.status, 2, out(both));
  });
});
