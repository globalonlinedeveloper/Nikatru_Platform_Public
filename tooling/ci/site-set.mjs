#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// site-set.mjs — the ONE reader of the site set: every `sites/<dir>` that ships
// an `index.html`, `sites/_shared` excluded.
//
// Row O-SITE-SET-HAND-LISTED (rv2-newproduct-017). ci.yml typed the site
// directories into the run lines of its two site guards
// (assert-web-cache-policy.mjs and check-site-integrity.mjs), so a third site
// directory was graded by neither until somebody remembered to type it there
// too. Both run lines now take this reader's `--emit`, so a site directory
// added under sites/ is claimed on the next run with no edit to any workflow,
// the same device worker-set.mjs is for services/.
//
// A site is a DIRECTORY that ships an `index.html`: that is the predicate both
// guards and assert-lane-coverage.mjs already use for a deploy root. Whether a
// site is DEPLOYED is a different question with a different source
// (deploy-web.yml); this reader only says which directories are sites.
//
// Two refusals, because a list read from a quiet reader is a guard that grades
// nothing and reports green:
//   · a directory under sites/ that is neither `_shared` nor ships an
//     `index.html` is a FINDING (exit 1), unless it is a source-only package
//     (it holds a `package.json`, which assert-lane-coverage.mjs claims as a
//     node unit). A site whose index.html was renamed or moved would otherwise
//     drop out of both guards' claims without a word;
//   · an empty set, or no sites/ at all, is COVERAGE LOST (exit 2): a reader
//     that printed nothing would have said "no sites" about a tree it never
//     reached, and the guards it feeds would run with no claim at all.
//
// Usage:  node tooling/ci/site-set.mjs [--emit] [repoRoot]
//   --emit   prints the set as ONE line of space-separated repo-relative
//            directories (`sites/nikatru sites/rajasekarselvam`), the value
//            ci.yml passes to the two site guards as their claimed roots.
//            Read it in its own assignment (`sites=$(… --emit)`) so the shell's
//            -e stops the step on a non-zero exit.
//
// Exit: 0 the set read · 1 a stray directory · 2 COVERAGE LOST (no sites/, an
// empty set, or a wrong usage).
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';

/** Where the sites live, relative to the repository root. */
export const SITES_DIR = 'sites';
/** The one directory under sites/ that is a shared source layer, not a site. */
export const SHARED_DIR = '_shared';
/** The file that makes a directory a site's deploy root. */
export const SITE_ENTRY = 'index.html';

const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/**
 * `{ sites, strays }` for the tree at `root`, or null when it has no sites/
 * directory. `sites` is every directory name holding a SITE_ENTRY, sorted,
 * SHARED_DIR never among them; `strays` is every other directory under sites/
 * that is neither SHARED_DIR nor a source-only package (a `package.json`).
 * Hidden entries are skipped, and so are files.
 */
export function siteSet(root) {
  const dir = join(root, SITES_DIR);
  if (!isDir(dir)) return null;
  const sites = [];
  const strays = [];
  for (const name of listDir(dir).sort()) {
    if (name.startsWith('.') || name === SHARED_DIR || !isDir(join(dir, name))) continue;
    if (existsSync(join(dir, name, SITE_ENTRY))) sites.push(name);
    else if (!existsSync(join(dir, name, 'package.json'))) strays.push(name);
  }
  return { sites, strays };
}

/** @returns {number} the exit code */
export function main(argv, { log = (s) => console.log(s), err = (s) => console.error(s) } = {}) {
  const flags = argv.filter((a) => a.startsWith('--'));
  const positional = argv.filter((a) => !a.startsWith('--'));
  if (flags.some((f) => f !== '--emit') || positional.length > 1) {
    err('✗ COVERAGE LOST — usage: site-set.mjs [--emit] [repoRoot]');
    return 2;
  }
  const root = resolve(positional[0] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const set = siteSet(root);
  if (set === null) {
    err(`✗ COVERAGE LOST — ${join(root, SITES_DIR)} does not exist, so no site could be read`);
    return 2;
  }
  if (set.sites.length === 0) {
    err(`✗ COVERAGE LOST — ${SITES_DIR}/ holds no directory that ships an ${SITE_ENTRY}; the guards fed by this set would claim nothing`);
    return 2;
  }
  if (set.strays.length) {
    for (const s of set.strays) {
      err(`✗ ${SITES_DIR}/${s} is neither ${SHARED_DIR} nor a site (no ${SITE_ENTRY}) nor a source package (no package.json): no site guard claims it`);
    }
    return 1;
  }
  const rels = set.sites.map((s) => `${SITES_DIR}/${s}`);
  if (flags.includes('--emit')) log(rels.join(' '));
  else log(`ok  site set — ${rels.length} site(s): ${rels.join(', ')}`);
  return 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
