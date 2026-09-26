#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// app-set.mjs — the ONE reader of the workspace app set.
//
// The app set is the `apps/<id>` members of the root pubspec `workspace:` list.
// That list already exists, is already maintained by the stamper, and is
// already policed by assert-workspace-coverage.mjs, so it is the source; never
// a list typed into a guard.
//
// WHY A MODULE AND NOT A FUNCTION INSIDE ONE GUARD. `workspaceApps()` lived
// privately in assert-release-lane-generic.mjs (moved here verbatim, together
// with the nested-path refusal `--emit-apps` applied). Every other guard that
// needed "which apps exist" either typed app #1's paths or listed `apps/` as a
// directory, and both shapes grade app #1 alone: a second app is read by
// nothing and every guard stays green. A guard that imports this module grades
// every app the workspace declares, and an empty set is COVERAGE LOST (exit 2),
// never a pass over nothing.
//
// assert-release-lane-generic.mjs limb A refuses a second guard-side reader of
// `workspace:` under tooling/ci/ (the readers that predate this module are
// named there and graded stale).
//
// Usage:  node tooling/ci/app-set.mjs [--json] [repoRoot]
//   prints the app ids, one per line (or a JSON array with --json).
// Exit 0 = the set is non-empty and every entry is `apps/<id>`.
// Exit 2 = COVERAGE LOST: no pubspec, no `workspace:` block, no `apps/` member,
//          or a member nested below `apps/<id>`.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Every root pubspec `workspace:` entry, packages and apps, in order; null when
 *  the pubspec or its `workspace:` block is missing. The one parse of that block:
 *  a guard that needs the whole member list (assert-version-consistency's floor
 *  targets) reads it here too. */
export function workspaceMembers(root) {
  const p = join(root, 'pubspec.yaml');
  if (!existsSync(p)) return null;
  const lines = readFileSync(p, 'utf8')
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, '$1'));
  const at = lines.findIndex((l) => /^workspace:\s*$/.test(l));
  if (at === -1) return null;
  const out = [];
  for (let i = at + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const m = lines[i].match(/^\s+-\s+(['"]?)([^'"\s]+)\1\s*$/);
    if (!m) break;
    out.push(m[2].replace(/\/+$/, ''));
  }
  return out;
}

/** The workspace app set. Derived, never listed here. */
export function workspaceApps(root) {
  const members = workspaceMembers(root);
  return members === null ? null : members.filter((e) => e.startsWith('apps/'));
}

/** Ids that nest below `apps/<id>`. The lanes address an app as
 *  `apps/${{ matrix.app }}` and every guard builds `apps/<id>/lib`, and a nested
 *  path round-trips through neither. */
export function nestedIds(dirs) {
  return dirs.map((a) => a.slice('apps/'.length)).filter((id) => id.includes('/'));
}

/** `[{ id, dir }]`, or null when the root pubspec or its `workspace:` block is
 *  missing. An empty array is a workspace with no `apps/` member. */
export function appSet(root) {
  const found = workspaceApps(root);
  if (found === null) return null;
  return found.map((dir) => ({ id: dir.slice('apps/'.length), dir }));
}

/** The `--emit-apps` mode of assert-release-lane-generic.mjs: the set as a JSON
 *  array of ids, the matrix four workflows iterate. Returns the exit code.
 *  Its output and its refusals are byte-identical to the block it was moved
 *  from; the four lanes read them.
 *  ⏱ 2026-09-25 — `only` (O-TAG-BUILDS-EVERY-APP): the id a release tag names.
 *  The whole set is judged first, then narrowed to `[only]`; an id the set does
 *  not hold is refused, naming the set. The caller reads the id off the tag. */
export function emitApps(root, { only = null } = {}) {
  const found = workspaceApps(root);
  if (found === null || found.length === 0) {
    console.error(`FAIL --emit-apps: ${join(root, 'pubspec.yaml')} declares no \`workspace:\` entry under apps/.`);
    console.error('     A release lane whose matrix is [] runs no build and reports green. Refusing to emit one.');
    return 1;
  }
  const ids = found.map((a) => a.slice('apps/'.length));
  const nested = ids.filter((id) => id.includes('/'));
  if (nested.length) {
    console.error(`FAIL --emit-apps: workspace entr${nested.length === 1 ? 'y' : 'ies'} ${nested.join(', ')} nest below apps/<id>.`);
    console.error('     The lanes address an app as `apps/${{ matrix.app }}`, which a nested path cannot round-trip.');
    return 1;
  }
  if (only !== null) {
    if (!ids.includes(only)) {
      console.error(`FAIL --emit-apps --tag: the tag names app "${only}", and the workspace declares ${ids.join(', ')}.`);
      console.error('     A tag builds and stages only its own app, and this workspace holds no app of that id.');
      return 1;
    }
    console.log(JSON.stringify([only]));
    return 0;
  }
  console.log(JSON.stringify(ids));
  return 0;
}

/** The set, or COVERAGE LOST (exit 2) naming the guard and the pubspec.
 *  A guard that grades "every app" over an empty set grades nothing and prints
 *  ok, which is the shape this module exists to remove. */
export function requireAppSet(root, guardName) {
  const pubspec = join(root, 'pubspec.yaml');
  const set = appSet(root);
  const refuse = (why) => {
    console.error('');
    console.error(`FAIL COVERAGE LOST — ${guardName}: ${pubspec} ${why}`);
    console.error('     Every per-app limb ranges over the workspace app set (tooling/ci/app-set.mjs); an empty or');
    console.error('     unreadable set makes each of them pass over nothing.');
    console.error(`\n${guardName}: FAILED`);
    process.exit(2);
  };
  if (set === null) refuse('has no readable `workspace:` block.');
  if (set.length === 0) refuse('declares no `workspace:` entry under apps/.');
  const nested = nestedIds(set.map((a) => a.dir));
  if (nested.length) refuse(`declares ${nested.join(', ')}, nested below apps/<id>; no per-app path can address it.`);
  return set;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const rootArg = args.find((a) => a !== '--json');
  const root = resolve(rootArg ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const set = requireAppSet(root, 'app-set');
  const ids = set.map((a) => a.id);
  console.log(json ? JSON.stringify(ids) : ids.join('\n'));
}
