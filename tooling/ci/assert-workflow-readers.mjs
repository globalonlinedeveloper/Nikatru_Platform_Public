#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-workflow-readers.mjs — a local script may read a workflow by text only
// through tooling/ci/workflow-scan.mjs, or by refusing, out loud, when the detail
// it reads is gone.
//
// Register row: O-LOCAL-SCRIPTS-PARSE-MOVED-WORKFLOWS. The declarations live in
// tooling/workflow-readers.json, whose `_why` carries the two instances.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// 🔴 TWO LOCAL GATES BROKE THE SAME WAY IN ONE DAY. guard-sweep.mjs (2026-09-12)
// matched `node` + whitespace + path, and a `--single-threaded` flag made five
// invoked guards look orphaned. preflight.mjs (2026-09-13) parsed
// `flutter-version:` out of ci.yml after the workflow had moved it. Both failed
// CLOSED INTO NONSENSE instead of saying they had gone blind. CI stayed green on
// the same commits, and a convention nothing grades is how both arrived. This is
// the grading.
//
// ── WHAT IT ASSERTS ──────────────────────────────────────────────────────────
//   R1 every code file outside .github/ (tooling/ci/ included since 2026-09-15) that reads a workflow by
//      text has a row in the register (detected, never listed by hand)
//   R2 a `workflow-scan` row's file imports workflow-scan.mjs
//   R3 a `refuses-blind` row's `evidence` — the text it prints when it cannot
//      see what it reads — is present in the file
//   R4 no row names a file that is gone or no longer reads a workflow
//
// "Reads a workflow by text", in code with comments blanked, is any of:
//   · a `'.github', 'workflows'` path join
//   · a string literal that is ONLY a `.github/workflows` or `.github/workflows/<file>`
//     path. A sentence that mentions a workflow is not a read, and neither is the
//     bare PREFIX `'.github/workflows/'` that a diff classifier matches paths
//     against (extensions/scripts/discover.mjs, measured 2026-09-14)
//   · an import of workflow-scan.mjs
//
// ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────
// It does not read tooling/ci/: those files run in CI on every change and are
// held to a coverage self-check by assert-guard-coverage.mjs. It does not read
// test files, which build workflow fixtures on purpose. It does not execute a
// reader to prove the refusal fires — the evidence string proves the refusal is
// WRITTEN; each reader's own tests prove it runs.
//
// ⏱ 2026-09-15 — tooling/ci/ IS NOW IN THE DOMAIN, and the paragraph above is
// kept as what this guard first shipped with. "Its guards run in CI" was not a
// reason: the failure this register exists for is a reader computing on a
// detail that moved, and CI running such a guard on every change only proves it
// still exits 0 — which is exactly what a blind guard does. Measured that day by
// moving .github/workflows aside in a worktree and running the 20 tooling/ci
// readers that did not import workflow-scan.mjs: assert-lockfile-discipline and
// assert-version-consistency printed `ok` and exited 0 having read no workflow,
// assert-lane-coverage and assert-no-clone-tells reported findings about the
// tree, and assert-analytics-contract died on an ENOENT. Those five now refuse
// by name; the other fifteen already did. Only tooling/ci/workflow-scan.mjs, the
// one parse, is not a reader of itself. Test files stay out, as before.
//
// Usage:  node tooling/ci/assert-workflow-readers.mjs [repoRoot]
// Exit 0 = clean. Exit 1 = a finding. Exit 2 = COVERAGE LOST.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments } from './text-reductions.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());
const REGISTER = 'tooling/workflow-readers.json';
const SCAN_ROOTS = ['tooling', 'extensions', 'apps', 'packages', 'services', 'sites', 'contracts'];
const EXCLUDED_PREFIXES = ['.github/'];
/** The one workflow parse is not a reader of itself, and this grader names that
 *  module as data (the exclusion below, the detector's import pattern) without
 *  reading any workflow. */
const EXCLUDED_FILES = new Set(['tooling/ci/workflow-scan.mjs', 'tooling/ci/assert-workflow-readers.mjs']);
const CI_PREFIX = 'tooling/ci/';
const SKIP_DIRS = new Set(['node_modules', 'build', 'dist', '.dart_tool', '.wrangler', 'test', 'tests', 'fixtures', '__brick__']);
const CODE = /\.(mjs|cjs|js|ts)$/;
const PROPERTIES = new Set(['workflow-scan', 'refuses-blind']);

const READS = [
  /['"`]\.github['"`]\s*,\s*['"`]workflows['"`]/,
  /['"`]\.github\/workflows(?:\/[\w.${}-]+)?['"`]/,
  /workflow-scan\.mjs['"`]/,
];

function coverageLost(lines) {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(2);
}

const regAbs = join(ROOT, REGISTER);
if (!existsSync(regAbs)) coverageLost([`${REGISTER} does not exist, so no reader can be declared and every one found would be judged against nothing.`]);
let reg;
try {
  reg = JSON.parse(readFileSync(regAbs, 'utf8'));
} catch (e) {
  coverageLost([`${REGISTER} is not valid JSON — ${e.message}`]);
}
if (!Array.isArray(reg.readers)) coverageLost([`${REGISTER} has no \`readers\` array.`]);

// ── detection ────────────────────────────────────────────────────────────────
const found = new Map(); // rel -> code (comments blanked)
let scanned = 0;
const walk = (rel) => {
  for (const e of listDir(join(ROOT, rel), { withFileTypes: true })) {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(child);
      continue;
    }
    if (!CODE.test(e.name) || /\.test\.(mjs|js|ts)$/.test(e.name)) continue;
    if (EXCLUDED_PREFIXES.some((p) => child.startsWith(p)) || EXCLUDED_FILES.has(child)) continue;
    scanned++;
    const raw = readFileSync(join(ROOT, child), 'utf8');
    const code = stripSourceComments(raw, e.name.slice(e.name.lastIndexOf('.')));
    if (READS.some((re) => re.test(code))) found.set(child, { raw, code });
  }
};
for (const r of SCAN_ROOTS) if (existsSync(join(ROOT, r))) walk(r);
if (scanned === 0) coverageLost([`scanned ZERO code files under ${SCAN_ROOTS.join(', ')}. The scan is broken, not the tree.`]);
if (found.size === 0) {
  coverageLost([
    `read ${scanned} code file(s) and detected ZERO workflow readers.`,
    'guard-sweep.mjs and gen-start-here.mjs both read workflows; finding none means the detector stopped matching.',
  ]);
}
const ciReaders = [...found.keys()].filter((rel) => rel.startsWith(CI_PREFIX)).length;
if (existsSync(join(ROOT, CI_PREFIX)) && ciReaders === 0) {
  coverageLost([
    `${CI_PREFIX} exists and the detector found ZERO workflow readers in it.`,
    'assert-guard-coverage.mjs and the workflow guards read workflows; finding none there means the tooling/ci walk stopped reaching them.',
  ]);
}

// ── judgement ────────────────────────────────────────────────────────────────
const problems = [];
const rows = new Map();
for (const row of reg.readers) {
  if (!row || typeof row.path !== 'string') {
    problems.push(`R4 ${REGISTER} has a row with no \`path\`.`);
    continue;
  }
  if (rows.has(row.path)) problems.push(`R4 ${REGISTER} declares ${row.path} twice.`);
  rows.set(row.path, row);
}
for (const [rel, { raw, code }] of [...found.entries()].sort()) {
  const row = rows.get(rel);
  if (!row) {
    problems.push(
      `R1 ${rel} reads a workflow by text and has no row in ${REGISTER}. Read it through tooling/ci/workflow-scan.mjs, ` +
        'or make it refuse — COVERAGE LOST / cannot run — when the detail it parses is gone, and declare which.',
    );
    continue;
  }
  if (!PROPERTIES.has(row.property)) {
    problems.push(`R1 ${rel} — property ${JSON.stringify(row.property ?? null)} is not one of ${[...PROPERTIES].join(', ')}.`);
  } else if (row.property === 'workflow-scan') {
    if (!/import\s[^;]*['"`][^'"`]*workflow-scan\.mjs['"`]/.test(code)) {
      problems.push(`R2 ${rel} is declared \`workflow-scan\` and does not import tooling/ci/workflow-scan.mjs.`);
    }
  } else if (typeof row.evidence !== 'string' || row.evidence.trim().length < 20) {
    problems.push(`R3 ${rel} is declared \`refuses-blind\` with no \`evidence\` of at least 20 characters — the text it prints when it cannot see.`);
  } else if (!raw.includes(row.evidence)) {
    problems.push(`R3 ${rel} is declared \`refuses-blind\` and its evidence text is not in the file: ${JSON.stringify(row.evidence)}. The refusal was removed or reworded.`);
  }
}
for (const rel of rows.keys()) {
  if (!found.has(rel)) {
    problems.push(
      existsSync(join(ROOT, rel))
        ? `R4 ${REGISTER} declares ${rel}, which no longer reads a workflow by text. Remove the row.`
        : `R4 ${REGISTER} declares ${rel}, which does not exist. Remove the row.`,
    );
  }
}

// ── R5 · ⏱ 2026-09-24 · P-A2 · A ROW THAT SAYS IT RESOLVES LOCAL `uses:` DOES ──
// O-GUARDS-DO-NOT-FOLLOW-LOCAL-USES. A step moved behind `uses: ./.github/actions/<x>`,
// or into a local reusable workflow, leaves a guard that reads one workflow file at a
// time looking at a workflow with the step gone, and it reports clean. A row carrying
// `resolves: "local-uses"` declares a guard whose subject such a move would hide; its
// code, comments blanked, must call parseResolvedWorkflows( or list .github/actions
// itself. WHICH rows carry it is the declaration and is not graded here; the code is.
// Placed after R4, not beside R2, so the line numbers other files cite in this one stay true.
const RESOLVES = new Set(['local-uses']);
const RESOLVES_BY = [/\bparseResolvedWorkflows\(/, /['"`]\.github['"`]\s*,\s*['"`]actions['"`]|['"`]\.github\/actions/];
let resolving = 0;
for (const row of rows.values()) {
  if (row.resolves === undefined) continue;
  if (!RESOLVES.has(row.resolves)) {
    problems.push(`R5 ${row.path} — resolves ${JSON.stringify(row.resolves)} is not one of ${[...RESOLVES].join(', ')}.`);
    continue;
  }
  const hit = found.get(row.path);
  if (!hit) continue; // R4 has already named a row whose file is gone or reads nothing.
  resolving++;
  if (!RESOLVES_BY.some((re) => re.test(hit.code))) {
    problems.push(
      `R5 ${row.path} is declared \`resolves: "local-uses"\` and its code neither calls parseResolvedWorkflows( nor lists ` +
        '.github/actions — a step moved behind a local `uses:` would leave its subject unread.',
    );
  }
}

if (problems.length) {
  console.error(`✗ workflow readers — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  O-LOCAL-SCRIPTS-PARSE-MOVED-WORKFLOWS: a local script that reads a workflow either reads it through');
  console.error('  workflow-scan.mjs or says, out loud, when what it reads has moved.');
  process.exit(1);
}
const byProp = [...rows.values()].reduce((a, r) => ({ ...a, [r.property]: (a[r.property] ?? 0) + 1 }), {});
console.log(
  `ok  workflow readers — ${found.size} reader(s) (${ciReaders} in ${CI_PREFIX}) in ${scanned} code file(s) outside .github/: ` +
    Object.entries(byProp).map(([k, v]) => `${v} ${k}`).join(' · '),
);
console.log(`    R5 — ${resolving} row(s) declare \`resolves: "local-uses"\`, each calling parseResolvedWorkflows( or listing .github/actions`);
