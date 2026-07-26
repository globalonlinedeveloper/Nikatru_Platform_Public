#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-lockfile-discipline.mjs — a commit resolves the same dependencies twice.
//
// `npm install` reads the loose ranges in package.json and takes whatever is
// newest that fits. So the CI dry-run that "proved" a Worker deploy and the
// deploy itself each resolved independently, minutes apart — and whichever
// version won that race is what reached production, holding the credential that
// applies D1 migrations. `git checkout <sha> && npm install` could never
// reproduce a shipped build.
//
// Two things are asserted:
//   1. every Node unit ships a lockfile, and it is TRACKED (an untracked lock is
//      not a lock — it does not travel with a clone)
//   2. no workflow uses a non-reproducible install for a unit that has one
//
// Pipeline requirement: company/pipeline/01-foundation.md → F-8.
//
// Usage:  node tooling/ci/assert-lockfile-discipline.mjs [repoRoot]
// Exit 0 = reproducible, 1 = something can drift (or the scan broke).
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = process.argv[2] ?? process.cwd();

/** Below this the scan is broken rather than the tree being empty. */
const MIN_NODE_UNITS = 3;

/** The ONLY places a bare `npm install` is legitimate: a mason-stamped app has
 *  no lockfile yet by definition, so `npm ci` there would fail on purpose.
 *  These ship nothing. Delete an entry rather than widening this list — an
 *  unexplained hole is how a guard quietly stops meaning anything. */
const BOOTSTRAP_EXCEPTIONS = [
  'services/probeapi-api', // stamped by the app_brick lane seconds earlier
  'apps/probe',
  'apps/probeapi',
];

const SKIP = new Set(['node_modules', 'build', '.dart_tool', '.wrangler', '_site', '.git']);

function childDirs(rel) {
  const abs = join(repoRoot, rel);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.'))
    .map((e) => posix.join(rel, e.name));
}

const problems = [];

// ── 1. every Node unit has a TRACKED lockfile ────────────────────────────────
const nodeUnits = [...childDirs('services'), ...childDirs('packages'), ...childDirs('sites')].filter(
  (d) => existsSync(join(repoRoot, d, 'package.json')),
);

if (nodeUnits.length < MIN_NODE_UNITS) {
  console.error(
    `✗ COVERAGE LOST — found ${nodeUnits.length} node unit(s), expected at least ${MIN_NODE_UNITS}.`,
  );
  console.error(`  The scan is broken, not the tree. repo root used: ${repoRoot}`);
  process.exit(1);
}

/** Tracked-ness is what makes a lockfile real; an ignored one never reaches CI. */
function isTracked(rel) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', rel], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

const gitAvailable = existsSync(join(repoRoot, '.git'));

for (const unit of nodeUnits) {
  const lock = posix.join(unit, 'package-lock.json');
  if (!existsSync(join(repoRoot, lock))) {
    problems.push(`${unit} has a package.json but no package-lock.json — its build is not reproducible`);
  } else if (gitAvailable && !isTracked(lock)) {
    problems.push(`${lock} exists but is NOT tracked — an untracked lockfile does not travel with a clone`);
  }
}

// ── 2. no workflow installs non-reproducibly for a unit that has a lock ──────
const wfDir = join(repoRoot, '.github', 'workflows');
const workflows = existsSync(wfDir)
  ? readdirSync(wfDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  : [];

for (const wf of workflows) {
  const text = readFileSync(join(wfDir, wf), 'utf8');
  text.split('\n').forEach((line, i) => {
    const code = line.replace(/#.*$/, '');
    if (!/\bnpm\s+install\b/.test(code)) return;
    // Allowed only inside a job step that belongs to a bootstrap exception. The
    // working-directory is not on this line, so scan the surrounding block.
    const near = text.split('\n').slice(Math.max(0, i - 6), i + 2).join('\n');
    const excused = BOOTSTRAP_EXCEPTIONS.some((p) => near.includes(p));
    if (!excused) {
      problems.push(
        `.github/workflows/${wf}:${i + 1} uses \`npm install\` — use \`npm ci\` so the lockfile decides`,
      );
    }
  });
}

if (problems.length) {
  console.error(`✗ ${problems.length} reproducibility problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}

console.log(
  `ok  lockfile discipline — ${nodeUnits.length} node unit(s) locked, every workflow install is reproducible`,
);
