#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// stamp-app.mjs — ONE command stamps an app, and fails loudly when the stamp
// left the site surface or the release tag filter behind.
//
// Row O-NEW-APP-IS-NOT-ONE-COMMAND.
//
// Usage:  node tooling/kit/stamp-app.mjs --vars <file.json> [--overwrite] [--dry-run]
//         Run from anywhere; mason runs from the repo root (mason.yaml is
//         root-oriented: `-o .`).
//
// ── WHAT THE ONE-LINE RECIPE LEFT TO MEMORY, AND THIS FILE DOES ──────────────
//   · `mason get` FIRST. `.mason/` and `mason-lock.json` are gitignored, so a
//     fresh checkout has no brick registry and `mason make` exits 64 having
//     stamped nothing.
//   · On Windows `mason` is `mason.bat`, which bash does not find and which
//     Node will not spawn without a shell (EINVAL since the 2024
//     argument-injection fix). So cmd.exe is the executable, with
//     `/d /s /c mason.bat …`, and EVERY argument is refused unless it matches
//     SAFE_ARG first. Never `shell: true` over an unchecked string.
//   · NIKATRU_ALLOW_OVERWRITE=1 is set ONLY by --overwrite, and stripped from
//     the child's environment otherwise, so a value left exported in the
//     caller's shell cannot turn a new stamp into a silent overwrite.
//   · The app id is refused BEFORE mason, with the contract's own message
//     (contracts/app-id/app-id.js appIdProblems); pre_gen refuses it too.
//   · THE APP'S LICENCE ROWS (LEAD RULING NP12B-R2, 2026-09-27). Every file a
//     pub package ships into the new app's web bundle needs an `app:<id>` row
//     in tooling/legal/asset-register.json, and until this step nothing wrote
//     one: the first web build of the stamp went red, and a row typed by hand
//     for an app that exists only in CI was refused (train W47, #1020). So after
//     mason, `flutter pub get` AT THE REPO ROOT resolves the workspace with the
//     new app on it (never in the app directory: that rewrites the root lock
//     from a subdirectory), and `gen-app-licence-rows.mjs --write --app <id>`
//     writes the rows from that resolution. On Windows flutter is `flutter.bat`,
//     reached through cmd.exe exactly as mason is.
//   · THAT PUB GET LEAVES THE TRACKED TREE AS IT FOUND IT (lead ruling on
//     NP12B-R2's draft, 2026-09-28; TRAPS.md "Dart / Flutter — worktrees and
//     stray writes"). A root `flutter pub get` "upgrades" every workspace
//     project's analysis_options.yaml to exclude build and platform
//     directories — measured: 10 tracked files rewritten by one stamp. Flutter
//     has no flag that turns the migration off, and a read-only file fails the
//     resolution instead of skipping it, so the step cannot be run so that it
//     cannot write. It RESTORES: every analysis_options.yaml git sees (tracked,
//     or new and not ignored, as the one mason just stamped) is read into memory
//     BEFORE pub get and written back byte for byte after it. Bytes in memory,
//     never `git checkout`: a person's own uncommitted edit to one of those files
//     is put back as they left it, not as HEAD has it. Then the tracked tree is
//     ASSERTED: every tracked file pub get left different from how it found it,
//     other than the root pubspec.lock (the new app's dependencies resolve into
//     it), fails the stamp, named. So a future Flutter that writes some other
//     file is a red stamp, not a quiet diff in someone's next commit.
//
// ── POST-CONDITIONS: WHERE post_gen WARNS, THIS FILE EXITS NON-ZERO ──────────
// post_gen.dart runs the site chain and tag-owner --write, and on a failure it
// WARNS and returns (a throw there leaves a half-stamped app). A warning in a
// long mason log is easy to miss, so after mason exits 0 this file requires:
//   1. apps/<id>/pubspec.yaml exists — a stamp that wrote no app is not a stamp;
//   2. `node tooling/sites/regen.mjs --check` exits 0;
//   3. `node tooling/ci/tag-owner.mjs --check` exits 0;
//   4. `node tooling/ci/gen-app-licence-rows.mjs --check --app <id>` exits 0;
//   5. `node tooling/kit/snap-update-row.mjs --check --app <id>` exits 0 — the
//      app is served its snapcraft.io page on the armed `linux-snap` channel,
//      which the step of the same name writes after the licence rows ([10]D-8).
// Any one failing makes the exit 1, and the line names it.
//
// Exit 0 = stamped, and all five post-conditions hold (or --dry-run printed the plan).
// Exit 1 = refused before mason, a mason step failed, the root pub get left a
//          tracked file changed, or a post-condition failed.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appIdProblems } from '../../contracts/app-id/app-id.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..');

/** Every argument handed to cmd.exe matches this, or nothing is spawned. It
 *  admits no space and none of cmd's metacharacters: & | < > ^ % ! " ( ) ; , */
export const SAFE_ARG = /^[A-Za-z0-9._/\\:=-]+$/;

export const REGEN = 'tooling/sites/regen.mjs';
export const TAG_OWNER = 'tooling/ci/tag-owner.mjs';
export const APP_LICENCE_ROWS = 'tooling/ci/gen-app-licence-rows.mjs';
export const SNAP_UPDATE_ROW = 'tooling/kit/snap-update-row.mjs';
const OVERWRITE_ENV = 'NIKATRU_ALLOW_OVERWRITE';

/**
 * The whole stamp as data, without spawning anything. The CLI runs it; the
 * suite reads it.
 *
 * @returns {{problems: string[], id: string|null, vars: string|null, overwrite: boolean,
 *            steps: {label: string, command: string, args: string[], cwd: string, env: Record<string,string>}[],
 *            post: ({label: string, kind: 'exists', path: string} |
 *                   {label: string, kind: 'spawn', command: string, args: string[], cwd: string})[]}}
 */
export function planStamp({ argv = [], platform = process.platform, env = process.env, root = REPO } = {}) {
  const problems = [];
  const nothing = (id = null, vars = null, overwrite = false) => ({ problems, id, vars, overwrite, steps: [], post: [] });

  const known = new Set(['--vars', '--overwrite', '--dry-run']);
  for (const a of argv) {
    if (a.startsWith('--') && !known.has(a)) problems.push(`unknown flag ${a}. Known: ${[...known].join(', ')}.`);
  }
  const at = argv.indexOf('--vars');
  const vars = at === -1 ? null : argv[at + 1] ?? null;
  const overwrite = argv.includes('--overwrite');
  if (vars === null || vars.startsWith('--')) {
    problems.push('--vars <file.json> is required: the mason vars file the app is stamped from.');
    return nothing(null, null, overwrite);
  }
  if (!SAFE_ARG.test(vars) || !vars.endsWith('.json')) {
    problems.push(
      `--vars ${JSON.stringify(vars)} is refused: it must be a .json path matching ${SAFE_ARG}. ` +
        'On Windows it is handed to cmd.exe, where a space or any of & | < > ^ % ! " ( ) ; , changes the command.',
    );
    return nothing(null, vars, overwrite);
  }
  if (problems.length) return nothing(null, vars, overwrite);

  let spec;
  try {
    spec = JSON.parse(readFileSync(resolve(root, vars), 'utf8'));
  } catch (e) {
    problems.push(`--vars ${vars} could not be read as JSON (${e.code ?? e.message}); nothing was stamped.`);
    return nothing(null, vars, overwrite);
  }
  const id = spec && typeof spec === 'object' ? spec.app_id : undefined;
  if (typeof id !== 'string') {
    problems.push(`--vars ${vars} carries no string "app_id"; nothing was stamped.`);
    return nothing(null, vars, overwrite);
  }
  const idProblems = appIdProblems(id);
  if (idProblems.length) {
    problems.push(...idProblems.map((p) => `${p} Refused before mason; nothing was stamped.`));
    return nothing(id, vars, overwrite);
  }

  const childEnv = { ...env };
  delete childEnv[OVERWRITE_ENV];
  if (overwrite) childEnv[OVERWRITE_ENV] = '1';

  const mason = (label, args) => {
    const bad = args.filter((a) => !SAFE_ARG.test(a));
    if (bad.length) problems.push(`${label}: argument(s) ${bad.map((a) => JSON.stringify(a)).join(', ')} refused (${SAFE_ARG}).`);
    return platform === 'win32'
      ? { label, command: 'cmd.exe', args: ['/d', '/s', '/c', 'mason.bat', ...args], cwd: root, env: childEnv }
      : { label, command: 'mason', args, cwd: root, env: childEnv };
  };
  const flutter = (label, args) =>
    platform === 'win32'
      ? { label, command: 'cmd.exe', args: ['/d', '/s', '/c', 'flutter.bat', ...args], cwd: root, env: childEnv }
      : { label, command: 'flutter', args, cwd: root, env: childEnv };
  const licenceRows = join(root, ...APP_LICENCE_ROWS.split('/'));
  const snapRow = join(root, ...SNAP_UPDATE_ROW.split('/'));
  const steps = [
    mason('mason get', ['get']),
    mason('mason make', ['make', 'app', '-c', vars, '-o', '.', '--on-conflict', 'overwrite']),
    { ...flutter('flutter pub get (repo root)', ['pub', 'get']), keepsTrackedTree: true },
    { label: `node ${APP_LICENCE_ROWS} --write --app ${id}`, command: process.execPath, args: [licenceRows, '--write', '--app', id], cwd: root, env: childEnv },
    { label: `node ${SNAP_UPDATE_ROW} --write --app ${id}`, command: process.execPath, args: [snapRow, '--write', '--app', id], cwd: root, env: childEnv },
  ];
  if (problems.length) return nothing(id, vars, overwrite);

  const post = [
    { label: `apps/${id}/pubspec.yaml exists`, kind: 'exists', path: join(root, 'apps', id, 'pubspec.yaml') },
    { label: `node ${REGEN} --check`, kind: 'spawn', command: process.execPath, args: [join(root, ...REGEN.split('/')), '--check'], cwd: root },
    { label: `node ${TAG_OWNER} --check`, kind: 'spawn', command: process.execPath, args: [join(root, ...TAG_OWNER.split('/')), '--check'], cwd: root },
    { label: `node ${APP_LICENCE_ROWS} --check --app ${id}`, kind: 'spawn', command: process.execPath, args: [licenceRows, '--check', '--app', id], cwd: root },
    { label: `node ${SNAP_UPDATE_ROW} --check --app ${id}`, kind: 'spawn', command: process.execPath, args: [snapRow, '--check', '--app', id], cwd: root },
  ];
  return { problems, id, vars, overwrite, steps, post };
}

/** The one tracked file the root pub get may change: the new app's dependencies resolve into it. */
export const PUB_GET_OWNS = new Set(['pubspec.lock']);

/** `git <args>` in `root`, NUL-separated output as a list. Throws naming the command. */
function gitPaths(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} exited ${r.status ?? r.error?.code} in ${root}: ${String(r.stderr ?? '').trim()}`);
  }
  return r.stdout.split('\0').filter(Boolean);
}

const bytesOf = (abs) => (existsSync(abs) ? readFileSync(abs) : null);
const hashOf = (abs) => {
  const b = bytesOf(abs);
  return b === null ? 'absent' : createHash('sha256').update(b).digest('hex');
};

/** Every tracked file whose working copy differs from the index, with a hash of its bytes. */
function dirtyTracked(root) {
  const out = new Map();
  for (const rel of gitPaths(root, ['diff', '--name-only', '-z', '--no-renames', '--no-ext-diff', '--no-textconv'])) {
    out.set(rel, hashOf(join(root, ...rel.split('/'))));
  }
  return out;
}

/**
 * The real tree keeper around the root pub get. `snapshot` runs before it:
 * the bytes of every analysis_options.yaml git sees, and the tracked tree's
 * dirty set. `settle` runs after it: those bytes written back where pub get
 * changed them, then every tracked file left different from the snapshot,
 * other than PUB_GET_OWNS, returned as `stray`.
 */
export const gitTree = {
  snapshot(root) {
    const keep = new Map();
    const seen = gitPaths(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ':(glob)**/analysis_options.yaml']);
    for (const rel of seen) {
      const bytes = bytesOf(join(root, ...rel.split('/')));
      if (bytes !== null) keep.set(rel, bytes);
    }
    return { root, keep, dirty: dirtyTracked(root) };
  },
  settle({ root, keep, dirty }) {
    const restored = [];
    for (const [rel, bytes] of keep) {
      const abs = join(root, ...rel.split('/'));
      const now = bytesOf(abs);
      if (now !== null && now.equals(bytes)) continue;
      writeFileSync(abs, bytes);
      restored.push(rel);
    }
    const after = dirtyTracked(root);
    const stray = new Set();
    for (const [rel, h] of after) if (!PUB_GET_OWNS.has(rel) && dirty.get(rel) !== h) stray.add(rel);
    for (const rel of dirty.keys()) if (!PUB_GET_OWNS.has(rel) && !after.has(rel)) stray.add(rel);
    return { restored, stray: [...stray].sort() };
  },
};

/** The real runner: output streams to the terminal, the exit code comes back. */
function spawnStep(command, args, { cwd, env }) {
  const r = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: false });
  return r.status === null ? -1 : r.status;
}

/**
 * Run a plan. `run` and `exists` are injectable so the suite drives every
 * branch without spawning mason. Returns the process exit code.
 */
export function runStamp(plan, { run = spawnStep, exists = existsSync, tree = gitTree, log = console.log, error = console.error } = {}) {
  if (plan.problems.length) {
    for (const p of plan.problems) error(`✗ ${p}`);
    return 1;
  }
  for (const step of plan.steps) {
    let snap = null;
    if (step.keepsTrackedTree) {
      try {
        snap = tree.snapshot(step.cwd);
      } catch (e) {
        error(`✗ ${step.label}: the tracked tree could not be read before it (${e.message}); it was not run.`);
        return 1;
      }
    }
    log(`▶ ${step.label}: ${step.command} ${step.args.join(' ')}`);
    const code = run(step.command, step.args, { cwd: step.cwd, env: step.env });
    let settled = null;
    if (snap) {
      try {
        settled = tree.settle(snap);
      } catch (e) {
        error(`✗ ${step.label}: the tracked tree could not be checked after it (${e.message}).`);
        return 1;
      }
      if (settled.restored.length) {
        log(`ok  ${step.label}: put back ${settled.restored.length} analysis_options.yaml it rewrote: ${settled.restored.join(', ')}`);
      }
    }
    if (code !== 0) {
      error(`✗ ${step.label} exited ${code}; the post-conditions were not checked.`);
      return 1;
    }
    if (settled?.stray.length) {
      error(
        `✗ ${step.label} left ${settled.stray.length} tracked file(s) changed: ${settled.stray.join(', ')}. ` +
          `Only ${[...PUB_GET_OWNS].join(', ')} is its to write; revert the rest before any commit. The post-conditions were not checked.`,
      );
      return 1;
    }
  }
  const failed = [];
  for (const p of plan.post) {
    const ok = p.kind === 'exists' ? exists(p.path) : run(p.command, p.args, { cwd: p.cwd, env: process.env }) === 0;
    log(`${ok ? 'ok ' : '✗  '} post-condition: ${p.label}`);
    if (!ok) failed.push(p.label);
  }
  if (failed.length) {
    error(
      `✗ stamp-app: "${plan.id}" was stamped, and ${failed.length} post-condition(s) failed: ${failed.join('; ')}. ` +
        'post_gen only warned; read its "site chain:" lines in the mason output above, re-run the named command, and commit what it writes.',
    );
    return 1;
  }
  log(`ok  stamp-app: "${plan.id}" stamped; the site chain, the release tag filter, its licence rows and its snap update row all check clean.`);
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  const plan = planStamp({ argv });
  if (argv.includes('--dry-run') && !plan.problems.length) {
    for (const s of plan.steps) console.log(`step  ${s.label}: ${s.command} ${s.args.join(' ')}${plan.overwrite ? `  (${OVERWRITE_ENV}=1)` : ''}`);
    for (const p of plan.post) console.log(`post  ${p.label}`);
    process.exitCode = 0;
  } else {
    process.exitCode = runStamp(plan);
  }
}
