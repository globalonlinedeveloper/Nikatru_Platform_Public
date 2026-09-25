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
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

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
} from '../../ops/check-pages-deployments.mjs';
import { readUnits, UNITS_REL } from '../assert-deploy-triggers-deploy.mjs';
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

/** A tree with the two sources this reader derives from. */
function tree(name, { sites = ['nikatru', 'rajasekarselvam', '_shared'], catalogue = [{ slug: 'subscriptiontracker' }] } = {}) {
  const root = join(TMP, name);
  for (const s of sites) mkdirSync(join(root, 'sites', s), { recursive: true });
  mkdirSync(join(root, 'catalog'), { recursive: true });
  if (catalogue !== null) writeFileSync(join(root, 'catalog', 'apps.json'), JSON.stringify(catalogue));
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
    assert.ok(
      src.includes('per_page=${DEPLOYMENTS_PER_PAGE}'),
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
    for (const need of [':(literal)apps', ':(literal)packages', ':(literal)pubspec.lock', `:(literal)${DEPLOY_WEB_REL}`]) {
      assert.ok(lane.pathspecs.includes(need), `${need} — a web build input the lane redeploys on`);
    }
    const sum = Object.values(jobTimeouts(parseWorkflow(REPO, DEPLOY_WEB_REL)).minutes).reduce((s, m) => s + m, 0);
    assert.ok(sum > 0);
    assert.equal(lane.ceilingMs, DEPLOY_LANE_RUNS * sum * 60 * 1000);
    assert.equal(DEPLOY_LANE_RUNS, 2, 'one run in progress ahead plus its own: the concurrency group never cancels on main');
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
