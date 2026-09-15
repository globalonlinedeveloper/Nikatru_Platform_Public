#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-no-loop-cases.mjs — no NEW test case may be declared inside a loop in
// tooling/ci/test, and the suites that already do so may only get fewer.
//
// Register row: O-COVERAGE-MANIFEST-LOOP-CASES, option (2) as recorded there.
//
// ── WHY ──────────────────────────────────────────────────────────────────────
// tooling/ci/test/coverage-manifest.json is a per-suite floor of DECLARED cases:
// assert-guard-coverage.mjs counts `test(` / `it(` at the start of a line. A case
// written as ONE declaration inside `for (const x of TABLE) { test(...) }` counts
// once however many cases it runs, so deleting a row of TABLE deletes a real case
// and the ratchet cannot see it. Measured 2026-09-14 (junit, whole suite): 40
// suites ran more cases than they declared, 323 in all.
//
// The row's other exits were declined for recorded reasons — an EXECUTED floor
// is machine-dependent (36 suites ran fewer on Windows than on the Linux runner),
// and rewriting 40 suites is its own change. So the manifest's semantics are NOT
// touched here. What this guard does is stop the blind spot GROWING:
//
//   L1  a suite with MORE loop-wrapped declaration sites than its baseline row
//       (a suite absent from the baseline has a baseline of zero) FAILS
//   L2  a suite with FEWER than its baseline row FAILS until the row is lowered —
//       the baseline may only shrink, and a stale high row would let the next
//       loop in that file in for free
//   L3  a baseline row naming a suite that does not exist FAILS
//
// "A loop-wrapped declaration site" is a `for (…)` statement, or a `.forEach(` /
// `.map(` call, whose body contains a `test(`, `it(` or `describe(` call —
// counted once per loop head, in CODE ONLY: strings, template text, comments and
// regex literals are masked by tooling/ci/text-reductions.mjs `codeMask`, so a
// fixture that WRITES a loop into a temp file is not a loop here.
//
// ⚠️ WHAT IT DOES NOT SEE, STATED: a table-driven helper function that declares a
// case and is CALLED from a loop in another scope, and `while` / recursion. Those
// shapes exist nowhere in the suite today; they are named so nobody reads this as
// a proof that every generated case is counted.
//
// Usage:  node tooling/ci/assert-no-loop-cases.mjs [repoRoot]
// Exit 0 = clean. Exit 1 = a finding. Exit 2 = COVERAGE LOST.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listDir } from './tree-walk.mjs';
import { codeMask, NON_CODE } from './text-reductions.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());
const TEST_DIR = 'tooling/ci/test';
const BASELINE = 'tooling/ci/test/loop-case-baseline.json';

function coverageLost(lines) {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(2);
}

/** Source with every non-code byte (string, template text, comment, regex literal)
 *  replaced by a space, newlines kept — so offsets and line numbers survive. */
function codeOnly(text) {
  const mask = codeMask(text);
  let out = '';
  for (let i = 0; i < text.length; i++) out += mask[i] === NON_CODE ? (text[i] === '\n' ? '\n' : ' ') : text[i];
  return out;
}

function matching(code, openAt, open, close) {
  let depth = 0;
  for (let i = openAt; i < code.length; i++) {
    if (code[i] === open) depth++;
    else if (code[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const DECLARES = /(?:^|[^.\w$])(?:test|it|describe)\s*\(/;

/** Loop heads whose body declares a case. */
function loopCaseSites(text) {
  const code = codeOnly(text);
  const sites = [];
  const heads = [];
  for (const m of code.matchAll(/(?:^|[^.\w$])for\s*(?:await\s*)?\(/g)) heads.push({ kind: 'for', at: m.index, paren: m.index + m[0].length - 1 });
  for (const m of code.matchAll(/\.(?:forEach|map)\s*\(/g)) heads.push({ kind: m[0].includes('forEach') ? 'forEach' : 'map', at: m.index, paren: m.index + m[0].length - 1 });
  for (const h of heads) {
    const closeParen = matching(code, h.paren, '(', ')');
    if (closeParen < 0) continue;
    let body;
    if (h.kind === 'for') {
      let j = closeParen + 1;
      while (j < code.length && /\s/.test(code[j])) j++;
      if (code[j] === '{') {
        const end = matching(code, j, '{', '}');
        if (end < 0) continue;
        body = code.slice(j, end);
      } else {
        const end = code.indexOf(';', j);
        body = code.slice(j, end < 0 ? code.length : end);
      }
    } else {
      body = code.slice(h.paren, closeParen);
    }
    if (DECLARES.test(body)) sites.push({ kind: h.kind, line: code.slice(0, h.at).split('\n').length + (code[h.at] === '\n' ? 1 : 0) });
  }
  return sites;
}

// ── read ─────────────────────────────────────────────────────────────────────
const testAbs = join(ROOT, TEST_DIR);
if (!existsSync(testAbs)) coverageLost([`${TEST_DIR}/ does not exist under ${ROOT}; there is no suite to read.`]);
const suites = listDir(testAbs).filter((f) => f.endsWith('.test.mjs')).sort();
if (suites.length === 0) coverageLost([`${TEST_DIR}/ holds ZERO *.test.mjs files; the scan is broken, not the tree.`]);

const baseAbs = join(ROOT, BASELINE);
if (!existsSync(baseAbs)) coverageLost([`${BASELINE} does not exist, so every loop-wrapped case would be judged against nothing.`]);
let baseline;
try {
  baseline = JSON.parse(readFileSync(baseAbs, 'utf8'));
} catch (e) {
  coverageLost([`${BASELINE} is not valid JSON — ${e.message}`]);
}
const rows = baseline?.suites;
if (!rows || typeof rows !== 'object' || Array.isArray(rows)) coverageLost([`${BASELINE} has no \`suites\` object.`]);
for (const [name, n] of Object.entries(rows)) {
  if (!Number.isInteger(n) || n < 1) coverageLost([`${BASELINE} suites["${name}"] is ${JSON.stringify(n)}; a row is a positive integer, or it is removed.`]);
}

// ── judge ────────────────────────────────────────────────────────────────────
const problems = [];
let sites = 0;
let loopSuites = 0;
const measured = new Map();
for (const f of suites) {
  const found = loopCaseSites(readFileSync(join(testAbs, f), 'utf8'));
  if (found.length === 0) continue;
  measured.set(f, found);
  sites += found.length;
  loopSuites++;
}
const baselineTotal = Object.values(rows).reduce((a, n) => a + n, 0);
if (baselineTotal > 0 && sites === 0) {
  coverageLost([
    `read ${suites.length} suite(s) and found ZERO loop-wrapped case declarations, while ${BASELINE} records ${baselineTotal}.`,
    'Either every one was rewritten in the same change (then empty the baseline with it) or the detector stopped matching.',
  ]);
}
for (const [f, found] of measured) {
  const allowed = rows[f] ?? 0;
  if (found.length > allowed) {
    problems.push(
      `L1 ${TEST_DIR}/${f} declares test cases inside ${found.length} loop(s) (${found.map((s) => `${s.kind} at :${s.line}`).join(', ')}) ` +
        `and its baseline allows ${allowed}. A case generated by a loop is ONE declaration to coverage-manifest.json however many ` +
        'rows it iterates, so deleting a row deletes a case the ratchet cannot see. Write the new case as its own `test(`.',
    );
  }
}
for (const [f, allowed] of Object.entries(rows)) {
  if (!suites.includes(f)) {
    problems.push(`L3 ${BASELINE} names ${f}, which is not a suite in ${TEST_DIR}/. Remove the row.`);
    continue;
  }
  const n = measured.get(f)?.length ?? 0;
  if (n < allowed) {
    problems.push(
      `L2 ${TEST_DIR}/${f} now has ${n} loop-wrapped case declaration(s) and its baseline says ${allowed}. The baseline may only ` +
        `shrink — lower the row to ${n}${n === 0 ? ' by removing it' : ''} in the same change, or the next loop in this file is let in for free.`,
    );
  }
}

if (problems.length) {
  console.error(`✗ loop cases — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}
console.log(
  `ok  no new loop cases — ${sites} loop-wrapped case declaration(s) across ${loopSuites} of ${suites.length} suite(s), ` +
    `each within ${BASELINE} (which may only shrink)`,
);
