// ─────────────────────────────────────────────────────────────────────────────
// licence-register.test.mjs — assert-licence-register.mjs must be able to FAIL.
//
// [pipeline K-10]/[K-11]. The recorded mutation run is against a scratch COPY OF
// THE REAL REPOSITORY, 10/10 as intended — and the FIRST run of it caught a bug
// in the guard rather than in the tree, twice:
//
//   1. NINE limbs reported "NOT CAUGHT" because the guard's own argument parsing
//      dropped its repoRoot (`i !== bundleAt + 1` with bundleAt === -1 skips
//      argument zero), so every mutation ran the guard against the REAL tree. A
//      guard pointed at the wrong tree passes for the same reason a guard with
//      no subject passes.
//   2. Deleting the brick's AboutListTile — a real regression this limb exists
//      to catch — produced "your pattern set is probably broken" instead of
//      "the brick ships no licences surface", because COVERAGE LOST fired on
//      "no app has a surface". The domain is now "apps not exempted", which is
//      what can genuinely empty out.
//
// ⚠️ A FIXTURE AGREES WITH WHATEVER MISUNDERSTANDING WROTE IT. These are the
// regression net; the mutation run against the real tree is the proof.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-licence-register.mjs');

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-licence-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const write = (root, relPath, body) => {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
};

const DERIVATION = {
  workspaceRoots: ['apps', 'brick'],
  minPubspecs: 2,
  minDeclaredAssets: 2,
  appRoots: ['apps'],
  brickAppRoot: 'brick/app',
  minApps: 2,
};

const DEFAULT_ASSETS = [
  {
    id: 'icon-font',
    fromFlag: 'uses-material-design',
    name: 'MaterialIcons',
    origin: 'third-party',
    licence: 'UNVERIFIED',
    attributionRequired: null,
    attributedIn: null,
    source: { note: 'not established in this environment, and deliberately not guessed' },
    wouldNeed: 'the upstream LICENSE file at the revision the toolchain vendors',
  },
  {
    id: 'brand-a',
    path: 'apps/one/assets/brand/logo.png',
    name: 'logo',
    origin: 'own-work',
    owner: 'The Proprietor',
    licence: 'proprietary-all-rights-reserved',
    attributionRequired: false,
    attributedIn: null,
    source: { note: 'our own mark' },
  },
  {
    id: 'brand-b',
    path: 'apps/one/assets/brand/icon.png',
    name: 'icon',
    origin: 'own-work',
    owner: 'The Proprietor',
    licence: 'proprietary-all-rights-reserved',
    attributionRequired: false,
    attributedIn: null,
    source: { note: 'our own mark' },
  },
];

const PUBSPEC_WITH_ASSETS = `name: one
flutter:
  uses-material-design: true
  assets:
    - assets/brand/
`;

const PUBSPEC_BRICK = `name: brick_app
flutter:
  uses-material-design: true
`;

function fixture({
  assets,
  derivation = {},
  gaps = [{ app: 'apps/one', owningIncrement: '[8]INC-5', why: 'no surface yet', whyPrintedNotFailed: 'another increment owns the file' }],
  appPubspec = PUBSPEC_WITH_ASSETS,
  appLib = 'void main() {}\n',
  brickLib = "Widget b() => AboutListTile(applicationName: 'x');\n",
  incompatible = { prefixes: ['CC-BY-NC', 'CC-BY-SA'] },
  patterns = ['AboutListTile\\s*\\(', 'showLicensePage\\s*\\(', 'LicenseRegistry\\.addLicense\\s*\\('],
} = {}) {
  const root = join(TMP, `f${seq++}`);
  mkdirSync(root, { recursive: true });
  write(
    root,
    join('tooling', 'legal', 'asset-register.json'),
    JSON.stringify(
      {
        derivation: { ...DERIVATION, ...derivation },
        incompatibleLicences: incompatible,
        licenceSurfaceCalls: { patterns },
        licenceSurfaceGaps: gaps,
        assets: assets ?? structuredClone(DEFAULT_ASSETS),
      },
      null,
      2,
    ),
  );
  write(root, join('apps', 'one', 'pubspec.yaml'), appPubspec);
  write(root, join('apps', 'one', 'assets', 'brand', 'logo.png'), 'png-a');
  write(root, join('apps', 'one', 'assets', 'brand', 'icon.png'), 'png-b');
  write(root, join('apps', 'one', 'lib', 'main.dart'), appLib);
  write(root, join('brick', 'app', 'pubspec.yaml'), PUBSPEC_BRICK);
  write(root, join('brick', 'app', 'lib', 'settings.dart'), brickLib);
  return root;
}

const run = (root, ...args) => spawnSync(process.execPath, [GUARD, root, ...args], { encoding: 'utf8' });
const out = (r) => `${r.stdout}${r.stderr}`;

describe('assert-licence-register — the baseline fixture is valid input', () => {
  test('a complete tree passes', () => {
    const r = run(fixture());
    assert.equal(r.status, 0, out(r));
  });

  test('an UNVERIFIED licence PRINTS rather than failing — the gap is visible, not fatal', () => {
    const r = run(fixture());
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /UNVERIFIED LICENCE · icon-font/);
  });

  test('the repoRoot argument is actually read — a guard pointed at the wrong tree passes silently', () => {
    // The recorded bug: with no --bundle flag the parser skipped argument zero
    // and fell back to process.cwd(), so nine mutations against a scratch copy
    // reported NOT CAUGHT for limbs that all worked.
    const root = fixture({ assets: [] });
    const r = run(root);
    assert.equal(r.status, 1, 'the guard must have read the fixture root, not its own cwd');
    assert.match(out(r), /declares no `assets`/);
  });
});

describe('the shipped ↔ registered relation, both directions', () => {
  test('a shipped asset with no row FAILS', () => {
    const root = fixture();
    write(root, join('apps', 'one', 'assets', 'brand', 'borrowed.png'), 'png-c');
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(out(r), /has NO row in tooling\/legal\/asset-register\.json/);
  });

  test('a row for an asset that is no longer shipped FAILS', () => {
    // Floor lowered for this case ON PURPOSE: the point is the row-with-no-asset
    // direction, and at the default floor of 2 the deletion trips the coverage
    // check instead — which is the correct behaviour for a walk that has lost
    // half its subjects, and the wrong signal for the limb under test.
    const root = fixture({ derivation: { minDeclaredAssets: 1 } });
    rmSync(join(root, 'apps', 'one', 'assets', 'brand', 'icon.png'));
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(out(r), /and no such asset is shipped/);
  });

  test('deleting the icon-font row leaves a shipped asset unaccounted for', () => {
    const assets = structuredClone(DEFAULT_ASSETS).filter((a) => !a.fromFlag);
    const r = run(fixture({ assets }));
    assert.equal(r.status, 1);
    assert.match(out(r), /has NO row in tooling\/legal\/asset-register\.json/);
  });

  test('a manifest declaring an asset path that does not exist FAILS', () => {
    const r = run(fixture({ appPubspec: `${PUBSPEC_WITH_ASSETS}    - assets/missing/\n` }));
    assert.equal(r.status, 1);
    assert.match(out(r), /and no such path exists/);
  });

  test('two rows keyed the same FAIL', () => {
    const assets = structuredClone(DEFAULT_ASSETS);
    assets.push(structuredClone(assets[1]));
    const r = run(fixture({ assets }));
    assert.equal(r.status, 1);
    assert.match(out(r), /TWO rows keyed/);
  });
});

describe('a licence claim carries its evidence', () => {
  test('a row with no source FAILS', () => {
    const assets = structuredClone(DEFAULT_ASSETS);
    delete assets[1].source;
    const r = run(fixture({ assets }));
    assert.equal(r.status, 1);
    assert.match(out(r), /carries no `source`/);
  });

  test('a third-party licence with no source URL FAILS', () => {
    const assets = structuredClone(DEFAULT_ASSETS);
    assets[1].origin = 'third-party';
    assets[1].licence = 'Apache-2.0';
    const r = run(fixture({ assets }));
    assert.equal(r.status, 1);
    assert.match(out(r), /with no source URL/);
  });

  test('a third-party source URL with no fetched date FAILS — upstream licences change', () => {
    const assets = structuredClone(DEFAULT_ASSETS);
    assets[1].origin = 'third-party';
    assets[1].licence = 'Apache-2.0';
    assets[1].source = { note: 'read upstream', url: 'https://example.test/LICENSE' };
    const r = run(fixture({ assets }));
    assert.equal(r.status, 1);
    assert.match(out(r), /with no `fetched` date/);
  });

  test('an UNVERIFIED row given a plausible URL FAILS — an honest gap turned into a false citation', () => {
    const assets = structuredClone(DEFAULT_ASSETS);
    assets[0].source.url = 'https://example.test/LICENSE';
    const r = run(fixture({ assets }));
    assert.equal(r.status, 1);
    assert.match(out(r), /is UNVERIFIED and carries a source URL/);
  });

  test('an UNVERIFIED row that does not say what would settle it FAILS', () => {
    const assets = structuredClone(DEFAULT_ASSETS);
    delete assets[0].wouldNeed;
    const r = run(fixture({ assets }));
    assert.equal(r.status, 1);
    assert.match(out(r), /does not say what would settle it/);
  });

  test('an own-work row naming no owner FAILS — whose work it is IS the evidence', () => {
    const assets = structuredClone(DEFAULT_ASSETS);
    delete assets[1].owner;
    const r = run(fixture({ assets }));
    assert.equal(r.status, 1);
    assert.match(out(r), /names no `owner`/);
  });

  test('an origin outside the vocabulary FAILS — the origin decides which evidence is owed', () => {
    const assets = structuredClone(DEFAULT_ASSETS);
    assets[1].origin = 'somewhere';
    const r = run(fixture({ assets }));
    assert.equal(r.status, 1);
    assert.match(out(r), /is neither "own-work" nor "third-party"/);
  });
});

describe('licences that cannot ship here are refused, not printed', () => {
  test('CC-BY-NC FAILS', () => {
    const assets = structuredClone(DEFAULT_ASSETS);
    assets[1].licence = 'CC-BY-NC-4.0';
    const r = run(fixture({ assets }));
    assert.equal(r.status, 1);
    assert.match(out(r), /architecturally incompatible/);
  });

  test('CC-BY-SA FAILS', () => {
    const assets = structuredClone(DEFAULT_ASSETS);
    assets[1].licence = 'CC-BY-SA-3.0';
    const r = run(fixture({ assets }));
    assert.equal(r.status, 1);
    assert.match(out(r), /architecturally incompatible/);
  });

  test('an EMPTY incompatible list is COVERAGE LOST, not a permissive policy', () => {
    const r = run(fixture({ incompatible: { prefixes: [] } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /COVERAGE LOST/);
  });

  test('an attribution obligation with nothing discharging it FAILS', () => {
    const assets = structuredClone(DEFAULT_ASSETS);
    assets[1].attributionRequired = true;
    const r = run(fixture({ assets }));
    assert.equal(r.status, 1);
    assert.match(out(r), /carries an attribution obligation/);
  });
});

describe('[pipeline K-11] every app shows the licences of what it ships', () => {
  test('a NEW app with no licences surface FAILS — it is not on the exemption list', () => {
    const root = fixture();
    write(root, join('apps', 'two', 'pubspec.yaml'), 'name: two\n');
    write(root, join('apps', 'two', 'lib', 'main.dart'), 'void main() {}\n');
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(out(r), /ships NO licences surface/);
  });

  test('the brick losing its AboutListTile FAILS with the RIGHT fault', () => {
    // The recorded mis-report: this produced "your pattern set is probably
    // broken" because COVERAGE LOST fired on "no app has a surface". A guard
    // that reports the wrong fault sends the fix to the wrong file.
    const r = run(fixture({ brickLib: 'Widget b() => const ListTile();\n' }));
    assert.equal(r.status, 1);
    assert.match(out(r), /ships NO licences surface/);
    assert.ok(!out(r).includes('broken pattern set'));
  });

  test('an exempt app PRINTS and does not fail the build', () => {
    const r = run(fixture());
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /NO LICENCES SURFACE \(\[8\]INC-5\) · apps\/one/);
  });

  test('an exempt app that GAINS a surface flips to PROMOTE ME — the exemption cannot outlive its reason', () => {
    const r = run(fixture({ appLib: "Widget s() => AboutListTile(applicationName: 'one');\n" }));
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /PROMOTE ME/);
  });

  test('a surface mentioned only in a COMMENT does not count — a declaration is not a call', () => {
    const r = run(fixture({ brickLib: '// AboutListTile( goes here one day\nWidget b() => const ListTile();\n' }));
    assert.equal(r.status, 1);
    assert.match(out(r), /ships NO licences surface/);
  });

  test('exempting every app is COVERAGE LOST — a check switched off one entry at a time', () => {
    const r = run(
      fixture({
        gaps: [
          { app: 'apps/one', owningIncrement: 'X', why: 'a', whyPrintedNotFailed: 'b' },
          { app: 'brick/app', owningIncrement: 'X', why: 'a', whyPrintedNotFailed: 'b' },
        ],
      }),
    );
    assert.equal(r.status, 1);
    assert.match(out(r), /COVERAGE LOST/);
    assert.match(out(r), /switched off\s+one entry at a time/);
  });

  test('an empty pattern set is COVERAGE LOST', () => {
    const r = run(fixture({ patterns: [] }));
    assert.equal(r.status, 1);
    assert.match(out(r), /COVERAGE LOST/);
  });
});

describe('coverage self-checks', () => {
  test('a missing register is COVERAGE LOST', () => {
    const root = fixture();
    rmSync(join(root, 'tooling', 'legal', 'asset-register.json'));
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(out(r), /COVERAGE LOST/);
  });

  test('an assets: walk that finds nothing while the icon-font flag is on is COVERAGE LOST', () => {
    const r = run(fixture({ appPubspec: 'name: one\nflutter:\n  uses-material-design: true\n' }));
    assert.equal(r.status, 1);
    assert.match(out(r), /declared asset file\(s\), floor/);
  });

  test('a pubspec walk below its floor is COVERAGE LOST', () => {
    const r = run(fixture({ derivation: { minPubspecs: 9 } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /pubspec\.yaml file\(s\), floor 9/);
  });

  test('an app walk below its floor is COVERAGE LOST', () => {
    const r = run(fixture({ derivation: { minApps: 5 } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /app\(s\), floor 5/);
  });

  test('--bundle pointed at a directory that does not exist is COVERAGE LOST', () => {
    const r = run(fixture(), '--bundle', join(TMP, 'no-such-bundle'));
    assert.equal(r.status, 1);
    assert.match(out(r), /does not exist/);
  });

  test('--bundle over a real directory matches assets by basename', () => {
    const root = fixture();
    const bundle = join(TMP, `b${seq++}`);
    mkdirSync(join(bundle, 'assets'), { recursive: true });
    writeFileSync(join(bundle, 'assets', 'logo.png'), 'x');
    writeFileSync(join(bundle, 'assets', 'icon.png'), 'y');
    writeFileSync(join(bundle, 'assets', 'MaterialIcons-Regular.otf'), 'z');
    const r = run(root, '--bundle', bundle);
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /BUNDLE mode/);
  });

  test('--bundle over a bundle with an UNREGISTERED asset FAILS', () => {
    const root = fixture();
    const bundle = join(TMP, `b${seq++}`);
    mkdirSync(join(bundle, 'assets'), { recursive: true });
    writeFileSync(join(bundle, 'assets', 'logo.png'), 'x');
    writeFileSync(join(bundle, 'assets', 'icon.png'), 'y');
    writeFileSync(join(bundle, 'assets', 'MaterialIcons-Regular.otf'), 'z');
    writeFileSync(join(bundle, 'assets', 'someone-elses-font.ttf'), 'w');
    const r = run(root, '--bundle', bundle);
    assert.equal(r.status, 1);
    assert.match(out(r), /has NO row in tooling\/legal\/asset-register\.json/);
  });
});
