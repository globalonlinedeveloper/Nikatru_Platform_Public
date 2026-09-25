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
//
// ── POST-CONDITIONS: WHERE post_gen WARNS, THIS FILE EXITS NON-ZERO ──────────
// post_gen.dart runs the site chain and tag-owner --write, and on a failure it
// WARNS and returns (a throw there leaves a half-stamped app). A warning in a
// long mason log is easy to miss, so after mason exits 0 this file requires:
//   1. apps/<id>/pubspec.yaml exists — a stamp that wrote no app is not a stamp;
//   2. `node tooling/sites/regen.mjs --check` exits 0;
//   3. `node tooling/ci/tag-owner.mjs --check` exits 0.
// Any one failing makes the exit 1, and the line names it.
//
// Exit 0 = stamped, and all three post-conditions hold (or --dry-run printed the plan).
// Exit 1 = refused before mason, a mason step failed, or a post-condition failed.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
  const steps = [
    mason('mason get', ['get']),
    mason('mason make', ['make', 'app', '-c', vars, '-o', '.', '--on-conflict', 'overwrite']),
  ];
  if (problems.length) return nothing(id, vars, overwrite);

  const post = [
    { label: `apps/${id}/pubspec.yaml exists`, kind: 'exists', path: join(root, 'apps', id, 'pubspec.yaml') },
    { label: `node ${REGEN} --check`, kind: 'spawn', command: process.execPath, args: [join(root, ...REGEN.split('/')), '--check'], cwd: root },
    { label: `node ${TAG_OWNER} --check`, kind: 'spawn', command: process.execPath, args: [join(root, ...TAG_OWNER.split('/')), '--check'], cwd: root },
  ];
  return { problems, id, vars, overwrite, steps, post };
}

/** The real runner: output streams to the terminal, the exit code comes back. */
function spawnStep(command, args, { cwd, env }) {
  const r = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: false });
  return r.status === null ? -1 : r.status;
}

/**
 * Run a plan. `run` and `exists` are injectable so the suite drives every
 * branch without spawning mason. Returns the process exit code.
 */
export function runStamp(plan, { run = spawnStep, exists = existsSync, log = console.log, error = console.error } = {}) {
  if (plan.problems.length) {
    for (const p of plan.problems) error(`✗ ${p}`);
    return 1;
  }
  for (const step of plan.steps) {
    log(`▶ ${step.label}: ${step.command} ${step.args.join(' ')}`);
    const code = run(step.command, step.args, { cwd: step.cwd, env: step.env });
    if (code !== 0) {
      error(`✗ ${step.label} exited ${code}; the post-conditions were not checked.`);
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
  log(`ok  stamp-app: "${plan.id}" stamped; the site chain and the release tag filter both check clean.`);
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
