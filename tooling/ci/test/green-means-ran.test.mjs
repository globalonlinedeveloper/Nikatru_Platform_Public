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
import { mkdtempSync, cpSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
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
function caught(res, expected, code = 1) {
  assert.equal(res.code, code, `expected exit ${code}, got ${res.code}\n${res.out}`);
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
    const root = mutant([['ci.yml', '  app-brick:\n    name:', "  app-brick:\n    if: github.event_name != 'pull_request'\n    name:"]]);
    caught(run(root), /lane "app-brick" carries a job-level `if: github\.event_name != 'pull_request'`, and "ci-gate" aggregates it/);
  });

  test('removing `if: always()` from the aggregate fails — a skipped required check satisfies branch protection', () => {
    const root = mutant([['ci.yml', '    if: always()\n    steps:\n      - name: Require all lanes green', '    steps:\n      - name: Require all lanes green']]);
    caught(run(root), /job "ci-gate" has no job-level `if: always\(\)`/);
  });

  test('dropping a lane from `needs` fails — the lane added and forgotten', () => {
    // ⚠️ THIS MUTATION IS A LITERAL OF ci.yml's REAL `needs:` LINE, so it stops
    // being a mutation the moment a lane is added and the line is not updated
    // here — and a no-op mutation passes the guard, which reads as the guard
    // failing rather than as the test rotting. Caught 2026-08-02 when the
    // content_gate lane landed, again 2026-09-23 when android-artifacts
    // landed, and again 2026-09-24 when the extensions call job landed. Keep
    // both halves in step with ci.yml.
    const root = mutant([['ci.yml', '      - extensions\n    if: always()', '    if: always()']]);
    caught(run(root), /job "ci-gate" does not `need` "extensions"/);
  });

  // ⏱ 2026-09-24 — rule A7: a workflow only `workflow_call` can start is gated only
  // through the job that calls it.
  test('deleting the call job fails A7 — the called-only workflow is then called by no gate constituent', () => {
    const root = mutant([
      ['ci.yml', /\n {2}extensions:\n {4}name: extensions\n {4}uses: \.\/\.github\/workflows\/extensions-ci\.yml\n {4}permissions:\n {6}contents: read\n {6}actions: read\n/, '\n'],
      ['ci.yml', '      - extensions\n    if: always()', '    if: always()'],
      ['ci.yml', '          echo "extensions=${{ needs.extensions.result }}"\n', ''],
    ]);
    caught(run(root), /\.github\/workflows\/extensions-ci\.yml can be started only by `workflow_call`, and no constituent of an aggregator/);
  });

  test('a call job ci-gate does not need fails A7 as well as A2 — calling it is not enough', () => {
    const root = mutant([['ci.yml', '      - extensions\n    if: always()', '    if: always()']]);
    caught(run(root), /extensions-ci\.yml can be started only by `workflow_call`, and no constituent of an aggregator/);
  });

  test('a call job with an `if:` fails A6 — a call that skips reports skipped', () => {
    const root = mutant([['ci.yml', '  extensions:\n    name: extensions\n', "  extensions:\n    if: github.event_name == 'pull_request'\n    name: extensions\n"]]);
    caught(run(root), /lane "extensions" carries a job-level `if: github\.event_name == 'pull_request'`, and "ci-gate" aggregates it/);
  });

  test('a call to a callee that is not in the tree is COVERAGE LOST (exit 2), not a finding', () => {
    const root = mutant([['ci.yml', 'uses: ./.github/workflows/extensions-ci.yml', 'uses: ./.github/workflows/extensions-cii.yml']]);
    const r = run(root);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — \.github\/workflows\/ci\.yml job "extensions" calls \.github\/workflows\/extensions-cii\.yml, which this scan cannot follow \(missing\)/);
  });

  test('a `needs` entry naming a job that does not exist fails', () => {
    const root = mutant([['ci.yml', '      - worker-subscriptiontracker-api\n', '      - worker-subscriptiontracker-api\n      - ghost-lane\n']]);
    caught(run(root), /needs "ghost-lane", which \.github\/workflows\/ci\.yml does not declare/);
  });

  test('detecting the verdicts and exiting 0 anyway fails', () => {
    const root = mutant([['ci.yml', 'never ran — see the verdicts above"; exit 1', 'never ran — see the verdicts above"']]);
    caught(run(root), /job "ci-gate" tests verdicts but never exits non-zero/);
  });

  test('a lane missing from the human-readable echo fails (ci.yml under-reported 6 of 7 for months)', () => {
    const root = mutant([['ci.yml', '          echo "sites=${{ needs.sites.result }}"\n', '']]);
    caught(run(root), /job "ci-gate" never prints needs\.sites\.result/);
  });

  test('renaming the aggregating job is COVERAGE LOST, not a quiet pass', () => {
    const root = mutant([['ci.yml', '\n  ci-gate:\n', '\n  ci-gate-v2:\n']]);
    caught(run(root), /COVERAGE LOST[\s\S]*none of them is "ci-gate"/, 2);
  });

  test('deleting a named aggregator workflow is COVERAGE LOST', () => {
    caught(run(mutant([['ci.yml', null, null]])), /COVERAGE LOST[\s\S]*ci\.yml does not exist/, 2);
  });

  test('a workflow the parser can no longer read is COVERAGE LOST, not zero problems', () => {
    // Top-level keys survive, `jobs:` does not — the shape a stripper bug leaves.
    const root = mutant([['ci.yml', /^jobs:$/m, 'jobz:']]);
    caught(run(root), /COVERAGE LOST[\s\S]*ZERO parsed jobs/, 2);
  });
});

describe('§B — a job cannot green-skip its own body when a secret is absent', () => {
  // 🔄 RE-ANCHORED 2026-09-07 ([ADR 067] decision 6, unit `cutover-blockers`).
  // e2e.yml's preflight stopped being a single `-z "$KEY"` when it gained the
  // `auth_target` axis: it now binds SIX secrets (`HOSTED_*` and `BOXA_*`) and
  // tests each of them by name. The GUARD is unchanged and still counts exactly
  // one secret-presence check; only these two fixtures' anchors moved, and an
  // anchor that no longer matches fails loudly inside `mutant()` rather than
  // passing over nothing — which is how this was caught.
  //
  // 🔄 CORRECTED 2026-09-07, second review pass (guard-integrity, refuting).
  // The first re-anchor made this case delete BOTH `exit 1` limbs — the missing
  // secret AND an unknown `auth_target` — which is a mutation nobody would make,
  // and it hid the fact that deleting the missing-secret refusal ALONE left the
  // step green (measured: EXIT 0 on head f045baf9, EXIT 1 for the identical
  // deletion on origin/main c6f80ed4). The root cause was in e2e.yml, not here:
  // the unreachable unknown-target arm has been hoisted into its own step, so
  // the secrets preflight holds exactly ONE `exit` again and this case is back
  // to a SINGLE anchor on the one refusal a person would actually delete.
  //
  // The expected message is matched on its SHAPE rather than on the list of
  // variable names, so adding or renaming a resolved secret cannot turn a real
  // catch into a fixture edit.
  const NEVER_EXITS = /step "pre" branches on whether .*\(a repo secret\) is set, and never exits non-zero/;

  test('a secret-presence preflight that does not exit non-zero fails', () => {
    // ONE edit, and it is the missing-secret refusal — replaced by the same
    // green-skip shape every other §B case uses. If step `pre` ever regains a
    // second `exit` on another branch, this case goes green over a deleted
    // refusal, which is exactly the regression being locked out.
    const root = mutant([
      [
        'e2e.yml',
        /            echo "::error title=E2E cannot run::[^\n]*this is a failed run, not a skipped one[^\n]*\n            exit 1/,
        '            echo "run=false" >> "$GITHUB_OUTPUT"',
      ],
    ]);
    caught(run(root), NEVER_EXITS);
  });

  test('the `-n` spelling of the same green-skip is caught too', () => {
    // The whole resolution body is replaced by the smallest `-n` green-skip, so
    // the only emptiness test left in the step is the inverted one. Anchored
    // from `missing=''` rather than from `set -uo pipefail`: the latter is now
    // the first line of the auth_target step too, and a non-greedy match from
    // there would swallow that step and `pre`'s own header.
    const root = mutant([
      [
        'e2e.yml',
        /          missing=''\n[\s\S]*?\n          echo "Auth target: [^\n]*\n/,
        '          if [ -n "$HOSTED_KEY" ]; then\n            echo "run=true" >> "$GITHUB_OUTPUT"\n          fi\n',
      ],
    ]);
    caught(run(root), NEVER_EXITS);
  });

  test('re-gating a real step on the preflight output fails — the exact mechanism that shipped', () => {
    const root = mutant([['e2e.yml', '      - name: Run integration tests (headless Chrome)\n', "      - name: Run integration tests (headless Chrome)\n        if: steps.pre.outputs.run == 'true'\n"]]);
    caught(run(root), /has 1 step\(s\) gated on an output of the secret-presence step "pre"/);
  });

  test('deleting the preflight altogether is COVERAGE LOST — section B would sweep everything and find nothing', () => {
    const root = mutant([['e2e.yml', /      - name: Preflight[\s\S]*?running the live suite\."\n/, '']]);
    caught(run(root), /COVERAGE LOST[\s\S]*e2e\.yml contains no secret-presence check/, 2);
  });

  test('the green-skip is caught wherever it appears, not only in e2e.yml', () => {
    // Same shape, different file: the scan is over every workflow, and the
    // REQUIRED_SECRET_GATES list is a coverage floor, not the scan's scope.
    // ⚠️ THE ANCHOR MATCHES THE `sites:` JOB'S `steps:` LINE THROUGH WHATEVER
    // JOB-LEVEL KEYS SIT ABOVE IT, rather than spelling that block out. It used
    // to be the literal `  sites:\n    name: …\n    runs-on: ubuntu-24.04\n
    // steps:\n`, which meant ANY unrelated key added to that job broke it — and
    // on 2026-08-17 one was (`timeout-minutes: 10`), turning this test red for a
    // reason that had nothing to do with the green-skip it exists to catch. The
    // `mutant` helper correctly refused to pass over an edit that did not apply,
    // so the failure was loud rather than silent; this keeps that property while
    // removing the coupling to the job's exact key list.
    const root = mutant([
      [
        'ci.yml',
        /( {2}sites:\n(?: {4}(?!steps:)\S[^\n]*\n)* {4}steps:\n)/,
        '$1      - name: preflight\n        id: sitespre\n        env:\n          TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}\n' +
          '        run: |\n          if [ -z "$TOKEN" ]; then\n            echo "run=false" >> "$GITHUB_OUTPUT"\n          fi\n',
      ],
    ]);
    caught(run(root), /job "sites", step "sitespre" branches on whether `TOKEN` \(a repo secret\) is set/);
  });

  test('a step that reads a secret WITHOUT branching on its presence is not flagged', () => {
    // The guard must not fire on every secret-using step, or it gets switched
    // off. `Provision throwaway confirmed user` reads two secrets and tests
    // neither for emptiness.
    //
    // ⏱ APPENDED 2026-09-07 — the paragraph above is left exactly as written.
    // This case ASSERTED THE LITERAL `1 secret-presence check(s)`, which is a
    // hand-kept count of the real tree wearing the costume of a property test:
    // it went red the moment a fourth store lane grew a preflight (6 today), and
    // the cheap repair — bump the 1 — would have re-armed the same trap for the
    // next writer.
    //
    // ⏱ SUPERSEDED 2026-09-07 (second pass, review finding F1). The first repair
    // was WORSE than the number it removed: `assert.ok(reported * 3 < namesASecret)`
    // against 228 secret references passes for ANY reported value from 1 to 75 —
    // a 12.7x headroom over today's 6 — so the very regression this case is named
    // for (the detector starting to count a step that tests nothing: 6 -> 7) was
    // undetectable by it. A regression net turned into an inequality is a
    // weakened guard test.
    //
    // What replaces it is the shape this file already uses everywhere else and
    // pins NO number: two MUTATIONS of the real workflow set, read as a DELTA
    // against the same base.
    //   · a step that reads a secret and never tests it  -> the count is UNCHANGED
    //   · a step that reads a secret and DOES test it    -> the count is +1 exactly
    // Both are measured against the unmutated copy in the same run, so the pair
    // stays true at 6, at 60, and on a tree neither number describes.
    const base = run(mutant([]));
    assert.equal(base.code, 0, base.out);
    const reportedIn = (r) => {
      const m = r.out.match(/(\d+) secret-presence check\(s\) fail closed/);
      assert.ok(m !== null, `the guard printed no presence-check tally at all:\n${r.out}`);
      return Number(m[1]);
    };
    const baseline = reportedIn(base);
    assert.ok(baseline >= 1, `the detector found no presence check at all: ${base.out}`);

    // The step bullet anchor is the one §B already uses: the `sites:` job's keys,
    // whatever they are, followed by `steps:`. See the case above for why it is
    // written this way and not as a verbatim block.
    const SITES_STEPS = /( {2}sites:\n(?: {4}(?!steps:)\S[^\n]*\n)* {4}steps:\n)/;

    // MUTATION 1 — reads a secret, tests NOTHING. The detector must not see it.
    const silent = run(
      mutant([
        [
          'ci.yml',
          SITES_STEPS,
          '$1      - name: reads a secret and never tests it\n        env:\n          TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}\n' +
            '        run: |\n          printf %s "$TOKEN" | wc -c\n',
        ],
      ]),
    );
    assert.equal(silent.code, 0, silent.out);
    assert.equal(
      reportedIn(silent),
      baseline,
      `a step that reads a secret and never tests it for emptiness moved the tally from ${baseline} to ${reportedIn(silent)}. ` +
        'The detector is firing on secret USE rather than on a presence BRANCH, which is how a guard that flags every ' +
        `step gets switched off:\n${silent.out}`,
    );

    // MUTATION 2 — reads a secret and DOES branch on its emptiness, exiting
    // non-zero (B1's requirement) and gating nothing else (B2's). Exactly one
    // more, so the detector is proven to be selective rather than merely quiet.
    const branching = run(
      mutant([
        [
          'ci.yml',
          SITES_STEPS,
          '$1      - name: reads a secret and fails closed on it\n        env:\n          TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}\n' +
            '        run: |\n          if [ -z "$TOKEN" ]; then\n            echo "TOKEN is empty"\n            exit 1\n          fi\n',
        ],
      ]),
    );
    assert.equal(branching.code, 0, branching.out);
    assert.equal(
      reportedIn(branching),
      baseline + 1,
      `a step that branches on \`-z "$TOKEN"\` and exits 1 moved the tally from ${baseline} to ${reportedIn(branching)}; ` +
        `it must be exactly ${baseline + 1}. A detector that misses this one has stopped detecting the shape ` +
        `assert-green-means-ran exists for:\n${branching.out}`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §C — corpus triage 2026-08-01 (#27). Reproduced on the real tree first: with
// `platforms` emptied in packages/tokens/style-dictionary.config.mjs the build
// emitted zero files, `git diff --exit-code` exited 0, and the lane guarding the
// CSS every site serves went green over a generator that had stopped generating.
// The three mutations below are the ones a person would plausibly make.
describe('§C — a drift check cannot pass by diffing the checkout against itself', () => {
  /* 🔴 DERIVED FROM ci.yml, NOT TRANSCRIBED FROM IT — CORRECTED 2026-09-05, THE
     THIRD TIME THIS SUITE HAS BEEN MADE STALE BY A CORRECT CHANGE TO THE
     WORKFLOW. Both anchors were full step blocks copied verbatim:

       '      - name: Delete the artifact so the build has to produce it\n' +
       '        run: rm -f ../../sites/_shared/assets/tokens.css\n'
       '      - name: Site tokens.css must equal a fresh build\n' +
       '        run: git diff --exit-code -- ../../sites/_shared/assets/tokens.css\n'

     [ADR 067] decision 1 gave packages/tokens two more outputs, so the lane now
     deletes three artefacts in one `run:` block and diffs three paths on one
     line — and both transcriptions stopped matching. `mutant()` refuses an edit
     that does not apply, so the two cases below failed with "the anchor moved"
     rather than reporting anything about the guard. The comments further down
     record the same rot arriving twice through the COUNT and once through the
     FILE SET; this is it arriving through the step TEXT, and the fix is the same
     one: read the workflow.

     The anchors are the two LINES that name the site tokens artefact — the one
     that deletes it and the one that diffs it — because those are what the
     guard pairs, and a step's `name:` is prose the guard never reads. */
  const CI_YML = readFileSync(join(WORKFLOWS, 'ci.yml'), 'utf8');
  const TOKENS_ARTIFACT = '../../sites/_shared/assets/tokens.css';
  const ciLine = (predicate, what) => {
    const hit = CI_YML.split(String.fromCharCode(10)).find(predicate);
    assert.ok(hit, `ci.yml no longer holds ${what} — this suite cannot mutate what it cannot find`);
    return `${hit}\n`;
  };
  const RM_STEP = ciLine(
    (l) => /^\s*rm -f\s/.test(l) && l.includes(TOKENS_ARTIFACT),
    `an \`rm -f\` of ${TOKENS_ARTIFACT}`,
  );
  const DIFF_STEP = ciLine(
    (l) => l.includes('git diff --exit-code --') && l.includes(TOKENS_ARTIFACT),
    `a drift check over ${TOKENS_ARTIFACT}`,
  );

  test('deleting the `rm` step fails — the "this looks redundant" edit', () => {
    const root = mutant([['ci.yml', RM_STEP, '']]);
    caught(run(root), /job "site-tokens" diffs `\.\.\/\.\.\/sites\/_shared\/assets\/tokens\.css` against HEAD, but no earlier step in that job deletes it first/);
  });

  test('a `rm` AFTER the diff does not count — present, and proving nothing', () => {
    const root = mutant([['ci.yml', RM_STEP, ''], ['ci.yml', DIFF_STEP, DIFF_STEP + RM_STEP]]);
    caught(run(root), /no earlier step in that job deletes it first/);
  });

  test('removing the drift check itself is COVERAGE LOST, not a clean sweep', () => {
    // 🔴 EVERY drift lane must go, and they are found rather than named. The
    // guard's REQUIRED_DRIFT_CHECKS asks whether ci.yml contains ANY drift check,
    // so leaving one behind proves nothing — the case then passes because the
    // guard is right, not because the mutation worked.
    //
    // This line has now rotted TWICE by the same mechanism. It named one lane
    // until 2026-08-17, when the site feed's lane made that wrong; it was changed
    // to name two, and the render payload's lane made THAT wrong the next day. A
    // list of literals in a test is a second copy of the workflow, and this file
    // exists to catch exactly that shape one level up. So: strip every line
    // matching the guard's own pattern, and assert the strip actually removed as
    // many as the workflow contains.
    const CI = readFileSync(join(WORKFLOWS, 'ci.yml'), 'utf8');
    const laneLines = CI.split(String.fromCharCode(10)).filter((l) => l.includes('git diff --exit-code --'));
    assert.ok(laneLines.length >= 1, 'no drift lane found in ci.yml — this case would prove nothing');
    const root = mutant(laneLines.map((l) => ['ci.yml', l, '']));
    caught(run(root), /COVERAGE LOST[\s\S]*ci\.yml contains no `git diff --exit-code -- <path>` drift check/, 2);
  });

  test('the committed lane satisfies it, and the count is reported', () => {
    const r = run(mutant([]));
    assert.equal(r.code, 0, r.out);
    // 🔴 DERIVED, NOT HARDCODED. This read `1 drift check(s)` until 2026-08-17 and
    // went red the moment a SECOND legitimate drift lane was added for the site
    // feed — a test made stale by a correct change, which is the drift class this
    // whole suite exists to catch, one level up. Count the lanes in the real
    // workflow and assert the guard reports that many.
    // 🔴 EVERY WORKFLOW, NOT JUST ci.yml — CORRECTED 2026-09-05 FOR THE SECOND
    // TIME THIS ASSERTION HAS BEEN MADE STALE BY A CORRECT CHANGE. The guard's
    // subject is the whole workflow directory; this count read ci.yml alone, so
    // the moment `.github/workflows/extensions.yml` arrived with its own
    // catalogue drift lane ([ADR 067] decision 1) the derived 3 no longer
    // described the guard's 4. That is the same one-level-up drift the comment
    // above records for the site feed, arriving through the FILE SET this time
    // instead of through the count — so the fix is to derive the file set too.
    const laneCount = readdirSync(WORKFLOWS)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .reduce((n, f) => n + (readFileSync(join(WORKFLOWS, f), 'utf8').match(/git diff --exit-code --/g) ?? []).length, 0);
    assert.ok(laneCount >= 1, `expected at least one drift lane under .github/workflows, found ${laneCount}`);
    // A plain substring, not a RegExp. The first version built the pattern with
    // `new RegExp(...)`, where the `(s)` in "drift check(s)" became a CAPTURE
    // GROUP instead of two literal parens — so the assertion could never match,
    // however right the count was. An escaping bug in a test reads exactly like a
    // real failure and costs the same time to diagnose.
    assert.ok(
      r.out.includes(`${laneCount} drift check(s) delete their artifact before rebuilding it`),
      `guard did not report ${laneCount} drift check(s). Output:\n${r.out}`,
    );
  });
});

describe('the fixture base is real', () => {
  test('the workflow directory this suite copies from actually exists', () => {
    assert.ok(existsSync(WORKFLOWS), `${WORKFLOWS} is missing — every mutation above would be applied to nothing`);
  });
});
