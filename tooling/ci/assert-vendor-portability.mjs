#!/usr/bin/env node
// [pipeline C-8] EVERY VENDOR SATISFIES THE PORTABILITY CHECKLIST — not "behind
// a seam" alone.
//
// Top-down from the charter kept "behind a seam" and silently dropped the rest,
// which is how a seam ends up LOOKING like portability while a vendor swap still
// requires a store release. The seam is one part of six.
//
// SIX PARTS, NOT FOUR. C-8's own title says "four-part"; portability-standard.md
// §Checklist lists six. The lock resolved the contradiction to SIX — the
// checklist is the primary record and C-8 is the copy. Four parts are
// machine-checkable and BLOCK the build; two are judgement and PRINT, because a
// guard that pretends to check judgement is a guard that always passes.
//
// ── SURFACES ARE DERIVED FROM FOUR SOURCES, AND ANY ONE ALONE IS BLIND ───────
// All four verified against the real tree 2026-07-28; the (a) numbers re-measured
// 2026-08-21 (see below) — the tree grew, the point did not.
//
//   a. `*.fromEnvironment('KEY')` in Dart — scanned MULTILINE and with comments
//      STRIPPED, because `dart format` wraps the literal onto the following
//      line and a line-based grep therefore returns a confident, wrong, small
//      number. This is the scanner-that-stopped-scanning failure in its purest
//      form. UPDATE_URL is one of the defines a line-based scan misses.
//      🔴 MEASURED 2026-08-21, over 311 tracked .dart files, all four numbers
//      taken the same day so they can be compared:
//                        multiline              line-based
//        raw             38 hits / 20 distinct  14 hits /  9 distinct
//        comments out    37 hits / 20 distinct  13 hits /  8 distinct
//      This scan is the STRIPPED MULTILINE cell: 37 / 20. The line-based column
//      is what a grep would report, and it is still missing most of the surface.
//      All four cells re-taken 2026-08-21 after the read was repointed at
//      `text-reductions.mjs`, and all four reproduce. The DISTINCT count does
//      not move (20 → 20) and `derived.size` stays 41, because the single hit
//      stripping removes — `tooling/bricks/app/__brick__/apps/{{app_id}}/lib/
//      state/providers.dart:469`, a `///` line — names APP_VERSION, which is a
//      real define elsewhere. So the >= 10 floor below does not turn on this
//      change either; what was wrong was the number feeding it.
//      ⚠️ The line above read "a line-based grep finds 2 of the 11 that exist"
//      from 2026-07-28 until 2026-08-21, when both halves were re-measured and
//      found stale — 2 → 13 and 11 → 20 as the tree grew. Corrected rather than
//      deleted, and the supersession kept, because the ratio is the claim and a
//      dated record that quietly changes its numbers stops being evidence.
//   b. `interface Env` in services/*/src/types.ts — REVENUECAT_WEBHOOK_SECRET
//      exists ONLY here. Without this source RevenueCat — the amendment's own
//      headline example — is invisible to the whole check.
//   c. wrangler `binding` keys AND `ratelimits[].name`. The ratelimits block
//      uses `name`, not `binding`, so a binding-only scan cannot see
//      EVENTS_LIMITER. Confirmed by scanning for bindings and watching it not
//      appear.
//   d. `triggers.crons` — a schedule is an external surface too, and a dead cron
//      looks exactly like a live one.
//
// Every derived surface must be claimed by exactly one vendor, or declared a
// non-vendor surface. An unclaimed token is indistinguishable from a vendor
// nobody reviewed, which is the adoption-without-review this requirement stops.
//
// SCOPE: services, not libraries — the checklist opens "before adopting any new
// SERVICE". Dart package deps are C-5 limb (c)'s job; duplicating them here
// would be two lists to keep in step.
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments } from './text-reductions.mjs';

// ── PROSE IS NOT CODE, AND THIS FILE USED TO DISAGREE WITH ITSELF ────────────
// 🔴 FIXED 2026-08-21. Of the reads below, source (c)/(d) stripped comments and
// sources (a) and (b) did not — an asymmetry INSIDE ONE FILE, so the same
// sentence could derive a surface or not depending only on which scanner
// happened to reach it. Every read that scans source text for MEANING now goes
// through `stripSourceComments` in `text-reductions.mjs`, which blanks comment
// spans to spaces and keeps newlines, so lengths and line numbers survive
// (re-measured 2026-08-21: identical length on all 311 tracked .dart files, on
// both `types.ts`, and on both wrangler configs).
//
// STRING LITERALS ARE LEFT VERBATIM ON PURPOSE — the wrangler and Worker-Env
// scans below match on the CONTENTS of string literals, so blanking them would
// delete the very thing they read. `stripSourceComments` never touches literal
// contents; `stripStringLiterals` in the same module is the separate tool for
// that, and is deliberately NOT composed in here.
//
// ⚠️ AN EXTENSION THE MODULE DOES NOT KNOW IS RETURNED VERBATIM AND SAYS
// NOTHING. Every read below therefore passes the file's OWN extension, and the
// startup probe further down asserts the reduction really reduces for each of
// the three this file fixes — the same mitigation assert-android-target-sdk.mjs
// and assert-no-do-alarms.mjs carry.
//
// 🔴 CORRECTED 2026-08-21, SAME DAY IT WAS WRITTEN. This paragraph used to say
// "`.jsonc` IS NOT IN THE MODULE'S EXTENSION TABLE" and routed the wrangler read
// through a `{ lang: 'js' }` override to work around it. That was true of a
// short-lived second stripper which has since been deleted; `text-reductions.mjs`
// has covered `.jsonc` since 6f0855d, 2026-08-06 (measured with
// `git log -S"['.jsonc', 'c']" -- tooling/ci/text-reductions.mjs`; an earlier draft of this
// line said 2026-08-02, which is the module's own creation date and not this entry's), and it
// is STRICTLY BETTER here than the
// `^\s*//.*$` line-prefix regex this read carried before it, because it tracks
// string state: five lines across the two live configs hold `//` inside a URL
// value (`SUPABASE_URL`, `ALLOWED_ORIGINS`, `APP_ERASURE_ENDPOINTS`) and all
// five come back intact. Measured 2026-08-21 across three views of those two
// configs — no strip, the old line-prefix strip, and this module — all three
// derive the SAME 12 wrangler surfaces (platform 9, subly-api 3) with identical
// token sets. The reach is new; the verdict is not.
// `vendor-portability.test.mjs` pins the new reach with a commented-out binding
// in all three comment forms.

const ROOT = process.cwd();
const REGISTER = 'tooling/capability-register.json';
const problems = [];
const notes = [];
const ok = (m) => console.log(`ok   ${m}`);

// THE REDUCTION IS ASSERTED, NOT ASSUMED. `stripSourceComments` returns its
// input UNCHANGED for an extension missing from COMMENT_STYLES, and says
// nothing — so if one of these three ever left that map, every scan below would
// be deriving external surfaces out of doc comments and commented-out bindings
// while printing the same `ok`. Two tokens per probe, so a red here cannot be
// mistaken for a malformed file in the tree.
for (const ext of ['.dart', '.ts', '.jsonc']) {
  if (stripSourceComments('x // c', ext) === 'x // c') {
    problems.push(
      `COVERAGE LOST — \`stripSourceComments\` left a \`${ext}\` sample containing a comment completely unchanged. ` +
        'tooling/ci/text-reductions.mjs returns an unknown extension VERBATIM, so this guard would read prose as surface.',
    );
  }
}

/** True when the shared stripper demonstrably strips this extension. The seam
 *  path comes from the REGISTER, so unlike every other read in this file its
 *  extension is not fixed here, and an unknown one comes back verbatim with no
 *  signal at all. Three probes because the module's styles are not all `//`. */
const reduces = (ext) => ['x // c', 'x -- c', 'x # c'].some((s) => stripSourceComments(s, ext) !== s);

let reg;
try {
  reg = JSON.parse(readFileSync(join(ROOT, REGISTER), 'utf8'));
} catch (e) {
  console.error(`FAIL ${REGISTER} could not be read or parsed (${e.message}).`);
  console.error('\nassert-vendor-portability: FAILED');
  process.exit(1);
}
const vendors = reg.vendors;
const nonVendor = reg.nonVendorSurfaces;
if (!vendors || !nonVendor) {
  console.error(`FAIL ${REGISTER} is missing \`vendors\` and/or \`nonVendorSurfaces\`. With neither, every external surface in the tree is unreviewed and this guard has nothing to range over.`);
  console.error('\nassert-vendor-portability: FAILED');
  process.exit(1);
}

// ── DERIVATION ───────────────────────────────────────────────────────────────
const derived = new Map(); // token -> source label

// (a) Dart compile-time defines. MULTILINE — see the header.
let dartFiles = [];
try {
  dartFiles = execSync('git ls-files "*.dart"', { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
} catch {
  problems.push('COVERAGE LOST — could not list tracked .dart files, so source (a) contributed nothing. Every compile-time define in the app would go unreviewed.');
}
let dartHits = 0;
for (const f of dartFiles) {
  let src = '';
  // STRIPPED — a `fromEnvironment('X')` written in a doc comment is prose about
  // a surface, not a surface. See the header note.
  try { src = stripSourceComments(readFileSync(join(ROOT, f), 'utf8'), extname(f).toLowerCase()); } catch { continue; }
  for (const m of src.matchAll(/(?:String|bool|int)\.fromEnvironment\(\s*'([A-Z][A-Z0-9_]*)'/g)) {
    derived.set(m[1], derived.get(m[1]) ?? 'dart-define');
    dartHits++;
  }
}

// (b) Worker Env interfaces.
let envHits = 0;
const svcRoot = join(ROOT, 'services');
// DIRECTORIES ONLY. `services` is the set every per-service relationship below
// ranges over, so a stray file in services/ must not become a phantom member.
const services = existsSync(svcRoot)
  ? listDir(svcRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  : [];
for (const s of services) {
  const p = join(svcRoot, s, 'src/types.ts');
  if (!existsSync(p)) continue;
  // Stripped for the same reason as (a). NO VERDICT CHANGE, ROUTED FOR
  // UNIFORMITY — re-measured 2026-08-21: 32 keys (platform 20, subly-api 12)
  // raw AND stripped, key lists byte-identical, lengths identical. It is here
  // so a commented-out `SOME_KEY: string;` cannot start demanding a claim, and
  // `vendor-portability.test.mjs` pins that with a block-commented key.
  const src = stripSourceComments(readFileSync(p, 'utf8'), extname(p).toLowerCase());
  const block = src.match(/interface\s+Env\s*\{([\s\S]*?)\n\}/);
  if (!block) continue;
  for (const m of block[1].matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*[?:]/gm)) {
    derived.set(m[1], derived.get(m[1]) ?? `worker-env:${s}`);
    envHits++;
  }
}

// (c) + (d) wrangler bindings, ratelimit names, and cron schedules.
//
// THE ONE FILENAME THIS SCAN UNDERSTANDS. Named once, so the coverage check
// below can say it out loud instead of leaving the reader to infer it.
const WRANGLER = 'wrangler.jsonc';
let bindingHits = 0;
/** service → how many wrangler surfaces it contributed. The per-service split is
 *  the whole point: a total cannot tell "one Worker's config went unreadable"
 *  from "this Worker has fewer bindings than the other". */
const wranglerPerService = new Map(services.map((s) => [s, 0]));
for (const s of services) {
  const p = join(svcRoot, s, WRANGLER);
  if (!existsSync(p)) continue;
  const before = bindingHits;
  // Strip comments so a commented-out binding is not counted as one.
  // WIDENED 2026-08-21: this was `.replace(/^\s*\/\/.*$/gm, '')`, which saw only
  // FULL-LINE comments — a trailing `// "binding": "X"` or a block comment was
  // read as config. No count moved (12 wrangler surfaces before and after,
  // re-measured that day: platform 9, subly-api 3, identical token sets),
  // because today's two configs carry 202 full-line comments (135 + 67) and NOT
  // ONE trailing or block comment between them. The reach is new; the verdict
  // is not.
  // 🔴 CORRECTED SAME DAY: a first version of this line called a second,
  // now-deleted stripper with an explicit `{ lang: 'js' }` override, on the
  // belief that `.jsonc` was outside the shared module's extension table. It is
  // not — `text-reductions.mjs` has covered `.jsonc` since 6f0855d, 2026-08-06. The
  // extension is passed the same way as every other read in this file.
  //
  // 🔴 AND THIS IS WHY STRING LITERALS ARE LEFT ALONE. Five lines across the two
  // configs contain `//` inside a URL — `"SUPABASE_URL": "https://…"`,
  // `ALLOWED_ORIGINS`, `APP_ERASURE_ENDPOINTS`. A stripper that treated `//` as
  // a comment opener without tracking string state would eat the rest of those
  // lines (measured 2026-08-21: all five come back intact); one that blanked
  // string literals would delete the values this scan reads. The module leaves
  // both alone, which is the property being relied on, not a bonus.
  const src = stripSourceComments(readFileSync(p, 'utf8'), extname(WRANGLER).toLowerCase());
  for (const m of src.matchAll(/"binding"\s*:\s*"([A-Za-z][A-Za-z0-9_]*)"/g)) {
    derived.set(m[1], derived.get(m[1]) ?? `wrangler-binding:${s}`);
    bindingHits++;
  }
  // ratelimits entries key on `name`, NOT `binding` — see the header.
  const rl = src.match(/"ratelimits"\s*:\s*\[([\s\S]*?)\n\s*\]/);
  if (rl) {
    for (const m of rl[1].matchAll(/"name"\s*:\s*"([A-Za-z][A-Za-z0-9_]*)"/g)) {
      derived.set(m[1], derived.get(m[1]) ?? `wrangler-ratelimit:${s}`);
      bindingHits++;
    }
  }
  if (/"crons"\s*:\s*\[\s*"/.test(src)) {
    derived.set('triggers.crons', derived.get('triggers.crons') ?? `wrangler-cron:${s}`);
    bindingHits++;
  }
  wranglerPerService.set(s, bindingHits - before);
}

// Per-source coverage self-checks. A single total would let one source die
// silently while the others carried the number — and each source exists
// precisely because the others cannot see what it sees.
// 🔴 KNOWN GAP, MEASURED 2026-08-21, DELIBERATELY NOT REPAIRED HERE — the
// dart-define floor no longer catches the failure its own message describes.
// Mutation run that day against the real tree (multiline match broken to a
// line-based one, everything else untouched): dartHits fell 37 → 13. 13 clears
// this floor of 10, so the COVERAGE LOST branch below did NOT fire. The
// mutation was still caught — the guard EXITED 1 with 10 `no longer exists`
// staleness failures, because 10 tokens dropped out of `derived` (41 → 31) — so
// the guard is not blind; this specific tripwire is just no longer the thing
// catching it.
// ⚠️ BOTH NUMBERS ON THE LINE ABOVE READ `11` WHEN THIS PARAGRAPH WAS WRITTEN
// EARLIER THE SAME DAY. Re-running the identical mutation gives 10 — one
// REVENUECAT_KEY claim plus nine `nonVendorSurfaces` entries. Corrected rather
// than deleted, because a dated record that quietly changes its numbers stops
// being evidence; the shape of the finding is unchanged.
// The floor was set against a tree of ~11 hits in 2026-07-28 and the tree has
// since grown to 37.
//
// NOT raised in the same change as the comment-stripping fix, and the reason is
// concrete rather than caution: the shared fixture in vendor-portability.test.mjs
// derives exactly 13 dart hits, chosen to clear this floor. Re-pointing the floor
// means rewriting that fixture, which is a separate change with its own negative
// half, not a rider on this one.
// ⚠️ CORRECTED 2026-08-21: this paragraph claimed any floor above 13 "turns all
// of that file's cases red at once". MEASURED with `dart-define` set to 14 and
// nothing else touched — 26 tests, 21 pass, 5 fail. Every case that injects a
// define of its own derives 14 and stays green; only the five that run the bare
// fixture go red. The conclusion holds, the evidence offered for it did not, and
// an overstated number in the sentence that defers a repair is exactly the kind
// of claim this sweep exists to remove.
const FLOORS = { 'dart-define': 10, 'worker-env': 15 };
if (dartHits < FLOORS['dart-define']) {
  problems.push(`COVERAGE LOST — source (a) found only ${dartHits} compile-time define(s), expected >= ${FLOORS['dart-define']}. A LINE-BASED scan finds 13 here (measured 2026-08-21, was 2 when this tripwire was written 2026-07-28); if this number collapsed toward 13, the multiline match has broken and most defines including UPDATE_URL are invisible again.`);
}
if (envHits < FLOORS['worker-env']) {
  problems.push(`COVERAGE LOST — source (b) found only ${envHits} Worker Env key(s), expected >= ${FLOORS['worker-env']}. REVENUECAT_WEBHOOK_SECRET exists only here, so losing this source hides a whole vendor.`);
}

// ── source (c)/(d) IS A RELATIONSHIP, NOT A NUMBER ───────────────────────────
// 🔴 IT USED TO BE `bindingHits >= 5`, against a tree measuring 11. Corpus
// triage 2026-08-01 (#39) mutated the real repository — `mv
// services/subly-api/wrangler.jsonc wrangler.json` — and watched the total fall
// 11 → 7 and the guard EXIT 0. Nothing else caught it either: the four lost
// surfaces are D1/KV bindings that ALSO appear in that Worker's `interface Env`,
// so source (b) kept them in `derived` and no vendor's claim went stale. One
// Worker's entire wrangler surface — a cron, a ratelimit name, anything living
// only in the config — could vanish behind a total the other Worker carried on
// its own.
//
// A floor can only ever say "not zero-ish". What is actually true, and stays
// true as services are added or removed, is a RELATIONSHIP: every directory
// under services/ is a deployed Worker, and a deployed Worker is deployed BY a
// wrangler config, so every one of them must contribute at least one surface.
// That expectation is derived from the tree on each run — it cannot sit below
// reality, because reality is what computes it.
if (services.length === 0) {
  problems.push(`COVERAGE LOST — no service directories under \`services/\`, so source (c)/(d) ranged over nothing. Every wrangler binding, ratelimit name and cron schedule in the repo would be invisible and this guard would still print ok.`);
} else {
  const blind = [...wranglerPerService.entries()].filter(([, n]) => n === 0).map(([s]) => s);
  if (blind.length) {
    problems.push(
      `COVERAGE LOST — source (c)/(d) read ZERO wrangler surfaces from ${blind.length} of ${services.length} service(s): ${blind.map((s) => `services/${s}`).join(', ')}. ` +
        `Each directory under \`services/\` is a deployed Worker and must contribute at least one binding, \`ratelimits[].name\` or cron. ` +
        `This scan reads exactly one filename — \`${WRANGLER}\` — so a config renamed, moved or deleted takes that Worker's whole external surface with it while the remaining service carries the total. ` +
        `If the layout genuinely changed, teach this scan the new one in the SAME change; do not let the count speak for it.`,
    );
  }
}
if (problems.length === 0) {
  const split = [...wranglerPerService.entries()].map(([s, n]) => `${s}:${n}`).join(', ');
  ok(`derived ${derived.size} external surface(s) — ${dartHits} dart-define hit(s), ${envHits} Worker Env key(s), ${bindingHits} wrangler surface(s) across ${services.length} service(s) (${split})`);
}

// ── Every surface is claimed exactly once ────────────────────────────────────
const claimedBy = new Map();
for (const [id, v] of Object.entries(vendors)) {
  if (id.startsWith('_')) continue;
  for (const s of v.surfaces ?? []) {
    if (claimedBy.has(s)) problems.push(`surface \`${s}\` is claimed by BOTH \`${claimedBy.get(s)}\` and \`${id}\`. Two owners means neither is accountable for its checklist.`);
    claimedBy.set(s, id);
  }
}
for (const [token, source] of derived) {
  if (claimedBy.has(token)) continue;
  if (nonVendor[token]) continue;
  problems.push(
    `external surface \`${token}\` (found in ${source}) is claimed by NO vendor and is not declared a non-vendor surface. Add it to a vendor's \`surfaces\` with the six-part record, or to \`nonVendorSurfaces\` saying what it is. An unclaimed surface is indistinguishable from a vendor nobody reviewed.`,
  );
}
// Stale in the other direction.
for (const [s, id] of claimedBy) {
  if (!derived.has(s)) problems.push(`vendor \`${id}\` claims surface \`${s}\`, which no longer exists anywhere in the tree. Remove it — a checklist covering a surface that is gone overstates what is reviewed.`);
}
for (const t of Object.keys(nonVendor)) {
  if (t.startsWith('_')) continue;
  if (!derived.has(t)) problems.push(`\`nonVendorSurfaces\` declares \`${t}\`, which no longer exists in the tree. Remove the stale entry.`);
}

// ── The six parts ────────────────────────────────────────────────────────────
const CHECKED = ['seam', 'configKeyed', 'exportPath', 'exitPlan'];
const PRINTED = ['openProtocol', 'ownTheRecord'];
let vendorCount = 0;
const unverifiableExports = [];
let checkableExports = 0;
for (const [id, v] of Object.entries(vendors)) {
  if (id.startsWith('_')) continue;
  vendorCount++;
  for (const part of [...CHECKED, ...PRINTED]) {
    if (!v[part]) problems.push(`vendor \`${id}\` records nothing for checklist part \`${part}\`. The checklist is six parts; a missing one is the part that bites during the swap.`);
  }
  // part 2 — the seam symbol must really be where it says.
  if (v.seam?.file) {
    const p = join(ROOT, v.seam.file);
    if (!existsSync(p)) {
      problems.push(`vendor \`${id}\` names seam file \`${v.seam.file}\`, which does not exist. A seam you cannot open is not a seam.`);
      // 🔴 `interface X` IS A SEAM DECLARATION TOO. This pattern was Dart-only
      // (`class` / `abstract class` / `interface class`), which silently made
      // part 2 unrecordable for any vendor whose seam is a TypeScript interface
      // on a Worker — and the merchant-of-record seam ([ADR 004]'s
      // `MoRWebhookVerifier`) is exactly that. The alternative was to cite some
      // nearby Dart class instead, i.e. to record a seam that is not the seam.
      // Widening the pattern keeps the assertion identical in kind: the named
      // symbol must really be DECLARED in the named file.
    } else if (v.seam.symbol) {
      // Stripped, and read ONCE. A seam whose only `class X` is inside a
      // commented-out block is a seam that was deleted, and part 2 must not
      // accept the comment as the declaration. No verdict change today —
      // measured 2026-08-21: all five seams (AuthRepository, ConfigTransport,
      // EntitlementCache, MoRWebhookVerifier, TelemetryClient) match raw AND
      // stripped — so this is the same uniformity as (b), recorded as such.
      //
      // 🔴 THE ONE READ IN THIS FILE WHOSE EXTENSION IS NOT FIXED HERE. It comes
      // from the register, and the shared stripper hands back an extension it
      // does not know VERBATIM without saying so — which would silently restore
      // the raw read this block exists to remove. So it is named, not assumed.
      const seamExt = extname(v.seam.file).toLowerCase();
      if (!reduces(seamExt)) {
        problems.push(
          `vendor \`${id}\` names seam file \`${v.seam.file}\`, whose extension \`${seamExt || '(none)'}\` is unknown to the shared comment stripper — it returns such a file UNCHANGED, so a commented-out declaration of \`${v.seam.symbol}\` would be accepted as the seam. Add the extension to COMMENT_STYLES in tooling/ci/text-reductions.mjs, or name a seam this scan can read.`,
        );
      }
      const seamSrc = stripSourceComments(readFileSync(p, 'utf8'), seamExt);
      // 🔴 A SEAM IS A DECLARED BOUNDARY, NOT NECESSARILY A CLASS — widened
      // 2026-09-03, and the widening is about SHAPE rather than strictness. Every
      // vendor in this register happened to hide behind a class or an interface, so
      // those two forms were the whole list; the `github` dispatch surface is one
      // exported FUNCTION, which is just as much "the single place this vendor is
      // reachable" and just as bounded to swap.
      // ⚠️ WHAT IS NOT WIDENED IS THE PROPERTY THIS BLOCK EXISTS FOR: the symbol
      // must be DECLARED in the named file, in source whose comments are already
      // stripped, so a commented-out or merely-mentioned symbol is still refused.
      // A keyword is required before the name for exactly that reason — matching the
      // bare name would accept the call site, the import and a doc comment.
      if (
        !new RegExp(`\\b(?:abstract\\s+)?(?:interface\\s+)?class\\s+${v.seam.symbol}\\b`).test(seamSrc) &&
        !new RegExp(`\\binterface\\s+${v.seam.symbol}\\b`).test(seamSrc) &&
        !new RegExp(`\\bfunction\\s+${v.seam.symbol}\\b`).test(seamSrc)
      ) {
        problems.push(`vendor \`${id}\` names seam symbol \`${v.seam.symbol}\` in \`${v.seam.file}\`, which does not declare it.`);
      }
    }
  }
  // part 3 — runtime, or compile-time WITH a reason.
  const ck = v.configKeyed;
  if (ck && ck.kind !== 'runtime' && !ck.reason) {
    problems.push(`vendor \`${id}\` is \`${ck.kind}\` config-keyed with no \`reason\`. "No release to repoint" is the property this part exists for, so an exception has to argue for itself.`);
  }
  // part 5 — the export path must exist on disk.
  //
  // 🔴 CAUGHT BY CI, NOT LOCALLY, AND THE DIVERGENCE IS THE POINT. This guard
  // runs in the PUBLIC repo, where `Private/` is gitignored and structurally
  // absent — so citing a private runbook as machine-checkable evidence passes on
  // a dev box (Private/ is on disk) and fails in CI. The first version of this
  // check did exactly that.
  //
  // The fix follows this repo's own grading rule — NO SILENT SKIPS: a path the
  // guard cannot see is graded `could-not-establish` WITH ITS REASON and
  // printed, never quietly passed. And the exemption is STRUCTURAL, not a flag:
  // only `Private/` qualifies, because that prefix is the private-corpus boundary
  // itself. A boolean anybody could set would make part 5 optional.
  // FLATTENED 2026-08-15: was `Private/company/` (deleted that day), which stopped
  // matching when the flatten removed that segment from every path in the corpus.
  if (v.exportPath?.path) {
    const p = v.exportPath.path;
    if (p.startsWith('Private/')) {
      unverifiableExports.push(`${id} → ${p}`);
    } else if (!existsSync(join(ROOT, p))) {
      problems.push(`vendor \`${id}\` cites export path \`${p}\`, which does not exist. An untested exit is not an exit.`);
    } else {
      checkableExports++;
    }
  }
  // part 6 — a named alternative and a swap cost.
  if (v.exitPlan && (!v.exitPlan.alternative || !v.exitPlan.swapCost)) {
    problems.push(`vendor \`${id}\`'s \`exitPlan\` must name an alternative AND its swap cost. "We could move" without a named destination is not a plan.`);
  }
}
if (vendorCount === 0) {
  problems.push('COVERAGE LOST — the register declares no vendors at all, so every checklist assertion below ranges over nothing and this guard passes by vacancy.');
} else {
  ok(`${vendorCount} vendor(s) carry all six checklist parts; ${CHECKED.length} checked against the tree, ${PRINTED.length} printed`);
}

// If EVERY export path were private, part 5 would be recorded everywhere and
// verified nowhere — present, and decorative. At least one has to be real.
if (vendorCount > 0 && checkableExports === 0) {
  problems.push(
    'COVERAGE LOST — not one export path points at something this guard can open. Part 5 would then be recorded for every vendor and checked for none, which is the "assertion that cannot fail" shape. At least one vendor must cite public, checkable evidence.',
  );
}
if (unverifiableExports.length) {
  notes.push(`could-not-establish (${unverifiableExports.length}) — export path is in the PRIVATE company SSoT, which is gitignored and absent from this repo by design, so CI cannot open it:`);
  for (const u of unverifiableExports) notes.push(`    ${u}`);
}

// ── Surfaces MOVED to runtime config must still be moved. ────────────────────
// Found by asking what mutation would beat this guard: the register records that
// UPDATE_URL was fixed, but a register entry is a claim about code, and nothing
// re-checked the code. Reverting the fix would leave this guard printing `ok`
// while the kill-switch went circular again — the same "hollow record" shape
// C-16's source anchors exist for. So each migration names the line that proves
// it, in BOTH halves: parsed in core, and actually read by the app.
const RUNTIME_MIGRATIONS = [
  {
    surface: 'UPDATE_URL',
    anchors: [
      { file: 'packages/core/lib/src/config/app_config.dart', re: /updateUrl:\s*\n?\s*json\['update_url'\]/, what: "core's AppConfig must PARSE `update_url` from the config body" },
      { file: 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/app.dart', re: /valueOrNull\?\.updateUrl\s*\?\?/, what: 'the brick must READ the runtime value, with the compiled-in define as the offline fallback' },
    ],
    why: 'the force-update wall is the emergency exit; an exit you can only move by shipping a new build is not one',
  },
];
for (const m of RUNTIME_MIGRATIONS) {
  for (const a of m.anchors) {
    let src = '';
    // Stripped: an anchor satisfied by a comment is the "hollow record" this
    // block exists to prevent, one level down — the register would claim the
    // migration, the anchor would claim the code, and the code would be prose.
    // No verdict change today — measured 2026-08-21: both anchors match raw AND
    // stripped.
    try { src = stripSourceComments(readFileSync(join(ROOT, a.file), 'utf8'), extname(a.file).toLowerCase()); } catch {
      problems.push(`\`${m.surface}\` claims a runtime-config migration, but \`${a.file}\` could not be read to confirm it.`);
      continue;
    }
    if (!a.re.test(src)) {
      problems.push(`\`${m.surface}\` is recorded as moved to runtime config, but the implementation is gone — ${a.what}. ${m.why}.`);
    }
  }
}
ok(`${RUNTIME_MIGRATIONS.length} runtime-config migration(s) still implemented, both halves`);

// ── Declared violations. These BLOCK — part 3 is machine-checkable, and the
//    UPDATE_URL fix is a decided item, not a judgement call. ─────────────────
for (const [token, entry] of Object.entries(nonVendor)) {
  if (token.startsWith('_') || typeof entry !== 'object' || !entry.violation) continue;
  problems.push(
    `\`${token}\` FAILS the portability checklist: ${entry.violation}` +
      (entry.decision ? ` — ${entry.decision}` : ''),
  );
}

for (const [id, v] of Object.entries(vendors)) {
  if (id.startsWith('_')) continue;
  notes.push(`· ${id} — protocol: ${String(v.openProtocol ?? '?').split(' —')[0]}`);
  notes.push(`    own the record: ${String(v.ownTheRecord ?? '?').split(' —')[0]}`);
}
if (notes.length) {
  console.log('\n⬜ The two judgement parts, printed rather than pretended-checked:');
  for (const n of notes) console.log(`  ${n}`);
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-vendor-portability: FAILED');
  process.exitCode = 1;
} else {
  console.log(`\nassert-vendor-portability: ok — ${derived.size} surface(s) all claimed, ${vendorCount} vendor(s) complete on all six parts`);
}
