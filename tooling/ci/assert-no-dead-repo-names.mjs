#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-no-dead-repo-names.mjs — NO LIVE SURFACE MAY NAME A DEAD REPOSITORY.
//
// ── WHAT WENT WRONG, AND WHY A GUARD RATHER THAN A FIX ───────────────────────
// On 2026-09-05 globalonlinedeveloper/Nikatru_Extensions_Public and its private
// half were merged into this repository's `extensions/` subtree under [ADR 067]
// decision 1, and then DELETED on GitHub. On 2026-09-06 the Renovate workflow
// was still listing the deleted name in RENOVATE_REPOSITORIES and every
// scheduled run had failed since the deletion.
//
// The one-line fix to that workflow was never the point. NOTHING IN THE TREE
// KNEW THE NAME WAS DEAD, so the same class of defect was free to sit in every
// other machine-read surface — and a sweep on 2026-09-06 found it had: a
// register declaring both deleted repos as `existsOnGitHub: true`, an issue
// chooser pointing at a 404, and the support URL shipped to the Chrome Web
// Store listing. Each of those is one edit; the absence of a check is the
// defect that produces them all again.
//
// ── WHAT THIS GUARD IS, EXACTLY ──────────────────────────────────────────────
// tooling/dead-repos.json is the DATA — every name that has stopped answering,
// the date it died, and where its contents went. This file is the only reader
// that enforces it. Adding a dead name is a data edit; nobody has to touch code
// to widen the check, and nobody can widen it by accident either, because the
// declaration carries a measurement.
//
// ── THE LINE BETWEEN A DEFECT AND A RECORD, WHICH IS THE WHOLE DESIGN ────────
// A dead name in a WORKFLOW is a defect: something dispatches against it.
// A dead name in an ADR is a RECORD: it is what was true when the decision was
// taken, and rewriting it is falsifying history. So the scan set is not "the
// repository" — it is the seven globs in `scan.globs`, every one of which is
// read by a machine, minus `excludedPaths`, every one of which states why.
// Prose is out of scope BY CONSTRUCTION, not by oversight. If this guard ever
// starts wanting to edit a README, the scan set has been widened wrongly.
//
// ── THE ONE FALSE POSITIVE THAT MATTERS ──────────────────────────────────────
// `Project_Cross_Platform_Apps_GITHUB_PAT` is the REAL key in the local vault
// and in tooling/ops/safe-rerun.mjs. It merely begins with a dead repository's
// name. Renaming it would break `gh` auth for every ops script — a guard that
// demanded that would be switched off, correctly. `allowedSuffixes` in the data
// file names it, and a match is skipped when a listed suffix follows.
//
// ── FLOORS ───────────────────────────────────────────────────────────────────
// A walk that matches nothing because it walked nothing reads exactly like a
// pass. `floors.files` and `floors.repos` make that state exit 2 COVERAGE LOST -
// the house meaning of 2: the guard did not check enough to be evidence, which is
// deliberately NOT a pass, and must never be read as one.
//
// Usage:  node tooling/ci/assert-no-dead-repo-names.mjs [repoRoot]
// Exit 0 = no live surface names a dead repository.
//      1 = at least one does. Every hit is printed with file, line and the
//          replacement the data file declares.
//      2 = COVERAGE LOST — the declaration is unreadable, or a floor was not met.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
// ⏱ 2026-09-08 — stripSourceComments is THE tree's comment reduction, and it is
// imported rather than re-implemented for the reason its own module records at
// length: a second copy of a text reduction drifts from the first in the way
// that reports 'clean'. It is offset- and line-preserving, so every line and
// column this guard prints still points at the real byte. NOT_A_SCANNER in
// assert-guard-coverage.mjs is the corpus's index of shared modules;
// text-reductions is in it, and reading that index before writing a rival is
// the standing rule here.
import { stripSourceComments } from './text-reductions.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? join(HERE, '..', '..'));
const DECL_REL = 'tooling/dead-repos.json';

// Every stop in this file is a COVERAGE LOST stop, and each exits 2 here, by name — the
// shape assert-guard-coverage's limb 2b reads (O-EXIT2-CONVENTION-GAP). A finding is the
// single exit 1 at the verdict below.
function coverageLost(lines) {
  for (const l of lines) console.error(l);
  process.exit(2);
}

// ── 1. the declaration ───────────────────────────────────────────────────────
const declPath = join(ROOT, DECL_REL);
if (!existsSync(declPath)) {
  coverageLost([`✗ COVERAGE LOST — ${DECL_REL} does not exist. This guard is a reader of that file; without it there is no list of dead names and a green run would mean nothing.`]);
}
let decl;
try {
  decl = JSON.parse(readFileSync(declPath, 'utf8'));
} catch (e) {
  coverageLost([`✗ COVERAGE LOST — ${DECL_REL} is not readable JSON: ${e.message}`]);
}

const repos = Array.isArray(decl.repos) ? decl.repos : null;
if (!repos) coverageLost([`✗ COVERAGE LOST — ${DECL_REL} has no \`repos\` ARRAY.`]);
for (const [i, r] of repos.entries()) {
  for (const k of ['name', 'died', 'wentTo']) {
    if (typeof r?.[k] !== 'string' || !r[k].trim()) {
      coverageLost([`✗ COVERAGE LOST — repos[${i}]: \`${k}\` is missing or empty. A dead name without a date and a destination is a complaint, not a declaration: the guard could refuse a reference without being able to say what to write instead.`]);
    }
  }
}
const globs = Array.isArray(decl.scan?.globs) ? decl.scan.globs : null;
if (!globs || globs.length === 0) coverageLost([`✗ COVERAGE LOST — ${DECL_REL} declares no \`scan.globs\`. An empty scan set is a guard with no subject.`]);

const excluded = Array.isArray(decl.excludedPaths) ? decl.excludedPaths : [];
const allowedSuffixes = Array.isArray(decl.allowedSuffixes) ? decl.allowedSuffixes : [];
const FLOOR_FILES = Number(decl.floors?.files ?? 0);
const FLOOR_REPOS = Number(decl.floors?.repos ?? 0);

// Longest name first, so `Project_Cross_Platform_Apps_Private` is reported as
// itself and never as `Project_Cross_Platform_Apps` plus a stray suffix.
const byName = [...repos].sort((a, b) => b.name.length - a.name.length);

// ── 2. the scan set ──────────────────────────────────────────────────────────
// The globs are deliberately a SMALL fixed vocabulary — `**/name`, `dir/**/*.ext`
// and plain paths — rather than a general matcher. A glob engine here would be a
// second place for the scan set to be wrong, and the set is the whole argument.
// A glob is TOKENISED rather than string-substituted. The version that stood
// here for ten minutes used a sentinel character to hold `**/` while `*` was
// replaced, and the sentinel it chose survived into the file on disk as a NUL
// byte, which made git classify this source as binary. Tokenising has no
// intermediate state to smuggle anything through.
const toRe = (g) => {
  const esc = (s) => s.replace(/[.+^${}()|[\]\\?*]/g, '\\$&');
  let out = '';
  let i = 0;
  while (i < g.length) {
    if (g.startsWith('**/', i)) { out += '(?:[^/]+/)*'; i += 3; }
    else if (g[i] === '*') { out += '[^/]*'; i += 1; }
    else { out += esc(g[i]); i += 1; }
  }
  return new RegExp(`^${out}$`);
};
const globRes = globs.map(toRe);
const isScanned = (rel) => globRes.some((re) => re.test(rel));
const isExcluded = (rel) => excluded.some((e) => (e.endsWith('/') ? rel.startsWith(e) : rel === e));

const SKIP_DIRS = new Set(['.git', 'node_modules', 'build', 'dist', '.dart_tool', '.wrangler', 'coverage']);
const files = [];
const walk = (abs, rel) => {
  let entries;
  // listDir, not readdirSync: it is the one place that knows which entries are
  // NOT part of the tree under test. A raw listing descends into a nested
  // checkout - a worktree under .worktrees/, or Projects/_archived-2026-09-05/ -
  // and reads another repository's files as this one's. That is green in CI,
  // which creates no worktrees, and red only on the machine of the person
  // actually looking at it, which is the worst place for a guard to be wrong.
  try { entries = listDir(abs, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (isExcluded(`${r}/`)) continue;
      walk(join(abs, e.name), r);
    } else if (e.isFile() && isScanned(r) && !isExcluded(r)) {
      files.push(r);
    }
  }
};
walk(ROOT, '');
files.sort();

// ── 3. the scan ──────────────────────────────────────────────────────────────
/* 🔴 A YAML COMMENT IS NOT ACTED ON, SO IT IS NOT THIS GUARD'S SUBJECT.
   AGENTS.md: "Assert on parsed structure, never by grepping prose. Strip
   comments AND string literals first." A workflow's `#` lines are prose living
   inside a live file, and the FIRST thing this guard met in the wild was exactly
   that: PR #502 removed the dead repository from RENOVATE_REPOSITORIES and left
   a comment saying which name had been removed and why. Refusing that comment
   would mean a fix cannot explain itself — and a guard that forbids the record
   of its own defect is a guard people delete.

   String VALUES are still scanned. `RENOVATE_REPOSITORIES: globalonlinedeveloper/X`
   is the thing a machine reads, and a name is no less live for being quoted.
   Only the run of characters from an unquoted `#` to end of line is dropped, and
   quote tracking is what keeps a `#` inside a value from truncating it. */
const stripYamlComments = (line) => {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === '\\' && quote === '"') { i += 1; continue; }
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      // Blank the comment rather than truncate, so every column number below
      // still points at the real column in the real file.
      return line.slice(0, i) + ' '.repeat(line.length - i);
    }
  }
  return line;
};
const isYaml = (rel) => rel.endsWith('.yml') || rel.endsWith('.yaml');

// 🔴 THE SAME ARGUMENT, ONE LANGUAGE FURTHER (2026-09-08). The scan set gained
// the .mjs files under tooling/ today, and they are the STRONGEST member of it
// rather than the weakest: every other glob names a file a machine READS, while
// a .mjs under tooling/ is one a machine EXECUTES. A dead repository name on a
// live line there is acted on, not merely read aloud. The hole had a name —
// tooling/scripts/install-hooks.mjs:162 holds one inside an executable array and
// this guard could not see it.
//
// But a .mjs carries the same prose a .yml does, and more of it. MEASURED before
// this stripper existed, with the glob added and nothing else changed: 291 files
// scanned, 34 findings — and about 28 of them were line or block comments
// recording the very renames this guard enforces, INCLUDING THIS FILE'S OWN
// HEADER, which explains the _GITHUB_PAT false positive by spelling a dead name
// out twice. A guard that forbids the record of its own defect is a guard people
// delete: the sentence the YAML block above already earned, now paid for twice.
//
// ⚠️ WHICH EXTENSIONS ARE STRIPPED IS DECLARED, NEVER INFERRED. `scan.commentStripped`
// in the declaration lists them, so widening the globs to a language whose
// comments this guard cannot read is a change somebody makes ON PURPOSE, in the
// declaration, rather than one that happens silently the day a glob grows.
//
// String literals are still scanned, exactly as in YAML: a name is no less live
// for being quoted.
const COMMENT_STRIPPED = new Set(decl.scan?.commentStripped ?? []);
const extOf = (rel) => { const dot = rel.lastIndexOf('.'); return dot === -1 ? '' : rel.slice(dot); };
const stripsComments = (rel) => COMMENT_STRIPPED.has(extOf(rel));

// 🔴 THE RESIDUE IS DECLARED WITH A COUNT, NOT WAIVED BY PATH. Four hits survive
// comment-stripping: one live-code evidence constant and three sentences inside
// printed messages. `excludedPaths` would have swallowed them — and swallowing
// tooling/scripts/install-hooks.mjs is exactly how the hole the new glob just
// closed would re-open under a politer name, because that file is where the hole
// WAS. So each is declared with the number of occurrences it excuses:
//
//     MORE than `count`  → a FINDING. A new mention appeared that nobody argued for.
//     FEWER than `count` → COVERAGE LOST. The reason expired; the row retires too.
//
// A row cannot quietly outlive its reason — the discipline the dead-file guard's
// EXEMPTIONS table states, and which this one now shares.
const codeMentions = new Map((decl.codeMentions ?? []).map((m) => [m.path, m]));
for (const m of decl.codeMentions ?? []) {
  if (typeof m.path !== 'string' || !Number.isInteger(m.count) || m.count < 1
      || typeof m.kind !== 'string' || typeof m.why !== 'string' || m.why.length < 40) {
    coverageLost([
      '✗ COVERAGE LOST — a codeMentions row is not usable:',
      `    ${JSON.stringify(m)}`,
      '  Every row needs a path, a kind, an integer count of at least 1, and a reason long enough to',
      '  be read aloud. A row missing one of those is an exemption nobody can check.',
    ]);
  }
}
const mentionSeen = new Map((decl.codeMentions ?? []).map((m) => [m.path, 0]));

const findings = [];
for (const rel of files) {
  let text;
  try { text = readFileSync(join(ROOT, rel), 'utf8'); } catch { continue; }
  const raw = text.split('\n');
  const lines = isYaml(rel)
    ? raw.map(stripYamlComments)
    : stripsComments(rel)
      ? stripSourceComments(text, extOf(rel)).split('\n')
      : raw;
  for (const [i, line] of lines.entries()) {
    for (const r of byName) {
      let from = 0;
      for (;;) {
        const at = line.indexOf(r.name, from);
        if (at === -1) break;
        from = at + r.name.length;
        const tail = line.slice(from);
        // A dead name followed by a declared suffix is a different identifier.
        if (allowedSuffixes.some((s) => tail.startsWith(s))) continue;
        // A longer dead name already claimed this span.
        if (findings.some((f) => f.file === rel && f.line === i + 1 && at >= f.col - 1 && at < f.col - 1 + f.name.length)) continue;
        findings.push({
          file: rel, line: i + 1, col: at + 1, name: r.name, died: r.died, wentTo: r.wentTo,
          // The RAW line is quoted back, not the comment-stripped one a reader
          // would not recognise when they open the file.
          text: raw[i].trim().slice(0, 160),
        });
        break;
      }
    }
  }
}

// ── 3b. the declared code mentions, accounted ────────────────────────────────
// Findings are PARTITIONED rather than filtered, so both directions stay visible:
// a declared file with MORE hits than it declares keeps the surplus as findings,
// and one with FEWER is the refusal below.
const excused = [];
{
  const kept = [];
  const perFile = new Map();
  for (const f of findings) {
    const row = codeMentions.get(f.file);
    if (row === undefined) { kept.push(f); continue; }
    const n = (perFile.get(f.file) ?? 0) + 1;
    perFile.set(f.file, n);
    if (n <= row.count) { excused.push(f); mentionSeen.set(f.file, n); } else kept.push(f);
  }
  findings.length = 0;
  findings.push(...kept);
}
const staleMentions = [...mentionSeen.entries()]
  .filter(([path, seen]) => seen < codeMentions.get(path).count)
  .map(([path, seen]) => `${path}: declares ${codeMentions.get(path).count}, found ${seen}`);
if (staleMentions.length) {
  coverageLost([
    '✗ COVERAGE LOST — a codeMentions row excuses more than the tree contains:',
    ...staleMentions.map((m) => `    ${m}`),
    '  Fewer occurrences than declared means the reason has expired. Retire the row in the same',
    '  commit as the line it named — a row that outlives its subject excuses a mention nobody made,',
    '  and the next real one lands inside its allowance in silence.',
  ]);
}

// ── 4. floors ────────────────────────────────────────────────────────────────
const floorFailures = [];
if (files.length < FLOOR_FILES) floorFailures.push(`${files.length} file(s) scanned, floor ${FLOOR_FILES}`);
if (repos.length < FLOOR_REPOS) floorFailures.push(`${repos.length} dead repo name(s) declared, floor ${FLOOR_REPOS}`);
if (floorFailures.length) {
  coverageLost([
    '✗ COVERAGE LOST — the scan did not prove it still scanned:',
    ...floorFailures.map((f) => `    ${f}`),
    '  A walk that matches nothing because it walked nothing reads exactly like a pass.',
  ]);
}

// ── 5. the verdict ───────────────────────────────────────────────────────────
console.log(`assert-no-dead-repo-names: ${files.length} machine-read file(s) scanned against ${repos.length} dead repository name(s) from ${DECL_REL}`);
console.log(`  scan set: ${globs.join('  ')}`);
console.log(`  excluded (dated records and fixtures, declared not hidden): ${excluded.join('  ') || 'none'}`);

if (findings.length === 0) {
  if (excused.length) {
    console.log(`  code mention(s) declared and accounted, printed not hidden: ${excused.length}`);
    for (const f of excused) console.log(`      ${f.file}:${f.line}:${f.col} — ${f.name} — ${codeMentions.get(f.file).kind}`);
  }
  console.log('✓ no live surface names a dead repository.');
  process.exit(0);
}

console.error('');
console.error(`✗ ${findings.length} live reference(s) to a DEAD repository:`);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}:${f.col} — \`${f.name}\` (died ${f.died})`);
  console.error(`      ${f.text}`);
  console.error(`      → ${f.wentTo}`);
}
console.error('');
console.error('  This file is READ BY A MACHINE, so the name is acted on, not merely mentioned.');
console.error(`  If the reference is a DATED RECORD rather than live config, add its path to`);
console.error(`  \`excludedPaths\` in ${DECL_REL} WITH A STATED REASON — do not widen the matcher.`);
console.error('  If it is a line of CODE or a sentence inside a printed message, add a `codeMentions`');
console.error('  row instead: a path, a kind, the COUNT it excuses and why. A count is retirable and a');
console.error('  path exclusion is not — the whole-file form blinds every future line in that file too.');
process.exit(1);

// ─────────────────────────────────────────────────────────────────────────────
// THE MUTATION LIVES IN tooling/ci/test/dead-repo-names.test.mjs, NOT HERE.
// A guard that grades itself is the unfalsifiable shape this corpus refuses:
// the test builds a throwaway tree, runs THIS file against it green, then adds
// one workflow naming one dead repo and requires exit 1.
