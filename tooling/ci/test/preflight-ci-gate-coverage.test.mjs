// ─────────────────────────────────────────────────────────────────────────────
// preflight-ci-gate-coverage.test.mjs — every job ci-gate needs is either a leg
// preflight.mjs runs or a NOT_REPRODUCIBLE entry with its reason, and never both.
//
// 🔴 THE DEFECT THIS PINS (A-3, row O-PRE-PUSH-RUNS-NO-CI-GATE-LEG's `closes`). The
// full run reproduced only the guard jobs: content_pipeline's suites, the
// extensions-ci checks and the store dry runs ran nowhere before CI, and no list
// said so per job. The needs are DERIVED here through tooling/ci/workflow-scan.mjs's
// parse of the real ci.yml, never typed, so a need added to ci-gate tomorrow reds
// this file until preflight names a leg or a reason for it.
//
// Also pinned: the smoke budget's floor (A-7), and the hooks-installed verdict.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkflow, workflowSteps } from '../workflow-scan.mjs';
import * as preflight from '../../scripts/preflight.mjs';

const {
  CI_GATE_LEGS, NOT_REPRODUCIBLE, LEG_COMMANDS, SECURITY_SCANNERS, CI_WORKFLOW,
  ciGateCoverage, ciGateCoverageLine, ciGateNeeds, commandLeg, hooksVerdict,
  smokeBudgetMs, SMOKE_BUDGET_DEFAULT_S, SMOKE_BUDGET_FLOOR_S, SMOKE_BUDGET_ENV,
} = preflight;

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PREFLIGHT_SRC = readFileSync(join(REPO, 'tooling', 'scripts', 'preflight.mjs'), 'utf8');

/** ci-gate's needs, read through workflow-scan's parse — not through preflight's
 *  own reader, so the two are compared rather than one trusted. */
const realNeeds = () => {
  const wf = parseWorkflow(REPO, CI_WORKFLOW);
  assert.ok(wf, `${CI_WORKFLOW} does not parse`);
  const gate = wf.jobs.get('ci-gate');
  assert.ok(gate, `${CI_WORKFLOW} has no ci-gate job`);
  assert.ok(gate.needs.length >= 5, `ci-gate reads as needing only ${gate.needs.length} job(s)`);
  return gate.needs;
};

describe('the coverage table against the REAL ci.yml', () => {
  test('preflight reads the same needs workflow-scan parses', () => {
    assert.deepEqual(ciGateNeeds(REPO), { needs: realNeeds() });
  });

  test('🔴 every ci-gate need is in exactly one of CI_GATE_LEGS and NOT_REPRODUCIBLE, and nothing else is', () => {
    const needs = realNeeds();
    const inLegs = needs.filter((n) => Object.hasOwn(CI_GATE_LEGS, n));
    const inNr = needs.filter((n) => Object.hasOwn(NOT_REPRODUCIBLE, n));
    assert.deepEqual(needs.filter((n) => !inLegs.includes(n) && !inNr.includes(n)), [], 'a ci-gate need in neither list');
    assert.deepEqual(inLegs.filter((n) => inNr.includes(n)), [], 'a ci-gate need in both lists');
    assert.deepEqual([...Object.keys(CI_GATE_LEGS), ...Object.keys(NOT_REPRODUCIBLE)].filter((k) => !needs.includes(k)), [], 'an entry that is not a ci-gate need');
    assert.deepEqual(ciGateCoverage(needs), { ok: true });
  });

  test('every leg the table names is one preflight runs through step()', () => {
    const exported = new Map(Object.entries(preflight).filter(([, v]) => typeof v === 'string').map(([k, v]) => [v, k]));
    for (const [need, e] of Object.entries(CI_GATE_LEGS)) {
      for (const leg of e.legs) {
        const name = exported.get(leg);
        assert.ok(name, `${need}: leg "${leg}" is not an exported leg-name constant`);
        assert.match(PREFLIGHT_SRC, new RegExp(`step\\(\\s*${name},`), `${need}: leg ${name} is never run by step()`);
      }
      assert.equal(typeof e.ciOnly, 'string', `${need} says nothing about what stays CI's`);
    }
  });

  test('every leg command reproduces a step a workflow runs, and its subject exists', () => {
    const runs = ['.github/workflows/ci.yml', '.github/workflows/extensions-ci.yml', '.github/workflows/lane-apps.yml', '.github/workflows/lane-brick.yml']
      .flatMap((rel) => [...parseWorkflow(REPO, rel).jobs.values()])
      .flatMap((job) => workflowSteps(job).map((s) => s.run?.text ?? ''))
      .join('\n');
    for (const [leg, cmds] of Object.entries(LEG_COMMANDS)) {
      assert.ok(cmds.length > 0, `${leg} has no command`);
      for (const c of cmds) {
        assert.ok(existsSync(join(REPO, c.cwd, c.subject)), `${leg}: ${join(c.cwd, c.subject)} does not exist`);
        assert.ok(runs.includes(c.subject), `${leg}: no workflow step runs ${c.subject}`);
      }
    }
    for (const s of SECURITY_SCANNERS) {
      assert.ok(existsSync(join(REPO, s.script)), `${s.script} does not exist`);
      assert.ok(runs.includes(`${s.script} . ${s.flag}`), `no workflow step runs ${s.script} with ${s.flag}`);
    }
  });
});

describe('ciGateCoverage — the startup check, which refuses with exit 2', () => {
  const legs = { a: { legs: ['leg A'], ciOnly: 'nothing' } };
  const nr = { b: 'needs a runner' };

  test('green when each need is in exactly one list', () => {
    assert.deepEqual(ciGateCoverage(['a', 'b'], legs, nr), { ok: true });
  });

  test('🔴 a need in neither list is refused, by name', () => {
    const r = ciGateCoverage(['a', 'b', 'synthetic-new-job'], legs, nr);
    assert.equal(r.ok, false);
    assert.match(r.problems.join('\n'), /ci-gate needs `synthetic-new-job`, which is in neither CI_GATE_LEGS nor NOT_REPRODUCIBLE/);
  });

  test('🔴 a synthetic need added to the REAL needs is refused against the REAL table', () => {
    const r = ciGateCoverage([...realNeeds(), 'synthetic-new-job']);
    assert.deepEqual(r.problems, ['ci-gate needs `synthetic-new-job`, which is in neither CI_GATE_LEGS nor NOT_REPRODUCIBLE — add the leg that runs it, or the reason it cannot run here']);
  });

  test('🔴 a stale entry — no longer a need — is refused, from either list', () => {
    assert.match(ciGateCoverage(['a'], legs, nr).problems.join('\n'), /NOT_REPRODUCIBLE names `b`, which is not a ci-gate need/);
    assert.match(ciGateCoverage(['b'], legs, nr).problems.join('\n'), /CI_GATE_LEGS names `a`, which is not a ci-gate need/);
    const real = realNeeds();
    const dropped = real.slice(1);
    assert.match(ciGateCoverage(dropped).problems.join('\n'), new RegExp(`names \`${real[0]}\`, which is not a ci-gate need`));
  });

  test('a need in both lists, a leg-less entry and a reason-less entry are refused', () => {
    assert.match(ciGateCoverage(['a', 'b'], legs, { ...nr, a: 'x' }).problems.join('\n'), /`a` is in both/);
    assert.match(ciGateCoverage(['a', 'b'], { a: { legs: [] } }, nr).problems.join('\n'), /CI_GATE_LEGS `a` names no leg/);
    assert.match(ciGateCoverage(['a', 'b'], legs, { b: '  ' }).problems.join('\n'), /NOT_REPRODUCIBLE `b` gives no reason/);
  });
});

describe('ciGateCoverageLine — measured from what ran', () => {
  const legs = { a: { legs: ['A'] }, c: { legs: ['A', 'C'] } };
  const nr = { b: 'needs a runner' };

  test('a need is run here only when every one of its legs ran; a skipped one says why', () => {
    const line = ciGateCoverageLine({ needs: ['a', 'b', 'c'], ran: new Set(['A']), skipped: new Map([['C', '--fast skips it']]), legs, notReproducible: nr });
    assert.match(line, /^⬜ CI-GATE COVERAGE — ci-gate needs 3 · run here 1 · not run this time 1 · not reproducible 1$/m);
    assert.match(line, /^ {3}run here: a$/m);
    assert.match(line, /^ {3}not run this time: c — C: --fast skips it$/m);
    assert.match(line, /^ {3}not reproducible: b — needs a runner$/m);
  });
});

describe('commandLeg — a leg that reproduces CI steps', () => {
  test('🔴 a missing subject FAILS the leg, naming it — never a skip', () => {
    const r = commandLeg([{ cwd: '.', subject: 'tooling/no-such-script.mjs', args: ['tooling/no-such-script.mjs'] }], { root: REPO });
    assert.equal(r.code, 1);
    assert.match(r.out, /tooling\/no-such-script\.mjs does not exist/);
  });

  test('the real dry-run leg: prepare derives the apps, and every submission path walks', () => {
    const r = commandLeg(LEG_COMMANDS[preflight.DRYRUN_LEG], { root: REPO });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^ok {2}\(\.\) node tooling\/ci\/assert-release-lane-generic\.mjs --emit-apps$/m);
    // Five submission paths per app, and at least one app.
    const walked = (r.out.match(/^ok .* --dry-run .*--app \S+ --allow-missing-artifact$/gm) ?? []).length;
    assert.ok(walked >= 5 && walked % 5 === 0, r.out);
  });
});

describe(`smokeBudgetMs — ${SMOKE_BUDGET_ENV}, with a floor (A-7)`, () => {
  test('🔴 5 s is refused, under the floor', () => {
    assert.match(smokeBudgetMs({ [SMOKE_BUDGET_ENV]: '5' }).error, new RegExp(`is under the ${SMOKE_BUDGET_FLOOR_S} s floor`));
  });
  test('the documented default and the floor itself are accepted', () => {
    assert.deepEqual(smokeBudgetMs({}), { ms: SMOKE_BUDGET_DEFAULT_S * 1000 });
    assert.deepEqual(smokeBudgetMs({ [SMOKE_BUDGET_ENV]: String(SMOKE_BUDGET_DEFAULT_S) }), { ms: SMOKE_BUDGET_DEFAULT_S * 1000 });
    assert.deepEqual(smokeBudgetMs({ [SMOKE_BUDGET_ENV]: String(SMOKE_BUDGET_FLOOR_S) }), { ms: SMOKE_BUDGET_FLOOR_S * 1000 });
  });
  test('the floor is below the default, or the default itself would refuse', () => {
    assert.ok(SMOKE_BUDGET_FLOOR_S > 5 && SMOKE_BUDGET_FLOOR_S <= SMOKE_BUDGET_DEFAULT_S);
  });
});

describe('hooksVerdict — are the git hooks installed (a warning, never a failure)', () => {
  const root = resolve('/r');
  const both = (p) => p === join(root, '.githooks', 'pre-commit') || p === join(root, '.githooks', 'pre-push');

  test("installed: core.hooksPath resolves to this tree's .githooks, holding both hooks", () => {
    assert.deepEqual(hooksVerdict({ value: '.githooks\n', status: 0, root, exists: both }), { ok: true });
  });
  test('🔴 unset is a warning that names the installer', () => {
    assert.match(hooksVerdict({ value: '', status: 1, root, exists: both }).warning, /unset.*node tooling\/scripts\/install-hooks\.mjs/);
  });
  test('🔴 pointed elsewhere, or at a directory without the hooks, is a warning', () => {
    assert.match(hooksVerdict({ value: '/elsewhere', status: 0, root, exists: () => true }).warning, /not this tree's \.githooks/);
    assert.match(hooksVerdict({ value: '.githooks', status: 0, root, exists: () => false }).warning, /holds no pre-commit or pre-push/);
  });
  test('git that did not answer is a warning, not an "installed"', () => {
    assert.match(hooksVerdict({ value: '', status: null, root, exists: both }).warning, /could not read core\.hooksPath/);
  });
});
