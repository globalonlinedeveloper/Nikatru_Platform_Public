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
// WHAT RESTORE PUTS BACK — ONLY the stamp's own write set (STAMP_WRITES,
// recorded in the snapshot), measured by git inside that set:
//   · a set path the run changed that was clean before → `git checkout HEAD --`
//   · a set path that was ALREADY dirty or untracked before (a person's own
//     edit) → its bytes from the snapshot, never HEAD's, so an edit is not lost
//   · an untracked, non-ignored set path the run created → removed
//   · a STAMP_PATHS directory (gitignored, so git does not list it) → removed.
//     One that is there BEFORE the run is a leftover: the snapshot REFUSES and
//     names the move that clears it, rather than grading old and new output mixed.
// 🔴 ANY OTHER PATH THAT CHANGED DURING THE STAMP IS LEFT AS IS (review
// fc4d5cab finding 1): leg 5 runs for minutes, and a person's editor or another
// tool may write meanwhile. Restoring "everything that turned dirty" reverted a
// saved edit to HEAD and deleted a new file, on a green leg. Such a path is
// named as `changed during the stamp, not by it: <path>` (a ⬜ line, so
// preflight prints it on a green leg) and never checked out or removed. A stamp
// output missing from STAMP_WRITES is therefore left on disk and named, and
// preflight's tree-clean leg fails on it: loud, never a lost edit.
//
// Usage (a lane replaying the app_brick job's commands locally):
//   node tooling/kit/stamp-sandbox.mjs snapshot <file.json> [--root <dir>]
//   … stamp, analyze, grade …
//   node tooling/kit/stamp-sandbox.mjs restore <file.json>
// Keep <file.json> outside the repository (os.tmpdir()). restore puts back the
// root the snapshot recorded, after checking it (validateSnapshot): the root is
// a git top-level, every path stays inside it, and the recorded write set is
// STAMP_WRITES or part of it. Otherwise it exits 2 and writes nothing.
// snapshot makes the same checks FIRST (review f5b054c5 finding 1): a root
// restore would refuse exits 2 there, with no snapshot written and nothing
// stamped. The root is compared canonically (sameDir, realpathSync.native), so
// a Windows 8.3 short name (%TEMP% = C:\Users\LOCALU~2\…) is the same root.
//
// Windows: git is spawned without a shell; every git path is '/'-separated and
// joined onto the root by splitting on '/'. No shebang or .sh helper is run.
// Tested by tooling/ci/test/stamp-sandbox.test.mjs against real git repos.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, readdirSync, rmdirSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The gitignored directories a throwaway brick stamp writes (.gitignore,
 *  "Throwaway apps stamped by the brick CI lane"). git does not list them, so
 *  restore removes each by name. */
export const STAMP_PATHS = ['apps/probe', 'apps/probeapi', 'services/probe-api', 'services/probeapi-api', 'services/probesvc-api'];

/** EVERY path a throwaway stamp of the probes writes, and the only paths
 *  restore touches. An entry ending in '/' is a directory (everything under it);
 *  any other entry is one file. Read off the writers, 2026-10-03:
 *    · mason + post_gen (tooling/bricks/app/hooks/post_gen.dart): the stamp
 *      directories (the store folders, brand assets, msix_config and native
 *      platforms all live under apps/<id>/), and the root pubspec.yaml workspace
 *      list. pubspec.lock: a root `flutter pub get` (stamp-app.mjs) re-resolves it.
 *    · the site chain post_gen runs (tooling/sites/regen.mjs ORDER): render
 *      (catalog/apps.json, the RevenueCat and store-SKU modules), render-privacy
 *      (sites/nikatru/<id>/privacy.html, the extension listing template),
 *      apps-data, landing-payload, auth-mail, well-known, personal-site.
 *      discovery is git-dated and not run in write mode.
 *    · tooling/kit/stamp-shared.mjs: catalog/bundles.json, the mail transport,
 *      the e2e leg register. tooling/ci/tag-owner.mjs --write: the
 *      tag-triggered release lanes, asked of tag-owner below. The channel register: post_gen reads it, and
 *      the pre-2026-10-03 restore named it, so it stays in the set.
 *  A writer that joins the stamp and is not listed here is LEFT on disk and
 *  named by restore; preflight's tree-clean leg then fails on it. Add it here. */
export const STAMP_WRITES = Object.freeze([
  ...STAMP_PATHS.map((p) => `${p}/`),
  'pubspec.yaml',
  'pubspec.lock',
  'sites/_shared/_data/apps.json',
  'sites/nikatru/probe/',
  'sites/nikatru/probeapi/',
  'sites/nikatru/.well-known/',
  'sites/nikatru/auth-mail/',
  'sites/rajasekarselvam/index.html',
  'sites/rajasekarselvam/llms.txt',
  'sites/rajasekarselvam/sitemap.xml',
  'services/platform/src/lib/mor/revenuecat-app-ids.ts',
  'services/platform/src/lib/mor/store-skus.ts',
  'extensions/templates/tool/publish/STORE-LISTING.md',
  'tooling/channel-register.json',
  'tooling/mail-transport.json',
  'tooling/e2e-leg-register.json',
  // The catalogue files (render, landing-payload, stamp-shared's bundle
  // exclusions) and the release lanes tag-owner.mjs --write rewrites, asked of
  // the modules that own them rather than typed here: the catalogue is read
  // through tooling/catalog/read.mjs (assert-bundle-availability limb G) and
  // workflows through their owners (assert-workflow-readers). One that cannot
  // be asked adds nothing, and a write there is left on disk and named: loud,
  // never reverted blind.
  ...(await fromOwner('../app-yaml/render.mjs', (m) => [m.CATALOGUE])),
  ...(await fromOwner('../sites/generate-landing-payload.mjs', (m) => [m.PAYLOAD])),
  ...(await fromOwner('../catalog/read.mjs', (m) => [m.BUNDLES_REGISTER])),
  ...(await fromOwner('../ci/tag-owner.mjs', (m) => [...m.derive(REPO).lanes.keys()])),
]);

/** Imported lazily: preflight's fixture suites copy this file without its
 *  owners, and there the set simply holds none of their paths (see above). */
async function fromOwner(spec, pick) {
  try {
    return pick(await import(spec)).filter((p) => typeof p === 'string' && p);
  } catch {
    return [];
  }
}

/** Is git path `rel` in the write set `writes`? */
export function inWriteSet(rel, writes = STAMP_WRITES) {
  return writes.some((w) => (w.endsWith('/') ? rel.startsWith(w) : rel === w));
}

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

/** The commands that MOVE each leftover stamp directory out of `root`, one per
 *  line: a PowerShell form (Windows PowerShell 5.1 has no `&&`, review f5b054c5
 *  nit 2) and a bash form. Single-quoted: neither shell expands inside, and a
 *  quote in a path is doubled for PowerShell and closed-escaped for bash. -LiteralPath, because
 *  PowerShell reads `[` and `]` in -Path as wildcards (review 008cddae nit). */
export function moveCommands(root, found, dest = path.join(tmpdir(), 'stamped')) {
  const ps = (s) => `'${s.replace(/'/g, "''")}'`;
  const sh = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  return found
    .flatMap((p) => [
      `  PowerShell:  New-Item -ItemType Directory -Force ${ps(dest)} | Out-Null; Move-Item -LiteralPath ${ps(abs(root, p))} -Destination ${ps(dest)}`,
      `  bash:        mkdir -p ${sh(dest)} && mv ${sh(abs(root, p))} ${sh(dest)}/`,
    ])
    .join('\n');
}

/** A stamp directory left from an earlier run. The snapshot refuses rather than
 *  let mason `--on-conflict overwrite` into it and grade old and new output
 *  mixed (review fc4d5cab nit 2). The fix it names MOVES, never deletes. */
export class StampLeftover extends Error {
  constructor(root, found) {
    super(
      `${found.join(', ')} exists from an earlier stamp, so this run would mix its output with the old one. ` +
        `Move it out of the repository, then run again:\n${moveCommands(root, found)}`,
    );
    this.name = 'StampLeftover';
    this.found = found;
  }
}

/** The tree before a stamp: every dirty or untracked path with its bytes, and
 *  the write set restore may act on. Throws when git cannot answer — "could not
 *  look" must never become "nothing to restore" — and StampLeftover when a
 *  stamp directory is already there. */
export function snapshotTree(root = REPO) {
  const status = porcelain(root);
  const leftover = STAMP_PATHS.filter((p) => existsSync(abs(root, p)));
  if (leftover.length) throw new StampLeftover(root, leftover);
  const files = {};
  for (const [rel, xy] of status) {
    const b = bytesOf(abs(root, rel));
    files[rel] = { xy, bytes: b === null ? null : b.toString('base64') };
  }
  const snap = { root, files, writes: [...STAMP_WRITES] };
  // 🔴 The checks restore makes, made HERE, before anything is stamped (review
  // f5b054c5 finding 1b): a snapshot restore would refuse must stop the stamp,
  // never surface in its finally with the stamp already on disk.
  const problems = validateSnapshot(snap);
  if (problems.length) throw new SnapshotRefused(problems, 'snapshotted, nothing may be stamped');
  return snap;
}

/** Thrown by restoreTree for a snapshot it will not act on (exit 2 from the CLI). */
export class SnapshotRefused extends Error {
  constructor(problems, outcome = 'restored') {
    super(`the snapshot was refused, nothing was ${outcome}: ${problems.join('; ')}`);
    this.name = 'SnapshotRefused';
    this.problems = problems;
  }
}

/** Do `a` and `b` name the same directory? Compared CANONICAL (review f5b054c5
 *  finding 1a): git answers --show-toplevel with the long path
 *  (C:/Users/localuserwin11/…) while a root reached through %TEMP% keeps its
 *  8.3 short name (C:\Users\LOCALU~2\…). The JS realpathSync does not expand
 *  a short name; realpathSync.native does (it also resolves a POSIX symlink).
 *  Case-insensitive on win32. `realpath` and `platform` are injectable so the
 *  suite proves the short-name case on Linux. */
export function sameDir(a, b, { realpath = realpathSync.native, platform = process.platform } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  let x;
  let y;
  try {
    x = p.resolve(realpath(p.resolve(a)));
    y = p.resolve(realpath(p.resolve(b)));
  } catch {
    return false;
  }
  return platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/** Is git path `rel` a plain relative path that stays under `root`? */
function contained(root, rel) {
  if (typeof rel !== 'string' || rel === '' || isAbsolute(rel)) return false;
  const back = relative(resolve(root), resolve(abs(root, rel)));
  return back !== '' && !back.startsWith('..') && !isAbsolute(back);
}

/** Why `snap` must not be restored, or [] (review fc4d5cab nit 3): its root is
 *  this checkout's git top-level, every path in it stays inside that root, and
 *  its write set is STAMP_WRITES or a part of it. */
export function validateSnapshot(snap) {
  const problems = [];
  if (!snap || typeof snap !== 'object' || typeof snap.root !== 'string' || !snap.files || typeof snap.files !== 'object' || !Array.isArray(snap.writes)) {
    return ['it is not a snapshot (root, files and writes are required)'];
  }
  const { root } = snap;
  let top = null;
  try {
    top = git(root, ['rev-parse', '--show-toplevel']).trim();
  } catch (e) {
    problems.push(`root ${root} is not a git repository (${e.message})`);
  }
  if (top !== null && !sameDir(top, root)) problems.push(`root ${root} is not a git top-level (that is ${top})`);
  for (const w of snap.writes) {
    if (!STAMP_WRITES.includes(w)) problems.push(`write-set entry ${JSON.stringify(w)} is not in STAMP_WRITES`);
    else if (!contained(root, w.replace(/\/$/, ''))) problems.push(`write-set entry ${JSON.stringify(w)} leaves the root`);
  }
  for (const rel of Object.keys(snap.files)) {
    if (!contained(root, rel)) problems.push(`path ${JSON.stringify(rel)} leaves the root`);
  }
  return problems;
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

/** Put the stamp's write set back as `snap` found it. Returns what it did;
 *  `left` names what it could not restore (it still restores everything
 *  else), `foreign` what changed during the stamp OUTSIDE its write set, which
 *  is never touched. Throws SnapshotRefused for a snapshot validateSnapshot
 *  rejects. */
export function restoreTree(snap) {
  const problems = validateSnapshot(snap);
  if (problems.length) throw new SnapshotRefused(problems);
  const { root, writes } = snap;
  const mine = (rel) => inWriteSet(rel, writes);
  const restored = [];
  const removed = [];
  const left = [];
  const foreign = [];
  // 1 · stamp directories (gitignored: git will not list them). The snapshot
  //     refused to start with one present, so any one here is this run's.
  for (const p of STAMP_PATHS) {
    if (!writes.includes(`${p}/`)) continue;
    if (!existsSync(abs(root, p))) continue;
    try {
      rmSync(abs(root, p), { recursive: true, force: true });
      removed.push(`${p}/`);
    } catch (e) {
      left.push(`${p}/ (${e.code ?? e.message})`);
    }
  }
  // 2 · paths git now lists that the snapshot did not: the run's own changes,
  //     when they are in the write set; anybody's, when they are not.
  const now = porcelain(root);
  const toCheckout = [];
  for (const [rel, xy] of now) {
    if (Object.hasOwn(snap.files, rel)) continue;
    if (!mine(rel)) {
      foreign.push(rel);
      continue;
    }
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
  // 3 · paths that were already dirty or untracked: their snapshot bytes, not
  //     HEAD's, inside the write set. Outside it, a change is somebody else's.
  for (const [rel, { bytes }] of Object.entries(snap.files)) {
    const file = abs(root, rel);
    const want = bytes === null ? null : Buffer.from(bytes, 'base64');
    const have = bytesOf(file);
    if (want === null ? have === null : have !== null && have.equals(want)) continue;
    if (!mine(rel)) {
      foreign.push(rel);
      continue;
    }
    if (want === null) {
      // It was a deletion (or a directory entry); a file there now is the run's.
      try {
        rmSync(file, { force: true });
        restored.push(rel);
      } catch (e) {
        left.push(`${rel} (${e.code ?? e.message})`);
      }
      continue;
    }
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, want);
      restored.push(rel);
    } catch (e) {
      left.push(`${rel} (${e.code ?? e.message})`);
    }
  }
  return { restored, removed, left, foreign };
}

/** What restore did, and anything it could not or would not touch. The first
 *  line is the summary; each path changed outside the write set gets its own
 *  ⬜ line, which preflight prints on a green leg too. */
export function describeRestore({ restored, removed, left, foreign = [] }) {
  const parts = [`restored ${restored.length} file(s), removed ${removed.length} stamp path(s)`];
  if (left.length) parts.push(`🔴 COULD NOT RESTORE ${left.length}: ${left.join(', ')}`);
  if (foreign.length) parts.push(`left ${foreign.length} path(s) it did not write`);
  return [parts.join('; '), ...foreign.map((p) => `⬜ changed during the stamp, not by it: ${p} (left as is)`)].join('\n');
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
    console.error(`stamp-sandbox: ${cmd} ${e instanceof StampLeftover || e instanceof SnapshotRefused ? 'refused' : 'failed'} — ${e.message}`);
    process.exit(e instanceof SnapshotRefused || e instanceof SyntaxError ? 2 : 1);
  }
}
