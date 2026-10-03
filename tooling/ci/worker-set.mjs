#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// worker-set.mjs — the ONE reader of the Worker set: every `services/<dir>` that
// holds a `wrangler.jsonc`, `services/_shared` excluded.
//
// Row O-CI-AND-WORKER-LANES-NAME-ONE-APP (the ci.yml half), [ADR 095].
// lane-workers.yml carried one job per Worker, each with its directory written
// into `working-directory:`, so a second app's Worker was typechecked, tested
// and dry-run deployed by nothing until somebody copied a job and edited it.
// The lane's `detect` job now runs `--emit`, and its one `worker` job is a
// matrix over what this prints, so a Worker directory added under services/ is
// a matrix leg on the next run with no edit to any workflow.
//
// The set is the DIRECTORIES, read off the tree the lane checks out. A Worker is
// a directory whose wrangler config the lane's own steps read (`npx wrangler
// deploy --dry-run` runs in it), so the directory is the thing to iterate.
// Whether a Worker may DEPLOY is a different question with a different source,
// tooling/platform-register.json. Cross-checking the two for the deploy lane is
// the service-kit row's work (O-SERVICE-KIT-UNBUILT), not this reader's.
//
// ⏱ 2026-09-26 — `--for-deploy` IS THAT CROSS-CHECK (O-SERVICE-KIT-UNBUILT, E-a1).
// The same set, held to what a lane that installs or deploys a Worker needs of it:
//   · the register names every directory in the set (`servingWorker` or an
//     `appWorkers` row, matched by `config`), and every row names a directory in
//     it, both ways;
//   · the directory's `package-lock.json` is TRACKED by git and is the lockfile of
//     its own `package.json` (the root `name`s agree). `npm ci` refuses without
//     one, and OSV-Scanner reads lockfiles: a Worker whose lockfile is missing or
//     uncommitted installs a dependency tree nobody reviewed and nothing scanned.
//     This is the HARD rule, checked where the lanes read their list;
//   · the row names its crash-sink secret, `dsnSecret`: one shared DSN would file
//     app #2's Worker crashes under app #1's project, where nobody triaging app #2
//     looks.
// Each member is then printed with what a deploy step reads (`--json`): the
// Worker name, its directory, the D1 binding its own config migrates (the entry
// carrying `migrations_dir`, or null), the smoke URL (the row's first host plus
// its GET …/health route) and `dsnSecret`. lane-workers.yml's `detect` reads the
// set this way, so a Worker with no committed lockfile or no register row turns
// the Workers lane red before any `npm ci` runs. Every finding is exit 1; a
// register this cannot read, or a tree that is not a git checkout (so "is the
// lockfile tracked" has no answer), is COVERAGE LOST (exit 2).
//
// ⏱ 2026-09-26 — `--app-workers` IS THE DEPLOY MATRIX (O-SERVICE-KIT-UNBUILT, E-a2).
// deploy-workers.yml deploys every app Worker from one matrix and the serving
// Worker (the platform) as its own job after it, so its matrix is the `appWorkers`
// rows only: split by the ROW each member matched, never by a Worker's name, so the
// serving Worker cannot be dropped or doubled by a rename. Each entry also carries
// `origin` (`https://<first host>`), the URL the record step writes and rollback.yml
// appends its smoke path to.
//
// ⏱ 2026-09-27 — AN EDGE WORKER IS A ROW TOO, AND NEVER AN APP WORKER (LEAD RULINGS
// SHIELD-R1..R3, rv-c21 SHIELD-F4, row O-BOXES-UNSHIELDED-FROM-SPIKES).
// services/edge-shield is a Worker directory with a wrangler.jsonc, so it is in the
// set, and its register row is `edgeWorkers[i]` (tooling/ci/assert-platform-register.mjs
// limb 7 holds that row). An edge Worker mounts no route and reads no DSN: it owes no
// `dsnSecret`, no smoke URL and no migrations (its smoke is
// tooling/ops/check-edge-shield.mjs), and it still owes the committed lockfile like
// every member. `--emit` keeps it, so the Workers lane still typechecks, tests and
// dry-runs it. `--app-workers` selects the rows whose field IS `appWorkers[i]` —
// never "every row but servingWorker", which would put an edge Worker into the app
// deploy matrix (DSN var, migrations, /v1/health smoke) and break every app deploy.
//
// Two refusals, because a matrix built from a quiet reader is a lane that tests
// nothing and reports green:
//   · a directory under services/ that is neither `_shared` nor holds a
//     `wrangler.jsonc` is a FINDING (exit 1). A Worker whose config was renamed
//     or moved would otherwise drop out of the matrix without a word, and its
//     tests would stop running while the lane stayed green;
//   · an empty set, or no services/ at all, is COVERAGE LOST (exit 2). GitHub
//     fails a job whose matrix is `[]`, but a reader that printed `[]` would
//     have said "no Workers" about a tree it never reached.
//
// Usage:  node tooling/ci/worker-set.mjs [--for-deploy] [--emit | --json [--app-workers]] [repoRoot]
//   --emit        prints the set as ONE JSON array (`["platform","subscriptiontracker-api"]`),
//                 the value lane-workers.yml's `detect` writes to `workers=`;
//   --for-deploy  holds each member to the register, its lockfile and its `dsnSecret`
//                 first (above), and prints nothing unless all of it holds;
//   --json        with --for-deploy only: `[{worker, dir, migrations, smokeUrl, origin, dsnSecret}]`;
//   --app-workers with --json only: the members that matched an `appWorkers` row, the
//                 value deploy-workers.yml's `workers` job writes to `workers=`. The
//                 whole set is still checked first;
//   --env <name>  with --json only: the entries whose own wrangler.jsonc declares an
//                 `env.<name>` block. deploy-sandbox.yml's `workers` job reads
//                 `--json --app-workers --env sandbox`, and assert-release-provenance.mjs
//                 limb 2b resolves a sandbox leg's `workingDirectory` through envEntries(),
//                 the same answer. An APP Worker without the block is REFUSED (exit 1,
//                 naming it; envRefusals() below), never dropped; a serving or edge
//                 Worker without one is still left out of the list;
//   with none of these, one directory name per line.
//
// ⏱ 2026-09-29 — `--env` (B-12, row O-SERVICE-KIT-UNBUILT). deploy-sandbox.yml was one
// hand-written job per Worker, with each Worker's name in a dispatch `options:` list,
// its directory in four `workingDirectory:` fields and its binding in a migration
// command; symbolication-proof.yml named the app on nine lines. Both were classified
// out of assert-release-lane-generic.mjs, so app #2 would have had no sandbox and
// nothing would have said so.
//
// ⏱ 2026-10-01 — AN APP WORKER WITH NO `env.<name>` IS A REFUSAL, NOT A DROP
// (rv2-services-011, row O-BRICK-WORKER-HAS-NO-SANDBOX-ENV). `--env` used to filter
// such a Worker out without a word, and the brick stamped none, so app #2's Worker
// would have deployed to production and never to the sandbox, its store capture
// would have had no API, and deploy-sandbox would have stayed green over the gap
// it was built to close. Every app Worker is held to the same sandbox parity as app
// #1's; the brick now stamps the block (its own test/wrangler-config.test.ts).
// Exit 0 = the set is non-empty, every directory under services/ is placed, and
//          (--for-deploy) every member holds.
// Exit 1 = a directory under services/ is neither `_shared` nor a Worker, or
//          (--for-deploy) a member fails the register, its lockfile or `dsnSecret`,
//          or (--env <name>) an app Worker declares no `env.<name>` block.
// Exit 2 = COVERAGE LOST: no services/ directory, no Worker in it, or
//          (--for-deploy) no readable register or no git index to ask.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { listDir } from './tree-walk.mjs';
import { parseJsonc } from './d1-sql-inventory.mjs';

/** Where the Workers live, relative to the repository root. */
export const SERVICES_DIR = 'services';
/** The one directory under services/ that is shared source, not a Worker. */
export const SHARED_DIR = '_shared';
/** The config file that makes a directory a Worker. */
export const WORKER_CONFIG = 'wrangler.jsonc';

/**
 * `{ workers, strays }` for the tree at `root`, or null when it has no
 * services/ directory. `workers` is every directory holding a WORKER_CONFIG,
 * sorted, SHARED_DIR never among them; `strays` is every other directory under
 * services/ that is not SHARED_DIR. Hidden entries (`.wrangler`, `.DS_Store`)
 * are not directories of the tree and are skipped, and so are files.
 */
export function workerSet(root) {
  const dir = join(root, SERVICES_DIR);
  if (!existsSync(dir)) return null;
  const workers = [];
  const strays = [];
  for (const e of listDir(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === SHARED_DIR) continue;
    if (existsSync(join(dir, e.name, WORKER_CONFIG))) workers.push(e.name);
    else strays.push(e.name);
  }
  return { workers: workers.sort(), strays: strays.sort() };
}

/** The register every member is held to under `--for-deploy`. */
export const REGISTER = 'tooling/platform-register.json';

/** The register's Worker rows, each with the routes its health route is read
 *  from: `servingWorker` carries the shared `routes[]`, an app Worker its own.
 *  Exported for provision-backend.mjs `--check`, which asks the same register
 *  the same question ("has this Worker directory a row?"). */
export function registerRows(register) {
  const rows = [];
  if (register?.servingWorker) rows.push({ field: 'servingWorker', row: register.servingWorker, routes: register.routes ?? [] });
  (Array.isArray(register?.appWorkers) ? register.appWorkers : []).forEach((w, i) =>
    rows.push({ field: `appWorkers[${i}]`, row: w, routes: w?.routes ?? [] }),
  );
  // ⏱ 2026-09-27 (SHIELD-F4): an EDGE Worker mounts no route, so it brings none.
  (Array.isArray(register?.edgeWorkers) ? register.edgeWorkers : []).forEach((e, i) =>
    rows.push({ field: `edgeWorkers[${i}]`, row: e, routes: [] }),
  );
  return rows;
}

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * `--for-deploy`: `{ entries, appWorkers, problems, lost }` for the tree at `root`.
 * `entries` is `[{ worker, dir, migrations, smokeUrl, origin, dsnSecret }]`, one per
 * member of the set, in the set's order; `appWorkers` names the entries whose
 * member matched an `appWorkers` row (the rest matched `servingWorker`); `problems`
 * are findings (exit 1); `lost` is non-empty when the register or the git index
 * could not be read (exit 2). `set` is workerSet(root), passed in so the CLI reads
 * the tree once.
 */
export function deploySet(root, set = workerSet(root), { lockfiles = true } = {}) {
  const problems = [];
  const lost = [];
  const appWorkers = [];
  if (set === null) {
    lost.push(`${join(root, SERVICES_DIR)} does not exist, so no Worker directory was read.`);
    return { entries: [], appWorkers, problems, lost };
  }
  const register = existsSync(join(root, REGISTER)) ? readJson(join(root, REGISTER)) : null;
  const rows = register === null ? [] : registerRows(register);
  if (rows.length === 0) {
    lost.push(`${REGISTER} is missing, is not JSON, or declares no servingWorker, appWorkers or edgeWorkers row.`);
    return { entries: [], appWorkers, problems, lost };
  }

  // Both ways: every directory has a row, and every row names a directory.
  const byDir = new Map();
  for (const r of rows) {
    const cfg = String(r.row?.config ?? '').replace(/\\/g, '/');
    const m = cfg.match(new RegExp(`^${SERVICES_DIR}/([^/]+)/${WORKER_CONFIG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    if (!m) {
      problems.push(
        `${REGISTER} ${r.field} names config \`${cfg || '(none)'}\`, which is not ${SERVICES_DIR}/<dir>/${WORKER_CONFIG}, ` +
          'so no Worker directory can be matched to it.',
      );
      continue;
    }
    if (byDir.has(m[1])) {
      problems.push(`${REGISTER} ${byDir.get(m[1]).field} and ${r.field} both name ${SERVICES_DIR}/${m[1]}.`);
      continue;
    }
    byDir.set(m[1], r);
  }
  for (const dir of set.workers) {
    if (!byDir.has(dir)) {
      problems.push(
        `${SERVICES_DIR}/${dir} holds a ${WORKER_CONFIG} and ${REGISTER} has no row for it (servingWorker, appWorkers[] or edgeWorkers[]). ` +
          'A Worker the register does not name has no host, no smoke URL and no crash-sink secret for a lane to read.',
      );
    }
  }
  for (const [dir, r] of byDir) {
    if (!set.workers.includes(dir)) {
      problems.push(
        `${REGISTER} ${r.field} (${r.row?.name ?? '?'}) names ${SERVICES_DIR}/${dir}, which is not a Worker directory ` +
          'on this tree. The register describes a Worker nothing installs or deploys.',
      );
    }
  }

  const entries = [];
  for (const dir of set.workers) {
    const rel = `${SERVICES_DIR}/${dir}`;

    // The HARD rule: a tracked lockfile, and it is this package's. Not asked by
    // appWorkerMatrix() (`lockfiles: false`): a guard reading what the matrix carries,
    // while the workflow's own `worker-set.mjs --for-deploy` holds each Worker to it.
    const pkg = lockfiles ? readJson(join(root, rel, 'package.json')) : null;
    if (lockfiles && pkg === null) problems.push(`${rel} has no readable package.json, so nothing says which lockfile is its own.`);
    if (!lockfiles) {
      // skipped: see above
    } else if (!existsSync(join(root, rel, 'package-lock.json'))) {
      problems.push(
        `${rel} has no package-lock.json. \`npm ci\` refuses without one and OSV-Scanner reads lockfiles, so this ` +
          'Worker would install a dependency tree nobody reviewed and nothing scanned. Commit its lockfile.',
      );
    } else {
      const t = spawnSync('git', ['-C', root, 'ls-files', '--error-unmatch', '--', `${rel}/package-lock.json`], { encoding: 'utf8' });
      if (t.error || (t.status !== 0 && !/did not match any file/i.test(t.stderr ?? ''))) {
        lost.push(
          `git could not say whether ${rel}/package-lock.json is tracked (${t.error?.message ?? (t.stderr ?? '').trim().split('\n')[0]}). ` +
            '"The lockfile is committed" has no answer without the index.',
        );
      } else if (t.status !== 0) {
        problems.push(
          `${rel}/package-lock.json is on disk and NOT tracked by git. A lockfile nobody committed is one the lane ` +
            'never sees: the checkout has no lockfile, and `npm ci` there refuses. Commit it.',
        );
      }
      const lock = readJson(join(root, rel, 'package-lock.json'));
      if (pkg !== null && (lock === null || lock.name !== pkg.name)) {
        problems.push(
          `${rel}/package-lock.json is the lockfile of "${lock?.name ?? '(unreadable)'}" and ${rel}/package.json is ` +
            `"${pkg.name}". A lockfile copied from another Worker pins that Worker's tree, not this one's.`,
        );
      }
    }

    const r = byDir.get(dir);
    if (!r) continue;

    // An EDGE Worker (above) owes the lockfile and nothing below: no DSN, no smoke
    // URL, no migrations. Its entry says so with nulls, and it is never an app Worker.
    if (r.field.startsWith('edgeWorkers')) {
      entries.push({ worker: String(r.row?.name ?? dir), dir: rel, migrations: null, smokeUrl: null, origin: null, dsnSecret: null });
      continue;
    }

    const dsnSecret = typeof r.row?.dsnSecret === 'string' && r.row.dsnSecret !== '' ? r.row.dsnSecret : null;
    if (dsnSecret === null) {
      problems.push(
        `${REGISTER} ${r.field} (${rel}) declares no \`dsnSecret\`: the name of the secret holding this Worker's ` +
          "crash-sink DSN. Without it a deploy lane falls back on one shared DSN, and app #2's crashes land in app #1's project.",
      );
    }

    let cfg = null;
    try {
      cfg = parseJsonc(readFileSync(join(root, rel, WORKER_CONFIG), 'utf8'));
    } catch (e) {
      problems.push(`${rel}/${WORKER_CONFIG} does not parse as JSONC (${e.message}).`);
    }
    const owned = (Array.isArray(cfg?.d1_databases) ? cfg.d1_databases : []).filter((d) => d && d.migrations_dir);
    if (owned.length > 1) {
      problems.push(
        `${rel}/${WORKER_CONFIG} migrates ${owned.length} D1 bindings (${owned.map((d) => d.binding).join(', ')}). ` +
          'A deploy applies one migration set before the deploy; which one is not a question this reader may guess.',
      );
    }
    const migrations = owned.length === 1 ? (owned[0].binding ?? null) : null;

    const host = Array.isArray(r.row?.hosts) && typeof r.row.hosts[0] === 'string' ? r.row.hosts[0] : null;
    const health = (Array.isArray(r.routes) ? r.routes : []).find(
      (x) => x?.method === 'GET' && /\/health$/.test(String(x?.path ?? '')),
    );
    if (host === null || !health) {
      problems.push(
        `${REGISTER} ${r.field} (${rel}) gives no smoke URL: ${host === null ? 'it names no host' : 'it declares no GET …/health route'}. ` +
          'A deploy that cannot probe what it published cannot tell a live Worker from a dead one.',
      );
    }
    const worker = String(r.row?.name ?? dir);
    // `startsWith('appWorkers')`, NEVER `!== 'servingWorker'` (SHIELD-F4): a third kind of row must not
    // fall into the app deploy matrix by being "not the serving Worker".
    if (r.field.startsWith('appWorkers')) appWorkers.push(worker);
    entries.push({
      worker,
      dir: rel,
      migrations,
      smokeUrl: host !== null && health ? `https://${host}${health.path}` : null,
      origin: host !== null ? `https://${host}` : null,
      dsnSecret,
    });
  }
  return { entries, appWorkers, problems, lost };
}

/** The deploy matrix: the `--for-deploy` entries of the app Workers, in the set's
 *  order. deploy-workers.yml's `app-worker` job runs one leg per entry, and
 *  assert-deploy-triggers-deploy.mjs grades each leg from this same answer. */
export function appWorkerEntries(d) {
  return d.entries.filter((e) => d.appWorkers.includes(e.worker));
}

/**
 * The deploy matrix as a GUARD reads it: `{ entries, lost }` for the tree at `root`,
 * where `entries` is what deploy-workers.yml's `app-worker` matrix carries on this
 * tree. The register rules hold (a row per directory, a `dsnSecret`, a smoke URL);
 * the lockfile rule is not asked, because the workflow's own
 * `worker-set.mjs --for-deploy` refuses a Worker without a committed lockfile before
 * any leg exists, and a guard should not need a git index to read a YAML field.
 * `lost` is why the matrix could not be read (no services/, no register, a register
 * finding, or no app Worker at all); each caller turns it into its own refusal.
 */
export function appWorkerMatrix(root) {
  const set = workerSet(root);
  const d = deploySet(root, set, { lockfiles: false });
  const why = d.lost[0] ?? d.problems[0] ?? null;
  if (why !== null) return { entries: [], lost: why };
  const entries = appWorkerEntries(d);
  if (entries.length === 0) {
    return { entries, lost: `${REGISTER} names no appWorkers row with a ${SERVICES_DIR}/ directory, so the app Worker matrix is empty.` };
  }
  return { entries, lost: null };
}

/**
 * The entries whose `<dir>/${WORKER_CONFIG}` declares an `env.<name>` block, in their
 * order: `--json --env <name>`'s narrowing, and the answer assert-release-provenance.mjs
 * limb 2b expands a matrix leg's `workingDirectory` over. A config that does not parse
 * is dropped here and is --for-deploy's finding, not this filter's.
 */
export function envEntries(root, entries, name) {
  return entries.filter((e) => {
    try {
      const cfg = parseJsonc(readFileSync(join(root, e.dir, WORKER_CONFIG), 'utf8'));
      const env = cfg?.env?.[name];
      return env !== null && typeof env === 'object' && !Array.isArray(env);
    } catch {
      return false;
    }
  });
}

/** Why each APP Worker entry of `d` (a deploySet() answer) is refused under
 *  `--env <name>`: one line per app Worker whose own `${WORKER_CONFIG}` declares no
 *  `env.<name>` block (or does not parse), in the set's order. Empty is the pass. */
export function envRefusals(root, d, name) {
  const app = appWorkerEntries(d);
  const kept = new Set(envEntries(root, app, name).map((e) => e.dir));
  return app
    .filter((e) => !kept.has(e.dir))
    .map(
      (e) =>
        `${e.dir}/${WORKER_CONFIG} (${e.worker}) is an app Worker and declares no \`env.${name}\` block. ` +
        `A \`--env ${name}\` deploy would leave it out without a word: give it the block the brick stamps ` +
        '(tooling/bricks/app/.../wrangler.jsonc env.sandbox), with its ids written by provision-backend.mjs.',
    );
}

/** `${{ matrix.<dimension>.<field> }}` naming a field of an appWorkerMatrix() entry —
 *  the one shape a workflow reads a deploy-matrix leg in. Group 1 is the dimension,
 *  group 2 the field. Global: callers use `matchAll` or reset `lastIndex`. */
export const WORKER_MATRIX_REF = /\$\{\{\s*matrix\.([A-Za-z_][A-Za-z0-9_-]*)\.(worker|dir|migrations|smokeUrl|origin|dsnSecret)\s*\}\}/g;

/** `text` with every WORKER_MATRIX_REF expanded over `entries`: one string per entry
 *  (in the matrix's order) when the text reads a leg, else `[text]` unchanged. */
export function expandWorkerMatrix(text, entries) {
  WORKER_MATRIX_REF.lastIndex = 0;
  if (!WORKER_MATRIX_REF.test(text)) return [text];
  return entries.map((e) => text.replace(WORKER_MATRIX_REF, (_, _dim, field) => String(e[field] ?? '')));
}

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nworker-set: FAILED');
  process.exit(2);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const emit = args.includes('--emit');
  const forDeploy = args.includes('--for-deploy');
  const json = args.includes('--json');
  const appOnly = args.includes('--app-workers');
  const USAGE = 'Usage: node tooling/ci/worker-set.mjs [--for-deploy] [--emit | --json [--app-workers] [--env <name>]] [repoRoot]';
  const envAt = args.indexOf('--env');
  const envName = envAt === -1 ? null : (args[envAt + 1] ?? '');
  const unknown = args.filter((a) => a.startsWith('--') && !['--emit', '--for-deploy', '--json', '--app-workers', '--env'].includes(a));
  if (unknown.length) {
    console.error(`FAIL worker-set: unknown flag ${unknown.join(', ')}. ${USAGE}`);
    process.exit(1);
  }
  if (envName !== null && !/^[a-z][a-z0-9_-]*$/.test(envName)) {
    console.error(`FAIL worker-set: --env needs an environment name ([a-z][a-z0-9_-]*), and got "${envName}". ${USAGE}`);
    process.exit(1);
  }
  if (envName !== null && !json) {
    console.error(`FAIL worker-set: --env narrows what --for-deploy --json prints, and --json was not given. ${USAGE}`);
    process.exit(1);
  }
  if (json && !forDeploy) {
    console.error(`FAIL worker-set: --json prints what --for-deploy checked, and --for-deploy was not given. ${USAGE}`);
    process.exit(1);
  }
  if (appOnly && !json) {
    console.error(`FAIL worker-set: --app-workers narrows what --for-deploy --json prints, and --json was not given. ${USAGE}`);
    process.exit(1);
  }
  if (json && emit) {
    console.error(`FAIL worker-set: --emit and --json print two different shapes; pass one. ${USAGE}`);
    process.exit(1);
  }
  const rootArg = args.find((a, i) => !a.startsWith('--') && !(envAt !== -1 && i === envAt + 1));
  const root = resolve(rootArg ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const set = workerSet(root);
  if (set === null) {
    coverageLost([
      `${join(root, SERVICES_DIR)} does not exist, so no Worker directory was read.`,
      'The worker matrix is built from this set; printing none would say "no Workers" about a tree this never reached.',
    ]);
  }
  if (set.strays.length) {
    console.error(
      `FAIL worker-set: ${set.strays.map((s) => `${SERVICES_DIR}/${s}`).join(', ')} ` +
        `${set.strays.length === 1 ? 'is' : 'are'} neither ${SERVICES_DIR}/${SHARED_DIR} nor a Worker (no ${WORKER_CONFIG}).`,
    );
    console.error(
      '     A Worker whose config moved drops out of the worker matrix without a word, and its tests stop running while',
    );
    console.error(`     the lane stays green. Give it a ${WORKER_CONFIG}, or move shared source into ${SERVICES_DIR}/${SHARED_DIR}.`);
    process.exit(1);
  }
  if (set.workers.length === 0) {
    coverageLost([
      `${join(root, SERVICES_DIR)} holds no directory with a ${WORKER_CONFIG}.`,
      'An empty worker matrix is a lane that tests nothing; refusing to emit one.',
    ]);
  }
  if (forDeploy) {
    const d = deploySet(root, set);
    if (d.lost.length) {
      coverageLost([
        d.lost[0],
        ...d.lost.slice(1),
        '--for-deploy holds every Worker to the register and its committed lockfile; unread, that is no answer.',
      ]);
    }
    if (d.problems.length) {
      console.error('');
      for (const p of d.problems) console.error(`FAIL worker-set --for-deploy: ${p}`);
      console.error('\nworker-set: FAILED');
      process.exit(1);
    }
    if (envName !== null) {
      const refused = envRefusals(root, d, envName);
      if (refused.length) {
        console.error('');
        for (const r of refused) console.error(`FAIL worker-set --env ${envName}: ${r}`);
        console.error('\nworker-set: FAILED');
        process.exit(1);
      }
    }
    if (json) {
      const picked = appOnly ? appWorkerEntries(d) : d.entries;
      console.log(JSON.stringify(envName === null ? picked : envEntries(root, picked, envName)));
    }
    else if (emit) console.log(JSON.stringify(set.workers));
    else for (const e of d.entries) console.log(`${e.worker}  ${e.dir}  ${e.migrations ?? '-'}  ${e.smokeUrl}  ${e.dsnSecret}`);
    process.exit(0);
  }
  console.log(emit ? JSON.stringify(set.workers) : set.workers.join('\n'));
}
