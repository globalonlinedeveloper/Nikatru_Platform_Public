// ─────────────────────────────────────────────────────────────────────────────
// publish-steps-guarded.test.mjs — limb 3 of assert-publish-steps-guarded.mjs:
// every submit lane runs the store's precondition gates, and which gates each
// lane owes is read from tooling/channel-register.json and
// tooling/ci/submit-preconditions.mjs (row O-SUBMIT-LANES-SKIP-PRECONDITION-GATES).
//
// Limbs 1 and 2 are exercised in extension-submission.test.mjs; this file holds
// limb 3 only, and the one refusal submit-preconditions.mjs adds to
// assert-iap-review-screenshots.mjs.
//
// 🔴 EVERY MUTATION HERE STARTS FROM A COPY OF THE REAL TREE, AFTER A GREEN CONTROL
// ON THE UNMUTATED COPY, and every mutation's anchor is asserted present first —
// a mutation whose anchor moved is a green control wearing a mutation's name.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, cpSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { SUBMIT_PRECONDITIONS, IAP_REVIEW_CHANNELS } from '../submit-preconditions.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-publish-steps-guarded.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-preconditions-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;
const runGuard = (args) => {
  const r = spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
const preconditions = (root) => runGuard(['--repo-root', root, '--limb', 'preconditions']);

/** A copy of everything limb 3 reads: every workflow and the local actions they
 *  call, the register, the publish scripts storePublishSteps derives from it, and
 *  the three guards the table names (the limb refuses a table guard not on disk). */
function realCopy(mutate = () => {}) {
  const root = join(TMP, `pre${seq++}`);
  cpSync(join(REPO, '.github', 'workflows'), join(root, '.github', 'workflows'), { recursive: true });
  cpSync(join(REPO, '.github', 'actions'), join(root, '.github', 'actions'), { recursive: true });
  cpSync(join(REPO, 'tooling', 'channel-register.json'), join(root, 'tooling', 'channel-register.json'));
  for (const f of readdirSync(join(REPO, 'tooling', 'release')).filter((n) => /^submit-.*[.]mjs$/.test(n))) {
    cpSync(join(REPO, 'tooling', 'release', f), join(root, 'tooling', 'release', f));
  }
  cpSync(join(REPO, 'extensions', 'scripts'), join(root, 'extensions', 'scripts'), { recursive: true });
  for (const e of SUBMIT_PRECONDITIONS) cpSync(join(REPO, e.guard), join(root, e.guard));
  mutate(root);
  return root;
}
const mutateFile = (root, rel, from, to) => {
  const p = join(root, rel);
  const text = readFileSync(p, 'utf8');
  assert.ok(text.includes(from), `the mutation anchor is not in ${rel}: ${from}`);
  writeFileSync(p, text.split(from).join(to));
};
const mutateRegister = (root, edit) => {
  const p = join(root, 'tooling', 'channel-register.json');
  const reg = JSON.parse(readFileSync(p, 'utf8'));
  edit(reg);
  writeFileSync(p, `${JSON.stringify(reg, null, 2)}\n`);
};

const APPSTORE = '.github/workflows/submit-appstore.yml';
const SNAP = '.github/workflows/submit-snap.yml';
const IOS_NAME_RUN = '        run: node tooling/ci/assert-name-clearance.mjs --for-submission=ios-appstore\n';
const MACOS_NAME_STEP =
  '      - name: Name clearance holds for macos-appstore (owner HELD or PROVEN-FREE)\n' +
  '        run: node tooling/ci/assert-name-clearance.mjs --for-submission=macos-appstore\n';
const IAP_RUN = '        run: node tooling/ci/assert-iap-review-screenshots.mjs --for-submission\n';
const SNAP_NAME_STEP =
  '      - name: Name clearance holds for linux-snap (owner HELD or PROVEN-FREE)\n' +
  '        run: node tooling/ci/assert-name-clearance.mjs --for-submission=linux-snap\n';

describe('assert-publish-steps-guarded limb 3 — every submit lane runs its store precondition gates', () => {
  test('GREEN CONTROL: the real tree grades every lane the register declares, and prints the row no entry applies to', () => {
    const { code, out } = runGuard(['--limb', 'preconditions']);
    assert.equal(code, 0, out);
    const m = out.match(/preconditions: (\d+) gate step\(s\) across (\d+) job\(s\) in (\d+) workflow\(s\)/);
    assert.ok(m !== null, out);
    // appstore 3 (dry-run only), play 4, snap 2, windows 2 — measured 2026-09-25.
    assert.ok(Number(m[1]) >= 11, `expected at least 11 gate steps, read ${m[1]}\n${out}`);
    for (const lane of ['submit-appstore.yml', 'submit-play.yml', 'submit-snap.yml', 'submit-windows-store.yml']) {
      assert.match(out, new RegExp(`PRECONDITION {2}[.]github/workflows/${lane.split('.').join('[.]')}:\\d+ job "dry-run"`), `${lane} was not graded\n${out}`);
    }
    assert.match(out, /PRECONDITION {2}\S+submit-play[.]yml:\d+ job "submit" channel android-play\n {14}node tooling\/ci\/assert-play-device-coverage[.]mjs --for-submission=android-play/, out);
    assert.match(out, /NOT GRADED {2}amo \(surface extension/, out);
  });

  test('GREEN CONTROL: the unmutated copy is green, so every red below is about its one edit', () => {
    const { code, out } = preconditions(realCopy());
    assert.equal(code, 0, out);
    assert.match(out, /preconditions: \d+ gate step\(s\)/, out);
  });

  test('a lane without one channel\'s step is a finding naming the workflow, the job, the channel and the command', () => {
    const root = realCopy((r) => mutateFile(r, APPSTORE, MACOS_NAME_STEP, ''));
    const { code, out } = preconditions(root);
    assert.equal(code, 1, out);
    assert.match(out, /MISSING PRECONDITION {2}[.]github\/workflows\/submit-appstore[.]yml job "dry-run" channel macos-appstore\n {4}no step runs: node tooling\/ci\/assert-name-clearance[.]mjs --for-submission=macos-appstore/, out);
    assert.doesNotMatch(out, /channel ios-appstore\n {4}no step runs/, out);
  });

  test('a gate step with continue-on-error: true is a finding — it cannot fail its job', () => {
    const root = realCopy((r) => mutateFile(r, APPSTORE, IOS_NAME_RUN, `        continue-on-error: true\n${IOS_NAME_RUN}`));
    const { code, out } = preconditions(root);
    assert.equal(code, 1, out);
    assert.match(out, /MASKED PRECONDITION {2}\S+submit-appstore[.]yml:\d+ job "dry-run" channel ios-appstore[\s\S]*the step carries continue-on-error: true/, out);
  });

  test('a gate followed by || true is a finding — the fallback turns its failure green', () => {
    const root = realCopy((r) => mutateFile(r, APPSTORE, IAP_RUN, IAP_RUN.replace('--for-submission\n', '--for-submission || true\n')));
    const { code, out } = preconditions(root);
    assert.equal(code, 1, out);
    assert.match(out, /MASKED PRECONDITION[^\n]*channel ios-appstore\n {4}node tooling\/ci\/assert-iap-review-screenshots[.]mjs --for-submission\n {4}a \|\| follows the gate/, out);
  });

  test('a gate behind an if: other than success() is a finding — it can be skipped while the job goes on', () => {
    const root = realCopy((r) => mutateFile(r, APPSTORE, IOS_NAME_RUN, `        if: github.event_name == 'push'\n${IOS_NAME_RUN}`));
    const { code, out } = preconditions(root);
    assert.equal(code, 1, out);
    assert.match(out, /MASKED PRECONDITION[^\n]*channel ios-appstore[\s\S]*its if: \(github[.]event_name == 'push'\) lets the gate be skipped/, out);
  });

  test('a gate that runs after the job\'s store publish is a finding — it grades a submission already made', () => {
    const root = realCopy((r) => {
      mutateFile(r, SNAP, SNAP_NAME_STEP, '');
      const p = join(r, SNAP);
      writeFileSync(p, `${readFileSync(p, 'utf8')}${SNAP_NAME_STEP}`);
    });
    const { code, out } = preconditions(root);
    assert.equal(code, 1, out);
    assert.match(out, /MISSING PRECONDITION {2}[.]github\/workflows\/submit-snap[.]yml job "dry-run" channel linux-snap/, out);
    assert.match(out, /MASKED PRECONDITION {2}\S+submit-snap[.]yml:\d+ job "submit" channel linux-snap[\s\S]*it runs after the job's first store publish step/, out);
  });

  test('a new submission row whose lane runs no gate is red until the lane runs them', () => {
    const root = realCopy((r) => {
      mutateRegister(r, (reg) => {
        reg.channels.push({ id: 'fixture-store', surface: 'app', submission: { workflow: '.github/workflows/submit-fixture.yml', job: 'dry-run', script: 'tooling/release/submit-snap.mjs' } });
      });
      writeFileSync(
        join(r, '.github', 'workflows', 'submit-fixture.yml'),
        [
          'name: "Store submit: fixture"',
          'on:',
          '  workflow_dispatch:',
          'jobs:',
          '  dry-run:',
          '    runs-on: ubuntu-24.04',
          '    steps:',
          '      - name: Build',
          '        run: echo build',
          '',
        ].join('\n'),
      );
    });
    const { code, out } = preconditions(root);
    assert.equal(code, 1, out);
    assert.match(out, /MISSING PRECONDITION {2}[.]github\/workflows\/submit-fixture[.]yml job "dry-run" channel fixture-store\n {4}no step runs: node tooling\/ci\/assert-name-clearance[.]mjs --for-submission=fixture-store/, out);
  });

  test('COVERAGE LOST: a register with no submission row grades no lane, which is not a pass', () => {
    const root = realCopy((r) => mutateRegister(r, (reg) => {
      for (const c of reg.channels) if (c.submission !== undefined) c.submission = null;
    }));
    const { code, out } = preconditions(root);
    assert.equal(code, 2, out);
    assert.match(out, /FAIL COVERAGE LOST — tooling\/channel-register[.]json declares no channel row with a submission[.]workflow/, out);
  });

  test('COVERAGE LOST: a guard the table names that is not on disk', () => {
    const root = realCopy((r) => rmSync(join(r, 'tooling', 'ci', 'assert-play-device-coverage.mjs')));
    const { code, out } = preconditions(root);
    assert.equal(code, 2, out);
    assert.match(out, /FAIL COVERAGE LOST — submit-preconditions[.]mjs names tooling\/ci\/assert-play-device-coverage[.]mjs, which is not on disk/, out);
  });

  // ⏱ 2026-10-01: the device-coverage entry applies by the register now (C-03), so the entry that
  // still NAMES android-play outright is assert-app-yaml.mjs's (IAP_STORE_CHANNELS).
  test('COVERAGE LOST: a channel the table names that the register does not declare', () => {
    const root = realCopy((r) => mutateRegister(r, (reg) => {
      reg.channels = reg.channels.filter((c) => c.id !== 'android-play');
    }));
    const { code, out } = preconditions(root);
    assert.equal(code, 2, out);
    assert.match(out, /applies tooling\/ci\/assert-app-yaml[.]mjs to channel "android-play", which tooling\/channel-register[.]json does not declare/, out);
  });

  test('a mistyped limb is COVERAGE LOST, and preconditions is a named limb', () => {
    const { code, out } = runGuard(['--limb', 'precondition']);
    assert.equal(code, 2, out);
    assert.match(out, /expected dry-run, owner-word, preconditions or all/, out);
  });
});

describe('submit-preconditions.mjs — the IAP review reader grades the table\'s one channel', () => {
  test('GREEN CONTROL: the table names ios-appstore, and a copied reader loads past the refusal', () => {
    assert.deepEqual(IAP_REVIEW_CHANNELS, ['ios-appstore']);
    const root = iapCopy((s) => s);
    const r = spawnSync(process.execPath, [join(root, 'tooling', 'ci', 'assert-iap-review-screenshots.mjs')], { cwd: root, encoding: 'utf8' });
    assert.doesNotMatch(`${r.stdout}${r.stderr}`, /IAP_REVIEW_CHANNELS names/, `${r.stdout}${r.stderr}`);
    // ⏱ 2026-10-01: a reader that never LOADED also prints no refusal — measured, when the table gained
    // an import iapCopy did not copy. "Past the refusal" means it got as far as reading the tree.
    assert.doesNotMatch(`${r.stdout}${r.stderr}`, /ERR_MODULE_NOT_FOUND/, `${r.stdout}${r.stderr}`);
  });

  test('a second IAP review channel is COVERAGE LOST in the reader, not graded as the first', () => {
    const root = iapCopy((s) => {
      assert.ok(s.includes("['ios-appstore']"), 'the IAP_REVIEW_CHANNELS anchor moved');
      return s.replace("['ios-appstore']", "['ios-appstore', 'macos-appstore']");
    });
    const r = spawnSync(process.execPath, [join(root, 'tooling', 'ci', 'assert-iap-review-screenshots.mjs')], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /IAP_REVIEW_CHANNELS names 2 channel\(s\) \[ios-appstore, macos-appstore\]; this reader grades exactly one channel's tree/);
  });
});

/** The IAP reader and the modules it imports, copied beside an empty tree;
 *  `edit` rewrites submit-preconditions.mjs's text. The refusal runs before any
 *  read, so the reader needs nothing else to reach it. ⏱ 2026-10-01: the table
 *  imports channel-surface.mjs (isNativeRow), so that is copied too. */
function iapCopy(edit) {
  const root = join(TMP, `iap${seq++}`);
  mkdirSync(join(root, 'tooling', 'ci'), { recursive: true });
  for (const f of ['assert-iap-review-screenshots.mjs', 'tree-walk.mjs', 'channel-surface.mjs']) cpSync(join(REPO, 'tooling', 'ci', f), join(root, 'tooling', 'ci', f));
  const table = readFileSync(join(REPO, 'tooling', 'ci', 'submit-preconditions.mjs'), 'utf8');
  writeFileSync(join(root, 'tooling', 'ci', 'submit-preconditions.mjs'), edit(table));
  return root;
}

// ── ⏱ 9b (rv-c22) · O-REAL-SUBMISSION-FLAG-UNGUARDED (absent from open.json on 2026-09-27): the declaration gate knows which job is REAL ──
// LEAD RULING O-A2-R1 (absent from open.json: a ruling, not a row): `declaredOn: null` refuses a REAL submission only, and the gate
// learns it is inside one from ONE hand-typed flag. Measured on the landing base before
// this limb: dropping it from submit-play.yml's submit job left eight guards at 0.
describe('⏱ 9b — limb 3: --real-submission where the job publishes, never where it does not', () => {
  const PLAY = '.github/workflows/submit-play.yml';
  const WIN = '.github/workflows/submit-windows-store.yml';
  const REAL = ' --real-submission\n';

  test('GREEN CONTROL: the real tree carries the declaration gate in both Windows jobs, marked real only in "submit"', () => {
    const { code, out } = runGuard(['--limb', 'preconditions']);
    assert.equal(code, 0, out);
    assert.match(out, /PRECONDITION {2}\S+submit-windows-store[.]yml:\d+ job "dry-run" channel windows-store\n {14}node tooling\/ci\/assert-sworn-store-files[.]mjs --for-submission=windows-store/, out);
    assert.match(out, /PRECONDITION {2}\S+submit-windows-store[.]yml:\d+ job "submit" channel windows-store\n {14}node tooling\/ci\/assert-sworn-store-files[.]mjs --for-submission=windows-store/, out);
    assert.doesNotMatch(out, /UNDECLARED CHANNEL|STALE EXEMPTION|REAL SUBMISSION UNMARKED|DRY RUN MARKED REAL/, out);
  });

  test('🔴 RC-F1a: the Play submit job without --real-submission is a finding (exit 1)', () => {
    const root = realCopy((r) => mutateFile(r, PLAY, `--app "$APP"${REAL}`, '--app "$APP"\n'));
    const { code, out } = preconditions(root);
    assert.equal(code, 1, out);
    assert.match(out, /MASKED PRECONDITION {2}\S+submit-play[.]yml:\d+ job "submit" channel android-play[\s\S]*REAL SUBMISSION UNMARKED/, out);
  });

  test('🔴 RC-F1b: the Windows submit job without --real-submission is a finding (exit 1)', () => {
    const root = realCopy((r) => mutateFile(r, WIN, `--app "$APP"${REAL}`, '--app "$APP"\n'));
    const { code, out } = preconditions(root);
    assert.equal(code, 1, out);
    assert.match(out, /MASKED PRECONDITION {2}\S+submit-windows-store[.]yml:\d+ job "submit" channel windows-store[\s\S]*REAL SUBMISSION UNMARKED/, out);
  });

  test('🔴 RC-F1c: a dry-run job whose declaration gate says --real-submission is a finding (exit 1)', () => {
    const dry = 'run: node tooling/ci/assert-sworn-store-files.mjs --for-submission=android-play --app "$APP"\n';
    const root = realCopy((r) => mutateFile(r, PLAY, dry, dry.replace('"$APP"\n', `"$APP"${REAL}`)));
    const { code, out } = preconditions(root);
    assert.equal(code, 1, out);
    assert.match(out, /MASKED PRECONDITION {2}\S+submit-play[.]yml:\d+ job "dry-run" channel android-play[\s\S]*DRY RUN MARKED REAL/, out);
  });

  test('🔴 RC-F2a: the Windows submit job without its declaration step is a finding (exit 1)', () => {
    const step = '        run: node tooling/ci/assert-sworn-store-files.mjs --for-submission=windows-store --app "$APP" --real-submission\n';
    const root = realCopy((r) => mutateFile(r, WIN, step, ''));
    const { code, out } = preconditions(root);
    assert.equal(code, 1, out);
    assert.match(out, /MISSING PRECONDITION {2}\S+submit-windows-store[.]yml job "submit" channel windows-store/, out);
  });

  test('🔴 a submitting app row that no declaration gate covers and no exemption names is a finding (exit 1)', () => {
    const root = realCopy((r) =>
      mutateRegister(r, (reg) => {
        const snap = reg.channels.find((c) => c.id === 'linux-snap');
        reg.channels.push({ ...structuredClone(snap), id: 'zz-new-store' });
      }),
    );
    const { code, out } = preconditions(root);
    assert.equal(code, 1, out);
    assert.match(out, /UNDECLARED CHANNEL {2}zz-new-store \([.]github\/workflows\/submit-snap[.]yml\)/, out);
    assert.doesNotMatch(out, /UNDECLARED CHANNEL {2}linux-snap/, out);
  });

  test('🔴 an exempt channel that a declaration gate now covers is a finding: the exemption is stale (exit 1)', () => {
    const root = realCopy((r) =>
      mutateRegister(r, (reg) => {
        const per = reg.storeMetadataContract.perChannel['linux-snap'];
        per.additionalFiles = [...(per.additionalFiles ?? []), 'zz-sworn-declaration.json'];
      }),
    );
    const { code, out } = preconditions(root);
    assert.equal(code, 1, out);
    assert.match(out, /STALE EXEMPTION {2}linux-snap/, out);
  });
});

// ── ⏱ 2026-10-01 · O-SUBMIT-LANES-IGNORE-NATIVE-AUTH — C-04, C-03 and AA-02 in every submit lane ──
// C-04: no lane read `nativeAuth`. C-03: a missing screenshot set was fatal on Play alone. AA-02:
// every dry run ran its gates before its build, so no rehearsal built anything from 2026-09-25.
describe('⏱ 2026-10-01 — limb 3: the nativeAuth and device-coverage gates, and a dry run that builds before it gates', () => {
  const PLAY = '.github/workflows/submit-play.yml';
  const WIN = '.github/workflows/submit-windows-store.yml';
  const IOS_NAME_STEP =
    '      - name: Name clearance holds for ios-appstore (owner HELD or PROVEN-FREE)\n' +
    '        run: node tooling/ci/assert-name-clearance.mjs --for-submission=ios-appstore\n';
  // ⏱ 2026-10-03 (club-store-chain, review AA-18): the dry run now signs in-lane and builds macOS, THEN
  // iOS (an archive + export), so the LAST build is the iOS one.
  const BUILD_LAST_APPLE = '      - name: Build iOS (signed archive + export)\n';
  const PLAY_NATIVE_DRY =
    '      - name: A build that cannot sign in reaches no public track (android-play)\n' +
    '        run: node tooling/ci/assert-channel-register.mjs --for-submission=android-play\n';
  const BUILD_AAB = '      - name: Build the app bundle\n';
  const WIN_NATIVE_REAL = '        run: node tooling/ci/assert-channel-register.mjs --for-submission=windows-store --real-submission\n';

  test('GREEN CONTROL: every lane runs both new gates for each of its channels, the real jobs marked real', () => {
    const { code, out } = runGuard(['--limb', 'preconditions']);
    assert.equal(code, 0, out);
    for (const [lane, jobs, ids] of [
      ['submit-play', ['dry-run', 'submit'], ['android-play']],
      ['submit-windows-store', ['dry-run', 'submit'], ['windows-store']],
      ['submit-snap', ['dry-run', 'submit'], ['linux-snap']],
      ['submit-appstore', ['dry-run'], ['ios-appstore', 'macos-appstore']],
    ]) {
      for (const job of jobs) {
        for (const id of ids) {
          for (const guard of ['assert-channel-register', 'assert-play-device-coverage']) {
            const re = new RegExp(`PRECONDITION {2}\\S+${lane}[.]yml:\\d+ job "${job}" channel ${id}\\n {14}node tooling/ci/${guard}[.]mjs --for-submission=${id}`);
            assert.match(out, re, `${lane} ${job} ${id} ${guard}\n${out}`);
          }
        }
      }
    }
    assert.doesNotMatch(out, /GATE BEFORE THE BUILD|NO PUBLIC REACH|STALE PUBLIC REACH/, out);
  });

  test('🔴 RED CONTROL (AA-02): a dry-run gate moved back above its build is a finding (exit 1)', () => {
    const root = realCopy((r) => {
      mutateFile(r, PLAY, PLAY_NATIVE_DRY, '');
      mutateFile(r, PLAY, BUILD_AAB, `${PLAY_NATIVE_DRY}${BUILD_AAB}`);
    });
    const { code, out } = preconditions(root);
    assert.equal(code, 1, out);
    assert.match(out, /MASKED PRECONDITION {2}\S+submit-play[.]yml:\d+ job "dry-run" channel android-play\n {4}node tooling\/ci\/assert-channel-register[.]mjs --for-submission=android-play\n {4}GATE BEFORE THE BUILD/, out);
  });

  test('🔴 (AA-02) the order is against the LAST build: a gate between the iOS and the macOS build is a finding', () => {
    const root = realCopy((r) => {
      mutateFile(r, APPSTORE, IOS_NAME_STEP, '');
      mutateFile(r, APPSTORE, BUILD_LAST_APPLE, `${IOS_NAME_STEP}${BUILD_LAST_APPLE}`);
    });
    const { code, out } = preconditions(root);
    assert.equal(code, 1, out);
    assert.match(out, /MASKED PRECONDITION {2}\S+submit-appstore[.]yml:\d+ job "dry-run" channel ios-appstore[\s\S]*GATE BEFORE THE BUILD: [^\n]*submit-appstore[.]yml:\d+/, out);
  });

  // ⏱ 2026-10-03 (club-store-chain, review AA-23): the snap submit job takes the dry run's .snap by sha256
  // and builds nothing, so "gates first" is measured against the step that hands the snap to the store.
  test('(AA-02) a REAL submit job keeps its gates first: the snap submit job gates before it uploads, builds nothing, and is green', () => {
    const snap = readFileSync(join(REPO, SNAP), 'utf8');
    const submitAt = snap.indexOf('\n  submit:\n');
    assert.ok(submitAt !== -1, 'the snap submit job anchor moved');
    const job = snap.slice(submitAt);
    assert.equal(job.indexOf('flutter-release-build.mjs'), -1, 'the snap submit job builds again instead of taking the dry run\'s bytes');
    const gate = job.indexOf('assert-name-clearance.mjs --for-submission=linux-snap');
    const upload = job.indexOf('submit-snap.mjs --submit');
    assert.ok(gate !== -1 && upload !== -1 && gate < upload, 'the snap submit job no longer gates first');
    assert.equal(preconditions(realCopy()).code, 0);
  });

  test('COVERAGE LOST (AA-02): a dry run whose build and pack are respelled past BUILD_OR_PACK has nothing to order against', () => {
    const root = realCopy((r) => {
      mutateFile(r, SNAP, 'node tooling/ci/flutter-release-build.mjs "$APP" linux linux-snap', 'echo build linux');
      mutateFile(r, SNAP, 'sudo snapcraft pack --destructive-mode', 'echo pack');
    });
    const { code, out } = preconditions(root);
    assert.equal(code, 2, out);
    assert.match(out, /FAIL COVERAGE LOST — [.]github\/workflows\/submit-snap[.]yml job "dry-run" publishes nothing and holds precondition gates, and no step in it builds or packs/, out);
  });

  test('🔴 (C-04) the Windows submit job without its nativeAuth gate is a finding (exit 1)', () => {
    const root = realCopy((r) => mutateFile(r, WIN, WIN_NATIVE_REAL, ''));
    const { code, out } = preconditions(root);
    assert.equal(code, 1, out);
    assert.match(out, /MISSING PRECONDITION {2}[.]github\/workflows\/submit-windows-store[.]yml job "submit" channel windows-store\n {4}no step runs: node tooling\/ci\/assert-channel-register[.]mjs --for-submission=windows-store/, out);
  });

  test('🔴 (C-04) the Windows submit job\'s nativeAuth gate without --real-submission grades the commit as a dry run (exit 1)', () => {
    const root = realCopy((r) => mutateFile(r, WIN, WIN_NATIVE_REAL, WIN_NATIVE_REAL.replace(' --real-submission\n', '\n')));
    const { code, out } = preconditions(root);
    assert.equal(code, 1, out);
    assert.match(out, /MASKED PRECONDITION {2}\S+submit-windows-store[.]yml:\d+ job "submit" channel windows-store\n {4}node tooling\/ci\/assert-channel-register[.]mjs[^\n]*\n[\s\S]*REAL SUBMISSION UNMARKED/, out);
  });

  test('🔴 (C-03) the App Store dry run without its iOS device-coverage step is a finding (exit 1)', () => {
    const run = '        run: node tooling/ci/assert-play-device-coverage.mjs --for-submission=ios-appstore\n';
    const root = realCopy((r) => mutateFile(r, APPSTORE, run, ''));
    const { code, out } = preconditions(root);
    assert.equal(code, 1, out);
    assert.match(out, /MISSING PRECONDITION {2}[.]github\/workflows\/submit-appstore[.]yml job "dry-run" channel ios-appstore\n {4}no step runs: node tooling\/ci\/assert-play-device-coverage[.]mjs --for-submission=ios-appstore/, out);
  });

  test('🔴 (C-04) a new submitting native row with no PUBLIC_REACH entry is a finding (exit 1)', () => {
    const root = realCopy((r) =>
      mutateRegister(r, (reg) => {
        const snap = reg.channels.find((c) => c.id === 'linux-snap');
        reg.channels.push({ ...structuredClone(snap), id: 'zz-native-store' });
      }),
    );
    const { code, out } = preconditions(root);
    assert.equal(code, 1, out);
    assert.match(out, /NO PUBLIC REACH {2}zz-native-store\n/, out);
    assert.doesNotMatch(out, /NO PUBLIC REACH {2}linux-snap/, out);
  });
});
