// ─────────────────────────────────────────────────────────────────────────────
// adapter-set.mjs — THE ONE ANSWER TO "which packages are adapters, and which
// vendors does each one wrap".
//
// Two guards range over that set and used to derive it separately:
// assert-package-boundaries.mjs (C-5 limb c: an app never goes around an
// adapter) and assert-adapter-capabilities.mjs (C-7: every adapter declares
// where it works). The second one's header said it used "the same derivation"
// as the first, and it was a copy: its own LINT_ONLY, its own pubspec walk,
// and a different rule for SDK dependencies (any `sdk:` in one, only
// `sdk: flutter` in the other). Nothing held the two equal. Judged false as
// written on 2026-09-19 (tooling/mechanism-claims.json, O-UNGRADED-MECHANISM-
// CLAIMS); both now import this module, so the sentence is true by import.
//
// THE RULE. An adapter is a package directly under packages/ that is not
// `core` and not `design_system`, and whose `dependencies:` block declares at
// least one THIRD-PARTY package. Third-party means: not an SDK dependency
// (`sdk:` of any value), not a path dependency (`path:`), not one of ours
// (`nikatru_*`), and not a lint ruleset (`*lints`, which is config, not a
// wrapped SDK). Every third-party dependency of an adapter is a vendor it wraps.
//
// It is not a guard: a repository root in, a derived set out, no exit and no
// verdict. "Did the derivation reach the tree" is each importer's question, and
// each carries its own COVERAGE LOST floor over what this returns. Its cases
// are in test/adapter-set.test.mjs, which also runs BOTH guards over one tree
// and requires them to print the same adapter set. It sits flat in tooling/ci
// because the stray-.mjs check in assert-guard-coverage.mjs treats a
// subdirectory as a guard escaping the scan.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listDir } from './tree-walk.mjs';

/** A lint ruleset is config, not a wrapped SDK. */
export const LINT_ONLY = /(?:^|_)lints$/;

/** Packages under packages/ that are never adapters, whatever they declare. */
export const NOT_ADAPTERS = Object.freeze(['core', 'design_system']);

/**
 * The declared dependencies of one package, read from its pubspec.yaml.
 *
 * Line-based on purpose: tooling/ has no YAML dependency, and the shape needed
 * (a top-level block of two-space-indented `name:` keys) is unambiguous.
 * Comments are stripped BEFORE matching: a commented-out dependency is not a
 * dependency.
 *
 * @returns {Map<string, 'sdk'|'path'|'hosted'|'pending'> | null} name → kind,
 *   or null when the pubspec does not exist. `pending` is a key with an empty
 *   value whose sub-keys named neither `sdk:` nor `path:` (a `git:` or
 *   `hosted:` source), which is third-party.
 */
export function pubspecDeps(root, pkgDir, block = 'dependencies') {
  const p = join(root, pkgDir, 'pubspec.yaml');
  if (!existsSync(p)) return null;
  const out = new Map();
  let inBlock = false;
  let current = null;
  for (const raw of readFileSync(p, 'utf8').split('\n')) {
    const line = raw.replace(/#.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (/^[a-z_]+:/i.test(line)) {
      inBlock = line.startsWith(`${block}:`);
      current = null;
      continue;
    }
    if (!inBlock) continue;
    const m = line.match(/^  ([a-z0-9_]+)\s*:(.*)$/i);
    if (m) {
      current = m[1];
      out.set(current, m[2].trim() ? 'hosted' : 'pending');
      continue;
    }
    if (current && /^\s+sdk:/.test(line)) out.set(current, 'sdk');
    else if (current && /^\s+path:/.test(line)) out.set(current, 'path');
  }
  return out;
}

/** True when a declared dependency is a vendor an adapter would wrap. */
export function isThirdParty(name, kind) {
  if (kind === 'sdk' || kind === 'path') return false;
  if (name.startsWith('nikatru_')) return false;
  return !LINT_ONLY.test(name);
}

/**
 * Every adapter under `<root>/packages`, in directory order.
 * @returns {{ name: string, dir: string, vendors: string[] }[]}
 *   `dir` is repo-relative with forward slashes (`packages/<name>`).
 */
export function deriveAdapters(root) {
  const pkgRoot = join(root, 'packages');
  if (!existsSync(pkgRoot)) return [];
  const adapters = [];
  for (const name of listDir(pkgRoot)) {
    if (NOT_ADAPTERS.includes(name)) continue;
    const deps = pubspecDeps(root, `packages/${name}`);
    if (!deps) continue;
    const vendors = [...deps].filter(([dep, kind]) => isThirdParty(dep, kind)).map(([dep]) => dep);
    if (vendors.length > 0) adapters.push({ name, dir: `packages/${name}`, vendors });
  }
  return adapters;
}
