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
// Usage:  node tooling/ci/worker-set.mjs [--emit] [repoRoot]
//   --emit  prints the set as ONE JSON array (`["platform","subscriptiontracker-api"]`),
//           the value lane-workers.yml's `detect` writes to `workers=`;
//   without it, one directory name per line.
// Exit 0 = the set is non-empty and every directory under services/ is placed.
// Exit 1 = a directory under services/ is neither `_shared` nor a Worker.
// Exit 2 = COVERAGE LOST: no services/ directory, or no Worker in it.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';

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
  const unknown = args.filter((a) => a.startsWith('--') && a !== '--emit');
  if (unknown.length) {
    console.error(`FAIL worker-set: unknown flag ${unknown.join(', ')}. Usage: node tooling/ci/worker-set.mjs [--emit] [repoRoot]`);
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
  console.log(emit ? JSON.stringify(set.workers) : set.workers.join('\n'));
}
