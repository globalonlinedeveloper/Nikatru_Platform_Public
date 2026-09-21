#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-test-clock-mix.mjs — a Worker test case may not pin a clock for the
// code under test while ALSO driving a real route, whose timestamps come from
// the wall clock and cannot be pinned.
//
// Register row: O-TEST-CLOCK-LITERAL-THE-WALL-CLOCK-REACHES, the CLASS half.
//
// ── WHY, AND WHY NOT THE OBVIOUS GUARD ───────────────────────────────────────
// services/platform/test/signup-erasure.test.ts drove the REAL DELETE /v1/account
// route — which stamps `created_at` and `next_attempt_at` from `Date.now()` —
// and then called `erasureRetry(env, NOW_MS)` with
// `NOW_MS = Date.parse('2026-09-20T06:00:00.000Z')`. While the wall clock stood
// BEFORE that instant the order was due and the case passed. At 06:00Z on
// 2026-09-20 the clock reached it, `dueOrders` stopped returning the order, the
// signup purge never ran, and the case asserting `person@example.com` had been
// erased failed — on `main`, in a file no branch had touched. Because the Worker
// job is in ci-gate, that one stale literal reddened every open PR (four red
// checks on #842, three of them unrelated to that branch).
//
// 🔴 A GUARD THAT BANS DATE LITERALS WOULD BE THE WRONG GUARD. Ten other pinned
// instants live in services/*/test today and every one of them is CORRECT: each
// compares only against timestamps seeded from the same pinned constant, so the
// relationship holds on every future day. A ban would red all of them, be waived
// within a week, and the class would be back. THE DEFECT IS THE MIX, NOT THE
// LITERAL — so what is asserted here is a RELATIONSHIP between two things inside
// one test case, not a pattern match on one of them.
//
// ── THE LIMB ─────────────────────────────────────────────────────────────────
//  L1  a single `it(` / `test(` case FAILS when its body contains BOTH
//      (a) a PINNED INSTANT handed to the code under test — an argument that is
//          exactly `Date.parse('<ISO>')`, `new Date('<ISO>')`, or an identifier
//          declared in the file whose initialiser is one of those (and which
//          mentions no `Date.now()`) — at a call whose callee is a binding
//          imported from a service's own `src/`; AND
//      (b) a REAL ROUTE DRIVE — `.request(` or `.fetch(` on a Hono app the file
//          assembled from a `src/routes/…` (or `src/index`) import, reached
//          either inline in the case or through a file-local helper it calls.
//      (a) says the test decided what "now" is. (b) says production code in the
//      same case decided what "now" is, by itself, from the wall clock. The two
//      answers drift apart at a fixed instant, and that instant is the fuse.
//
// ── EVERYTHING IS READ FROM CODE, NEVER FROM PROSE ───────────────────────────
// Every match runs over `codeMask` from tooling/ci/text-reductions.mjs, which
// blanks comments, string bodies, template text and regex literals. That is not
// a nicety here: the fixed signup-erasure.test.ts still SPELLS the old literal
// `Date.parse('2026-09-20T06:00:00.000Z')` in the comment that explains why it
// went, so a raw grep for that text reports the fixed file as the broken one.
// The string ARGUMENT of a `Date.parse(` call is read back out of the original
// bytes at the masked span the call opens — a parsed position, not a search.
//
// ── ⚠️ WHAT THIS CANNOT SEE, STATED PLAINLY ──────────────────────────────────
// This is NARROWER than the class in its register row, deliberately, because the
// narrow claim is the one that can be made honestly:
//  · (b) recognises a REAL ROUTE as the real-clock path. A plain src function
//    that stamps `Date.now()` internally, called directly, is NOT seen. Deciding
//    that statically needs per-function interprocedural clock analysis; the
//    module-level approximation was measured first and reddened SAFE siblings
//    (`nextAttemptDelayMs` is pure, but its module reads the clock), and a guard
//    that reds the safe files is a guard that gets deleted.
//  · (a) requires the pinned value to be a WHOLE argument. A pinned constant
//    forwarded into src code through a file-local helper's parameter, or buried
//    in an object literal property, is not seen. Tracking it needs dataflow that
//    over-tainted every safe file when it was measured (`raw = rcBody()` in
//    revenuecat-money.test.ts inherits the pin and then reaches the real route).
//  · Scope is approximated: a name declared outside every case is treated as
//    visible in all of them, and a case that RE-DECLARES that name shadows it.
//    `receipts.test.ts` declares `const now` twice — once `Date.now()`, once
//    `Date.parse('…')` — and the shadowing rule is what keeps the first honest.
//  · It says nothing about non-TypeScript suites, and nothing about a fixture
//    FILE holding a date the code compares against the wall clock (#838's shape).
//
// ── AND WHAT STOPS IT BECOMING AN ASSERTION THAT CANNOT FAIL ─────────────────
// The failure that costs everything is not this guard being wrong — it is this
// guard being edited into a matcher that never fires, after which every file
// reads clean and this limb prints ok forever. So the population itself is
// asserted, and each floor is COVERAGE LOST (exit 2), never a pass:
//  C1  zero test files under services/*/test              → the walk broke
//  C2  zero pinned instants anywhere in the corpus        → (a)'s matcher broke
//  C3  zero real route drives anywhere in the corpus      → (b)'s matcher broke
//  C4  no file that has BOTH a pinned instant and a route drive, in DIFFERENT
//      cases                                              → the co-location test
//      itself is doing no work; the tree can no longer tell L1 from a ban on
//      date literals, so a green here would mean nothing.
// C4 is the important one. It is satisfied today by three files, named on the
// ok line, and it is the reason a matcher mutated into one that cannot fire exits 2
// rather than 0.
//
// Usage:  node tooling/ci/assert-test-clock-mix.mjs [repoRoot]
// Exit 0 = clean. Exit 1 = a finding. Exit 2 = COVERAGE LOST.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, posix } from 'node:path';
import { listDir } from './tree-walk.mjs';
import { codeMask, NON_CODE } from './text-reductions.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());
const SERVICES = 'services';
const MASK = NON_CODE;

function coverageLost(lines) {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(2);
}

// ── the code-only projection ─────────────────────────────────────────────────
/** Source with every non-code byte (comment, string body, template text, regex
 *  literal) replaced by MASK, newlines kept — so offsets and line numbers
 *  survive and a masked run marks exactly where a literal stood. */
function codeOnly(text) {
  const m = codeMask(text);
  let out = '';
  for (let i = 0; i < text.length; i++) out += m[i] === NON_CODE ? (text[i] === '\n' ? '\n' : MASK) : text[i];
  return out;
}

const lineAt = (code, at) => code.slice(0, at).split('\n').length;

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

/** Top-level commas only — an argument list split into argument expressions,
 *  each carrying its own offset within `region` so a literal found inside one
 *  argument is never attributed to the argument beside it. */
function splitArgs(region) {
  const out = [];
  let depth = 0;
  let start = 0;
  const push = (a, b) => {
    if (region.slice(a, b).trim().length > 0) out.push({ text: region.slice(a, b), at: a });
  };
  for (let i = 0; i < region.length; i++) {
    const c = region[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      push(start, i);
      start = i + 1;
    }
  }
  push(start, region.length);
  return out;
}

/** An argument with TypeScript casts, `!`, and wrapping parens peeled off. */
function bareArg(arg) {
  let a = arg.trim();
  for (;;) {
    const was = a;
    a = a.replace(/\s+as\s+(?:const|unknown|[\w$.<>[\]|\s]+)$/, '').trim();
    a = a.replace(/!$/, '').trim();
    if (a.startsWith('(') && matching(a, 0, '(', ')') === a.length - 1) a = a.slice(1, -1).trim();
    if (a === was) return a;
  }
}

// ── (a) the pinned instant ───────────────────────────────────────────────────
const ISO_LITERAL = /^['"`]\s*\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}|['"`])/;
const CLOCK_CALL = /(?:^|[^.\w$])Date\s*\.\s*now\s*\(/;

/** The ORIGINAL bytes of the masked run beginning at `at` — a string literal's
 *  text, recovered at a position the parse found rather than by searching. */
function literalAt(text, code, at) {
  let j = at;
  while (j < code.length && code[j] === MASK) j++;
  return text.slice(at, j);
}

/** Does code[a,b) pin an instant to a date written into the source? */
function pinsAnInstant(text, code, a, b) {
  const region = code.slice(a, b);
  if (CLOCK_CALL.test(region)) return null;
  for (const m of region.matchAll(/(?:Date\s*\.\s*parse|new\s+Date)\s*\(\s*/g)) {
    const at = a + m.index + m[0].length;
    if (code[at] !== MASK) continue;
    const lit = literalAt(text, code, at);
    if (ISO_LITERAL.test(lit)) return lit.replace(/\s+/g, ' ');
  }
  return null;
}

/** Every `const|let|var NAME = <init>` in the file, with the init's span. */
function declarations(code) {
  const out = [];
  for (const m of code.matchAll(/(?:^|[^.\w$])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]*)?=/g)) {
    const start = m.index + m[0].length;
    let depth = 0;
    let i = start;
    for (; i < code.length; i++) {
      const c = code[i];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) {
        if (depth === 0) break;
        depth--;
      } else if (c === ';' && depth === 0) break;
    }
    out.push({ name: m[1], at: m.index, a: start, b: i });
  }
  return out;
}

// ── (b) the real route ───────────────────────────────────────────────────────
/** `import … from '<spec>'` — bindings paired with the specifier, read out of
 *  the original bytes at the masked span the `from` clause opens. */
function imports(text, code) {
  const out = [];
  for (const m of code.matchAll(/(?:^|[^.\w$])import\s+([^;]*?)\s+from\s+/g)) {
    const at = m.index + m[0].length;
    if (code[at] !== MASK) continue;
    const spec = literalAt(text, code, at).replace(/^['"`]|['"`]$/g, '');
    const clause = m[1];
    const names = [];
    const braced = clause.match(/\{([^}]*)\}/);
    if (braced) {
      for (const part of braced[1].split(',')) {
        const p = part.replace(/\btype\b/g, '').trim();
        if (!p) continue;
        const asName = p.match(/\bas\s+([A-Za-z_$][\w$]*)\s*$/);
        names.push(asName ? asName[1] : p.split(/\s+/)[0]);
      }
    }
    const ns = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (ns) names.push(ns[1]);
    const dflt = clause.replace(/\{[^}]*\}/g, '').replace(/\*\s+as\s+[A-Za-z_$][\w$]*/g, '').split(',')[0]?.replace(/\btype\b/g, '').trim();
    if (dflt && /^[A-Za-z_$][\w$]*$/.test(dflt)) names.push(dflt);
    for (const n of names) if (n) out.push({ name: n, spec });
  }
  return out;
}

/** A specifier that lands inside some service's own src/ — the code under test. */
const resolveSpec = (fileRel, spec) => (spec.startsWith('.') ? posix.normalize(posix.join(posix.dirname(fileRel), spec)) : null);
const isServiceSrc = (p) => p !== null && /^services\/[^/]+\/(?:src|.*\/src)\//.test(`${p}/`.replace(/\/+$/, '/'));
const isRouteModule = (p) => p !== null && /^services\/[^/]+\/src\/(?:routes\/|index(?:\.ts)?$)/.test(p);

// ── the walk ─────────────────────────────────────────────────────────────────
function walk(absDir, relDir, into) {
  for (const entry of listDir(absDir, { withFileTypes: true })) {
    const abs = join(absDir, entry.name);
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) walk(abs, rel, into);
    else if (entry.isFile() && /\.test\.tsx?$/.test(entry.name)) into.push(rel);
  }
}

const servicesAbs = join(ROOT, SERVICES);
if (!existsSync(servicesAbs) || !statSync(servicesAbs).isDirectory()) {
  coverageLost([`C1 ${SERVICES}/ does not exist under ${ROOT}; there is no Worker suite to read.`]);
}
const files = [];
for (const name of listDir(servicesAbs).sort()) {
  const testAbs = join(servicesAbs, name, 'test');
  if (existsSync(testAbs) && statSync(testAbs).isDirectory()) walk(testAbs, `${SERVICES}/${name}/test`, files);
}
files.sort();
if (files.length === 0) {
  coverageLost([`C1 no *.test.ts under ${SERVICES}/*/test; the walk is broken, not the tree.`]);
}

// ── read each file ───────────────────────────────────────────────────────────
const problems = [];
let pinnedFiles = 0;
let pinnedTotal = 0;
let driveFiles = 0;
let driveTotal = 0;
const bothFiles = [];

for (const rel of files) {
  const text = readFileSync(join(ROOT, rel), 'utf8');
  const code = codeOnly(text);

  // bindings imported from a service's own src/
  const srcNames = new Set();
  const routeNames = new Set();
  for (const im of imports(text, code)) {
    const p = resolveSpec(rel, im.spec);
    if (!isServiceSrc(p)) continue;
    srcNames.add(im.name);
    if (isRouteModule(p)) routeNames.add(im.name);
  }

  // Hono apps the file assembled from a route module, and the route bindings
  // themselves (a default-imported Worker entry is already an app).
  const apps = new Set(routeNames);
  for (let pass = 0; pass < 4; pass++) {
    const before = apps.size;
    for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*\.\s*(?:route|mount|use|all|get|post|put|patch|delete|on)\s*\(/g)) {
      const paren = m.index + m[0].length - 1;
      const cp = matching(code, paren, '(', ')');
      if (cp < 0) continue;
      const args = code.slice(paren + 1, cp);
      for (const r of apps) {
        if (new RegExp(`(?:^|[^.\\w$])${r}(?![\\w$])`).test(args)) {
          apps.add(m[1]);
          break;
        }
      }
    }
    if (apps.size === before) break;
  }

  // route drive sites: `<app>.request(` / `<app>.fetch(`
  const drives = [];
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*\.\s*(?:request|fetch)\s*\(/g)) {
    if (!apps.has(m[1])) continue;
    drives.push({ at: m.index, line: lineAt(code, m.index), via: m[1] });
  }

  // file-local helpers that reach a drive site, to a fixpoint
  const helperSpans = [];
  for (const m of code.matchAll(/(?:^|[^.\w$])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const paren = m.index + m[0].length - 1;
    const cp = matching(code, paren, '(', ')');
    if (cp < 0) continue;
    let j = cp + 1;
    while (j < code.length && /\s/.test(code[j])) j++;
    if (code[j] !== '{') continue;
    const end = matching(code, j, '{', '}');
    helperSpans.push({ name: m[1], a: m.index, b: end < 0 ? code.length : end + 1 });
  }
  for (const d of declarations(code)) helperSpans.push({ name: d.name, a: d.a, b: d.b });
  const drivers = new Set();
  for (let pass = 0; pass < 6; pass++) {
    const before = drivers.size;
    for (const h of helperSpans) {
      if (drivers.has(h.name)) continue;
      const body = code.slice(h.a, h.b);
      const hasDrive = drives.some((d) => d.at >= h.a && d.at < h.b);
      const callsDriver = [...drivers].some((n) => new RegExp(`(?:^|[^.\\w$])${n}\\s*\\(`).test(body));
      if (hasDrive || callsDriver) drivers.add(h.name);
    }
    if (drivers.size === before) break;
  }

  // pinned instants, and where each was declared
  const allDecls = declarations(code);
  const pinnedDecls = [];
  for (const d of allDecls) {
    const lit = pinsAnInstant(text, code, d.a, d.b);
    if (lit) pinnedDecls.push({ ...d, lit, line: lineAt(code, d.at) + (code[d.at] === '\n' ? 1 : 0) });
  }

  // test cases: the `it(`/`test(` head plus every consecutive argument group,
  // so `it.each(TABLE)(name, fn)` carries its body and not only its table.
  const cases = [];
  for (const m of code.matchAll(/(?:^|[^.\w$])(?:it|test)\s*(?:\.\s*[\w$]+\s*)*\(/g)) {
    let paren = m.index + m[0].length - 1;
    let end = matching(code, paren, '(', ')');
    if (end < 0) continue;
    const a = paren;
    for (;;) {
      let j = end + 1;
      while (j < code.length && /\s/.test(code[j])) j++;
      if (code[j] !== '(') break;
      const next = matching(code, j, '(', ')');
      if (next < 0) break;
      end = next;
    }
    cases.push({ a, b: end, line: lineAt(code, m.index) + (code[m.index] === '\n' ? 1 : 0) });
  }

  if (pinnedDecls.length) {
    pinnedFiles++;
    pinnedTotal += pinnedDecls.length;
  }
  if (drives.length) {
    driveFiles++;
    driveTotal += drives.length;
  }

  let mixedCases = 0;
  for (const c of cases) {
    const body = code.slice(c.a, c.b);
    // (b) — a real route driven in this case
    const inlineDrive = drives.find((d) => d.at >= c.a && d.at < c.b);
    const helperDrive = [...drivers].find((n) => new RegExp(`(?:^|[^.\\w$])${n}\\s*\\(`).test(body));
    if (!inlineDrive && !helperDrive) continue;

    // names visible as pinned here: declared outside every case, minus any the
    // case re-declares, plus the ones the case declares itself.
    const shadowed = new Set(
      allDecls.filter((d) => d.at >= c.a && d.at < c.b).map((d) => d.name),
    );
    const visible = new Map();
    for (const p of pinnedDecls) {
      const inThisCase = p.at >= c.a && p.at < c.b;
      const inAnyCase = cases.some((k) => p.at >= k.a && p.at < k.b);
      if (inThisCase) visible.set(p.name, p);
      else if (!inAnyCase && !shadowed.has(p.name)) visible.set(p.name, p);
    }

    // (a) — a pinned instant handed to a src binding as a WHOLE argument
    const handed = [];
    for (const m of body.matchAll(/([A-Za-z_$][\w$]*)\s*(?:\.\s*[A-Za-z_$][\w$]*\s*)?\(/g)) {
      if (!srcNames.has(m[1])) continue;
      const paren = c.a + m.index + m[0].length - 1;
      const cp = matching(code, paren, '(', ')');
      if (cp < 0 || cp > c.b) continue;
      for (const arg of splitArgs(code.slice(paren + 1, cp))) {
        const bare = bareArg(arg.text);
        const hit = visible.get(bare);
        if (hit) {
          handed.push({ callee: m[1], name: bare, lit: hit.lit, declLine: hit.line });
          continue;
        }
        // This ONE argument's own span — never the rest of the list, or a pin in
        // the argument beside it would be reported against this one.
        const argA = paren + 1 + arg.at;
        const inline = pinsAnInstant(text, code, argA, argA + arg.text.length);
        if (inline && /^(?:Date\s*\.\s*parse|new\s+Date)\s*\(/.test(bare)) {
          handed.push({ callee: m[1], name: bare.replace(/\s+/g, ' '), lit: inline, declLine: lineAt(code, argA) });
        }
      }
    }
    if (handed.length === 0) continue;

    mixedCases++;
    const h = handed[0];
    const driveLine = inlineDrive ? `:${inlineDrive.line}` : ` via ${helperDrive}()`;
    problems.push(
      `L1 ${rel}:${c.line} — this case hands the PINNED instant ${h.lit} to ${h.callee}(…) ` +
        `(as \`${h.name}\`, declared at :${h.declLine}) and in the same case drives the real route (${driveLine}), ` +
        'which stamps its own timestamps from the wall clock. The two clocks agree only until the wall clock reaches ' +
        'the literal; after that the case fails on main, in a file no branch touched, and the Worker job is in ci-gate ' +
        'so it reddens EVERY open PR. Derive the pinned value from the same clock the route used ' +
        '(e.g. `Date.now() + 24h` for "the night after"), or seed the route-stamped rows from the pinned constant. ' +
        'Do NOT move the literal forward — a later date is the same defect with a longer fuse.',
    );
  }
  if (pinnedDecls.length && drives.length && mixedCases === 0) bothFiles.push(rel);
}

// ── the population has to be real, or this limb proves nothing ───────────────
if (pinnedTotal === 0) {
  coverageLost([
    `C2 read ${files.length} test file(s) and found ZERO pinned instants.`,
    'Either every `Date.parse(\'<ISO>\')` / `new Date(\'<ISO>\')` constant left the suite in one change, or (a)\'s matcher stopped matching.',
  ]);
}
if (driveTotal === 0) {
  coverageLost([
    `C3 read ${files.length} test file(s) and found ZERO real route drives.`,
    'Either no suite drives a Hono app assembled from a src/routes module any more, or (b)\'s matcher stopped matching.',
  ]);
}
if (bothFiles.length === 0 && problems.length === 0) {
  coverageLost([
    `C4 no test file holds BOTH a pinned instant and a real route drive, so the co-location limb is doing no work.`,
    'A green verdict here would not distinguish this guard from a ban on date literals, which is the guard this one exists NOT to be.',
  ]);
}

if (problems.length) {
  console.error(`✗ test clock mix — ${problems.length} case(s) mix a pinned clock with the wall clock:`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('assert-test-clock-mix: FAILED');
  process.exit(1);
}

console.log(
  `ok  no test case mixes a pinned clock with a real route — ${files.length} test file(s) under ${SERVICES}/*/test, ` +
    `${pinnedTotal} pinned instant(s) in ${pinnedFiles} file(s), ${driveTotal} real route drive(s) in ${driveFiles} file(s); ` +
    `both present, in different cases, in ${bothFiles.length} file(s): ${bothFiles.join(', ')}`,
);
