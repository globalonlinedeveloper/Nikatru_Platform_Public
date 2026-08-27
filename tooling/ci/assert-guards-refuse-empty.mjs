#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-guards-refuse-empty.mjs — every guard is RUN against a tree with no
// subject in it, and must REFUSE.
//
// This is the limb assert-guard-coverage.mjs cannot reach. That guard requires
// every scanning guard to carry a `COVERAGE LOST` refusal IN CODE (comments
// stripped, with its own two-canary self-test). What a marker proves is that a
// refusal EXISTS. What nothing proved until now is that the refusal FIRES — that
// the guard, handed nothing to scan, actually takes that path instead of
// printing `ok` over an empty set. Those are different claims, and this
// repository's single most repeated defect lives in the gap between them:
// check-migrations.mjs silently dropped from 5 files to 4 and reported PASS;
// assert-clone-contract.mjs reported "no per-app D1 name appears" whether it had
// read 200 files or 0. Both carried a marker throughout.
//
// ── HOW, AND WHY IT IS RUN RATHER THAN READ ──────────────────────────────────
// A SUBJECT-FREE TREE is built in a temp directory: a real git repository
// containing the guard executables and the transitive closure of the modules
// they import, and NOTHING ELSE. No apps/, no packages/, no services/, no
// sites/, no .github/, no register JSON, no content. Every guard is then spawned
// with that tree as its root and its cwd, and must exit non-zero.
//
// The executables are COPIED IN rather than the real ones being pointed at a
// bare directory, because a third of them do not take a root argument at all —
// they derive it from `import.meta.url`. Measured 2026-08-17 on this tree: with
// only an argv root, the four signing guards, assert-deploy-triggers-deploy and
// four tooling/scripts executables all sailed past the empty root and re-scanned
// THE REAL REPOSITORY — android-signing printed `app "subly"`, and
// assert-deploy-triggers-deploy printed `11 workflow(s) scanned`, from a root
// that contained not one file. Twenty passed that way. Copying the executables
// into the tree moves `import.meta.url` with them, and the same probe leaves
// fourteen, every one of which is accounted for below.
//
// ── WHAT THIS DOES NOT CATCH, STATED UP FRONT ────────────────────────────────
// 🔴 A UNION FLOOR. A guard whose coverage floor is one count over several scope
// roots — `['apps', 'packages', 'tooling/bricks']` — refuses here, because the
// subject-free tree removes all three at once. It would still print ok on the
// real tree with apps/ and packages/ emptied and the brick template left
// standing. Measured 2026-08-17: assert-no-tls-pinning.mjs falls from 180
// scanned files to 22 and prints ok; assert-no-gate-weakening.mjs falls from 140
// to 26, notes that "117 tracked path(s) are not on disk and were skipped", and
// prints ok. Both refuse HERE. This probe answers "does the guard refuse when
// there is nothing at all", which is the weakest honest form of the question;
// the per-root form needs each guard to DECLARE its roots, and no generic
// mutator can derive which half of a union matters — that is a judgement about
// what the guard is for.
//
// 🔴 AND A RUNTIME TRACE WAS TRIED FIRST, AND FAILED SILENTLY. An fs-tracing
// preload that records every path a guard reads was built on 2026-08-17 to
// derive each guard's subject automatically. It reported "reads nothing" for
// assert-adapter-capabilities, assert-input-contract, assert-lint-inheritance
// and assert-no-hardcoded-strings while they visibly scanned 180+ files, because
// tree-walk.mjs's bounded directory listing goes through an async primitive in
// node:fs/promises and Node snapshots ESM named-export bindings for builtins
// before a CJS preload can patch them. An instrument that under-reports the
// subject yields a FALSE SAFE verdict, so a meta-guard built on it would be
// exactly the vacuous check it exists to prevent. Exit codes are used instead:
// coarser, and observed rather than inferred.
//
// ── THE ANTI-VACUITY LIMBS, BECAUSE THIS FILE IS THE ONE MOST AT RISK OF BEING
//    THE DEFECT IT HUNTS ─────────────────────────────────────────────────────
// A check that runs N guards and reports "all refuse" reports exactly the same
// sentence when N is zero, when the tree it built is secretly the real
// repository, and when every guard crashed on a missing import before reaching
// its own first line. So, on every run:
//
//   · the enumeration is floored per home AND cross-checked against `git
//     ls-files`, so hiding executables is caught twice;
//   · the number actually PROBED is floored, so classification cannot empty the
//     subject by growing the exemption lists;
//   · the built tree is asserted SUBJECT-FREE — if any product root appears in
//     it, every refusal below could be about the wrong thing;
//   · a module-resolution crash in any probe output is COVERAGE LOST, not a
//     refusal: a guard that dies on `import` never reached its coverage check,
//     and counting that as a refusal is how a broken harness reports health.
//     THIS ONE FIRED IN DEVELOPMENT. Copying only the two guard homes left 13
//     guards crashing with ERR_MODULE_NOT_FOUND, and every one of them was being
//     counted as a pass; that is why the tree carries the import closure.
//   · four CANARIES go through the same probe function as the real guards — a
//     synthetic guard that exits 0 must be FLAGGED, one that exits 1 must be
//     ACCEPTED, one that exits 0 declaring itself not-applicable must be
//     recognised as declaring, and one that exits 0 silently must not be.
//
// ── THE THREE CLASSIFICATIONS, AND WHICH ARE DERIVED ─────────────────────────
//   LIBRARY  — DERIVED, never listed: no `process.exit`/`process.argv` in its
//              executable lines AND at least one sibling imports it. It has no
//              main, so exiting 0 is what a module does. The two halves are both
//              required and disagreement is reported: a file with no main that
//              nothing imports is dead, and a file with a main is probed no
//              matter who imports it. (Measured: exactly the ten shared modules,
//              and the same set guard-sweep.mjs derives with the same rule.)
//   VACUOUS  — LISTED and dated, AND re-verified at runtime. Three executables
//              legitimately exit 0 with no subject, and all three SAY SO in
//              their output. The entry is only honoured while the guard still
//              prints its declaration; if it ever exits 0 SILENTLY the exemption
//              stops applying and this fails. If it starts refusing, the
//              exemption is stale and this fails too — a waiver that outlives
//              its reason is the thing being guarded against.
//   EXEMPT   — LISTED and dated. Six, each because RUNNING it is the problem,
//              not because its coverage is uninteresting. Kept expensive: an
//              entry naming a file this scan did not enumerate FAILS.
//
// Usage:  node tooling/ci/assert-guards-refuse-empty.mjs [repoRoot]
// Exit:   0 = every probed executable refused · 1 = one printed ok over nothing,
//         or the scan itself could not be trusted.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { stripStringLiterals } from './text-reductions.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/* The root is read AFTER the fixture flag is parsed, a few lines below, so that a
   bare positional path cannot quietly become a fixture root. See the block on
   `scanningRealRepo`: the two used to be the same decision and that is what made
   every floor optional. */
const rawRootArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const ROOT = resolve(rawRootArg ?? join(HERE, '..', '..'));

/** A caller pointing this at a fixture root is a different, weaker situation and
 *  says so out loud rather than pretending. But WEAKENING MUST BE ASKED FOR, NOT
 *  INFERRED.
 *
 *  🔴 THIS WAS `process.argv[2] === undefined` UNTIL 2026-08-17, AND THAT MADE
 *  EVERY ANTI-VACUITY FLOOR IN THIS FILE OPTIONAL BY ACCIDENT. Any stray
 *  positional argument — a path typed by hand, a wrapper passing `.`, a future
 *  `--verbose` landing in slot 2 — silently turned off MIN_EXECUTABLES, the
 *  per-home floors and the exemption-liveness checks, and the guard still
 *  printed its ok line. A guard-of-guards whose own floors can be disabled by an
 *  argument it does not recognise is precisely the defect it exists to hunt, and
 *  it shipped carrying it.
 *
 *  Now the fixture mode is an EXPLICIT, NAMED flag. An unrecognised positional
 *  argument no longer weakens anything — the floors stay on and the run refuses
 *  if the real homes are not there. Negative-tested both ways: `--fixture-root
 *  <path>` weakens and says so; a bare positional path does NOT. */
const FIXTURE_FLAG = '--fixture-root';
const fixtureIdx = process.argv.indexOf(FIXTURE_FLAG);
const scanningRealRepo = fixtureIdx === -1;

/** The homes. Both must exist and hold at least one executable in BOTH modes: a
 *  home that quietly disappeared would take its whole population out of the
 *  probe and leave the passing line reading exactly as it does now. */
const HOMES = ['tooling/ci', 'tooling/scripts'];

/** 🔴 STRUCTURALLY EXCLUDED, and not by exemption — by name, here, so it cannot
 *  be removed by deleting a list entry. Probing this file spawns a copy of it
 *  inside the subject-free tree, which builds another subject-free tree and
 *  spawns another copy. The recursion has no base case. */
const SELF = 'assert-guards-refuse-empty.mjs';

/** Crude, absolute, and openly the weakest limb here — its only job is "not
 *  zero-ish", and it exists because the `git ls-files` identity below cannot see
 *  a deletion that was also committed. Today: 131 and 9. */
const MIN_EXECUTABLES = { 'tooling/ci': 120, 'tooling/scripts': 8 };

/** The floor that matters most, because it is the one classification can eat.
 *  Every file moved into LIBRARY/VACUOUS/EXEMPT leaves the probed set, so a
 *  future maintainer could satisfy this guard by explaining every guard away.
 *  Today: 123 probed, of 140 enumerated. */
const MIN_PROBED = 110;

/** If any of these is inside the built tree, it is not subject-free and every
 *  refusal below could be a refusal about something else entirely.
 *
 *  ⚠️ `catalog` is listed because it is where the app catalogue lives since the
 *  inversion (`catalog/apps.json`). A catalogue surviving into the probe tree
 *  would hand every guard below a real app to find, so each would report on
 *  subly instead of refusing — and this file would print `ok` unchanged. A new
 *  top-level directory that holds product data belongs here the day it is
 *  created, not the day a refusal is discovered to be measuring the wrong tree. */
const PRODUCT_ROOTS = ['apps', 'catalog', 'packages', 'services', 'sites', 'docs', '.github', 'content'];

/** The tokens a legitimately-vacuous run prints. Membership in VACUOUS is by
 *  name AND the run must still print one of these — neither alone is enough. */
const DECLARATIONS = ['NOT APPLICABLE', 'UNREAD'];

/** A probe whose output carries one of these never reached the guard's own first
 *  line: the module loader failed. That is a broken harness, not a refusal. */
const LOAD_CRASH = ['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT', 'Cannot find module'];

/** Executables that legitimately exit 0 with no subject BECAUSE THEY SAY SO.
 *  Each is re-verified at runtime against DECLARATIONS above, so the entry
 *  cannot outlive the behaviour it describes in either direction. */
const VACUOUS = new Map([
  [
    'tooling/ci/assert-runner-budget.mjs',
    '2026-08-17 — the owner-gated half of the runner-budget check. With no billing token in the environment it prints `runner budget UNREAD` and exits 0 by design, because failing the build on a credential only the owner can supply blocks every unrelated change. The gap is PRINTED on every run, which is the repo\'s stated shape for an owner-gated capability, and it is the reason this entry is not a defect.',
  ],
  // 🔴 TWO ENTRIES WERE REMOVED HERE ON 2026-08-18, AND THIS GUARD IS WHY.
  // `tooling/scripts/assert-public-citations.mjs` and `tooling/scripts/spec-guards.mjs`
  // were both waived on 2026-08-17 for printing `NOT APPLICABLE` and exiting 0 when the
  // private corpus was absent. The corpus moved out of this repo to a sibling that day,
  // and both were rewritten to REFUSE (exit 2) naming every root they searched, because a
  // runner that cannot find its whole subject and exits 0 is the vacuous pass this file
  // exists to catch — it would have silently disarmed all seven spec guards.
  //
  // This guard caught the stale waivers on the first CI run after that change, with the
  // right verdict: "That is good news and a stale exemption". A waiver describing
  // behaviour a file no longer has is a lie that reads as diligence, so the entries are
  // DELETED rather than reworded. Recoverable from this file's history.
]);

/** Executables where RUNNING is itself the problem. Not "coverage does not
 *  apply" — every one of these would probably refuse — but a probe of them is an
 *  outward-facing act or an unbounded one. Adding to this list should feel
 *  expensive: an entry naming a file this scan did not enumerate FAILS below. */
const EXEMPT = new Map([
  [
    'tooling/scripts/guard-sweep.mjs',
    '2026-08-17 — a meta-runner: it invokes every executable in tooling/ci, which includes this one. Probing it means this guard spawns a sweep that spawns this guard inside a tree that contains it. Measured: it does not terminate within 25s even without the recursion.',
  ],
  [
    'tooling/scripts/preflight.mjs',
    '2026-08-17 — the other meta-runner, same shape and the same non-termination (measured, 25s timeout, no output). Its own coverage question is the union of the guards it runs, every one of which is probed here in its own right.',
  ],
  [
    'tooling/ci/record-deployment.mjs',
    '2026-08-17 — writes a GitHub Deployment record. It performs an outward act rather than scanning, so probing it means a guard POSTing to the real repository from inside CI if the environment scrub below ever misses a variable. The scrub is belt; this entry is braces.',
  ],
  [
    'tooling/scripts/install-hooks.mjs',
    '2026-08-17 — installs git hooks into a checkout. Probing it runs an installer inside CI. (Pointed at the subject-free tree it exits 2, `CANNOT RUN`, before touching anything — but a probe that is safe only because of where it happens to be pointed is not a safe probe.)',
  ],
  [
    'tooling/scripts/provision-backend.mjs',
    '2026-08-17 — provisions real cloud backends through wrangler. Same class as record-deployment: an outward act, and the one command the stamp checklist tells the owner to run.',
  ],
  [
    'tooling/ci/assert-walks-bounded.mjs',
    '2026-08-17 — its subject IS the guard corpus, which the subject-free tree must contain in order to probe anything at all. There is no arrangement of this probe in which its subject is empty, so a verdict here would be about the harness rather than the guard. It is also the one guard that already builds its own adversarial input: it creates a real nested checkout in a temp directory on every run and fails if the bounded listing returns anything from inside it.',
  ],
]);

/** Environment the probes must not see. A guard that finds a credential takes a
 *  different path (and may act on the world); a guard that finds GITHUB_* thinks
 *  it is in CI. Both make the probe's verdict depend on where it ran. */
const scrubbedEnv = () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(GITHUB_|GH_|CF_|CLOUDFLARE_|SUPABASE_|AWS_|NPM_|PADDLE_|GLITCHTIP_)/.test(key)) delete env[key];
  }
  return env;
};

const problems = [];

/** Structural failure — the scan itself is broken, so nothing below it means
 *  anything. Exits immediately rather than joining the problem list. */
const coverageLost = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

/** Executable lines only. A LINE-LEVEL filter, deliberately: the block-comment
 *  regex that looks right here ate this repo's import blocks twice, because a
 *  LINE comment that happens to contain a block-comment opener starts a block
 *  the reducer then closes sixty lines later, taking the imports with it.
 *  Over-discarding a continuation line is survivable; deleting real code is not. */
const codeLines = (src) =>
  src
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');

// ── ENUMERATE ────────────────────────────────────────────────────────────────
const executables = [];
for (const home of HOMES) {
  const abs = join(ROOT, home);
  if (!existsSync(abs)) {
    coverageLost([
      `${home} does not exist under ${ROOT}.`,
      'Both guard homes are enumerated on every run. A missing one takes its whole population out of the',
      'probe, and the passing line below would read exactly as it does now over the half that remained.',
    ]);
  }
  const found = listDir(abs)
    .filter((f) => f.endsWith('.mjs'))
    .sort();
  if (found.length === 0) {
    coverageLost([
      `${home} contains no .mjs file.`,
      'Every verdict below quantifies over this set; an empty one makes them all vacuously true.',
    ]);
  }
  for (const f of found) executables.push(`${home}/${f}`);
}

// SCAN vs MANIFEST — the assert-workflow-hardening pattern. `git ls-files` is
// the committed truth about which executables exist. A tracked one that is not
// on disk is coverage that has LEFT the tree, and it is invisible to a floor
// because the floor only counts what it found.
//
// Only that direction fails. An executable on disk that git does not track is a
// NEW guard being written — this file was exactly that for its first hour — and
// failing on it would make the guard hostile to the work it is part of.
const ls = spawnSync('git', ['-C', ROOT, 'ls-files', '--', ...HOMES], { encoding: 'utf8' });
const tracked =
  ls.status === 0
    ? [
        ...new Set(
          ls.stdout
            .split('\n')
            .map((l) => l.trim().replace(/\\/g, '/'))
            .filter((l) => l.endsWith('.mjs') && HOMES.some((h) => l.startsWith(`${h}/`) && !l.slice(h.length + 1).includes('/'))),
        ),
      ].sort()
    : [];
if (tracked.length === 0) {
  if (scanningRealRepo) {
    coverageLost([
      `\`git ls-files -- ${HOMES.join(' ')}\` returned no tracked executable under ${ROOT}.`,
      'The committed manifest is what makes "did I enumerate every guard" answerable. Without it this scan',
      'ranges over whatever happens to be on disk and still prints ok.',
    ]);
  }
} else {
  const unseen = tracked.filter((t) => !executables.includes(t));
  if (unseen.length) {
    coverageLost([
      `git tracks ${tracked.length} executable(s) in ${HOMES.join(' + ')} and this scan found ${executables.length}; it never saw:`,
      ...unseen.map((u) => `    ${u}`),
      'Each one takes its own probe with it. A guard that is not enumerated is not probed, and nothing else',
      'here would notice — which is this guard\'s own failure mode, applied to itself.',
    ]);
  }
}

if (scanningRealRepo) {
  for (const home of HOMES) {
    const n = executables.filter((e) => e.startsWith(`${home}/`)).length;
    const floor = MIN_EXECUTABLES[home];
    if (n < floor) {
      coverageLost([
        `${home} holds ${n} executable(s) and the floor is ${floor}.`,
        'This is the crude limb, and it is here for the one case the git identity above cannot see: a mass',
        'deletion that was also committed, where the manifest and the disk agree because both shrank.',
        'If the shrink is deliberate, lower the floor in the same change and say why.',
      ]);
    }
  }
}

// ── CLASSIFY ─────────────────────────────────────────────────────────────────
// LIBRARY is DERIVED from two independent signals that must agree. Neither alone
// is safe: "no main" alone would silently drop a real guard that happens to
// throw rather than exit, and "imported by someone" alone is false of
// release-manifest.mjs and assert-ops-register.mjs, which are imported AND are
// executables. Where they disagree, this says so rather than picking one.
const sourceOf = new Map(executables.map((rel) => [rel, readFileSync(join(ROOT, rel), 'utf8')]));
const importsFrom = (rel, src) => {
  const out = [];
  const dir = posix.dirname(rel.replace(/\\/g, '/'));
  const code = codeLines(src);
  // 🔴 STRING CONTEXT, ADDED 2026-08-27. Until today these three regexes read
  // the raw bytes, so text that only ever appears INSIDE A STRING LITERAL was
  // indistinguishable from a live import. It is not hypothetical and it is not
  // cheap: PR #397 added two fixture strings to a sibling guard, this matcher
  // read `from '../e2e/canary_subject.mjs'` out of one of them, `copyWithImports`
  // below demanded that path exist, and — this file being wired at ci.yml:1724,
  // which fires on every push — EVERY PUSH went red. #397 worked around it by
  // giving its fixtures a `#e2e/…` subpath specifier that can never be a
  // filesystem path, and recorded in its own commit message that the blindness
  // here was untouched and would bite the next time a guard-home source quoted a
  // relative import to a path that is not on disk. This is that fix.
  //
  // 🔴 AND IT IS NOT `stripStringLiterals(code)` FED TO THE MATCHER, which is the
  // obvious composition and is WRONG in the one way that reports clean: the path
  // this matcher needs LIVES INSIDE the literal, so matching over the stripped
  // text finds `from '          '` and every real import silently disappears.
  // That composition is exactly what #397 rejected for the sibling. What is used
  // instead is the same reduction as an OFFSET-PRESERVING CONTEXT ORACLE — it
  // replaces literal contents with spaces and never deletes, so `stripped[i]`
  // still describes `code[i]` — while the regexes go on reading the ORIGINAL
  // bytes. The stripped text answers "where am I", never "what does it say".
  //
  // ⬜ NAMED AND NOT CLOSED — this oracle is STRICTLY WEAKER than `codeMask` in
  // assert-guard-coverage.mjs:1135, which is the repo's real answer to this
  // question and already carries its own canaries. `codeMask` also understands
  // TEMPLATE LITERALS, line/block comments mid-line, and regex literals; this
  // one knows only `'…'` and "…". A fixture written in backticks is therefore
  // STILL read as live code here. `codeMask` was NOT IMPORTED because it is not
  // exported — assert-guard-coverage.mjs carries no `export` statement at all —
  // and that file was owned by another change in flight, so an export could not
  // be added from here. A rival copy of the lexer was refused: a second reader of
  // the same thing that quietly stops reading what it thinks it reads is this
  // repository's most repeated defect, and the sibling's copy already has
  // canaries this one would not inherit. The unblock is one line there,
  // `export { codeMask, NON_CODE };` (better: move both beside
  // stripStringLiterals in text-reductions.mjs, where the other shared
  // reductions live), after which the two lines below become
  // `const mask = codeMask(code)` / `mask[i] !== NON_CODE`, the canary below
  // keeps holding them, and the backtick residue closes with them.
  //
  // ⬜ The other direction this oracle can be wrong, named because it is the
  // DANGEROUS one: a lone apostrophe on a code line (`// don't` after code, a
  // `['"]` character class in a regex literal) can open a span that blanks a
  // REAL import sharing that line, and the module would then be missing from the
  // built tree. That failure is LOUD, not silent — the probe dies in the loader
  // and the crash limb below reports it as a broken harness rather than counting
  // it as a refusal. Measured over the real corpus the day this landed: 154
  // files, 361 edges, derived import set byte-identical to the ungated matcher.
  const outsideLiterals = stripStringLiterals(code);
  /** A byte the reduction did NOT blank. Blanking only ever turns a non-space
   *  into a space, so equality is exactly "not inside a literal" for the
   *  non-space bytes every match below starts on. */
  const isCode = (i) => outsideLiterals[i] === code[i];
  // Three spellings. The third — a bare side-effect `import './x.mjs';` with no
  // `from` — was missing until the suite caught it: the module never reached the
  // built tree, the guard died in the loader, and only the load-crash limb below
  // stopped that being counted as a refusal. A missed edge here is not silent,
  // but it does turn a runnable guard into an unrunnable one.
  for (const re of [
    /from\s*['"](\.[^'"]+)['"]/g,
    /import\(\s*['"](\.[^'"]+)['"]\s*\)/g,
    /(?:^|[;\n])\s*import\s+['"](\.[^'"]+)['"]/g,
  ]) {
    for (const m of code.matchAll(re)) {
      // The FIRST BYTE of the match, the idiom this repo already uses at
      // assert-guard-coverage.mjs:1243 — a match that STARTS inside a literal is
      // a shape being quoted, not one being imported.
      if (!isCode(m.index)) continue;
      if (!/\.(mjs|js)$/.test(m[1])) continue;
      out.push(posix.normalize(posix.join(dir, m[1])));
    }
  }
  return out;
};

// ── the matcher's OWN negative test, run on every invocation ─────────────────
// The pair the gate above exists for: THE SAME IMPORT STATEMENT, once inside a
// string literal and once as code. They do not differ in SHAPE, so nothing but
// the offsets can separate them — a matcher that regressed to reading the raw
// bytes would credit both and this file would go back to reddening CI over a
// path nobody imports. The quoted one carries an astral character; that is what
// gives the length check something to fail on, because an oracle built per CODE
// POINT is shorter than its input and every offset past it is then wrong.
//
// 🔴 THESE TWO CONSTANTS ARE ALSO THE LIVE FAILING CASE, and that is the point.
// This file is itself a guard-home source: it is enumerated, its source is read
// into `sourceOf`, and `copyWithImports` walks its imports. So the quoted canary
// is a real quoted-only relative import sitting in the real corpus — delete the
// `isCode` line above and this guard reddens on its own source with no fixture
// anywhere in the loop. #397 recorded that five of its six new gates had no
// failing case in this repository; this one does.
const CANARY_IMPORT_QUOTED = [
  'const fixture = "\u{1F534} import subject from \'../probe/canary-subject.mjs\';";',
  'writeFileSync(join(root, generated), fixture);',
  '',
].join('\n');
const CANARY_IMPORT_REAL = [
  "import subject from '../probe/canary-subject.mjs';",
  'subject.check();',
  '',
].join('\n');
const canaryImports = (t) => importsFrom('tooling/ci/canary.mjs', t);
const canaryQuoted = canaryImports(CANARY_IMPORT_QUOTED);
const canaryReal = canaryImports(CANARY_IMPORT_REAL);
const canaryOracleLen = stripStringLiterals(CANARY_IMPORT_QUOTED).length;
if (canaryQuoted.length !== 0 || canaryReal.length !== 1 || canaryOracleLen !== CANARY_IMPORT_QUOTED.length) {
  coverageLost([
    'the import matcher no longer distinguishes an import that is MADE from one that is merely QUOTED.',
    `An import written INSIDE A STRING yielded [${canaryQuoted.join(', ')}] (must be empty) and the same`,
    `import written as code yielded [${canaryReal.join(', ')}] (must be exactly one path).`,
    `The context oracle measured ${canaryOracleLen} over a ${CANARY_IMPORT_QUOTED.length}-char fixture (must be`,
    'EQUAL — it carries an astral character, and an oracle that is not offset-preserving misaligns every',
    'lookup past it, which reads as "everything is code" or "nothing is").',
    'Until this holds, the transitive closure below is derived from text nobody imports: a quoted path that',
    'is not on disk fails this guard on every push (it did, before #397 worked around it), and a quoted path',
    'that IS on disk silently promotes a dead module to a library that nothing has to probe.',
  ]);
}
const importedBy = new Map();
for (const [rel, src] of sourceOf) {
  for (const target of importsFrom(rel, src)) {
    importedBy.set(target, (importedBy.get(target) ?? 0) + 1);
  }
}

const libraries = [];
const probed = [];
// COUNTED, not assumed to be 1. This file is absent from a checkout of any
// commit before it landed, and printing "1 self-excluded" over a tree that holds
// none of it is the same class of stale prose the counts below exist to replace.
const selfExcluded = executables.filter((rel) => rel.endsWith(`/${SELF}`)).length;
for (const rel of executables) {
  if (rel.endsWith(`/${SELF}`)) continue;
  const hasMain = /process\.(exit|argv)/.test(codeLines(sourceOf.get(rel)));
  const imported = (importedBy.get(rel) ?? 0) > 0;
  if (!hasMain && imported) {
    libraries.push(rel);
    continue;
  }
  if (!hasMain && !imported) {
    problems.push(
      `${rel} — has no main (no process.exit/argv in executable code) and nothing imports it. It cannot ` +
        'refuse anything because it never runs, and it cannot be a shared module because it is shared with ' +
        'nobody. Wire it up or delete it; classifying it here would be an exemption for a dead file.',
    );
    continue;
  }
  if (EXEMPT.has(rel)) continue;
  probed.push(rel);
}

// The exemption lists' own self-check: an entry naming a file this scan did not
// enumerate sits there looking like a considered exception while covering
// nothing. REAL-REPO ONLY, because the entries name THIS repository's paths and
// a fixture root legitimately has none of them — firing there would force every
// fixture to model the whole exemption list to say anything about anything else.
if (scanningRealRepo) {
  for (const [rel, why] of [...EXEMPT, ...VACUOUS]) {
    if (!executables.includes(rel)) {
      problems.push(
        `${rel} is excused ("${why.slice(0, 60)}…") and this scan did not enumerate it. Either it moved and ` +
          'the entry did not follow, or it is retired and the entry should have gone with it. An exception ' +
          'for something that is not there reports judgement over nothing.',
      );
    }
  }
  if (probed.length < MIN_PROBED) {
    coverageLost([
      `${probed.length} executable(s) would be probed and the floor is ${MIN_PROBED}.`,
      `Enumerated ${executables.length}; ${libraries.length} derived as libraries, ${EXEMPT.size} exempt, ${selfExcluded} self.`,
      'Classification is the one thing that can empty this guard\'s subject without deleting a single file:',
      'every entry added to a list below leaves the probed set. This floor is what makes that visible.',
    ]);
  }
}

// ── BUILD THE SUBJECT-FREE TREE ──────────────────────────────────────────────
// Copied file by file — never a recursive directory copy — so what lands in the
// tree is exactly what was enumerated plus what it imports, and a `test/`
// fixture or a stray checkout cannot arrive by accident.
const TREE = mkdtempSync(join(tmpdir(), 'guards-refuse-empty-'));
/** 🔴 AN `exit` HOOK, BECAUSE THE `finally` AT THE END OF THIS FILE IS NOT
 *  ENOUGH ON ITS OWN. Every structural failure below reaches `coverageLost`,
 *  which calls `process.exit` — and `process.exit` does NOT run a pending
 *  `finally`. With cleanup in the `finally` alone, one ~150-file tree was left in
 *  the system temp directory for every COVERAGE LOST run: nine of them
 *  accumulated during this file's own negative testing, unnoticed, because the
 *  guard's verdict was correct each time and only the litter was wrong. Both are
 *  kept — the hook covers the exit paths, the `finally` covers the throw — and
 *  `rmSync` being synchronous is what makes it usable in a hook at all. */
process.on('exit', () => rmSync(TREE, { recursive: true, force: true }));
let exitCode = 0;
try {
  const copied = new Set();
  const copyWithImports = (rel) => {
    if (copied.has(rel)) return;
    const from = join(ROOT, rel);
    if (!existsSync(from)) {
      coverageLost([
        `${rel} is imported by something in the guard homes and is not on disk.`,
        'The subject-free tree would be missing a module, so every guard that imports it would die in the',
        'loader and be counted as a refusal it never made.',
      ]);
    }
    copied.add(rel);
    const to = join(TREE, rel);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    const src = sourceOf.get(rel) ?? readFileSync(from, 'utf8');
    for (const target of importsFrom(rel, src)) copyWithImports(target);
  };
  for (const rel of executables) copyWithImports(rel);

  // A real git repository, because a third of these guards ask `git ls-files`
  // what the tree contains and answer COVERAGE LOST when it answers nothing.
  // The index must therefore list the copied executables and nothing else.
  const git = (...args) => spawnSync('git', ['-C', TREE, ...args], { encoding: 'utf8' });
  if (git('init', '-q', '-b', 'probe').status !== 0) {
    coverageLost([
      `\`git init\` failed inside ${TREE}.`,
      'Guards that enumerate through git would report an empty tree for the wrong reason, and this guard',
      'would read every one of those as a refusal.',
    ]);
  }
  git('add', '-A');
  git('-c', 'user.email=probe@localhost', '-c', 'user.name=probe', 'commit', '-q', '--no-verify', '-m', 'subject-free');

  // 🔴 THE TREE MUST BE SUBJECT-FREE, AND THIS IS WHERE THAT IS PROVEN RATHER
  // THAN ASSUMED. If a future edit copied a directory instead of a file list —
  // or resolved ROOT into the tree — every guard below would find a full
  // repository, refuse nothing, and this file would print `ok` in the exact
  // words it prints today. That is the defect this guard exists to catch,
  // occurring inside the guard itself.
  const leaked = PRODUCT_ROOTS.filter((r) => existsSync(join(TREE, r)));
  if (leaked.length) {
    coverageLost([
      `the tree built at ${TREE} is not subject-free: it contains ${leaked.join(', ')}.`,
      'Every refusal below would then be a refusal about a tree that has subjects in it, which proves',
      'nothing at all about what a guard does when its subject is gone.',
    ]);
  }
  for (const rel of probed) {
    if (!existsSync(join(TREE, rel))) {
      coverageLost([
        `${rel} was classified for probing and is not in the built tree.`,
        'It would be spawned from a path that does not exist, and the failure to start would read as a refusal.',
      ]);
    }
  }

  // ── THE PROBE ──────────────────────────────────────────────────────────────
  // One function, used for the real executables AND for the canaries, so the
  // canaries prove something about the path actually taken. A pool because the
  // sequential form measured 92s on this tree and a guard nobody waits for is a
  // guard somebody skips.
  const PARALLEL = 6;
  /** 60s against a slowest-probed-executable of 1.3s (measured 2026-08-17), so
   *  the margin is ~45×. Overridable ONLY so the timeout branch below has a
   *  recorded failing case — a guard that hangs cannot be modelled in under a
   *  minute otherwise, and a branch nobody can make fire is decoration. Clamped,
   *  because the override's failure directions are not symmetric: too LOW turns
   *  healthy guards into loud, obviously-wrong problems, while too HIGH would
   *  let a hung probe hold a CI job open, which is the failure nobody sees. */
  const PROBE_TIMEOUT_MS = Math.min(
    120_000,
    Math.max(1_000, Number(process.env.GUARDS_REFUSE_EMPTY_TIMEOUT_MS ?? 60_000) || 60_000),
  );
  const run = (absPath) =>
    new Promise((settle) => {
      const child = spawn(process.execPath, [absPath], { cwd: TREE, env: scrubbedEnv() });
      let out = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, PROBE_TIMEOUT_MS);
      child.stdout.on('data', (d) => {
        out += d;
      });
      child.stderr.on('data', (d) => {
        out += d;
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        settle({ code: null, timedOut, out: `spawn failed: ${e.message}` });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        settle({ code, timedOut, out: out.slice(0, 4000) });
      });
    });

  const runAll = async (jobs) => {
    const results = new Array(jobs.length);
    let next = 0;
    const worker = async () => {
      for (let i = next++; i < jobs.length; i = next++) results[i] = await run(jobs[i]);
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, jobs.length) }, worker));
    return results;
  };

  // ── THE CANARIES, through the same `run` above ─────────────────────────────
  // Written outside both homes so nothing enumerating the tree mistakes them for
  // guards. Each states the reading it must produce; if the probe stops being
  // able to tell 0 from 1, or a declaration from silence, every verdict below is
  // decoration and this must not be the run that discovers it.
  const CANARIES = [
    ['canary-passes.mjs', "console.log('ok  nothing to do');\n", { code: 0, declares: false }],
    ['canary-refuses.mjs', "console.error('x COVERAGE LOST');\nprocess.exit(1);\n", { code: 1, declares: false }],
    ['canary-declares.mjs', `console.log('${DECLARATIONS[0]} — no subject here');\n`, { code: 0, declares: true }],
    ['canary-silent.mjs', 'process.exitCode = 0;\n', { code: 0, declares: false }],
  ];
  mkdirSync(join(TREE, 'tooling', 'canary'), { recursive: true });
  for (const [name, body] of CANARIES) writeFileSync(join(TREE, 'tooling', 'canary', name), body);
  const declares = (out) => DECLARATIONS.some((d) => out.includes(d));
  const canaryResults = await runAll(CANARIES.map(([name]) => join(TREE, 'tooling', 'canary', name)));
  for (const [i, [name, , expected]] of CANARIES.entries()) {
    const got = canaryResults[i];
    if (got.code !== expected.code || declares(got.out) !== expected.declares) {
      coverageLost([
        `the probe's own canary ${name} came out wrong: exit ${got.code} (expected ${expected.code}), ` +
          `declares ${declares(got.out)} (expected ${expected.declares}).`,
        'The probe can no longer tell a guard that passed over nothing from one that refused, or a declared',
        'not-applicable from silence. Every verdict this file prints rests on that distinction, so nothing',
        'below is reported until it holds again.',
      ]);
    }
  }

  // ── PROBE THE REAL EXECUTABLES ─────────────────────────────────────────────
  const results = await runAll(probed.map((rel) => join(TREE, rel)));
  const crashed = [];
  const passedOverNothing = [];
  const vacuousDeclared = [];
  let refused = 0;
  for (const [i, rel] of probed.entries()) {
    const { code, timedOut, out } = results[i];
    if (LOAD_CRASH.some((m) => out.includes(m))) {
      crashed.push(`${rel} — ${out.split('\n').filter(Boolean).slice(0, 2).join(' | ').slice(0, 160)}`);
      continue;
    }
    if (timedOut) {
      problems.push(
        `${rel} — did not terminate within ${PROBE_TIMEOUT_MS / 1000}s against a tree with no subject. ` +
          'A guard that hangs on an empty tree has neither passed nor refused, and in CI it is a red build ' +
          'nobody can read.',
      );
      continue;
    }
    const isVacuous = VACUOUS.has(rel);
    if (code !== 0) {
      if (isVacuous) {
        problems.push(
          `${rel} is listed as legitimately vacuous and it REFUSED (exit ${code}) over an empty tree. ` +
            'That is good news and a stale exemption: it now carries a real floor, so remove its entry ' +
            'rather than leave a waiver describing behaviour the file no longer has.',
        );
      } else {
        refused++;
      }
      continue;
    }
    if (isVacuous && declares(out)) {
      vacuousDeclared.push(`${rel} — ${out.split('\n').filter(Boolean)[0]?.trim().slice(0, 120) ?? ''}`);
      continue;
    }
    if (isVacuous) {
      problems.push(
        `${rel} is listed as legitimately vacuous BECAUSE IT SAYS SO, and it exited 0 without saying so ` +
          `(nothing in its output matched ${DECLARATIONS.map((d) => `"${d}"`).join(' or ')}). A silent pass over ` +
          'nothing is the defect; the declaration was the whole reason the exemption was acceptable.',
      );
      continue;
    }
    passedOverNothing.push(
      `${rel} — exit 0 over a tree with no apps, no packages, no services, no sites, no workflows and no ` +
        `registers. It printed: ${out.split('\n').filter(Boolean)[0]?.trim().slice(0, 140) ?? '(nothing at all)'}`,
    );
  }

  if (crashed.length) {
    coverageLost([
      `${crashed.length} probe(s) died in the module loader instead of running:`,
      ...crashed.map((c) => `    ${c}`),
      'A guard that cannot load never reached its own coverage check, so counting these as refusals would',
      'inflate this guard\'s verdict by exactly the number of guards it failed to test. The tree carries the',
      'transitive import closure for this reason; something now imports a path outside it.',
    ]);
  }

  for (const p of passedOverNothing) {
    problems.push(
      `${p}\n      Nothing it claims to check was there. Give it a floor over its own subject that fails at ` +
        'zero — or, if exiting 0 with no subject is genuinely correct, make it SAY so and record it in ' +
        'VACUOUS with a date and a reason that survives being read aloud.',
    );
  }

  if (problems.length) {
    console.error(`✗ guards refuse empty — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`    ${p}`);
    console.error('');
    console.error('  A guard that passes over an empty subject has checked nothing, and it prints the same');
    console.error('  reassuring line whether it read two hundred files or none. That is the most repeated');
    console.error('  defect in this repository, and the marker every guard carries proves only that a');
    console.error('  refusal EXISTS — never that it fires.');
    exitCode = 1;
  } else {
    if (vacuousDeclared.length) {
      console.log('⬜ exited 0 with no subject and DECLARED it — printed, never hidden:');
      for (const v of vacuousDeclared) console.log(`    ${v}`);
    }
    console.log('⬜ not probed, with a recorded reason:');
    for (const [rel, why] of EXEMPT) console.log(`    ${rel} — ${why.split('—').slice(1).join('—').trim().slice(0, 150)}`);
    console.log(
      `ok  guards refuse empty — ${refused} of ${probed.length} probed executable(s) refused a tree with no ` +
        `subject in it; ${vacuousDeclared.length} exited 0 and declared why. ${executables.length} enumerated ` +
        `across ${HOMES.join(' + ')} (${tracked.length} tracked), ${libraries.length} derived as libraries with ` +
        `no main, ${EXEMPT.size} exempt, ${selfExcluded} self-excluded. Private/requirements/tooling is deliberately out of ` +
        'scope: it is not in the public checkout, so a probe of it would pass by finding nothing.',
    );
  }
} finally {
  rmSync(TREE, { recursive: true, force: true });
}
process.exit(exitCode);
