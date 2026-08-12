// ─────────────────────────────────────────────────────────────────────────────
// safe-rerun.test.mjs — the refusal that stops `gh run rerun <old-id>` from
// cancelling the live run for the branch's HEAD.
//
// 🔴 THE DEFECT THIS ENCODES HAPPENED ON 2026-08-12, IN THIS REPOSITORY.
// `ci.yml` keys its concurrency group on `github.ref`, not on the SHA, with
// `cancel-in-progress: true`. Re-running the flake for `6559d6e` — an OLDER
// commit on main — therefore evicted the in-flight run for `eff4fc2`, main's
// actual HEAD. `ci-gate` for eff4fc2 never reported (not "failed" — NEVER), so
// `deploy-workers.yml` polled for a verdict that could not arrive and failed
// closed. One harmless-looking re-run, two red lanes, one of them a deploy.
//
// ⚠️ WHAT THESE CASES ARE REALLY FOR — TWO THINGS, AND THE SECOND IS THE ONE
// THAT WOULD OTHERWISE ROT:
//
//   1. THE REFUSAL MUST ACTUALLY REFUSE. The exit code is NOT sufficient
//      evidence: a version that printed the refusal loudly and then POSTed the
//      re-run anyway would satisfy `assert.equal(code, 1)` perfectly. So the
//      fixture transport writes a line to $SAFE_RERUN_FIXTURE_LOG whenever a
//      re-run is requested, and the refusal cases assert THE FILE DOES NOT
//      EXIST. Absence of the log is the claim; the exit code is a detail.
//
//   2. THE GROUP MUST BE DERIVED FROM THE YAML, NOT HARDCODED. A `'ci-'`
//      literal would pass every refusal case here while being wrong about every
//      neighbouring lane. Two cases pin it from opposite sides:
//        · MUTATION — the same incident fixture, pointed at a workflows
//          directory whose `ci.yml` carries NO `concurrency:` block, must FLIP
//          to allow. A hardcoded prefix cannot flip.
//        · CROSS-WORKFLOW — two DIFFERENT workflows that resolve to the SAME
//          group string must collide, because GitHub's groups are
//          repository-wide. A "same workflow?" test cannot see that.
//
// ⚠️ NOTHING HERE TOUCHES THE NETWORK OR GITHUB. Every CLI case runs through the
// fixture transport, which has no `fetch` in it at all — so a wrong fixture can
// never cancel a real run. The two live-shaped cases assert only the "I could
// not look" exits, driven by withholding the credential.
//
// 🔴 THE POSITIVE CONTROL AGAINST THE REAL TREE IS NOT DECORATION. Without
// `parseWorkflow` being pinned to the actual `.github/workflows/*.yml`, every
// negative result in this file is equally consistent with a parser that returns
// `declared:false` for everything — which would report "nothing to refuse" on a
// repository with four concurrency blocks in it.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseWorkflow,
  loadWorkflows,
  coverageProblem,
  namedLaneProblem,
  refOf,
  expandGroup,
  groupOf,
  decide,
  parseArgs,
  fromVault,
  LIVE_STATUSES,
} from '../../ops/safe-rerun.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const SCRIPT = join(REPO, 'tooling', 'ops', 'safe-rerun.mjs');
const REAL_WORKFLOWS = join(REPO, '.github', 'workflows');

const OLD = '6559d6e0000000000000000000000000000000aa';
const HEAD = 'eff4fc20000000000000000000000000000000bb';

const temps = [];
function temp() {
  const d = mkdtempSync(join(tmpdir(), 'safe-rerun-'));
  temps.push(d);
  return d;
}
after(() => {
  for (const d of temps) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* a leaked temp dir must never fail a suite */
    }
  }
});

/** Run the CLI with an environment built FROM SCRATCH.
 *
 *  🔴 NOT INHERITED, and that is a correctness fix rather than tidiness. The
 *  script falls back to the local vault for its token, so a case that merely
 *  omitted GH_TOKEN would mean "no credential" on a CI runner (no `.claude/`)
 *  and "a real credential, contact GitHub" on the owner's laptop. Every case
 *  below SETS what it wants. `NIKATRU_VAULT` is pointed at an absent file for
 *  the same reason. */
function run(args, env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      NIKATRU_VAULT: join(REPO, 'no', 'such', 'vault.env'),
      GH_TOKEN: '',
      GITHUB_TOKEN: '',
      ...env,
    },
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const mkRun = (over = {}) => ({
  id: 16000000001,
  name: 'CI',
  path: '.github/workflows/ci.yml',
  event: 'push',
  status: 'completed',
  head_branch: 'main',
  head_sha: OLD,
  ...over,
});

/** Write a fixture + log path, run the CLI, and report whether a re-run was
 *  actually requested. The log's ABSENCE is the evidence in every refusal case. */
function cli(fixture, args = [], env = {}) {
  const dir = temp();
  const fx = join(dir, 'fixture.json');
  const log = join(dir, 'rerun.log');
  writeFileSync(fx, JSON.stringify(fixture, null, 2));
  const r = run(args, { SAFE_RERUN_FIXTURE: fx, SAFE_RERUN_FIXTURE_LOG: log, ...env });
  return {
    ...r,
    reran: existsSync(log),
    log: existsSync(log) ? readFileSync(log, 'utf8') : '',
  };
}

/** The 2026-08-12 incident, as data. */
const incident = (over = {}) => ({
  repo: 'globalonlinedeveloper/Project_Cross_Platform_Apps',
  runs: { 16000000001: mkRun(over.target) },
  branchHeads: { main: HEAD },
  runsByBranch: {
    main: [
      {
        id: 16000000002,
        name: 'CI',
        path: '.github/workflows/ci.yml',
        event: 'push',
        status: 'in_progress',
        head_branch: 'main',
        head_sha: HEAD,
      },
    ],
  },
  ...over.top,
});

/** A workflows directory with exactly the blocks a case needs. */
function workflowsDir(files) {
  const d = temp();
  mkdirSync(d, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(d, name), body);
  return d;
}

const CANCELLING = (group) => `name: Fixture\non:\n  push:\n\nconcurrency:\n  group: ${group}\n  cancel-in-progress: true\n\njobs:\n  a:\n    runs-on: ubuntu-24.04\n`;

// ═══════════════════════════════════════════════════════════════════════════
describe('the CLI — the whole point, end to end through main()', () => {
  test('🔴 REFUSES an old-SHA re-run when a run is LIVE in the same group', () => {
    // THE RECORDED FAILING CASE. This is the 2026-08-12 incident replayed:
    // run at 6559d6e on main, main's tip is eff4fc2, and eff4fc2's CI run is
    // in_progress in `ci-refs/heads/main`.
    const r = cli(incident(), ['16000000001']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /REFUSED/);
    assert.match(r.out, /ci-refs\/heads\/main/);
    assert.match(r.out, /16000000002 \(in_progress\)/);
    // 🔴 THE ASSERTION THAT ACTUALLY MATTERS. Exit 1 alone would also be
    // produced by a version that refused loudly and re-ran anyway.
    assert.equal(r.reran, false, `it REFUSED and re-ran anyway: ${r.log}`);
  });

  test('ALLOWS an old-SHA re-run when NOTHING is live in the group', () => {
    // Condition (b) absent. There is nothing to evict, so refusing would be
    // pure obstruction — and a guard that fires when it need not gets disabled.
    const fx = incident();
    fx.runsByBranch.main = [];
    const r = cli(fx, ['16000000001']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /NOTHING is live in group/);
    assert.equal(r.reran, true, 'it allowed the re-run but never requested it');
  });

  test('ALLOWS a re-run of the branch HEAD even with a live run in the group', () => {
    // Condition (a) absent. Whatever this evicts is another attempt at the same
    // commit, which is exactly what someone re-running HEAD is asking for.
    const fx = incident({ target: { head_sha: HEAD } });
    const r = cli(fx, ['16000000001']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /IS the current HEAD/);
    assert.equal(r.reran, true);
  });

  test('ALLOWS a workflow that declares NO concurrency block at all', () => {
    // Against the REAL tree: `deploy-web.yml` genuinely has no `concurrency:`,
    // so its runs can never collide. A hardcoded group would have had to invent
    // an answer here.
    const fx = incident();
    fx.runs['16000000001'].path = '.github/workflows/deploy-web.yml';
    fx.runs['16000000001'].name = 'Deploy Web';
    fx.runsByBranch.main[0].path = '.github/workflows/deploy-web.yml';
    const r = cli(fx, ['16000000001']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /declares no top-level `concurrency:`/);
    assert.equal(r.reran, true);
  });

  test('ALLOWS a workflow whose group sets cancel-in-progress: FALSE', () => {
    // `deploy-workers.yml`, from the real tree. A re-run QUEUES behind the live
    // run rather than evicting it, so there is nothing to refuse.
    const fx = incident();
    for (const r_ of [fx.runs['16000000001'], fx.runsByBranch.main[0]]) {
      r_.path = '.github/workflows/deploy-workers.yml';
      r_.name = 'Deploy Workers';
    }
    const r = cli(fx, ['16000000001']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /cancel-in-progress: false/);
    assert.equal(r.reran, true);
  });

  test('--dry-run never requests a re-run, even when allowed', () => {
    const fx = incident();
    fx.runsByBranch.main = [];
    const r = cli(fx, ['16000000001', '--dry-run']);
    assert.equal(r.code, 0, r.out);
    assert.equal(r.reran, false, '--dry-run requested a re-run');
  });

  test('--failed is NOT a safe harbour — a partial re-run is refused too', () => {
    // `rerun-failed-jobs` enters the SAME concurrency group and evicts just as
    // hard. Treating it as harmless would reopen the whole hole.
    const r = cli(incident(), ['16000000001', '--failed']);
    assert.equal(r.code, 1, r.out);
    assert.equal(r.reran, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🔴 the group is DERIVED from the YAML — the two cases a hardcoded `ci-` fails', () => {
  test('MUTATION — strip ci.yml\'s concurrency block and the SAME fixture flips to ALLOW', () => {
    // If the refusal came from a literal prefix rather than from the file, this
    // would still refuse. It is the mutation that proves the derivation is real.
    const dir = workflowsDir({
      'ci.yml': 'name: CI\non:\n  push:\n\njobs:\n  a:\n    runs-on: ubuntu-24.04\n',
      // present only so the coverage self-check (below) is not the thing failing
      'keeper.yml': CANCELLING('keeper-${{ github.ref }}'),
    });
    const r = cli(incident(), ['16000000001', '--workflows', dir]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /declares no top-level `concurrency:`/);
    assert.equal(r.reran, true);
  });

  test('CROSS-WORKFLOW — two DIFFERENT workflows sharing one group string DO collide', () => {
    // GitHub's concurrency groups are repository-wide. A check that asked "same
    // workflow?" instead of "same resolved group?" would allow this, and the
    // eviction would happen anyway.
    const dir = workflowsDir({
      'alpha.yml': CANCELLING('shared-${{ github.ref }}'),
      'beta.yml': CANCELLING('shared-${{ github.ref }}'),
    });
    const fx = incident();
    fx.runs['16000000001'].path = '.github/workflows/alpha.yml';
    fx.runsByBranch.main[0].path = '.github/workflows/beta.yml';
    const r = cli(fx, ['16000000001', '--workflows', dir]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /shared-refs\/heads\/main/);
    assert.equal(r.reran, false);
  });

  test('a live run in a DIFFERENT group is not a collision', () => {
    // The other direction. Without this, "refuses whenever anything is live"
    // would pass the case above and be useless.
    const dir = workflowsDir({
      'alpha.yml': CANCELLING('alpha-${{ github.ref }}'),
      'beta.yml': CANCELLING('beta-${{ github.ref }}'),
    });
    const fx = incident();
    fx.runs['16000000001'].path = '.github/workflows/alpha.yml';
    fx.runsByBranch.main[0].path = '.github/workflows/beta.yml';
    const r = cli(fx, ['16000000001', '--workflows', dir]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /NOTHING is live in group/);
    assert.equal(r.reran, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('COVERAGE LOST — the scan must go loud when it reaches nothing', () => {
  test('🔴 no workflows parsed at all is exit 2, never an allow', () => {
    // The failure this repository keeps hitting: a scan that reads nothing and
    // reports the same thing as a scan that read everything and found no
    // problem. Here it would green-light every re-run there is.
    const empty = workflowsDir({});
    const r = cli(incident(), ['16000000001', '--workflows', empty]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /read NOTHING/);
    assert.equal(r.reran, false);
  });

  test('workflows present but NOT ONE declares concurrency is exit 2', () => {
    // The parser going blind looks exactly like "nothing to refuse".
    const dir = workflowsDir({
      'a.yml': 'name: A\non:\n  push:\n\njobs:\n  a:\n    runs-on: ubuntu-24.04\n',
      'b.yml': 'name: B\non:\n  push:\n\njobs:\n  b:\n    runs-on: ubuntu-24.04\n',
    });
    const r = cli(incident(), ['16000000001', '--workflows', dir]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /NOT ONE declares/);
    assert.equal(r.reran, false);
  });

  test('coverageProblem is null on the REAL tree — the positive control', () => {
    // Without this, every COVERAGE LOST case above is consistent with a checker
    // that always reports coverage lost.
    assert.equal(coverageProblem(loadWorkflows(REAL_WORKFLOWS)), null);
  });

  test('namedLaneProblem fires when ci.yml is gone, unconcurrent, or non-cancelling', () => {
    // The named floor, exercised directly. Its failing inputs cannot be reached
    // through the CLI (pointing --workflows elsewhere deliberately relaxes it),
    // so they are driven here rather than left as an assertion nobody has run.
    const wf = (over) =>
      new Map([['.github/workflows/ci.yml', { file: 'ci.yml', name: 'CI', declared: true, group: 'ci-x', cancelInProgress: true, ...over }]]);
    assert.equal(namedLaneProblem(wf()), null);
    assert.match(namedLaneProblem(new Map()), /not in the parsed set/);
    assert.match(namedLaneProblem(wf({ declared: false, group: null })), /no longer declares/);
    assert.match(namedLaneProblem(wf({ cancelInProgress: false })), /not true/);
  });

  test('namedLaneProblem is null on the REAL tree — ci.yml is still the subject', () => {
    assert.equal(namedLaneProblem(loadWorkflows(REAL_WORKFLOWS)), null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the workflow parse — pinned to the REAL files, not to a fixture of them', () => {
  const real = loadWorkflows(REAL_WORKFLOWS);

  test('ci.yml IS ref-keyed and cancelling — the hazard, measured', () => {
    const ci = real.get('.github/workflows/ci.yml');
    assert.ok(ci, 'ci.yml did not parse');
    assert.equal(ci.declared, true);
    assert.equal(ci.group, 'ci-${{ github.ref }}');
    assert.equal(ci.cancelInProgress, true);
  });

  test('deploy-workers.yml is grouped but NOT cancelling', () => {
    const w = real.get('.github/workflows/deploy-workers.yml');
    assert.ok(w);
    assert.equal(w.group, 'deploy-workers');
    assert.equal(w.cancelInProgress, false);
  });

  test('deploy-web.yml declares no concurrency at all', () => {
    const w = real.get('.github/workflows/deploy-web.yml');
    assert.ok(w);
    assert.equal(w.declared, false);
  });

  test('🔴 a `concurrency` mentioned only in a COMMENT is not a declaration', () => {
    // Assert on structure, never by grepping prose. `ci.yml` is more comment
    // than YAML and this exact word appears in explanatory blocks; a grep would
    // match the paragraph describing a group and keep passing after the real
    // one was deleted.
    const w = parseWorkflow(
      'name: X\n# concurrency:\n#   group: ci-${{ github.ref }}\n#   cancel-in-progress: true\non:\n  push:\n',
    );
    assert.equal(w.declared, false);
  });

  test('JOB-level concurrency is not read as the workflow\'s group', () => {
    // It is indented, it governs one job, and attributing it to the workflow
    // would put runs in a group they never enter.
    const w = parseWorkflow(
      'name: X\non:\n  push:\njobs:\n  a:\n    concurrency:\n      group: job-${{ github.ref }}\n      cancel-in-progress: true\n',
    );
    assert.equal(w.declared, false);
  });

  test('the scalar form `concurrency: g` is a group with cancel-in-progress FALSE', () => {
    const w = parseWorkflow('name: X\nconcurrency: plain-group\non:\n  push:\n');
    assert.equal(w.declared, true);
    assert.equal(w.group, 'plain-group');
    assert.equal(w.cancelInProgress, false);
  });

  test('quoted group and quoted boolean parse', () => {
    const w = parseWorkflow(
      'name: X\nconcurrency:\n  group: "ci-${{ github.ref }}"\n  cancel-in-progress: \'true\'\n',
    );
    assert.equal(w.group, 'ci-${{ github.ref }}');
    assert.equal(w.cancelInProgress, true);
  });

  test('🔴 an EXPRESSION cancel-in-progress is assumed to CANCEL', () => {
    // The two ways of being wrong are not symmetric: guessing "cancels" costs a
    // re-typed command, guessing "does not" costs the deploy.
    const w = parseWorkflow(
      "name: X\nconcurrency:\n  group: g-${{ github.ref }}\n  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}\n",
    );
    assert.equal(w.cancelInProgress, true);
    assert.equal(w.cancelIsExpression, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('ref and group resolution', () => {
  test('a push run resolves to refs/heads/<branch>', () => {
    assert.equal(refOf(mkRun()), 'refs/heads/main');
  });

  test('a pull_request run resolves to refs/pull/<n>/merge', () => {
    // Measured against a real run on 2026-08-12: run 31592105575 resolved to
    // `ci-refs/pull/308/merge`. A PR run and a push run for the SAME commit sit
    // in different groups and do not evict each other.
    assert.equal(
      refOf(mkRun({ event: 'pull_request', pull_requests: [{ number: 308 }] })),
      'refs/pull/308/merge',
    );
  });

  test('a pull_request run with no PR number resolves to NOTHING, not a guess', () => {
    assert.equal(refOf(mkRun({ event: 'pull_request', pull_requests: [] })), null);
  });

  test('expandGroup substitutes github.ref and reports what it could not', () => {
    const ctx = { 'github.ref': 'refs/heads/main' };
    assert.deepEqual(expandGroup('ci-${{ github.ref }}', ctx), {
      value: 'ci-refs/heads/main',
      unresolved: [],
    });
    assert.deepEqual(expandGroup('ci-${{ github.actor }}', ctx).unresolved, ['github.actor']);
  });

  test('🔴 an UNRESOLVED expression is exit 2, never pasted through as a literal', () => {
    // A template silently treated as a literal compares equal to itself for
    // every run — which makes two unrelated runs look like a collision, and two
    // colliding runs look unrelated. Both directions are wrong.
    const dir = workflowsDir({ 'alpha.yml': CANCELLING('a-${{ github.actor }}') });
    const fx = incident();
    fx.runs['16000000001'].path = '.github/workflows/alpha.yml';
    fx.runsByBranch.main[0].path = '.github/workflows/alpha.yml';
    const r = cli(fx, ['16000000001', '--workflows', dir]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /I COULD NOT LOOK/);
    assert.equal(r.reran, false);
  });

  test('a run whose workflow file is not in this tree is exit 2, not an allow', () => {
    const fx = incident();
    fx.runs['16000000001'].path = '.github/workflows/deleted-long-ago.yml';
    const r = cli(fx, ['16000000001']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /not in the parsed set/);
    assert.equal(r.reran, false);
  });

  test('groupOf resolves the real ci.yml declaration for a real-shaped run', () => {
    const g = groupOf(mkRun(), loadWorkflows(REAL_WORKFLOWS), 'owner/name');
    assert.equal(g.group, 'ci-refs/heads/main');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('decide() — the judgement, without a network or a token', () => {
  const workflows = loadWorkflows(REAL_WORKFLOWS);
  const liveSibling = (over = {}) => ({
    id: 16000000002,
    path: '.github/workflows/ci.yml',
    event: 'push',
    status: 'in_progress',
    head_branch: 'main',
    head_sha: HEAD,
    ...over,
  });

  test('both conditions → refuse', () => {
    const v = decide({ run: mkRun(), branchHeadSha: HEAD, workflows, siblings: [liveSibling()] });
    assert.equal(v.code, 1);
    assert.equal(v.verdict, 'refuse');
    assert.equal(v.colliding.length, 1);
  });

  test('a COMPLETED sibling holds no group — allow', () => {
    const v = decide({
      run: mkRun(),
      branchHeadSha: HEAD,
      workflows,
      siblings: [liveSibling({ status: 'completed' })],
    });
    assert.equal(v.code, 0);
  });

  test('every LIVE_STATUS spelling is treated as holding the group', () => {
    // `waiting`, `requested` and `pending` occupy the group exactly as `queued`
    // does. Listing only the two named in the requirement would be a hole with
    // no compensating benefit.
    for (const status of LIVE_STATUSES) {
      const v = decide({
        run: mkRun(),
        branchHeadSha: HEAD,
        workflows,
        siblings: [liveSibling({ status })],
      });
      assert.equal(v.code, 1, `status \`${status}\` was not treated as live`);
    }
  });

  test('the run being re-run does not count as its own collision', () => {
    // Off-by-one in the obvious place: a run listed as live on its own branch
    // would otherwise refuse every re-run of itself, forever.
    const v = decide({
      run: mkRun({ status: 'in_progress' }),
      branchHeadSha: HEAD,
      workflows,
      siblings: [liveSibling({ id: 16000000001, head_sha: OLD })],
    });
    assert.equal(v.code, 0, v.reason);
  });

  test('an unknown branch HEAD is exit 2 — half the test is missing', () => {
    const v = decide({ run: mkRun(), branchHeadSha: null, workflows, siblings: [] });
    assert.equal(v.code, 2);
    assert.match(v.reason, /I COULD NOT LOOK/);
  });

  test('a live sibling from an UNKNOWABLE workflow is exit 2, not an allow', () => {
    // "It might be in this group" is not a basis for re-running.
    const v = decide({
      run: mkRun(),
      branchHeadSha: HEAD,
      workflows,
      siblings: [liveSibling({ path: '.github/workflows/gone.yml' })],
    });
    assert.equal(v.code, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('credentials and arguments — the exits that must not read as a pass', () => {
  test('🔴 the MIXED vault: a quoted value is unquoted, a bare value is untouched', () => {
    // Measured on 2026-08-12: `Project_Cross_Platform_Apps_GITHUB_PAT` is BARE
    // in `.claude/secrets.env` while its siblings are single-quoted. A reader
    // that strips unconditionally eats a real leading character; one that never
    // strips sends `Bearer '…'` and GitHub answers 401 — which reads exactly
    // like a revoked token and cost two sessions on the Cloudflare token.
    const dir = temp();
    const v = join(dir, 'secrets.env');
    writeFileSync(
      v,
      [
        '#   export GH_TOKEN=$(something)',
        'Project_Cross_Platform_Apps_GITHUB_PAT=ghp_bare_value_not_a_real_token',
        "Project_nik_GITHUB_PAT='ghp_quoted_value_not_a_real_token'",
        'Q_DOUBLE="dq"',
        "ONLY_LEADING_QUOTE='mismatched",
      ].join('\n'),
    );
    assert.equal(fromVault('Project_Cross_Platform_Apps_GITHUB_PAT', v), 'ghp_bare_value_not_a_real_token');
    assert.equal(fromVault('Project_nik_GITHUB_PAT', v), 'ghp_quoted_value_not_a_real_token');
    assert.equal(fromVault('Q_DOUBLE', v), 'dq');
    // An UNMATCHED quote is left exactly as written — stripping it would invent
    // a value the file does not contain.
    assert.equal(fromVault('ONLY_LEADING_QUOTE', v), "'mismatched");
    assert.equal(fromVault('GH_TOKEN', v), null, 'a commented example was read as a key');
    assert.equal(fromVault('NOT_PRESENT', v), null);
  });

  test('no credential at all is exit 2 — "I could not look", not a pass', () => {
    // No fixture, so this is the live path with everything withheld. It must
    // stop at the credential rather than contacting anything.
    const r = run(['31581536886', '--dry-run'], { GITHUB_REPOSITORY: 'owner/name' });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /I COULD NOT LOOK/);
    assert.notEqual(r.code, 127, 'crashed instead of exiting cleanly');
  });

  test('a missing run id is exit 2, not a silent no-op', () => {
    const r = run(['--dry-run']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /no run id given/);
  });

  test('an unrecognised argument is refused rather than ignored', () => {
    // A typo'd flag silently dropped is how `--dry-run` becomes a real re-run.
    assert.match(parseArgs(['123', '--dryrun']).error, /unrecognised argument/);
    assert.deepEqual(parseArgs(['123', '--dry-run']).dryRun, true);
    assert.equal(parseArgs(['123', '--workflows', '/x']).workflows, '/x');
  });

  test('a fixture path that does not exist is exit 2', () => {
    const r = run(['16000000001'], { SAFE_RERUN_FIXTURE: join(temp(), 'absent.json') });
    assert.equal(r.code, 2, r.out);
  });
});
