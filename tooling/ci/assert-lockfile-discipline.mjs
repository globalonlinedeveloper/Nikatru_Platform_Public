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
// Three things are asserted:
//   1. every Node unit ships a lockfile, and it is TRACKED (an untracked lock is
//      not a lock — it does not travel with a clone). The tooling islands
//      (TOOL_ISLANDS) are units too.
//   2. no workflow uses a non-reproducible install for a unit that has one
//   3. no workflow and no script fetches a package with `npx` at run time
//      (added 2026-09-24, EXT-3)
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
// Pipeline requirement: Private/requirements/ → F-8.
// (Stage 1's prose, pipeline/01-foundation.md, was folded into that JSON spec
// 2026-08-15; the id still resolves against an `origin` field there.)
//
// Usage:  node tooling/ci/assert-lockfile-discipline.mjs [repoRoot]
// Exit 0 = reproducible, 1 = something can drift (or the scan broke).
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { execFileSync } from 'node:child_process';
import { listDir } from './tree-walk.mjs';
import { parseWorkflow, stepItemAround } from './workflow-scan.mjs';

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

// ⏱ 2026-09-30 · rv2-security-020 (O-BRICK-PROBE-INSTALLS-WITHOUT-ITS-LOCK). A
// list named BOOTSTRAP_EXCEPTIONS stood here, excusing a bare `npm install` near
// `services/probeapi-api`, `apps/probe` or `apps/probeapi` because "a mason-stamped
// app has no lockfile yet by definition". FALSE: the brick stamps its Worker's
// package-lock.json with it, and `npm ci` over a stamp succeeds (measured the same
// day). The exception let ci.yml's app-brick job install versions no stamped app
// ships, and the success line said "every workflow install is reproducible" about a
// directory this guard could not see at all — it exists only after the stamp. The
// list is gone: a loose install is a finding everywhere, and a directory that is
// absent from the tree is graded by limb 2b below.
/** Directories a workflow installs into that exist only after a step MAKES them —
 *  each declared with the template it is stamped from and why. */
const STAMP_PRODUCED = 'tooling/ci/stamp-produced-dirs.json';

const SKIP = new Set(['node_modules', 'build', '.dart_tool', '.wrangler', '_site', '.git']);

function childDirs(rel) {
  const abs = join(repoRoot, rel);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
  return listDir(abs, { withFileTypes: true })
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
/** ⏱ 2026-09-24 (EXT-3) — THE TOOLING ISLANDS ARE NODE UNITS. Each is a directory
 *  whose only job is to hold one tool's exact version and its lockfile, installed
 *  with `npm ci --prefix <island>`: `_playwright/` (the browser tier), and since
 *  O-WEB-EXT-FETCHED-AT-RUN-TIME `tooling/web-ext/` (the Firefox lint and the AMO
 *  signer) and `tooling/wrangler/` (deploy-web's Pages-project step). An island
 *  without a tracked lockfile is the run-time fetch it replaced, so each is held to
 *  limb 1 like any service. Named here rather than globbed: `tooling/*` also holds
 *  dependency-free packages that need no lockfile. */
const TOOL_ISLANDS = ['_playwright', 'tooling/web-ext', 'tooling/wrangler'];
const nodeUnits = [
  ...(rootIsUnit ? ['.'] : []),
  ...childDirs('services'),
  ...childDirs('packages'),
  ...childDirs('sites'),
  ...TOOL_ISLANDS,
].filter((d) => existsSync(join(repoRoot, d === '.' ? '' : d, 'package.json')));

// The scan must still be reaching the root. A refactor of the globs above that
// dropped it would otherwise restore the original hole in silence — and silence
// is indistinguishable from success, which is the whole lesson.
if (existsSync(join(repoRoot, 'package.json')) && !nodeUnits.includes('.')) {
  console.error('✗ COVERAGE LOST — a package.json exists at the repo root and the unit scan did not include it.');
  console.error('  That omission IS the defect this guard was extended to close; it must never come back quietly.');
  coverageLost();
}

if (nodeUnits.length < MIN_NODE_UNITS) {
  console.error(
    `✗ COVERAGE LOST — found ${nodeUnits.length} node unit(s), expected at least ${MIN_NODE_UNITS}.`,
  );
  console.error(`  The scan is broken, not the tree. repo root used: ${repoRoot}`);
  coverageLost();
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
  ? listDir(wfDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
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

/** ANY install, loose or reproducible — the detail limb 2 parses. */
const ANY_INSTALL = /\b(?:npm\s+(?:ci|install)|pnpm\s+(?:install|i)|yarn\s+install)\b/;
let installLines = 0;

/** Where an install on workflow line `n` (1-based) RUNS: its step's
 *  `working-directory`, else its job's `defaults.run.working-directory`, else the
 *  workflow's, else the repo root — then a `--prefix <dir>` on the line, relative to
 *  that. Read off workflow-scan.mjs's one comment-blanked parse. Returns the path as
 *  written (a `${{ … }}` expression is kept, and resolved by nobody here). */
function installDir(parsed, n, line) {
  const unq = (s) => s.trim().replace(/^(['"])(.*)\1$/, '$2');
  let wd = null;
  for (const job of parsed?.jobs?.values() ?? []) {
    const at = job.lines.findIndex((l) => l.n === n);
    if (at === -1) continue;
    const item = stepItemAround(job.lines, at);
    if (item) {
      for (let j = item.start; j < item.end; j++) {
        const t = j === item.start ? job.lines[j].text.replace(/^(\s*)-\s/, '$1  ') : job.lines[j].text;
        const m = t.match(new RegExp(`^ {${item.indent + 2}}working-directory:\\s*(\\S.*?)\\s*$`));
        if (m) wd = unq(m[1]);
      }
    }
    if (wd === null) {
      const d = job.lines.findIndex((l) => /^ {4}defaults:\s*$/.test(l.text));
      for (let j = d + 1; d !== -1 && j < job.lines.length && !/^ {0,4}\S/.test(job.lines[j].text); j++) {
        const m = job.lines[j].text.match(/^ {8}working-directory:\s*(\S.*?)\s*$/);
        if (m) wd = unq(m[1]);
      }
    }
    break;
  }
  if (wd === null) {
    const head = (parsed?.lines ?? []).slice(0, (parsed?.jobsAt ?? 1) - 1);
    const d = head.findIndex((l) => /^defaults:\s*$/.test(l.text));
    for (let j = d + 1; d !== -1 && j < head.length && !/^\S/.test(head[j].text); j++) {
      const m = head[j].text.match(/^ {4}working-directory:\s*(\S.*?)\s*$/);
      if (m) wd = unq(m[1]);
    }
  }
  const prefix = line.match(/--prefix[=\s]+(\S+)/);
  return posix.normalize(posix.join(wd ?? '.', prefix ? unq(prefix[1]) : '.')).replace(/\/$/, '');
}

/** stamp-produced-dirs.json, or an empty declaration when the tree carries none. */
const stampDecl = (() => {
  const abs = join(repoRoot, STAMP_PRODUCED);
  if (!existsSync(abs)) return { dirs: [] };
  try {
    const j = JSON.parse(readFileSync(abs, 'utf8'));
    return { dirs: Array.isArray(j.dirs) ? j.dirs : [] };
  } catch (e) {
    console.error(`✗ COVERAGE LOST — ${STAMP_PRODUCED} does not parse as JSON: ${e.message}`);
    return coverageLost();
  }
})();
for (const d of stampDecl.dirs) {
  if (typeof d?.dir !== 'string' || typeof d?.template !== 'string' || typeof d?.why !== 'string' || d.why.trim().length < 20) {
    problems.push(`${STAMP_PRODUCED}: entry ${JSON.stringify(d)} needs "dir", "template" and a "why" of at least 20 characters.`);
  }
}
const lostDirs = [];
const stampUsed = new Set();
let staticDirInstalls = 0;
let runtimeDirInstalls = 0;
let stampGraded = 0;

for (const wf of workflows) {
  const text = readFileSync(join(wfDir, wf), 'utf8');
  const parsed = parseWorkflow(repoRoot, `.github/workflows/${wf}`);
  text.split('\n').forEach((line, i) => {
    const code = line.replace(/#.*$/, '');
    if (!ANY_INSTALL.test(code)) return;
    installLines++;
    const hit = LOOSE_INSTALLS.find((c) => c.re.test(code));
    if (hit) problems.push(`.github/workflows/${wf}:${i + 1} installs non-reproducibly — ${hit.fix}`);

    // ── 2b. WHERE the install runs must be a directory this guard can read ──
    const dir = installDir(parsed, i + 1, code);
    if (dir.includes('${{')) {
      runtimeDirInstalls++; // a matrix/expression directory: resolved at run time, printed below
      return;
    }
    if (existsSync(join(repoRoot, dir))) {
      staticDirInstalls++;
      return;
    }
    const decl = stampDecl.dirs.find((d) => d?.dir === dir);
    if (!decl) {
      lostDirs.push(`.github/workflows/${wf}:${i + 1} installs in \`${dir}\`, which does not exist in the tree`);
      return;
    }
    const firstUse = !stampUsed.has(dir);
    stampUsed.add(dir);
    stampGraded++;
    if (!firstUse) return; // the template is graded once, however many installs run in its stamp
    // Graded against what the stamp TEMPLATE holds: its lockfile is the one the
    // install will read, so it must exist, be tracked, and agree with the
    // template's package.json — `npm ci` refuses a lock out of step with it.
    const tpl = decl.template;
    const tplLock = posix.join(tpl, 'package-lock.json');
    const tplPkg = posix.join(tpl, 'package.json');
    if (!existsSync(join(repoRoot, tplPkg)) || !existsSync(join(repoRoot, tplLock))) {
      problems.push(
        `.github/workflows/${wf}:${i + 1} installs in stamp-produced \`${dir}\`, and its template ${tpl} ` +
          'does not carry both package.json and package-lock.json — the stamp ships no lock for the install to read.',
      );
      return;
    }
    if (gitAvailable && !isTracked(tplLock)) problems.push(`${tplLock} exists but is NOT tracked — the stamp would not carry it from a clone.`);
    try {
      const pkg = JSON.parse(readFileSync(join(repoRoot, tplPkg), 'utf8'));
      const root = JSON.parse(readFileSync(join(repoRoot, tplLock), 'utf8'))?.packages?.[''] ?? {};
      for (const k of ['dependencies', 'devDependencies']) {
        const want = JSON.stringify(Object.entries(pkg[k] ?? {}).sort());
        const got = JSON.stringify(Object.entries(root[k] ?? {}).sort());
        if (want !== got) {
          problems.push(`${tplLock} records ${k} that differ from ${tplPkg} — \`npm ci\` over the stamp refuses a lock out of step with its package.json.`);
        }
      }
    } catch (e) {
      problems.push(`${tpl}: package.json or package-lock.json does not parse (${e.message}).`);
    }
  });
}
for (const d of stampDecl.dirs) {
  if (typeof d?.dir === 'string' && !stampUsed.has(d.dir)) {
    lostDirs.push(`${STAMP_PRODUCED} declares \`${d.dir}\` stamp-produced, and no workflow install runs there (stale, or the install's directory stopped resolving)`);
  }
}

// ── 3. nothing fetches a package from the registry at run time ───────────────
// ⏱ 2026-09-24 (EXT-3, O-WEB-EXT-FETCHED-AT-RUN-TIME). `npx --yes <pkg>@<ver>`
// is an install with no lockfile at all: the exact version pins the top package
// and every package under it resolves loose, at the moment the step runs — for the
// AMO signer that moment held the store credentials, and for wrangler the account
// token. Limb 2 could not see it, because `npx` is not an install verb. A tool a
// workflow or a script runs comes from a locked island (limb 1) instead.
//
// A workflow line (comments stripped) is a fetch when `npx` carries `--yes`/`-y`,
// `--package`/`-p`, or a `<pkg>@<version>` spec. `npx tsc` in a unit that
// `npm ci`s first runs the locked local binary and is not one.
const NPX_FETCH = /\bnpx\b[^\n]*?(?:\s(?:--yes|-y|--package|-p)(?=[\s=]|$)|\s["']?(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+@[^\s"']+)/;
// A script that spawns `npx` with a fetch flag as its FIRST argument — the shape
// publish-amo.mjs shipped: spawnSync of npx whose argv opened with --yes, then the pin and 'sign'.
const NPX_SPAWN_FETCH = /["']npx["']\s*,\s*\[\s*["'](?:--yes|-y|--package|-p)["']/;
for (const wf of workflows) {
  readFileSync(join(wfDir, wf), 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (NPX_FETCH.test(line.replace(/#.*$/, ''))) {
        problems.push(
          `.github/workflows/${wf}:${i + 1} fetches a package with npx at run time — its tree resolves loose, with no lockfile. ` +
            'Install the tool from a locked island (`npm ci --ignore-scripts --prefix <island>`) and run its node_modules/.bin binary.',
        );
      }
    });
}
/** Every tracked script file, or — outside a git checkout — every one on disk. */
function codeFiles() {
  if (gitAvailable) {
    try {
      return execFileSync('git', ['ls-files', '-z', '--', '*.mjs', '*.js', '*.cjs'], { cwd: repoRoot, encoding: 'utf8' })
        .split('\0')
        .filter(Boolean);
    } catch {
      return [];
    }
  }
  const out = [];
  const walk = (rel) => {
    for (const d of childDirs(rel)) walk(d);
    const abs = join(repoRoot, rel);
    for (const e of listDir(abs, { withFileTypes: true })) {
      if (e.isFile() && /\.(?:mjs|js|cjs)$/.test(e.name)) out.push(posix.join(rel, e.name));
    }
  };
  walk('');
  return out;
}
const scripts = codeFiles();
for (const rel of scripts) {
  const text = readFileSync(join(repoRoot, rel), 'utf8');
  // Over the WHOLE text, not per line: the call publish-amo.mjs shipped put `'npx',`
  // and its argv on separate lines, which a per-line test never sees (measured on
  // this limb's own red control, 2026-09-24).
  for (const m of text.matchAll(new RegExp(NPX_SPAWN_FETCH.source, 'g'))) {
    const line = text.slice(0, m.index).split('\n').length;
    problems.push(
      `${rel}:${line} spawns npx with a fetch flag — a registry fetch at run time, with no lockfile under the top package. ` +
        'Run the binary a locked island installs instead, and refuse when it is absent.',
    );
  }
}
// In a git checkout a zero is `git ls-files` failing, never a tree without scripts:
// this repository tracks hundreds. (A fixture tree outside git is walked instead,
// and may hold none.)
if (gitAvailable && scripts.length === 0) {
  console.error(`✗ COVERAGE LOST — git ls-files named ZERO script files under ${repoRoot}, so "no script spawns an npx fetch" was asked of nothing.`);
  coverageLost();
}

// ⏱ 2026-09-15 — LIMB 2 OVER NOTHING IS COVERAGE LOST. With .github/workflows
// moved aside this guard printed "every workflow install is reproducible" and
// exited 0 having read no workflow (O-LOCAL-SCRIPTS-PARSE-MOVED-WORKFLOWS). The
// same holds if the installs move out of the workflows (into a composite action,
// say): a limb that sees no install at all has stopped checking, not passed.
if (workflows.length === 0 || installLines === 0) {
  console.error(
    `✗ COVERAGE LOST — read ${workflows.length} workflow file(s) under .github/workflows and ${installLines} install ` +
      'command(s) in them, so "every workflow install is reproducible" was asked of nothing.',
  );
  for (const p of problems) console.error(`    (also) ${p}`);
  if (problems.length === 0) coverageLost(); process.exit(1); // a limb-1 finding printed "(also)" above keeps 1
}

// Reported here, after every limb, so a finding elsewhere still prints beside it.
if (lostDirs.length) {
  console.error(`✗ COVERAGE LOST — ${lostDirs.length} workflow install director(ies) this guard cannot grade:`);
  for (const l of lostDirs) console.error(`    ${l}`);
  console.error(`  A directory that exists only after a step makes it (a stamp) holds no lockfile this guard can read, so`);
  console.error(`  "every workflow install is reproducible" would be vacuous for it. Declare it in ${STAMP_PRODUCED}`);
  console.error('  with the template it is stamped from, so the install is graded against the lockfile that template ships.');
  for (const p of problems) console.error(`    (also) ${p}`);
  if (problems.length === 0) coverageLost();
  process.exit(1);
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
    `repo root included, every workflow install is reproducible, no npx fetch in ${workflows.length} workflow(s) or ${scripts.length} script(s)`,
);
console.log(
  `    install directories: ${staticDirInstalls} in the tree, ${stampGraded} stamp-produced (graded against the ` +
    `template's lockfile, ${STAMP_PRODUCED}), ${runtimeDirInstalls} named by a \${{ }} expression (resolved at run time, not checked here)`,
);

/** The one COVERAGE LOST stop: each could-not-look branch above prints its own reason and ends
 *  here, so the run exits 2 — never 1, which would read as a finding (AGENTS.md exit-code
 *  convention, O-EXIT2-CONVENTION-GAP). Declared LAST (hoisted) so every `assert-lockfile-discipline.mjs:NNN`
 *  citation above keeps pointing at the line it names. */
function coverageLost() {
  process.exit(2);
}
