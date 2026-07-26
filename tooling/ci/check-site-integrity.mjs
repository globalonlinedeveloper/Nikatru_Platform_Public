#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-site-integrity.mjs — the static sites are code too.
//
// `sites/nikatru` and `sites/rajasekarselvam` are deployed by Cloudflare's own
// Git integration, on every push to main, with no GitHub workflow involved. Until
// this guard existed **nothing in the repo so much as parsed them** — including
// `sites/nikatru/functions/api/subscribe.js`, 110 lines of real server code
// holding a KV binding that stores email signups. A syntax error there ships to
// production within a minute and produces no signal anywhere.
//
// Cloudflare cannot be gated by a GitHub check. So the protection is indirect:
// with `main` protected (F-5a), code that cannot pass this lane cannot reach
// `main`, and therefore cannot reach Cloudflare.
//
// What this checks — deliberately shallow, and honest about it:
//   · every Pages Function parses (catches a typo, NOT wrong logic or a bad key)
//   · every deploy root still ships the files that break the site if missing
//
// Pipeline requirement: company/pipeline/01-foundation.md → F-9.
//
// Usage:  node tooling/ci/check-site-integrity.mjs [repoRoot]
// Exit 0 = clean, 1 = a site is broken or the scan lost its coverage.
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const repoRoot = process.argv[2] ?? process.cwd();
const SITES = join(repoRoot, 'sites');

/** A deploy root is a directory under sites/ that ships an index.html.
 *  `sites/_shared` is an Eleventy source layer, not a deploy root, and is
 *  correctly excluded by that test rather than by a hardcoded name. */
const REQUIRED_FILES = ['index.html', '404.html', 'robots.txt', '_headers'];

/** A scan that quietly matches nothing reports "clean" forever. */
const MIN_SITES = 2;
const MIN_FUNCTIONS = 1;

const problems = [];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

if (!existsSync(SITES)) {
  console.error(`✗ no sites/ directory under ${repoRoot}`);
  process.exit(1);
}

const siteRoots = readdirSync(SITES, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(SITES, e.name, 'index.html')))
  .map((e) => join(SITES, e.name));

// ── required files ───────────────────────────────────────────────────────────
for (const root of siteRoots) {
  for (const f of REQUIRED_FILES) {
    if (!existsSync(join(root, f))) {
      problems.push(`missing ${relative(repoRoot, join(root, f))}`);
    }
  }
}

// ── Pages Functions must at least parse ──────────────────────────────────────
// Pages Functions are ES modules in .js files. `node --check` assumes CommonJS
// for .js and would reject `export` as a syntax error, so each file is copied to
// a .mjs temp — the only extension Node treats as unambiguously ESM.
const functionFiles = siteRoots.flatMap((root) => {
  const fnDir = join(root, 'functions');
  return existsSync(fnDir) ? walk(fnDir).filter((f) => f.endsWith('.js')) : [];
});

const scratch = mkdtempSync(join(tmpdir(), 'nikatru-site-'));
try {
  for (const file of functionFiles) {
    const probe = join(scratch, `probe-${functionFiles.indexOf(file)}.mjs`);
    writeFileSync(probe, readFileSync(file, 'utf8'));
    const r = spawnSync(process.execPath, ['--check', probe], { encoding: 'utf8' });
    if (r.status !== 0) {
      const detail = (r.stderr ?? '').split('\n').find((l) => l.includes('Error')) ?? 'parse failed';
      problems.push(`${relative(repoRoot, file)} does not parse — ${detail.trim()}`);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

// ── coverage self-check, BEFORE reporting clean ──────────────────────────────
if (siteRoots.length < MIN_SITES) {
  console.error(
    `✗ COVERAGE LOST — found ${siteRoots.length} deploy root(s) under sites/, expected at least ${MIN_SITES}.`,
  );
  console.error('  The scan is broken, not the tree.');
  process.exit(1);
}
if (functionFiles.length < MIN_FUNCTIONS) {
  console.error(
    `✗ COVERAGE LOST — found ${functionFiles.length} Pages Function(s), expected at least ${MIN_FUNCTIONS}.`,
  );
  console.error('  Server-side site code exists and is no longer being parsed.');
  process.exit(1);
}

if (problems.length) {
  console.error(`✗ ${problems.length} site problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}

console.log(
  `ok  site integrity — ${siteRoots.length} deploy root(s), ${functionFiles.length} function(s) parse, required files present`,
);
