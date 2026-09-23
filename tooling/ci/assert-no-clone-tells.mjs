#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-no-clone-tells.mjs — shared code must not know which app it is in.
//
// [pipeline C-10] "Shared code carries no app-specific vocabulary."
//
// Named by C-10 as its enforcement; marked VERIFIED while it did not exist.
// The moment shared code says "if this is Subly…", it stops being shared: app #2
// inherits a rule about a product it is not, and app #50 inherits it fifty times.
// It is also the tell a store reviewer reads as "these are the same app".
//
// 🔴 COMMENTS ARE EXEMPT, CODE IS SCANNED — and that is not a loophole, it is the
// difference between a guard that survives and one that gets switched off. Real
// measurement 2026-07-28: shared code mentions "Subly" EIGHT times and every
// single one is a comment, including one that records that a hardcoded 'subscriptiontracker'
// value WAS found and removed. Scanning comments would fire 8 false alarms on
// day one, all correct-as-written; a guard that cries wolf is disabled within a
// week, and then you believe you are protected when you are not.
//
// The app names are DERIVED from apps/ on disk, never typed here — a hand-kept
// list would go stale the first time an app is added, and go stale silently.
//
// LIMB 3 ("the brick's seed_hex default must not equal a live app's brand
// colour") is NOT IMPLEMENTED, and the reason is recorded rather than hidden:
// its premise is false. `tooling/bricks/app/brick.yaml` declares seed_hex as a
// PROMPT with type/description/prompt and NO `default:` — so there is no default
// value that could collide with anything. Verified 2026-07-28. The real issue in
// that area is that `AppThemeX.light/.dark` are compile-time constants holding
// Subly's brand values, which is [2]C-11's fix (the seed must drive what is
// painted), not a vocabulary problem. Recorded as SUPERSEDED BY FACTS.
//
// Checks:
//   1. coverage self-check — apps were found, and shared source was scanned
//   2. no app name appears in shared CODE (comments stripped first)
//   3. no banned domain noun appears in shared CODE, from a list that must exist
//      and must NOT be empty — an empty list passes everything, silently, forever
//
// ── [ADR 070] ONE DERIVED EXCEPTION, AND IT IS NOT AN ALLOWLIST ──────────────
// A banned DOMAIN NOUN in a `packages/*/lib` file is not a clone tell when that
// file is GENERATED from a file under `contracts/` which itself contains the
// same token. `contracts/` is by definition "the things more than one runtime
// has to agree about", so a word that is in a contract is portfolio-wide by
// construction — which is a fact about the tree, not a judgement typed here.
//
// The conflict this settles was latent before it was hit: [pipeline C-10] bans
// `subscription` because Subly is a subscription tracker, while [pipeline 5]M-3
// makes the revocation-reason set permanent in
// services/platform/migrations/0004_money_rail.sql — and two of its eight
// members are `subscription_expired` and `subscription_paused`. The generated
// Dart mirror of that contract is the one machine-made transcription of it.
//
// FOUR INDEPENDENT FACTS MUST ALL HOLD, each read from the tree at run time:
//   a) the file's own LEADING comment block says GENERATED and names a path
//      under contracts/ that EXISTS on disk;
//   b) a generator under contracts/ names that file's repo-relative path as its
//      output — so the file really is written by machine, rather than merely
//      described as such by its own header;
//   c) the EXACT token found appears in the named contract's CODE — comments
//      stripped, because a `// renewal` typed into a contract would otherwise
//      buy that noun an exemption in everything generated from it;
//   d) a workflow under .github/workflows invokes that generator with `--check`,
//      so a hand edit to the generated file reddens a run rather than sitting
//      there. Facts (a)–(c) are all read off SOURCE TEXT and none of them looks
//      at the file's CONTENT; (d) is what makes "generated" a claim the tree has
//      to keep on every push. See the block above `workflowLines()` for what its
//      absence cost, measured.
// Typing a path satisfies none of them on its own.
//
// ⏱ (c) TIGHTENED and (d) ADDED 2026-09-06, after an adversarial review measured
// the hole. Everything above is the rule as it now stands; the ADR records the
// amendment beside its original wording rather than in place of it.
//
// 🔴 APP NAMES ARE NEVER EXEMPT. A contract that names an app has stopped being
// a contract, so limb 2 keeps its full reach over generated files.
//
// The count of exempted findings and the files they came from are PRINTED on
// every run. An exception that grew to cover the tree cannot do so in silence.
//
// Usage:  node tooling/ci/assert-no-clone-tells.mjs [repoRoot]
// Exit 0 = shared code is app-neutral, 1 = a clone tell leaked in.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, posix, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments } from './text-reductions.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER = join(ROOT, 'tooling', 'capability-register.json');

const MIN_APPS = 1;
/** The union floor. It is what a fixture root is held to — a unit test legitimately
 *  models one shared tree with a dozen files in it — and it is NOT sufficient on
 *  its own; see REQUIRED_COVERAGE below for why. */
const MIN_SCANNED = 10;

/**
 * 🔴 `MIN_SCANNED` IS A FLOOR OVER A UNION, AND THE UNION HAS A CONSTANT IN IT.
 * "Shared code" here is two independent trees: every `packages/<name>/lib` (103
 * .dart today) and `tooling/bricks` (29). One number over their sum is met by
 * either one alone, and the brick is the half no product change can shrink.
 *
 * MEASURED, on a copy of this repository (2026-08-17): delete `packages/`
 * outright, leave `apps/` and `tooling/bricks/` untouched, and this guard printed
 *   `ok  no clone tells — 29 shared file(s) scanned for 1 app name(s) and
 *    6 domain word(s); comments exempt`
 * and exited 0. 103 of 132 files — 78% of the subject, and every shared package
 * the apps actually link — left the scan in silence, while the passing line still
 * called what remained "shared file(s)" without saying which shared tree.
 *
 * Note this is NOT caught by the MIN_APPS check above: that one fires when `apps/`
 * empties, which is a different tree entirely and was the only collapse anybody
 * had tested. `packages/` emptying is the one that matters for C-10, because
 * packages/ IS the shared code the rule is about.
 *
 * So each shared tree now carries its own floor. Applied only on a full checkout —
 * detected by this guard's own file, which sits outside both trees and so survives
 * any mutation OF either — because these are measurements of THIS repository and
 * a fixture root legitimately holds one tree. Which branch ran is PRINTED.
 */
const REQUIRED_COVERAGE = [
  {
    key: 'packages',
    floor: 60,
    label: 'every packages/*/lib — the shared chassis the apps link, and the tree C-10 is actually about (103 .dart today)',
  },
  {
    key: 'tooling/bricks',
    floor: 10,
    label: 'the brick template — a clone tell here is born into all fifty future apps at once (29 .dart today)',
  },
];
const IS_FULL_CHECKOUT = existsSync(join(ROOT, 'tooling', 'ci', 'assert-no-clone-tells.mjs'));

function fail(lines) {
  for (const l of lines) console.error(l);
  process.exit(1);
}

// ── 1. the app names, derived from disk ──────────────────────────────────────
let appNames = [];
try {
  appNames = listDir(join(ROOT, 'apps'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    // `probe` is the stamped fixture the app_brick lane creates; it is also an
    // ordinary English word that appears legitimately in shared code, so matching
    // it would be noise rather than signal.
    .filter((n) => n !== 'probe');
} catch { /* handled by the floor below */ }

if (appNames.length < MIN_APPS) {
  coverageLost([
    `✗ COVERAGE LOST — found ${appNames.length} app(s) under apps/, expected at least ${MIN_APPS}.`,
    '  A clone-tell check with no app names to look for reports a clean tree forever.',
  ]);
}

// ── the banned domain vocabulary, from the register ──────────────────────────
let register = {};
if (existsSync(REGISTER)) {
  try {
    register = JSON.parse(readFileSync(REGISTER, 'utf8'));
  } catch (err) {
    fail([`✗ capability register is not valid JSON: ${err.message}`]);
  }
}
const domainNouns = register.cloneTells?.domainNouns;
if (!Array.isArray(domainNouns) || domainNouns.length === 0) {
  coverageLost([
    '✗ COVERAGE LOST — tooling/capability-register.json has no non-empty `cloneTells.domainNouns`.',
    '  [C-10] limb 2 would range over an empty set and pass everything, forever. An assertion',
    '  that cannot fail is worse than none: it inflates apparent coverage. Declare the list.',
  ]);
}

// ── the vendor SDK members a shared package cannot rename ────────────────────
// 🔴 A THIRD-PARTY API IS NOT OUR VOCABULARY, AND IT IS NOT A BLANKET PASS EITHER.
// `packages/billing_revenuecat` reads `StoreProduct.subscriptionPeriod` and
// `PricingPhase.billingCycleCount` because purchases_flutter spells them that way
// (2026-09-23, unit iap-store-truth): the store's plan term and trial length come
// from nowhere else. Renaming is not available, and banning the read would push
// the store's own price truth back out of the rail. So a DECLARED member of a
// DECLARED package is exempt, and only where all four facts hold:
//   (v1) the entry names a package, a member, and a why — and the member carries a
//        domain noun, since an entry that exempts nothing is dead furniture;
//   (v2) the file is under packages/<pkg>/lib and imports `package:<package>/`;
//   (v3) packages/<pkg>/pubspec.yaml declares <package> as a dependency;
//   (v4) the occurrence is a MEMBER ACCESS (`.member`), never a bare identifier —
//        a local `subscriptionPeriod` is our word, not the vendor's.
// Anything else on the line is still scanned. Every exemption is PRINTED, and on a
// full checkout an entry no line used is refused as stale.
const vendorMembers = register.cloneTells?.vendorMembers ?? [];
if (!Array.isArray(vendorMembers)) {
  fail(['✗ tooling/capability-register.json `cloneTells.vendorMembers` must be an array when present.']);
}
{
  const bad = [];
  for (const [i, v] of vendorMembers.entries()) {
    const where = `cloneTells.vendorMembers[${i}]`;
    if (typeof v?.package !== 'string' || !/^[a-z][a-z0-9_]*$/.test(v.package)) bad.push(`${where}: \`package\` must be a pub package name`);
    if (typeof v?.member !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(v.member)) bad.push(`${where}: \`member\` must be one Dart identifier`);
    if (typeof v?.why !== 'string' || v.why.trim().length < 20) bad.push(`${where}: \`why\` must say why this member cannot be renamed`);
    if (typeof v?.member === 'string' && !tellPattern(domainNouns).test(v.member)) {
      bad.push(`${where}: \`${v.member}\` carries no domain noun, so the entry exempts nothing — remove it`);
    }
  }
  if (bad.length) fail(['✗ clone-tell vendor exemptions are malformed (v1):', ...bad.map((b) => `    ${b}`)]);
}
/** Per packages/<pkg>, the vendor packages its pubspec declares (v3). */
const pubspecDeps = new Map();
function declaresDependency(pkgDir, dep) {
  if (!pubspecDeps.has(pkgDir)) {
    let text = '';
    try {
      text = readFileSync(join(ROOT, pkgDir, 'pubspec.yaml'), 'utf8');
    } catch { /* no pubspec — nothing is declared */ }
    pubspecDeps.set(pkgDir, text);
  }
  return new RegExp(`^dependencies:[\\s\\S]*?^\\s+${dep}:`, 'm').test(pubspecDeps.get(pkgDir));
}
/** The vendor members this file may read (v2 + v3); [] outside a package lib/ tree. */
function vendorMembersFor(rel, raw) {
  const m = rel.match(/^(packages\/[^/]+)\/lib\//);
  if (!m) return [];
  return vendorMembers.filter(
    (v) =>
      new RegExp(`^\\s*import\\s+['"]package:${v.package}/`, 'm').test(raw) && declaresDependency(m[1], v.package),
  );
}
const vendorUsed = new Map(vendorMembers.map((v) => [`${v.package}.${v.member}`, 0]));

// ── what counts as shared code ───────────────────────────────────────────────
function dartFiles(absDir, rel, out) {
  let entries;
  try {
    entries = listDir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'build' || e.name === '.dart_tool') continue;
    const abs = join(absDir, e.name);
    const r = posix.join(rel, e.name);
    if (e.isDirectory()) dartFiles(abs, r, out);
    else if (e.name.endsWith('.dart')) out.push(r);
  }
}
/** Collected PER TREE, never straight into one bucket — the whole point of the
 *  block above is that the two counts have to stay tellable apart. */
const byRoot = new Map(REQUIRED_COVERAGE.map((r) => [r.key, []]));

for (const pkg of (() => {
  try {
    return listDir(join(ROOT, 'packages'), { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return [];
  }
})()) {
  dartFiles(join(ROOT, 'packages', pkg.name, 'lib'), `packages/${pkg.name}/lib`, byRoot.get('packages'));
}
dartFiles(join(ROOT, 'tooling', 'bricks'), 'tooling/bricks', byRoot.get('tooling/bricks'));

const sharedFiles = REQUIRED_COVERAGE.flatMap((r) => byRoot.get(r.key));

if (sharedFiles.length < MIN_SCANNED) {
  coverageLost([
    `✗ COVERAGE LOST — scanned ${sharedFiles.length} shared dart file(s), expected at least ${MIN_SCANNED}.`,
    `  repo root used: ${ROOT}. The scan is broken, not the tree.`,
  ]);
}

// ── the per-tree floors, which the union above cannot express ────────────────
if (IS_FULL_CHECKOUT) {
  const lost = REQUIRED_COVERAGE.filter((r) => byRoot.get(r.key).length < r.floor);
  if (lost.length) {
    coverageLost([
      `✗ COVERAGE LOST — ${lost.length} of the ${REQUIRED_COVERAGE.length} shared tree(s) fell below their own floor:`,
      ...lost.map((r) => `    · ${r.key} — ${byRoot.get(r.key).length} .dart scanned, floor ${r.floor}. ${r.label}`),
      '',
      `  The union floor (MIN_SCANNED=${MIN_SCANNED}) was SATISFIED here — ${sharedFiles.length} file(s) across both trees —`,
      '  which is exactly the hole this check closes: either tree alone clears it, so the surviving one',
      '  vouches for the missing one. If a tree really did shrink this far, move its floor in the same',
      '  commit and say why; do not widen the union.',
    ]);
  }
}

/** Comments carry history and rationale and are legitimately allowed to name an
 *  app. Only executable code is scanned. Strings ARE code: a hardcoded 'subscriptiontracker'
 *  config key was a real defect here, so string literals stay in scope. */
/*  🔴 AND IT WAS THREE REGEXES, WHICH IS NOT A TOKENIZER (fixed 2026-08-07).
 *  The block pattern ran FIRST, so a `/*` inside a `//` line comment opened a
 *  phantom block that ran to the next `*​/` and swallowed everything between —
 *  the same defect measured in assert-ops-register.mjs, where it ate 103 lines
 *  of assert-ceiling-budget.mjs including a real `const`. A minimal falsifier
 *  both this copy and assert-no-seam-forks.mjs failed:
 *
 *      // paths like services/​*​/src/ are scanned
 *      class Ghost implements AuthRepository {}
 *      const s = 'closes *​/';
 *
 *  → the `class Ghost` DECLARATION is blanked, so a clone tell (or a seam fork)
 *  written after any such comment is invisible and the guard prints ok.
 *  On today's Dart corpus (217 files) the loss was 1 file / 62 chars of comment
 *  prose and no code — but that is a fact about today's comments, not about the
 *  scanner. Delegates to the shared tokenizer, which walks comments, strings and
 *  regex literals in one pass. */
function stripComments(src) {
  return stripSourceComments(src, '.dart');
}

/** ⚠️ A trailing `\b` MISSES camelCase. `\bsubscriptiontracker\b` does not match `SublyThing`,
 *  because the boundary needs a non-word character and `T` is one — so a class
 *  named after the app would sail through. Caught by a fixture, not by reading.
 *  Instead: match the name at a word start, in any of its normal casings, and
 *  require that what follows is not a lowercase letter. `SublyThing` and
 *  `SUBLY_KEY` match; `subscriptiontrackerx` (a longer, unrelated word) does not.
 *  The `i` flag cannot be used here — it would make `[a-z]` match `T` too.
 *
 *  🔴 AND THE LEADING `\b` MISSED THE PRIVATE HALF (2026-08-01 corpus triage).
 *  `_` is a WORD character, so there is no word boundary in `_subscriptiontracker…` — which
 *  means `_subscriptiontrackerLegacyLimit` and `class _SublyMigration` appended to
 *  packages/core were scanned and the guard printed "no clone tells". That is
 *  not a corner case: in Dart the underscore prefix is how you spell "private",
 *  so the entire private surface of every shared package was out of scope while
 *  the PUBLIC `subscriptiontrackerLegacyLimit` was caught. Mutation-proven on the real tree.
 *  The left edge is therefore "not preceded by a letter or digit" — `_` and `$`
 *  separate, exactly as they do to a human reading the identifier — while
 *  `mysubscriptiontracker` still does not match.
 *
 *  🔴 The word's OWN spelling is a variant too. The list was lower/Capital/UPPER
 *  only, so `billingCycle` — a camelCase entry in cloneTells.domainNouns —
 *  generated `billingcycle|BillingCycle|BILLINGCYCLE` and matched none of the
 *  three ways it is actually written. A banned word that cannot match itself is
 *  an assertion that cannot fail. */
function tellPattern(words) {
  const variants = words.flatMap((w) => [
    w,
    w.toLowerCase(),
    w.charAt(0).toUpperCase() + w.slice(1),
    w.toUpperCase(),
  ]);
  return new RegExp(`(?<![A-Za-z0-9])(${[...new Set(variants)].join('|')})(?![a-z])`);
}

// ── [ADR 070] the generated-from-a-contract derivation ───────────────────────

/** Every `.mjs` under contracts/, as {rel, text}. A generator that writes a file
 *  names that file's repo-relative path in its own source -- `generate-dart.mjs`
 *  carries `const REL = 'packages/purchases/lib/src/generated/...';` -- so this
 *  set is what turns "the header claims it is generated" into "something here
 *  actually writes it". Kept per FILE rather than concatenated, because fact (d)
 *  below has to name the generator it could not find a gate for; a blob can say
 *  that a writer exists but not which one. */
function contractGenerators() {
  const out = [];
  (function walk(dir) {
    let entries;
    try {
      entries = listDir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith('.mjs')) {
        out.push({
          rel: abs.slice(ROOT.length + 1).split(sep).join(posix.sep),
          text: readFileSync(abs, 'utf8'),
        });
      }
    }
  })(join(ROOT, 'contracts'));
  return out;
}
const GENERATORS = contractGenerators();

/**
 * FACT (d) -- THE GATE THAT MAKES "GENERATED" A CLAIM THE TREE HAS TO KEEP.
 *
 * 🔴 ADDED 2026-09-06 AFTER AN ADVERSARIAL REVIEW MEASURED THE HOLE. Facts (a),
 * (b) and (c) are all read off SOURCE TEXT: a header that says GENERATED, a
 * generator whose source names the output path, and a contract that contains the
 * token. Not one of them looks at whether the committed file is actually what
 * the generator would write today. On the branch that introduced this exemption
 * `contracts/entitlement/generate-dart.mjs --check` was invoked by NO workflow
 * (`grep -rn "generate-dart" .github/` -> zero lines), so two hand-typed lines
 * appended to the generated Dart left this guard at EXIT 0 and
 * assert-entitlement-contract.mjs at EXIT 0 -- the exemption was granted on a
 * premise nothing in CI ever re-derived.
 *
 * The premise is now conditional on the gate: a workflow must invoke the
 * generator that satisfies fact (b) WITH `--check`. Unwire that step and this
 * guard refuses the exemption and goes RED on the generated file, naming the
 * generator it found no invocation for. That is deliberately the same shape as
 * the rest of this corpus -- a register earns JSON only when a guard reads it --
 * applied one level up: an exemption earns its premise only when a gate proves
 * it on every push.
 *
 * ⚠️ NO INVOCATION SET AT ALL MEANS NO EXEMPTION, not a free pass. A root with
 * no `.github/workflows` cannot show that anything re-derives the premise, and
 * "I could not check" must never read the same as "I checked".
 */
function workflowLines() {
  const dir = join(ROOT, '.github', 'workflows');
  let names;
  try {
    names = listDir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of names) {
    if (!e.isFile() || !/\.ya?ml$/.test(e.name)) continue;
    for (const line of readFileSync(join(dir, e.name), 'utf8').split('\n')) {
      out.push(stripHashComment(line));
    }
  }
  return out;
}

/** A `#` starts a comment only at the head of a line or after whitespace, and
 *  never inside a quoted string -- the same rule a YAML comment and a shell
 *  comment inside a `run: |` body both obey. A gate NAMED IN PROSE is not a gate
 *  anybody invokes, and the header of every workflow in this tree discusses the
 *  scripts it calls at length. */
function stripHashComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (q === '"' && c === '\\') { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}
const WORKFLOW_LINES = workflowLines();

/** Is `genRel` invoked with `--check` by a workflow? Same LINE, because that is
 *  how every gate in this tree is written (`run: node <gate> --check`); a name
 *  in one step and a `--check` in another is two different invocations. */
const invokedWithCheck = (genRel) =>
  WORKFLOW_LINES.some((l) => l.includes(genRel) && l.includes('--check'));

/** The file's LEADING comment block only — from line 1 up to the first blank
 *  line after at least one `//` line. Deliberately not "any comment anywhere":
 *  a doc comment halfway down a hand-written file must not be able to declare
 *  the file generated. */
function leadingCommentBlock(raw) {
  const kept = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t.startsWith('//')) {
      kept.push(t);
      continue;
    }
    if (t === '' && kept.length === 0) continue;
    break;
  }
  return kept.join('\n');
}

/** What `rel` claims about its own provenance, and how much of the claim the
 *  tree makes good on: `{ writers, wired, sources }`.
 *
 *  `sources` are the contract files the header names, each with its CODE — the
 *  comment-stripped text — because fact (c) asks whether the CONTRACT contains
 *  the token, and a contract's comments are prose like any other.
 *
 *  🔴 FACT (c) USED TO READ THE RAW CONTRACT SOURCE, COMMENTS INCLUDED, so
 *  writing `// renewal` into contracts/entitlement/contract.js bought that noun
 *  an exemption in every file generated from it. The guard's own header sold (c)
 *  as "the EXACT token appearing in that contract", which is what it now is.
 *  A contract whose extension this tree has no comment syntax for is returned
 *  unchanged by stripSourceComments — JSON, which has no comments to strip.
 *
 *  ⚠️ A `.mjs` under contracts/ is NOT a candidate. The generators live in the
 *  same directory as the contracts, and the header names the generator as well
 *  as its input — so taking the first path that happens to exist picked
 *  `generate-dart.mjs`, whose source contains none of the vocabulary, and the
 *  exemption never fired. Worse in the other direction: a generator's own
 *  source is exactly where a banned noun could be written by hand. The contract
 *  is the data the runtimes read; the generator is a tool, and it is the file
 *  that satisfies fact (b), not fact (c). */
const NO_PROVENANCE = { writers: [], wired: false, sources: [] };

function contractProvenance(rel, raw) {
  if (!/^packages\/[^/]+\/lib\//.test(rel)) return NO_PROVENANCE;
  const header = leadingCommentBlock(raw);
  if (!/GENERATED/.test(header)) return NO_PROVENANCE;
  // (b) — something under contracts/ writes THIS path. A header alone is prose.
  const writers = GENERATORS.filter((g) => g.text.includes(rel)).map((g) => g.rel);
  if (writers.length === 0) return NO_PROVENANCE;
  // (d) — and a workflow proves that writer's output on every push.
  // ⏱ 2026-09-15 — ZERO WORKFLOW LINES READ IS COVERAGE LOST, not "unwired". With
  // .github/workflows moved aside this guard reported the generated entitlement
  // file as a clone tell "because no workflow invokes" its generator — true of an
  // empty read and false of the tree (O-LOCAL-SCRIPTS-PARSE-MOVED-WORKFLOWS). A
  // workflow set that exists and does not wire the gate is still a finding below.
  if (WORKFLOW_LINES.length === 0) {
    console.error(
      `✗ COVERAGE LOST — ${rel} claims to be generated by ${writers.join(' or ')}, and ZERO workflow lines were read ` +
        'under .github/workflows, so whether a drift gate proves it could not be checked at all.',
    );
    coverageLost([]);
  }
  const wired = writers.some(invokedWithCheck);
  const sources = [];
  for (const m of header.matchAll(/contracts\/[A-Za-z0-9._\-/]+/g)) {
    let p = m[0];
    while (p.endsWith('.')) p = p.slice(0, -1); // a path at the end of a sentence
    if (p.includes('..') || !/\.[A-Za-z0-9]+$/.test(p) || p.endsWith('.mjs')) continue;
    const abs = join(ROOT, p);
    if (!existsSync(abs)) continue; // (a)
    const ext = p.slice(p.lastIndexOf('.'));
    sources.push({ source: p, code: stripSourceComments(readFileSync(abs, 'utf8'), ext) });
  }
  return { writers, wired, sources };
}

const problems = [];
/** [ADR 070] — every finding the derivation above waved through, so the passing
 *  line can say how many and from where. */
const exempt = [];
/** The vendor-member exemptions (v1..v4) — printed on the passing line too. */
const vendorExempt = [];
const appRe = tellPattern(appNames);
const nounRe = tellPattern(domainNouns);

for (const rel of sharedFiles) {
  const raw = readFileSync(join(ROOT, rel), 'utf8');
  const provenance = contractProvenance(rel, raw);
  const code = stripComments(raw);
  const members = vendorMembersFor(rel, raw);
  for (const [i, line] of code.split('\n').entries()) {
    const app = line.match(appRe);
    if (app) {
      problems.push(
        `${rel}:${i + 1} — shared code names the app "${app[1]}". Once shared code knows which app it ` +
          'is in, every other app inherits a rule about a product it is not.',
      );
    }
    let noun = line.match(nounRe);
    if (noun && members.length) {
      // (v4) — scrub each declared `.member` access, then scan what is left.
      let rest = line;
      for (const v of members) {
        const access = new RegExp(`(\\??\\.)\\s*${v.member}(?![A-Za-z0-9_$])`, 'g');
        if (access.test(rest)) {
          vendorExempt.push({ rel, line: i + 1, what: `${v.package}.${v.member}` });
          vendorUsed.set(`${v.package}.${v.member}`, vendorUsed.get(`${v.package}.${v.member}`) + 1);
          rest = rest.replace(access, '$1__vendor_member__');
        }
      }
      noun = rest.match(nounRe);
    }
    if (noun) {
      // (c) — the token itself must be in the contract this file was generated
      // from. A generated file does NOT get a blanket pass on the whole list.
      const bearing = provenance.sources.find((c) => c.code.includes(noun[1]));
      if (bearing && provenance.wired) {
        exempt.push({ rel, line: i + 1, token: noun[1], source: bearing.source });
        continue;
      }
      // 🔴 (d) FAILED, AND THE MESSAGE SAYS SO RATHER THAN LEAVING THE READER TO
      // WORK IT OUT. Every other fact is about this file; this one is about a
      // workflow somewhere else, and a plain "clone tell" on a file that plainly
      // is generated is the kind of red that gets exempted again by hand.
      const unwired =
        bearing && !provenance.wired
          ? ` [ADR 070] would exempt this line, but no workflow under .github/workflows invokes ` +
            `${provenance.writers.join(' or ')} with --check, so nothing re-derives that this file is ` +
            'machine-written. Wire the drift gate rather than widening the exemption.'
          : '';
      problems.push(
        `${rel}:${i + 1} — shared code uses the domain word "${noun[1]}". That vocabulary belongs to one ` +
          "app's problem, not to the chassis." +
          unwired,
      );
    }
  }
}

// A declared vendor member that NO line read is an exemption for a call that is
// gone. Full checkout only: a fixture root legitimately declares members it lacks.
if (IS_FULL_CHECKOUT) {
  for (const [what, n] of vendorUsed) {
    if (n === 0) {
      problems.push(
        `tooling/capability-register.json — cloneTells.vendorMembers ${what} exempts no line in shared code. ` +
          'Remove the entry in the same change that removed the read, or it will exempt the next one unseen.',
      );
    }
  }
}

if (problems.length) {
  console.error(`✗ clone tells — ${problems.length} found in shared code:`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [C-10] shared code carries no app-specific vocabulary. Comments are exempt;');
  console.error('  these are in executable code or string literals.');
  process.exit(1);
}

// 🔴 THE PASSING LINE NAMES EACH SHARED TREE AND ITS COUNT. It used to say
// "132 shared file(s) scanned", and the same sentence read "29 shared file(s)
// scanned" with every shared package deleted — true either way, and useless for
// telling the two apart. A per-tree split cannot be true of a collapsed tree.
const split = REQUIRED_COVERAGE.map(
  (r) => `${r.key}=${byRoot.get(r.key).length}${IS_FULL_CHECKOUT ? `/floor ${r.floor}` : ''}`,
).join(', ');

// [ADR 070] — printed, never silent. Zero exemptions prints nothing extra, so
// the sentence cannot become furniture a reader stops seeing.
const exemptNote = exempt.length
  ? `; ${exempt.length} finding(s) exempt as generated from a contract [ADR 070]: ` +
    [...new Set(exempt.map((e) => `${e.rel} ← ${e.source}`))].join(', ')
  : '';
const vendorNote = vendorExempt.length
  ? `; ${vendorExempt.length} vendor SDK member access(es) exempt: ` +
    [...new Set(vendorExempt.map((e) => `${e.rel} ← ${e.what}`))].join(', ')
  : '';

console.log(
  `ok  no clone tells — ${sharedFiles.length} shared file(s) scanned [${split}] for ${appNames.length} app name(s) ` +
    `and ${domainNouns.length} domain word(s); comments exempt${exemptNote}${vendorNote}` +
    (IS_FULL_CHECKOUT
      ? ''
      : '. NOTE: this root is not a checkout of this repository, so only the union floor ' +
        `(MIN_SCANNED=${MIN_SCANNED}) applied — the per-tree floors did not run here.`),
);

/** The scan could not look, so this run is not evidence either way — exit 2,
 *  never 1, which would read as a finding (AGENTS.md exit-code convention,
 *  O-EXIT2-CONVENTION-GAP). Declared LAST (hoisted) so every `assert-no-clone-tells.mjs:NNN`
 *  citation above keeps pointing at the line it names. */
function coverageLost(lines) {
  for (const l of lines) console.error(l);
  process.exit(2);
}
