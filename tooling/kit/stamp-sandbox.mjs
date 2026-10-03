#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// stamp-sandbox.mjs — a throwaway stamp INSIDE the repository leaves the tree
// exactly as it found it, on a throw too.
//
// ⏱ 2026-10-03 (fix-brick-stamp-outside-repo). A local throwaway stamp of the
// app brick (apps/probe, apps/probeapi, their Workers) left its output on disk
// and registered in tracked files (pubspec.yaml, catalog/apps.json, the
// channel register, …). Every guard that lists apps/ or services/ then read
// the probe as a real app and failed, and two merge rounds stalled 80+ min on
// it. preflight's stamp leg restored three named files, NOT in a finally, and
// left every other file post_gen writes.
//
// WHY IN THE TREE AT ALL. The throwaway stamp is graded against the workspace
// (assert-app-dod.mjs reads the probe as a workspace member, mason's post_gen
// registers it in root files), so it cannot be stamped under os.tmpdir(). The
// rule for an in-tree stamp is therefore: snapshot first, restore in a finally,
// and gitignore the stamp directories (.gitignore, "Throwaway apps stamped by
// the brick CI lane") so a hard crash leaves nothing a `git add -A` takes.
//
// WHAT RESTORE PUTS BACK, measured by git, never by a list of names:
//   · a tracked file the run changed that was clean before → `git checkout HEAD --`
//   · a file that was ALREADY dirty or untracked before (a person's own edit)
//     → its bytes from the snapshot, never HEAD's, so an edit is not lost
//   · an untracked, non-ignored file the run created → removed
//   · a STAMP_PATHS directory (gitignored, so git does not list it) the run
//     created → removed. One that existed before is left alone: it is not
//     this run's.
//
// Usage (a lane replaying the app_brick job's commands locally):
//   node tooling/kit/stamp-sandbox.mjs snapshot <file.json> [--root <dir>]
//   … stamp, analyze, grade …
//   node tooling/kit/stamp-sandbox.mjs restore <file.json>
// Keep <file.json> outside the repository (os.tmpdir()). restore puts back the
// root the snapshot recorded.
//
// Windows: git is spawned without a shell; every git path is '/'-separated and
// joined onto the root by splitting on '/'. No shebang or .sh helper is run.
// Tested by tooling/ci/test/stamp-sandbox.test.mjs against real git repos.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, readdirSync, rmdirSync, mkdirSync } from 'node:fs';
import path, { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The gitignored directories a throwaway brick stamp writes (.gitignore,
 *  "Throwaway apps stamped by the brick CI lane"). git does not list them, so
 *  restore removes each by name when the run created it. */
export const STAMP_PATHS = ['apps/probe', 'apps/probeapi', 'services/probe-api', 'services/probeapi-api', 'services/probesvc-api'];

/** A git path ('/'-separated, always) as a path on THIS platform. `p` is
 *  injectable so the suite proves the win32 join on Linux. */
export function fsPath(root, rel, p = path) {
  return p.join(root, ...rel.split('/'));
}
const abs = (root, rel) => fsPath(root, rel);

function git(root, args) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'buffer', shell: false, windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${r.error?.code ?? `exit ${r.status}`}): ${(r.stderr ?? '').toString().trim().split(/\r?\n/)[0] ?? ''}`);
  }
  return r.stdout.toString('utf8');
}

/** `git status --porcelain=v1 -z` as Map<path, XY>. A rename's source path is
 *  listed too, so restoring either side is possible. */
export function porcelain(root) {
  const out = new Map();
  const parts = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']).split('\0');
  for (const p of parts) {
    if (p.length < 4) continue;
    out.set(p.slice(3), p.slice(0, 2));
  }
  return out;
}

/** The file's bytes, or null for a missing path or a directory. Read in ONE
 *  call, never stat-then-read: a check-then-use pair is a file-system race
 *  (CodeQL js/file-system-race, alert #592 on #1186). */
function bytesOf(file) {
  try {
    return readFileSync(file);
  } catch {
    return null;
  }
}

/** The tree before a stamp: every dirty or untracked path with its bytes, and
 *  which STAMP_PATHS already existed. Throws when git cannot answer — "could
 *  not look" must never become "nothing to restore". */
export function snapshotTree(root = REPO) {
  const status = porcelain(root);
  const files = {};
  for (const [rel, xy] of status) {
    const b = bytesOf(abs(root, rel));
    files[rel] = { xy, bytes: b === null ? null : b.toString('base64') };
  }
  const stamps = STAMP_PATHS.filter((p) => existsSync(abs(root, p)));
  return { root, files, stamps };
}

/** Remove a file and every directory above it the removal left empty, up to
 *  (never including) the root. */
function removeFile(root, rel) {
  rmSync(abs(root, rel), { force: true });
  let dir = dirname(abs(root, rel));
  const top = resolve(root);
  while (resolve(dir) !== top && resolve(dir).startsWith(top)) {
    try {
      if (readdirSync(dir).length !== 0) break;
      rmdirSync(dir);
    } catch {
      break;
    }
    dir = dirname(dir);
  }
}

/** Put the tree back as `snap` found it. Returns what it did; `left` names
 *  what it could not restore (it still restores everything else). */
export function restoreTree(snap) {
  const { root } = snap;
  const restored = [];
  const removed = [];
  const left = [];
  // 1 · stamp directories this run created (gitignored: git will not list them).
  for (const p of STAMP_PATHS) {
    if (snap.stamps.includes(p)) continue;
    if (!existsSync(abs(root, p))) continue;
    try {
      rmSync(abs(root, p), { recursive: true, force: true });
      removed.push(`${p}/`);
    } catch (e) {
      left.push(`${p}/ (${e.code ?? e.message})`);
    }
  }
  // 2 · paths git now lists that the snapshot did not: the run's own changes.
  const now = porcelain(root);
  const toCheckout = [];
  for (const [rel, xy] of now) {
    if (Object.hasOwn(snap.files, rel)) continue;
    if (xy === '??') {
      try {
        removeFile(root, rel);
        removed.push(rel);
      } catch (e) {
        left.push(`${rel} (${e.code ?? e.message})`);
      }
    } else if (xy[0] === 'A') {
      // New in the index, so HEAD has nothing to check out: unstage it, then remove it.
      try {
        git(root, ['rm', '--cached', '--quiet', '--force', '--', rel]);
        removeFile(root, rel);
        removed.push(rel);
      } catch (e) {
        left.push(`${rel} (${e.message})`);
      }
    } else {
      toCheckout.push(rel);
    }
  }
  if (toCheckout.length) {
    // Batched so a stamp that touched hundreds of files stays under Windows' command-line limit.
    for (let i = 0; i < toCheckout.length; i += 50) {
      const batch = toCheckout.slice(i, i + 50);
      try {
        git(root, ['checkout', 'HEAD', '--', ...batch]);
        restored.push(...batch);
      } catch (e) {
        left.push(...batch.map((r) => `${r} (${e.message})`));
      }
    }
  }
  // 3 · paths that were already dirty or untracked: their snapshot bytes, not HEAD's.
  for (const [rel, { bytes }] of Object.entries(snap.files)) {
    const file = abs(root, rel);
    const want = bytes === null ? null : Buffer.from(bytes, 'base64');
    const have = bytesOf(file);
    if (want === null) {
      // It was a deletion (or a directory entry); a file there now is the run's.
      if (have !== null) {
        try {
          rmSync(file, { force: true });
          restored.push(rel);
        } catch (e) {
          left.push(`${rel} (${e.code ?? e.message})`);
        }
      }
      continue;
    }
    if (have !== null && have.equals(want)) continue;
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, want);
      restored.push(rel);
    } catch (e) {
      left.push(`${rel} (${e.code ?? e.message})`);
    }
  }
  return { restored, removed, left };
}

/** One line for a log: what restore did, and anything it could not. */
export function describeRestore({ restored, removed, left }) {
  const parts = [`restored ${restored.length} file(s), removed ${removed.length} stamp path(s)`];
  if (left.length) parts.push(`🔴 COULD NOT RESTORE ${left.length}: ${left.join(', ')}`);
  return parts.join('; ');
}

// Windows: a drive letter's case is not a path's identity.
const norm = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
const isMain = Boolean(process.argv[1]) && norm(process.argv[1]) === norm(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--root');
  const root = at === -1 ? REPO : resolve(argv[at + 1] ?? '');
  const [cmd, file] = at === -1 ? argv : argv.filter((_, i) => i !== at && i !== at + 1);
  if (!['snapshot', 'restore'].includes(cmd) || !file || (at !== -1 && !argv[at + 1])) {
    console.error('usage: node tooling/kit/stamp-sandbox.mjs snapshot|restore <file.json> [--root <dir>]   (keep the file outside the repository)');
    process.exit(2);
  }
  try {
    if (cmd === 'snapshot') {
      writeFileSync(file, JSON.stringify(snapshotTree(root)));
      console.log(`stamp-sandbox: snapshot of ${root} written to ${file}`);
    } else {
      const r = restoreTree(JSON.parse(readFileSync(file, 'utf8')));
      console.log(`stamp-sandbox: ${describeRestore(r)}`);
      for (const p of [...r.removed, ...r.restored]) console.log(`  · ${p}`);
      if (r.left.length) process.exit(1);
    }
  } catch (e) {
    console.error(`stamp-sandbox: ${cmd} failed — ${e.message}`);
    process.exit(1);
  }
}
