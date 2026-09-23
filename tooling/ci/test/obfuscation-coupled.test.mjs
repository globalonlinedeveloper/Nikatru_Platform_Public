// ─────────────────────────────────────────────────────────────────────────────
// obfuscation-coupled.test.mjs — assert-obfuscation-coupled.mjs must be able to
// FAIL, on BOTH of its limbs.
//
// 🔴 THE REAL-TREE RUN CAME FIRST AND THESE FIXTURES ENCODE WHAT IT SHOWED.
// Six mutations were run against a full COPY of this repository on 2026-08-03,
// all six caught, all six restored byte-identically and re-run green:
//
//   1. `flutter build linux --release --obfuscate --split-debug-info=build/
//      symbols` in build-platforms.yml with no retention anywhere in the job
//      ⇒ exit 1 naming the directory and the job.
//   2. `--obfuscate` with NO `--split-debug-info` ⇒ exit 1 with the different,
//      sharper message: Flutter writes no mapping at all, so there is nothing
//      to upload and nothing to recover.
//   3. the same obfuscating build PLUS `sentry-cli debug-files upload` in the
//      same job ⇒ exit 0. Written before (1), because a guard that rejects the
//      unfamiliar is not a guard.
//   4. the same obfuscating build PLUS an `actions/upload-artifact` whose
//      `path:` names `build/symbols` ⇒ exit 0.
//   5. the `flutter build` matcher broken to `flutterr` ⇒ COVERAGE LOST, not a
//      pass — the 13 real build commands are what this guard speaks about.
//   6. a COMMENT reading "we deliberately do not pass --obfuscate
//      --split-debug-info=build/symbols here" ⇒ exit 0. This is the case the
//      repo has lost twice before ([1]F-10, assert-stamp-platforms.mjs:37-42).
//
// ── ➕ APPENDED 2026-09-07 · THE FLOOR ARRIVED AND FOUR CASES ABOVE CHANGED ──
//    ANSWER. THE OLD WORDING IS LEFT STANDING; THIS IS WHAT SUPERSEDES IT.
//
// The guard gained a FLOOR: every release build on a target Flutter can
// obfuscate must pass `--obfuscate`. So the tree state cases 1–6 were written
// against — "zero builds obfuscate, and that is fine" — is now a FAILURE, and
// three cases here flip with it:
//
//   · the old case 6 (a comment naming the flags) asserted exit 0 over a
//     release build that does not obfuscate. That is now exit 1 ON THE FLOOR,
//     and it proves MORE than it used to: the comment did not make the build
//     look obfuscated, and the failure says `0 obfuscating` while naming the
//     flags in the comment right above it.
//   · `--split-debug-info` without `--obfuscate` is still a NOTE and not a
//     coupling failure, but on a RELEASE build the floor now fails it — so that
//     case moved to a non-release build, where the note is the only verdict.
//   · the two false-alarm-surface cases (`app.*.symbols` in a .gitignore, the
//     word "obfuscated" in Dart prose) were asserting exit 0 on a fixture whose
//     build no longer clears the floor, so they now use the COMPLIANT fixture.
//     What they test is unchanged: neither surface is a build command.
//
// And FOUR cases are new, in the order the repo requires — GREEN CONTROL FIRST,
// then the mutation that must fail:
//
//   7. GREEN CONTROL — a release build that obfuscates and retains ⇒ exit 0,
//      and the output states the floor it applied.
//   8. MUTATION of exactly that fixture — `--obfuscate` removed from ONE of two
//      release builds ⇒ exit 1 naming that build, that job and that target,
//      with the other still counted.
//   9. a `flutter build web --release` is OUTSIDE the floor and said so, from
//      Flutter's own documented target list rather than from taste.
//  10. a tree whose only release build is web ⇒ COVERAGE LOST. The floor with
//      no subject is the vacuous pass this whole change removes.
//
// ── ➕ APPENDED 2026-09-07 · THE SINK LIMB, AND WHY ONE CASE HERE INVERTED ───
//    unit `symbols-everywhere` · [ADR 067] decision 6 · programme.json P1-11.
//
// The guard gained a THIRD limb: every obfuscating RELEASE build must upload its
// symbols to the crash sink from a LATER step of its OWN job. An
// `actions/upload-artifact` no longer settles it for a release build. So the
// fixtures here changed in one way and one case changed answer:
//
//   · `COMPLIANT` and `FLOOR_ANCHOR` now carry a real
//     `tooling/ops/upload-native-symbols.mjs` step. They are meant to be the
//     uninteresting, passing state of the tree, and without the upload they are
//     no longer that.
//   · the old case "an upload-artifact naming the SAME directory satisfies it"
//     asserted exit 0 for a RELEASE build retaining only an artifact. That is
//     now exit 1 by design — it is the state the audit of 2026-09-07 found on 11
//     of 14 lanes while this guard printed ok. The case is NARROWED to a
//     `--profile` build, where the coupling limb is the only verdict and its
//     answer is unchanged. The old wording is left standing above.
//
// And FOUR fixture cases are new, GREEN CONTROL FIRST:
//
//  11. GREEN CONTROL — obfuscating release build + retention + a sink upload
//      AFTER the build ⇒ exit 0, and the output states the sink limb and its
//      exemption count.
//  12. MUTATION of exactly that fixture — the sink step DELETED, the artifact
//      left in place ⇒ exit 1. The coupling limb is still satisfied, which is
//      what makes this the mutation that matters.
//  13. MUTATION of exactly that fixture — the sink step MOVED BEFORE the build
//      ⇒ exit 1 while its text is still in the job. A step that uploads before
//      its build uploads whatever the last run left behind, at exit 0.
//  14. an explicit `--profile` build needs no upload — the limb ranges over
//      release builds, and says how many it ranged over.
//
// `SINK_UPLOAD_EXEMPT` is a const no fixture can reach; both of its failure arms
// were proven by mutating the REAL TREE, and case 15 asserts the real tree's own
// run prints the count so an exemption cannot be added silently. See the comment
// above that case for the two mutations and their exact messages.
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
const GUARD = join(CI_DIR, 'assert-obfuscation-coupled.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-obf-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

/** `register`, when given, is written to tooling/channel-register.json. ⏱ ADDED
 *  2026-09-23 for the releaseBuildsNeverShipped cases; every older case passes
 *  none, so the guard sees no register there and grades every build. */
function fixture(workflows, register = undefined) {
  const root = join(TMP, `f${seq++}`);
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  for (const [name, body] of Object.entries(workflows)) {
    writeFileSync(join(root, '.github', 'workflows', name), body);
  }
  if (register !== undefined) {
    mkdirSync(join(root, 'tooling'), { recursive: true });
    writeFileSync(join(root, 'tooling', 'channel-register.json'), `${JSON.stringify(register, null, 2)}\n`);
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** A build job in the shape build-platforms.yml really has: a folded `run: >`
 *  command, then an upload-artifact step. `target` and `release` are parameters
 *  so a fixture can sit inside or outside the floor's domain deliberately. */
const wf = ({
  buildFlags = '',
  extraSteps = '',
  uploadPaths = 'apps/subscriptiontracker/build/linux/x64/release/bundle',
  comment = '',
  target = 'linux',
  release = ' --release',
  sinkStep = '',
  beforeBuild = '',
} = {}) => `name: Build
on:
  workflow_dispatch:

jobs:
  linux:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
${beforeBuild}${comment}      - name: Build ${target}
        working-directory: apps/subscriptiontracker
        run: >
          flutter build ${target}${release}${buildFlags}
          --dart-define=GLITCHTIP_DSN=x
${sinkStep}${extraSteps}      - uses: actions/upload-artifact@v4
        with:
          name: subscriptiontracker-${target}
          path: |
            ${uploadPaths}
          retention-days: 7
`;

/** ⏱ ADDED 2026-09-07 (unit `symbols-everywhere`) — the step the SINK limb
 *  requires. It is this repository's real wrapper call, not a stand-in: a
 *  fixture that invented its own upload command would prove the guard matches
 *  the fixture and nothing about the tree. */
const SINK_STEP =
  '      - name: Upload the native debug symbols to GlitchTip\n' +
  '        run: node tooling/ops/upload-native-symbols.mjs --dir build/symbols/linux --org nikatru --project subscriptiontracker\n';

/** A second job that clears the floor on its own, so a fixture can be about the
 *  COUPLING limb without the floor's own COVERAGE LOST getting there first.
 *  ⏱ 2026-09-07: it now also carries a sink upload, because an obfuscating
 *  RELEASE build that uploads nothing is a SINK failure and this job's whole
 *  purpose is to be uninteresting. */
const FLOOR_ANCHOR = `
  anchor:
    runs-on: ubuntu-24.04
    steps:
      - name: Build macos
        working-directory: apps/subscriptiontracker
        run: >
          flutter build macos --release
          --obfuscate --split-debug-info=build/symbols/macos
      - uses: actions/upload-artifact@v4
        with:
          name: symbols-subscriptiontracker-macos
          path: |
            apps/subscriptiontracker/build/symbols/macos
          retention-days: 90
      - name: Upload the native debug symbols to GlitchTip
        run: node tooling/ops/upload-native-symbols.mjs --dir build/symbols/macos --org nikatru --project subscriptiontracker
`;

/** The state the tree is IN after 2026-09-07: obfuscating, retaining AND
 *  uploading. ⏱ The upload is the half added by unit `symbols-everywhere`; until
 *  then this constant retained only, which the SINK limb now refuses. */
const COMPLIANT = wf({
  buildFlags: ' --obfuscate --split-debug-info=build/symbols/linux',
  uploadPaths: 'apps/subscriptiontracker/build/linux/x64/release/bundle\n            apps/subscriptiontracker/build/symbols/linux',
  sinkStep: SINK_STEP,
});

describe('assert-obfuscation-coupled', () => {
  // ── THE FLOOR ─────────────────────────────────────────────────────────────
  test('GREEN CONTROL — a release build that obfuscates and retains passes, and says which floor it applied', () => {
    const { code, out } = run(fixture({ 'build.yml': COMPLIANT }));
    assert.equal(code, 0, out);
    assert.match(out, /1 release build\(s\) on an obfuscatable target, 1 obfuscating/);
    assert.match(out, /FLOOR: all 1 of them pass --obfuscate/);
  });

  test('MUTATION of that control — --obfuscate removed from one of two release builds ⇒ exit 1 naming it', () => {
    // Byte-identical to the control above except for the anchor job, whose
    // build carries NO --obfuscate. One release build still obfuscates, so this
    // is the floor failing on a per-command basis and not on a bare count.
    const mutated = FLOOR_ANCHOR.replace('          --obfuscate --split-debug-info=build/symbols/macos\n', '');
    const { code, out } = run(fixture({ 'build.yml': `${COMPLIANT}${mutated}` }));
    assert.equal(code, 1, out);
    assert.match(out, /is a RELEASE build of "macos" and does not pass --obfuscate/);
    assert.match(out, /job "anchor"/);
    assert.match(out, /over 2 release build\(s\), 1 obfuscating/);
    assert.match(out, /\[ADR 067\] decision 6/);
  });

  test('FAILS on a tree whose release builds obfuscate nothing — the state ADR 067 decision 6 forbids', () => {
    const { code, out } = run(fixture({ 'build.yml': wf() }));
    assert.equal(code, 1, out);
    assert.match(out, /over 1 release build\(s\), 0 obfuscating/);
    assert.match(out, /does not pass --obfuscate/);
  });

  test('a `flutter build web --release` is outside the floor, and the guard says so rather than passing over it', () => {
    const root = fixture({ 'build.yml': `${COMPLIANT}
  web:
    runs-on: ubuntu-24.04
    steps:
      - name: Build web
        working-directory: apps/subscriptiontracker
        run: >
          flutter build web --release
          --dart-define=GLITCHTIP_DSN=x
` });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /1 release build\(s\) on an obfuscatable target/);
    assert.match(out, /1 web release build\(s\) are outside the floor/);
  });

  // ⏱ INVERTED 2026-09-07 (fix pass). This case READ:
  //     "a build that is not a --release build is outside the floor" ⇒ exit 0.
  // It was WRONG, and it locked the wrong answer in as intended behaviour. The
  // guard-integrity reviewer proved it on the real tree: delete `--release`
  // from `flutter build linux`, delete its `--obfuscate`, and the guard printed
  // `ok … 12 release build(s), 12 obfuscating`, code=0 — a shipping,
  // un-obfuscated Linux release had left the floor and NOTHING named it.
  // `flutter build <target>` defaults to release mode, so the flag was
  // decoration. The domain is now keyed on the ABSENCE of --debug/--profile.
  test('a build with NO mode flag is INSIDE the floor — flutter build defaults to release', () => {
    const root = fixture({ 'build.yml': `${wf({ release: '' })}${FLOOR_ANCHOR}` });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /is a RELEASE build of "linux" and does not pass --obfuscate/);
    assert.match(out, /over 2 release build\(s\), 1 obfuscating/);
  });

  test('GREEN CONTROL for that inversion — the same build WITH --obfuscate passes at 2 of 2', () => {
    const compliantNoFlag = wf({
      release: '',
      buildFlags: ' --obfuscate --split-debug-info=build/symbols/linux',
      uploadPaths: 'apps/subscriptiontracker/build/linux/x64/release/bundle\n            apps/subscriptiontracker/build/symbols/linux',
      sinkStep: SINK_STEP,
    });
    const { code, out } = run(fixture({ 'build.yml': `${compliantNoFlag}${FLOOR_ANCHOR}` }));
    assert.equal(code, 0, out);
    assert.match(out, /2 release build\(s\) on an obfuscatable target, 2 obfuscating/);
  });

  test('an EXPLICIT --debug leaves the floor, and the guard NAMES the build that left', () => {
    const root = fixture({ 'build.yml': `${wf({ release: ' --debug' })}${FLOOR_ANCHOR}` });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /1 release build\(s\) on an obfuscatable target, 1 obfuscating/);
    assert.match(out, /1 build\(s\) are outside it on an EXPLICIT --debug\/--profile/);
    assert.match(out, /builds "linux" in --debug mode/);
  });

  test('an EXPLICIT --profile leaves it the same way, and is named the same way', () => {
    const root = fixture({ 'build.yml': `${wf({ release: ' --profile' })}${FLOOR_ANCHOR}` });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /builds "linux" in --profile mode/);
  });

  test('a tree where nothing opts out says so, rather than printing nothing', () => {
    const { code, out } = run(fixture({ 'build.yml': COMPLIANT }));
    assert.equal(code, 0, out);
    assert.match(out, /no build claims --debug or --profile, so nothing left the floor by opting out/);
  });

  test('COVERAGE LOST on --release AND --profile together — a command with two modes has no answer', () => {
    const root = fixture({ 'build.yml': `${wf({ release: ' --release --profile' })}${FLOOR_ANCHOR}` });
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /name TWO build modes at once/);
    assert.match(out, /passes --release AND --profile on the same command/);
  });

  test('COVERAGE LOST on `bundle`, which was an UNSOURCED exemption until today', () => {
    // `bundle` sat in NON_OBFUSCATABLE_TARGETS cited to a doc page that names
    // only web. It exempted nothing in the tree, so it is removed and the
    // COVERAGE LOST limb answers for it — an unsourced exemption is not a pass.
    const root = fixture({ 'build.yml': `${wf({ target: 'bundle' })}${FLOOR_ANCHOR}` });
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /builds target "bundle"/);
  });

  test('COVERAGE LOST when the only release build is one Flutter cannot obfuscate', () => {
    const root = fixture({
      'build.yml': `name: Build
on:
  workflow_dispatch:

jobs:
  web:
    runs-on: ubuntu-24.04
    steps:
      - name: Build web
        run: flutter build web --release
`,
    });
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /ZERO of them a release build/);
  });

  test('COVERAGE LOST on a build target neither declared set has a verdict for', () => {
    const root = fixture({
      'build.yml': `${COMPLIANT}
  novel:
    runs-on: ubuntu-24.04
    steps:
      - name: Build something new
        run: flutter build fuchsia --release
`,
    });
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /builds target "fuchsia"/);
  });

  // ── the coupling limb the guard shipped with ──────────────────────────────
  test('FAILS when a build obfuscates and nothing in its job retains the symbols', () => {
    const { code, out } = run(fixture({ 'build.yml': wf({ buildFlags: ' --obfuscate --split-debug-info=build/symbols' }) }));
    assert.equal(code, 1);
    assert.match(out, /obfuscates into "build\/symbols" and nothing in job "linux" retains it/);
    assert.match(out, /A rebuild produces a DIFFERENT mapping/);
  });

  test('FAILS differently when --obfuscate carries no --split-debug-info at all', () => {
    const { code, out } = run(fixture({ 'build.yml': wf({ buildFlags: ' --obfuscate' }) }));
    assert.equal(code, 1);
    assert.match(out, /passes --obfuscate with no --split-debug-info/);
    assert.match(out, /nothing to upload and nothing to recover/);
  });

  // ── the false-alarm cases, written FIRST ──────────────────────────────────
  test('a symbol upload to the crash sink in the SAME job satisfies it', () => {
    const root = fixture({
      'build.yml': wf({
        buildFlags: ' --obfuscate --split-debug-info=build/symbols',
        extraSteps: '      - name: Upload symbols\n        run: sentry-cli debug-files upload --include-sources build/symbols\n',
      }),
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /1 obfuscating/);
  });

  test('glitchtip-cli debug-files upload satisfies it — the sink this factory actually runs', () => {
    const root = fixture({
      'build.yml': wf({
        buildFlags: ' --obfuscate --split-debug-info=build/symbols',
        extraSteps: '      - name: Upload symbols\n        run: "$RUNNER_TEMP/glitchtip-cli" debug-files upload --wait build/symbols\n',
      }),
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /1 obfuscating/);
  });

  test("this repo's wrapper for that CLI satisfies it too", () => {
    const root = fixture({
      'build.yml': wf({
        buildFlags: ' --obfuscate --split-debug-info=build/symbols',
        extraSteps: '      - name: Upload symbols\n        run: node tooling/ops/upload-native-symbols.mjs --dir build/symbols --org nikatru --project subscriptiontracker\n',
      }),
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
  });

  test('a dart-symbol-map upload does NOT satisfy it — GlitchTip stores nothing from one', () => {
    const root = fixture({
      'build.yml': wf({
        buildFlags: ' --obfuscate --split-debug-info=build/symbols',
        extraSteps: '      - name: Upload the obfuscation map\n        run: glitchtip-cli dart-symbol-map upload build/app/obfuscation.map.json build/app.linux-x64\n',
      }),
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /nothing in job "linux" retains it/);
  });

  // ⏱ NARROWED 2026-09-07 (unit `symbols-everywhere`). This case used to run on
  // a RELEASE build and assert exit 0 — "an artifact is enough". The SINK limb
  // now refuses exactly that for a release build, which is the whole point of
  // the change, so the case moves to a `--profile` build: outside the floor and
  // outside the sink limb's domain, where the COUPLING limb is the only verdict
  // and its answer is unchanged. What it proves is what it always proved — the
  // coupling limb accepts shape (b) — and it no longer doubles as a claim that
  // shape (b) is enough for a shipping build, which it never was.
  test('an upload-artifact naming the SAME directory satisfies the COUPLING limb', () => {
    const root = fixture({
      'build.yml': `${wf({
        release: ' --profile',
        buildFlags: ' --obfuscate --split-debug-info=build/symbols',
        uploadPaths: 'apps/subscriptiontracker/build/linux/x64/release/bundle\n            build/symbols',
      })}${FLOOR_ANCHOR}`,
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /builds "linux" in --profile mode/);
  });

  test('an upload-artifact naming a DIFFERENT directory does NOT satisfy it', () => {
    const root = fixture({
      'build.yml': wf({
        buildFlags: ' --obfuscate --split-debug-info=build/symbols',
        uploadPaths: 'apps/subscriptiontracker/build/linux/x64/release/bundle\n            build/coverage',
      }),
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /nothing in job "linux" retains it/);
  });

  test('a symbol upload in a DIFFERENT job does not count — the mapping never leaves its runner', () => {
    const root = fixture({
      'build.yml': `${wf({ buildFlags: ' --obfuscate --split-debug-info=build/symbols' })}
  publish:
    runs-on: ubuntu-24.04
    steps:
      - run: sentry-cli debug-files upload build/symbols
`,
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /job "linux"/);
  });

  test('a COMMENT naming the flags cannot make a build look obfuscated — it fails on the floor with 0 obfuscating', () => {
    const root = fixture({
      'build.yml': wf({ comment: '      # never pass --obfuscate --split-debug-info=build/symbols on this lane\n' }),
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /0 obfuscating/);
    assert.match(out, /does not pass --obfuscate/);
  });

  test('--split-debug-info WITHOUT --obfuscate is a printed note, not a failure', () => {
    const root = fixture({
      // ⏱ CORRECTED 2026-09-07 — `release: ''` used to put this fixture outside
      // the floor; a bare `flutter build` is now INSIDE it, so the opt-out has
      // to be said out loud for the note to be the only verdict.
      'build.yml': `${wf({ buildFlags: ' --split-debug-info=build/symbols', release: ' --profile' })}${FLOOR_ANCHOR}`,
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /doing less than it looks like/);
  });

  // ── THE SINK LIMB, added 2026-09-07 by unit `symbols-everywhere` ──────────
  // GREEN CONTROL FIRST, then the mutations of that exact control.
  test('GREEN CONTROL — an obfuscating release build that uploads to the sink after the build passes, and the output states the sink limb', () => {
    const { code, out } = run(fixture({ 'build.yml': COMPLIANT }));
    assert.equal(code, 0, out);
    assert.match(out, /SINK: all 1 of them upload those symbols to the crash sink from a later step of the same job/);
    assert.match(out, /with no declared exemption/);
  });

  test('MUTATION of that control — the sink upload step DELETED ⇒ exit 1, even though the artifact still retains the mapping', () => {
    // Byte-identical to COMPLIANT except that SINK_STEP is gone. The
    // upload-artifact naming build/symbols/linux is still there, so the COUPLING
    // limb is satisfied and the OLD guard would have printed ok — which is
    // precisely the state the audit of 2026-09-07 found on 11 of 14 lanes.
    const { code, out } = run(fixture({ 'build.yml': COMPLIANT.replace(SINK_STEP, '') }));
    assert.equal(code, 1, out);
    assert.match(out, /NOTHING LATER IN job "linux" uploads those symbols to the crash sink/);
    assert.match(out, /a retained workflow artifact is not an upload/);
    assert.match(out, /\[ADR 067\] decision 6/);
  });

  test('MUTATION of that control — the sink upload step MOVED BEFORE the build ⇒ exit 1, though its text is still in the job', () => {
    // This is the mutation a text-only match cannot catch: `grep` for
    // upload-native-symbols.mjs finds it, and it uploads whatever was on the
    // runner before this build ran, at exit 0.
    const moved = wf({
      buildFlags: ' --obfuscate --split-debug-info=build/symbols/linux',
      uploadPaths: 'apps/subscriptiontracker/build/linux/x64/release/bundle\n            apps/subscriptiontracker/build/symbols/linux',
      beforeBuild: SINK_STEP,
    });
    assert.match(moved, /upload-native-symbols\.mjs/, 'the mutation must keep the step, only move it');
    const { code, out } = run(fixture({ 'build.yml': moved }));
    assert.equal(code, 1, out);
    assert.match(out, /NOTHING LATER IN job "linux"/);
  });

  test('the sink limb ranges over RELEASE builds only — an explicit --profile build needs no upload', () => {
    const root = fixture({
      'build.yml': `${wf({
        release: ' --profile',
        buildFlags: ' --obfuscate --split-debug-info=build/symbols',
        uploadPaths: 'apps/subscriptiontracker/build/linux/x64/release/bundle\n            build/symbols',
      })}${FLOOR_ANCHOR}`,
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /SINK: all 1 of them upload/);
  });

  // ⚠️ SINK_UPLOAD_EXEMPT IS A CONST IN THE GUARD AND NO FIXTURE CAN REACH IT,
  // so its two failure arms were proven by MUTATING THE REAL TREE on 2026-09-07,
  // green control first, each restored and re-run green afterwards:
  //   · an entry naming `.github/workflows/submit-appstore.yml#dry-run`, a job
  //     that DOES upload ⇒ exit 1, "that job DOES upload its symbols to the
  //     crash sink … delete it", quoting the stated reason.
  //   · an entry naming `.github/workflows/nope.yml#ghost` ⇒ exit 1, "no
  //     obfuscating release build was found in that job at all".
  // The table is EMPTY on main, and this case is what says so out loud: a
  // fixture cannot see the const, but the real tree's own run prints the count.
  test('the real tree declares no sink exemption, and the guard prints that rather than staying silent about it', () => {
    const r = spawnSync(process.execPath, [GUARD], { encoding: 'utf8', cwd: resolve(CI_DIR, '..', '..') });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(`${r.stdout}${r.stderr}`, /SINK: all \d+ of them upload those symbols to the crash sink from a later step of the same job, with no declared exemption/);
  });

  // ── the coverage self-check ───────────────────────────────────────────────
  test('COVERAGE LOST when no workflow directory exists at all', () => {
    const root = join(TMP, `empty${seq++}`);
    mkdirSync(root, { recursive: true });
    const { code, out } = run(root);
    assert.equal(code, 2);
    assert.match(out, /COVERAGE LOST/);
  });

  test('COVERAGE LOST when the workflows carry no `flutter build` at all', () => {
    const root = fixture({
      'build.yml': `name: Build
on:
  workflow_dispatch:

jobs:
  linux:
    runs-on: ubuntu-24.04
    steps:
      - run: echo nothing to build
`,
    });
    const { code, out } = run(root);
    assert.equal(code, 2);
    assert.match(out, /found ZERO `flutter build` commands/);
  });

  test('COVERAGE LOST when comment stripping eats every step', () => {
    const root = fixture({
      'build.yml': `name: Build
on:
  workflow_dispatch:

jobs:
  linux:
    runs-on: ubuntu-24.04
    steps:
#      - run: flutter build linux --release
`,
    });
    const { code, out } = run(root);
    assert.equal(code, 2);
    assert.match(out, /COVERAGE LOST/);
  });

  // ── the two false-alarm surfaces that really live in this tree ────────────
  test('`app.*.symbols` in a .gitignore is not a build command', () => {
    const root = fixture({ 'build.yml': COMPLIANT });
    mkdirSync(join(root, 'apps', 'subscriptiontracker'), { recursive: true });
    writeFileSync(join(root, 'apps', 'subscriptiontracker', '.gitignore'), 'app.*.symbols\napp.*.map.json\n');
    const { code, out } = run(root);
    assert.equal(code, 0, out);
  });

  test('the word "obfuscated" in Dart prose is not a build command', () => {
    const root = fixture({ 'build.yml': COMPLIANT });
    mkdirSync(join(root, 'packages', 'platform_storage', 'lib'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'platform_storage', 'lib', 'storage_capabilities.dart'),
      '/// Web storage is obfuscated, not encrypted.\nclass StorageCapabilities {}\n',
    );
    const { code, out } = run(root);
    assert.equal(code, 0, out);
  });

  // ── releaseBuildsNeverShipped ⏱ ADDED 2026-09-23 ──────────────────────────
  // ci.yml `android-artifacts` builds the Android release artifacts on every PR,
  // obfuscated, and discards them. The register lists that job; this guard reads
  // the list through workflow-scan `gradeDomain` and waives COUPLING and SINK
  // only, never the FLOOR. FLOOR_ANCHOR keeps the sink limb's own subject set
  // non-empty, so each case is about the listed job alone.
  const neverShippedJob = (buildFlags) => `name: PR
on:
  pull_request:

jobs:
  discarded:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - name: Build android (apk)
        working-directory: apps/subscriptiontracker
        run: >
          flutter build apk --release${buildFlags}
          --dart-define=RELEASE_CHANNEL=android-play
${FLOOR_ANCHOR}`;
  const NEVER_SHIPPED_WHY = 'FIXTURE — built, inspected and discarded with the runner; nobody installs it.';
  const neverShippedRegister = (entries) => ({ releaseBuildsNeverShipped: { _why: ['fixture'], entries } });
  const listed = [{ workflow: '.github/workflows/pr.yml', job: 'discarded', why: NEVER_SHIPPED_WHY }];

  test('a build listed in releaseBuildsNeverShipped is not held to the coupling or sink limb', () => {
    const flags = ' --obfuscate --split-debug-info=build/symbols/android-apk';
    const green = run(fixture({ 'pr.yml': neverShippedJob(flags) }, neverShippedRegister(listed)));
    assert.equal(green.code, 0, green.out);
    assert.match(green.out, /COUPLING WAIVED, held to the FLOOR only; listed in releaseBuildsNeverShipped: FIXTURE — built/);
    assert.match(green.out, /SINK WAIVED, held to the FLOOR only; listed in releaseBuildsNeverShipped: FIXTURE — built/);
    assert.match(green.out, /FLOOR: all 2 of them pass --obfuscate/);
    assert.match(green.out, /SINK: all 1 of them upload those symbols/);
    // RED: the same tree with the entry removed is a COUPLING (and SINK) finding.
    const red = run(fixture({ 'pr.yml': neverShippedJob(flags) }, neverShippedRegister([])));
    assert.equal(red.code, 1, red.out);
    assert.match(red.out, /\.github\/workflows\/pr\.yml:\d+ \(job "discarded"\) obfuscates into "build\/symbols\/android-apk" and nothing in job "discarded" retains it/);
  });

  test('a build listed in releaseBuildsNeverShipped is still held to the floor', () => {
    const { code, out } = run(fixture({ 'pr.yml': neverShippedJob(' --split-debug-info=build/symbols/android-apk') }, neverShippedRegister(listed)));
    assert.equal(code, 1, out);
    assert.match(out, /\.github\/workflows\/pr\.yml:\d+ \(job "discarded"\) is a RELEASE build of "apk" and does not pass --obfuscate/);
  });

  test('a missing register grades every build (fail-closed)', () => {
    const root = fixture({ 'pr.yml': neverShippedJob(' --obfuscate --split-debug-info=build/symbols/android-apk') });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /nothing in job "discarded" retains it/);
    assert.match(out, /NOTHING LATER IN job "discarded" uploads those symbols to the crash sink/);
    assert.doesNotMatch(out, /releaseBuildsNeverShipped/);
  });

  test('a register that is not JSON is COVERAGE LOST, never a guess', () => {
    const root = fixture({ 'pr.yml': neverShippedJob(' --obfuscate --split-debug-info=build/symbols/android-apk') });
    mkdirSync(join(root, 'tooling'), { recursive: true });
    writeFileSync(join(root, 'tooling', 'channel-register.json'), '{ "releaseBuildsNeverShipped": ');
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /channel-register\.json exists and is not JSON/);
  });
});
