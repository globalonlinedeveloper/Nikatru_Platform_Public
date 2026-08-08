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
// Usage:
//   node tooling/ops/check-prod-provenance.mjs
//   node tooling/ops/check-prod-provenance.mjs --root <dir>
//   node tooling/ops/check-prod-provenance.mjs --rows-file f.json --runs-file r.json
//     → OFFLINE FIXTURE MODE, for tests. It announces itself loudly; that line
//       must never appear in a real ops-watch log.
//
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID (D1 read)
//      GITHUB_TOKEN or GH_TOKEN, GITHUB_REPOSITORY (release-lane run history)
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
//   · its patch equals the run number of a SUCCESSFUL run of a SERVED release
//     lane, and
//   · its build metadata is that run's head commit.
// Nothing is listed here. `dev` (the dart-define default when APP_VERSION is
// absent) and `c6-localprobe` (the C-6 live probe's literal) fail all three.
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

async function githubRuns(workflowFile) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY || gitRemoteRepo();
  if (!token) throw new CouldNotLook('neither GITHUB_TOKEN nor GH_TOKEN is set, so the released-build set cannot be derived');
  if (!repo) throw new CouldNotLook('the repository could not be resolved (GITHUB_REPOSITORY unset and no origin remote)');
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const url =
      `https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/runs` +
      `?status=success&per_page=100&page=${page}`;
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'nikatru-prod-provenance',
      },
    });
    if (!res.ok) throw new CouldNotLook(`the GitHub API returned ${res.status} listing runs of ${workflowFile}`);
    let body;
    try {
      body = await res.json();
    } catch (e) {
      throw new CouldNotLook(`the GitHub API response for ${workflowFile} was not JSON (${e.message})`);
    }
    const runs = body?.workflow_runs;
    if (!Array.isArray(runs)) throw new CouldNotLook(`the GitHub API response for ${workflowFile} carried no workflow_runs array`);
    out.push(...runs);
    if (runs.length < 100) break;
  }
  return out;
}

function gitRemoteRepo() {
  const cfg = join(ROOT, '.git', 'config');
  if (!existsSync(cfg)) return null;
  const m = readFileSync(cfg, 'utf8').match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\s*$/m);
  return m ? m[1] : null;
}

/** `1.0.101+e138f5b` → resolvable iff the line, the run number and the sha all line up. */
function makeReleasedBuildResolver(lines, runs) {
  const byNumber = new Map(runs.map((r) => [String(r.run_number), r.head_sha]));
  return (value) => {
    if (typeof value !== 'string' || value.length === 0) return 'no app_version at all — the build defaults to `dev` only when APP_VERSION is unset, so an empty value is a row written by something that is not a build';
    const m = value.match(/^(\d+)\.(\d+)\.(\d+)\+([0-9a-fA-F]{7,40})$/);
    if (!m) return `\`${value}\` is not the shape a shipped build produces (<release_line>.<run_number>+<sha7>)`;
    const line = `${m[1]}.${m[2]}`;
    if (!lines.has(line)) return `release line ${line} is declared by no app in apps/*/pubspec.yaml`;
    const head = byNumber.get(m[3]);
    if (!head) return `no SUCCESSFUL run numbered ${m[3]} exists on any served release lane`;
    if (!head.startsWith(m[4].toLowerCase())) return `run ${m[3]} shipped ${head.slice(0, 7)}, not ${m[4]}`;
    return null;
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
  if (rowsFile || runsFile) {
    console.log('!!  OFFLINE FIXTURE MODE — --rows-file/--runs-file is set. This must NEVER appear in a real ops-watch log.');
  }

  // Resolver contexts. Each throws CouldNotLook rather than resolving nothing.
  const runs = runsFile
    ? JSON.parse(readFileSync(runsFile, 'utf8'))
    : (await Promise.all(servedLaneWorkflows().map(githubRuns))).flat();
  const lines = releaseLines();
  if (lines.size === 0) throw new CouldNotLook('no apps/*/pubspec.yaml declares a version, so no release line is known');
  if (runs.length === 0) throw new CouldNotLook('no successful run of any served release lane was found, so the released-build set is EMPTY');

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
  {
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
        attested.push({ run_number: Number(m[3]), head_sha: String(d.sha).toLowerCase() });
        console.log(`⬜  attested manual deploy accepted: ${d.version} (${d.environment}, ${d.deployedAt}) — commit and GitHub Deployment both verified`);
      }
    }
  }

  const resolverFns = {
    'released-build': makeReleasedBuildResolver(lines, [...runs, ...attested]),
    'live-environment': (v) =>
      v === 'live' ? null : v == null ? 'no environment at all — the rail could not attribute this row to a money world' : `environment is \`${v}\`, not \`live\``,
    'cron-job': ((set) => (v) => (typeof v === 'string' && set.has(v) ? null : `job \`${v}\` is declared by no \`export const <NAME>_JOB\` in services/platform/src`))(cronJobNames()),
    'provider-register': ((set) => (v) => (typeof v === 'string' && set.has(v) ? null : `provider \`${v}\` has no row in ${PROVIDERS_REL}`))(providerIds()),
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
