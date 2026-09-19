#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-mechanism-claims.mjs — a sentence that describes how a mechanism works
// has a test under it, or a recorded judgement that it asserts nothing. The
// candidates nobody has judged yet may only get fewer.
//
// Register row: O-UNGRADED-MECHANISM-CLAIMS. Register: tooling/mechanism-claims.json.
//
// ── WHY ──────────────────────────────────────────────────────────────────────
// tooling/ops/verify-supabase-templates.mjs said in its own header that it
// compared the RECORDED keys and kept no separate array of them. The loop under
// that header walked a hardcoded array of 8 fields while the record held 18.
// Nothing went red, because nothing reads a comment. Fixed in PR #779; the class
// is a prose statement about a mechanism, next to that mechanism, that no check
// grades. A statement like that stays in place when the code under it changes.
//
// ── WHAT THIS GRADES, AND WHAT IT DOES NOT ───────────────────────────────────
// It does NOT decide whether a sentence is true. Matching English cannot do that
// (trap grep-02, quoted in the row). The phrase shapes in the register only find
// CANDIDATE sites. This guard then checks the bookkeeping about each site:
//
//   M1  a file has more UNJUDGED candidate sites than its `backlog` row allows
//       (a file with no row is allowed 0). A new claim arrives with an entry
//       in `claims`, or it does not arrive.
//   M2  a file has FEWER unjudged sites than its `backlog` row. The backlog
//       may only shrink; lower the row in the same change.
//   M3  a `backlog` row names a file this sweep did not read.
//   M4  a `claims` entry whose file is missing, or whose `anchor` is absent from
//       that file or appears in it more than once.
//   M5  a `claims` entry whose anchor covers no candidate site (the sentence
//       was reworded away; remove the entry), or a site two entries cover.
//   M6  a `proven` entry whose `test` file does not exist, or which declares no
//       test / describe / group titled exactly `case`, or which has no `proves`.
//       With `"harness": "check"` or `"expect"` the case is instead the label
//       of a `check('…')` / `expect('…')` call — the extensions' own runners —
//       in a file that defines that function or destructures it from a
//       require/import. Comments are blanked before either lookup.
//   M7  a `demoted` entry with no `reason`, or an entry of any other status.
//
// An entry COVERS the candidate sites that start on a line inside its anchor.
// `proven` means a named test fails when the claim goes false. That is a
// reader's judgement, recorded with the entry; this guard checks that the named
// test exists, not what it asserts. `demoted` means a reader judged the sentence
// to assert nothing a test could grade, and the reason is written down.
//
// ── SCOPE, AND WHAT IS NOT SWEPT ─────────────────────────────────────────────
// Every text file in this repository that the walk reaches, cross-checked
// against `git ls-files` when the root is a git checkout: a tracked text file
// the walk did not open is COVERAGE LOST. With the manifest available, only
// TRACKED files are judged, so an untracked local file cannot turn a developer
// machine red. The register itself is not scanned: its `shapes` and `anchor`
// strings are the declaration, and it would match every shape it declares.
// ⚠️ THE PRIVATE CORPUS IS NOT SWEPT HERE. CI never has it. Its candidates are
// judged in that repository. Every run prints this, so a clean line here is not
// read as covering that corpus.
//
// Usage:  node tooling/ci/assert-mechanism-claims.mjs [repoRoot] [--measure]
//   --measure  prints the `backlog` object the tree implies, as JSON, and exits
//              0 without judging. It writes nothing.
// Exit 0 = clean. Exit 1 = a finding. Exit 2 = COVERAGE LOST.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { extname, join, resolve, sep } from 'node:path';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments } from './text-reductions.mjs';

const args = process.argv.slice(2);
const MEASURE = args.includes('--measure');
const rootArg = args.find((a) => !a.startsWith('--'));
const ROOT = resolve(rootArg ?? process.cwd());
/** No root argument is CI's own invocation, where the git manifest must be readable. */
const scanningRealRepo = rootArg === undefined;

const REGISTER_REL = 'tooling/mechanism-claims.json';

const TEXT_EXT = new Set([
  '.md', '.mjs', '.js', '.cjs', '.ts', '.tsx', '.json', '.jsonc', '.arb',
  '.yml', '.yaml', '.dart', '.html', '.txt', '.sql', '.toml', '.sh', '.ps1',
]);
/** Generated, vendored, or not part of the tree's meaning. `.claude` and nested
 *  checkouts are already excluded by tree-walk.mjs. */
const PRUNE = new Set([
  'node_modules', '.git', 'build', 'dist', '_site', 'coverage',
  '.dart_tool', '.wrangler', '.bundles', '.mason', 'Pods', '.idea', '.vscode',
]);
/** A single space in a register shape stands for this: whitespace and the
 *  comment leaders that sit between two words when a sentence wraps. */
const GAP = '[\\s*#>/]+';

function coverageLost(lines) {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(2);
}

// ── the register ─────────────────────────────────────────────────────────────
const regAbs = join(ROOT, ...REGISTER_REL.split('/'));
if (!existsSync(regAbs)) {
  coverageLost([
    `${REGISTER_REL} does not exist under ${ROOT}.`,
    'It declares the candidate shapes and every judgement about them. Without it there is nothing to find and nothing to check.',
  ]);
}
let reg;
try {
  reg = JSON.parse(readFileSync(regAbs, 'utf8'));
} catch (e) {
  coverageLost([`${REGISTER_REL} is not valid JSON — ${e.message}`]);
}
if (!reg || typeof reg !== 'object' || Array.isArray(reg)) coverageLost([`${REGISTER_REL} is not a JSON object.`]);
if (!Array.isArray(reg.shapes) || reg.shapes.length === 0) {
  coverageLost([`${REGISTER_REL} declares no \`shapes\`, so the sweep would find nothing in any tree.`]);
}
const shapes = reg.shapes.map((s, i) => {
  if (!s || typeof s.id !== 'string' || typeof s.pattern !== 'string' || typeof s.why !== 'string' || !s.why.trim()) {
    coverageLost([`${REGISTER_REL} shapes[${i}] needs a string \`id\`, \`pattern\` and \`why\`.`]);
  }
  try {
    return { id: s.id, re: new RegExp(s.pattern.split(' ').join(GAP), 'gi') };
  } catch (e) {
    return coverageLost([`${REGISTER_REL} shapes[${i}] (${s.id}) is not a valid pattern — ${e.message}`]);
  }
});
if (!Array.isArray(reg.claims)) coverageLost([`${REGISTER_REL} has no \`claims\` array.`]);
const backlog = reg.backlog;
if (!backlog || typeof backlog !== 'object' || Array.isArray(backlog)) coverageLost([`${REGISTER_REL} has no \`backlog\` object.`]);
for (const [f, n] of Object.entries(backlog)) {
  if (!Number.isInteger(n) || n < 1) {
    coverageLost([`${REGISTER_REL} backlog["${f}"] is ${JSON.stringify(n)}; a row is a positive integer, or it is removed.`]);
  }
}

// ── the sweep ────────────────────────────────────────────────────────────────
const walked = [];
const walk = (absDir, relDir) => {
  for (const entry of listDir(absDir, { withFileTypes: true })) {
    if (PRUNE.has(entry.name)) continue;
    const abs = join(absDir, entry.name);
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(abs, rel);
    else if (entry.isFile() && TEXT_EXT.has(extname(entry.name).toLowerCase())) walked.push(rel);
  }
};
walk(ROOT, '');
if (walked.length === 0) {
  coverageLost([`nothing readable was found under ${ROOT}. A sweep over zero files reports every claim judged.`]);
}

const ls = spawnSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const tracked =
  ls.status === 0 ? ls.stdout.split('\n').map((l) => l.trim()).filter((l) => l && TEXT_EXT.has(extname(l).toLowerCase())) : [];
if (tracked.length === 0 && scanningRealRepo) {
  coverageLost([
    `\`git ls-files\` returned no tracked text file under ${ROOT}.`,
    'That manifest is the only way to tell "the sweep covered the repository" from "the sweep found a few files".',
  ]);
}
const walkedSet = new Set(walked);
const unseen = tracked.filter((t) => !walkedSet.has(t));
if (unseen.length) {
  coverageLost([
    `git tracks ${tracked.length} text file(s) and this walk opened ${walked.length}; it never saw ${unseen.length}:`,
    ...unseen.slice(0, 10).map((u) => `    ${u}`),
    ...(unseen.length > 10 ? [`    … and ${unseen.length - 10} more`] : []),
    'A claim in an unseen file is neither judged nor counted, and the sweep would still print ok.',
  ]);
}
const subject = (tracked.length ? tracked : walked).filter((f) => f !== REGISTER_REL).sort();
if (subject.length === 0) {
  coverageLost([`no text file under ${ROOT} besides ${REGISTER_REL}. A sweep over nothing reports every claim judged.`]);
}

const texts = new Map();
const read = (rel) => {
  if (!texts.has(rel)) {
    let t = null;
    try {
      t = readFileSync(join(ROOT, rel.split('/').join(sep)), 'utf8');
    } catch {
      t = null;
    }
    texts.set(rel, t);
  }
  return texts.get(rel);
};
const lineAt = (text, offset) => {
  let n = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) n++;
  return n;
};

/** file → [{ line, shape }] */
const sites = new Map();
const byRoot = new Map();
let filesRead = 0;
for (const rel of subject) {
  const text = read(rel);
  if (text === null) continue;
  filesRead++;
  const top = rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '(top level)';
  byRoot.set(top, (byRoot.get(top) ?? 0) + 1);
  const found = [];
  for (const s of shapes) {
    s.re.lastIndex = 0;
    for (const m of text.matchAll(s.re)) found.push({ offset: m.index, line: lineAt(text, m.index), shape: s.id });
  }
  if (found.length) sites.set(rel, found.sort((a, b) => a.offset - b.offset));
}
if (filesRead === 0) coverageLost([`${subject.length} file(s) were listed and not one could be read.`]);
const totalSites = [...sites.values()].reduce((a, f) => a + f.length, 0);
const recorded = reg.claims.length + Object.values(backlog).reduce((a, n) => a + n, 0);
if (totalSites === 0 && recorded > 0) {
  coverageLost([
    `read ${filesRead} file(s) and found ZERO candidate sites, while ${REGISTER_REL} records ${recorded}.`,
    'Either every one was removed in the same change (then empty the register with it) or the shapes stopped matching.',
  ]);
}

// ── the judgements ───────────────────────────────────────────────────────────
const problems = [];
const covered = new Map(); // "file:offset" → claim index
let proven = 0;
let demoted = 0;

/** The callee names a `proven` entry's `case` is looked up under. Absent
 *  `harness` is the test runners (node:test, flutter_test). `check` and
 *  `expect` are the extensions' own runners — extensions/core/test/harness.js,
 *  each Extension/<Tool>/test/*-sim.node.js and extensions/scripts/test/
 *  selftest.node.js call `check('<label>', ok)` / `expect('<label>', {...})`,
 *  and a false case there fails the run the way a failed test does. */
const RUNNER_CALLEES = ['test', 'it', 'describe', 'group', 'testWidgets'];
const HARNESS_CALLEES = new Set(['check', 'expect']);

/** True when a harness file BINDS `name` itself: declares it as a function
 *  (`function check(`, `const check = (`/`function`) or destructures it from a
 *  require/import (`const { check } = require(`, `import { check } from`). A
 *  file that only CALLS a `check` it never binds is not that harness — the
 *  call could be anything, and a case title in it proves nothing. */
function bindsHarness(text, name) {
  const decl = new RegExp(`(?:^|[^\\w$.])(?:function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?(?:function\\b|\\())`, 'm');
  if (decl.test(text)) return true;
  const destructured = new RegExp(`(?:const|let|var)\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=\\s*(?:require\\s*\\(|[\\w$]+\\s*;)`, 'm');
  const imported = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"]`, 'm');
  return destructured.test(text) || imported.test(text);
}

/** Titles of calls to `callees` whose first argument is a plain string
 *  literal, unescaped. */
function declaredTitles(text, callees = RUNNER_CALLEES) {
  const out = new Set();
  const re = new RegExp(`(?:^|[^\\w$.])(?:${callees.join('|')})\\s*\\(\\s*(['"\`])`, 'g');
  for (const m of text.matchAll(re)) {
    const q = m[1];
    let i = m.index + m[0].length;
    let v = '';
    for (; i < text.length && text[i] !== q; i++) {
      if (text[i] === '\\') { i++; v += text[i] ?? ''; continue; }
      if (q === '`' && text[i] === '$' && text[i + 1] === '{') { v = null; break; }
      v += text[i];
    }
    if (v !== null) out.add(v);
  }
  return out;
}

reg.claims.forEach((c, idx) => {
  const where = `${REGISTER_REL} claims[${idx}]${c?.file ? ` (${c.file})` : ''}`;
  if (!c || typeof c.file !== 'string' || typeof c.anchor !== 'string' || !c.anchor) {
    problems.push(`M4 ${where} needs a string \`file\` and a non-empty \`anchor\`.`);
    return;
  }
  const text = subject.includes(c.file) ? read(c.file) : null;
  if (text === null) {
    problems.push(`M4 ${where} names a file this sweep did not read. Remove the entry, or restore the file.`);
    return;
  }
  const at = text.indexOf(c.anchor);
  if (at === -1) {
    problems.push(`M4 ${where}: the anchor is not in the file any more. Re-anchor it on the sentence, or remove the entry if the sentence is gone.\n        anchor: ${JSON.stringify(c.anchor)}`);
    return;
  }
  if (text.indexOf(c.anchor, at + 1) !== -1) {
    problems.push(`M4 ${where}: the anchor appears more than once, so it names no single sentence. Lengthen it.\n        anchor: ${JSON.stringify(c.anchor)}`);
    return;
  }
  const from = lineAt(text, at);
  const to = lineAt(text, at + c.anchor.length - 1);
  const mine = (sites.get(c.file) ?? []).filter((s) => s.line >= from && s.line <= to);
  if (mine.length === 0) {
    problems.push(`M5 ${where}: the anchor (lines ${from}-${to}) covers no candidate site. The claim was reworded away; remove the entry.`);
  }
  for (const s of mine) {
    const key = `${c.file}:${s.offset}`;
    if (covered.has(key)) problems.push(`M5 ${where} and claims[${covered.get(key)}] both cover ${c.file}:${s.line}. One site has one judgement.`);
    else covered.set(key, idx);
  }
  if (c.status === 'proven') {
    if (typeof c.proves !== 'string' || !c.proves.trim()) {
      problems.push(`M6 ${where} is \`proven\` and has no \`proves\`: say what the test flips and why that makes the claim false.`);
    }
    if (typeof c.test !== 'string' || typeof c.case !== 'string' || !c.case) {
      problems.push(`M6 ${where} is \`proven\` and needs a string \`test\` (a repo-relative path) and \`case\` (an exact test title).`);
      return;
    }
    const t = existsSync(join(ROOT, ...c.test.split('/'))) ? read(c.test) : null;
    if (t === null) {
      problems.push(`M6 ${where} names ${c.test} as its proof, and that file does not exist.`);
      return;
    }
    // Comments blanked first: a commented-out `test('x'` or `check('x'` is
    // not a case that runs.
    const code = stripSourceComments(t, extname(c.test));
    if (c.harness !== undefined) {
      if (!HARNESS_CALLEES.has(c.harness)) {
        problems.push(`M6 ${where} names the harness ${JSON.stringify(c.harness)}; a harness is one of ${[...HARNESS_CALLEES].map((h) => `"${h}"`).join(', ')}, or omit it for test / it / describe / group / testWidgets.`);
        return;
      }
      if (!bindsHarness(code, c.harness)) {
        problems.push(`M6 ${where} cites a \`${c.harness}(...)\` case in ${c.test}, and that file neither defines \`${c.harness}\` nor destructures it from a require/import. A call to a name the file never binds is not that harness.`);
        return;
      }
      if (!declaredTitles(code, [c.harness]).has(c.case)) {
        problems.push(`M6 ${where} names the case ${JSON.stringify(c.case)} in ${c.test}, and that file makes no \`${c.harness}(...)\` call labelled exactly that.`);
        return;
      }
    } else if (!declaredTitles(code).has(c.case)) {
      problems.push(`M6 ${where} names the case ${JSON.stringify(c.case)} in ${c.test}, and that file declares no test titled exactly that.`);
      return;
    }
    proven++;
  } else if (c.status === 'demoted') {
    if (typeof c.reason !== 'string' || !c.reason.trim()) {
      problems.push(`M7 ${where} is \`demoted\` with no \`reason\`. Say why the sentence asserts nothing a test could grade.`);
      return;
    }
    demoted++;
  } else {
    problems.push(`M7 ${where} has status ${JSON.stringify(c.status)}; a claim is \`proven\` or \`demoted\`.`);
  }
});

const unjudged = new Map();
for (const [f, list] of sites) {
  const open = list.filter((s) => !covered.has(`${f}:${s.offset}`));
  if (open.length) unjudged.set(f, open);
}

if (MEASURE) {
  const out = {};
  for (const [f, list] of [...unjudged].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) out[f] = list.length;
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

for (const [f, list] of unjudged) {
  const allowed = backlog[f] ?? 0;
  if (list.length > allowed) {
    problems.push(
      `M1 ${f} has ${list.length} unjudged mechanism claim(s) (${list.map((s) => `${s.shape} at :${s.line}`).join(', ')}) ` +
        `and its backlog allows ${allowed}. Add a \`claims\` entry to ${REGISTER_REL}: \`proven\` with the test that fails ` +
        'when the sentence goes false, or `demoted` with the reason it asserts nothing. Or reword the sentence so it states intent only.',
    );
  }
}
for (const [f, allowed] of Object.entries(backlog)) {
  if (!subject.includes(f)) {
    problems.push(`M3 ${REGISTER_REL} backlog names ${f}, which this sweep did not read. Remove the row.`);
    continue;
  }
  const n = unjudged.get(f)?.length ?? 0;
  if (n < allowed) {
    problems.push(
      `M2 ${f} now has ${n} unjudged candidate(s) and its backlog row says ${allowed}. The backlog may only shrink: ` +
        `lower the row to ${n}${n === 0 ? ' by removing it' : ''} in the same change.`,
    );
  }
}

const rootLine = [...byRoot].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([r, n]) => `${r} ${n}`).join(', ');
const backlogTotal = [...unjudged.values()].reduce((a, l) => a + l.length, 0);
const notes = [
  `swept ${filesRead} ${tracked.length ? 'tracked ' : ''}text file(s) by top-level root: ${rootLine}`,
  `${totalSites} candidate site(s) in ${sites.size} file(s): ${proven} proven, ${demoted} demoted, ${backlogTotal} unjudged in ${unjudged.size} file(s) (backlog, may only shrink)`,
  'the Private corpus is NOT swept by this guard; its candidates are judged in that repository',
  'this checks the bookkeeping about each claim, never whether a sentence is true',
];

if (problems.length) {
  console.error(`✗ mechanism claims — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  for (const n of notes) console.error(`  · ${n}`);
  process.exit(1);
}
console.log('ok  mechanism claims — every candidate site is judged or inside a backlog that only shrinks');
for (const n of notes) console.log(`  · ${n}`);
