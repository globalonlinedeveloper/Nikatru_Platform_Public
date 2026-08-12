#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-prod-provenance.mjs — [pipeline B-17] THE MONITOR LIMB.
//
// "Verification against production is permitted and expected, but every artifact
// it creates is provably removed, and the check is mechanical rather than
// remembered."
//
// 🔴 WHY THIS IS A MONITOR AND NOT A GATE, STATED ONCE. B-17's falsifier is A
// ROW IN A DATABASE. It lives outside the repository, behind a credential, and
// ci.yml — which gates every push, including from forks — can never hold that
// credential. So the push gate (tooling/ci/assert-prod-provenance.mjs) asserts
// the RULES exist and that this reader is wired; only this file can answer
// whether any row actually fails one. That makes it a WEAKER RUNG: green here
// means "nothing has contradicted B-17 since the last run", never "B-17 holds".
//
// It runs daily in ops-watch.yml, which already holds CLOUDFLARE_API_TOKEN with
// D1 read and has no `push` trigger by design.
//
// ── WHAT IT COUNTS ──────────────────────────────────────────────────────────
// Per table, the rows whose provenance does NOT resolve — the inversion that
// replaced B-17's original criterion. The original counted "rows matching the
// test-marker convention"; there was no convention, so the predicate was empty
// and the count was 0 on every possible production state, forever. Counting the
// rows that CANNOT BE TRACED instead gives the predicate a non-empty complement
// that probe rows fall into without anyone tagging anything.
//
// The rules are per table because the columns are (tooling/prod-provenance.json
// carries each marker and the written reason for it), and the table set is
// ENUMERATED from services/platform/migrations rather than listed — the same
// reading the gate uses, from the same module, so the two limbs cannot come to
// range over different schemas.
//
// ── PRIVACY: IT NEVER READS A ROW ───────────────────────────────────────────
// Every query is `SELECT <marker>, COUNT(*) … GROUP BY <marker>`. It reads ONE
// declared column and a tally. That is not tidiness: `provider_notifications`
// stores merchant-of-record payloads VERBATIM — a buyer's name, email address
// and billing country — and a monitor that hoovered rows into a public CI log
// would be a worse data incident than the residue it hunts.
//
// ── THREE-VALUED EXIT, AND THE DISTINCTION IS LOAD-BEARING ──────────────────
//   0 · every row in every table resolves to a released build or its declared
//       equivalent.
//   1 · at least one row does not. Someone wrote to production and did not
//       clean up, or a rail wrote a row it could not attribute.
//   2 · IT COULD NOT LOOK — no credential, no released-build set, an unreadable
//       register. "I could not look" must never read as "I looked and it was
//       fine": that is precisely how the claim this replaces became
//       unfalsifiable, and 04-backend-platform.md's own evidence block still
//       says `consent_artifacts` 0 because nothing ever looked again.
//
// ── THE SECOND WITNESS: A RUN THAT FAILED CAN STILL HAVE DEPLOYED ───────────
// 🔴 A RUN'S CONCLUSION IS A FACT ABOUT THE RUN, NOT ABOUT WHAT REACHED USERS,
// and reading it as the latter cost this repository a real incident. deploy-web
// run 144 (2026-08-08) uploaded to Cloudflare Pages successfully and then lost
// the CDN propagation race in its post-deploy smoke, so the RUN concluded
// `failure` while the bundle was live and serving. Rows written by real people
// carried `1.0.144+40c0787`, no successful run numbered 144 existed, and this
// monitor correctly — and uselessly — called them unattributable. The repair was
// a hand-written attestation in tooling/ops/manual-deploys.json.
//
// So a build now resolves on EITHER of two footings:
//   (a) its run number belongs to a SUCCESSFUL run of a served release lane
//       whose head commit is the build's own metadata — the original rule, and
//       the common case; or
//   (b) its run number belongs to a run of ANY conclusion whose head commit is
//       the build's own metadata, AND a GitHub DEPLOYMENT exists for that commit
//       on a served environment.
//
// (b) is the SAME PAIR OF INDEPENDENT WITNESSES manual-deploys.json demands, and
// it is not a weakening: a GitHub Deployment on `<app>-web` is written by exactly
// one thing — tooling/ci/record-deployment.mjs, inside the lane job, which is the
// only job in the repository holding `deployments: write`. Since 2026-08-09 that
// step is conditioned on the deploy step succeeding rather than on the smoke
// passing (see the block on it in deploy-web.yml), so the witness exists
// precisely when bytes reached the origin. Nothing here trusts the run's own
// verdict about itself.
//
// ⚠️ THE RUN-NUMBER LEG IS STILL REQUIRED IN (b). A deployment alone would let
// any sha resolve any run number, and run numbers are what version strings are
// ORDERED by. Both halves, or neither.
//
// Usage:
//   node tooling/ops/check-prod-provenance.mjs
//   node tooling/ops/check-prod-provenance.mjs --root <dir>
//   node tooling/ops/check-prod-provenance.mjs --rows-file f.json --runs-file r.json
//     → OFFLINE FIXTURE MODE, for tests. It announces itself loudly; that line
//       must never appear in a real ops-watch log. `--deployments-file d.json`
//       (an array of sha strings) supplies witness (b) in that mode.
//   node tooling/ops/check-prod-provenance.mjs --emit-served-environments
//     → prints the deployment environments witness (b) is read from, one per
//       line, and exits. Needs no credential, so it is the ONLY way a test can
//       reach that expansion — see the block on it in main().
//
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID (D1 read)
//      GITHUB_TOKEN or GH_TOKEN, GITHUB_REPOSITORY (release-lane run history and
//      the deployment ledger)
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { enumerateMigrationTables } from '../ci/migration-tables.mjs';
import { stripSourceComments } from '../ci/text-reductions.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTER_REL = 'tooling/prod-provenance.json';
const CHANNELS_REL = 'tooling/channel-register.json';
const PROVIDERS_REL = 'tooling/legal/provider-register.json';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 || i === args.length - 1 ? null : args[i + 1];
};
const ROOT = resolve(flag('--root') ?? join(HERE, '..', '..'));

/** `// comment` and trailing commas — wrangler.jsonc is JSONC. */
const parseJsonc = (text) => JSON.parse(stripSourceComments(text, '.ts').replace(/,(\s*[}\]])/g, '$1'));

/** The one shape of "I could not look". Never 0, never 1. */
class CouldNotLook extends Error {}

const readJson = (rel) => {
  const p = join(ROOT, rel);
  if (!existsSync(p)) throw new CouldNotLook(`${rel} does not exist`);
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new CouldNotLook(`${rel} is not valid JSON (${e.message})`);
  }
};

// ── the released-build set ──────────────────────────────────────────────────
//
// A build this factory SHIPPED is `<release_line>.<run_number>+<sha7>` — the
// shape deploy-web.yml composes and assert-app-versioning.mjs enforces. So a
// version string resolves iff:
//   · its release line (major.minor) is one an app in this workspace declares,
//   · its patch equals the run number of a COMPLETED run of a SERVED release
//     lane, and
//   · its build metadata is that run's head commit, and
//   · that run either SUCCEEDED, or left a GitHub Deployment behind on a served
//     environment — witness (b) in the header. The third bullet said "a
//     SUCCESSFUL run" until 2026-08-09 and that reading is what called run 144's
//     live bundle unattributable; a run's conclusion is a fact about the run,
//     not about what reached users.
// Nothing is listed here. `dev` (the dart-define default when APP_VERSION is
// absent) and `c6-localprobe` (the C-6 live probe's literal) fail all of them.
function releaseLines() {
  const appsDir = join(ROOT, 'apps');
  if (!existsSync(appsDir)) return new Set();
  const lines = new Set();
  for (const e of readdirSync(appsDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = join(appsDir, e.name, 'pubspec.yaml');
    if (!existsSync(p)) continue;
    const m = readFileSync(p, 'utf8').match(/^version:\s*(\d+)\.(\d+)\.(\d+)/m);
    if (m) lines.add(`${m[1]}.${m[2]}`);
  }
  return lines;
}

function servedLaneWorkflows() {
  const reg = readJson(CHANNELS_REL);
  const rows = (reg.channels ?? []).filter((c) => c?.lane?.workflow && c.served === true);
  return [...new Set(rows.map((c) => c.lane.workflow.split('/').pop()))];
}

/** The app slugs `{app}` expands over. The published catalogue is the SSoT (it
 *  is what assert-publish-records.mjs builds the required environment set from),
 *  with the workspace directories as the floor so this reader still works on a
 *  tree that carries apps and no catalogue. */
function appSlugs() {
  const cat = join(ROOT, 'sites', '_shared', '_data', 'apps.json');
  if (existsSync(cat)) {
    try {
      const parsed = JSON.parse(readFileSync(cat, 'utf8'));
      const slugs = (Array.isArray(parsed) ? parsed : []).map((a) => a?.slug).filter((s) => typeof s === 'string');
      if (slugs.length) return slugs;
    } catch { /* falls through to the directory floor */ }
  }
  const appsDir = join(ROOT, 'apps');
  if (!existsSync(appsDir)) return [];
  return readdirSync(appsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
}

/** `{app}-web` × the apps — the environments a served RELEASE channel's lane
 *  records into, and therefore the only ones whose GitHub Deployments witness
 *  that an app build was PUBLISHED. Service environments (the Workers) are
 *  deliberately excluded: a Worker deploy at some commit says nothing about
 *  whether the app bundle at that commit ever reached a browser. */
function servedEnvironments() {
  const reg = readJson(CHANNELS_REL);
  const slugs = appSlugs();
  const envs = new Set();
  for (const c of reg.channels ?? []) {
    if (c?.served !== true || typeof c?.deploymentEnvironment !== 'string') continue;
    if (!c.deploymentEnvironment.includes('{app}')) { envs.add(c.deploymentEnvironment); continue; }
    for (const s of slugs) envs.add(c.deploymentEnvironment.replace('{app}', s));
  }
  if (envs.size === 0) {
    throw new CouldNotLook(
      'no served channel in ' + CHANNELS_REL + ' expands to a deployment environment, so the GitHub Deployment ' +
        'ledger could not be read and witness (b) would be silently empty — which reads exactly like "no deploy ' +
        'was ever recorded" and would call every failed-run build unattributable.',
    );
  }
  return [...envs];
}

// Named `ghJson` rather than `gh` because the manual-deploys block below
// declares its own local `gh`; two helpers with one name in one file is how a
// later edit ends up calling the wrong one.
const ghJson = async (repo, token, path, what) => {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'nikatru-prod-provenance' },
  });
  if (!res.ok) throw new CouldNotLook(`the GitHub API returned ${res.status} ${what}`);
  try {
    return await res.json();
  } catch (e) {
    throw new CouldNotLook(`the GitHub API response ${what} was not JSON (${e.message})`);
  }
};

function githubCredentials() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY || gitRemoteRepo();
  if (!token) throw new CouldNotLook('neither GITHUB_TOKEN nor GH_TOKEN is set, so the released-build set cannot be derived');
  if (!repo) throw new CouldNotLook('the repository could not be resolved (GITHUB_REPOSITORY unset and no origin remote)');
  return { token, repo };
}

/** EVERY COMPLETED RUN of a served release lane, not only the successful ones —
 *  a run that failed after its deploy step succeeded is the case witness (b)
 *  exists for, and filtering it out here would put it beyond reach. */
async function githubRuns(workflowFile) {
  const { token, repo } = githubCredentials();
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const body = await ghJson(
      repo,
      token,
      `/actions/workflows/${workflowFile}/runs?status=completed&per_page=100&page=${page}`,
      `listing runs of ${workflowFile}`,
    );
    const runs = body?.workflow_runs;
    if (!Array.isArray(runs)) throw new CouldNotLook(`the GitHub API response for ${workflowFile} carried no workflow_runs array`);
    // A run with no `conclusion` would silently take the resolver's benefit-of-
    // the-doubt default below, which is the one direction that weakens without
    // announcing itself. Live data always carries one; a shape change must be
    // "could not look", never "looked and it was fine".
    for (const r of runs) {
      if (typeof r?.conclusion !== 'string') {
        throw new CouldNotLook(
          `run ${r?.run_number ?? '?'} of ${workflowFile} carries no \`conclusion\`, so this reader cannot tell a ` +
            'successful lane run from a failed one and would treat both as released',
        );
      }
    }
    out.push(...runs);
    if (runs.length < 100) break;
  }
  return out;
}

/** Every commit that has a GitHub Deployment on a served environment — the
 *  ledger tooling/ci/record-deployment.mjs writes, and the second witness. */
async function githubDeployments(environments) {
  const { token, repo } = githubCredentials();
  const shas = new Set();
  for (const environment of environments) {
    for (let page = 1; page <= 10; page++) {
      const body = await ghJson(
        repo,
        token,
        `/deployments?environment=${encodeURIComponent(environment)}&per_page=100&page=${page}`,
        `listing deployments of ${environment}`,
      );
      if (!Array.isArray(body)) throw new CouldNotLook(`the GitHub API response listing deployments of ${environment} was not an array`);
      for (const d of body) if (typeof d?.sha === 'string') shas.add(d.sha.toLowerCase());
      if (body.length < 100) break;
    }
  }
  return shas;
}

function gitRemoteRepo() {
  const cfg = join(ROOT, '.git', 'config');
  if (!existsSync(cfg)) return null;
  const m = readFileSync(cfg, 'utf8').match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\s*$/m);
  return m ? m[1] : null;
}

/**
 * `1.0.101+e138f5b` → resolvable iff the line and the run number and the sha all
 * line up, AND that run either SUCCEEDED or left a GitHub Deployment behind.
 *
 * `deployedShas` is the deployment ledger (witness (b) in the header); pass
 * `null` where it cannot be read, and only successful runs resolve. `onWitness`
 * is called once per build that resolved on (b) alone, so an acceptance that
 * rests on the weaker footing PRINTS instead of passing silently — the same
 * discipline the manual-deploys register follows.
 *
 * A run entry with no `conclusion` is read as successful: that is the shape of
 * every historic `--runs-file` fixture, and live runs are floored above so the
 * default can never be reached from real data.
 */
function makeReleasedBuildResolver(lines, runs, deployedShas = null, onWitness = () => {}) {
  const byNumber = new Map(runs.map((r) => [String(r.run_number), r]));
  return (value) => {
    if (typeof value !== 'string' || value.length === 0) return 'no app_version at all — the build defaults to `dev` only when APP_VERSION is unset, so an empty value is a row written by something that is not a build';
    const m = value.match(/^(\d+)\.(\d+)\.(\d+)\+([0-9a-fA-F]{7,40})$/);
    if (!m) return `\`${value}\` is not the shape a shipped build produces (<release_line>.<run_number>+<sha7>)`;
    const line = `${m[1]}.${m[2]}`;
    if (!lines.has(line)) return `release line ${line} is declared by no app in apps/*/pubspec.yaml`;
    const run = byNumber.get(m[3]);
    if (!run) return `no run numbered ${m[3]} exists on any served release lane`;
    const head = String(run.head_sha ?? '').toLowerCase();
    if (!head.startsWith(m[4].toLowerCase())) return `run ${m[3]} shipped ${head.slice(0, 7)}, not ${m[4]}`;
    const conclusion = run.conclusion ?? 'success';
    if (conclusion === 'success') return null;
    if (deployedShas?.has(head)) {
      onWitness(
        `${value} — run ${m[3]} concluded \`${conclusion}\`, and a GitHub Deployment for ${head.slice(0, 7)} on a ` +
          'served environment witnesses that it shipped anyway (a deploy step that succeeded before a later step failed)',
      );
      return null;
    }
    return (
      `run ${m[3]} concluded \`${conclusion}\` and NO GitHub Deployment names ${head.slice(0, 7)} on a served ` +
      'environment, so nothing witnesses that this build was ever published'
    );
  };
}

// ── the other four resolvers ────────────────────────────────────────────────
function cronJobNames() {
  const src = join(ROOT, 'services', 'platform', 'src');
  if (!existsSync(src)) throw new CouldNotLook('services/platform/src does not exist, so the declared cron-job set is empty');
  let text = '';
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|js|mjs)$/.test(e.name)) text += readFileSync(p, 'utf8');
    }
  };
  walk(src);
  const jobs = new Set([...text.matchAll(/export\s+const\s+\w*_JOB\s*=\s*['"]([^'"]+)['"]/g)].map((m) => m[1]));
  if (jobs.size === 0) {
    throw new CouldNotLook(
      'no `export const <NAME>_JOB` declaration was found in services/platform/src, so the allowed job set is EMPTY — ' +
        'every heartbeat row would read as unattributable and the red would be about the parse, not the data',
    );
  }
  return jobs;
}

function providerIds() {
  const reg = readJson(PROVIDERS_REL);
  const raw = reg.providers;
  const ids = new Set(
    Array.isArray(raw) ? raw.map((p) => p?.id ?? p?.provider ?? p).filter((x) => typeof x === 'string') : Object.keys(raw ?? {}),
  );
  if (ids.size === 0) throw new CouldNotLook(`${PROVIDERS_REL} declares zero providers, so every provider row would read as unattributable`);
  return ids;
}

// ── D1 ──────────────────────────────────────────────────────────────────────
function databaseId() {
  const rel = 'services/platform/wrangler.jsonc';
  const p = join(ROOT, rel);
  if (!existsSync(p)) throw new CouldNotLook(`${rel} does not exist, so the database that owns the tables cannot be resolved`);
  let cfg;
  try {
    cfg = parseJsonc(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new CouldNotLook(`${rel} could not be parsed (${e.message})`);
  }
  const id = (cfg.d1_databases ?? []).find((d) => d.migrations_dir)?.database_id;
  if (!id) throw new CouldNotLook(`${rel} has no D1 binding carrying \`migrations_dir\``);
  return id;
}

async function queryD1(dbId, sql) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) {
    throw new CouldNotLook('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are not both in the environment');
  }
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  if (!res.ok) throw new CouldNotLook(`the D1 API returned ${res.status}`);
  let body;
  try {
    body = await res.json();
  } catch (e) {
    throw new CouldNotLook(`the D1 API response was not JSON (${e.message})`);
  }
  if (body?.success !== true) throw new CouldNotLook(`the D1 API reported failure: ${JSON.stringify(body?.errors ?? body).slice(0, 300)}`);
  const rows = body?.result?.[0]?.results;
  if (!Array.isArray(rows)) throw new CouldNotLook('the D1 API response carried no results array');
  return rows;
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  // ── `--emit-served-environments` · THE ONE WAY WITNESS (b)'s SUBJECT IS
  //    REACHABLE WITHOUT A GITHUB TOKEN ───────────────────────────────────────
  // `servedEnvironments()` is consulted on exactly one line — the live branch of
  // `deployedShas` — and that line sits BEHIND `githubRuns`, which needs a
  // credential. So every test of this file reached it never: its expansion was
  // unexercised and its `CouldNotLook` was an assertion no input could make
  // fail, which this repository's own rule calls worse than none. This flag is
  // the same `--emit` idiom assert-release-lane-generic.mjs, assert-app-
  // versioning.mjs and assert-catalog-reachable.mjs already use, and it exists
  // for the same reason they do: the reader that USES the fact and the reader
  // that is TESTED on it must be one function, or the test grades a copy.
  //
  // It runs before the migration read on purpose — the environment set has no
  // dependency on the schema, and a `--root` fixture written to exercise this
  // expansion should not first have to carry a valid migrations directory.
  if (args.includes('--emit-served-environments')) {
    for (const e of servedEnvironments()) console.log(e);
    process.exitCode = 0;
    return;
  }

  const register = readJson(REGISTER_REL);
  const rules = register.tables ?? {};
  const migrationsRel = register.migrationsDir;
  if (typeof migrationsRel !== 'string') throw new CouldNotLook(`${REGISTER_REL} declares no migrationsDir`);

  const { tables, filesRead } = enumerateMigrationTables(join(ROOT, migrationsRel));
  if (filesRead === 0 || tables.size === 0) {
    throw new CouldNotLook(
      `${filesRead} migration file(s) read and ${tables.size} table(s) enumerated under ${migrationsRel} — ` +
        'the schema could not be read, so "every table is clean" would range over nothing',
    );
  }

  // COVERAGE LOST is the gate's verdict, but the monitor must not sail past it:
  // a table with no rule is a table this reader would not query, and a silent
  // shorter list is the failure mode both limbs are written against.
  const uncovered = [...tables.keys()].filter((t) => !Object.prototype.hasOwnProperty.call(rules, t));
  if (uncovered.length) {
    throw new CouldNotLook(
      `COVERAGE LOST — ${uncovered.length} table(s) the migrations create have NO rule in ${REGISTER_REL}: ` +
        `${uncovered.join(', ')}. This reader would have queried ${Object.keys(rules).length} of ${tables.size} tables and printed a clean total.`,
    );
  }

  const rowsFile = flag('--rows-file');
  const runsFile = flag('--runs-file');
  const deploymentsFile = flag('--deployments-file');
  if (rowsFile || runsFile || deploymentsFile) {
    console.log('!!  OFFLINE FIXTURE MODE — --rows-file/--runs-file/--deployments-file is set. This must NEVER appear in a real ops-watch log.');
  }

  // Resolver contexts. Each throws CouldNotLook rather than resolving nothing.
  const runs = runsFile
    ? JSON.parse(readFileSync(runsFile, 'utf8'))
    : (await Promise.all(servedLaneWorkflows().map(githubRuns))).flat();
  const lines = releaseLines();
  if (lines.size === 0) throw new CouldNotLook('no apps/*/pubspec.yaml declares a version, so no release line is known');
  if (runs.length === 0) throw new CouldNotLook('no completed run of any served release lane was found, so the released-build set is EMPTY');

  // ── witness (b): the GitHub Deployment ledger ─────────────────────────────
  // Read for real on a live run; from a fixture file in offline mode; and NEVER
  // fabricated. `null` — the state a fixture with no --deployments-file is in —
  // means "no second witness available", so only successful runs resolve, which
  // is exactly the behaviour every pre-existing fixture was written against.
  const deployedShas = deploymentsFile
    ? new Set(JSON.parse(readFileSync(deploymentsFile, 'utf8')).map((s) => String(s).toLowerCase()))
    : runsFile
      ? null
      : await githubDeployments(servedEnvironments());
  const witnessed = [];

  // ── attested manual deploys — tooling/ops/manual-deploys.json ─────────────
  // A deploy that shipped outside its lane is attributable ONLY through this
  // register, and an entry is accepted ONLY after two independent records
  // confirm it: the sha must be a real commit on this repository (GitHub API),
  // and a GitHub Deployment written by record-deployment.mjs must exist for
  // that sha + environment. Accepted entries PRINT on every run; an invalid
  // entry lands in `violations` — a bad attestation is worse than an
  // unattributed row. Born 2026-08-08: run numbers are never reissued, so a
  // manual restore that reuses a FAILED run's number is version-monotonic but
  // provenance-orphaned, and deleting real production rows to appease this
  // checker was the alternative nobody should ever take.
  const attested = [];
  const attViolations = [];
  // Fixture mode (--runs-file) cannot reach either witness, so the register is
  // SKIPPED there rather than half-validated — the fixture banner above already
  // makes that mode unmistakable in any log. Live runs always validate.
  if (!runsFile) {
    const regPath = join(ROOT, 'tooling/ops/manual-deploys.json');
    if (existsSync(regPath)) {
      const reg = JSON.parse(readFileSync(regPath, 'utf8'));
      const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      const ghRepo = process.env.GITHUB_REPOSITORY || gitRemoteRepo();
      for (const d of reg.deploys ?? []) {
        const m = String(d.version ?? '').match(/^(\d+)\.(\d+)\.(\d+)\+([0-9a-fA-F]{7,40})$/);
        if (!m) { attViolations.push(`manual-deploys.json: \`${d.version}\` is not a shipped-build shape`); continue; }
        if (!String(d.sha ?? '').toLowerCase().startsWith(m[4].toLowerCase())) {
          attViolations.push(`manual-deploys.json: \`${d.version}\` build metadata does not match its own sha field`); continue;
        }
        const gh = (path) => fetch(`https://api.github.com/repos/${ghRepo}${path}`, {
          headers: { Authorization: `Bearer ${ghToken}`, 'User-Agent': 'check-prod-provenance' },
        });
        const commit = await gh(`/commits/${d.sha}`);
        if (commit.status !== 200) { attViolations.push(`manual-deploys.json: sha ${String(d.sha).slice(0, 7)} is not a commit on ${ghRepo} (HTTP ${commit.status})`); continue; }
        const depRes = await gh(`/deployments?environment=${encodeURIComponent(d.environment)}&sha=${d.sha}`);
        const deps = depRes.status === 200 ? await depRes.json() : [];
        if (!Array.isArray(deps) || deps.length === 0) {
          attViolations.push(`manual-deploys.json: no GitHub Deployment exists for ${d.environment} @ ${String(d.sha).slice(0, 7)} — record-deployment.mjs never ran, so this attestation has no second witness`); continue;
        }
        // `conclusion: 'success'` is explicit rather than defaulted: the two
        // witnesses above ARE this entry's validation, so it must not be sent
        // back through the deployment-ledger check a second time.
        attested.push({ run_number: Number(m[3]), head_sha: String(d.sha).toLowerCase(), conclusion: 'success' });
        console.log(`⬜  attested manual deploy accepted: ${d.version} (${d.environment}, ${d.deployedAt}) — commit and GitHub Deployment both verified`);
      }
    }
  }

  const resolverFns = {
    'released-build': makeReleasedBuildResolver(lines, [...runs, ...attested], deployedShas, (note) => {
      if (!witnessed.includes(note)) witnessed.push(note);
    }),
    'live-environment': (v) =>
      v === 'live' ? null : v == null ? 'no environment at all — the rail could not attribute this row to a money world' : `environment is \`${v}\`, not \`live\``,
    'cron-job': ((set) => (v) => (typeof v === 'string' && set.has(v) ? null : `job \`${v}\` is declared by no \`export const <NAME>_JOB\` in services/platform/src`))(cronJobNames()),
    'provider-register': ((set) => (v) => (typeof v === 'string' && set.has(v) ? null : `provider \`${v}\` has no row in ${PROVIDERS_REL}`))(providerIds()),
    // For DERIVED tables carrying no build marker. Deliberately weaker than
    // `released-build` — it proves the row belongs to a real app, not that a
    // released build wrote it — and the register's own definition says so.
    //
    // ⚠️ REUSES THE `appSlugs()` ALREADY IN THIS FILE rather than reading the
    // catalogue a second time. The first draft added its own reader and Node
    // refused the module outright — `Identifier 'appSlugs' has already been
    // declared` — which is the cheapest possible version of the second-declaration
    // failure this repository keeps paying for, caught by the language instead of
    // by a drifted count months later.
    'app-catalogue': ((set) => (v) =>
      typeof v === 'string' && set.has(v)
        ? null
        : `app \`${v}\` has no entry in the app catalogue, so this row belongs to no app the factory ships`)(
      (() => {
        const s = new Set(appSlugs());
        // An empty set marks every row unattributable, which reads as a finding
        // about the data when it is really a finding about the reader.
        if (s.size === 0) throw new CouldNotLook('the app catalogue declares zero apps, so every row would read as unattributable');
        return s;
      })(),
    ),
    'migration-seed': null, // built per table below — the allowed set is that table's own seeds
  };

  const dbId = rowsFile ? null : databaseId();
  const fixture = rowsFile ? JSON.parse(readFileSync(rowsFile, 'utf8')) : null;

  const census = [];
  const violations = [...attViolations];
  for (const name of [...tables.keys()].sort()) {
    const rule = rules[name];
    const marker = rule.marker;
    let resolve_ = resolverFns[rule.resolver];
    if (rule.resolver === 'migration-seed') {
      const seeded = tables.get(name).seeds.get(marker) ?? new Set();
      if (seeded.size === 0) throw new CouldNotLook(`COVERAGE LOST — \`${name}\` resolves by \`migration-seed\` on \`${marker}\` and the migrations seed nothing there`);
      resolve_ = (v) => (typeof v === 'string' && seeded.has(v) ? null : `\`${v}\` is not one of the ${seeded.size} values the migrations seed into \`${marker}\``);
    }
    if (typeof resolve_ !== 'function') throw new CouldNotLook(`\`${name}\` names resolver \`${rule.resolver}\`, which this reader cannot execute`);

    const groups = fixture
      ? (fixture[name] ?? [])
      : await queryD1(dbId, `SELECT "${marker}" AS marker, COUNT(*) AS n FROM "${name}" GROUP BY "${marker}"`);

    let total = 0;
    let bad = 0;
    for (const g of groups) {
      const n = Number(g.n ?? 0);
      total += n;
      const why = resolve_(g.marker);
      if (why !== null) {
        bad += n;
        violations.push(`${name}: ${n} row(s) — ${why}  [marker \`${marker}\`, resolver \`${rule.resolver}\`]`);
      }
    }
    census.push({ name, total, bad, marker, resolver: rule.resolver });
  }

  const grandTotal = census.reduce((a, c) => a + c.total, 0);
  console.log(`⬜  MONITOR · [pipeline B-17] · ${census.length} table(s) enumerated from ${migrationsRel} (${filesRead} migration file(s)), ${grandTotal} row(s) in ${register.database}`);
  console.log(
    `⬜  released-build set: ${runs.length} completed lane run(s), ${runs.filter((r) => (r.conclusion ?? 'success') === 'success').length} successful · ` +
      `deployment ledger: ${deployedShas === null ? 'NOT READ (fixture mode)' : `${deployedShas.size} commit(s) with a GitHub Deployment on a served environment`}`,
  );
  // An acceptance resting on the weaker footing is announced, never silent — the
  // same rule the manual-deploys register follows. A build that resolves ONLY
  // because a failed run left a deployment behind is a build somebody should be
  // able to see in the log without going looking.
  for (const w of witnessed) console.log(`⬜  deployment-witnessed build accepted: ${w}`);
  for (const c of census) {
    console.log(`    ${c.bad === 0 ? 'ok ' : '✗  '} ${c.name.padEnd(24)} ${String(c.total).padStart(6)} row(s), ${c.bad} unattributable   [${c.marker} · ${c.resolver}]`);
  }

  if (violations.length) {
    console.error('');
    console.error(`✗ ${violations.length} group(s) of rows in production cannot be traced to a released build:`);
    for (const v of violations) console.error(`    ${v}`);
    console.error('');
    console.error('  B-17: verification against production is permitted and EXPECTED — every artifact it creates being');
    console.error('  provably removed is the other half of that permission. Delete the residue, or, if the row is real,');
    console.error('  fix what wrote it so the next one carries its provenance.');
    process.exitCode = 1;
    return;
  }

  console.log('ok  every row in every shared table resolves to a released build or its declared equivalent [pipeline B-17]');
  console.log('⬜  THIS IS A MONITOR, NOT A GATE. Green means "nothing has contradicted B-17 since this run", never');
  console.log('    "B-17 holds" — the next write to production happens between two runs of this reader.');
  process.exitCode = 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    await main();
  } catch (e) {
    if (e instanceof CouldNotLook) {
      console.error(`✗ COULD NOT LOOK — ${e.message}`);
      console.error('');
      console.error('  This is exit 2, not exit 1, and the difference is the whole point: "I could not look" must never');
      console.error('  read as "I looked and it was fine". 04-backend-platform.md\'s B-17 evidence block still records');
      console.error('  `consent_artifacts` 0 for exactly that reason — nothing ever looked again.');
      process.exitCode = 2;
    } else {
      console.error(`✗ ${e.stack ?? e.message}`);
      process.exitCode = 2;
    }
  }
}

export { makeReleasedBuildResolver, releaseLines, CouldNotLook };
