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

  test('COVERAGE LOST: a channel the table names that the register does not declare', () => {
    const root = realCopy((r) => mutateRegister(r, (reg) => {
      reg.channels = reg.channels.filter((c) => c.id !== 'android-play');
    }));
    const { code, out } = preconditions(root);
    assert.equal(code, 2, out);
    assert.match(out, /applies tooling\/ci\/assert-play-device-coverage[.]mjs to channel "android-play", which tooling\/channel-register[.]json does not declare/, out);
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

/** The IAP reader and the two modules it imports, copied beside an empty tree;
 *  `edit` rewrites submit-preconditions.mjs's text. The refusal runs before any
 *  read, so the reader needs nothing else to reach it. */
function iapCopy(edit) {
  const root = join(TMP, `iap${seq++}`);
  mkdirSync(join(root, 'tooling', 'ci'), { recursive: true });
  for (const f of ['assert-iap-review-screenshots.mjs', 'tree-walk.mjs']) cpSync(join(REPO, 'tooling', 'ci', f), join(root, 'tooling', 'ci', f));
  const table = readFileSync(join(REPO, 'tooling', 'ci', 'submit-preconditions.mjs'), 'utf8');
  writeFileSync(join(root, 'tooling', 'ci', 'submit-preconditions.mjs'), edit(table));
  return root;
}
