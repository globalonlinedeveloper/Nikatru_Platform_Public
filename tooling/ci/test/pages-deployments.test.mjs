// ─────────────────────────────────────────────────────────────────────────────
// pages-deployments.test.mjs — tooling/ops/check-pages-deployments.mjs must be
// able to FAIL, and must be able to say "I could not look" as a THIRD thing.
//
// The failure this reader exists for is the one with NO OTHER OBSERVER: a
// Cloudflare Git-connected Pages build that failed, or never ran, for a commit
// that is already on `main`. It posts no commit status, opens no GitHub
// Deployment and appears in no Actions run, so the Actions page is green and the
// apex — which since [ADR 075] is the app's PUBLIC ADDRESS and the router that
// proxies it — is serving last week's bytes.
//
// The five properties worth having, each with a failing case below:
//
//   · THE PROJECT SET IS DERIVED. `sites/*` minus `_shared` for the
//     git-connected half, `catalog/apps.json` slugs for the direct-upload half.
//     A derivation that comes back EMPTY must be exit 2, not a clean sweep.
//   · A SUCCEEDED DEPLOYMENT AT THE WRONG COMMIT IS RED. This is the whole
//     point: `latest_stage.status === 'success'` alone is satisfied forever by a
//     project nobody has redeployed.
//   · `?env=production` IS A REQUEST, AND THE ANSWER IS CHECKED. A preview row
//     coming back must withhold the verdict, not grade a branch build as the apex.
//   · EXIT 2 IS NOT EXIT 1, AND IT OUTRANKS IT in the fold.
//   · IN FLIGHT IS NOT FAILED. A build still running when the slot reads it is
//     graded by its AGE (created_on vs now): young is ⏳ and the landed build
//     behind it is graded; past the ceiling is a STUCK build; failure and
//     canceled stay red. ops-watch run 35422355154 went red on the difference.
//   · A DIRECT UPLOAD THAT CARRIES A COMMIT IS GRADED ON IT (2026-09-19, row
//     O-PAGES-DIRECT-UPLOAD-COMMIT-UNGRADED). Its expected commit comes from
//     the deploy unit deploy-web.yml plans (its own `on.push.paths` until
//     ADR 095 §4 moved the deploy behind ci-gate), its in-flight window from that
//     workflow's job timeouts; a stale served commit past the window is RED,
//     and UNGRADED is left only for a row with no commit_hash at all.
//   · ONE DROPPED CONNECTION IS NOT AN OUTAGE, AND AN OUTAGE IS NOT A PASS
//     (2026-09-21, row O-PAGES-FETCH-TRANSIENT-NOT-RETRIED). Each Cloudflare
//     read is attempted up to READ_ATTEMPTS times on a doubling gap; a
//     transient failure followed by a success reads as ok, and a failure that
//     outlives the plan is still exit 2. Both directions below, with `sleep`
//     injected so the bound is proved without being waited.
//   · NOT CARRYING THE COMMIT IS NOT SERVING OTHER BYTES (2026-09-27, FPI-1).
//     A revert pair left 646e00c1 serving the same unit files as e9b256b8, the
//     planner said `unchanged`, and this reader said RED forever. A direct row
//     that does not carry main's commit now asks the planner's own decide();
//     `unchanged` passes, `changed` and an unreadable answer do not.
//   · LATE IS NOT FAILED (2026-10-02, ops watch 37016683957 / 37024343900). A
//     direct row stale past the lane ceiling asks the CI run whose head_sha IS
//     the expected commit: queued / in progress is PENDING (exit 0) until 3 h,
//     a failed deploy job is RED naming it, a completed run leaves RED, and a
//     lookup that fails is RED marked UNKNOWN. Fixtures are recorded API answers
//     (fixtures/pages-deploy-run/).
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  derivePagesProjects,
  judgeProject,
  foldVerdicts,
  newestCommitTouching,
  isAncestorOf,
  classifyStage,
  IN_FLIGHT_CEILING_MS,
  DEPLOYMENTS_PER_PAGE,
  toPathspec,
  jobTimeouts,
  deployLaneInputs,
  commitTimeOf,
  DEPLOY_WEB_REL,
  DEPLOY_LANE_RUNS,
  CouldNotLook,
  transientLook,
  isTransientLook,
  backoffPlan,
  readWithBoundedRetry,
  readDeployments,
  readFailureResult,
  READ_ATTEMPTS,
  RETRY_BASE_MS,
  RETRY_CEILING_MS,
  siteLanes,
  readRollbackOnly,
  judgeRollbackOnly,
  readProject,
  ROLLBACK_ONLY_REL,
  unitUnchangedBetween,
  judgeDeployRun,
  readDeployRun,
  deployJobFor,
  PENDING_CEILING_MS,
  CI_WORKFLOW_FILE,
  DEPLOY_CALLER_JOB,
} from '../../ops/check-pages-deployments.mjs';
import { readUnits, UNITS_REL } from '../assert-deploy-triggers-deploy.mjs';
import { gitAt, PlanRefusal } from '../plan-deploy.mjs';
import { parseWorkflow } from '../workflow-scan.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const READER_REL = 'tooling/ops/check-pages-deployments.mjs';
const WORKFLOW_REL = '.github/workflows/ops-watch.yml';

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-pd-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** A tree with the sources this reader derives from. `rollback` is the
 *  rollback-only register (null writes none). */
function tree(name, { sites = ['nikatru', 'rajasekarselvam', '_shared'], catalogue = [{ slug: 'subscriptiontracker' }], rollback = { projects: {} } } = {}) {
  const root = join(TMP, name);
  for (const s of sites) mkdirSync(join(root, 'sites', s), { recursive: true });
  mkdirSync(join(root, 'catalog'), { recursive: true });
  if (catalogue !== null) writeFileSync(join(root, 'catalog', 'apps.json'), JSON.stringify(catalogue));
  if (rollback !== null) {
    mkdirSync(join(root, ...dirname(ROLLBACK_ONLY_REL).split('/')), { recursive: true });
    writeFileSync(join(root, ...ROLLBACK_ONLY_REL.split('/')), JSON.stringify(rollback));
  }
  return root;
}

const SHA_OLD = 'a'.repeat(40);
const SHA_NEW = 'b'.repeat(40);

/** One production deployment row, shaped as the Cloudflare API returns it. */
const deployment = (over = {}) => ({
  id: 'dep-1',
  environment: 'production',
  latest_stage: { name: 'deploy', status: 'success' },
  deployment_trigger: { type: 'github:push', metadata: { commit_hash: SHA_NEW } },
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('derivePagesProjects — the set is derived, and an empty derivation is exit 2', () => {
  test('git-connected projects come from sites/, minus _shared', () => {
    const { projects, problems } = derivePagesProjects(tree('derive-ok'));
    assert.deepEqual(problems, []);
    const git = projects.filter((p) => p.kind === 'git');
    assert.deepEqual(
      git.map((p) => p.project),
      ['nikatru', 'rajasekarselvam'],
      '_shared is not a site and must not be queried as a Pages project',
    );
    assert.equal(git[0].sourceDir, 'sites/nikatru', 'the project name IS the configured root directory — one reading, both uses');
  });

  test('direct-upload projects come from the catalogue, so a new app adds itself', () => {
    const root = tree('derive-two-apps', { catalogue: [{ slug: 'subscriptiontracker' }, { slug: 'newapp' }] });
    const { projects } = derivePagesProjects(root);
    assert.deepEqual(
      projects.filter((p) => p.kind === 'direct').map((p) => p.project),
      ['subscriptiontracker', 'newapp'],
    );
  });

  test('RED CONTROL — an EMPTY catalogue is a problem, not a shorter sweep', () => {
    const { problems } = derivePagesProjects(tree('derive-empty-cat', { catalogue: [] }));
    assert.equal(problems.length, 1);
    assert.match(problems[0], /EMPTY/);
  });

  test('RED CONTROL — sites/ holding only _shared is a problem, not zero git projects', () => {
    const { problems } = derivePagesProjects(tree('derive-only-shared', { sites: ['_shared'] }));
    assert.ok(problems.some((p) => /no site directory/.test(p)));
  });

  test('RED CONTROL — an unparseable catalogue is a problem', () => {
    const root = tree('derive-bad-json', { catalogue: null });
    writeFileSync(join(root, 'catalog', 'apps.json'), '{not json');
    const { problems } = derivePagesProjects(root);
    assert.ok(problems.some((p) => /did not parse/.test(p)));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('judgeProject — the green control, then each way it goes red', () => {
  const base = { project: 'nikatru', kind: 'git', sourceDir: 'sites/nikatru', expectedCommit: SHA_NEW };

  test('GREEN CONTROL — deploy succeeded at the commit main names', () => {
    const v = judgeProject({ ...base, deployments: [deployment()] });
    assert.equal(v.code, 0);
    assert.match(v.line, /^ok /);
  });

  test('🔴 THE FAILURE WITH NO OTHER OBSERVER — success at a STALE commit is RED', () => {
    const v = judgeProject({
      ...base,
      deployments: [deployment({ deployment_trigger: { type: 'github:push', metadata: { commit_hash: SHA_OLD } } })],
      // the served commit does NOT carry the one main names: genuinely behind.
      isAncestor: () => false,
    });
    assert.equal(v.code, 1, 'a succeeded deployment at the wrong commit must not read as healthy');
    assert.match(v.line, /serving commit aaaaaaa, which does NOT carry bbbbbbb/);
    assert.match(v.line, /invisible on the Actions page/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The limb below is the one that was WRONG, not missing. Cloudflare's git
  // integration builds every push to main, so "served !== expected" is the
  // NORMAL state of a healthy project and the old `!==` red-flagged it.
  // Measured 2026-09-09, ops-watch run 34379156976.
  // ───────────────────────────────────────────────────────────────────────────
  const SHA_AHEAD = 'c'.repeat(40);

  test('🔴 THE FALSE RED — serving a DESCENDANT of the named commit is GREEN, not stale', () => {
    const seen = [];
    const v = judgeProject({
      ...base,
      deployments: [deployment({ deployment_trigger: { type: 'github:push', metadata: { commit_hash: SHA_AHEAD } } })],
      isAncestor: (a, b) => {
        seen.push([a, b]);
        return true;
      },
    });
    assert.equal(v.code, 0, 'a build AHEAD of the named commit already carries it and is not stale');
    assert.match(v.line, /^ok /);
    assert.match(v.line, /is AHEAD of bbbbbbb/);
    assert.deepEqual(
      seen,
      [[SHA_NEW, SHA_AHEAD]],
      'the question must be asked as isAncestor(expected, served) — reversing it inverts the verdict',
    );
  });

  test('an UNREADABLE ancestry is exit 2, never a pass — a shallow clone has not judged this', () => {
    const v = judgeProject({
      ...base,
      deployments: [deployment({ deployment_trigger: { type: 'github:push', metadata: { commit_hash: SHA_AHEAD } } })],
      isAncestor: () => null,
    });
    assert.equal(v.code, 2);
    assert.match(v.line, /^\? /);
    assert.match(v.line, /could not be read from this/);
  });

  test('no injected resolver at all is exit 2 — the limb refuses to guess', () => {
    const v = judgeProject({
      ...base,
      deployments: [deployment({ deployment_trigger: { type: 'github:push', metadata: { commit_hash: SHA_AHEAD } } })],
    });
    assert.equal(v.code, 2, 'without a way to ask, the freshness question is unanswered rather than fine');
  });

  test('EQUALITY still short-circuits — the resolver is not consulted when the commits match', () => {
    let asked = 0;
    const v = judgeProject({
      ...base,
      deployments: [deployment()],
      isAncestor: () => {
        asked += 1;
        return false;
      },
    });
    assert.equal(v.code, 0);
    assert.equal(asked, 0, 'an equal commit is already the answer; asking git again is a way to get it wrong');
  });

  test('a failed build stage is RED, and the message says production serves the PREVIOUS build', () => {
    const v = judgeProject({ ...base, deployments: [deployment({ latest_stage: { name: 'build', status: 'failure' } })] });
    assert.equal(v.code, 1);
    assert.match(v.line, /stopped at stage `build` with status `failure`/);
    assert.match(v.line, /PREVIOUS build/);
  });

  test('a CANCELED build is RED, like a failed one — it is terminal and nothing will land', () => {
    const v = judgeProject({ ...base, deployments: [deployment({ latest_stage: { name: 'build', status: 'canceled' } })] });
    assert.equal(v.code, 1);
    assert.match(v.line, /stopped at stage `build` with status `canceled`/);
  });

  test('a FAILED deploy stage is RED — `failure` at the last stage is not "in flight"', () => {
    const v = judgeProject({ ...base, deployments: [deployment({ latest_stage: { name: 'deploy', status: 'failure' } })] });
    assert.equal(v.code, 1);
    assert.match(v.line, /PREVIOUS build/);
  });

  test('no production deployment at all is RED', () => {
    const v = judgeProject({ ...base, deployments: [] });
    assert.equal(v.code, 1);
    assert.match(v.line, /NO production deployment at all/);
  });

  test('🔴 the env filter is a REQUEST — a preview row that comes back withholds the verdict', () => {
    const v = judgeProject({ ...base, deployments: [deployment({ environment: 'preview' })] });
    assert.equal(v.code, 2, 'a *.pages.dev preview must never be graded as the apex');
    assert.match(v.line, /environment filter did not hold/);
  });

  test('a git-connected project with no commit_hash is exit 2, not a pass', () => {
    const v = judgeProject({ ...base, deployments: [deployment({ deployment_trigger: { type: 'github:push', metadata: {} } })] });
    assert.equal(v.code, 2);
    assert.match(v.line, /unanswered rather than answered "fine"/);
  });

  test('an unreadable latest_stage is exit 2', () => {
    const v = judgeProject({ ...base, deployments: [deployment({ latest_stage: null })] });
    assert.equal(v.code, 2);
  });

  test('a non-array answer is exit 2', () => {
    const v = judgeProject({ ...base, deployments: null });
    assert.equal(v.code, 2);
  });

  test('a DIRECT-UPLOAD project passes on the stage alone, and says its commit limb is ungraded', () => {
    const v = judgeProject({
      project: 'subscriptiontracker',
      kind: 'direct',
      sourceDir: 'apps/subscriptiontracker',
      expectedCommit: null,
      deployments: [deployment({ deployment_trigger: { type: 'ad_hoc', metadata: {} } })],
    });
    assert.equal(v.code, 0);
    assert.match(v.line, /UNGRADED/, 'an ungraded limb must be printed, never silently skipped');
    assert.equal(v.ungraded, true, 'the sweep counts ungraded rows off this flag, so a row without it is counted as graded');
  });

  test('…and a direct-upload project whose stage FAILED is still red', () => {
    const v = judgeProject({
      project: 'subscriptiontracker',
      kind: 'direct',
      sourceDir: 'apps/subscriptiontracker',
      expectedCommit: null,
      deployments: [deployment({ deployment_trigger: { type: 'ad_hoc', metadata: {} }, latest_stage: { name: 'deploy', status: 'failure' } })],
    });
    assert.equal(v.code, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IN FLIGHT IS NOT FAILED. ops-watch run 35422355154 (2026-09-19, 04:50:14Z)
// went RED on `rajasekarselvam` because the build for 77a8495b — created
// 04:50:13Z, deploy stage `success` at 04:50:41Z — was still RUNNING when the
// reader looked at ~04:50:34Z. A red ops-watch reddens ci-gate on main. Each
// case below stands on one side of one branch of that distinction.
// ─────────────────────────────────────────────────────────────────────────────
describe('judgeProject — a build IN FLIGHT is graded by its age, not called red', () => {
  const base = { project: 'rajasekarselvam', kind: 'git', sourceDir: 'sites/rajasekarselvam', expectedCommit: SHA_NEW };
  const NOW = Date.parse('2026-09-19T04:50:34Z');
  const YOUNG = '2026-09-19T04:50:13.024253Z'; // 21 s before NOW, the measured case
  const OLD = '2026-09-19T04:10:00Z'; // 40 min 34 s before NOW, past the 30-min ceiling

  const building = (over = {}) =>
    deployment({
      id: 'dep-building',
      created_on: YOUNG,
      latest_stage: { name: 'build', status: 'active' },
      deployment_trigger: { type: 'github:push', metadata: { commit_hash: SHA_NEW } },
      ...over,
    });
  const landed = (over = {}) => deployment({ id: 'dep-landed', created_on: '2026-09-18T23:42:40Z', ...over });

  test('the ceiling is 30 minutes and one read asks for more than one row', () => {
    assert.equal(IN_FLIGHT_CEILING_MS, 30 * 60 * 1000);
    assert.ok(DEPLOYMENTS_PER_PAGE > 1, 'with per_page=1 there is no completed row behind an in-flight one to grade');
    const src = readFileSync(join(REPO, READER_REL), 'utf8');
    // The reader's SOURCE TEXT, `${…}` and all — deliberately not interpolated:
    // it proves the query is built from the constant rather than a typed number.
    const interpolation = '$' + '{DEPLOYMENTS_PER_PAGE}';
    assert.ok(
      src.includes(`per_page=${interpolation}`),
      'readDeployments must ask for DEPLOYMENTS_PER_PAGE rows, not a literal that drifts from the constant',
    );
  });

  test('classifyStage — Cloudflare\'s enum, read four ways, and anything else is unknown', () => {
    assert.equal(classifyStage({ name: 'deploy', status: 'success' }), 'done');
    assert.equal(classifyStage({ name: 'build', status: 'success' }), 'inflight', 'a passed non-final stage is mid-build');
    assert.equal(classifyStage({ name: 'deploy', status: 'active' }), 'inflight');
    assert.equal(classifyStage({ name: 'queued', status: 'idle' }), 'inflight');
    assert.equal(classifyStage({ name: 'build', status: 'failure' }), 'failed');
    assert.equal(classifyStage({ name: 'queued', status: 'canceled' }), 'failed');
    assert.equal(classifyStage({ name: 'deploy', status: 'skipped' }), 'unknown');
    assert.equal(classifyStage(null), 'unreadable');
  });

  test('🔴 THE MEASURED RACE — young, in flight, the landed build behind it predates main: exit 0, ⏳', () => {
    const seen = [];
    const v = judgeProject({
      ...base,
      now: NOW,
      // the landed row serves the OLD commit; the building row carries SHA_NEW itself.
      deployments: [building(), landed({ deployment_trigger: { type: 'github:push', metadata: { commit_hash: SHA_OLD } } })],
      isAncestor: (a, b) => {
        seen.push([a, b]);
        return false;
      },
    });
    assert.equal(v.code, 0, 'a build 21 s old that carries the commit main names is the build window, not a missed build');
    assert.match(v.line, /^⏳ /);
    assert.match(v.line, /dep-building \(commit bbbbbbb, 21 s old/);
    assert.match(v.line, /next ops-watch slot grades dep-building/);
    assert.equal(v.inflight, true);
    assert.deepEqual(seen, [[SHA_NEW, SHA_OLD]], 'the landed build is asked first, and found behind');
  });

  test('young, in flight, the landed build behind it is current: exit 0, ⏳, graded on the landed one', () => {
    const v = judgeProject({ ...base, now: NOW, deployments: [building(), landed()] });
    assert.equal(v.code, 0);
    assert.match(v.line, /^⏳ /);
    assert.match(v.line, /Serving now: .*dep-landed succeeded at stage `deploy`/);
  });

  test('RED CONTROL — young, in flight, but NEITHER the landed nor the building commit carries main: exit 1', () => {
    const SHA_OTHER = 'd'.repeat(40);
    const v = judgeProject({
      ...base,
      now: NOW,
      deployments: [
        building({ deployment_trigger: { type: 'github:push', metadata: { commit_hash: SHA_OTHER } } }),
        landed({ deployment_trigger: { type: 'github:push', metadata: { commit_hash: SHA_OLD } } }),
      ],
      isAncestor: () => false,
    });
    assert.equal(v.code, 1, 'a running build that does not carry the commit either cannot excuse the missing one');
    assert.match(v.line, /does not carry it either/);
  });

  test('young, in flight, the building commit\'s ancestry cannot be read: exit 2', () => {
    const SHA_OTHER = 'd'.repeat(40);
    const v = judgeProject({
      ...base,
      now: NOW,
      deployments: [
        building({ deployment_trigger: { type: 'github:push', metadata: { commit_hash: SHA_OTHER } } }),
        landed({ deployment_trigger: { type: 'github:push', metadata: { commit_hash: SHA_OLD } } }),
      ],
      isAncestor: (a, b) => (b === SHA_OLD ? false : null),
    });
    assert.equal(v.code, 2);
  });

  test('🔴 RED CONTROL — in flight PAST the ceiling is a STUCK build: exit 1', () => {
    const v = judgeProject({ ...base, now: NOW, deployments: [building({ created_on: OLD }), landed()] });
    assert.equal(v.code, 1, 'a build running for 40 minutes on a project that builds in under one is not going to land');
    assert.match(v.line, /STUCK BUILD/);
    assert.match(v.line, /30-minute ceiling/);
  });

  test('the ceiling is injectable, and the boundary is strict — AT the ceiling is still young', () => {
    const at = judgeProject({ ...base, now: NOW, ceilingMs: 21_000, deployments: [building({ created_on: '2026-09-19T04:50:13Z' }), landed()] });
    assert.equal(at.code, 0);
    const past = judgeProject({ ...base, now: NOW, ceilingMs: 20_999, deployments: [building({ created_on: '2026-09-19T04:50:13Z' }), landed()] });
    assert.equal(past.code, 1);
  });

  test('🔴 an in-flight build with an UNPARSEABLE created_on is exit 2 — its age is the whole question', () => {
    for (const created_on of ['not a date', undefined, null, 1726721413]) {
      const v = judgeProject({ ...base, now: NOW, deployments: [building({ created_on }), landed()] });
      assert.equal(v.code, 2, `created_on ${JSON.stringify(created_on)} must not be read as young OR as stuck`);
      assert.match(v.line, /does not parse/);
    }
  });

  test('🔴 RED CONTROL — in flight, but the newest COMPLETED deployment behind it FAILED: exit 1', () => {
    const v = judgeProject({
      ...base,
      now: NOW,
      deployments: [building(), landed({ id: 'dep-failed', latest_stage: { name: 'build', status: 'failure' } })],
    });
    assert.equal(v.code, 1, 'a new build starting does not excuse the one that failed');
    assert.match(v.line, /newest COMPLETED production deployment dep-failed stopped at stage `build` with status `failure`/);
  });

  test('in flight with only more in-flight rows behind it — no landed build to grade: exit 2', () => {
    const v = judgeProject({ ...base, now: NOW, deployments: [building(), building({ id: 'dep-building-2' })] });
    assert.equal(v.code, 2);
    assert.match(v.line, /none of the 1 older production row/);
  });

  test('the landed row BEHIND an in-flight one is found past other in-flight rows', () => {
    const v = judgeProject({ ...base, now: NOW, deployments: [building(), building({ id: 'dep-building-2' }), landed()] });
    assert.equal(v.code, 0);
    assert.match(v.line, /dep-landed/);
  });

  test('a stage status outside the enum is exit 2, neither red nor a pass', () => {
    const v = judgeProject({ ...base, now: NOW, deployments: [deployment({ latest_stage: { name: 'deploy', status: 'skipped' } })] });
    assert.equal(v.code, 2);
    assert.match(v.line, /outside Cloudflare's published enum/);
  });

  test('a direct-upload project in flight grades its landed build and stays ungraded on commit', () => {
    const v = judgeProject({
      project: 'subscriptiontracker',
      kind: 'direct',
      sourceDir: 'apps/subscriptiontracker',
      expectedCommit: null,
      now: NOW,
      deployments: [building({ deployment_trigger: { type: 'ad_hoc', metadata: {} } }), landed({ deployment_trigger: { type: 'ad_hoc', metadata: {} } })],
    });
    assert.equal(v.code, 0);
    assert.match(v.line, /^⏳ .*UNGRADED/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A DIRECT UPLOAD THAT CARRIES A COMMIT IS GRADED ON IT. Measured 2026-09-19:
// every `subscriptiontracker` production row is `ad_hoc` AND carries
// metadata.commit_hash (0b3409b5 → ac22b935, 5b862e8b → 30b4ef06), so the
// UNGRADED declaration rested on a false premise.
// ─────────────────────────────────────────────────────────────────────────────
describe('judgeProject — a direct upload carrying a commit_hash is graded on it', () => {
  const NOW = Date.parse('2026-09-19T09:00:00Z');
  const CEILING = 80 * 60 * 1000;
  const base = {
    project: 'subscriptiontracker',
    kind: 'direct',
    sourceDir: `${DEPLOY_WEB_REL} on.push.paths`,
    expectedCommit: SHA_NEW,
    now: NOW,
    laneCeilingMs: CEILING,
    expectedAt: NOW - 3 * 60 * 60 * 1000,
  };
  const adHoc = (sha, over = {}) =>
    deployment({ deployment_trigger: { type: 'ad_hoc', metadata: { branch: 'main', commit_hash: sha, commit_dirty: true } }, ...over });

  test('GREEN CONTROL — the served commit IS the newest one the deploy lane deploys for', () => {
    const v = judgeProject({ ...base, deployments: [adHoc(SHA_NEW)] });
    assert.equal(v.code, 0);
    assert.match(v.line, /^ok .*serving bbbbbbb, the newest `main` commit touching \.github\/workflows\/deploy-web\.yml on\.push\.paths/);
    assert.notEqual(v.ungraded, true, 'a row that carries a hash and was graded must not be counted as ungraded');
  });

  test('🔴 RED — a STALE served commit past the deploy-lane ceiling is exit 1', () => {
    const v = judgeProject({ ...base, deployments: [adHoc(SHA_OLD)], isAncestor: () => false });
    assert.equal(v.code, 1, 'a direct upload serving an older build than main names must not read as healthy');
    assert.match(v.line, /serving commit aaaaaaa, which does NOT carry bbbbbbb/);
    assert.match(v.line, /landed 180 min ago, past the 80-minute deploy-lane ceiling/);
  });

  test('a served DESCENDANT of the expected commit is green, asked as isAncestor(expected, served)', () => {
    const C = 'c'.repeat(40);
    const seen = [];
    const v = judgeProject({ ...base, deployments: [adHoc(C)], isAncestor: (a, b) => (seen.push([a, b]), true) });
    assert.equal(v.code, 0);
    assert.match(v.line, /AHEAD of bbbbbbb/);
    assert.deepEqual(seen, [[SHA_NEW, C]]);
  });

  test('🔴 THE DEPLOY-LANE WINDOW — stale served, expected commit 9 min old: exit 0, ⏳, not red', () => {
    const v = judgeProject({ ...base, expectedAt: NOW - 9 * 60 * 1000, deployments: [adHoc(SHA_OLD)], isAncestor: () => false });
    assert.equal(v.code, 0, 'Cloudflare shows no in-flight row for a direct upload; the lane window stands in for it');
    assert.match(v.line, /^⏳ /);
    assert.match(v.line, /landed 9 min ago, inside the 80-minute deploy-lane ceiling/);
    assert.equal(v.inflight, true, 'the summary must count it as not-yet-landed');
  });

  test('the window boundary is strict — AT the ceiling is inside, one ms past is RED', () => {
    const at = judgeProject({ ...base, expectedAt: NOW - CEILING, deployments: [adHoc(SHA_OLD)], isAncestor: () => false });
    assert.equal(at.code, 0);
    const past = judgeProject({ ...base, expectedAt: NOW - CEILING - 1, deployments: [adHoc(SHA_OLD)], isAncestor: () => false });
    assert.equal(past.code, 1);
  });

  test('🔴 stale served with an UNREADABLE commit time or ceiling is exit 2 — the window is the question', () => {
    for (const over of [{ expectedAt: null }, { expectedAt: NaN }, { laneCeilingMs: null }, { laneCeilingMs: 0 }]) {
      const v = judgeProject({ ...base, ...over, deployments: [adHoc(SHA_OLD)], isAncestor: () => false });
      assert.equal(v.code, 2, `${JSON.stringify(over)} must be neither ⏳ nor red`);
      assert.match(v.line, /NOTHING was judged/);
    }
  });

  test('an unreadable ancestry on a direct row is exit 2, as for a git-connected one', () => {
    const v = judgeProject({ ...base, deployments: [adHoc('c'.repeat(40))], isAncestor: () => null });
    assert.equal(v.code, 2);
  });

  test('🔴 a row that CARRIES a hash with no expected commit supplied is exit 2, never UNGRADED', () => {
    const v = judgeProject({ ...base, expectedCommit: null, deployments: [adHoc(SHA_NEW)] });
    assert.equal(v.code, 2, 'UNGRADED is reserved for a row with no hash; anything else answering ok is the old blind limb');
    assert.notEqual(v.ungraded, true);
  });

  test('UNGRADED stays for a row that truly carries no commit_hash — and is flagged for the count', () => {
    for (const metadata of [{}, { commit_hash: '' }, { commit_hash: null }]) {
      const v = judgeProject({ ...base, deployments: [deployment({ deployment_trigger: { type: 'ad_hoc', metadata } })] });
      assert.equal(v.code, 0);
      assert.match(v.line, /UNGRADED/);
      assert.equal(v.ungraded, true);
    }
  });

  test('in flight: the landed direct row behind a building one is graded on its commit', () => {
    const building = (sha) =>
      adHoc(sha, { id: 'dep-building', created_on: new Date(NOW - 20_000).toISOString(), latest_stage: { name: 'deploy', status: 'active' } });
    const green = judgeProject({ ...base, deployments: [building(SHA_NEW), adHoc(SHA_NEW, { id: 'dep-landed' })] });
    assert.equal(green.code, 0);
    assert.match(green.line, /^⏳ .*Serving now: .*dep-landed/);
    const red = judgeProject({ ...base, deployments: [building('d'.repeat(40)), adHoc(SHA_OLD, { id: 'dep-landed' })], isAncestor: () => false });
    assert.equal(red.code, 1, 'past the lane ceiling, a building row that does not carry main either cannot excuse the stale one');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FPI-1 (2026-09-27). #996 (51a4e9ad) never deployed, revert #1002 (e9b256b8)
// put its files back, and deploy-web's planner read `decision=unchanged` against
// the live 646e00c1 (main CI 36293604395). Ops watch run 36297578437 then called
// subscriptiontracker RED: 646e00c does not carry e9b256b. The reader now asks
// the planner's own decide() first — through unitUnchangedBetween — so the two
// cannot disagree; only `unchanged` changes a verdict.
// ─────────────────────────────────────────────────────────────────────────────
describe('judgeProject — a served build whose unit files are identical to main\'s is current (FPI-1)', () => {
  const NOW = Date.parse('2026-09-27T05:34:00Z');
  const CEILING = 80 * 60 * 1000;
  const GLOBS = ['apps/**', 'packages/**', 'pubspec.lock'];
  const base = {
    project: 'subscriptiontracker',
    kind: 'direct',
    sourceDir: 'the deploy unit',
    expectedCommit: SHA_NEW,
    now: NOW,
    laneCeilingMs: CEILING,
    expectedAt: NOW - 3 * 60 * 60 * 1000,
    isAncestor: () => false,
  };
  const adHoc = (sha) => deployment({ deployment_trigger: { type: 'ad_hoc', metadata: { branch: 'main', commit_hash: sha, commit_dirty: true } } });
  /** The planner's git reads, faked: a full clone holding both commits, whose diff is `changed`. */
  const planGit = (changed, over = {}) => ({
    isShallow: () => false,
    hasCommit: () => true,
    isAncestor: () => false,
    changedFiles: () => changed,
    ...over,
  });
  const planned = (git) => (a, b) => unitUnchangedBetween(a, b, GLOBS, git);

  test('(a) 🔴 THE MEASURED FALSE RED — served does not carry main, its unit files are identical: exit 0, and the line says so', () => {
    const seen = [];
    const git = planGit([], { changedFiles: (a, b) => (seen.push([a, b]), ['docs/x.md', 'tooling/ops/check-pages-deployments.mjs']) });
    const v = judgeProject({ ...base, deployments: [adHoc(SHA_OLD)], treeUnchanged: planned(git) });
    assert.equal(v.code, 0, 'deploy-web will never publish a pair its planner reads as unchanged, so RED here is red forever');
    assert.match(
      v.line,
      /^ok {2}subscriptiontracker \(direct\) — deployment dep-1 succeeded at stage `deploy`, serving aaaaaaa, which does not contain bbbbbbb, but the unit's files are identical between them \(deploy-web planned "unchanged"\) — current\.$/,
    );
    assert.notEqual(v.inflight, true, 'identical bytes are landed, not pending');
    assert.notEqual(v.ungraded, true, 'the commit limb WAS graded');
    assert.deepEqual(seen, [[SHA_OLD, SHA_NEW]], 'the planner diffs live (served) → target (expected)');
  });

  test('(a) identical bytes pass inside the deploy-lane window too — no ⏳ for a publish that will never come', () => {
    const v = judgeProject({ ...base, expectedAt: NOW - 9 * 60 * 1000, deployments: [adHoc(SHA_OLD)], treeUnchanged: planned(planGit([])) });
    assert.equal(v.code, 0);
    assert.match(v.line, /^ok .*identical between them/);
    assert.notEqual(v.inflight, true);
  });

  test('(b) 🔴 RED CONTROL — the unit\'s files DIFFER: exit 1, the verdict it had before FPI-1', () => {
    const v = judgeProject({ ...base, deployments: [adHoc(SHA_OLD)], treeUnchanged: planned(planGit(['apps/subscriptiontracker/lib/main.dart'])) });
    assert.equal(v.code, 1, 'a served build missing a unit change must stay red');
    assert.match(v.line, /serving commit aaaaaaa, which does NOT carry bbbbbbb/);
    assert.match(v.line, /landed 180 min ago, past the 80-minute deploy-lane ceiling/);
    const young = judgeProject({ ...base, expectedAt: NOW - 9 * 60 * 1000, deployments: [adHoc(SHA_OLD)], treeUnchanged: planned(planGit(['pubspec.lock'])) });
    assert.equal(young.code, 0);
    assert.match(young.line, /^⏳ .*inside the 80-minute deploy-lane ceiling/, 'inside the window a real change is still ⏳, as before');
  });

  test('(c) 🔴 an UNREADABLE answer is the old verdict, never a pass', () => {
    const unreadable = [
      ['a stub answering null', () => null],
      ['a shallow clone', planned(planGit([], { isShallow: () => true }))],
      ['a served commit this checkout lacks', planned(planGit([], { hasCommit: (s) => s !== SHA_OLD }))],
      ['an expected commit this checkout lacks', planned(planGit([], { hasCommit: (s) => s !== SHA_NEW }))],
      ['a diff git refused', planned(planGit([], { changedFiles: () => { throw new PlanRefusal('git diff failed: bad object'); } }))],
      ['a glob shape the planner cannot decide', (a, b) => unitUnchangedBetween(a, b, ['apps/**/lib/*.dart'], planGit(['apps/x/lib/y.dart']))],
    ];
    for (const [why, treeUnchanged] of unreadable) {
      const past = judgeProject({ ...base, deployments: [adHoc(SHA_OLD)], treeUnchanged });
      assert.equal(past.code, 1, `${why}: past the ceiling it is RED, exactly as before`);
      assert.match(past.line, /which does NOT carry bbbbbbb/);
      const young = judgeProject({ ...base, expectedAt: NOW - 9 * 60 * 1000, deployments: [adHoc(SHA_OLD)], treeUnchanged });
      assert.match(young.line, /^⏳ /, `${why}: inside the window it is ⏳, exactly as before`);
    }
  });

  test('it is asked ONLY for a direct row that does not carry main — never to rescue anything else', () => {
    let asked = 0;
    const yes = () => ((asked += 1), true);
    assert.equal(judgeProject({ ...base, deployments: [adHoc(SHA_NEW)], treeUnchanged: yes }).code, 0, 'equal: already answered');
    assert.equal(judgeProject({ ...base, deployments: [adHoc(SHA_OLD)], isAncestor: () => true, treeUnchanged: yes }).code, 0, 'ahead: already answered');
    assert.equal(asked, 0);
    const blind = judgeProject({ ...base, deployments: [adHoc(SHA_OLD)], isAncestor: () => null, treeUnchanged: yes });
    assert.equal(blind.code, 2, 'an unreadable ANCESTRY stays exit 2; identical bytes do not excuse a question nobody answered');
    const git = judgeProject({ ...base, kind: 'git', deployments: [deployment({ deployment_trigger: { type: 'github:push', metadata: { commit_hash: SHA_OLD } } })], treeUnchanged: yes });
    assert.equal(git.code, 1, 'a git-connected project has no planner; Cloudflare builds every push, so behind is behind');
    assert.equal(asked, 0);
  });
});

describe('unitUnchangedBetween — the planner\'s decide(), not a second copy of it', () => {
  const GLOBS = ['apps/**'];
  const fake = (over = {}) => ({ isShallow: () => false, hasCommit: () => true, isAncestor: () => false, changedFiles: () => [], ...over });

  test('`unchanged` is true, `changed` is false', () => {
    assert.equal(unitUnchangedBetween(SHA_OLD, SHA_NEW, GLOBS, fake({ changedFiles: () => ['docs/a.md'] })), true);
    assert.equal(unitUnchangedBetween(SHA_OLD, SHA_NEW, GLOBS, fake({ changedFiles: () => ['apps/a/x.dart'] })), false);
  });

  test('every decision that is not `unchanged`/`changed` is null — superseded, already-live, live-not-in-history', () => {
    assert.equal(unitUnchangedBetween(SHA_OLD, SHA_NEW, GLOBS, fake({ isAncestor: () => true })), null);
    assert.equal(unitUnchangedBetween(SHA_NEW, SHA_NEW, GLOBS, fake()), null);
    assert.equal(unitUnchangedBetween(SHA_OLD, SHA_NEW, GLOBS, fake({ hasCommit: (s) => s === SHA_NEW })), null);
  });

  test('a non-sha argument or no unit is null, and git is never asked', () => {
    let called = 0;
    const counting = fake({ isShallow: () => ((called += 1), false) });
    for (const [s, e, g] of [['--output=x', SHA_NEW, GLOBS], [SHA_OLD, null, GLOBS], [SHA_OLD, SHA_NEW, []], [SHA_OLD, SHA_NEW, null]]) {
      assert.equal(unitUnchangedBetween(s, e, g, counting), null);
    }
    assert.equal(called, 0);
  });

  test('a bug is not an unreadable answer — a non-PlanRefusal error escapes', () => {
    assert.throws(() => unitUnchangedBetween(SHA_OLD, SHA_NEW, GLOBS, fake({ changedFiles: () => { throw new TypeError('boom'); } })), TypeError);
  });

  test('🔴 THE REAL GIT — a revert pair is unchanged, the change it reverted is not, and a shallow clone is null', () => {
    const repo = join(TMP, 'fpi-repo');
    mkdirSync(repo);
    const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@test.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@test.invalid', GIT_CONFIG_NOSYSTEM: '1' };
    const git = (cwd, ...args) => {
      const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' });
      assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
      return r.stdout.trim();
    };
    const commit = (rel, body, msg) => {
      mkdirSync(dirname(join(repo, rel)), { recursive: true });
      writeFileSync(join(repo, rel), body);
      git(repo, 'add', '-A');
      git(repo, 'commit', '-q', '-m', msg);
      return git(repo, 'rev-parse', 'HEAD');
    };
    git(repo, 'init', '-q');
    const served = commit('apps/st/lib/a.dart', 'v1\n', 'live (646e00c1)');
    const change = commit('apps/st/lib/a.dart', 'v2\n', 'the change that never deployed (51a4e9ad)');
    commit('docs/x.md', 'x\n', 'outside the unit');
    const revert = commit('apps/st/lib/a.dart', 'v1\n', 'its revert (e9b256b8)');
    const real = gitAt(repo);
    assert.equal(unitUnchangedBetween(served, revert, GLOBS, real), true);
    assert.equal(unitUnchangedBetween(served, change, GLOBS, real), false);
    const v = judgeProject({
      project: 'st',
      kind: 'direct',
      sourceDir: 'the deploy unit',
      deployments: [deployment({ deployment_trigger: { type: 'ad_hoc', metadata: { commit_hash: served } } })],
      expectedCommit: revert,
      isAncestor: (a, b) => isAncestorOf(repo, a, b),
      treeUnchanged: (a, b) => unitUnchangedBetween(a, b, GLOBS, real),
      now: Date.now(),
      expectedAt: Date.now() - 3 * 60 * 60 * 1000,
      laneCeilingMs: 80 * 60 * 1000,
    });
    assert.equal(v.code, 0, v.line);
    const shallow = join(TMP, 'fpi-shallow');
    git(TMP, 'clone', '-q', '--depth', '1', `file://${repo}`, shallow);
    assert.equal(unitUnchangedBetween(served, revert, GLOBS, gitAt(shallow)), null, 'a shallow clone has not answered this');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('deployLaneInputs — the expected commit and the window come FROM deploy-web.yml', () => {
  test('toPathspec — the three exact shapes translate, everything else is null', () => {
    assert.equal(toPathspec('apps/**'), ':(literal)apps');
    assert.equal(toPathspec('tooling/web/**'), ':(literal)tooling/web');
    assert.equal(toPathspec('pubspec.lock'), ':(literal)pubspec.lock');
    assert.equal(toPathspec('.github/workflows/deploy-web.yml'), ':(literal).github/workflows/deploy-web.yml');
    assert.equal(toPathspec('tooling/ci/*.mjs'), ':(glob)tooling/ci/*.mjs');
    assert.equal(toPathspec('tooling/ci/*'), ':(glob)tooling/ci/*');
    for (const g of ['!apps/**', '!pubspec.lock', 'apps/!x/**', 'apps/**/lib/*.dart', 'apps/?/x', 'apps/[ab]/x', 'a+b/**', '**', '', null]) {
      assert.equal(toPathspec(g), null, `${JSON.stringify(g)} must not be translated by a guess`);
    }
  });

  test('jobTimeouts — job-level only; a job without one is a problem, not 360', () => {
    const wf = [
      'on: push',
      'jobs:',
      '  a:',
      '    runs-on: x',
      '    timeout-minutes: 5',
      '    steps:',
      '      - run: y',
      '        timeout-minutes: 99',
      '  b:',
      '    timeout-minutes: 35 # why',
      '',
    ].join('\n');
    const parse = (name, text) => {
      const root = join(TMP, name);
      mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
      writeFileSync(join(root, '.github', 'workflows', 'w.yml'), text);
      return parseWorkflow(root, '.github/workflows/w.yml');
    };
    const ok = jobTimeouts(parse('jt-ok', wf));
    assert.deepEqual(ok.minutes, { a: 5, b: 35 }, 'a step-level timeout is not a job ceiling');
    assert.deepEqual(ok.problems, []);
    const missing = jobTimeouts(parse('jt-missing', wf.replace('    timeout-minutes: 35 # why\n', '')));
    assert.equal(missing.problems.length, 1);
    assert.match(missing.problems[0], /job `b` declares no job-level `timeout-minutes`/);
    const commented = jobTimeouts(parse('jt-commented', wf.replace('    timeout-minutes: 35 # why\n', '    # timeout-minutes: 35\n')));
    assert.equal(commented.problems.length, 1, 'a commented-out timeout is not a ceiling');
    assert.equal(jobTimeouts(parse('jt-nojobs', 'on: push\n')).problems.length, 1);
    assert.equal(jobTimeouts(null).problems.length, 1);
  });

  test('🔴 THE REAL deploy-web.yml — every entry of the unit it plans translates, and the ceiling is derived from its jobs', () => {
    const lane = deployLaneInputs(REPO);
    assert.deepEqual(lane.problems, []);
    const globs = readUnits(REPO)['<app>-web'];
    assert.ok(globs.length > 0);
    assert.deepEqual(lane.pathspecs, globs.map(toPathspec), 'one pathspec per unit entry, none dropped');
    assert.deepEqual(lane.globs, globs, 'FPI-1: the planner is asked about the SAME unit the expected commit is read from');
    for (const need of [':(literal)apps', ':(literal)packages', ':(literal)pubspec.lock', `:(literal)${DEPLOY_WEB_REL}`]) {
      assert.ok(lane.pathspecs.includes(need), `${need} — a web build input the lane redeploys on`);
    }
    // ⏱ 2026-09-25 · D3a: the ceiling sums the APP lane — the matrix job and the job it
    // needs — and not the `site` job, which runs beside it for the apex site's own project.
    const minutes = jobTimeouts(parseWorkflow(REPO, DEPLOY_WEB_REL)).minutes;
    assert.ok(Number.isInteger(minutes.site), 'deploy-web.yml has no `site` job with a timeout');
    const sum = minutes.prepare + minutes['deploy-web'];
    assert.ok(sum > 0);
    assert.equal(lane.ceilingMs, DEPLOY_LANE_RUNS * sum * 60 * 1000);
    assert.equal(DEPLOY_LANE_RUNS, 2, 'one run in progress ahead plus its own: the concurrency group never cancels on main');
  });

  test('D3a — a second job planning another unit beside the matrix job is not the app lane: unit and ceiling are the matrix job\'s', () => {
    const root = join(TMP, 'lane-two-jobs');
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    mkdirSync(join(root, ...dirname(UNITS_REL).split('/')), { recursive: true });
    writeFileSync(
      join(root, ...DEPLOY_WEB_REL.split('/')),
      'on:\n  workflow_call:\njobs:\n  prepare:\n    timeout-minutes: 5\n    steps:\n      - run: echo apps\n' +
        '  apps:\n    timeout-minutes: 35\n    needs: prepare\n    steps:\n      - run: node tooling/ci/plan-deploy.mjs ${{ matrix.app }}-web\n' +
        '  site:\n    timeout-minutes: 20\n    steps:\n      - run: node tooling/ci/plan-deploy.mjs nikatru-site\n',
    );
    writeFileSync(join(root, ...UNITS_REL.split('/')), JSON.stringify({ deployUnits: { '<app>-web': ['apps/**'], 'nikatru-site': ['sites/nikatru/**'] } }));
    const lane = deployLaneInputs(root);
    assert.deepEqual(lane.problems, []);
    assert.deepEqual(lane.pathspecs, [':(literal)apps']);
    assert.equal(lane.ceilingMs, DEPLOY_LANE_RUNS * (5 + 35) * 60 * 1000);
  });

  /** A root holding a deploy-web.yml whose one job plans `env`, and a lane-map.json with `units`. */
  const laneRoot = (name, env, units) => {
    const root = join(TMP, name);
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    mkdirSync(join(root, ...dirname(UNITS_REL).split('/')), { recursive: true });
    const plan = env === null ? '' : `      - run: node tooling/ci/plan-deploy.mjs ${env}\n`;
    writeFileSync(join(root, ...DEPLOY_WEB_REL.split('/')), `on:\n  workflow_call:\njobs:\n  a:\n    timeout-minutes: 5\n    steps:\n${plan}      - run: echo deploy\n`);
    if (units !== null) writeFileSync(join(root, ...UNITS_REL.split('/')), JSON.stringify({ deployUnits: units }));
    return root;
  };

  test('RED CONTROL — a unit entry with an untranslatable shape is a problem, not a narrower set', () => {
    const lane = deployLaneInputs(laneRoot('lane-negation', '${{ matrix.app }}-web', { '<app>-web': ['apps/**', '!apps/**/*.md'] }));
    assert.equal(lane.problems.length, 1);
    assert.match(lane.problems[0], /deployUnits\["<app>-web"\] entry "!apps\/\*\*\/\*\.md" has a shape this reader cannot translate exactly/);
  });

  test('RED CONTROL — no workflow, no plan step, or no unit file is a problem', () => {
    assert.match(deployLaneInputs(join(TMP, 'no-such-root')).problems[0], /does not exist/);
    const noUnit = /plans no single readable deploy unit in tooling\/ci\/lane-map\.json/;
    assert.ok(deployLaneInputs(laneRoot('lane-noplan', null, { '<app>-web': ['apps/**'] })).problems.some((p) => noUnit.test(p)));
    assert.ok(deployLaneInputs(laneRoot('lane-nounits', '${{ matrix.app }}-web', null)).problems.some((p) => noUnit.test(p)));
    assert.ok(deployLaneInputs(laneRoot('lane-unknown', 'site-web', { platform: ['services/platform/**'] })).problems.some((p) => noUnit.test(p)));
    assert.deepEqual(deployLaneInputs(laneRoot('lane-ok', '${{ matrix.app }}-web', { '<app>-web': ['apps/**'] })).pathspecs, [':(literal)apps']);
  });

  test('newestCommitTouching passes EVERY pathspec after `--`', () => {
    let seen = null;
    newestCommitTouching('/root', [':(literal)apps', ':(literal)pubspec.lock'], (cmd, args) => {
      seen = args;
      return { status: 0, stdout: `${SHA_NEW}\n` };
    });
    assert.deepEqual(seen.slice(seen.indexOf('--')), ['--', ':(literal)apps', ':(literal)pubspec.lock']);
    assert.equal(newestCommitTouching('/root', [], () => ({ status: 0, stdout: `${SHA_NEW}\n` })), null, 'no pathspec means all history, not the lane');
  });

  test('commitTimeOf — the COMMITTER time, and anything unreadable is null', () => {
    let seen = null;
    const t = commitTimeOf('/root', SHA_NEW, (cmd, args) => {
      seen = args;
      return { status: 0, stdout: '2026-09-19T13:13:15+05:30\n' };
    });
    assert.equal(t, Date.parse('2026-09-19T07:43:15Z'));
    assert.ok(seen.includes('--format=%cI'), 'committer time, which a squash merge sets to the merge');
    assert.equal(commitTimeOf('/root', SHA_NEW, () => ({ status: 128, stdout: '' })), null);
    assert.equal(commitTimeOf('/root', SHA_NEW, () => ({ status: 0, stdout: 'garbage\n' })), null);
    let called = 0;
    assert.equal(commitTimeOf('/root', 'nope', () => (called += 1, { status: 0 })), null);
    assert.equal(called, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('foldVerdicts — 2 outranks 1, because an unjudged half could hold anything', () => {
  const meta = { projectsSwept: 2, ungraded: 0 };

  test('all green folds to 0', () => {
    assert.equal(foldVerdicts([{ code: 0, line: 'a' }, { code: 0, line: 'b' }], meta).code, 0);
  });

  test('one red folds to 1', () => {
    assert.equal(foldVerdicts([{ code: 0, line: 'a' }, { code: 1, line: 'b' }], meta).code, 1);
  });

  test('🔴 a red AND an unknown folds to 2, never to 1', () => {
    const v = foldVerdicts([{ code: 1, line: 'a' }, { code: 2, line: 'b' }], meta);
    assert.equal(v.code, 2);
    assert.equal(v.reds, 1);
    assert.equal(v.unknowns, 1);
  });

  test('an in-flight green is counted, so the summary line cannot claim every build landed', () => {
    const v = foldVerdicts([{ code: 0, line: 'a' }, { code: 0, inflight: true, line: 'b' }], meta);
    assert.equal(v.code, 0);
    assert.equal(v.inflight, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('isAncestorOf — the exit CODE is the answer, and 128 is not "no"', () => {
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);

  test('it asks `merge-base --is-ancestor` in that order', () => {
    let seen = null;
    isAncestorOf('/root', A, B, (cmd, args) => {
      seen = { cmd, args };
      return { status: 0 };
    });
    assert.equal(seen.cmd, 'git');
    assert.deepEqual(seen.args, ['merge-base', '--is-ancestor', A, B]);
  });

  test('exit 0 is true, exit 1 is false', () => {
    assert.equal(isAncestorOf('/root', A, B, () => ({ status: 0 })), true);
    assert.equal(isAncestorOf('/root', A, B, () => ({ status: 1 })), false);
  });

  test('🔴 RED CONTROL — exit 128 (the object is not in this checkout) is null, NOT false', () => {
    assert.equal(
      isAncestorOf('/root', A, B, () => ({ status: 128 })),
      null,
      'reading a missing object as "not an ancestor" turns a shallow clone into a fabricated red',
    );
  });

  test('a spawn error is null', () => {
    assert.equal(isAncestorOf('/root', A, B, () => ({ error: new Error('ENOENT') })), null);
  });

  test('a non-sha argument is null and git is never called', () => {
    let called = 0;
    const run = () => {
      called += 1;
      return { status: 0 };
    };
    assert.equal(isAncestorOf('/root', 'not-a-sha', B, run), null);
    assert.equal(isAncestorOf('/root', A, null, run), null);
    assert.equal(called, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('newestCommitTouching — an unreadable history is null, which the caller turns into exit 2', () => {
  test('it asks origin/main, not HEAD — a dispatched run from a branch must not false-alarm', () => {
    let seen = null;
    newestCommitTouching('/root', 'sites/nikatru', (cmd, args) => {
      seen = { cmd, args };
      return { status: 0, stdout: `${SHA_NEW}\n` };
    });
    assert.equal(seen.cmd, 'git');
    assert.ok(seen.args.includes('origin/main'), `expected origin/main in ${JSON.stringify(seen.args)}`);
    assert.ok(seen.args.includes('sites/nikatru'));
  });

  test('a non-zero git exit is null', () => {
    assert.equal(newestCommitTouching('/root', 'sites/nikatru', () => ({ status: 128, stdout: '' })), null);
  });

  test('RED CONTROL — output that is not a 40-hex sha is null, not a sha-shaped lie', () => {
    assert.equal(newestCommitTouching('/root', 'sites/nikatru', () => ({ status: 0, stdout: 'fatal: bad revision\n' })), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GREEN MEANS RAN. A reader nothing invokes is a reader that cannot fail, and a
// step deleted from the workflow looks identical in a run log to a step that
// passed. Same limb prod-provenance.test.mjs carries over its own step.
describe('the duty is WIRED — ops-watch.yml actually runs this reader', () => {
  test('a job in ops-watch.yml invokes it', () => {
    const wf = readFileSync(join(REPO, WORKFLOW_REL), 'utf8');
    assert.ok(
      wf.includes(`node ${READER_REL}`),
      `no job in ${WORKFLOW_REL} runs ${READER_REL}. A duty nothing invokes cannot fail, and its absence is invisible.`,
    );
  });

  test('…with the Cloudflare credential it cannot look without', () => {
    const wf = readFileSync(join(REPO, WORKFLOW_REL), 'utf8');
    const i = wf.indexOf(`node ${READER_REL}`);
    const window = wf.slice(Math.max(0, i - 1200), i);
    assert.match(window, /CLOUDFLARE_API_TOKEN/);
    assert.match(window, /CLOUDFLARE_ACCOUNT_ID/);
  });

  test('…and with a full history, because the freshness limb reads origin/main', () => {
    const wf = readFileSync(join(REPO, WORKFLOW_REL), 'utf8');
    const i = wf.indexOf(`node ${READER_REL}`);
    const window = wf.slice(Math.max(0, i - 2000), i);
    assert.match(
      window,
      /fetch-depth:\s*0/,
      'a shallow checkout has no origin/main, so newestCommitTouching returns null and every git project reports exit 2',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 ONE DROPPED CONNECTION MUST NOT REDDEN THE RUN, AND AN OUTAGE MUST STILL
// BE COVERAGE LOST. Row O-PAGES-FETCH-TRANSIENT-NOT-RETRIED: ops-watch run
// 35478397730 (schedule, 2026-09-20T00:17:52Z) read `✗ nikatru (git) —
// TypeError: fetch failed` and exited 2 on a SINGLE un-retried fetch, while the
// other two projects read fine in the same run and a dispatch sixteen minutes
// later was green. A red ops-watch reddens ci-gate on main, so that blip froze
// the merge queue.
//
// BOTH directions are asserted, because a retry proven only in the first one is
// indistinguishable from swallowing the error:
//   · a transient failure FOLLOWED BY A SUCCESS reads as ok (verdict 0);
//   · a failure that PERSISTS across every attempt is still COVERAGE LOST (2).
// Every case injects `sleep`, so the suite proves the bound without waiting it.
describe('the bounded retry — a blip is not an outage, and an outage is not a pass', () => {
  const base = { project: 'nikatru', kind: 'git', sourceDir: 'sites/nikatru', expectedCommit: SHA_NEW };
  const rows = [deployment()];
  const DROPPED = 'GET pages/projects/nikatru/deployments did not complete at all — TypeError: fetch failed';

  /** Records what the loop WOULD have slept, and returns at once. */
  function spySleep() {
    const slept = [];
    return { slept, sleep: async (ms) => void slept.push(ms) };
  }

  test('backoffPlan is `attempts - 1` DOUBLING gaps — nothing is waited after the last attempt', () => {
    assert.deepEqual(backoffPlan(3, 1000), [1000, 2000]);
    assert.deepEqual(backoffPlan(1, 1000), [], 'one attempt is no retry, so there is no gap to wait');
    assert.deepEqual(backoffPlan(READ_ATTEMPTS, RETRY_BASE_MS), [1000, 2000]);
  });

  test('the ceiling is SUMMED from the plan, not written down twice', () => {
    assert.equal(RETRY_CEILING_MS, backoffPlan().reduce((a, b) => a + b, 0));
    assert.equal(RETRY_CEILING_MS, 3000, '3 attempts at 1s doubling is 3s of waiting per project — the stated ceiling');
    assert.equal(READ_ATTEMPTS, 3, 'the attempt count is judgement, pinned here so a change to it is a reviewed diff');
  });

  test('GREEN CONTROL — a read that answers first time is returned, and nothing sleeps', async () => {
    const { slept, sleep } = spySleep();
    let calls = 0;
    const got = await readWithBoundedRetry(
      async () => {
        calls += 1;
        return rows;
      },
      { sleep },
    );
    assert.deepEqual(got, rows);
    assert.equal(calls, 1, 'a healthy read must not be asked twice');
    assert.deepEqual(slept, []);
  });

  test('🔴 THE DEFECT — a TRANSIENT failure followed by a success reads as ok', async () => {
    const { slept, sleep } = spySleep();
    let calls = 0;
    const got = await readWithBoundedRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw transientLook(DROPPED);
        return rows;
      },
      { sleep },
    );
    assert.equal(calls, 2, 'the dropped connection must be re-asked — that is the whole fix');
    assert.deepEqual(slept, [1000], 'exactly the first gap of the bounded plan');

    const v = judgeProject({ ...base, deployments: got });
    assert.equal(v.code, 0, 'a project that answered on the second attempt is healthy, not NOT JUDGED');
    assert.match(v.line, /^ok /);
    assert.equal(foldVerdicts([v], { projectsSwept: 1, ungraded: 0 }).code, 0);
  });

  test('🔴 THE OTHER DIRECTION — a PERSISTENT failure is still COVERAGE LOST, never a pass', async () => {
    const { slept, sleep } = spySleep();
    let calls = 0;
    let thrown = null;
    try {
      await readWithBoundedRetry(
        async () => {
          calls += 1;
          throw transientLook(DROPPED);
        },
        { sleep },
      );
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown instanceof CouldNotLook, 'an outage must still raise the "nothing was judged" error');
    assert.equal(isTransientLook(thrown), false, 'the exhausted error must not still look retryable to a caller');
    assert.equal(calls, READ_ATTEMPTS, 'the retry is BOUNDED — it must not ask for ever');
    assert.deepEqual(slept, backoffPlan(), 'and it must not sleep past its stated ceiling');
    assert.match(thrown.message, /all 3 attempt/);
    assert.match(thrown.message, /over 3s/);

    const v = readFailureResult('nikatru', 'git', thrown);
    assert.equal(v.code, 2, 'a failure that outlived the retry is exit 2 — swallowing it would hide a real outage');
    assert.match(v.line, /^\? /);
    assert.equal(
      foldVerdicts([v], { projectsSwept: 1, ungraded: 0 }).code,
      2,
      'and 2 must survive the fold, because COULD NOT LOOK is not a pass',
    );
  });

  test('a FINAL failure is not re-asked at all — a revoked token does not improve in two seconds', async () => {
    const { slept, sleep } = spySleep();
    let calls = 0;
    await assert.rejects(
      readWithBoundedRetry(
        async () => {
          calls += 1;
          throw new CouldNotLook('answered HTTP 403: Authentication error');
        },
        { sleep },
      ),
      /403/,
    );
    assert.equal(calls, 1, 'three identical 403s in the log is not evidence, it is noise');
    assert.deepEqual(slept, []);
  });

  test('a non-CouldNotLook error escapes at once — a bug in this reader is not a network blip', async () => {
    let calls = 0;
    await assert.rejects(
      readWithBoundedRetry(async () => {
        calls += 1;
        throw new TypeError('x.map is not a function');
      }),
      TypeError,
    );
    assert.equal(calls, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WHICH failures are transient is decided AT THE THROW SITE, so it is asserted
// there too — with `fetch` injected, so not one of these cases touches the
// network or needs a credential.
describe('readDeployments — the transport failing is transient, an ANSWER is final', () => {
  const env = { CLOUDFLARE_API_TOKEN: 'stub-value-not-a-credential', CLOUDFLARE_ACCOUNT_ID: 'stub-account' };
  const answer = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, text: async () => body });

  const caught = async (fetchImpl, over = {}) => {
    try {
      await readDeployments('nikatru', { fetchImpl, env, ...over });
      return null;
    } catch (e) {
      return e;
    }
  };

  test('GREEN CONTROL — a 200 carrying success:true yields the rows', async () => {
    const got = await readDeployments('nikatru', {
      fetchImpl: answer(200, JSON.stringify({ success: true, result: [deployment()] })),
      env,
    });
    assert.equal(got.length, 1);
    assert.equal(got[0].id, 'dep-1');
  });

  test('🔴 `TypeError: fetch failed` — the measured failure — is TRANSIENT', async () => {
    const e = await caught(async () => {
      throw new TypeError('fetch failed');
    });
    assert.ok(e instanceof CouldNotLook);
    assert.equal(isTransientLook(e), true, 'this is the exact throw that froze the merge queue on 2026-09-20');
    assert.match(e.message, /did not complete at all/);
  });

  test('a body that dies mid-read is transient too — the connection dropped either way', async () => {
    const e = await caught(async () => ({
      ok: true,
      status: 200,
      text: async () => {
        throw new TypeError('terminated');
      },
    }));
    assert.equal(isTransientLook(e), true);
  });

  test('HTTP 5xx and HTTP 429 are transient — the API said "not now", not "no"', async () => {
    assert.equal(isTransientLook(await caught(answer(500, 'upstream'))), true);
    assert.equal(isTransientLook(await caught(answer(503, 'unavailable'))), true);
    assert.equal(isTransientLook(await caught(answer(429, 'rate limited'))), true);
  });

  test('🔴 RED CONTROL — HTTP 403 is an ANSWER and must NOT be retried', async () => {
    const e = await caught(answer(403, '{"errors":[{"code":10000}]}'));
    assert.ok(e instanceof CouldNotLook);
    assert.equal(isTransientLook(e), false, 'retrying a revoked token only makes the run slower and the log longer');
  });

  test('RED CONTROL — a 200 that does not parse is final, not a blip to re-ask', async () => {
    const e = await caught(answer(200, '<html>not json'));
    assert.equal(isTransientLook(e), false);
    assert.match(e.message, /unparseable JSON/);
  });

  test('RED CONTROL — success:false is final', async () => {
    const e = await caught(answer(200, JSON.stringify({ success: false, errors: [{ code: 8000000 }] })));
    assert.equal(isTransientLook(e), false);
    assert.match(e.message, /success=false/);
  });

  test('no credential is final, and `fetch` is never called for it', async () => {
    let calls = 0;
    const e = await caught(
      async () => {
        calls += 1;
        return { ok: true, status: 200, text: async () => '{}' };
      },
      { env: {} },
    );
    assert.ok(e instanceof CouldNotLook);
    assert.equal(isTransientLook(e), false, 'a missing token is not going to appear on the second attempt');
    assert.equal(calls, 0, 'the credential is checked BEFORE the network, so a blank environment costs no request');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-26 [ADR 098] — ops-watch run 36277702128 read `✗ nikatru (git)`: the
// Git-connected project `nikatru` serves e154dc6, which does not carry cff2c81.
// Nothing builds that project any more: nikatru.com moved to the Direct Upload
// project `nikatru-apex` (deploy-web.yml's `site` job) and every deployment of
// `nikatru` was switched off, kept for rollback. The reader now derives the site's
// project FROM the job that publishes it, and reads the paused one as DECLARED.

/** A tree whose deploy-web.yml has an app matrix job and a `site` job publishing
 *  sites/nikatru to `project` under the unit `nikatru-site`. */
function siteTree(name, { project = 'nikatru-apex', siteJob = null, rollback = { projects: {} } } = {}) {
  const root = tree(name, { rollback });
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  mkdirSync(join(root, ...dirname(UNITS_REL).split('/')), { recursive: true });
  const site =
    siteJob ??
    '  site:\n    timeout-minutes: 20\n    steps:\n      - run: node tooling/ci/plan-deploy.mjs nikatru-site\n' +
      `      - run: echo stage # --project-name=commented-out\n      - with:\n          command: pages deploy . --project-name=${project} --branch=main\n`;
  writeFileSync(
    join(root, ...DEPLOY_WEB_REL.split('/')),
    'on:\n  workflow_call:\njobs:\n  prepare:\n    timeout-minutes: 5\n    steps:\n      - run: echo apps\n' +
      '  apps:\n    timeout-minutes: 35\n    needs: prepare\n    steps:\n      - run: node tooling/ci/plan-deploy.mjs ${{ matrix.app }}-web\n' +
      '      - with:\n          command: pages deploy build/web --project-name=${{ matrix.app }} --branch=main\n' +
      site,
  );
  writeFileSync(
    join(root, ...UNITS_REL.split('/')),
    JSON.stringify({ deployUnits: { '<app>-web': ['apps/**'], 'nikatru-site': ['sites/nikatru/**', 'sites/_shared/**', 'tooling/sites/**'] } }),
  );
  return root;
}

const SITE_JOB_NO_NAME = '  site:\n    timeout-minutes: 20\n    steps:\n      - run: node tooling/ci/plan-deploy.mjs nikatru-site\n';

const PAUSED = {
  name: 'nikatru',
  subdomain: 'project-nek.pages.dev',
  domains: ['project-nek.pages.dev'],
  source: {
    type: 'github',
    config: { deployments_enabled: false, production_deployments_enabled: false, preview_deployment_setting: 'none' },
  },
  // The build it was paused on: created before pausedAt (DECLARED, below).
  latest_deployment: { id: 'a1b2c3d4-0000-4000-8000-000000000001', created_on: '2026-09-26T15:58:02.123456Z' },
};
const DECLARED = { project: 'nikatru', pausedAt: '2026-09-26T16:31:47Z', servedBy: 'nikatru-apex', decision: 'ADR 098' };
const DERIVED = [
  { project: 'nikatru-apex', kind: 'direct', unit: 'nikatru-site', sourceDir: 'the nikatru-site unit' },
  { project: 'rajasekarselvam', kind: 'git', sourceDir: 'sites/rajasekarselvam' },
];

describe('a site published by a deploy-web job is that job\'s DIRECT project, not a git one', () => {
  test('GREEN CONTROL — sites/nikatru derives to the project the site job names, with its unit', () => {
    const { projects, problems } = derivePagesProjects(siteTree('site-ok'));
    assert.deepEqual(problems, []);
    assert.deepEqual(
      projects.map((p) => `${p.project}:${p.kind}:${p.unit ?? '-'}`),
      ['nikatru-apex:direct:nikatru-site', 'rajasekarselvam:git:-', 'subscriptiontracker:direct:-'],
      'the paused git project `nikatru` must not be derived, and the site project must carry its unit',
    );
  });

  test('siteLanes — a commented `--project-name` names nothing; the matrix job names no literal project', () => {
    const { bySite, problems } = siteLanes(siteTree('site-lanes'));
    assert.deepEqual(problems, []);
    assert.deepEqual([...bySite.entries()], [['nikatru', { unit: 'nikatru-site', job: 'site', project: 'nikatru-apex' }]]);
  });

  test('RED CONTROL — a site job naming no project, or two, is a problem, never a guess', () => {
    const none = siteLanes(siteTree('site-noname', { siteJob: SITE_JOB_NO_NAME }));
    assert.equal(none.bySite.size, 0);
    assert.match(none.problems[0], /job `site` plans deployUnits\["nikatru-site"\].*names \[\] as `--project-name`/);
    const two = siteLanes(
      siteTree('site-twonames', {
        siteJob:
          SITE_JOB_NO_NAME +
          '      - run: wrangler pages deploy . --project-name=nikatru-apex\n      - run: wrangler pages deploy . --project-name=nikatru\n',
      }),
    );
    assert.match(two.problems[0], /names \["nikatru-apex","nikatru"\] as `--project-name`/);
    assert.ok(derivePagesProjects(siteTree('site-noname-derive', { siteJob: SITE_JOB_NO_NAME })).problems.length > 0);
  });

  test('deployLaneInputs({ unit }) — the site\'s own paths, and a ceiling summed from ITS job only', () => {
    const lane = deployLaneInputs(siteTree('site-lane'), { unit: 'nikatru-site' });
    assert.deepEqual(lane.problems, []);
    assert.deepEqual(lane.pathspecs, [':(literal)sites/nikatru', ':(literal)sites/_shared', ':(literal)tooling/sites']);
    assert.equal(lane.ceilingMs, DEPLOY_LANE_RUNS * 20 * 60 * 1000);
    const app = deployLaneInputs(siteTree('site-lane-app'));
    assert.deepEqual(app.pathspecs, [':(literal)apps'], 'the app lane is unchanged by a site unit beside it');
    assert.equal(app.ceilingMs, DEPLOY_LANE_RUNS * (5 + 35) * 60 * 1000);
    assert.match(deployLaneInputs(siteTree('site-lane-none'), { unit: 'no-such-unit' }).problems[0], /has no job planning deployUnits\["no-such-unit"\]/);
  });

  test('🔴 THE REAL TREE — nikatru-apex is derived on the nikatru-site unit; the paused `nikatru` is declared, not derived', () => {
    const { projects, rollbackOnly, problems } = derivePagesProjects(REPO);
    assert.deepEqual(problems, []);
    const apex = projects.find((p) => p.project === 'nikatru-apex');
    assert.ok(apex, 'the project serving nikatru.com is not in the sweep — the defect of ops-watch run 36277702128');
    assert.equal(apex.kind, 'direct');
    assert.equal(apex.unit, 'nikatru-site');
    assert.equal(projects.find((p) => p.project === 'nikatru'), undefined, 'the paused project is judged for freshness again');
    assert.deepEqual(rollbackOnly.map((r) => r.project), ['nikatru']);
    assert.equal(rollbackOnly[0].servedBy, 'nikatru-apex');
    const lane = deployLaneInputs(REPO, { unit: 'nikatru-site' });
    assert.deepEqual(lane.problems, []);
    assert.deepEqual(lane.pathspecs, readUnits(REPO)['nikatru-site'].map(toPathspec));
    assert.deepEqual(lane.globs, readUnits(REPO)['nikatru-site'], 'FPI-1: the site\'s planner question is asked about its own unit');
    assert.equal(lane.ceilingMs, DEPLOY_LANE_RUNS * jobTimeouts(parseWorkflow(REPO, DEPLOY_WEB_REL)).minutes.site * 60 * 1000);
  });
});

describe('readRollbackOnly — the paused state is DECLARED, and a missing declaration is exit 2', () => {
  test('RED CONTROL — no register is a problem, not "nothing is paused"', () => {
    const { problems } = derivePagesProjects(tree('rb-missing', { rollback: null }));
    assert.ok(problems.some((p) => p.includes(`${ROLLBACK_ONLY_REL} does not exist`)));
  });

  test('RED CONTROL — an entry lacking a field, or with an unparseable pausedAt, is a problem', () => {
    const lacking = readRollbackOnly(tree('rb-lacking', { rollback: { projects: { nikatru: { pausedAt: '2026-09-26T16:31:47Z', servedBy: 'nikatru-apex' } } } }));
    assert.deepEqual(lacking.projects, []);
    assert.match(lacking.problems[0], /entry "nikatru" lacks decision, why/);
    const bad = readRollbackOnly(tree('rb-baddate', { rollback: { projects: { nikatru: { ...DECLARED, why: 'x', pausedAt: 'yesterday' } } } }));
    assert.match(bad.problems[0], /pausedAt "yesterday" that does not parse/);
    assert.match(readRollbackOnly(tree('rb-shape', { rollback: { projects: [] } })).problems[0], /holds no `projects` object/);
  });

  test('the real register declares `nikatru`, served by nikatru-apex', () => {
    const { projects, problems } = readRollbackOnly(REPO);
    assert.deepEqual(problems, []);
    assert.deepEqual(projects, [DECLARED]);
  });
});

describe('judgeRollbackOnly — `rollback-only (paused)` only while the account and the repo both agree', () => {
  test('GREEN CONTROL — paused, no custom domain, served by a derived project', () => {
    const r = judgeRollbackOnly({ ...DECLARED, answer: PAUSED, derived: DERIVED });
    assert.equal(r.code, 0);
    assert.equal(r.rollbackOnly, true);
    assert.match(r.line, /^ok {2}nikatru \(git\) — rollback-only \(paused\)/);
  });

  test('🔴 RED CONTROL — a paused project that regains a custom domain', () => {
    const r = judgeRollbackOnly({ ...DECLARED, answer: { ...PAUSED, domains: ['project-nek.pages.dev', 'nikatru.com'] }, derived: DERIVED });
    assert.equal(r.code, 1);
    assert.match(r.line, /holds custom domain\(s\) nikatru\.com/);
  });

  test('🔴 RED CONTROL — each deployment switch coming back on, alone', () => {
    for (const [k, v] of [['deployments_enabled', true], ['production_deployments_enabled', true], ['preview_deployment_setting', 'all']]) {
      const answer = { ...PAUSED, source: { ...PAUSED.source, config: { ...PAUSED.source.config, [k]: v } } };
      const r = judgeRollbackOnly({ ...DECLARED, answer, derived: DERIVED });
      assert.equal(r.code, 1, `${k}=${v} must be red`);
      assert.match(r.line, new RegExp(`deployments are back ON: ${k}=`));
    }
  });

  test('🔴 RED CONTROL — a declared project a site still derives as serving (the old mapping restored)', () => {
    const r = judgeRollbackOnly({ ...DECLARED, answer: PAUSED, derived: [...DERIVED, { project: 'nikatru', kind: 'git', sourceDir: 'sites/nikatru' }] });
    assert.equal(r.code, 1);
    assert.match(r.line, /yet sites\/nikatru still derives it as the git project SERVING it/);
  });

  test('RED CONTROL — servedBy that nothing derives', () => {
    const r = judgeRollbackOnly({ ...DECLARED, answer: PAUSED, derived: DERIVED.filter((p) => p.project !== 'nikatru-apex') });
    assert.equal(r.code, 1);
    assert.match(r.line, /no site directory or catalogue slug derives `nikatru-apex`/);
  });

  // ⏱ 2026-10-01 · PB-20 (row O-PAUSED-PAGES-PROJECT-NIKATRU): the paused copy is the one it was paused on.
  test('🔴 RED CONTROL — a deployment created AFTER the pause', () => {
    const after = { id: 'a1b2c3d4-0000-4000-8000-000000000002', created_on: '2026-09-27T09:00:00Z' };
    const r = judgeRollbackOnly({ ...DECLARED, answer: { ...PAUSED, latest_deployment: after }, derived: DERIVED });
    assert.equal(r.code, 1);
    assert.match(r.line, /newest deployment a1b2c3d4-0000-4000-8000-000000000002 was created 2026-09-27T09:00:00Z, AFTER the pause/);
  });

  test('a deployment created AT the pause instant is the paused build (<=), GREEN', () => {
    const at = { id: 'x', created_on: DECLARED.pausedAt };
    assert.equal(judgeRollbackOnly({ ...DECLARED, answer: { ...PAUSED, latest_deployment: at }, derived: DERIVED }).code, 0);
  });

  test('NOT JUDGED — no newest deployment, or one with no readable created_on', () => {
    assert.equal(judgeRollbackOnly({ ...DECLARED, answer: { ...PAUSED, latest_deployment: null }, derived: DERIVED }).code, 2);
    assert.equal(judgeRollbackOnly({ ...DECLARED, answer: { ...PAUSED, latest_deployment: { id: 'x' } }, derived: DERIVED }).code, 2);
    assert.equal(judgeRollbackOnly({ ...DECLARED, answer: { ...PAUSED, latest_deployment: { id: 'x', created_on: 'soon' } }, derived: DERIVED }).code, 2);
  });

  test('NOT JUDGED — no Git source (a Direct Upload project has no switch), unreadable domains, or another project', () => {
    assert.equal(judgeRollbackOnly({ ...DECLARED, answer: { ...PAUSED, source: null }, derived: DERIVED }).code, 2);
    assert.equal(judgeRollbackOnly({ ...DECLARED, answer: { ...PAUSED, source: { type: 'github', config: {} } }, derived: DERIVED }).code, 2);
    assert.equal(judgeRollbackOnly({ ...DECLARED, answer: { ...PAUSED, domains: null }, derived: DERIVED }).code, 2);
    assert.equal(judgeRollbackOnly({ ...DECLARED, answer: { ...PAUSED, name: 'other' }, derived: DERIVED }).code, 2);
  });

  test('readProject asks for the project RECORD, not its deployments', async () => {
    let url = null;
    const got = await readProject('nikatru', {
      env: { CLOUDFLARE_API_TOKEN: 'stub-value-not-a-credential', CLOUDFLARE_ACCOUNT_ID: 'stub-account' },
      fetchImpl: async (u) => {
        url = u;
        return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, result: PAUSED }) };
      },
    });
    assert.equal(got.name, 'nikatru');
    assert.match(url, /\/accounts\/stub-account\/pages\/projects\/nikatru$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2026-10-02. Ops watch 37024343900 (15:04Z) called nikatru-apex RED: it served
// 7b531c0, not carrying fcf77f1. CI 37020790032 for fcf77f1e was IN PROGRESS —
// its deploy-web jobs started 15:48Z behind GitHub's runner queue. The fixtures
// below are that run as the REST API answered it (recorded, trimmed).
// ─────────────────────────────────────────────────────────────────────────────
describe('judgeDeployRun — a stale direct project asks the CI run for its expected commit (late is not failed)', () => {
  const FIX = join(CI_DIR, 'test', 'fixtures', 'pages-deploy-run');
  const fixture = (name) => JSON.parse(readFileSync(join(FIX, name), 'utf8'));
  const SHA = 'fcf77f1ea3ad9ca37e013e5ce06f4db2f40bd1bd';
  const SERVED = '7b531c04' + '0'.repeat(32);
  const COMMIT_AT = Date.parse('2026-10-02T14:34:11Z');
  const NOW = Date.parse('2026-10-02T15:04:40Z');
  const ENV = { GITHUB_TOKEN: 'x', GITHUB_REPOSITORY: 'o/r' };
  const adHoc = (sha) => deployment({ id: 'fc92f5f5', deployment_trigger: { type: 'ad_hoc', metadata: { branch: 'main', commit_hash: sha } } });
  /** The stale verdict as judgeProject gives it past the lane ceiling. */
  const stale = (project) =>
    judgeProject({
      project,
      kind: 'direct',
      sourceDir: 'the deploy unit',
      deployments: [adHoc(SERVED)],
      expectedCommit: SHA,
      isAncestor: () => false,
      treeUnchanged: () => false,
      now: NOW,
      expectedAt: COMMIT_AT,
      laneCeilingMs: 20 * 60 * 1000,
    });
  /** A fetch that answers the two GitHub reads from recorded fixtures, and records what was asked. */
  const fakeFetch = (runs, jobs, seen = []) => async (url) => {
    seen.push(url);
    const body = url.includes('/jobs?') ? jobs : runs;
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  const lookup = async (runs, jobs, seen) => {
    try {
      return { ok: true, ...(await readDeployRun(SHA, { env: ENV, fetchImpl: fakeFetch(runs, jobs, seen), sleep: async () => {} })) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };
  const judge = async (project, runs, jobs, now = NOW) =>
    judgeDeployRun(stale(project), { project, expectedCommit: SHA, expectedAt: COMMIT_AT, now, deployRun: await lookup(runs, jobs) });

  test('precondition — past the lane ceiling the stale direct row is RED and awaits the run', () => {
    const v = stale('nikatru-apex');
    assert.equal(v.code, 1);
    assert.equal(v.awaitsRun, true);
  });

  test('🔴 THE MEASURED FALSE RED — CI for the expected commit IN PROGRESS: PENDING, exit 0, counted apart', async () => {
    const seen = [];
    const deployRun = await lookup(fixture('runs-in-progress.json'), null, seen);
    const v = judgeDeployRun(stale('nikatru-apex'), { project: 'nikatru-apex', expectedCommit: SHA, expectedAt: COMMIT_AT, now: NOW, deployRun });
    assert.equal(v.code, 0, 'a deploy that has not run yet is late, not failed');
    assert.equal(v.pending, true);
    assert.match(v.line, /^⏸ {3}nikatru-apex \(direct\) — PENDING: .*CI run 37020790032 for fcf77f1.*`in_progress`/);
    assert.equal(seen.length, 1, 'an unfinished run needs no jobs read');
    assert.match(seen[0], new RegExp(`/actions/workflows/${CI_WORKFLOW_FILE.replace('.', '\\.')}/runs\\?branch=main&event=push&head_sha=${SHA}&`));
    const fold = foldVerdicts([v, { code: 0, line: 'x' }], { projectsSwept: 2, ungraded: 0 });
    assert.equal(fold.code, 0);
    assert.equal(fold.pending, 1);
    assert.equal(fold.inflight, 0, 'PENDING is its own count');
  });

  test('🔴 RED CONTROL — the same run QUEUED and the commit 4 h old: STUCK, exit 1', async () => {
    const runs = fixture('runs-in-progress.json');
    runs.workflow_runs[0].status = 'queued';
    const v = await judge('nikatru-apex', runs, null, COMMIT_AT + 4 * 60 * 60 * 1000);
    assert.equal(v.code, 1);
    assert.match(v.line, /STUCK DEPLOY: .*`queued` 240 min after the commit, past the 3-hour ceiling/);
    assert.equal(PENDING_CEILING_MS, 3 * 60 * 60 * 1000);
    const edge = await judge('nikatru-apex', runs, null, COMMIT_AT + PENDING_CEILING_MS);
    assert.equal(edge.code, 0, 'AT the ceiling is still pending; one ms past is stuck');
    assert.equal((await judge('nikatru-apex', runs, null, COMMIT_AT + PENDING_CEILING_MS + 1)).code, 1);
  });

  test('🔴 RED CONTROL — run completed, this project\'s deploy job FAILED: exit 1, naming the job', async () => {
    const v = await judge('subscriptiontracker', fixture('runs-completed.json'), fixture('jobs-completed.json'));
    assert.equal(v.code, 1);
    assert.match(v.line, /DEPLOY FAILED: .*job `deploy-web \/ Build & deploy web to Cloudflare Pages \(subscriptiontracker\)` in CI run 37020790032 .*concluded `failure`/);
  });

  test('🔴 RED CONTROL — run completed, deploy job succeeded, production still stale: exit 1, the existing meaning', async () => {
    const v = await judge('nikatru-apex', fixture('runs-completed.json'), fixture('jobs-completed.json'));
    assert.equal(v.code, 1);
    assert.match(v.line, /which does NOT carry fcf77f1/);
    assert.match(v.line, /CI run 37020790032 for fcf77f1 completed `failure` and its job `deploy-web \/ Deploy the apex site to Cloudflare Pages \(nikatru-apex\)` concluded `success`; production still lacks it\.$/);
    const runs = fixture('runs-completed.json');
    runs.workflow_runs[0].conclusion = 'success';
    const ok = await judge('nikatru-apex', runs, fixture('jobs-completed.json'));
    assert.equal(ok.code, 1, 'completed success but stale is RED');
  });

  test('🔴 RED CONTROL — the lookup fails, finds nothing, or answers for another commit: RED, UNKNOWN, never pending', async () => {
    const cases = [
      ['HTTP 403', async () => ({ ok: false, status: 403, text: async () => '{"message":"Resource not accessible by integration"}' })],
      ['transport', async () => { throw new TypeError('fetch failed'); }],
      ['no run', fakeFetch({ total_count: 0, workflow_runs: [] }, null)],
      ['another sha', fakeFetch({ total_count: 1, workflow_runs: [{ ...fixture('runs-in-progress.json').workflow_runs[0], head_sha: 'f'.repeat(40) }] }, null)],
      ['another branch', fakeFetch({ total_count: 1, workflow_runs: [{ ...fixture('runs-in-progress.json').workflow_runs[0], head_branch: 'feature' }] }, null)],
      ['jobs short of total_count', fakeFetch(fixture('runs-completed.json'), { total_count: 86, jobs: fixture('jobs-completed.json').jobs })],
    ];
    for (const [why, fetchImpl] of cases) {
      let deployRun;
      try {
        deployRun = { ok: true, ...(await readDeployRun(SHA, { env: ENV, fetchImpl, sleep: async () => {} })) };
      } catch (e) {
        deployRun = { ok: false, error: e.message };
      }
      const v = judgeDeployRun(stale('nikatru-apex'), { project: 'nikatru-apex', expectedCommit: SHA, expectedAt: COMMIT_AT, now: NOW, deployRun });
      assert.equal(v.code, 1, `${why}: fail closed`);
      assert.match(v.line, /UNKNOWN: could not read the deploy run for fcf77f1/, why);
      assert.notEqual(v.pending, true, why);
    }
    const other = fixture('runs-in-progress.json');
    other.workflow_runs.push({ ...other.workflow_runs[0], id: 1, head_sha: 'f'.repeat(40) }, { ...other.workflow_runs[0], id: 2, head_branch: 'feature' });
    other.workflow_runs.shift();
    const read = await readDeployRun(SHA, { env: ENV, fetchImpl: fakeFetch(other, null), sleep: async () => {} });
    assert.deepEqual(read, { run: null, jobs: null }, 'a run for another sha or branch is never taken as this commit\'s run');
    const none = judgeDeployRun(stale('nikatru-apex'), { project: 'nikatru-apex', expectedCommit: SHA, expectedAt: COMMIT_AT, now: NOW });
    assert.equal(none.code, 1, 'no lookup at all is RED, UNKNOWN');
    assert.match(none.line, /UNKNOWN/);
    await assert.rejects(readDeployRun(SHA, { env: {}, fetchImpl: fakeFetch(null, null) }), CouldNotLook, 'no token is could-not-look');
  });

  test('a run in progress whose commit age cannot be read is RED, UNKNOWN', async () => {
    const deployRun = await lookup(fixture('runs-in-progress.json'), null);
    const v = judgeDeployRun(stale('nikatru-apex'), { project: 'nikatru-apex', expectedCommit: SHA, expectedAt: null, now: NOW, deployRun });
    assert.equal(v.code, 1);
    assert.match(v.line, /UNKNOWN/);
  });

  test('only a direct row RED past the window is re-judged — green, ⏳, git and exit-2 verdicts pass through untouched', () => {
    const deployRun = { ok: true, run: { ...fixture('runs-in-progress.json').workflow_runs[0] }, jobs: null };
    const young = judgeProject({ project: 'p', kind: 'direct', sourceDir: 'u', deployments: [adHoc(SERVED)], expectedCommit: SHA, isAncestor: () => false, now: NOW, expectedAt: NOW - 60_000, laneCeilingMs: 20 * 60 * 1000 });
    const git = judgeProject({ project: 'p', kind: 'git', sourceDir: 'u', deployments: [deployment({ deployment_trigger: { type: 'github:push', metadata: { commit_hash: SERVED } } })], expectedCommit: SHA, isAncestor: () => false });
    for (const r of [young, git, { code: 0, line: 'ok' }, { code: 2, line: '?' }]) {
      assert.notEqual(r.awaitsRun, true);
      assert.equal(judgeDeployRun(r, { project: 'p', expectedCommit: SHA, expectedAt: COMMIT_AT, now: NOW, deployRun }), r);
    }
    assert.equal(git.code, 1, 'a git-connected stale row stays RED; Cloudflare builds it, no CI run deploys it');
  });

  test('deployJobFor — the caller job prefix and the project suffix, matching ci.yml\'s real caller', () => {
    const jobs = fixture('jobs-completed.json').jobs;
    assert.match(deployJobFor(jobs, 'nikatru-apex').name, /\(nikatru-apex\)$/);
    assert.equal(deployJobFor(jobs, 'nikatru'), null, 'a prefix of a project name is not that project');
    assert.equal(deployJobFor([{ name: 'other / X (nikatru-apex)' }], 'nikatru-apex'), null);
    const ci = parseWorkflow(REPO, `.github/workflows/${CI_WORKFLOW_FILE}`);
    const caller = ci.jobs.get(DEPLOY_CALLER_JOB);
    assert.ok(caller, `ci.yml has a job keyed ${DEPLOY_CALLER_JOB}`);
    const text = caller.lines.map((l) => l.text).join('\n');
    assert.match(text, /^ {4}name: deploy-web\s*$/m, 'its display name is the prefix GitHub gives the called jobs');
    assert.match(text, /uses: \.\/\.github\/workflows\/deploy-web\.yml/);
  });
});
