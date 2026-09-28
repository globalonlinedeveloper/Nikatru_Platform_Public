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
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  // Absent unless a case names it, as it is absent from a register that predates it.
  appScopedAssets,
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
        ...(appScopedAssets === undefined ? {} : { appScopedAssets }),
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
    assert.equal(r.status, 2, 'the guard must have read the fixture root, not its own cwd');
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
    assert.equal(r.status, 2);
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

  // ── THE SURFACE THAT MOVED INTO THE CHASSIS PACKAGE ────────────────────────
  //
  // 2026-09-06 ([ADR 067] phase 2, unit screens-money-settings). `AboutListTile`
  // and `showLicensePage` are PAINTED, so they left the brick with the settings
  // body. Read at the adapter alone this limb reported "the template ships no
  // licences surface" about a template that ships one — a K-11 claim as wrong as
  // missing a real gap, and the reason this limb now follows the delegation.
  // DL2 is what makes DL1 more than a resolver that reads a file and throws the
  // answer away; DL3 is the refusal that must never read as silence.
  const delegating = ({ onDisk = true, inPackage = true } = {}) => {
    // The adapter imports the chassis file and USES a name it declares — the
    // resolver refuses an import that is never referenced — and carries NO
    // surface call of its own.
    const root = fixture({
      brickLib:
        "import 'package:nikatru_chassis_screens/settings/settings_screen.dart';\n" +
        'Widget b() => const SettingsView();\n',
    });
    if (onDisk) {
      write(
        root,
        join('packages', 'chassis_screens', 'lib', 'settings', 'settings_screen.dart'),
        'class SettingsView {\n' +
          (inPackage
            ? "  Widget t() => AboutListTile(applicationName: 'x');\n"
            : '  Widget t() => const ListTile();\n') +
          '}\n',
      );
    }
    return root;
  };

  test('DL1 · the surface is found THROUGH the delegation, and the scan says so', () => {
    const r = run(delegating());
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /the licences-surface scan also read 1 chassis file\(s\) it delegates to/);
    assert.match(out(r), /packages\/chassis_screens\/lib\/settings\/settings_screen\.dart/);
    assert.ok(!out(r).includes('ships NO licences surface: nothing under its lib/'));
  });

  test('DL2 · 🔴 the surface deleted from the PACKAGE still FAILS — the union is real, not a widening', () => {
    const r = run(delegating({ inPackage: false }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /ships NO licences surface/);
  });

  test('DL3 · 🔴 a delegation that cannot be followed is COVERAGE LOST, not silence', () => {
    const r = run(delegating({ onDisk: false }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /COVERAGE LOST/);
    assert.match(out(r), /a delegation it cannot follow is a surface it cannot see/);
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
    assert.equal(r.status, 2);
    assert.match(out(r), /COVERAGE LOST/);
    assert.match(out(r), /switched off\s+one entry at a time/);
  });

  test('an empty pattern set is COVERAGE LOST', () => {
    const r = run(fixture({ patterns: [] }));
    assert.equal(r.status, 2);
    assert.match(out(r), /COVERAGE LOST/);
    assert.match(out(r), /declares no `licenceSurfaceCalls\.patterns`/);
  });
});

describe('coverage self-checks', () => {
  test('a missing register is COVERAGE LOST', () => {
    const root = fixture();
    rmSync(join(root, 'tooling', 'legal', 'asset-register.json'));
    const r = run(root);
    assert.equal(r.status, 2);
    assert.match(out(r), /COVERAGE LOST/);
    // The NEAR register specifically. The seam raises its own COVERAGE LOST over
    // the same two files, and without this line the two are indistinguishable.
    assert.match(out(r), /tooling\/legal\/asset-register\.json does not exist/);
  });

  test('an assets: walk that finds nothing while the icon-font flag is on is COVERAGE LOST', () => {
    const r = run(fixture({ appPubspec: 'name: one\nflutter:\n  uses-material-design: true\n' }));
    assert.equal(r.status, 2);
    assert.match(out(r), /declared asset file\(s\), floor/);
  });

  test('a pubspec walk below its floor is COVERAGE LOST', () => {
    const r = run(fixture({ derivation: { minPubspecs: 9 } }));
    assert.equal(r.status, 2);
    assert.match(out(r), /pubspec\.yaml file\(s\), floor 9/);
  });

  test('an app walk below its floor is COVERAGE LOST', () => {
    const r = run(fixture({ derivation: { minApps: 5 } }));
    assert.equal(r.status, 2);
    assert.match(out(r), /app\(s\), floor 5/);
  });

  test('--bundle pointed at a directory that does not exist is COVERAGE LOST', () => {
    const r = run(fixture(), '--bundle', join(TMP, 'no-such-bundle'));
    assert.equal(r.status, 2);
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
      assert.equal(r.status, 2, out(r));
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
      // with no brand assets) and the guard reported all three of apps/subscriptiontracker's
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
// APP-SCOPED ROWS — `--bundle <dir> --app <id>` (lead ruling PRL-R1, 2026-09-26).
//
// The first PR-lane web build of app #1 (CI run 36233164494) shipped five files
// that pub packages put into its bundle, and no register row could say "this app
// ships that". Each case below builds app `one` with a resolved package `pkg_a`
// (a LICENSE, a package_config.json, a bundle holding packages/pkg_a/… and a
// NOTICES carrying the licence) and changes ONE thing, so a red case is red for
// its own named reason. The mutation run on the real tree is in the PR body.
// ─────────────────────────────────────────────────────────────────────────────
const MIT_TEXT = [
  'MIT License',
  '',
  'Copyright (c) 2026 Fixture Authors',
  '',
  'Permission is hereby granted, free of charge, to any person obtaining a copy',
  'of this software and associated documentation files (the "Software"), to deal',
  'in the Software without restriction.',
  '',
  'The above copyright notice and this permission notice shall be included in all',
  'copies or substantial portions of the Software.',
  '',
].join('\n');

const BSD3_TEXT = [
  'Copyright 2014 The Fixture Authors. All rights reserved.',
  '',
  'Redistribution and use in source and binary forms, with or without modification,',
  'are permitted provided that the following conditions are met:',
  '',
  '    * Neither the name of the copyright holder nor the names of its',
  '      contributors may be used to endorse or promote products derived',
  '      from this software without specific prior written permission.',
  '',
].join('\n');

const appRow = (over = {}) => ({
  id: 'one-pkg-a-script',
  scope: 'app:one',
  bundlePath: 'packages/pkg_a/assets/a.js',
  package: 'pkg_a',
  contentFamily: null,
  contentFamilyWhy: 'a script a package ships into the app; nothing in the content pipeline reads or produces it',
  name: 'a.js',
  origin: 'third-party',
  licence: 'MIT',
  attributionRequired: true,
  attributedIn: 'bundle:NOTICES',
  source: { note: 'the pkg_a package LICENSE, read by the guard' },
  ...over,
});

/** A fixture tree whose app `one` resolved `pkg_a` (and, with `sdkLicence`, the
 *  Flutter SDK), plus a built bundle. `via`: 'own' writes
 *  apps/one/.dart_tool/package_config.json with an absolute rootUri;
 *  'workspace' writes the pub-workspace shape measured on the real tree (a root
 *  package_config reached through workspace_ref.json) with a RELATIVE rootUri;
 *  'none' writes neither — `pub get` never ran. */
function appFixture({
  rows = [appRow()],
  via = 'own',
  licence = MIT_TEXT,
  notices = `pkg_a\n\n${MIT_TEXT}\n${'-'.repeat(80)}\n`,
  bundleFiles = ['logo.png', 'icon.png', 'MaterialIcons-Regular.otf', 'NOTICES', 'packages/pkg_a/assets/a.js'],
  sdkLicence = null,
  secondApp = false,
  assets,
} = {}) {
  const root = fixture({ appScopedAssets: rows, assets });
  const pkgDir = join(root, 'pubcache', 'pkg_a-1.0.0');
  write(root, join('pubcache', 'pkg_a-1.0.0', 'LICENSE'), licence);
  const config = { configVersion: 2, packages: [] };
  if (sdkLicence !== null) {
    write(root, join('sdk', 'LICENSE'), sdkLicence);
    config.flutterRoot = pathToFileURL(join(root, 'sdk')).href;
  }
  if (via === 'own') {
    config.packages.push({ name: 'pkg_a', rootUri: pathToFileURL(pkgDir).href, packageUri: 'lib/' });
    write(root, join('apps', 'one', '.dart_tool', 'package_config.json'), JSON.stringify(config));
  } else if (via === 'workspace') {
    config.packages.push({ name: 'pkg_a', rootUri: '../pubcache/pkg_a-1.0.0/', packageUri: 'lib/' });
    write(root, join('.dart_tool', 'package_config.json'), JSON.stringify(config));
    write(root, join('apps', 'one', '.dart_tool', 'pub', 'workspace_ref.json'), JSON.stringify({ workspaceRoot: '../../../..' }));
  }
  if (secondApp) {
    write(root, join('apps', 'two', 'pubspec.yaml'), 'name: two\nflutter:\n  uses-material-design: true\n');
    write(root, join('apps', 'two', 'lib', 'main.dart'), "Widget b() => AboutListTile(applicationName: 'two');\n");
  }
  const bundle = join(TMP, `b${seq++}`);
  mkdirSync(bundle, { recursive: true });
  for (const f of bundleFiles) write(bundle, f, f === 'NOTICES' ? notices : 'x');
  return { root, bundle };
}
const runApp = (fx, app = 'one') => run(fx.root, '--bundle', fx.bundle, '--app', app);

describe('app-scoped rows — every bundle file resolves to one row, and the licence is READ from its package', () => {
  test('AS1 · a package file resolves to its app row, and the licence is READ from the package', () => {
    const r = runApp(appFixture());
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /app:one · packages\/pkg_a\/assets\/a\.js — the pkg_a LICENSE reads MIT; NOTICES carries it/);
  });

  test('AS2 · the pub-workspace shape resolves too: workspace_ref.json to the root package_config, relative rootUri', () => {
    const r = runApp(appFixture({ via: 'workspace' }));
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /the pkg_a LICENSE reads MIT/);
  });

  test('AS3 · 🔴 a package file with NO row FAILS, naming it and the row its own bundle derives', () => {
    const r = runApp(appFixture({ rows: [] }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /packages\/pkg_a\/assets\/a\.js ships .*shipped by the hosted package pkg_a/);
    assert.match(
      out(r),
      /"scope":"app:one","bundlePath":"packages\/pkg_a\/assets\/a\.js","package":"pkg_a","origin":"third-party","licence":"MIT"/,
    );
  });

  test("AS4 · 🔴 a row whose licence differs from the package's LICENSE FAILS — the package is the source", () => {
    const r = runApp(appFixture({ rows: [appRow({ licence: 'Apache-2.0' })] }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /declares licence "Apache-2\.0", and the pkg_a package's own LICENSE \(.*\) reads MIT/);
  });

  test('AS5 · 🔴 an app:<other> row never satisfies this app', () => {
    const r = runApp(appFixture({ rows: [appRow({ scope: 'app:two' })], secondApp: true }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /no row in scope shared or app:one claims it/);
    assert.match(out(r), /A row scoped app:two names this path/);
  });

  test('AS6 · the same two-app tree with the row scoped to THIS app passes — AS5 is red for the scope alone', () => {
    const r = runApp(appFixture({ secondApp: true }));
    assert.equal(r.status, 0, out(r));
  });

  test('AS7 · no package_config — `pub get` never ran — is COVERAGE LOST, never a pass', () => {
    const r = runApp(appFixture({ via: 'none' }));
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /COVERAGE LOST/);
    assert.match(out(r), /has no resolved packages/);
  });

  test('AS8 · --app without --bundle is COVERAGE LOST', () => {
    const r = run(appFixture().root, '--app', 'one');
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /no --bundle was given/);
  });

  test('AS9 · --app naming no app is COVERAGE LOST', () => {
    const r = runApp(appFixture(), 'ghost');
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /--app ghost names no app/);
  });

  test("AS10 · 🔴 a row the build did not emit FAILS — the app's bundle witnesses every row scoped to it", () => {
    const r = runApp(appFixture({ bundleFiles: ['logo.png', 'icon.png', 'MaterialIcons-Regular.otf', 'NOTICES'] }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /claims packages\/pkg_a\/assets\/a\.js for app:one, and the build did NOT emit it/);
  });

  test("AS11 · 🔴 a NOTICES that does not carry the package's LICENSE FAILS — the attribution is unmet", () => {
    const r = runApp(appFixture({ notices: 'some_other_package\n\nsome other text\n' }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /does not carry the name pkg_a or the text of/);
  });

  test('AS12 · 🔴 a LICENSE that reads as no known licence FAILS — the row could not be read', () => {
    const r = runApp(appFixture({ licence: 'All rights reserved. Ask us first.\n' }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /reads as no licence this guard can name/);
  });

  test('AS13 · 🔴 a shared row never claims a file a hosted package ships, by basename', () => {
    const assets = structuredClone(DEFAULT_ASSETS);
    assets.push({
      id: 'decoy',
      contentFamily: null,
      contentFamilyWhy: 'a shared row that happens to share the package file basename',
      path: 'somewhere/a.js',
      name: 'a.js',
      origin: 'own-work',
      owner: 'The Proprietor',
      licence: 'proprietary-all-rights-reserved',
      attributionRequired: false,
      attributedIn: null,
      source: { note: 'our own' },
    });
    const r = runApp(appFixture({ rows: [], assets }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /shipped by the hosted package pkg_a, and no row in scope shared or app:one claims it/);
  });

  test('AS14 · 🔴 one file, one row: a file a shared row AND an app row both claim FAILS', () => {
    const sdkRow = appRow({
      id: 'one-sdk-icons',
      bundlePath: 'MaterialIcons-Regular.otf',
      package: 'sdk:flutter',
      licence: 'BSD-3-Clause',
      attributionRequired: false,
      attributedIn: null,
    });
    const r = runApp(appFixture({ rows: [appRow(), sdkRow], sdkLicence: BSD3_TEXT }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /MaterialIcons-Regular\.otf ships .* resolves to 2 rows \("icon-font", "one-sdk-icons"\)/);
    assert.ok(!out(r).includes('the build did NOT emit it'), out(r));
  });

  test("AS15 · an sdk:flutter row reads the Flutter SDK's LICENSE through flutterRoot", () => {
    const sdkRow = appRow({
      id: 'one-sdk-shader',
      bundlePath: 'shaders/x.frag',
      package: 'sdk:flutter',
      licence: 'BSD-3-Clause',
      attributionRequired: false,
      attributedIn: null,
    });
    const r = runApp(
      appFixture({
        rows: [appRow(), sdkRow],
        sdkLicence: BSD3_TEXT,
        bundleFiles: ['logo.png', 'icon.png', 'MaterialIcons-Regular.otf', 'NOTICES', 'packages/pkg_a/assets/a.js', 'shaders/x.frag'],
      }),
    );
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /app:one · shaders\/x\.frag — the sdk:flutter LICENSE reads BSD-3-Clause/);
  });

  test("AS16 · the row shape is graded in DECLARED mode too: a scope that is not app:<id> FAILS", () => {
    const r = run(fixture({ appScopedAssets: [appRow({ scope: 'one' })] }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /An app-scoped row's scope is `app:<app_id>`/);
  });

  test('AS17 · a row naming the wrong package for its path FAILS — the wrong package is the wrong LICENSE', () => {
    const r = run(fixture({ appScopedAssets: [appRow({ package: 'pkg_b' })] }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /names package pkg_b for packages\/pkg_a\/assets\/a\.js, and that path is shipped by package pkg_a/);
  });

  test('AS18 · UNVERIFIED is not an app-scoped licence — the package is there to be read', () => {
    const r = run(fixture({ appScopedAssets: [appRow({ licence: 'UNVERIFIED' })] }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /there is no unread state to record/);
  });

  test('AS19 · a row scoped to an app that does not exist FAILS', () => {
    const r = run(fixture({ appScopedAssets: [appRow({ scope: 'app:ghost' })] }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /no app ghost exists under apps/);
  });

  test('AS20 · the P-5 seam reads app-scoped rows too: one with no contentFamily FAILS', () => {
    const row = appRow();
    delete row.contentFamily;
    const r = run(fixture({ appScopedAssets: [row] }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /row "one-pkg-a-script" declares no `contentFamily`/);
  });

  test("AS21 · DECLARED mode shape-checks the rows and says their licence is read only by the --app walk", () => {
    const r = run(fixture({ appScopedAssets: [appRow()] }));
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /1 app-scoped row\(s\) shape-checked; each one's licence is read from its package only by a --bundle <dir> --app <id> walk/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ONE PIPELINE (LEAD RULING NP12B-R2, 2026-09-27) — the row the STAMP writes is
// the row this guard accepts, and the file it covers is refused without it.
//
// gen-app-licence-rows.mjs writes `app:<id>` rows from the resolved workspace
// when tooling/kit/stamp-app.mjs stamps an app. These cases run the REAL
// generator over the AS fixture (app `one` resolved `pkg_a`, whose pubspec
// declares the file the bundle carries) and then this guard over the same tree,
// so a generator and a guard that stopped agreeing about a row's shape, its
// licence or its key go red here rather than on an app's first web build.
// ─────────────────────────────────────────────────────────────────────────────
const GENERATOR = join(CI_DIR, 'gen-app-licence-rows.mjs');
const runGen = (root, ...args) => spawnSync(process.execPath, [GENERATOR, root, ...args], { encoding: 'utf8' });

/** The AS fixture, resolved the way `flutter pub get` at a workspace root
 *  leaves it: package_config.json AND package_graph.json, app `one` → pkg_a. */
function stampedFixture() {
  const fx = appFixture({ rows: [], via: 'workspace' });
  write(fx.root, join('pubcache', 'pkg_a-1.0.0', 'pubspec.yaml'), 'name: pkg_a\nflutter:\n  assets:\n    - assets/a.js\n');
  write(fx.root, join('pubcache', 'pkg_a-1.0.0', 'assets', 'a.js'), 'x');
  write(
    fx.root,
    join('.dart_tool', 'package_graph.json'),
    JSON.stringify({
      roots: ['one'],
      packages: [
        { name: 'one', version: '1.0.0', dependencies: ['pkg_a'], devDependencies: [] },
        { name: 'pkg_a', version: '1.0.0', dependencies: [] },
      ],
      configVersion: 1,
    }),
  );
  return fx;
}

describe('ONE PIPELINE — the row gen-app-licence-rows.mjs writes at stamp time is the row this guard accepts', () => {
  test('GR1 · the generator writes the row, and the bundle walk then reads its licence from the package and passes', () => {
    const fx = stampedFixture();
    const g = runGen(fx.root, '--write', '--app', 'one');
    assert.equal(g.status, 0, out(g));
    const rows = JSON.parse(readFileSync(join(fx.root, 'tooling', 'legal', 'asset-register.json'), 'utf8')).appScopedAssets;
    assert.deepEqual(
      rows.map((r) => [r.scope, r.bundlePath, r.package, r.licence]),
      [['app:one', 'packages/pkg_a/assets/a.js', 'pkg_a', 'MIT']],
    );
    const r = runApp(fx);
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /app:one · packages\/pkg_a\/assets\/a\.js — the pkg_a LICENSE reads MIT; NOTICES carries it/);
    const declared = run(fx.root);
    assert.equal(declared.status, 0, out(declared));
    assert.match(out(declared), /1 app-scoped row\(s\) shape-checked/);
  });

  test('GR2 · 🔴 RED CONTROL: the written row removed, the bundle walk refuses the file AND the generator --check names it', () => {
    const fx = stampedFixture();
    assert.equal(runGen(fx.root, '--write', '--app', 'one').status, 0);
    const regPath = join(fx.root, 'tooling', 'legal', 'asset-register.json');
    const green = readFileSync(regPath, 'utf8');
    const reg = JSON.parse(green);
    reg.appScopedAssets = [];
    writeFileSync(regPath, `${JSON.stringify(reg, null, 2)}\n`);
    const r = runApp(fx);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /packages\/pkg_a\/assets\/a\.js ships .*shipped by the hosted package pkg_a/);
    const c = runGen(fx.root, '--check', '--app', 'one');
    assert.equal(c.status, 1, out(c));
    assert.match(out(c), /app:one: packages\/pkg_a\/assets\/a\.js ships \(package pkg_a, MIT\) and has NO row/);
    writeFileSync(regPath, green);
    assert.equal(runApp(fx).status, 0, 'restored, the walk is green again');
    assert.equal(runGen(fx.root, '--check', '--app', 'one').status, 0, 'restored, the generator check is green again');
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
    assert.equal(r.status, 2, out(r)); // only the seam could not look: exit 2, not a finding
    assert.match(out(r), /CROSS-ASSERT COVERAGE LOST/);
    assert.match(out(r), /tooling\/legal\/content-licence-register\.json does not exist/);
  });

  test('a content register with NO family rows is COVERAGE LOST, not agreement', () => {
    const r = run(fixture({ contentFamilies: [] }));
    assert.equal(r.status, 2, out(r)); // only the seam could not look: exit 2, not a finding
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
    assert.equal(r.status, 2, out(r)); // only the seam could not look: exit 2, not a finding
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

    // …and the seam that could not be READ from this side is exit 2, not a finding: the module
    // returns its stops in `lost` and this guard's own coverageLost owns the exit
    // (O-EXIT2-CONVENTION-GAP). With the asset register gone there is nothing else wrong.
    rmSync(reg);
    const unread = contentGuard(root);
    assert.equal(unread.status, 2, out(unread));
    assert.match(out(unread), /CROSS-ASSERT COVERAGE LOST — tooling\/legal\/asset-register\.json does not exist/);
  });
});
