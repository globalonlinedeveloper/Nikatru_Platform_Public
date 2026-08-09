// ─────────────────────────────────────────────────────────────────────────────
// snapcraft-generable.test.mjs — tooling/ci/assert-snapcraft-generable.mjs and
// tooling/release/generate-snapcraft.mjs must both be able to FAIL.
//
// [pipeline F-10]: a guard that has only ever run against the real repository has
// only ever seen valid input, so only its passing path is exercised. Every case
// below feeds a tree that is wrong in exactly one way and asserts the specific
// complaint — never merely a non-zero exit, because a crash is not a catch.
//
// 🔴 THE THREE CASES THIS SUITE EXISTS FOR, and why each is the one that would
// otherwise go unnoticed:
//
//   · THE SNAP NAME FILE RENAMED. `snap-name.txt` holds the GLOBAL Snap Store
//     namespace OWNER_QUEUE A-6 claims. A generator that could not find it and
//     carried on would publish under a name nobody reviewed.
//
//   · A STAGE-PACKAGE DROPPED FROM THE WORKFLOW AFTER THE RECIPE WAS WRITTEN.
//     This is the whole point of extracting the apt list rather than retyping it,
//     and it is the failure that reports clean: the snap builds, and the app does
//     not start on a machine that happens to lack the library. The case is driven
//     through `--emitted`, which is the only way to make the two reads disagree
//     without giving the guard a backdoor that supplies its own answer.
//
//   · PLACEHOLDER TEXT IN THE EMITTED RECIPE. An angle-bracket slot is what an
//     emitter produces when an interpolation silently resolved to nothing, and a
//     generated file that reads like a template is one somebody fills in by hand.
//
// ⚠️ NO .snap IS BUILT ANYWHERE IN THIS SUITE, and none can be: `snapcraft` does
// not exist on Windows and is not on the runner image. Every case here is about
// the CONFIGURATION — that it can be derived, that it carries the tree's values,
// and that it fails when it cannot. The fixture bundle is a directory holding a
// stand-in file of the right NAME, which proves path handling and nothing about
// snap packaging.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-snapcraft-generable.mjs');
const GENERATOR = join(REPO, 'tooling', 'release', 'generate-snapcraft.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-snapgen-test-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

// ⚠️ THE FIXTURE apt LIST IS DELIBERATELY NOT THE REAL ONE. These tests must be
// able to fail when the real workflow changes for a good reason, and a fixture
// that mirrored it would either drift into a false red or have to be edited
// every time the Linux build gained a dependency. What is under test is the
// PARSER — the block scalar, the shell line continuation, the flag filtering —
// and a six-package list split across two continuation lines exercises all three.
const FIXTURE_PACKAGES = ['clang', 'cmake', 'ninja-build', 'pkg-config', 'libgtk-3-dev', 'liblzma-dev'];

const workflowWith = (packages, { runner = 'ubuntu-24.04', extraInstallStep = false, buildsLinux = true } = {}) => {
  const head = packages.slice(0, 3).join(' ');
  const tail = packages.slice(3).join(' ');
  return [
    'name: Build all 6 platforms',
    'on:',
    '  workflow_dispatch:',
    'jobs:',
    '  linux_web_android:',
    '    name: Linux + Web + Android',
    `    runs-on: ${runner}`,
    '    steps:',
    '      - name: Linux build deps',
    '        run: |',
    '          sudo apt-get update',
    `          sudo apt-get install -y \\`,
    `            ${head} \\`,
    `            ${tail}`,
    ...(buildsLinux
      ? ['      - name: Build linux', '        run: >', '          flutter build linux --release', '          --build-name=1.0.0']
      : []),
    ...(extraInstallStep
      ? ['  other:', '    runs-on: ubuntu-24.04', '    steps:', '      - name: More deps', '        run: sudo apt-get install -y zip']
      : []),
    '',
  ].join('\n');
};

const CMAKE = [
  '# The binary name. Change this to change the on-disk name of the executable.',
  'set(BINARY_NAME "subly")',
  '# The application id GTK registers under.',
  'set(APPLICATION_ID "com.nikatru.subly")',
  '',
].join('\n');

const LISTING = {
  'snap-name.txt': 'subly\n',
  'title.txt': 'Subly\n',
  'short-description.txt': 'Track every subscription in one place\n',
  'long-description.txt': 'Subly keeps every subscription in one list.\n\nIt does the arithmetic and the remembering.\n',
  'license.txt': 'proprietary\n',
};

/**
 * A fixture repository root. Only the four artifacts the generator reads are
 * built: the register that says WHERE the listing is, the listing itself, the
 * app's Linux identity, and the workflow that declares the apt list and runner.
 * The guard resolves the generator from its OWN location, so a fixture root does
 * not need a copy of tooling/ — the same arrangement submit-snap.mjs uses.
 */
function tree({
  packages = FIXTURE_PACKAGES,
  omitListing = [],
  renameSnapName = false,
  emptyListing = [],
  mutateRegister = null,
  omitWorkflow = false,
  omitCmake = false,
  omitStoreTree = false,
  runner = 'ubuntu-24.04',
  extraInstallStep = false,
  buildsLinux = true,
} = {}) {
  const root = join(TMP, `r${seq++}`);
  const write = (rel, body) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };

  const register = {
    channels: [
      {
        id: 'linux-snap',
        name: 'Snap Store',
        kind: 'store',
        platforms: ['linux'],
        served: false,
        submittable: true,
        artifactFormats: ['.snap'],
        storeMetadataDir: 'apps/{app}/store/linux-snap',
        ownerQueue: 'A-6',
      },
      { id: 'web', kind: 'web', platforms: ['web'], served: true, storeMetadataDir: null },
    ],
  };
  if (mutateRegister) mutateRegister(register);
  write('tooling/channel-register.json', JSON.stringify(register, null, 2));

  if (!omitWorkflow) {
    write('.github/workflows/build-platforms.yml', workflowWith(packages, { runner, extraInstallStep, buildsLinux }));
  }
  if (!omitCmake) write('apps/subly/linux/CMakeLists.txt', CMAKE);
  if (!omitStoreTree) {
    for (const [rel, body] of Object.entries(LISTING)) {
      if (omitListing.includes(rel)) continue;
      const name = rel === 'snap-name.txt' && renameSnapName ? 'snapname.txt' : rel;
      write(`apps/subly/store/linux-snap/${name}`, emptyListing.includes(rel) ? '   \n' : body);
    }
  } else {
    // The app directory still exists — otherwise the guard would be complaining
    // about a missing app rather than about a missing listing.
    write('apps/subly/pubspec.yaml', 'name: subly\n');
  }
  return root;
}

/** A stand-in for the built Linux bundle: a directory, a file named BINARY_NAME,
 *  and the desktop entry CMake installs under share/. */
function bundle(binary = 'subly', applicationId = 'com.nikatru.subly', { omitBinary = false } = {}) {
  const dir = join(TMP, `b${seq++}`);
  mkdirSync(join(dir, 'share', 'applications'), { recursive: true });
  if (!omitBinary) writeFileSync(join(dir, binary), 'stand-in\n');
  writeFileSync(join(dir, 'share', 'applications', `${applicationId}.desktop`), '[Desktop Entry]\nType=Application\n');
  return dir;
}

const run = (script, args) => {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
const guard = (root, extra = []) => run(GUARD, [root, ...extra]);
const generate = (root, extra) => {
  const out = join(TMP, `o${seq++}`);
  const r = run(GENERATOR, ['--repo-root', root, '--app', 'subly', '--out', out, '--version', '1.2.3.4', ...extra]);
  return { ...r, out_dir: out, recipe: join(out, 'snap', 'snapcraft.yaml') };
};

/** A crash is not a catch. Every failure below must be a REPORTED one. */
const assertComplained = (out) => {
  assert.doesNotMatch(out, /TypeError|ReferenceError|node:internal/, out);
};

// ─────────────────────────────────────────────────────────────────────────────
describe('generate-snapcraft — the recipe is derived, and refuses when it cannot be', () => {
  test('writes a complete recipe from a fixture tree', () => {
    const root = tree();
    const g = generate(root, ['--bundle', bundle()]);
    assert.equal(g.code, 0, g.out);
    assert.ok(existsSync(g.recipe), g.out);
    const yaml = readFileSync(g.recipe, 'utf8');
    assert.match(yaml, /^name: subly$/m);
    assert.match(yaml, /^grade: stable$/m);
    assert.match(yaml, /^confinement: strict$/m);
    assert.match(yaml, /^\s+plugin: dump$/m);
  });

  // 🔴 the continuation case: a parser that stopped at the first trailing
  // backslash would produce a SHORTER but non-empty list and no error anywhere.
  test('extracts EVERY apt package, across both shell line continuations', () => {
    const root = tree();
    const g = generate(root, ['--bundle', bundle()]);
    assert.equal(g.code, 0, g.out);
    const yaml = readFileSync(g.recipe, 'utf8');
    for (const p of FIXTURE_PACKAGES) assert.match(yaml, new RegExp(`^ {6}- ${p}$`, 'm'), `${p} missing`);
    // and the flag is not a package
    assert.doesNotMatch(yaml, /^ {6}- -y$/m);
    // and `apt-get update` contributed nothing
    assert.doesNotMatch(yaml, /^ {6}- update$/m);
  });

  test('the base is DERIVED from the lane runner, not typed', () => {
    const g22 = generate(tree({ runner: 'ubuntu-22.04' }), ['--bundle', bundle()]);
    assert.equal(g22.code, 0, g22.out);
    assert.match(readFileSync(g22.recipe, 'utf8'), /^base: core22$/m);
    const g24 = generate(tree({ runner: 'ubuntu-24.04' }), ['--bundle', bundle()]);
    assert.equal(g24.code, 0, g24.out);
    assert.match(readFileSync(g24.recipe, 'utf8'), /^base: core24$/m);
  });

  test('REFUSES an unmapped (floating) runner label rather than guessing a base', () => {
    const g = generate(tree({ runner: 'ubuntu-latest' }), ['--bundle', bundle()]);
    assert.equal(g.code, 1, g.out);
    assertComplained(g.out);
    assert.match(g.out, /has no snapcraft base recorded in BASE_FOR_RUNNER/);
    assert.match(g.out, /names an image family, not a release/);
  });

  test('REFUSES when the workflow holds more than one apt-get install', () => {
    const g = generate(tree({ extraInstallStep: true }), ['--bundle', bundle()]);
    assert.equal(g.code, 1, g.out);
    assertComplained(g.out);
    assert.match(g.out, /COVERAGE LOST/);
    assert.match(g.out, /requires exactly one/);
  });

  test('REFUSES when the only apt-get install is in a job that does not build linux', () => {
    const g = generate(tree({ buildsLinux: false }), ['--bundle', bundle()]);
    assert.equal(g.code, 1, g.out);
    assertComplained(g.out);
    assert.match(g.out, /does not run `flutter build linux`/);
  });

  test('REFUSES when the build workflow is gone', () => {
    const g = generate(tree({ omitWorkflow: true }), ['--bundle', bundle()]);
    assert.equal(g.code, 1, g.out);
    assertComplained(g.out);
    assert.match(g.out, /COVERAGE LOST/);
    assert.match(g.out, /build-platforms\.yml does not exist/);
  });

  test('REFUSES when snap-name.txt is missing', () => {
    const g = generate(tree({ renameSnapName: true }), ['--bundle', bundle()]);
    assert.equal(g.code, 1, g.out);
    assertComplained(g.out);
    assert.match(g.out, /snap-name\.txt does not exist/);
  });

  test('REFUSES when a listing field is emptied', () => {
    const g = generate(tree({ emptyListing: ['short-description.txt'] }), ['--bundle', bundle()]);
    assert.equal(g.code, 1, g.out);
    assertComplained(g.out);
    assert.match(g.out, /short-description\.txt is EMPTY/);
  });

  test('REFUSES a bundle directory that does not hold the BINARY_NAME file', () => {
    const g = generate(tree(), ['--bundle', bundle('subly', 'com.nikatru.subly', { omitBinary: true })]);
    assert.equal(g.code, 1, g.out);
    assertComplained(g.out);
    assert.match(g.out, /contains no file named "subly"/);
  });

  test('REFUSES without --version rather than minting a second version', () => {
    const out = join(TMP, `o${seq++}`);
    const r = run(GENERATOR, ['--repo-root', tree(), '--app', 'subly', '--out', out, '--bundle', bundle()]);
    assert.equal(r.code, 1, r.out);
    assertComplained(r.out);
    assert.match(r.out, /--version is required/);
  });

  test('REFUSES when the register declares no linux store row', () => {
    const root = tree({ mutateRegister: (reg) => { reg.channels[0].kind = 'direct'; } });
    const g = generate(root, ['--bundle', bundle()]);
    assert.equal(g.code, 1, g.out);
    assertComplained(g.out);
    assert.match(g.out, /COVERAGE LOST/);
    assert.match(g.out, /no `kind: "store"` row whose platforms include linux/);
  });

  test('emits the bundle as a RELATIVE source, never a host path', () => {
    const root = tree();
    const g = generate(root, ['--bundle', bundle()]);
    assert.equal(g.code, 0, g.out);
    const yaml = readFileSync(g.recipe, 'utf8');
    const m = yaml.match(/^ {4}source: (.+)$/m);
    assert.ok(m, yaml);
    assert.doesNotMatch(m[1], /^[A-Za-z]:[\\/]/, `absolute drive path emitted: ${m[1]}`);
    assert.doesNotMatch(m[1], /^\//, `absolute posix path emitted: ${m[1]}`);
    assert.doesNotMatch(yaml, /\\/, 'a Windows separator reached the recipe');
  });

  test('the listing is the SOURCE: change the file, the recipe follows', () => {
    const root = tree();
    writeFileSync(join(root, 'apps/subly/store/linux-snap/short-description.txt'), 'A different tagline entirely\n');
    const g = generate(root, ['--bundle', bundle()]);
    assert.equal(g.code, 0, g.out);
    assert.match(readFileSync(g.recipe, 'utf8'), /^summary: "A different tagline entirely"$/m);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-snapcraft-generable — it runs the generator and grades the result', () => {
  test('PASSES over a complete fixture tree', () => {
    const g = guard(tree());
    assert.equal(g.code, 0, g.out);
    assert.match(g.out, /ok {2}snapcraft generable/);
    assert.match(g.out, /1 recipe\(s\)/);
    assert.match(g.out, /snapcraft` was not run/);
  });

  // 🔴 NEGATIVE TEST 1 — the snap-name file renamed.
  test('FAILS when the snap name file is renamed out from under the generator', () => {
    const g = guard(tree({ renameSnapName: true }));
    assert.equal(g.code, 1, g.out);
    assertComplained(g.out);
    assert.match(g.out, /snap-name\.txt/);
  });

  test('FAILS when a listing field the recipe is derived from is emptied', () => {
    const g = guard(tree({ emptyListing: ['title.txt'] }));
    assert.equal(g.code, 1, g.out);
    assertComplained(g.out);
    assert.match(g.out, /title\.txt is missing or empty/);
  });

  test('FAILS when the app declares no Linux identity', () => {
    const g = guard(tree({ omitCmake: true }));
    assert.equal(g.code, 1, g.out);
    assertComplained(g.out);
    assert.match(g.out, /CMakeLists\.txt/);
  });

  // ── COVERAGE LOST ─────────────────────────────────────────────────────────
  test('COVERAGE LOST when the register declares no linux store row', () => {
    const g = guard(tree({ mutateRegister: (reg) => { reg.channels[0].kind = 'direct'; } }));
    assert.equal(g.code, 1, g.out);
    assert.match(g.out, /COVERAGE LOST/);
  });

  test('COVERAGE LOST when no app carries the store tree', () => {
    const g = guard(tree({ omitStoreTree: true }));
    assert.equal(g.code, 1, g.out);
    assert.match(g.out, /COVERAGE LOST/);
    assert.match(g.out, /carries a "linux-snap" store tree/);
  });

  test('COVERAGE LOST when the workflow apt list cannot be read', () => {
    const g = guard(tree({ omitWorkflow: true }));
    assert.equal(g.code, 1, g.out);
    assert.match(g.out, /COVERAGE LOST/);
  });

  test('COVERAGE LOST when there is no apps/ directory at all', () => {
    const root = tree();
    rmSync(join(root, 'apps'), { recursive: true, force: true });
    const g = guard(root);
    assert.equal(g.code, 1, g.out);
    assert.match(g.out, /COVERAGE LOST/);
    assert.match(g.out, /apps does not exist/);
  });

  // ── --emitted: grading a recipe that already exists ────────────────────────
  test('--emitted requires --app, so nothing about the expectation comes from the file', () => {
    const g = guard(tree(), ['--emitted', 'anything.yaml']);
    assert.equal(g.code, 1, g.out);
    assert.match(g.out, /--emitted requires --app/);
  });

  test('--emitted PASSES on the recipe the generator just wrote', () => {
    const root = tree();
    const gen = generate(root, ['--bundle', bundle()]);
    assert.equal(gen.code, 0, gen.out);
    const g = guard(root, ['--emitted', gen.recipe, '--app', 'subly']);
    assert.equal(g.code, 0, g.out);
  });

  // 🔴 NEGATIVE TEST 2 — a stage-package dropped from the workflow AFTER the
  // recipe was emitted. This is the equality limb, and it is the whole reason
  // the apt list is extracted rather than retyped.
  test('the stage-packages equality REDDENS when a package leaves the workflow mid-run', () => {
    const root = tree();
    const gen = generate(root, ['--bundle', bundle()]);
    assert.equal(gen.code, 0, gen.out);
    // green first, so the redness below is attributable to the mutation alone
    assert.equal(guard(root, ['--emitted', gen.recipe, '--app', 'subly']).code, 0);

    const shorter = FIXTURE_PACKAGES.filter((p) => p !== 'liblzma-dev');
    writeFileSync(join(root, '.github/workflows/build-platforms.yml'), workflowWith(shorter));

    const g = guard(root, ['--emitted', gen.recipe, '--app', 'subly']);
    assert.equal(g.code, 1, g.out);
    assertComplained(g.out);
    assert.match(g.out, /`stage-packages` and .* apt list disagree/);
    assert.match(g.out, /1 in the recipe and not the workflow \(liblzma-dev\)/);
  });

  test('the stage-packages equality REDDENS when the workflow GAINS a package the recipe lacks', () => {
    const root = tree();
    const gen = generate(root, ['--bundle', bundle()]);
    assert.equal(gen.code, 0, gen.out);
    writeFileSync(join(root, '.github/workflows/build-platforms.yml'), workflowWith([...FIXTURE_PACKAGES, 'libsecret-1-dev']));
    const g = guard(root, ['--emitted', gen.recipe, '--app', 'subly']);
    assert.equal(g.code, 1, g.out);
    assert.match(g.out, /1 in the workflow and not the recipe \(libsecret-1-dev\)/);
  });

  test('FAILS an emitted recipe whose stage-packages list is empty', () => {
    const root = tree();
    const gen = generate(root, ['--bundle', bundle()]);
    const doctored = join(TMP, `d${seq++}.yaml`);
    writeFileSync(doctored, readFileSync(gen.recipe, 'utf8').replace(/^ {6}- .*$/gm, '').replace(/\n{2,}/g, '\n'));
    const g = guard(root, ['--emitted', doctored, '--app', 'subly']);
    assert.equal(g.code, 1, g.out);
    assertComplained(g.out);
    assert.match(g.out, /stage-packages/);
  });

  // 🔴 NEGATIVE TEST 3 — placeholder text in the emitted recipe.
  test('FAILS an emitted recipe carrying placeholder text', () => {
    const root = tree();
    const gen = generate(root, ['--bundle', bundle()]);
    const doctored = join(TMP, `d${seq++}.yaml`);
    writeFileSync(doctored, `# TODO: fill in the real summary\n${readFileSync(gen.recipe, 'utf8')}`);
    const g = guard(root, ['--emitted', doctored, '--app', 'subly']);
    assert.equal(g.code, 1, g.out);
    assertComplained(g.out);
    assert.match(g.out, /placeholder text "TODO"/);
  });

  test('FAILS an emitted recipe carrying an unresolved angle-bracket slot', () => {
    const root = tree();
    const gen = generate(root, ['--bundle', bundle()]);
    const doctored = join(TMP, `d${seq++}.yaml`);
    writeFileSync(doctored, readFileSync(gen.recipe, 'utf8').replace(/^title: .*$/m, 'title: "<app title>"'));
    const g = guard(root, ['--emitted', doctored, '--app', 'subly']);
    assert.equal(g.code, 1, g.out);
    assertComplained(g.out);
    assert.match(g.out, /placeholder text/);
  });

  test('FAILS an emitted recipe carrying an absolute host path', () => {
    const root = tree();
    const gen = generate(root, ['--bundle', bundle()]);
    const doctored = join(TMP, `d${seq++}.yaml`);
    writeFileSync(doctored, `# staged from /home/runner/work/repo/build/linux\n${readFileSync(gen.recipe, 'utf8')}`);
    const g = guard(root, ['--emitted', doctored, '--app', 'subly']);
    assert.equal(g.code, 1, g.out);
    assertComplained(g.out);
    assert.match(g.out, /absolute host path/);
  });

  test('FAILS an emitted recipe whose name disagrees with the store tree', () => {
    const root = tree();
    const gen = generate(root, ['--bundle', bundle()]);
    const doctored = join(TMP, `d${seq++}.yaml`);
    writeFileSync(doctored, readFileSync(gen.recipe, 'utf8').replace(/^name: subly$/m, 'name: sublyy'));
    const g = guard(root, ['--emitted', doctored, '--app', 'subly']);
    assert.equal(g.code, 1, g.out);
    assertComplained(g.out);
    assert.match(g.out, /`name` is "sublyy"; the tree says "subly"/);
  });

  test('FAILS an emitted recipe that quietly relaxes confinement', () => {
    const root = tree();
    const gen = generate(root, ['--bundle', bundle()]);
    const doctored = join(TMP, `d${seq++}.yaml`);
    writeFileSync(doctored, readFileSync(gen.recipe, 'utf8').replace(/^confinement: strict$/m, 'confinement: classic'));
    const g = guard(root, ['--emitted', doctored, '--app', 'subly']);
    assert.equal(g.code, 1, g.out);
    assertComplained(g.out);
    assert.match(g.out, /`confinement` is "classic"/);
  });

  test('FAILS an emitted recipe that drops a declared plug', () => {
    const root = tree();
    const gen = generate(root, ['--bundle', bundle()]);
    const doctored = join(TMP, `d${seq++}.yaml`);
    writeFileSync(doctored, readFileSync(gen.recipe, 'utf8').replace(/^ {6}- wayland\n/m, ''));
    const g = guard(root, ['--emitted', doctored, '--app', 'subly']);
    assert.equal(g.code, 1, g.out);
    assertComplained(g.out);
    assert.match(g.out, /DESKTOP_PLUGS declares/);
  });

  test('FAILS an emitted recipe that is not readable YAML', () => {
    const root = tree();
    const doctored = join(TMP, `d${seq++}.yaml`);
    writeFileSync(doctored, 'name: subly\n  this line belongs nowhere\n');
    const g = guard(root, ['--emitted', doctored, '--app', 'subly']);
    assert.equal(g.code, 1, g.out);
    assertComplained(g.out);
    assert.match(g.out, /does not parse/);
  });

  test('COVERAGE LOST when --app names an app that carries no store tree', () => {
    const root = tree();
    const gen = generate(root, ['--bundle', bundle()]);
    const g = guard(root, ['--emitted', gen.recipe, '--app', 'not-an-app']);
    assert.equal(g.code, 1, g.out);
    assert.match(g.out, /COVERAGE LOST/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE TWO LIMBS ONLY A PACKING JOB CAN ASK.
//
// Both were added on 2026-08-09, when .github/workflows/submit-snap.yml started
// packing a real .snap, and both are invisible to every other check here: a
// recipe whose `base` does not match the host that packs it is a perfectly valid
// recipe, and a `source:` computed against the wrong directory is still relative
// and still free of host paths.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-snapcraft-generable — the base must match the host that packs it', () => {
  test('--pack-runner PASSES when the recipe base and the packing host agree', () => {
    const root = tree({ runner: 'ubuntu-24.04' });
    const gen = generate(root, ['--bundle', bundle()]);
    assert.equal(gen.code, 0, gen.out);
    assert.match(readFileSync(gen.recipe, 'utf8'), /^base: core24$/m);
    const g = guard(root, ['--emitted', gen.recipe, '--app', 'subly', '--pack-runner', 'ubuntu-24.04']);
    assert.equal(g.code, 0, g.out);
    assert.match(g.out, /packed on ubuntu-24\.04 whose base is core24/);
  });

  // 🔴 THE RECORDED FAILING CASE. The bundle is compiled on ubuntu-22.04 (base
  // core22) and packed on ubuntu-24.04 — which is exactly what happens if one of
  // the two workflows moves runner and the other does not. In
  // `--destructive-mode` there is no container to hide the mismatch.
  test('--pack-runner FAILS when the bundle lane and the packing host disagree', () => {
    const root = tree({ runner: 'ubuntu-22.04' });
    const gen = generate(root, ['--bundle', bundle()]);
    assert.equal(gen.code, 0, gen.out);
    // green without the argument first, so the redness is attributable to it alone
    assert.equal(guard(root, ['--emitted', gen.recipe, '--app', 'subly']).code, 0);
    const g = guard(root, ['--emitted', gen.recipe, '--app', 'subly', '--pack-runner', 'ubuntu-24.04']);
    assert.equal(g.code, 1, g.out);
    assertComplained(g.out);
    assert.match(g.out, /`base` is "core22" and this recipe is about to be packed on a host whose base is "core24"/);
  });

  test('--pack-runner REFUSES an unmapped label rather than treating it as a match', () => {
    const root = tree();
    const gen = generate(root, ['--bundle', bundle()]);
    const g = guard(root, ['--emitted', gen.recipe, '--app', 'subly', '--pack-runner', 'ubuntu-latest']);
    assert.equal(g.code, 1, g.out);
    assertComplained(g.out);
    assert.match(g.out, /--pack-runner ubuntu-latest has no snapcraft base recorded/);
  });

  test('--pack-runner without --emitted is refused: a fixture recipe is packed by nobody', () => {
    const g = guard(tree(), ['--pack-runner', 'ubuntu-24.04']);
    assert.equal(g.code, 1, g.out);
    assert.match(g.out, /--pack-runner is only meaningful with --emitted/);
  });
});

describe('assert-snapcraft-generable — `source:` resolves from the PROJECT directory', () => {
  // 🔴 THE REGRESSION THIS EXISTS FOR. generate-snapcraft.mjs computed the path
  // relative to `<out>/snap` — "relative to the recipe itself" — until 2026-08-09.
  // snapcraft resolves a part's local `source:` from the project directory it is
  // run in, so the emitted path carried one extra `..` and pointed one level above
  // the bundle. Every other check passed: it was relative, it held no host path,
  // and it parsed.
  test('the generator emits a source that resolves, from --out, to the bundle', () => {
    const root = tree();
    const b = bundle();
    const gen = generate(root, ['--bundle', b]);
    assert.equal(gen.code, 0, gen.out);
    const source = readFileSync(gen.recipe, 'utf8').match(/^ {4}source: (.+)$/m)[1];
    assert.equal(
      resolve(gen.out_dir, source),
      resolve(b),
      `source ${JSON.stringify(source)} resolved from the project directory must BE the bundle`,
    );
    assert.ok(existsSync(join(resolve(gen.out_dir, source), 'subly')), 'and the resolved directory holds the binary');
  });

  test('--emitted FAILS a recipe whose source does not resolve to this app\'s bundle', () => {
    const root = tree();
    const gen = generate(root, ['--bundle', bundle()]);
    assert.equal(guard(root, ['--emitted', gen.recipe, '--app', 'subly']).code, 0);
    // The exact shape of the old bug: one extra `..` in front of the path.
    const yaml = readFileSync(gen.recipe, 'utf8').replace(/^( {4}source: )(.+)$/m, '$1../$2');
    writeFileSync(gen.recipe, yaml);
    const g = guard(root, ['--emitted', gen.recipe, '--app', 'subly']);
    assert.equal(g.code, 1, g.out);
    assertComplained(g.out);
    assert.match(g.out, /resolves from the snapcraft project directory to .* which is not a directory/);
  });

  // A directory that EXISTS but is not this app's bundle — the case a mere
  // existence check would pass. `--out` and the fixture bundles are siblings under
  // TMP, so a sibling directory is reachable with a relative path (an absolute one
  // would be refused earlier, by the host-path limb, and prove something else).
  test("--emitted FAILS a source pointing at a directory that is not this app's bundle", () => {
    const root = tree();
    const good = generate(root, ['--bundle', bundle()]);
    assert.equal(good.code, 0, good.out);
    assert.equal(guard(root, ['--emitted', good.recipe, '--app', 'subly']).code, 0);

    const emptyName = `e${seq++}`;
    mkdirSync(join(TMP, emptyName), { recursive: true });
    writeFileSync(
      good.recipe,
      readFileSync(good.recipe, 'utf8').replace(/^( {4}source: ).+$/m, `$1../${emptyName}`),
    );
    const g = guard(root, ['--emitted', good.recipe, '--app', 'subly']);
    assert.equal(g.code, 1, g.out);
    assertComplained(g.out);
    assert.match(g.out, /is a directory but holds no file named "subly"/);
  });

  test('a recipe NOT at snap/snapcraft.yaml has no project directory, and says so', () => {
    const root = tree();
    const gen = generate(root, ['--bundle', bundle()]);
    const elsewhere = join(TMP, `x${seq++}.yaml`);
    writeFileSync(elsewhere, readFileSync(gen.recipe, 'utf8'));
    const g = guard(root, ['--emitted', elsewhere, '--app', 'subly']);
    assert.equal(g.code, 0, g.out);
    assert.match(g.out, /is not at \.\.\.\/snap\/snapcraft\.yaml/);
    assert.match(g.out, /stated gap, not a pass/);
  });
});

describe('generate-snapcraft --emit-build-deps — one apt list, two jobs', () => {
  // 🔴 WHY THIS MODE EXISTS. submit-snap.yml compiles the Linux bundle it packs,
  // so it needs the same toolchain build-platforms.yml installs. A second
  // `apt-get install -y clang cmake …` line there would be the [pipeline F-2]
  // duplication `readLinuxBuildLane` exists to prevent, one file further away.
  test('prints the lane apt list, space-separated, and NOTHING ELSE on stdout', () => {
    const root = tree();
    const r = spawnSync(process.execPath, [GENERATOR, '--repo-root', root, '--emit-build-deps'], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.equal(r.stdout.trim(), FIXTURE_PACKAGES.join(' '));
    // the diagnostic goes to stderr, because a diagnostic on stdout becomes a
    // package name the moment a shell spreads this into `apt-get install -y $(…)`
    assert.match(r.stderr, /build dep\(s\) from/);
  });

  test('it is the SAME list the recipe stages — one extraction, not two', () => {
    const root = tree();
    const gen = generate(root, ['--bundle', bundle()]);
    assert.equal(gen.code, 0, gen.out);
    // Only the `stage-packages:` block — `plugs:` entries sit at the same indent,
    // so a bare `- item` match would compare the apt list against both.
    const yaml = readFileSync(gen.recipe, 'utf8');
    const block = yaml.slice(yaml.indexOf('    stage-packages:'));
    const staged = [...block.matchAll(/^ {6}- (\S+)$/gm)].map((m) => m[1]);
    assert.deepEqual(staged, FIXTURE_PACKAGES, 'the block extraction itself must be reading the packages');

    const emitted = spawnSync(process.execPath, [GENERATOR, '--repo-root', root, '--emit-build-deps'], { encoding: 'utf8' })
      .stdout.trim()
      .split(' ');
    assert.deepEqual(emitted, staged, 'apt installs exactly what the snap stages, from one read of one file');
  });

  test('REFUSES rather than emitting an empty list when the workflow parse breaks', () => {
    const root = tree({ omitWorkflow: true });
    const r = spawnSync(process.execPath, [GENERATOR, '--repo-root', root, '--emit-build-deps'], { encoding: 'utf8' });
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.equal(r.stdout.trim(), '', 'nothing may reach stdout on a refusal — it would be read as a package name');
    assert.match(r.stderr, /COVERAGE LOST/);
  });
});
