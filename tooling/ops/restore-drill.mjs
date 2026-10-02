#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// restore-drill.mjs — ONE NAMED SMALL FILE BACK FROM THE NEWEST SNAPSHOT of a
// backup set, verified against the hash its SOURCE recorded, then deleted.
//
//   node tooling/ops/restore-drill.mjs <set> --to <scratch dir> [--file <path>]
//        [--restic-bin <path>] [--rclone-bin <path>] [--root <repoRoot>]
//   A --*-bin ending .js/.cjs/.mjs is run with this node (process.execPath).
//
// Row O-BOXES-NOT-DECLARED-AS-DATA. The sets, their destinations and each
// set's drill are tooling/boxes/backups.json (read through
// tooling/ops/box-declaration.mjs). A backup nobody restores is a hope; this is
// the smallest restore that proves the newest copy is readable AND is the
// bytes the source had.
//
// WHERE THE HASH COMES FROM (`drill.hash`), never from the copy being tested:
//   restic-tree  restic's own tree records a small file's content as ONE blob
//                whose id IS the SHA-256 of its plaintext, written at backup
//                time. A file of more than one chunk is LOST (pick a smaller one).
//   manifest     the export's manifest records every object's SHA-256
//                (services/platform/src/backup/index.ts writes it).
//   recorded     `drill.sha256` in backups.json, measured at the source.
//
// 🔴 READ-ONLY toward the repository and the box's live data. Restic runs with
// --no-lock (a lock is a write) and --no-cache (a cached tree answered for a
// corrupted repository, measured 2026-10-01); rclone only lists, cats and
// copies OUT. Nothing
// is ever read from a box: a `box-dir` destination is refused, because the
// drill would then be reading the very disk a move is leaving. Trap backup-06:
// the drill reads and never runs a backup. Trap backup-05: `rclone lsf` lists
// subdirectories too, so a dated directory is PARSED by name, never inferred
// from a non-empty answer.
//
// THE SCRATCH COPY: restored into a fresh directory under --to, hashed, then
// deleted with that directory; the deletion is checked.
//
// Credentials: the destination's `env` NAMES (a list inside a list is "one of").
// An unset name, or a `<NAME>` placeholder whose variable is unset, is LOST;
// every value is redacted from anything printed.
//
// Exit 0 PASS · 1 FAIL (no snapshot, a restore that errors — a corrupted object —,
// an empty file, a hash that differs, a scratch copy that would not delete) ·
// 2 LOST (an unknown set, an UNREAD drill, a missing tool or credential, a
// repository that could not be listed). The first line names the verdict.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join, posix, resolve, win32 } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateAll } from './box-declaration.mjs';

export const CALL_TIMEOUT_MS = 300_000;
const DATED_DIR = /^(\d{4}-\d{2}-\d{2})\/$/;
const HOST_PATH = process.platform === 'win32' ? win32 : posix;

export function parseArgs(argv) {
  const out = { set: null, to: null, file: null, root: null, resticBin: 'restic', rcloneBin: 'rclone' };
  const pos = [];
  const flags = { '--to': 'to', '--file': 'file', '--root': 'root', '--restic-bin': 'resticBin', '--rclone-bin': 'rcloneBin' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (flags[a]) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
      out[flags[a]] = v;
      i++;
      continue;
    }
    if (a.startsWith('-')) return { error: `unknown flag ${a}` };
    pos.push(a);
  }
  if (pos.length !== 1) return { error: `expected exactly one <set>, got ${pos.length}` };
  if (!out.to) return { error: '--to <scratch dir> is required' };
  out.set = pos[0];
  return out;
}


/** Resolve `<NAME>` placeholders from env; {value} or {missing: [...]}. */
export function fill(template, env) {
  const missing = [];
  const value = String(template).replace(/<([A-Z][A-Z0-9_]*)>/g, (_, n) => { if (!env[n]) missing.push(n); return env[n] ?? ''; });
  return missing.length ? { missing } : { value };
}

/** The env NAMES a destination needs that are unset (a nested list is one-of). */
export function missingEnv(names, env) {
  return (names ?? []).filter((n) => (Array.isArray(n) ? !n.some((x) => env[x]) : !env[n])).map((n) => (Array.isArray(n) ? n.join(' | ') : n));
}

/**
 * Is `target` the repository `root` or inside it? Under `p`'s semantics: on
 * win32 a drive letter and every name compare case-insensitively, `\` and `/`
 * are one separator, and a `\\?\` long-path prefix is the same path. A string
 * prefix test fails OPEN there (#1148: `startsWith(`${root}/`)` against a
 * backslashed resolve). `real` maps a path to its target through symlinks and
 * junctions, so a link outside the repo that points into it is inside.
 */
export function insideRepo(root, target, { p = HOST_PATH, real = p === HOST_PATH ? realOrAncestor : () => null } = {}) {
  const strip = (s) => (p === win32 ? String(s).replace(/^[\\/]{2}\?[\\/]UNC[\\/]/i, '\\\\').replace(/^[\\/]{2}\?[\\/]/, '') : String(s));
  const norm = (s) => { const r = p.resolve(strip(s)); return p === win32 ? r.toLowerCase() : r; };
  const roots = new Set([norm(root)]);
  const targets = new Set([norm(target)]);
  for (const [set, s] of [[roots, root], [targets, target]]) { const r = real(p.resolve(strip(s))); if (r) set.add(norm(r)); }
  for (const r of roots) for (const t of targets) {
    const rel = p.relative(r, t);
    if (rel === '' || (rel !== '..' && !rel.startsWith(`..${p.sep}`) && !p.isAbsolute(rel))) return true;
  }
  return false;
}

/** The real path of `path`, or of its nearest existing ancestor with the rest re-joined; null if none resolves. */
function realOrAncestor(path) {
  let head = path;
  const tail = [];
  for (;;) {
    try { return join(realpathSync.native(head), ...tail); } catch { /* not there yet */ }
    const up = dirname(head);
    if (up === head) return null;
    tail.unshift(basename(head));
    head = up;
  }
}

export function run(opts, { env = process.env, spawn = spawnSync } = {}) {
  const root = resolve(opts.root ?? process.cwd());
  const v = validateAll(root);
  const finish = (code, verdict, detail, lines = []) => ({ code, out: [`restore-drill: ${verdict} — ${opts.set}: ${detail}`, ...lines] });
  if (v.errors.length) return finish(2, 'LOST', `the declarations do not validate: ${v.errors[0]}`);
  const set = (v.backups.sets ?? []).find((s) => s.id === opts.set);
  if (!set) return finish(2, 'LOST', `no set \`${opts.set}\` in tooling/boxes/backups.json (sets: ${(v.backups.sets ?? []).map((s) => s.id).join(', ')})`);
  const dest = (v.backups.destinations ?? []).find((d) => d.id === set.drill.from);
  const file = opts.file ?? set.drill.file;
  if (!file) return finish(2, 'LOST', `the drill names no file: name ONE small file of the set in backups.json (or pass --file)`);
  if (!set.drill.hash) return finish(2, 'LOST', 'the drill names no hash source (restic-tree | manifest | recorded): a restore with nothing to compare to proves only that bytes came back');
  if (dest.kind === 'box-dir') return finish(2, 'LOST', `drills from \`${dest.id}\`, a directory ON a box; the drill never reads live data on a box — drill from an off-box destination`);
  const unset = missingEnv(dest.env, env);
  if (unset.length) return finish(2, 'LOST', `the destination \`${dest.id}\` needs ${unset.join(', ')} in the environment (from the vault)`);

  // every value a printed line could carry is redacted to its NAME
  const secretVals = [];
  for (const n of (dest.env ?? []).flat()) if (env[n] && env[n].length >= 4) secretVals.push([env[n], `<${n}>`]);
  for (const m of JSON.stringify(dest).matchAll(/<([A-Z][A-Z0-9_]*)>/g)) if (env[m[1]] && env[m[1]].length >= 4) secretVals.push([env[m[1]], `<${m[1]}>`]);
  const redact = (s) => secretVals.reduce((acc, [val, name]) => acc.split(val).join(name), String(s ?? ''));
  const firstLine = (r) => redact(`${r.stderr ?? ''}${r.stdout ?? ''}`.trim().split('\n').find((l) => l.trim()) ?? `exit ${r.status}`).slice(0, 200);
  // A tool given as a .js/.cjs/.mjs file runs under THIS node: Windows cannot spawn a
  // shebang file, and the drill spawns without a shell (#1148 — the test's fake rclone).
  const call = (bin, args) => (/\.[cm]?js$/i.test(bin) ? spawn(process.execPath, [bin, ...args], { encoding: 'utf8', timeout: CALL_TIMEOUT_MS, env, stdio: ['ignore', 'pipe', 'pipe'] }) : spawn(bin, args, { encoding: 'utf8', timeout: CALL_TIMEOUT_MS, env, stdio: ['ignore', 'pipe', 'pipe'] }));
  const toolMissing = (r, bin) => r.error?.code === 'ENOENT' ? `${bin} is not installed here (--${bin.includes('restic') ? 'restic' : 'rclone'}-bin)` : r.error ? `${bin} did not run (${r.error.code ?? r.error.message})` : null;

  // the scratch directory: fresh, under --to, removed at the end whatever happened
  const scratchRoot = resolve(opts.to);
  if (insideRepo(root, scratchRoot)) return finish(2, 'LOST', '--to is inside the repository; restore into a scratch directory outside it');
  mkdirSync(scratchRoot, { recursive: true });
  const work = mkdtempSync(join(scratchRoot, `drill-${set.id}-`));
  const cleanup = (res) => {
    rmSync(work, { recursive: true, force: true });
    if (existsSync(work)) return finish(1, 'FAIL', `the scratch copy at ${work} could not be deleted`, res.out.slice(1));
    res.out.push(`        · the scratch copy was deleted (${basename(work)})`);
    return res;
  };
  const verify = (path, want, from) => {
    // One read, no exists/stat first (CodeQL js/file-system-race): absent or not a file is FAIL.
    let bytes;
    try { bytes = readFileSync(path); } catch { return finish(1, 'FAIL', `${from}: the restore reported success and ${file} is not there`); }
    const size = bytes.length;
    if (size === 0) return finish(1, 'FAIL', `${from}: ${file} came back EMPTY`);
    const got = createHash('sha256').update(bytes).digest('hex');
    if (got !== want) return finish(1, 'FAIL', `${from}: ${file} came back ${size} B with SHA-256 ${got.slice(0, 12)}…, the source recorded ${String(want).slice(0, 12)}…`);
    return finish(0, 'PASS', `${from}: ${file} came back ${size} B and its SHA-256 matches the source's (${got.slice(0, 12)}…)`);
  };

  try {
    if (dest.kind === 'restic') {
      const repo = fill(dest.repo, env);
      if (repo.missing) return cleanup(finish(2, 'LOST', `the repository needs ${repo.missing.join(', ')} in the environment`));
      // --no-cache: measured 2026-10-01 with restic 0.18.1 — with the local cache, a repository whose tree
      // pack was corrupted still restored the file from the CACHED tree and the drill passed. A drill
      // answered by a cache is not a drill of the repository.
      const base = ['--no-lock', '--no-cache', '-r', repo.value];
      const ls = call(opts.resticBin, [...base, 'snapshots', '--json', ...(set.drill.tag ? ['--tag', set.drill.tag] : [])]);
      const tm = toolMissing(ls, opts.resticBin);
      if (tm) return cleanup(finish(2, 'LOST', tm));
      if (ls.status !== 0) return cleanup(finish(2, 'LOST', `the repository could not be listed (unreachable or the credential is wrong): ${firstLine(ls)}`));
      let snaps;
      try { snaps = JSON.parse(ls.stdout); } catch { return cleanup(finish(2, 'LOST', 'restic snapshots did not answer JSON')); }
      if (!Array.isArray(snaps) || !snaps.length) return cleanup(finish(1, 'FAIL', `${dest.id} holds no snapshot${set.drill.tag ? ` tagged ${set.drill.tag}` : ''}`));
      const newest = snaps.reduce((a, b) => (Date.parse(b.time) > Date.parse(a.time) ? b : a));
      const from = `${dest.id} snapshot ${String(newest.id).slice(0, 8)} of ${newest.time}`;
      if (set.drill.hash !== 'restic-tree' && set.drill.hash !== 'recorded') return cleanup(finish(2, 'LOST', `hash source \`${set.drill.hash}\` does not apply to a restic repository`));
      let want = set.drill.sha256;
      if (set.drill.hash === 'restic-tree') {
        const tree = call(opts.resticBin, [...base, 'cat', 'tree', `${newest.id}:${posix.dirname(file)}`]);
        if (tree.status !== 0) return cleanup(finish(1, 'FAIL', `${from}: the tree holding ${file} could not be read: ${firstLine(tree)}`));
        let node;
        try { node = (JSON.parse(tree.stdout).nodes ?? []).find((n) => n.name === posix.basename(file)); } catch { return cleanup(finish(1, 'FAIL', `${from}: the tree holding ${file} is not JSON`)); }
        if (!node) return cleanup(finish(1, 'FAIL', `${from}: ${file} is not in the newest snapshot`));
        if (node.type !== 'file') return cleanup(finish(2, 'LOST', `${from}: ${file} is a ${node.type}, not a file`));
        if (!(node.content ?? []).length) return cleanup(finish(1, 'FAIL', `${from}: ${file} was backed up EMPTY`));
        if (node.content.length > 1) return cleanup(finish(2, 'LOST', `${from}: ${file} is ${node.content.length} chunks; restic's record is one hash per chunk, so pick a file under 512 KiB`));
        want = node.content[0];
      } else if (!/^[0-9a-f]{64}$/.test(want ?? '')) return cleanup(finish(2, 'LOST', 'hash `recorded` needs drill.sha256 (64 hex) in backups.json'));
      const rs = call(opts.resticBin, [...base, 'restore', newest.id, '--target', work, '--include', file]);
      if (rs.status !== 0) return cleanup(finish(1, 'FAIL', `${from}: the restore failed — ${firstLine(rs)}`));
      return cleanup(verify(join(work, file), want, from));
    }

    if (dest.kind === 'rclone-manifest' || dest.kind === 'rclone-dated') {
      if (!dest.base) return cleanup(finish(2, 'LOST', `the destination \`${dest.id}\` declares no remote base (remote name and layout UNREAD)`));
      const b = fill(dest.base, env);
      if (b.missing) return cleanup(finish(2, 'LOST', `the remote needs ${b.missing.join(', ')} in the environment`));
      let dir = b.value;
      let date = null;
      if (dest.kind === 'rclone-dated') {
        const lsf = call(opts.rcloneBin, ['lsf', dir, '--dirs-only']);
        const tm = toolMissing(lsf, opts.rcloneBin);
        if (tm) return cleanup(finish(2, 'LOST', tm));
        if (lsf.status !== 0) return cleanup(finish(2, 'LOST', `the remote could not be listed: ${firstLine(lsf)}`));
        const dates = lsf.stdout.split('\n').map((l) => DATED_DIR.exec(l.trim())?.[1]).filter(Boolean).sort();
        if (!dates.length) return cleanup(finish(1, 'FAIL', `${dest.id} holds no dated directory (listed ${lsf.stdout.split('\n').filter(Boolean).length} entr(ies), none a date)`));
        date = dates[dates.length - 1];
        dir = `${dir}/${date}`;
      }
      let want = set.drill.sha256;
      let key = file;
      if (set.drill.hash === 'manifest') {
        const mpath = String(set.drill.manifest ?? '').replace('{date}', date ?? '');
        const cat = call(opts.rcloneBin, ['cat', `${dir}/${mpath}`]);
        const tm = toolMissing(cat, opts.rcloneBin);
        if (tm) return cleanup(finish(2, 'LOST', tm));
        if (cat.status !== 0) return cleanup(finish(2, 'LOST', `the manifest ${mpath} could not be read: ${firstLine(cat)}`));
        let m;
        try { m = JSON.parse(cat.stdout); } catch { return cleanup(finish(1, 'FAIL', `the manifest ${mpath} is not JSON`)); }
        if (m.complete !== true) return cleanup(finish(1, 'FAIL', `the newest manifest (${m.date ?? 'undated'}) is not \`complete\``));
        date = date ?? m.date;
        key = file.replace('{date}', date ?? '');
        const entry = (m.objects ?? []).find((o) => o.key === key);
        if (!entry) return cleanup(finish(1, 'FAIL', `the newest manifest (${m.date}) does not list ${key}`));
        want = entry.sha256;
      } else if (set.drill.hash !== 'recorded' || !/^[0-9a-f]{64}$/.test(want ?? '')) {
        return cleanup(finish(2, 'LOST', `hash source \`${set.drill.hash}\` needs drill.sha256 (64 hex) or a manifest for an rclone destination`));
      } else key = file.replace('{date}', date ?? '');
      const local = join(work, basename(key));
      const cp = call(opts.rcloneBin, ['copyto', `${dir}/${key}`, local]);
      const tm = toolMissing(cp, opts.rcloneBin);
      if (tm) return cleanup(finish(2, 'LOST', tm));
      if (cp.status !== 0) return cleanup(finish(1, 'FAIL', `${dest.id} ${date ?? ''}: the copy of ${key} failed — ${firstLine(cp)}`));
      const res = verify(local, want, `${dest.id} ${date ?? ''}`.trim());
      if (res.code === 0 || res.code === 1) res.out[0] = res.out[0].replace(file, key);
      return cleanup(res);
    }
    return cleanup(finish(2, 'LOST', `destination kind \`${dest.kind}\` has no drill`));
  } catch (e) {
    return cleanup(finish(2, 'LOST', `the drill could not run (${redact(e.message)})`));
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) {
    console.error(`restore-drill: REFUSED — ${opts.error}`);
    console.error('usage: node tooling/ops/restore-drill.mjs <set> --to <scratch dir> [--file <path>] [--restic-bin <path>] [--rclone-bin <path>] [--root <dir>]');
    process.exit(2);
  }
  const { code, out } = run(opts);
  for (const l of out) (code ? console.error : console.log)(l);
  process.exit(code);
}

const IS_MAIN = (() => {
  try { return resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url); } catch { return false; }
})();
if (IS_MAIN) main();
