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
// Usage:  node tooling/ci/worker-set.mjs [--for-deploy] [--emit | --json] [repoRoot]
//   --emit        prints the set as ONE JSON array (`["platform","subscriptiontracker-api"]`),
//                 the value lane-workers.yml's `detect` writes to `workers=`;
//   --for-deploy  holds each member to the register, its lockfile and its `dsnSecret`
//                 first (above), and prints nothing unless all of it holds;
//   --json        with --for-deploy only: `[{worker, dir, migrations, smokeUrl, dsnSecret}]`;
//   with none of the three, one directory name per line.
// Exit 0 = the set is non-empty, every directory under services/ is placed, and
//          (--for-deploy) every member holds.
// Exit 1 = a directory under services/ is neither `_shared` nor a Worker, or
//          (--for-deploy) a member fails the register, its lockfile or `dsnSecret`.
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
 * `--for-deploy`: `{ entries, problems, lost }` for the tree at `root`. `entries`
 * is `[{ worker, dir, migrations, smokeUrl, dsnSecret }]`, one per member of the
 * set, in the set's order; `problems` are findings (exit 1); `lost` is non-empty
 * when the register or the git index could not be read (exit 2). `set` is
 * workerSet(root), passed in so the CLI reads the tree once.
 */
export function deploySet(root, set = workerSet(root)) {
  const problems = [];
  const lost = [];
  if (set === null) {
    lost.push(`${join(root, SERVICES_DIR)} does not exist, so no Worker directory was read.`);
    return { entries: [], problems, lost };
  }
  const register = existsSync(join(root, REGISTER)) ? readJson(join(root, REGISTER)) : null;
  const rows = register === null ? [] : registerRows(register);
  if (rows.length === 0) {
    lost.push(`${REGISTER} is missing, is not JSON, or declares no servingWorker and no appWorkers row.`);
    return { entries: [], problems, lost };
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
        `${SERVICES_DIR}/${dir} holds a ${WORKER_CONFIG} and ${REGISTER} has no row for it (servingWorker or appWorkers[]). ` +
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

    // The HARD rule: a tracked lockfile, and it is this package's.
    const pkg = readJson(join(root, rel, 'package.json'));
    if (pkg === null) problems.push(`${rel} has no readable package.json, so nothing says which lockfile is its own.`);
    if (!existsSync(join(root, rel, 'package-lock.json'))) {
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
    entries.push({
      worker: String(r.row?.name ?? dir),
      dir: rel,
      migrations,
      smokeUrl: host !== null && health ? `https://${host}${health.path}` : null,
      dsnSecret,
    });
  }
  return { entries, problems, lost };
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
  const USAGE = 'Usage: node tooling/ci/worker-set.mjs [--for-deploy] [--emit | --json] [repoRoot]';
  const unknown = args.filter((a) => a.startsWith('--') && !['--emit', '--for-deploy', '--json'].includes(a));
  if (unknown.length) {
    console.error(`FAIL worker-set: unknown flag ${unknown.join(', ')}. ${USAGE}`);
    process.exit(1);
  }
  if (json && !forDeploy) {
    console.error(`FAIL worker-set: --json prints what --for-deploy checked, and --for-deploy was not given. ${USAGE}`);
    process.exit(1);
  }
  if (json && emit) {
    console.error(`FAIL worker-set: --emit and --json print two different shapes; pass one. ${USAGE}`);
    process.exit(1);
  }
  const rootArg = args.find((a) => !a.startsWith('--'));
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
    if (json) console.log(JSON.stringify(d.entries));
    else if (emit) console.log(JSON.stringify(set.workers));
    else for (const e of d.entries) console.log(`${e.worker}  ${e.dir}  ${e.migrations ?? '-'}  ${e.smokeUrl}  ${e.dsnSecret}`);
    process.exit(0);
  }
  console.log(emit ? JSON.stringify(set.workers) : set.workers.join('\n'));
}
