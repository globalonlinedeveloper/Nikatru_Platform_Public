#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// rollback.mjs — put a recorded Pages deployment or Worker version back live.
//
// Row O-DEPLOY-IS-NOT-ONE-GATED-LANE, limb 4. The revert rows in
// tooling/ops/register.json (revert.web.subscriptiontracker,
// revert.worker.platform, revert.worker.subscriptiontracker-api) named a path a
// person walked by hand in a dashboard, from memory of which build was good.
// The ledger now records WHICH Cloudflare object each deploy published
// (record-deployment.mjs, PUBLISHED_ID_KEYS), so a revert is: name the ledger
// Deployment that was good, and put its object back. rollback.yml runs this.
//
// In order, and nothing changes before step 3:
//   1. --unit is resolved against tooling/channel-register.json: a web unit
//      (`<app>-web`), a service unit (a `serviceEnvironments` row) or, since
//      2026-10-01 (PB-07, row O-APEX-SITE-HAS-NO-ROLLBACK), a site unit (a
//      `siteEnvironments` row naming its Direct Upload `pagesProject`). Anything
//      else is refused, and a DATABASE is refused by name — D1 schema is never
//      rolled back (register row revert.d1.schema, owner-run).
//   2. ledger Deployment --deployment is read from GitHub. It must be on that
//      unit's environment, carry a `success` status, and name the id of what it
//      published. A record written before the id existed names none: "nothing
//      to re-promote", exit 1.
//   2b. the unit's FLOORS (tooling/ops/rollback-floors.json) are checked: the recorded
//      commit must be each floor or a descendant of it (THE FLOOR, below).
//   3. it is re-promoted:
//        web     → POST {CLOUDFLARE_API}/accounts/<account>/pages/projects/<app>/
//                  deployments/<id>/rollback. The pinned wrangler has no Pages
//                  rollback command, so this is the API call.
//        site    → the same call, on the row's `pagesProject`.
//        ⏱ 2026-10-02 · PB-09: a Pages target that is ALREADY the project's
//        production deployment (its `canonical_deployment`, read with
//        check-pages-deployments.mjs's readProject) is `already live: <id>` and
//        no POST is made; Cloudflare's 8000039 ("currently in production") is
//        the same no-op. Both write the same outputs as a re-promotion, so the
//        smoke and the record still run.
//        service → `wrangler rollback <version-id> --message … --yes`, from the
//                  wrangler island, in the service's directory, whose config
//                  names the Worker exactly as the deploy's does.
//      `--dry-run` stops before this step and prints the exact command.
//   4. the RESOLVED unit, the recorded SHA, the id, the URL and the smoke the
//      deploy runs go to $GITHUB_OUTPUT, for rollback.yml's smoke and record
//      steps. The record step names `unit` from here, never the raw input.
//      ⏱ 2026-10-01 · PB-08 (row O-EDGE-SHIELD-ROLLBACK-SMOKE-MISFIT): the smoke is
//      a SCRIPT and its ARGUMENTS, the unit's register row's `rollbackSmoke` when it
//      names one, else its kind's (SMOKE below). rollback.yml runs it back through
//      `rollback.mjs --run-smoke`, which runs only a script SMOKE_SCRIPTS names.
//
// 🔴 THE LEDGER GETS THE RE-PROMOTED SHA, NOT main's HEAD. rollback.yml records
// the outcome with `--rollback-of <id> --ref <that sha>`. plan-deploy.mjs reads
// the newest successful Deployment as what is live; had a rollback recorded
// HEAD, the next push to main would plan "already live" and never roll forward.
// The flip side is deliberate too: the next push that touches the unit DOES
// redeploy main, so the change that was rolled back must be reverted on main.
//
// UNVERIFIED, which is why rollback.yml's dry_run input defaults to true: the
// Pages endpoint is named by the cloudflare SDK bundled in wrangler 4.129.0 on
// disk (not the pinned 4.135.0, and never called from here); the Pages
// deployment id's shape is assumed (a UUID); and `--yes` answering wrangler's
// changed-secrets confirmation is read from that same source.
//
// Usage:
//   node tooling/ops/rollback.mjs --unit <ledger environment> --deployment <ledger Deployment id> [--dry-run]
//   node tooling/ops/rollback.mjs --run-smoke     env: SMOKE_SCRIPT, SMOKE_ARGS (this script's outputs)
//   env: GH_TOKEN (or GITHUB_TOKEN), GITHUB_REPOSITORY, GITHUB_API_URL (the real origin or
//        loopback, as record-deployment.mjs's githubApiBase allows); for a real run
//        CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID; GITHUB_RUN_ID, when set, is
//        named in the Worker rollback's message.
// Exit 0 = re-promoted, or already live (a Pages target, PB-09), or with --dry-run, the command printed.
//      1 = refused or failed. Nothing was re-promoted unless a line above says so.
// ─────────────────────────────────────────────────────────────────────────────
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, posix } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveEnvironment } from '../ci/deployment-record.mjs';
import { api, githubApiBase, CLOUDFLARE_ID, workerVersionIdFrom } from '../ci/record-deployment.mjs';
import { readProject, readWithBoundedRetry } from './check-pages-deployments.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGISTER_REL = 'tooling/channel-register.json';
/** The wrangler island (tooling/wrangler/package.json pins the version). */
export const WRANGLER_REL = 'tooling/wrangler/node_modules/.bin/wrangler';
export const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';
const CALL_TIMEOUT_MS = 60_000;
const WRANGLER_TIMEOUT_MS = 5 * 60_000;

/** The scripts a smoke may run: each kind's deploy smoke, and each per-unit one a
 *  register row names. `--run-smoke` refuses any other, so an edited output or row
 *  cannot turn the smoke step into a way to run something else. */
export const SMOKE_SCRIPTS = Object.freeze([
  'tooling/ops/post-deploy-smoke.mjs',
  'tooling/sites/smoke-site-deploy.mjs',
  'tooling/ops/check-edge-shield.mjs',
]);

/** The smoke each kind of unit's DEPLOY runs, so a re-promotion is judged the
 *  way a promotion is: a script and its arguments, where `{url}` is the record's
 *  environment URL, `{sha}` its commit, and `{run_number}` its payload's run. A
 *  register row's `rollbackSmoke` (same shape) replaces its kind's (PB-08). */
export const SMOKE = Object.freeze({
  // deploy-web.yml: `<site_url>/version.json --field build_number --expect ${{ github.run_number }}`.
  // A build's number is the run number that built it, and the record's payload
  // names that run as `run_number`.
  web: Object.freeze({
    script: 'tooling/ops/post-deploy-smoke.mjs',
    args: Object.freeze(['--url', '{url}/version.json', '--field', 'build_number', '--expect', '{run_number}']),
  }),
  // deploy-workers.yml: `/v1/health --field build --expect ${{ github.sha }} --require-ok`.
  // A Worker version keeps the vars it was deployed with, RELEASE among them.
  service: Object.freeze({
    script: 'tooling/ops/post-deploy-smoke.mjs',
    args: Object.freeze(['--url', '{url}/v1/health', '--field', 'build', '--expect', '{sha}', '--require-ok']),
  }),
  // deploy-web.yml's `site` job: `smoke-site-deploy.mjs --origin https://nikatru.com --expect-sha ${{ github.sha }}`.
  // version.json is stamped into the uploaded copy, so a re-promoted deployment serves its own SHA.
  site: Object.freeze({
    script: 'tooling/sites/smoke-site-deploy.mjs',
    args: Object.freeze(['--origin', '{url}', '--expect-sha', '{sha}']),
  }),
});

/** PURE. A smoke `{ script, args }` (a kind's, or a row's `rollbackSmoke`) as the
 *  exact argv to run, its placeholders filled from the plan. A Refusal for a script
 *  SMOKE_SCRIPTS does not name, an argument that is not a string, a placeholder this
 *  does not know, or a value it cannot join on. */
export function smokeArgv(smoke, { url, sha, runNumber }, ledgerId) {
  if (!smoke || !SMOKE_SCRIPTS.includes(smoke.script)) {
    throw new Refusal(`the unit's smoke script ${JSON.stringify(smoke?.script ?? null)} is not one of ${SMOKE_SCRIPTS.join(', ')}`);
  }
  if (!Array.isArray(smoke.args) || !smoke.args.every((a) => typeof a === 'string')) {
    throw new Refusal(`the unit's smoke arguments for ${smoke.script} are not a list of strings`);
  }
  const values = { url, sha, run_number: runNumber === null || runNumber === undefined ? null : String(runNumber) };
  const args = smoke.args.map((a) =>
    a.replace(/\{([a-z_]+)\}/g, (_, name) => {
      if (!Object.hasOwn(values, name)) throw new Refusal(`the unit's smoke names a placeholder {${name}} this does not fill`);
      const v = values[name];
      const ok = name === 'url' ? /^https:\/\/[^\s]+$/.test(v ?? '') : /^[0-9A-Za-z]+$/.test(v ?? '');
      if (!ok) {
        throw new Refusal(
          `ledger Deployment ${ledgerId} names no ${name}, so the smoke could not tell the re-promoted build from any other.`,
        );
      }
      return v;
    }),
  );
  return { script: smoke.script, args };
}

/** A refusal: said in words, exit 1, nothing changed. */
export class Refusal extends Error {}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}

/** Every D1 database name and binding the services declare, read from their configs:
 *  a database added later is refused by name the day it is bound. */
export function databaseNames(root = ROOT) {
  const names = new Set();
  const dir = join(root, 'services');
  if (!existsSync(dir)) return names;
  for (const svc of readdirSync(dir)) {
    const f = join(dir, svc, 'wrangler.jsonc');
    if (!existsSync(f)) continue;
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/"binding"\s*:\s*"([^"]+)"\s*,\s*"database_name"\s*:\s*"([^"]+)"/g)) {
      names.add(m[1]);
      names.add(m[2]);
    }
  }
  return names;
}
const DATABASE_WORD = /(^|[-_.])(d1|db|database)([-_.]|$)/i;

/** PURE. The unit a rollback may act on, or a Refusal saying why not. */
export function resolveUnit(register, unit, dbNames = new Set()) {
  if (dbNames.has(unit) || DATABASE_WORD.test(unit)) {
    throw new Refusal(
      `"${unit}" names a database. D1 schema is never rolled back: migrations are additive-only, and rows written ` +
        'since cannot be unwritten (register row revert.d1.schema, owner-run). This re-promotes a Pages deployment ' +
        'or a Worker version, nothing else.',
    );
  }
  const resolved = resolveEnvironment(register, unit);
  if (resolved === null) {
    const services = (register?.serviceEnvironments ?? []).map((s) => s.deploymentEnvironment).join(', ');
    throw new Refusal(
      `no row in ${REGISTER_REL} claims the unit "${unit}". A unit is a ledger environment: "<app>-web", or a ` +
        `service (${services}).`,
    );
  }
  const { kind } = resolved.channel;
  // PB-08: the unit's own smoke, when its row names one, in place of its kind's.
  const smoke = resolved.channel.rollbackSmoke ?? SMOKE[kind] ?? null;
  if (kind === 'web') return { kind, unit, project: resolved.app, idKey: 'pages_deployment_id', idFlag: '--pages-deployment-id', smoke };
  if (kind === 'service') return { kind, unit, dir: resolved.channel.source, idKey: 'worker_version_id', idFlag: '--worker-version-id', smoke };
  if (kind === 'site') {
    const project = resolved.channel.pagesProject;
    if (typeof project !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(project)) {
      throw new Refusal(
        `"${unit}" is a site, and its ${REGISTER_REL} row names no \`pagesProject\`: there is no Direct Upload project to ` +
          'put a deployment back on.',
      );
    }
    return { kind, unit, project, idKey: 'pages_deployment_id', idFlag: '--pages-deployment-id', smoke };
  }
  throw new Refusal(
    `"${unit}" is the ${resolved.channel.id} channel (kind: ${kind}), which is not re-promoted here: the store or the ` +
      'download host holds that build, and its own console is where a release is halted.',
  );
}

/** PURE. A Deployment's payload as GitHub returns it — an object, a JSON
 *  string, or nothing — as an object, empty when there is none. */
export function payloadOf(deployment) {
  let raw = deployment?.payload;
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

/** PURE. What to put back, from the ledger Deployment and its statuses, or a
 *  Refusal. `{ sha, id, environmentUrl, smoke: { script, args } }`. */
export function planRollback(target, deployment, statuses, ledgerId) {
  if (deployment?.environment !== target.unit) {
    throw new Refusal(
      `ledger Deployment ${ledgerId} is on "${deployment?.environment}", not "${target.unit}". A Deployment is ` +
        're-promoted only onto the unit that recorded it.',
    );
  }
  const sha = String(deployment.sha ?? '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Refusal(`ledger Deployment ${ledgerId} names no full commit SHA`);
  const payload = payloadOf(deployment);
  // A re-promotion's own record names the rollback run, not the build: its
  // run_number is not the build_number the site serves. Name the original.
  if (payload.rollback === true) {
    throw new Refusal(
      `ledger Deployment ${ledgerId} is itself a re-promotion, of ledger Deployment ${payload.rollback_of}. Name that ` +
        'one: it recorded the build, and its run number is the one the smoke expects.',
    );
  }
  const id = payload[target.idKey];
  if (id === null || id === undefined) {
    throw new Refusal(
      `nothing to re-promote: ledger Deployment ${ledgerId} (${sha.slice(0, 8)} on ${target.unit}) names no ` +
        `${target.idKey}. Records written before the id was captured name none, and neither does a deploy whose ` +
        'step gave none (its record step printed a warning). Pick a later Deployment, or revert on main.',
    );
  }
  if (typeof id !== 'string' || !CLOUDFLARE_ID.test(id)) {
    throw new Refusal(`ledger Deployment ${ledgerId}'s ${target.idKey} is not an id, so it names nothing to put back`);
  }
  const live = (Array.isArray(statuses) ? statuses : []).find((s) => s?.state === 'success');
  if (!live) {
    throw new Refusal(
      `ledger Deployment ${ledgerId} has no success status: it never recorded a deploy that went live, so it is ` +
        'not a known-good state to go back to.',
    );
  }
  const environmentUrl = String(live.environment_url ?? '').replace(/\/+$/, '');
  if (!/^https:\/\/[^\s]+$/.test(environmentUrl)) {
    throw new Refusal(`ledger Deployment ${ledgerId} names no https environment URL, so no smoke could ask it anything`);
  }
  const smoke = smokeArgv(target.smoke ?? SMOKE[target.kind], { url: environmentUrl, sha, runNumber: payload.run_number }, ledgerId);
  return { sha, id: id.toLowerCase(), environmentUrl, smoke };
}

// ── THE FLOOR ────────────────────────────────────────────────────────────────
// ⏱ 2026-10-02 · #1104 post-merge review, finding 1 (lane fix-1104-followups). A unit can carry
// a FLOOR in tooling/ops/rollback-floors.json: the first build that writes data the builds before
// it misread. Re-promoting a commit that is not the floor or a descendant of it is refused, BEFORE
// anything changes. Ancestry is asked of GitHub's compare API (`compare/<floor>...<sha>`: ahead or
// identical passes; behind or diverged is under the floor), because rollback.yml checks out one
// commit and local git could not answer. An answer this cannot read is a refusal too: a floor it
// cannot prove is met is not met.
export const FLOORS_REL = 'tooling/ops/rollback-floors.json';

/** PURE. The floors declared for `unit`, validated; a malformed file is a Refusal, never "no floor". */
export function floorsFor(doc, unit) {
  if (!Array.isArray(doc?.floors)) throw new Refusal(`${FLOORS_REL} has no "floors" array, so no floor could be checked`);
  const mine = doc.floors.filter((f) => f?.unit === unit);
  for (const f of mine) {
    if (!/^[0-9a-f]{40}$/.test(String(f.sha ?? '')) || typeof f.why !== 'string' || f.why.length < 20) {
      throw new Refusal(`${FLOORS_REL}: the floor for "${unit}" needs a full commit "sha" and a "why" (20+ characters)`);
    }
  }
  return mine;
}

/** PURE. A compare status for `<floor>...<sha>` → null when the floor is met, else the Refusal message. */
export function floorVerdict(floor, sha, compareStatus) {
  if (compareStatus === 'ahead' || compareStatus === 'identical') return null;
  const what =
    compareStatus === 'behind'
      ? `is OLDER than the floor ${floor.sha.slice(0, 8)}`
      : compareStatus === 'diverged'
      ? `is not a descendant of the floor ${floor.sha.slice(0, 8)} (the histories diverged)`
      : `could not be placed against the floor ${floor.sha.slice(0, 8)} (compare answered ${JSON.stringify(compareStatus)})`;
  return (
    `${sha.slice(0, 8)} ${what} that ${FLOORS_REL} sets for "${floor.unit}" since ${floor.since} (${floor.row}): ${floor.why} ` +
    'Re-promote a Deployment at or after the floor, or revert the change on main instead.'
  );
}

/** PURE. The Worker rollback's message: wrangler caps it at 120 characters. */
export const rollbackMessage = (ledgerId, sha, runId) =>
  `rollback.yml${runId ? ` run ${runId}` : ''}: ledger Deployment ${ledgerId} (${sha.slice(0, 8)})`.slice(0, 120);

/** PURE. The exact command a real run executes, as one line a person can paste.
 *  The Pages call is written as the curl it is equivalent to; the account and
 *  the token stay variable names, never values. */
export function commandFor(target, plan, message) {
  if (target.kind === 'web' || target.kind === 'site') {
    return (
      `curl -fsS -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" ` +
      `"${CLOUDFLARE_API}/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/${target.project}/deployments/${plan.id}/rollback"`
    );
  }
  const bin = posix.relative(target.dir, WRANGLER_REL);
  return `(cd ${target.dir} && ${bin} rollback ${plan.id} --message "${message}" --yes)`;
}

/** The values rollback.yml's later steps read. Each is one line or it is not written. */
function writeOutputs(values) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const lines = Object.entries(values).map(([k, v]) => {
    if (/[\r\n]/.test(String(v))) throw new Error(`output ${k} spans lines`);
    return `${k}=${v}\n`;
  });
  appendFileSync(file, lines.join(''));
}

function flagValue(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) throw new Refusal(`--${name} was given with no value`);
  return v;
}

/** Cloudflare's answer to a Pages rollback whose target is the deployment already
 *  in production: `8000039: You cannot rollback to the deployment that is currently
 *  in production.` (PB-09 drill, 2026-10-02, runs 36970520119 and 36970542712). */
export const PAGES_ALREADY_LIVE = 8000039;

/** PURE. The id of the deployment a Pages project serves in production — its
 *  `canonical_deployment`, as readProject returns the project — or null when the
 *  answer names none that is an id. */
export function productionDeploymentId(project) {
  const id = project?.canonical_deployment?.id;
  return typeof id === 'string' && CLOUDFLARE_ID.test(id) ? id.toLowerCase() : null;
}

/** PURE. Whether a refused rollback's body is Cloudflare saying the target is already live. */
export const refusedAsAlreadyLive = (body) =>
  Array.isArray(body?.errors) && body.errors.some((e) => Number(e?.code) === PAGES_ALREADY_LIVE);

/** Re-promote a Pages deployment. Returns `{ alreadyLive }`: TRUE when the target
 *  is the project's production deployment already, read first through
 *  check-pages-deployments.mjs's readProject (no POST is made), or when Cloudflare
 *  answers 8000039 because it became live between that read and the POST. Either
 *  way nothing changed and the run goes on to the smoke and the record, exactly
 *  as a real re-promotion does: a drill on the newest record proves the path. */
async function pagesRollback(target, plan) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token) throw new Refusal('CLOUDFLARE_API_TOKEN is not set');
  if (!account || !/^[0-9A-Za-z]+$/.test(account)) throw new Refusal('CLOUDFLARE_ACCOUNT_ID is not set, or is not an account id');
  // A failed read is not a refusal: the POST decides, and 8000039 is handled below.
  let live = null;
  try {
    const project = await readWithBoundedRetry((_attempt, { signal }) => readProject(target.project, { signal }), {
      note: (m) => console.log(`  ⟳ ${target.project} production deployment — ${m}`),
    });
    live = productionDeploymentId(project);
  } catch (e) {
    console.log(`::warning title=production deployment not read::${String(e?.message ?? e).split('\n')[0]} — re-promoting without it.`);
  }
  if (live === plan.id) {
    console.log(`already live: ${plan.id}`);
    return { alreadyLive: true };
  }
  const url = `${CLOUDFLARE_API}/accounts/${account}/pages/projects/${target.project}/deployments/${plan.id}/rollback`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': 'nikatru-rollback' },
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // named below
  }
  if (!res.ok || body?.success !== true) {
    if (refusedAsAlreadyLive(body)) {
      console.log(`already live: ${plan.id}`);
      return { alreadyLive: true };
    }
    const errors = (body?.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('; ') || text.slice(0, 200);
    throw new Refusal(`Cloudflare refused the Pages rollback (HTTP ${res.status}): ${errors}. Nothing was re-promoted.`);
  }
  return { alreadyLive: false };
}

function workerRollback(target, plan, message) {
  const bin = join(ROOT, WRANGLER_REL);
  if (!existsSync(bin)) {
    throw new Refusal(`the wrangler island is not installed (${WRANGLER_REL}): run \`npm ci --ignore-scripts --prefix tooling/wrangler\` first`);
  }
  const r = spawnSync(bin, ['rollback', plan.id, '--message', message, '--yes'], {
    cwd: join(ROOT, target.dir),
    encoding: 'utf8',
    timeout: WRANGLER_TIMEOUT_MS,
    env: process.env,
  });
  // Only the lines that say what went live: the rest is wrangler's own chatter.
  for (const line of String(r.stdout ?? '').split('\n')) {
    if (/Worker Version .* has been deployed|Current Version ID:/.test(line)) console.log(`  ${line.trim()}`);
  }
  if (r.error || r.status !== 0) {
    const tail = String(r.stderr ?? '').trim().split('\n').slice(-10).join('\n    ');
    throw new Refusal(`\`wrangler rollback\` exited ${r.error ? r.error.message : r.status}${tail ? `:\n    ${tail}` : ''}`);
  }
  const live = workerVersionIdFrom(r.stdout);
  if (live === null) {
    console.log('::warning title=wrangler named no live version::`wrangler rollback` exited 0 and printed no `Current Version ID:` line; the smoke is the check.');
  } else if (live !== plan.id) {
    throw new Refusal(`\`wrangler rollback\` reports ${live} live, not ${plan.id}. The Worker is NOT on the recorded version.`);
  }
}

/** PURE. The smoke rollback.yml hands back (`SMOKE_SCRIPT`, `SMOKE_ARGS` — this
 *  script's own outputs) as `{ script, args }`, or a Refusal: only a script
 *  SMOKE_SCRIPTS names, with a JSON list of strings, is ever run. */
export function smokeFromEnv(env) {
  const script = env.SMOKE_SCRIPT;
  if (!SMOKE_SCRIPTS.includes(script)) {
    throw new Refusal(`SMOKE_SCRIPT ${JSON.stringify(script ?? null)} is not one of ${SMOKE_SCRIPTS.join(', ')}; nothing was run`);
  }
  let args;
  try {
    args = JSON.parse(env.SMOKE_ARGS ?? '');
  } catch {
    args = null;
  }
  if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) {
    throw new Refusal('SMOKE_ARGS is not a JSON list of strings; nothing was run');
  }
  return { script, args };
}

/** `--run-smoke`: run the unit's smoke and exit with ITS code (0, 1, or 2 for could-not-look). */
function runSmoke() {
  let smoke;
  try {
    smoke = smokeFromEnv(process.env);
  } catch (e) {
    return fail(e.message);
  }
  console.log(`smoke · node ${smoke.script} ${smoke.args.join(' ')}`);
  const r = spawnSync(process.execPath, [join(ROOT, smoke.script), ...smoke.args], { cwd: ROOT, stdio: 'inherit', env: process.env });
  if (r.error) return fail(`the smoke did not run: ${r.error.message}`);
  process.exitCode = r.status ?? 1;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 1 && argv[0] === '--run-smoke') return runSmoke();
  let unit;
  let ledgerId;
  try {
    unit = flagValue(argv, 'unit');
    ledgerId = flagValue(argv, 'deployment');
  } catch (e) {
    return fail(e.message);
  }
  const dryRun = argv.includes('--dry-run');
  const known = new Set(['--unit', '--deployment', '--dry-run', unit, ledgerId]);
  const stray = argv.find((a) => !known.has(a));
  if (stray !== undefined) return fail(`unexpected argument "${stray}"`);
  if (!unit || !ledgerId) return fail('usage: rollback.mjs --unit <ledger environment> --deployment <ledger Deployment id> [--dry-run]');
  if (!/^[1-9]\d*$/.test(ledgerId)) return fail(`--deployment "${ledgerId}" is not a ledger Deployment id (a whole number)`);

  let target;
  try {
    const register = JSON.parse(readFileSync(join(ROOT, REGISTER_REL), 'utf8'));
    target = resolveUnit(register, unit, databaseNames());
  } catch (e) {
    return fail(e.message);
  }

  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!repo) return fail('GITHUB_REPOSITORY is not set');
  if (!token) return fail('GH_TOKEN / GITHUB_TOKEN is not set — the ledger is read with it');
  const transport = githubApiBase();
  if (transport.error) return fail(transport.error);
  const ctx = { base: transport.base, method: 'GET', rl: { deadline: null, retries: 0, secondaryStrikes: 0 } };

  let plan;
  try {
    const deployment = await api(`deployments/${ledgerId}`, token, repo, null, ctx);
    const statuses = await api(`deployments/${ledgerId}/statuses`, token, repo, null, ctx);
    plan = planRollback(target, deployment, statuses, ledgerId);
  } catch (e) {
    return fail(e instanceof Refusal ? e.message : `could not read ledger Deployment ${ledgerId}: ${e.message}`);
  }

  // The floor, before anything changes — a dry run included, so a rehearsal says what a real run would.
  try {
    const floors = floorsFor(JSON.parse(readFileSync(join(ROOT, FLOORS_REL), 'utf8')), unit);
    for (const floor of floors) {
      let status;
      try {
        status = (await api(`compare/${floor.sha}...${plan.sha}`, token, repo, null, ctx))?.status;
      } catch (e) {
        status = `unreadable: ${e.message}`;
      }
      const refusal = floorVerdict(floor, plan.sha, status);
      if (refusal) throw new Refusal(refusal);
      console.log(`  floor: ${plan.sha.slice(0, 8)} is at or after ${floor.sha.slice(0, 8)} (${floor.row}) — compare says ${status}`);
    }
  } catch (e) {
    return fail(e instanceof Refusal ? e.message : `could not read ${FLOORS_REL}: ${e.message}`);
  }

  const message = rollbackMessage(ledgerId, plan.sha, process.env.GITHUB_RUN_ID);
  console.log(
    `${dryRun ? 'DRY RUN · ' : ''}re-promote ${unit} to ledger Deployment ${ledgerId} ` +
      `(${plan.sha.slice(0, 8)}), ${target.idKey} ${plan.id}`,
  );
  console.log(`  $ ${commandFor(target, plan, message)}`);
  const outputs = {
    unit: target.unit,
    kind: target.kind,
    sha: plan.sha,
    id_flag: target.idFlag,
    id: plan.id,
    environment_url: plan.environmentUrl,
    smoke_script: plan.smoke.script,
    smoke_args: JSON.stringify(plan.smoke.args),
  };
  if (dryRun) {
    writeOutputs({ dry_run: 'true', ...outputs });
    console.log('  --dry-run: nothing was re-promoted.');
    return;
  }

  let alreadyLive = false;
  try {
    if (target.kind === 'web' || target.kind === 'site') ({ alreadyLive } = await pagesRollback(target, plan));
    else workerRollback(target, plan, message);
  } catch (e) {
    return fail(e.message);
  }
  writeOutputs({ dry_run: 'false', ...outputs });
  console.log(
    `ok  ${unit} ${alreadyLive ? 'is already live on' : 're-promoted to'} ${plan.sha.slice(0, 8)} (${target.idKey} ${plan.id})` +
      `${alreadyLive ? ': nothing was changed' : ''}. The smoke and the ledger record are the next two steps.`,
  );
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) await main();
