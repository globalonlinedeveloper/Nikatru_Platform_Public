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
//      (`<app>-web`) or a service unit (a `serviceEnvironments` row). Anything
//      else is refused, and a DATABASE is refused by name — D1 schema is never
//      rolled back (register row revert.d1.schema, owner-run).
//   2. ledger Deployment --deployment is read from GitHub. It must be on that
//      unit's environment, carry a `success` status, and name the id of what it
//      published. A record written before the id existed names none: "nothing
//      to re-promote", exit 1.
//   3. it is re-promoted:
//        web     → POST {CLOUDFLARE_API}/accounts/<account>/pages/projects/<app>/
//                  deployments/<id>/rollback. The pinned wrangler has no Pages
//                  rollback command, so this is the API call.
//        service → `wrangler rollback <version-id> --message … --yes`, from the
//                  wrangler island, in the service's directory, whose config
//                  names the Worker exactly as the deploy's does.
//      `--dry-run` stops before this step and prints the exact command.
//   4. the RESOLVED unit, the recorded SHA, the id, the URL and the smoke the
//      deploy runs go to $GITHUB_OUTPUT, for rollback.yml's smoke and record
//      steps. The record step names `unit` from here, never the raw input.
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
//   env: GH_TOKEN (or GITHUB_TOKEN), GITHUB_REPOSITORY, GITHUB_API_URL (the real origin or
//        loopback, as record-deployment.mjs's githubApiBase allows); for a real run
//        CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID; GITHUB_RUN_ID, when set, is
//        named in the Worker rollback's message.
// Exit 0 = re-promoted, or with --dry-run, the command printed.
//      1 = refused or failed. Nothing was re-promoted unless a line above says so.
// ─────────────────────────────────────────────────────────────────────────────
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, posix } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveEnvironment } from '../ci/deployment-record.mjs';
import { api, githubApiBase, CLOUDFLARE_ID, workerVersionIdFrom } from '../ci/record-deployment.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGISTER_REL = 'tooling/channel-register.json';
/** The wrangler island (tooling/wrangler/package.json pins the version). */
export const WRANGLER_REL = 'tooling/wrangler/node_modules/.bin/wrangler';
export const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';
const CALL_TIMEOUT_MS = 60_000;
const WRANGLER_TIMEOUT_MS = 5 * 60_000;

/** The smoke each kind of unit's DEPLOY runs, so a re-promotion is judged the
 *  way a promotion is. `expectFrom` names where the expected value comes from:
 *  the record's SHA, or a key of its payload. */
export const SMOKE = Object.freeze({
  // deploy-web.yml: `<site_url>/version.json --field build_number --expect ${{ github.run_number }}`.
  // A build's number is the run number that built it, and the record's payload
  // names that run as `run_number`.
  web: Object.freeze({ path: '/version.json', field: 'build_number', expectFrom: 'run_number', requireOk: false }),
  // deploy-workers.yml: `/v1/health --field build --expect ${{ github.sha }} --require-ok`.
  // A Worker version keeps the vars it was deployed with, RELEASE among them.
  service: Object.freeze({ path: '/v1/health', field: 'build', expectFrom: 'sha', requireOk: true }),
});

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
  if (kind === 'web') return { kind, unit, project: resolved.app, idKey: 'pages_deployment_id', idFlag: '--pages-deployment-id' };
  if (kind === 'service') return { kind, unit, dir: resolved.channel.source, idKey: 'worker_version_id', idFlag: '--worker-version-id' };
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
 *  Refusal. `{ sha, id, environmentUrl, smoke: {url, field, expect, requireOk} }`. */
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
  const smoke = SMOKE[target.kind];
  const expect = smoke.expectFrom === 'sha' ? sha : payload[smoke.expectFrom];
  if (expect === null || expect === undefined || !/^[0-9A-Za-z]+$/.test(String(expect))) {
    throw new Refusal(
      `ledger Deployment ${ledgerId} names no ${smoke.expectFrom}, so the smoke could not tell the re-promoted ` +
        'build from any other.',
    );
  }
  return {
    sha,
    id: id.toLowerCase(),
    environmentUrl,
    smoke: { url: `${environmentUrl}${smoke.path}`, field: smoke.field, expect: String(expect), requireOk: smoke.requireOk },
  };
}

/** PURE. The Worker rollback's message: wrangler caps it at 120 characters. */
export const rollbackMessage = (ledgerId, sha, runId) =>
  `rollback.yml${runId ? ` run ${runId}` : ''}: ledger Deployment ${ledgerId} (${sha.slice(0, 8)})`.slice(0, 120);

/** PURE. The exact command a real run executes, as one line a person can paste.
 *  The Pages call is written as the curl it is equivalent to; the account and
 *  the token stay variable names, never values. */
export function commandFor(target, plan, message) {
  if (target.kind === 'web') {
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

async function pagesRollback(target, plan) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token) throw new Refusal('CLOUDFLARE_API_TOKEN is not set');
  if (!account || !/^[0-9A-Za-z]+$/.test(account)) throw new Refusal('CLOUDFLARE_ACCOUNT_ID is not set, or is not an account id');
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
    const errors = (body?.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('; ') || text.slice(0, 200);
    throw new Refusal(`Cloudflare refused the Pages rollback (HTTP ${res.status}): ${errors}. Nothing was re-promoted.`);
  }
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

async function main() {
  const argv = process.argv.slice(2);
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
    smoke_url: plan.smoke.url,
    smoke_field: plan.smoke.field,
    smoke_expect: plan.smoke.expect,
    smoke_require_ok: String(plan.smoke.requireOk),
  };
  if (dryRun) {
    writeOutputs({ dry_run: 'true', ...outputs });
    console.log('  --dry-run: nothing was re-promoted.');
    return;
  }

  try {
    if (target.kind === 'web') await pagesRollback(target, plan);
    else workerRollback(target, plan, message);
  } catch (e) {
    return fail(e.message);
  }
  writeOutputs({ dry_run: 'false', ...outputs });
  console.log(
    `ok  ${unit} re-promoted to ${plan.sha.slice(0, 8)} (${target.idKey} ${plan.id}). ` +
      'The smoke and the ledger record are the next two steps.',
  );
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) await main();
