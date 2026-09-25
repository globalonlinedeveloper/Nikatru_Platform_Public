#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// plan-deploy.mjs — before a unit publishes, ask the Deployment ledger whether
// THIS commit should be published at all.
//
// ⏱ ADDED 2026-09-24 · row O-DEPLOY-IS-NOT-ONE-GATED-LANE, limb (3): "a pre-publish
// step exits 0 as superseded, without publishing, when the target SHA is a strict
// ancestor of the environment's latest successful Deployment".
//
// 🔴 THE FAILURE: A SUPERSEDED SHA OVERWRITES A NEWER ONE. Each deploy workflow run
// publishes the SHA it was started for. Two main pushes close together, or a re-run
// of an older run, finish in whatever order their runners allow, and the older build
// can land last and stay live while the ledger's newest record says otherwise. Nothing
// before this step compared the target with what is already live.
//
// THE DECISION, read against the unit's latest SUCCESSFUL Deployment (the one the
// `record-deployment.mjs <environment>` step wrote after a publish):
//   superseded    the target is a strict ancestor of the live SHA     → no publish
//   already-live  the target IS the live SHA                           → no publish
//   first         the ledger holds no successful Deployment            → publish
//   changed       some path in `git diff <live> <target>` matches one
//                 of the unit's deployUnits globs                      → publish
//   unchanged     the diff matches none of them                        → no publish
//   live-not-in-history  the live SHA is not a commit of this full
//                 clone (a dispatch from a branch since deleted): no
//                 ancestry and no diff can be read against it, and the
//                 target is a gated commit                             → publish
// Every decision exits 0. The step writes `deploy=true|false` and `decision=<d>` to
// $GITHUB_OUTPUT, and every later step of the job carries
// `if: steps.plan.outputs.deploy == 'true'`.
//
// WHY THE LAST SUCCESS AND NOT THE PREVIOUS COMMIT. A deploy that failed or was
// skipped (a red gate, a cancelled run) leaves the ledger at the last SHA that really
// published, so the next run diffs against that and republishes whatever the stranded
// run owed. Diffing against HEAD~1 would forget it.
//
// 🔴 FAIL CLOSED — exit 1, publish nothing — on everything this cannot establish: the
// ledger unreadable (a GitHub refusal, a rate limit past the bound, a malformed
// answer), the clone shallow (ancestry and diff need history: the checkout says
// `fetch-depth: 0`, and deleting that line turns every plan red rather than every
// ancestry check silently false), a glob shape globClaims cannot decide, an
// environment deployUnits does not name. A stale overwrite costs more than a late
// deploy, and the next main push plans again from the last success.
//
// WHY A FILE OF ITS OWN, AND NOT `record-deployment.mjs --plan`. The same reason
// read-ledger-version-code.mjs gives: RECORD_CALL (workflow-scan.mjs) reads every
// `record-deployment.mjs <token>` in a workflow as a ledger WRITE to the environment
// the token names, and assert-publish-records.mjs, assert-ops-register.mjs, the call-
// site floor in deployment-record.test.mjs and limb 2 of assert-release-provenance.mjs
// would each count a plan call placed before the publish as a record call. What stays
// shared is the bounded GitHub client (`api`) and its loopback-only transport.
//
// Usage:
//   node tooling/ci/plan-deploy.mjs <ledgerEnvironment> [--target <40-hex sha>]
//   env:  GH_TOKEN (or GITHUB_TOKEN), GITHUB_REPOSITORY, GITHUB_SHA (the default target)
//         GITHUB_OUTPUT — required when GITHUB_ACTIONS is "true"
//         GITHUB_API_URL — the real origin or loopback only (githubApiBase)
//   The job needs `permissions: deployments: read` (write includes it).
// stdout is ONE JSON line: {decision, deploy, environment, unit, target, lastSuccess,
// matched, matchedTotal}. Diagnostics, and a `decision=<d>` line for a person, go to stderr.
// Exit 0 = decided (publish or not).
//      1 = could not decide, so nothing publishes.
// ─────────────────────────────────────────────────────────────────────────────
import { appendFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, githubApiBase, RateLimitExhausted, limitName, SECONDARY_MIN_WAIT_MS } from './record-deployment.mjs';
import { globClaims } from './assert-deploy-triggers-deploy.mjs';

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
export const UNITS_REL = 'tooling/ci/deploy-units.json';

/** The newest Deployments read from the ledger, and so the most status reads one plan
 *  makes. A Deployment with no success status is one whose status write failed after
 *  its publish (record-deployment.mjs writes both in one step); this many of them in a
 *  row is not a ledger this can read an answer from, so it refuses rather than calling
 *  the unit `first`. */
export const LEDGER_WINDOW = 10;

/** The rate-limit bound for the plan's reads: ONE of GitHub's minimum waits. The
 *  tightest job this runs in (deploy-workers.yml, timeout-minutes 15) already spends
 *  record-deployment.mjs's 10-minute bound after a ~2-minute deploy; a plan that waited
 *  out a second 10 minutes would time the job out before its record step. */
export const PLAN_RATE_LIMIT_BUDGET_MS = SECONDARY_MIN_WAIT_MS;

/** How many matched paths the JSON line lists; `matchedTotal` always carries the count. */
export const MATCHED_SHOWN = 25;

const SHA = /^[0-9a-f]{40}$/;

/** A refusal: the plan could not establish its answer. main() exits 1 on it. */
export class PlanRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = 'PlanRefusal';
  }
}

/** PURE. The unit's globs for a ledger environment: an exact key first, then a
 *  `<app>` template key (`<app>-web` matches `subscriptiontracker-web`). */
export function unitFor(units, environment) {
  if (units && Object.hasOwn(units, environment)) return { key: environment, globs: units[environment] };
  for (const key of Object.keys(units ?? {})) {
    if (!key.startsWith('<app>')) continue;
    const tail = key.slice('<app>'.length);
    if (!environment.endsWith(tail)) continue;
    const app = environment.slice(0, environment.length - tail.length);
    if (/^[a-z0-9][a-z0-9-]*$/.test(app)) return { key, globs: units[key] };
  }
  return null;
}

/** PURE. The changed paths a unit's globs claim. globClaims answers `null` for a
 *  shape it cannot decide, and that is a refusal here, never a "no match". */
export function matchUnit(globs, changedPaths) {
  const matched = [];
  for (const p of changedPaths) {
    let hit = false;
    for (const g of globs) {
      const c = globClaims(g, p);
      if (c === null) throw new PlanRefusal(`the deployUnits glob "${g}" has a shape globClaims cannot decide`);
      if (c) hit = true;
    }
    if (hit) matched.push(p);
  }
  return matched;
}

/**
 * The latest SUCCESSFUL Deployment of `environment`, as `{ sha, id }`, or `null` when
 * the ledger holds none. `fetchJson(path)` is the only way out of the process — the
 * real one is the shared bounded client, a test passes a fixture. Anything it throws,
 * and any answer that is not the shape GitHub documents, propagates as a failure.
 */
export async function readLatestSuccess(environment, fetchJson) {
  const rows = await fetchJson(`deployments?environment=${encodeURIComponent(environment)}&per_page=${LEDGER_WINDOW}`);
  if (!Array.isArray(rows)) throw new PlanRefusal(`GET deployments for "${environment}" did not answer a list`);
  const ordered = rows
    .filter((d) => d && d.environment === environment)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || Number(b.id) - Number(a.id));
  for (const d of ordered) {
    if (!Number.isSafeInteger(d.id) || !SHA.test(String(d.sha))) {
      throw new PlanRefusal(`a Deployment of "${environment}" carries no readable id or sha: ${JSON.stringify({ id: d.id, sha: d.sha })}`);
    }
    const statuses = await fetchJson(`deployments/${d.id}/statuses?per_page=100`);
    if (!Array.isArray(statuses)) throw new PlanRefusal(`GET deployments/${d.id}/statuses did not answer a list`);
    if (statuses.some((s) => s && s.state === 'success')) return { sha: d.sha, id: d.id };
  }
  if (rows.length >= LEDGER_WINDOW) {
    throw new PlanRefusal(
      `the newest ${LEDGER_WINDOW} Deployments of "${environment}" carry no success status, so its last success is not ` +
        'in the window read. Refusing rather than planning as if the unit had never deployed.',
    );
  }
  return null;
}

/** The git reads the plan makes, against a checkout at `cwd`. */
export function gitAt(cwd) {
  const git = (...args) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return {
    isShallow() {
      const r = git('rev-parse', '--is-shallow-repository');
      if (r.status !== 0) throw new PlanRefusal(`git rev-parse --is-shallow-repository failed: ${(r.stderr || '').trim()}`);
      return r.stdout.trim() === 'true';
    },
    hasCommit(sha) {
      return git('cat-file', '-e', `${sha}^{commit}`).status === 0;
    },
    isAncestor(a, b) {
      const r = git('merge-base', '--is-ancestor', a, b);
      if (r.status === 0) return true;
      if (r.status === 1) return false;
      throw new PlanRefusal(`git merge-base --is-ancestor ${a} ${b} failed: ${(r.stderr || '').trim()}`);
    },
    changedFiles(a, b) {
      const r = git('diff', '--name-only', '--no-renames', '-z', a, b);
      if (r.status !== 0) throw new PlanRefusal(`git diff ${a} ${b} failed: ${(r.stderr || '').trim()}`);
      return r.stdout.split('\0').filter(Boolean);
    },
  };
}

/** The decision, from the target, the live SHA and the unit's globs. Throws a
 *  PlanRefusal when it cannot be established. */
export function decide({ target, lastSuccess, globs, git }) {
  if (git.isShallow()) {
    throw new PlanRefusal('the checkout is SHALLOW, so ancestry and the diff cannot be read. The checkout step needs `fetch-depth: 0`.');
  }
  if (!git.hasCommit(target)) throw new PlanRefusal(`the target ${target} is not a commit of this checkout`);
  if (lastSuccess === null) return { decision: 'first', deploy: true, matched: [] };
  if (target === lastSuccess) return { decision: 'already-live', deploy: false, matched: [] };
  if (!git.hasCommit(lastSuccess)) return { decision: 'live-not-in-history', deploy: true, matched: [] };
  if (git.isAncestor(target, lastSuccess)) return { decision: 'superseded', deploy: false, matched: [] };
  const matched = matchUnit(globs, git.changedFiles(lastSuccess, target));
  return { decision: matched.length > 0 ? 'changed' : 'unchanged', deploy: matched.length > 0, matched };
}

/** A flag's value, or null; a flag with no value is a refusal. */
function flagValue(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) throw new PlanRefusal(`--${name} was given with no value`);
  return v;
}

/**
 * The whole step, with every way out of the process injectable. Returns the exit code.
 *   fetchJson — the ledger read (default: the shared bounded client, built from env)
 *   git       — the ancestry and diff reads (default: gitAt(process.cwd()) — git finds the checkout from the step's directory)
 *   units     — deployUnits (default: read from UNITS_REL under root)
 */
export async function runPlan({ argv, env = process.env, root = ROOT, fetchJson = null, git = null, units = null, out = (s) => process.stdout.write(s), log = (s) => console.error(s) }) {
  let environment;
  let target;
  let unit;
  try {
    const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1] === '--target'));
    environment = positional[0];
    if (!environment) throw new PlanRefusal('no ledger environment given — usage: plan-deploy.mjs <ledgerEnvironment> [--target <sha>]');
    target = flagValue(argv, 'target') ?? env.GITHUB_SHA ?? '';
    if (!SHA.test(target)) throw new PlanRefusal(`the target "${target}" is not a 40-hex commit SHA (pass --target, or set GITHUB_SHA)`);
    if (env.GITHUB_ACTIONS === 'true' && !env.GITHUB_OUTPUT) {
      throw new PlanRefusal('GITHUB_OUTPUT is not set inside Actions, so no step could read the decision; every later step would skip in silence');
    }
    const all = units ?? JSON.parse(readFileSync(join(root, UNITS_REL), 'utf8')).deployUnits;
    unit = unitFor(all, environment);
    if (unit === null || !Array.isArray(unit.globs) || unit.globs.length === 0) {
      throw new PlanRefusal(`${UNITS_REL} names no deploy unit for "${environment}", so nothing says which paths it ships`);
    }
  } catch (err) {
    log(`✗ plan ${environment ?? '?'}: ${err.message}`);
    return 1;
  }

  let reader = fetchJson;
  if (reader === null) {
    const repo = env.GITHUB_REPOSITORY;
    const token = env.GH_TOKEN || env.GITHUB_TOKEN;
    if (!repo) return (log('✗ plan: GITHUB_REPOSITORY is not set, so there is no ledger to read'), 1);
    if (!token) return (log('✗ plan: GH_TOKEN / GITHUB_TOKEN is not set — the job needs `permissions: deployments: read`'), 1);
    const transport = githubApiBase(env);
    if (transport.error) return (log(`✗ plan: ${transport.error}`), 1);
    if (transport.override) log(`⬜ GITHUB_API_URL override in effect: ${transport.base} — a LOOPBACK TEST SEAM, not GitHub.`);
    const ctx = { base: transport.base, method: 'GET', rl: { deadline: Date.now() + PLAN_RATE_LIMIT_BUDGET_MS, retries: 0, secondaryStrikes: 0 } };
    reader = (path) => api(path, token, repo, null, ctx);
  }

  let lastSuccess;
  try {
    lastSuccess = await readLatestSuccess(environment, reader);
  } catch (err) {
    const why = err instanceof RateLimitExhausted ? `the ${limitName(err.refusal)} outlasted the plan's bound (${err.why})` : err.message;
    log(`✗ plan ${environment}: the Deployment ledger could not be read — ${why}. FAILING CLOSED: nothing publishes, and the next main push plans again from the last success.`);
    return 1;
  }

  let verdict;
  try {
    verdict = decide({ target, lastSuccess: lastSuccess?.sha ?? null, globs: unit.globs, git: git ?? gitAt(process.cwd()) });
  } catch (err) {
    log(`✗ plan ${environment}: ${err.message}. FAILING CLOSED: nothing publishes.`);
    return 1;
  }

  const line = {
    decision: verdict.decision,
    deploy: verdict.deploy,
    environment,
    unit: unit.key,
    target,
    lastSuccess: lastSuccess?.sha ?? null,
    matched: verdict.matched.slice(0, MATCHED_SHOWN),
    matchedTotal: verdict.matched.length,
  };
  out(`${JSON.stringify(line)}\n`);
  log(
    `plan ${environment}: decision=${verdict.decision} deploy=${verdict.deploy} target=${target.slice(0, 8)} ` +
      `last-success=${line.lastSuccess ? line.lastSuccess.slice(0, 8) : 'none'}` +
      `${verdict.deploy ? '' : ' — NOT publishing'}`,
  );
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `deploy=${verdict.deploy}\ndecision=${verdict.decision}\n`);
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `**plan ${environment}:** \`decision=${verdict.decision}\` · deploy=${verdict.deploy} · target \`${target}\`\n`);
  }
  return 0;
}

async function main() {
  // 🔴 STDOUT IS THE JSON LINE. The shared client prints its "succeeded after N retries"
  // note with console.log; everything but the answer goes to stderr.
  console.log = (...a) => console.error(...a);
  process.exitCode = await runPlan({ argv: process.argv.slice(2) });
}

// Run only when run, not when imported — the same guard as record-deployment.mjs.
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) await main();
