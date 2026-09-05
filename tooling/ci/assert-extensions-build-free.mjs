#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-extensions-build-free.mjs — nothing under extensions/ is built.
//
// Pipeline requirement: [ADR 067] decision 1 — "a sovereign, build-free
// extensions/ subtree". Evidence: research/revamp-2026-09-05/16 §0.2, §10.5
// Risk 1, §11.1, §11.2.
//
// ── WHAT THIS PROTECTS, AND WHY IT IS WORTH A GUARD OF ITS OWN ───────────────
// Mozilla's source-code submission policy triggers on "a custom tool that takes
// files, applies pre-processing, and generates file(s) to include in the
// extension". Today FullShot ships the bytes that are in the tree: no bundler,
// no transpiler, no package manager, no generated file. So AMO gets a zip and
// asks for nothing further, and the deterministic zipper's double-build
// SHA-256 compare is a claim a third party can check.
//
// 🔴 THAT PROPERTY WAS A HABIT, AND THE MERGE IS WHAT TURNS IT INTO AN
// INVARIANT. Report 16 §10.5 Risk 1 is blunt about the direction of travel:
// inside one repository the risk goes UP, not down — an agent working in
// services/ runs an install at the wrong root, or "let's just use esbuild for
// the extension" lands without anyone pricing what it costs. The cost is not a
// slower build. It is a permanent, per-release obligation to ship reviewable
// sources to AMO, on an account with three approved storefronts, zero published
// items, and one appeal, forever.
//
// A guard is also the reason the merge is allowed to be a good idea at all:
// two repositories enforced this with a boundary, and a boundary that is only a
// habit is worth less than a check that fails.
//
// ── WHAT IS ALLOWED, DERIVED RATHER THAN REMEMBERED ──────────────────────────
// One island is legitimate and it is legitimate for a reason that survives:
// `Extension/<tool>/test/e2e/` runs Playwright, which is a TEST HARNESS. It is
// excluded from every package by tool.json's own `package.exclude` (`test/**`),
// so not one of its bytes reaches a store. The allowance is written as a SHAPE —
// any tool's test/e2e — so tool #2 inherits it by existing rather than by being
// added here, and it is bounded to the packages a test harness needs.
//
// ── WHAT IT REFUSES ──────────────────────────────────────────────────────────
//   1 a package.json anywhere but a test island; any `dependencies` at all; any
//     devDependency outside the harness set
//   2 a lockfile anywhere but a test island
//   3 a bundler or extension-framework config, by filename or by dependency —
//     webpack, vite, rollup, esbuild, parcel, wxt, plasmo, crxjs
//   4 a tracked path inside node_modules, and a tool.json whose package rules
//     do not exclude node_modules
//   5 any .ts file, any emitting tsconfig.json, and any `tsc` invocation that is
//     not `--noEmit`
//
// ⚠️ .ts IS REFUSED EVEN AS `.d.ts`, AND THAT IS THE POINT RATHER THAN AN
// OVERSHOOT. `tsc --noEmit --checkJs` over unmodified JavaScript is the adopted
// position (report 16 §11.2) and it changes zero shipped bytes; a `.ts` file in
// this tree is the first step of the other thing. The types the extensions need
// live in contracts/, where the TypeScript Worker reads the same declaration —
// which is the whole reason contracts/ is a top-level directory.
//
// ── COVERAGE SELF-CHECK ──────────────────────────────────────────────────────
// A build-free assertion over zero extensions is vacuous and would read exactly
// like a clean tree, which is this corpus's most expensive recurring bug. So the
// walk must find at least one `extensions/Extension/<tool>/tool.json`, and says
// so in its own output line.
//
// Usage:  node tooling/ci/assert-extensions-build-free.mjs [repoRoot]
// Exit 0 = the subtree is build-free · 1 = a build step, or the scan broke.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, posix } from 'node:path';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());
const SUBTREE = 'extensions';
const SUBTREE_ABS = join(ROOT, SUBTREE);

// 🔴 `node_modules` IS DELIBERATELY NOT ON THIS LIST, AND IT WAS. The first
// draft skipped it for the obvious reason — nobody wants to enumerate an
// installed tree — and that made limb 4 an assertion that COULD NOT FAIL: the
// walk never reached a node_modules file, so "no file inside node_modules" was
// true of a tree that was full of them. The fixture caught it on its first run,
// which is the whole reason the fixture exists. It is handled in `walk` instead:
// the DIRECTORY is the finding, and the walk does not descend into it, so the
// cost stays one entry rather than twenty thousand.
/** Never walked: build output and VCS metadata. */
const SKIP_DIRS = new Set(['dist', '.git', '.dart_tool', 'build']);

/** The packages a Playwright island may declare, and nothing else. */
const HARNESS_DEPS = new Set(['playwright', '@playwright/test', 'playwright-core']);

/** Names that ARE a build step, whether they arrive as a file or a dependency. */
const BUILD_TOOLS = [
  'webpack', 'vite', 'rollup', 'esbuild', 'parcel', 'browserify', 'swc',
  'wxt', 'plasmo', 'crxjs', '@crxjs/vite-plugin', 'typescript', 'babel',
  '@babel/core', 'gulp', 'grunt', 'snowpack', 'turbopack',
];

const CONFIG_RE = new RegExp(
  '^(' + ['webpack', 'vite', 'rollup', 'esbuild', 'parcel', 'wxt', 'plasmo', 'crxjs', 'babel', 'swc', 'snowpack']
    .join('|') + ')\\.config\\.(js|mjs|cjs|ts|mts|cts|json)$',
);

const LOCKFILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'npm-shrinkwrap.json']);

/** `extensions/Extension/<tool>/test/e2e/…` — a shape, so tool #2 inherits it. */
const ISLAND_RE = /^Extension\/[^/]+\/test\/e2e(\/|$)/;

const isIsland = (rel) => ISLAND_RE.test(rel);
const say = (rel, msg) => problems.push(`${SUBTREE}/${rel}  — ${msg}`);

const problems = [];
const files = [];
const toolManifests = [];

function walk(absDir, rel) {
  for (const entry of listDir(absDir, { withFileTypes: true })) {
    const childRel = rel ? posix.join(rel, entry.name) : entry.name;
    const childAbs = join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name === 'node_modules') {
        // An INSTALLED test island is expected on a runner and ships nothing —
        // tool.json excludes `test/**` from every package, and 4b asserts the
        // exclude list still says so. Anywhere else it is a package manager in
        // the shipped tree, which is the thing this guard exists to refuse.
        if (!isIsland(childRel)) {
          problems.push(`${SUBTREE}/${childRel}  — an installed node_modules outside a test island. ` +
            'A package manager in the shipped tree is a build step by AMO\'s definition.');
        }
        continue; // never descend: the directory is the finding, not its contents
      }
      walk(childAbs, childRel);
    } else if (entry.isFile()) {
      files.push(childRel);
    }
  }
}

if (!existsSync(SUBTREE_ABS) || !statSync(SUBTREE_ABS).isDirectory()) {
  console.error(`✗ COVERAGE LOST — ${SUBTREE}/ is not a directory under ${ROOT}.`);
  console.error('  This guard has no subject, and "no findings" over no subject is not a pass.');
  process.exit(1);
}
walk(SUBTREE_ABS, '');

// ── 0 COVERAGE ───────────────────────────────────────────────────────────────
const tools = files.filter((f) => /^Extension\/[^/]+\/tool\.json$/.test(f));
if (tools.length === 0) {
  console.error(`✗ COVERAGE LOST — the walk of ${SUBTREE}/ found no Extension/<tool>/tool.json.`);
  console.error(`  ${files.length} file(s) were enumerated, so the walk ran; it is the SUBJECT that is`);
  console.error('  missing. A build-free assertion over zero extensions passes vacuously and reads');
  console.error('  exactly like a clean tree.');
  process.exit(1);
}


for (const rel of files) {
  const name = rel.slice(rel.lastIndexOf('/') + 1);

  // ── 1 PACKAGE MANIFESTS ────────────────────────────────────────────────────
  if (name === 'package.json') {
    if (!isIsland(rel)) {
      say(rel, 'a package.json outside a test island. A package manager in the shipped tree is a build ' +
        'step by AMO\'s definition; the extensions have no dependencies and must keep none.');
      continue;
    }
    let pkg;
    try { pkg = JSON.parse(readFileSync(join(SUBTREE_ABS, rel), 'utf8')); }
    catch (e) { say(rel, `did not parse (${String(e.message).split('\n')[0]}), so its dependencies could not be read`); continue; }
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      say(rel, `declares a runtime dependency "${dep}". A test island may carry devDependencies only — ` +
        'a runtime dependency is a thing something is expected to ship with.');
    }
    for (const dep of Object.keys(pkg.devDependencies ?? {})) {
      if (!HARNESS_DEPS.has(dep)) {
        const named = BUILD_TOOLS.includes(dep) ? ' — and it is a bundler/transpiler by name' : '';
        say(rel, `declares devDependency "${dep}", which is not part of the Playwright harness set ` +
          `(${[...HARNESS_DEPS].join(', ')})${named}. Adding one here is how a toolchain arrives.`);
      }
    }
    continue;
  }

  // ── 2 LOCKFILES ────────────────────────────────────────────────────────────
  if (LOCKFILES.has(name) && !isIsland(rel)) {
    say(rel, 'a lockfile outside a test island — there is nothing here to lock, so its presence means ' +
      'something was installed.');
    continue;
  }

  // ── 3 BUNDLER AND FRAMEWORK CONFIGURATION ──────────────────────────────────
  if (CONFIG_RE.test(name)) {
    say(rel, 'a bundler/framework configuration file. It forfeits the no-build property outright: ' +
      'every one of these generates the files that would then have to be submitted to AMO as sources.');
    continue;
  }

  // ── 4 node_modules — handled in `walk`, where the DIRECTORY is the finding ─

  // ── 5 TYPESCRIPT AS COMPILATION ────────────────────────────────────────────
  if (/\.(ts|mts|cts|tsx)$/.test(name)) {
    say(rel, 'a TypeScript source file. `tsc --noEmit --checkJs` over unmodified JavaScript is the ' +
      'adopted position and changes zero shipped bytes; a .ts file is the other thing. Shared types ' +
      'belong in contracts/, which the Worker reads too.');
    continue;
  }
  if (name === 'tsconfig.json') {
    let cfg;
    try { cfg = JSON.parse(readFileSync(join(SUBTREE_ABS, rel), 'utf8').replace(/^\s*\/\/.*$/gm, '')); }
    catch (e) { say(rel, `a tsconfig.json that did not parse (${String(e.message).split('\n')[0]}) — its emit setting could not be read`); continue; }
    if (cfg?.compilerOptions?.noEmit !== true) {
      say(rel, 'a tsconfig.json that does not set `"noEmit": true`. Type-checking is welcome here; ' +
        'emitting is a build step and an AMO source-submission trigger.');
    }
    continue;
  }
}

// ── 4b EVERY TOOL EXCLUDES node_modules FROM ITS PACKAGE ─────────────────────
// The check above sees what is committed. This one sees what a package would
// COLLECT: `pack.mjs` reads these globs on a runner where the island really has
// been installed, so an exclude list that forgot node_modules ships one.
for (const rel of tools) {
  let tool;
  try { tool = JSON.parse(readFileSync(join(SUBTREE_ABS, rel), 'utf8')); }
  catch (e) { say(rel, `did not parse (${String(e.message).split('\n')[0]})`); continue; }
  toolManifests.push(rel);
  const exclude = tool?.package?.exclude ?? [];
  if (!exclude.some((g) => String(g).includes('node_modules'))) {
    say(rel, 'its package.exclude does not name node_modules. On a runner the test island IS installed, ' +
      'so a package built there would carry it.');
  }
}

// ── 5b `tsc` WITHOUT --noEmit, ANYWHERE THE SUBTREE ASKS FOR IT ──────────────
for (const rel of files) {
  if (!/\.(mjs|js|cjs|json|yml|yaml|sh|md)$/.test(rel)) continue;
  const text = readFileSync(join(SUBTREE_ABS, rel), 'utf8');
  for (const m of text.matchAll(/(?:^|[\s"'`(])(?:npx\s+|pnpm\s+(?:exec\s+)?|yarn\s+)?tsc\b([^\n"'`]*)/g)) {
    if (!/--noEmit\b/.test(m[1])) {
      say(rel, 'invokes `tsc` without --noEmit. Compiling .ts to .js is verbatim the fourth clause of ' +
        "Mozilla's source-code submission policy.");
      break;
    }
  }
}

if (problems.length) {
  console.error(`✗ ${problems.length} build step(s) have reached ${SUBTREE}/:`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  The extensions are build-free BY DECISION ([ADR 067] decision 1), not by accident.');
  console.error('  A build step here obliges every future release to submit reviewable sources to AMO,');
  console.error('  on an account with one appeal, forever. If a build really is wanted, that is an ADR,');
  console.error('  not a dependency.');
  process.exit(1);
}

console.log(
  `ok  extensions build-free — ${files.length} file(s) under ${SUBTREE}/, ${toolManifests.length} tool(s), ` +
    '0 package manager, 0 bundler config, 0 TypeScript source, 0 emitting tsconfig',
);
