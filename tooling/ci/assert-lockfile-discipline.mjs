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
// ── 🔴 THE HOLE THIS GUARD SHIPPED WITH, FOUND 2026-08-01 ────────────────────
// It reported "3 node unit(s) locked" and exited 0 while the REPO ROOT — which
// declares `"packageManager": "pnpm@9.15.0"` and a `pnpm-workspace.yaml` — had
// NO COMMITTED LOCKFILE AT ALL. Two independent reasons, either one sufficient:
//
//   · the unit scan globbed `services/*`, `packages/*` and `sites/*` and never
//     considered the root, so the root's package.json was not a "node unit" and
//     nothing was ever required of it;
//   · the only lockfile name it knew was `package-lock.json`. A pnpm workspace's
//     lockfile is `pnpm-lock.yaml`, so even had the root been in scope, the
//     check would have looked for a file pnpm never writes.
//
// Reproduced before the fix: `pnpm install` at the root generated a 128-package
// `pnpm-lock.yaml` that `git status` showed as UNTRACKED, and this guard still
// printed its success line. That is F-8's own failure mode — a resolution that
// cannot be reproduced from a checkout — sitting inside the guard for F-8.
//
// The workflow limb had the matching gap: it regexed `npm install` only, so
// `pnpm install` (which resolves loosely without `--frozen-lockfile`) was
// invisible to it too.
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

/** Which lockfile each package manager actually writes. A unit is checked
 *  against the manager IT DECLARES, because requiring `package-lock.json` from a
 *  pnpm workspace is a check that can never pass and — worse, as happened here —
 *  a check that is never run at all. */
const LOCKFILE_FOR = {
  npm: 'package-lock.json',
  pnpm: 'pnpm-lock.yaml',
  yarn: 'yarn.lock',
};

/** The manager a unit declares via package.json `packageManager`, defaulting to
 *  npm — which is what an undeclared unit is installed with here. */
function declaredManager(unitRel) {
  const pkgPath = join(repoRoot, unitRel === '.' ? '' : unitRel, 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const spec = typeof pkg.packageManager === 'string' ? pkg.packageManager : '';
    const name = spec.split('@')[0].trim();
    return LOCKFILE_FOR[name] ? name : 'npm';
  } catch {
    return 'npm';
  }
}

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
// 🔴 THE ROOT IS A NODE UNIT. It carries a package.json, it declares a package
// manager, and `pnpm install` there is a documented step in this repo's own
// workflow — so a build from it is exactly as reproducible-or-not as any unit
// below. Its absence from this list is what let an unpinned pnpm workspace sit
// in a repo whose CI reports "dependency resolution is reproducible".
const rootIsUnit = existsSync(join(repoRoot, 'package.json'));
const nodeUnits = [
  ...(rootIsUnit ? ['.'] : []),
  ...childDirs('services'),
  ...childDirs('packages'),
  ...childDirs('sites'),
].filter((d) => existsSync(join(repoRoot, d === '.' ? '' : d, 'package.json')));

// The scan must still be reaching the root. A refactor of the globs above that
// dropped it would otherwise restore the original hole in silence — and silence
// is indistinguishable from success, which is the whole lesson.
if (existsSync(join(repoRoot, 'package.json')) && !nodeUnits.includes('.')) {
  console.error('✗ COVERAGE LOST — a package.json exists at the repo root and the unit scan did not include it.');
  console.error('  That omission IS the defect this guard was extended to close; it must never come back quietly.');
  process.exit(1);
}

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
  const manager = declaredManager(unit);
  const lockName = LOCKFILE_FOR[manager];
  const lock = unit === '.' ? lockName : posix.join(unit, lockName);
  const label = unit === '.' ? '<repo root>' : unit;
  if (!existsSync(join(repoRoot, lock))) {
    problems.push(
      `${label} has a package.json declaring ${manager} and no ${lockName} — its build is not reproducible. ` +
        `\`${manager} install\` takes whatever is newest that fits the loose ranges, so two installs minutes apart can resolve differently and no checkout can reproduce a shipped build.`,
    );
  } else if (gitAvailable && !isTracked(lock)) {
    problems.push(
      `${lock} exists but is NOT tracked — an untracked lockfile does not travel with a clone, so it pins this working copy and nothing else.`,
    );
  }
}

// ── 2. no workflow installs non-reproducibly for a unit that has a lock ──────
const wfDir = join(repoRoot, '.github', 'workflows');
const workflows = existsSync(wfDir)
  ? readdirSync(wfDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  : [];

/** Every loose-install form, with the flag that makes each one reproducible.
 *  🔴 The original limb knew only `npm install`. `pnpm install` resolves just as
 *  loosely, and this repo pins pnpm at the root — so the one manager the root
 *  workspace actually uses was the one the workflow check could not see. */
const LOOSE_INSTALLS = [
  { re: /\bnpm\s+install\b/, fix: 'use `npm ci` so the lockfile decides' },
  {
    re: /\bpnpm\s+(?:install|i)\b(?![^\n]*--frozen-lockfile)/,
    fix: 'use `pnpm install --frozen-lockfile` so the lockfile decides',
  },
  {
    re: /\byarn\s+install\b(?![^\n]*(?:--frozen-lockfile|--immutable))/,
    fix: 'use `yarn install --immutable` so the lockfile decides',
  },
];

for (const wf of workflows) {
  const text = readFileSync(join(wfDir, wf), 'utf8');
  text.split('\n').forEach((line, i) => {
    const code = line.replace(/#.*$/, '');
    const hit = LOOSE_INSTALLS.find((c) => c.re.test(code));
    if (!hit) return;
    // Allowed only inside a job step that belongs to a bootstrap exception. The
    // working-directory is not on this line, so scan the surrounding block.
    const near = text.split('\n').slice(Math.max(0, i - 6), i + 2).join('\n');
    const excused = BOOTSTRAP_EXCEPTIONS.some((p) => near.includes(p));
    if (!excused) {
      problems.push(`.github/workflows/${wf}:${i + 1} installs non-reproducibly — ${hit.fix}`);
    }
  });
}

if (problems.length) {
  console.error(`✗ ${problems.length} reproducibility problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}

const byManager = nodeUnits.reduce((acc, u) => {
  const m = declaredManager(u);
  acc[m] = (acc[m] ?? 0) + 1;
  return acc;
}, {});
console.log(
  `ok  lockfile discipline — ${nodeUnits.length} node unit(s) locked (${Object.entries(byManager).map(([m, n]) => `${n} ${m}`).join(', ')}), ` +
    `repo root included, every workflow install is reproducible`,
);
