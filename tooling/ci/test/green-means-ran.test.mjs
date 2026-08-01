// ─────────────────────────────────────────────────────────────────────────────
// green-means-ran.test.mjs — assert-green-means-ran.mjs must be able to FAIL.
//
// 🔴 EVERY FIXTURE HERE IS A COPY OF THE REAL WORKFLOWS, MUTATED. Not a
// hand-written miniature. assert-seams-wired.mjs shipped with a check that
// matched a function's own declaration instead of its callers, and ALL SIX of
// its hand-written fixtures passed against the broken version — because a
// fixture you write encodes the same misunderstanding as the guard you wrote.
// So each case below starts from `.github/workflows/` as it actually is, applies
// one edit a person could plausibly make, and asserts the intended message.
//
// The same twelve mutations were first proven against a scratch copy of the real
// tree (restore verified by sha256 fingerprint, baseline green before and after)
// BEFORE this file existed. These tests are the regression net, not the proof.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-green-means-ran.mjs');
const WORKFLOWS = join(REPO, '.github', 'workflows');

let TMP;
let n = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-gmr-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const run = (root) => {
  const r = spawnSync(process.execPath, root === undefined ? [GUARD] : [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

/** A copy of the REAL workflow set, with `edits` applied. Each edit is
 *  [file, from, to]; a `from` that does not match is itself a test failure, so a
 *  fixture cannot silently stop mutating anything. */
function mutant(edits) {
  const root = join(TMP, `m${n++}`);
  cpSync(WORKFLOWS, join(root, '.github', 'workflows'), { recursive: true });
  for (const [file, from, to] of edits) {
    const p = join(root, '.github', 'workflows', file);
    if (to === null) {
      rmSync(p);
      continue;
    }
    const text = readFileSync(p, 'utf8');
    const next = text.replace(from, to);
    assert.notEqual(next, text, `fixture edit did not apply to ${file} — the anchor moved, so this test would prove nothing`);
    writeFileSync(p, next);
  }
  return root;
}

/** A catch is a FAIL line the guard meant to print. A crash is not a catch. */
function caught(res, expected) {
  assert.equal(res.code, 1, `expected exit 1, got ${res.code}\n${res.out}`);
  assert.doesNotMatch(res.out, /\b(SyntaxError|ReferenceError|TypeError|ERR_MODULE_NOT_FOUND)\b/, `the guard crashed rather than reporting:\n${res.out}`);
  assert.match(res.out, expected, `wrong message:\n${res.out}`);
}

describe('assert-green-means-ran.mjs — the real tree', () => {
  test('the repository as committed passes', () => {
    const r = run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ok {2}green means ran/);
  });

  test('an unmutated copy of the real workflows also passes (the fixture base is honest)', () => {
    const r = run(mutant([]));
    assert.equal(r.code, 0, r.out);
    // If the base copy failed, every "caught" below could be catching the copy,
    // not the mutation.
    assert.match(r.out, /2 aggregating job\(s\)/);
  });
});

describe('§A — an aggregating job cannot go green over a lane that did not run', () => {
  test("dropping the 'skipped' clause from ci-gate fails (PR #83's fix, reverted)", () => {
    const root = mutant([['ci.yml', ` || [ "\${{ contains(needs.*.result, 'skipped') }}" = "true" ]`, '']]);
    caught(run(root), /job "ci-gate" never evaluates contains\(needs\.\*\.result, 'skipped'\)/);
  });

  test("dropping 'failure' or 'cancelled' fails too — the set is complete, not just its newest member", () => {
    const a = mutant([['ci.yml', `[ "\${{ contains(needs.*.result, 'failure') }}" = "true" ] || `, '']]);
    caught(run(a), /job "ci-gate" never evaluates contains\(needs\.\*\.result, 'failure'\)/);
    const b = mutant([['build-platforms.yml', ` || [ "\${{ contains(needs.*.result, 'cancelled') }}" = "true" ]`, '']]);
    caught(run(b), /job "all_platforms" never evaluates contains\(needs\.\*\.result, 'cancelled'\)/);
  });

  test('a lane that merely MENTIONS the verdict does not count as testing it', () => {
    const root = mutant([
      [
        'ci.yml',
        `if [ "\${{ contains(needs.*.result, 'failure') }}" = "true" ] || [ "\${{ contains(needs.*.result, 'cancelled') }}" = "true" ] || [ "\${{ contains(needs.*.result, 'skipped') }}" = "true" ]; then`,
        `echo "checking for failure, cancelled and skipped"\n          if false; then`,
      ],
    ]);
    caught(run(root), /never evaluates contains\(needs\.\*\.result, 'failure'\)/);
  });

  test('giving a gate constituent a job-level `if:` fails — that is what makes it report skipped', () => {
    const root = mutant([['ci.yml', '  app_brick:\n    name:', "  app_brick:\n    if: github.event_name != 'pull_request'\n    name:"]]);
    caught(run(root), /lane "app_brick" carries a job-level `if: github\.event_name != 'pull_request'`, and "ci-gate" aggregates it/);
  });

  test('removing `if: always()` from the aggregate fails — a skipped required check satisfies branch protection', () => {
    const root = mutant([['ci.yml', '    if: always()\n    steps:\n      - name: Require all lanes green', '    steps:\n      - name: Require all lanes green']]);
    caught(run(root), /job "ci-gate" has no job-level `if: always\(\)`/);
  });

  test('dropping a lane from `needs` fails — the lane added and forgotten', () => {
    const root = mutant([['ci.yml', 'needs: [subly_api, platform, tokens, site_shared, app_brick, sites, workspace_gate]', 'needs: [subly_api, platform, tokens, site_shared, app_brick, sites]']]);
    caught(run(root), /job "ci-gate" does not `need` "workspace_gate"/);
  });

  test('a `needs` entry naming a job that does not exist fails', () => {
    const root = mutant([['ci.yml', 'needs: [subly_api, platform,', 'needs: [subly_api, platform, ghost_lane,']]);
    caught(run(root), /needs "ghost_lane", which \.github\/workflows\/ci\.yml does not declare/);
  });

  test('detecting the verdicts and exiting 0 anyway fails', () => {
    const root = mutant([['ci.yml', 'never ran — see the verdicts above"; exit 1', 'never ran — see the verdicts above"']]);
    caught(run(root), /job "ci-gate" tests verdicts but never exits non-zero/);
  });

  test('a lane missing from the human-readable echo fails (ci.yml under-reported 6 of 7 for months)', () => {
    const root = mutant([['ci.yml', ' sites=${{ needs.sites.result }}', '']]);
    caught(run(root), /job "ci-gate" never prints needs\.sites\.result/);
  });

  test('renaming the aggregating job is COVERAGE LOST, not a quiet pass', () => {
    const root = mutant([['ci.yml', '  ci-gate:\n    name: ci-gate', '  ci-gate-v2:\n    name: ci-gate']]);
    caught(run(root), /COVERAGE LOST[\s\S]*none of them is "ci-gate"/);
  });

  test('deleting a named aggregator workflow is COVERAGE LOST', () => {
    caught(run(mutant([['ci.yml', null, null]])), /COVERAGE LOST[\s\S]*ci\.yml does not exist/);
  });

  test('a workflow the parser can no longer read is COVERAGE LOST, not zero problems', () => {
    // Top-level keys survive, `jobs:` does not — the shape a stripper bug leaves.
    const root = mutant([['ci.yml', /^jobs:$/m, 'jobz:']]);
    caught(run(root), /COVERAGE LOST[\s\S]*ZERO parsed jobs/);
  });
});

describe('§B — a job cannot green-skip its own body when a secret is absent', () => {
  test('a secret-presence preflight that does not exit non-zero fails', () => {
    const root = mutant([
      [
        'e2e.yml',
        /            echo "::error title=E2E cannot run[\s\S]*?\n            exit 1/,
        '            echo "run=false" >> "$GITHUB_OUTPUT"',
      ],
    ]);
    caught(run(root), /step "pre" branches on whether `KEY` \(a repo secret\) is set, and never exits non-zero/);
  });

  test('the `-n` spelling of the same green-skip is caught too', () => {
    const root = mutant([
      [
        'e2e.yml',
        /          if \[ -z "\$KEY" \]; then[\s\S]*?\n          fi/,
        '          if [ -n "$KEY" ]; then\n            echo "run=true" >> "$GITHUB_OUTPUT"\n          fi',
      ],
    ]);
    caught(run(root), /step "pre" branches on whether `KEY` \(a repo secret\) is set, and never exits non-zero/);
  });

  test('re-gating a real step on the preflight output fails — the exact mechanism that shipped', () => {
    const root = mutant([['e2e.yml', '      - name: Run integration tests (headless Chrome)\n', "      - name: Run integration tests (headless Chrome)\n        if: steps.pre.outputs.run == 'true'\n"]]);
    caught(run(root), /has 1 step\(s\) gated on an output of the secret-presence step "pre"/);
  });

  test('deleting the preflight altogether is COVERAGE LOST — section B would sweep everything and find nothing', () => {
    const root = mutant([['e2e.yml', /      - name: Preflight[\s\S]*?running the live suite\."\n/, '']]);
    caught(run(root), /COVERAGE LOST[\s\S]*e2e\.yml contains no secret-presence check/);
  });

  test('the green-skip is caught wherever it appears, not only in e2e.yml', () => {
    // Same shape, different file: the scan is over every workflow, and the
    // REQUIRED_SECRET_GATES list is a coverage floor, not the scan's scope.
    const root = mutant([
      [
        'ci.yml',
        '  sites:\n    name: Static sites (functions parse + required files)\n    runs-on: ubuntu-24.04\n    steps:\n',
        '  sites:\n    name: Static sites (functions parse + required files)\n    runs-on: ubuntu-24.04\n    steps:\n' +
          '      - name: preflight\n        id: sitespre\n        env:\n          TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}\n' +
          '        run: |\n          if [ -z "$TOKEN" ]; then\n            echo "run=false" >> "$GITHUB_OUTPUT"\n          fi\n',
      ],
    ]);
    caught(run(root), /job "sites", step "sitespre" branches on whether `TOKEN` \(a repo secret\) is set/);
  });

  test('a step that reads a secret WITHOUT branching on its presence is not flagged', () => {
    // The guard must not fire on every secret-using step, or it gets switched
    // off. `Provision throwaway confirmed user` reads two secrets and tests
    // neither for emptiness.
    const r = run(mutant([]));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 secret-presence check\(s\) fail closed/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §C — corpus triage 2026-08-01 (#27). Reproduced on the real tree first: with
// `platforms` emptied in packages/tokens/style-dictionary.config.mjs the build
// emitted zero files, `git diff --exit-code` exited 0, and the lane guarding the
// CSS every site serves went green over a generator that had stopped generating.
// The three mutations below are the ones a person would plausibly make.
describe('§C — a drift check cannot pass by diffing the checkout against itself', () => {
  const RM_STEP =
    '      - name: Delete the artifact so the build has to produce it\n' +
    '        run: rm -f ../../sites/_shared/assets/tokens.css\n';
  const DIFF_STEP =
    '      - name: Site tokens.css must equal a fresh build\n' +
    '        run: git diff --exit-code -- ../../sites/_shared/assets/tokens.css\n';

  test('deleting the `rm` step fails — the "this looks redundant" edit', () => {
    const root = mutant([['ci.yml', RM_STEP, '']]);
    caught(run(root), /job "tokens" diffs `\.\.\/\.\.\/sites\/_shared\/assets\/tokens\.css` against HEAD, but no earlier step in that job deletes it first/);
  });

  test('a `rm` AFTER the diff does not count — present, and proving nothing', () => {
    const root = mutant([['ci.yml', RM_STEP, ''], ['ci.yml', DIFF_STEP, DIFF_STEP + RM_STEP]]);
    caught(run(root), /no earlier step in that job deletes it first/);
  });

  test('removing the drift check itself is COVERAGE LOST, not a clean sweep', () => {
    const root = mutant([['ci.yml', DIFF_STEP, '']]);
    caught(run(root), /COVERAGE LOST[\s\S]*ci\.yml contains no `git diff --exit-code -- <path>` drift check/);
  });

  test('the committed lane satisfies it, and the count is reported', () => {
    const r = run(mutant([]));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 drift check\(s\) delete their artifact before rebuilding it/);
  });
});

describe('the fixture base is real', () => {
  test('the workflow directory this suite copies from actually exists', () => {
    assert.ok(existsSync(WORKFLOWS), `${WORKFLOWS} is missing — every mutation above would be applied to nothing`);
  });
});
