#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-provider-graph-acyclic.mjs — the CLASS of defect #258 was, not the
// instance it fixed.
//
// 🔴 WHAT SHIPPED. `platformRestClientProvider` took its bearer token as
// `ref.watch(authRepositoryProvider).currentAccessToken`, and
// `authRepositoryProvider`'s erasure closure does `ref.read(
// platformRestClientProvider)`. That pair is a CYCLE IN THE GRAPH: Riverpod's
// `ref.read` runs `_debugAssertCanDependOn`, which walks the TARGET's
// watch/listen ancestors and throws `CircularDependencyError` when it finds the
// reader. The delete button therefore threw before a request was ever formed —
// Cloudflare's zone analytics recorded zero `/v1/account` requests for the whole
// leg, not even a preflight.
//
// 🔴 AND IT IS AN `assert`, SO IT IS DEBUG-ONLY. `--release` strips the check and
// deletes accounts fine; every debug run and the whole `flutter drive` E2E (DDC)
// does not. That asymmetry is why this needs a STATIC guard rather than a test:
// the one build mode where the defect does not exist is the one users get, so
// production looked healthy for four days while the only automated proof of
// erasure could not go green.
//
// WHAT THIS ENFORCES, in one line:
//
//     for every  R --read--> T,  R must NOT be in ancestors*(T)
//
// where ancestors*(T) is the transitive closure of T's WATCH and LISTEN edges.
// `watch`/`listen` form ancestor edges; `read` does not — which is exactly why
// the repair was `ref.watch(authTokenProvider)`, a provider that only `read`s the
// repository, rather than moving the read later. Timing was never the problem.
//
// ⚠️ GREEN MEANS "NO CLOSED CYCLE", NOT "THE ANTI-PATTERN IS IMPOSSIBLE.
// `ref.watch(someRepositoryProvider).someTearOff` is still one edit away from
// closing a loop, and this guard says nothing about it while the loop is open —
// deliberately, because a guard that fired on every two-hop watch would fire on
// correct code and be switched off by whoever hit it next. The anti-pattern is
// argued against in the doc comments at the sites that matter; what is MECHANICAL
// here is the closed loop.
//
// ⚠️ IT DOES NOT LOOK FOR A WATCH-ONLY CYCLE (P watches Q, Q watches P). Not an
// oversight and not laziness: a watch-only cycle recurses until the stack ends,
// in EVERY build mode, on the first build. It cannot ship quietly, which is the
// entire property that made #258 expensive. This guard's subject is the failure
// that is invisible in the build users receive.
//
// 🔴 COMMENTS AND STRING LITERALS ARE STRIPPED BEFORE ANYTHING IS MATCHED, and
// that is load-bearing rather than tidy. The doc comments in
// apps/subly/lib/state/providers.dart SPELL THE CYCLE OUT IN PROSE — ":561",
// ":570-575" and ":747" all contain `ref.watch(authRepositoryProvider)` and
// `ref.read(...)` as the thing being warned against — so a scanner reading raw
// text would report the fixed tree as broken and stay red forever. Same shape as
// the `grep '"r2_buckets"'` that matched the comment explaining why there is no
// r2_buckets. The reduction is tooling/ci/text-reductions.mjs, shared, so this
// guard cannot disagree with its nine neighbours about what a comment is.
//
// 🔴 EDGES ARE COLLECTED PER PROVIDER SPAN, NEVER PER FILE. A `ref.watch` in a
// widget's `build` is a WidgetRef and forms no provider ancestor edge at all; a
// file-level scan would invent edges between every provider in a screen file and
// report cycles that cannot exist. The span is the balanced parenthesis run of
// the provider's own constructor call — which also means a `ref.read` nested
// inside a closure several levels down (`redirect:` in routerProvider,
// `requestServerDeletion:` in authRepositoryProvider) is attributed to the
// provider that owns the `Ref`, which is what Riverpod does too.
//
// A Notifier CLASS body is attributed to the NotifierProvider that constructs it,
// derived from the constructor's first type argument — not hand-listed, so a new
// controller acquires its edges by being wired to a provider.
//
// 🔴 A `ref.watch` INSIDE A LAZILY-INVOKED CLOSURE COUNTS AS AN EDGE HERE, AND
// RIVERPOD ONLY REGISTERS IT WHEN THE CLOSURE RUNS. That difference is the whole
// reason this guard earns its place beside the runtime witnesses in
// apps/subly/test/providers_test.dart. Measured 2026-08-09: with
// `authTokenProvider`'s inner `ref.read` flipped to `ref.watch`, EVERY runtime
// test stayed green — the token closure had simply not been called yet, so no
// dependency existed to be circular — while this guard failed and named the
// three-hop chain. The hazard is real and merely ORDER-DEPENDENT: the closure is
// invoked on every authenticated request, the edge registers then, and the next
// `ref.read` from the repository throws. Being conservative about a closure is
// therefore the correct reading, not an over-approximation, and it is the one
// class of this defect a test cannot reach.
//
// ── ITS RECORDED FAILING CASES (F-10), ALL FOUR MEASURED ON THE REAL TREE ─────
// Mutation-tested 2026-08-09 against apps/subly, `dart analyze` clean between
// each so a red result is a CAUGHT MUTATION and not a compile error:
//   1. revert #258 — `platformRestClientProvider`'s tokenProvider back to
//      `ref.watch(authRepositoryProvider).currentAccessToken`  → FAIL, chain
//      printed authRepository →read→ platformRestClient →watch→ authRepository.
//   2. `authTokenProvider`'s inner `ref.read` (providers.dart:603) changed to
//      `ref.watch`                                             → FAIL. That read
//      is the ONE edge keeping the repaired shape open; flipping it re-closes the
//      loop through the fix.
//   3. an added `ref.read(apiClientProvider)` inside `authRepositoryProvider`'s
//      closure                                                 → FAIL, which is
//      the direct proof that `apiClientProvider`'s own `ref.watch(
//      authRepositoryProvider)` tear-off was a live sibling of #258 and not a
//      style opinion. It is now `ref.watch(authTokenProvider)`.
//   4. fixtures (a)-(e) in tooling/ci/test/provider-graph-acyclic.test.mjs,
//      including a cycle that exists ONLY in a doc comment — which must stay
//      GREEN — and an empty directory, which must go RED.
//
// Usage:  node tooling/ci/assert-provider-graph-acyclic.mjs [repoRoot] [--graph]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments, stripStringLiterals } from './text-reductions.mjs';

const args = process.argv.slice(2).filter((a) => a !== '--graph');
const PRINT_GRAPH = process.argv.includes('--graph');
const ROOT = resolve(args[0] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

let failed = false;
const fail = (m) => { console.error(`FAIL ${m}`); failed = true; };
const ok = (m) => console.log(`ok   ${m}`);
const coverageLost = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

// ── what a tree is ──────────────────────────────────────────────────────────
// DERIVED, not listed: every `apps/*/lib` plus the brick template's own. A
// second stamped app acquires this guard by existing, the same way it acquires
// assert-seams-wired's coverage. apps/probe is excluded for the reason
// assert-seams-wired.mjs and assert-package-boundaries.mjs already exclude it —
// it is a gitignored local stamp, so scanning it makes the answer depend on
// whether somebody happened to run `mason make`.
const BRICK_LIB = join('tooling', 'bricks', 'app', '__brick__', 'apps', '{{app_id}}', 'lib');
const SKIP_DIR = new Set(['build', '.dart_tool', 'node_modules', 'test', 'integration_test']);
const SKIP_APP = new Set(['probe']);

function discoverTrees() {
  const trees = [];
  const appsDir = join(ROOT, 'apps');
  let apps = [];
  try { apps = listDir(appsDir); } catch { apps = []; }
  for (const app of apps.sort()) {
    if (SKIP_APP.has(app)) continue;
    const lib = join(appsDir, app, 'lib');
    try { if (statSync(lib).isDirectory()) trees.push({ id: `apps/${app}`, root: lib }); } catch { /* not an app */ }
  }
  const brick = join(ROOT, BRICK_LIB);
  try { if (statSync(brick).isDirectory()) trees.push({ id: 'brick/app', root: brick }); } catch { /* no brick */ }
  return trees;
}

function dartFiles(dir, out = []) {
  let entries;
  try { entries = listDir(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) {
      if (!SKIP_DIR.has(e)) dartFiles(p, out);
    } else if (e.endsWith('.dart')) {
      out.push(p);
    }
  }
  return out;
}

// ── the reduction ───────────────────────────────────────────────────────────
// Comments first, then string literals, both offset-preserving so a reported
// line number still points at the line somebody wrote. Mustache tags survive
// untouched — `{{app_id}}` carries no parenthesis and no `ref.` call, so the
// brick template is read exactly as the stamped file will be.
const reduce = (src) => stripStringLiterals(stripSourceComments(src, '.dart'));

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/** End of a balanced `(…)` run that OPENS at `start`, or -1. Quotes are already
 *  blanked by the reduction, so depth counting is enough here. */
function balanced(src, start, open = '(', close = ')') {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** End of a `<…>` type-argument run opening at `start`, or -1 if this `<` is not
 *  one. Bounded to a single logical run: a `;` or `(` before the brackets close
 *  means it was a comparison, not type arguments. */
function angles(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '<') depth++;
    else if (c === '>') {
      depth--;
      if (depth === 0) return i + 1;
    } else if (c === ';' || c === '{' || c === '}') return -1;
  }
  return -1;
}

/** Top-level comma split of a type-argument list, `<>` respected, so
 *  `<SubscriptionsController, List<Subscription>>` yields two parts. */
function typeArgs(text) {
  const inner = text.replace(/^</, '').replace(/>$/, '');
  const parts = [];
  let depth = 0;
  let buf = '';
  for (const c of inner) {
    if (c === '<') depth++;
    if (c === '>') depth--;
    if (c === ',' && depth === 0) { parts.push(buf.trim()); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

const IDENT_TAIL = /[A-Za-z0-9_$]/;

/** The identifier immediately before `i`, skipping whitespace. '' if none. */
function identBefore(src, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  let end = j + 1;
  while (j >= 0 && IDENT_TAIL.test(src[j])) j--;
  return src.slice(j + 1, end);
}

// A provider CONSTRUCTOR is any capitalised identifier ending in `Provider`.
// Derived rather than an enum of Riverpod's kinds: `StreamNotifierProvider` and
// whatever Riverpod adds next acquire coverage without an edit here, and the
// direction of error is the safe one — an over-broad match invents an extra
// declaration, which can only ever make this guard louder, never quieter.
//
// 🔴 THE SUFFIX IS TESTED IN JS, NOT IN THE PATTERN, AND THE FIRST DRAFT GOT IT
// WRONG. `/\b[A-Z][A-Za-z0-9_$]*Provider\b/` cannot match the bare identifier
// `Provider` — the leading `[A-Z]` consumes the `P`, so the literal suffix has
// only `rovider` left to match. It found every `NotifierProvider`,
// `FutureProvider` and `StreamProvider` and MISSED all 21 plain `Provider(`
// declarations across the two trees, including every one #258 was about. It was
// caught by limb 2 of the coverage self-check (18 providers parsed in the brick,
// floor 20) rather than by reading the regex — which is the whole argument for
// having a floor that is not zero.
const CAPITALISED = /\b([A-Z][A-Za-z0-9_$]*)/g;
const NOTIFIER_CLASS = /\bclass\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+extends\s+[A-Za-z_$][A-Za-z0-9_$.]*Notifier\s*</g;
// `ref.watch` / `ref.listen<T>` / `ref.read`, capturing only the LEADING
// identifier of the argument — which is how `.future`, `.notifier`,
// `.select((s) => s.x)` and a family call `fooProvider(arg)` all normalise onto
// the provider itself without a special case for any of them.
const REF_CALL = /\bref\s*\.\s*(watch|listen|read)\s*(?:<[^;()\n]*>)?\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)/g;

/** Every provider declaration in one reduced source, with its own span. */
function declarations(src) {
  const found = [];
  CAPITALISED.lastIndex = 0;
  let m;
  while ((m = CAPITALISED.exec(src)) !== null) {
    if (!m[1].endsWith('Provider')) continue;
    let i = m.index + m[0].length;
    let generics = '';
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] === '<') {
      const e = angles(src, i);
      if (e === -1) continue;
      generics = src.slice(i, e);
      i = e;
      while (i < src.length && /\s/.test(src[i])) i++;
    }
    // A type ANNOTATION (`final Provider<X> fooProvider = …`) is followed by an
    // identifier, never by `(`. Requiring the paren is what tells the two apart
    // without needing to know Dart's grammar.
    if (src[i] !== '(') continue;
    const end = balanced(src, i);
    if (end === -1) continue;
    // Walk back over `=` to the variable being declared. A constructor that is
    // an ARGUMENT rather than an initialiser (a test override, a nested build)
    // has no `=` behind it and is skipped.
    let j = m.index - 1;
    while (j >= 0 && /\s/.test(src[j])) j--;
    if (src[j] !== '=') continue;
    const name = identBefore(src, j);
    if (!name) continue;
    found.push({
      name,
      ctor: m[1],
      classArg: generics ? (typeArgs(generics)[0] ?? '') : '',
      start: i,
      end,
      declIndex: m.index,
    });
    CAPITALISED.lastIndex = end;
  }
  return found;
}

/** Every `class X extends …Notifier<…>` body in one reduced source. */
function notifierClasses(src) {
  const found = [];
  NOTIFIER_CLASS.lastIndex = 0;
  let m;
  while ((m = NOTIFIER_CLASS.exec(src)) !== null) {
    const brace = src.indexOf('{', m.index + m[0].length);
    if (brace === -1) continue;
    const end = balanced(src, brace, '{', '}');
    if (end === -1) continue;
    found.push({ className: m[1], start: brace, end });
    NOTIFIER_CLASS.lastIndex = end;
  }
  return found;
}

function refCalls(src, start, end) {
  const out = [];
  REF_CALL.lastIndex = start;
  let m;
  while ((m = REF_CALL.exec(src)) !== null && m.index < end) {
    out.push({ kind: m[1], target: m[2], index: m.index });
  }
  return out;
}

// ── build one tree's graph ──────────────────────────────────────────────────
function buildGraph(tree) {
  const files = dartFiles(tree.root);
  const providers = new Map(); // name → {file, line}
  const watch = new Map();     // name → Set(name)   (watch + listen: ancestor edges)
  const read = [];             // {from, to, file, line}
  const classToProvider = new Map();
  const perFile = [];

  for (const abs of files) {
    const rel = relative(ROOT, abs).split('\\').join('/');
    const src = reduce(readFileSync(abs, 'utf8'));
    perFile.push({ rel, src, decls: declarations(src), classes: notifierClasses(src) });
  }

  // Pass 1 — declarations, and the Notifier-class → provider map. Cross-file
  // within a tree: providers are top-level and imported by name, so the tree is
  // one namespace, which is what makes a cycle spanning two files visible at all.
  for (const f of perFile) {
    for (const d of f.decls) {
      if (!providers.has(d.name)) providers.set(d.name, { file: f.rel, line: lineOf(f.src, d.declIndex) });
      if (d.classArg) classToProvider.set(d.classArg, d.name);
    }
  }

  // Pass 2 — edges, per span.
  const addEdge = (owner, call, f, spanKind) => {
    if (call.kind === 'read') {
      read.push({ from: owner, to: call.target, file: f.rel, line: lineOf(f.src, call.index), spanKind });
    } else {
      if (!watch.has(owner)) watch.set(owner, new Set());
      watch.get(owner).add(call.target);
    }
  };
  let watchCount = 0;
  for (const f of perFile) {
    for (const d of f.decls) {
      for (const c of refCalls(f.src, d.start, d.end)) addEdge(d.name, c, f, 'provider');
    }
    for (const cl of f.classes) {
      const owner = classToProvider.get(cl.className);
      // A Notifier nothing constructs has no provider identity, so its edges
      // belong to nobody. Counted below so the coverage line can say so rather
      // than silently dropping it.
      if (!owner) continue;
      for (const c of refCalls(f.src, cl.start, cl.end)) addEdge(owner, c, f, 'notifier');
    }
  }
  for (const s of watch.values()) watchCount += s.size;

  return { files, providers, watch, read, watchCount, classToProvider };
}

/** The watch/listen ancestor path from `t` to `r`, or null. BFS so the printed
 *  chain is the SHORTEST one — a reader chasing a ten-hop path when a two-hop
 *  one exists is a reader who gives up. */
function ancestorPath(watch, t, r) {
  const prev = new Map([[t, null]]);
  const queue = [t];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of watch.get(cur) ?? []) {
      if (prev.has(next)) continue;
      prev.set(next, cur);
      if (next === r) {
        const chain = [];
        for (let n = next; n !== null && n !== undefined; n = prev.get(n)) chain.push(n);
        return chain.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

// ── run ─────────────────────────────────────────────────────────────────────
const trees = discoverTrees();

// COVERAGE SELF-CHECK, limb 1 — the tree set. Two trees exist today (apps/subly
// and the brick) and the brick is the one that matters most: it is the shape
// every future app is born with. A scan that reached one of them, or none, would
// pass every provider by finding nothing to contradict it.
const MIN_TREES = 2;
if (trees.length < MIN_TREES) {
  coverageLost([
    `found ${trees.length} provider tree(s) under ${ROOT}, expected >= ${MIN_TREES}.`,
    `Looked for every apps/*/lib and ${BRICK_LIB.split('\\').join('/')}.`,
    'The scan is broken, not the tree — a cycle guard over zero graphs prints ok forever.',
  ]);
}

// COVERAGE SELF-CHECK, limb 2 — per tree. A tree whose provider count collapses,
// or that yields no watch edge or no read edge, is a PARSE that stopped parsing:
// the rule below quantifies over read edges against watch ancestors, so either
// side reaching zero makes it vacuous while still printing a pass.
const MIN_PROVIDERS = 20;
const graphs = [];
for (const tree of trees) {
  const g = buildGraph(tree);
  graphs.push({ tree, g });
  if (g.providers.size < MIN_PROVIDERS) {
    coverageLost([
      `${tree.id} — parsed ${g.providers.size} provider declaration(s) from ${g.files.length} dart file(s), expected >= ${MIN_PROVIDERS}.`,
      'Every spine in this repo declares far more than that, so this is the declaration matcher failing,',
      'not a tree that shrank.',
    ]);
  }
  if (g.watchCount < 1 || g.read.length < 1) {
    coverageLost([
      `${tree.id} — ${g.watchCount} watch/listen edge(s) and ${g.read.length} read edge(s) from ${g.providers.size} provider(s).`,
      'The rule is "no read into a watch-ancestor". With no watch edges there are no ancestors and with no',
      'read edges there is nothing to test, so the check would be vacuously true over a real graph.',
    ]);
  }
}

if (PRINT_GRAPH) {
  for (const { tree, g } of graphs) {
    console.log(`── ${tree.id} — ${g.providers.size} providers, ${g.watchCount} watch/listen, ${g.read.length} read`);
    for (const [from, tos] of [...g.watch.entries()].sort()) console.log(`   ${from} --watch--> ${[...tos].sort().join(', ')}`);
    for (const r of g.read) console.log(`   ${r.from} --read--> ${r.to}   (${r.file}:${r.line})`);
  }
}

// ── THE RULE ────────────────────────────────────────────────────────────────
for (const { tree, g } of graphs) {
  let cycles = 0;
  let checked = 0;
  for (const edge of g.read) {
    // A read of something that is not a provider in this tree (a local, a
    // callback parameter shadowing the name) has no node to be an ancestor of.
    if (!g.providers.has(edge.to)) continue;
    checked++;
    if (edge.from === edge.to) {
      // Riverpod's own check treats self-read as circular too, and it needs no
      // ancestor walk to see it.
      cycles++;
      fail(
        `${tree.id} — ${edge.from} reads ITSELF at ${edge.file}:${edge.line}. ` +
          'CircularDependencyError, debug builds only.',
      );
      continue;
    }
    const chain = ancestorPath(g.watch, edge.to, edge.from);
    if (!chain) continue;
    cycles++;
    const where = g.providers.get(edge.from);
    fail(
      `${tree.id} — CIRCULAR PROVIDER DEPENDENCY. The chain that closes:\n` +
        `       ${edge.from} --read--> ${edge.to}        (${edge.file}:${edge.line})\n` +
        chain
          .slice(0, -1)
          .map((n, i) => `       ${n} --watch--> ${chain[i + 1]}`)
          .join('\n') +
        `\n     ${edge.from} is declared at ${where.file}:${where.line}. Riverpod's ref.read walks the TARGET's ` +
        'watch/listen ancestors and throws CircularDependencyError when it finds the reader, so this read ' +
        'throws EVERY time however late it happens — and it is an assert, so only in debug. Break an ' +
        'ancestor edge: watch a provider that READS the one you need (read registers no dependency), the ' +
        'way authTokenProvider stands between the REST clients and authRepositoryProvider.',
    );
  }
  if (cycles === 0) {
    ok(
      `${tree.id} — ${g.providers.size} provider(s), ${g.watchCount} watch/listen edge(s), ` +
        `${checked} read edge(s) into a known provider: none reads a provider that already has it as an ancestor`,
    );
  }
}

if (failed) {
  console.error('');
  console.error('  A provider cycle is DEBUG-ONLY (assert-wrapped), so release builds hide it and every');
  console.error('  test run and flutter drive E2E hits it. That asymmetry cost four days on #258.');
  process.exit(1);
}
