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
// 🔴 2026-08-13 — EIGHT CASES HERE WENT RED WITHOUT ONE LINE OF THIS FILE BEING
//    EDITED, AND THE GUARD WAS RIGHT. licence-cross-assert.mjs was wired into
//    BOTH licence guards that day, which made [7]P-5's
//    tooling/legal/content-licence-register.json part of THIS guard's subject.
//    The fixture below INVENTS a tree, and the tree it invented has one register
//    in it — so every case that expected exit 0 got `CROSS-ASSERT COVERAGE LOST`
//    while `node tooling/ci/assert-licence-register.mjs` exited 0 on the real
//    repository. That asymmetry is the finding, not the failure: a fixture that
//    no longer resembles real input stops testing the thing, and it reports the
//    difference as a guard defect. The repair is to make the invented tree carry
//    what a real one carries (BOTH registers, and a `contentFamily` answer on
//    every row) — not to soften the guard.
//
//    Two smaller consequences of the same shape, fixed here:
//      · the cases that assert only `status 1` + /COVERAGE LOST/ had started
//        passing off the CROSS-ASSERT message instead of their own subject. A
//        test that passes for a reason it was not written about is coverage that
//        has quietly left the tree.
//      · licence-cross-assert.mjs shipped with NO test file naming it at all —
//        the exact shape [pipeline F-10]/assert-guard-coverage.mjs limb 1 exists
//        to refuse. Its cases are the last describe block below.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
// The seam module itself. Imported rather than re-described: the boundary
// sentence is guarded in the real register, so a hand copy of it here would be a
// second store for one string and would drift in the direction that still passes.
import { BOUNDARY_SENTENCE, crossAssertLicenceRegisters } from '../licence-cross-assert.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
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
    contentFamily: null,
    contentFamilyWhy: 'an icon font the toolchain bundles; the content pipeline neither generates with it nor ships it in a pack',
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
    contentFamily: null,
    contentFamilyWhy: 'own-work brand art, shipped in the binary and carried by no pack',
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
    contentFamily: null,
    contentFamilyWhy: 'own-work brand art, shipped in the binary and carried by no pack',
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

// ── [7]P-5's register, which this fixture has to carry too ───────────────────
// Only the fields the seam reads, because inventing the rest would be inventing
// a second subject. `all null` mirrors the REAL tree's measured state (6 asset
// rows, 6 families, 0 links) so the baseline exercises the honest-empty print;
// the linked cases below supply the agreement limb its subject.
const DEFAULT_CONTENT_FAMILIES = [
  {
    family: 'hand-authored-content',
    kind: 'first-party',
    licence_id: 'first-party',
    verdicts: { attribution_NOTICE: { value: 'not-required', basis: 'owner-lock' } },
  },
  {
    family: 'noto-fonts',
    kind: 'third-party',
    licence_id: 'OFL-1.1',
    verdicts: { attribution_NOTICE: { value: 'required', basis: 'clause:2' } },
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
  generatedFiles = { 'AssetManifest.bin': 'the build\'s own index', NOTICES: 'the attribution surface itself' },
  patterns = ['AboutListTile\\s*\\(', 'showLicensePage\\s*\\(', 'LicenseRegistry\\.addLicense\\s*\\('],
  // The second register. `withContentRegister: false` is the tree this fixture
  // used to build unknowingly, and it is now a NAMED case rather than the
  // silent shape of every baseline.
  contentFamilies,
  contentReadme = ['A fixture stand-in for [7]P-5, carrying only the fields the seam reads.', BOUNDARY_SENTENCE],
  withContentRegister = true,
} = {}) {
  const root = join(TMP, `f${seq++}`);
  mkdirSync(root, { recursive: true });
  write(
    root,
    join('tooling', 'legal', 'asset-register.json'),
    JSON.stringify(
      {
        derivation: { ...DERIVATION, ...derivation },
        generatedBundleFiles: { files: generatedFiles },
        incompatibleLicences: incompatible,
        licenceSurfaceCalls: { patterns },
        licenceSurfaceGaps: gaps,
        assets: assets ?? structuredClone(DEFAULT_ASSETS),
      },
      null,
      2,
    ),
  );
  if (withContentRegister) {
    write(
      root,
      join('tooling', 'legal', 'content-licence-register.json'),
      JSON.stringify(
        { _readme: contentReadme, families: contentFamilies ?? structuredClone(DEFAULT_CONTENT_FAMILIES) },
        null,
        2,
      ),
    );
  }
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
    // …and NAMING it, because a bare /COVERAGE LOST/ was satisfiable by a
    // DIFFERENT limb's message from 2026-08-13 (the seam's, over a fixture with
    // one register in it) — the test passing for a reason it was not about.
    assert.match(out(r), /declares no `incompatibleLicences\.prefixes`/);
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
    assert.match(out(r), /declares no `licenceSurfaceCalls\.patterns`/);
  });
});

describe('coverage self-checks', () => {
  test('a missing register is COVERAGE LOST', () => {
    const root = fixture();
    rmSync(join(root, 'tooling', 'legal', 'asset-register.json'));
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(out(r), /COVERAGE LOST/);
    // The NEAR register specifically. The seam raises its own COVERAGE LOST over
    // the same two files, and without this line the two are indistinguishable.
    assert.match(out(r), /tooling\/legal\/asset-register\.json does not exist/);
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

  // ── what the FIRST REAL CI RUN of the bundle step taught ──────────────────
  // The DECLARED mode reads pubspecs and can only ever see what a manifest
  // declares. The first --bundle run against a real `flutter build web` failed
  // naming SIX files no manifest mentions: four the build emits to describe
  // itself, and two Flutter engine shaders that are genuinely shipped material.
  // Both findings are the two modes doing exactly what they exist to do.
  describe('BUNDLE mode sees what no manifest declares', () => {
    const bundle = (...names) => {
      const dir = join(TMP, `b${seq++}`);
      mkdirSync(join(dir, 'assets'), { recursive: true });
      for (const n of names) writeFileSync(join(dir, 'assets', n), 'x');
      return dir;
    };

    test('a build-generated file named in the register is not an unlicensed asset', () => {
      const root = fixture();
      const r = run(root, '--bundle', bundle('logo.png', 'icon.png', 'MaterialIcons-Regular.otf', 'AssetManifest.bin', 'NOTICES'));
      assert.equal(r.status, 0, out(r));
      assert.match(out(r), /2 build-generated \(named, with reasons\)/);
    });

    test('a build-generated file NOT named in the register still FAILS — no suffix rule', () => {
      // A `*.json`-shaped exclusion would swallow a third-party data file the
      // day one arrives. Every generated filename is written down individually.
      const root = fixture();
      const r = run(root, '--bundle', bundle('logo.png', 'icon.png', 'MaterialIcons-Regular.otf', 'FontManifest.json'));
      assert.equal(r.status, 1, out(r));
      assert.match(out(r), /FontManifest\.json/);
      assert.match(out(r), /generatedBundleFiles/);
    });

    test('an EMPTY generated list is COVERAGE LOST in bundle mode, not a red build on a correct tree', () => {
      const root = fixture({ generatedFiles: {} });
      const r = run(root, '--bundle', bundle('logo.png', 'icon.png', 'MaterialIcons-Regular.otf'));
      assert.equal(r.status, 1, out(r));
      assert.match(out(r), /COVERAGE LOST/);
      assert.match(out(r), /a step that cries wolf is one somebody deletes/);
    });

    test('a bundleOnly row does NOT trip the reverse direction in DECLARED mode', () => {
      // Nothing declares an engine shader in a pubspec, so the manifest walk
      // cannot witness it and must not claim the row is orphaned.
      const assets = structuredClone(DEFAULT_ASSETS);
      assets.push({
        id: 'engine-shader',
        contentFamily: null,
        contentFamilyWhy: 'a shader the engine emits into the bundle; nothing in the content pipeline reads or produces it',
        path: 'ink_sparkle.frag',
        bundleOnly: true,
        name: 'ink_sparkle.frag',
        origin: 'third-party',
        licence: 'UNVERIFIED',
        source: { note: 'emitted by the toolchain, declared in no manifest here' },
        wouldNeed: 'the engine LICENSE at the pinned version',
      });
      const r = run(fixture({ assets }));
      assert.equal(r.status, 0, out(r));
    });

    test('a bundleOnly row the build STOPPED emitting FAILS in bundle mode', () => {
      // The bundle walk is the ONLY thing that can ever notice: no manifest
      // declares the file, so nothing else would miss it.
      const assets = structuredClone(DEFAULT_ASSETS);
      assets.push({
        id: 'engine-shader',
        contentFamily: null,
        contentFamilyWhy: 'a shader the engine emits into the bundle; nothing in the content pipeline reads or produces it',
        path: 'ink_sparkle.frag',
        bundleOnly: true,
        name: 'ink_sparkle.frag',
        origin: 'third-party',
        licence: 'UNVERIFIED',
        source: { note: 'emitted by the toolchain' },
        wouldNeed: 'the engine LICENSE',
      });
      const r = run(fixture({ assets }), '--bundle', bundle('logo.png', 'icon.png', 'MaterialIcons-Regular.otf'));
      assert.equal(r.status, 1, out(r));
      assert.match(out(r), /bundleOnly row/);
      assert.match(out(r), /the build did NOT emit it/);
    });

    test("a bundle of ONE app does not report ANOTHER app's rows as orphaned", () => {
      // The recorded CI failure: the lane walks apps/probe (a throwaway stamp
      // with no brand assets) and the guard reported all three of apps/subly's
      // brand rows as "no such asset is shipped". They ARE shipped — by a
      // different app. A single bundle has no standing to say a row is orphaned.
      const root = fixture();
      const r = run(root, '--bundle', bundle('MaterialIcons-Regular.otf', 'AssetManifest.bin'));
      assert.equal(r.status, 0, out(r));
      assert.ok(!out(r).includes('no such asset is shipped'));
    });
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

// ─────────────────────────────────────────────────────────────────────────────
// licence-cross-assert.mjs — the seam between [7]P-5's register and [8]K-10's.
//
// 🔴 IT SHIPPED WITH NO TEST FILE NAMING IT. Created 2026-08-13, imported by
// BOTH licence guards, negative-tested by hand against the real registers — and
// with nothing in tooling/ci/test/ that could fail if it changed. That is the
// exact absence [pipeline F-10] / assert-guard-coverage.mjs limb 1 refuses ("a
// guard nobody feeds known-bad input to has only ever run against the real
// repository, which is valid input by definition"), and it is also how the eight
// failures at the top of this file happened: the only thing exercising the new
// module was a fixture suite that predated it.
//
// Every case below is a MUTATION of the passing fixture, each asserting the
// SPECIFIC message rather than a bare non-zero exit — a crash and a catch look
// identical from the exit code alone.
// ─────────────────────────────────────────────────────────────────────────────
describe('[7]P-5 ↔ [8]K-10 — the seam between the two licence registers', () => {
  /** A fixture in which ONE asset row genuinely links to a content family, so
   *  the agreement limb has a subject. The real tree's overlap is empty today
   *  (6 rows, 6 families, 0 links) and an agreement limb with no subject is this
   *  repo's cardinal sin — so the fixture supplies the subject the real tree
   *  cannot, and the honest-empty print is covered separately below. */
  const FAM = 'a-family-in-both-registers';
  const linked = ({ licenceId = 'proprietary-all-rights-reserved', attribution = 'not-required' } = {}) => {
    const assets = structuredClone(DEFAULT_ASSETS);
    assets[1].contentFamily = FAM;
    assets[1].contentFamilyWhy = 'the pack carries this mark too, so both registers describe it';
    const contentFamilies = structuredClone(DEFAULT_CONTENT_FAMILIES);
    contentFamilies.push({
      family: FAM,
      kind: 'third-party',
      licence_id: licenceId,
      verdicts: { attribution_NOTICE: { value: attribution, basis: 'clause:4' } },
    });
    return { assets, contentFamilies };
  };

  test('a tree with only ONE register is CROSS-ASSERT COVERAGE LOST — half a seam is not a seam', () => {
    // The shape every baseline in this file silently had until 2026-08-13.
    const r = run(fixture({ withContentRegister: false }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /CROSS-ASSERT COVERAGE LOST/);
    assert.match(out(r), /tooling\/legal\/content-licence-register\.json does not exist/);
  });

  test('a content register with NO family rows is COVERAGE LOST, not agreement', () => {
    const r = run(fixture({ contentFamilies: [] }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /CROSS-ASSERT COVERAGE LOST/);
    assert.match(out(r), /0 family row\(s\)/);
  });

  test('an asset row that never answers `contentFamily` FAILS — the field is required, null is an answer', () => {
    const assets = structuredClone(DEFAULT_ASSETS);
    delete assets[2].contentFamily;
    const r = run(fixture({ assets }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /"brand-b" declares no `contentFamily`/);
  });

  test('an answered `contentFamily` with no `contentFamilyWhy` FAILS — a bare answer cannot be reviewed', () => {
    const assets = structuredClone(DEFAULT_ASSETS);
    assets[2].contentFamilyWhy = '   ';
    const r = run(fixture({ assets }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /"brand-b" answers `contentFamily` and gives no `contentFamilyWhy`/);
  });

  test('a link to a family the content register does not have FAILS — a cross-link to nothing reads like a checked one', () => {
    const assets = structuredClone(DEFAULT_ASSETS);
    assets[1].contentFamily = 'noto-fontz';
    assets[1].contentFamilyWhy = 'a typo is the cheapest way to make a seam disappear';
    const r = run(fixture({ assets }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /links to content family "noto-fontz" and tooling\/legal\/content-licence-register\.json has no such row/);
  });

  test('a linked family that AGREES passes, and the print says how many verdicts it compared', () => {
    const r = run(fixture(linked()));
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /1 family\/families in BOTH registers, 2 verdict comparison\(s\), all in agreement/);
  });

  test('one family under TWO licences FAILS', () => {
    const r = run(fixture(linked({ licenceId: 'Apache-2.0' })));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /SEAM DISAGREEMENT on licence identity/);
    assert.match(out(r), /says APACHE-2\.0 \(licence_id\)/);
  });

  test('the same licence with TWO attribution duties FAILS — the pairs are checked independently', () => {
    // The licences are made to AGREE here on purpose: without this case, one
    // pair masking the other would be indistinguishable from both working.
    const r = run(fixture(linked({ attribution: 'required' })));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /SEAM DISAGREEMENT on attribution \/ NOTICE duty/);
    assert.ok(!out(r).includes('SEAM DISAGREEMENT on licence identity'), out(r));
  });

  test('UNVERIFIED is NOT a wildcard — resolved on one side and unread on the other is a real disagreement', () => {
    // Both registers holding two different states of knowledge about one licence
    // is the finding, not a tolerance to be absorbed.
    const r = run(fixture(linked({ attribution: 'UNVERIFIED' })));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /says UNVERIFIED \(attribution_NOTICE\) and tooling\/legal\/asset-register\.json row "brand-a" says NOT-REQUIRED/);
  });

  test('renaming the content-side field is COVERAGE LOST — not undefined agreeing with undefined forever', () => {
    const contentFamilies = structuredClone(DEFAULT_CONTENT_FAMILIES).map(({ licence_id, ...rest }) => ({ ...rest, licenceId: licence_id }));
    const r = run(fixture({ contentFamilies }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /CROSS-ASSERT COVERAGE LOST — not one row in tooling\/legal\/content-licence-register\.json produces a value for "licence_id"/);
  });

  test('renaming the asset-side field is COVERAGE LOST', () => {
    const assets = structuredClone(DEFAULT_ASSETS).map(({ licence, ...rest }) => ({ ...rest, licenceId: licence }));
    const r = run(fixture({ assets }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /CROSS-ASSERT COVERAGE LOST — not one row in tooling\/legal\/asset-register\.json produces a value for "licence"/);
  });

  test('the boundary sentence leaving the register FAILS and names the corpus copies to re-sync', () => {
    const r = run(fixture({ contentReadme: ['the two registers answer different questions'] }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /no longer contains the boundary sentence verbatim/);
    assert.match(out(r), /08-compliance-legal\.md/);
  });

  test('an EMPTY overlap is PRINTED with its candidates — "0 compared" must never read as "0 disagreements"', () => {
    const r = run(fixture());
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /ZERO link to a content family, so the agreement limb compared NOTHING/);
    assert.match(out(r), /Seam candidates the day one is[^\n]*noto-fonts/);
  });

  test('the seam says the SAME thing from BOTH sides — the half that stays green is the half somebody quotes', () => {
    // The module's whole reason for being a shared import rather than a limb
    // inside one guard. Asserted on the FUNCTION, because the two callers differ
    // in everything else they check and an end-to-end comparison of their
    // outputs would be comparing two guards, not one seam.
    const root = fixture(linked({ licenceId: 'Apache-2.0' }));
    const asAsset = crossAssertLicenceRegisters(root, { side: 'asset' });
    const asContent = crossAssertLicenceRegisters(root, { side: 'content' });
    assert.ok(asAsset.problems.length > 0, 'the disagreeing fixture must produce problems at all');
    assert.deepEqual(asContent.problems, asAsset.problems);
    assert.deepEqual(asContent.prints, asAsset.prints);
    assert.equal(asAsset.linked, 1);
    assert.equal(asAsset.compared, 2);

    // …and the agreeing tree is clean from both sides, or the equality above
    // would also hold for a function that always returns the same problem.
    const clean = crossAssertLicenceRegisters(fixture(linked()), { side: 'asset' });
    assert.deepEqual(clean.problems, []);
  });

  test('assert-content-licences.mjs goes red on the SAME disagreement — the OTHER guard is wired to the seam', () => {
    // 🔴 THE LIMB THAT NEEDS A REAL TREE, AND THE ONE NOTHING ELSE COVERS.
    // Everything above proves the seam module and its wiring into
    // assert-licence-register.mjs. The seam's stated reason for being a shared
    // import — "a disagreement turns BOTH red, or the one that stays green is
    // the one somebody quotes" — is a claim about the OTHER guard, and deleting
    // its two `seam` lines would leave every case above passing. [7]P-5's guard
    // cannot be driven from the invented fixture in this file (it wants recipes,
    // packs and a required-coverage set), so this case does what the sibling
    // suite does: it MUTATES A COPY OF THE REAL TREE. Only tooling/ is copied —
    // the guard itself is run from the repo, since nothing here mutates a guard.
    const root = join(TMP, `real${seq++}`);
    for (const rel of ['tooling/content_pipeline', 'tooling/legal']) {
      cpSync(join(REPO, ...rel.split('/')), join(root, ...rel.split('/')), { recursive: true });
    }
    // The tripwire limb scans pubspecs; with none found it reports on an empty
    // domain and the baseline below would prove nothing.
    for (const top of ['apps', 'packages', 'services', 'sites']) {
      const dir = join(REPO, top);
      if (!existsSync(dir)) continue;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const src = join(dir, e.name, 'pubspec.yaml');
        if (!existsSync(src)) continue;
        mkdirSync(join(root, top, e.name), { recursive: true });
        cpSync(src, join(root, top, e.name, 'pubspec.yaml'));
      }
    }
    const contentGuard = (r) => spawnSync(process.execPath, [join(CI_DIR, 'assert-content-licences.mjs'), r], { encoding: 'utf8' });

    // The positive control. Without it a red MUTATED run is consistent with a
    // copy that was simply too thin to pass.
    const before = contentGuard(root);
    assert.equal(before.status, 0, out(before));

    // The same mutation the asset-side cases use: an asset row claims a content
    // family whose licence and attribution duty it does not agree with.
    const reg = join(root, 'tooling', 'legal', 'asset-register.json');
    const doc = JSON.parse(readFileSync(reg, 'utf8'));
    doc.assets[0].contentFamily = 'noto-fonts';
    writeFileSync(reg, `${JSON.stringify(doc, null, 2)}\n`);

    const after = contentGuard(root);
    assert.equal(after.status, 1, out(after));
    assert.match(out(after), /SEAM DISAGREEMENT on licence identity for family "noto-fonts"/);
  });
});
