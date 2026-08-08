#!/usr/bin/env node
// [pipeline C-12, second clause] ZERO HARDCODED USER-FACING STRINGS (DoD §4-E).
//
// A string baked into a widget cannot be translated, and retrofitting l10n
// across 50 shipped apps is the expensive path — `architecture.md` §16 says so
// in as many words. The brick is where this is nearly free, and it is the one
// place a fix reaches every app the factory will ever stamp.
//
// ── WHY THIS IS A CI GUARD AND NOT A LINT (owner decision 2026-07-28) ────────
// The obvious home is a custom analyzer rule. It was rejected on two checked
// facts, not on preference:
//
//   1. custom_lint DOES NOT RUN under `dart analyze` / `flutter analyze`. Its
//      own docs: "running `dart analyze` does not pick up our newly defined
//      lints. We need a separate command for this." So it needs its own CI step
//      exactly like this guard does — there is no simplicity to be won.
//   2. It is a NEW PACKAGE, and under [pipeline C-4] a package must be earned by
//      a native payload, a licence exposure, or a codegen step. A lint plugin is
//      none of those, so it would arrive GRANDFATHERED — the C-4 rule
//      grandfathering its very next package.
//
// The one genuine loss is inline IDE feedback while typing, which a CI guard
// cannot give. For a single founder with CI as the gate, that did not justify a
// package plus a second lint toolchain.
//
// ── SCOPE, AND WHY IT IS NARROW ON PURPOSE ──────────────────────────────────
// Scanning every string literal produces mostly noise: keys, asset paths, MIME
// types, locale codes. This scans the places a string is actually SHOWN TO A
// PERSON — `Text('…')` and the labelling parameters — which is a domain small
// enough to be exact and large enough to matter.
//
// `apps/subly` is EXCLUDED and dated. It holds ~49 such literals across 46
// files, and `39-CHASSIS` cut 1 froze it as a legacy rail-prover, so including
// it would ship this guard red on day one — and a guard that is red on day one
// gets switched off, which is the failure this repository keeps recording.
// Retrofitting Subly is `architecture.md` §16's own work item.
//
// ── 2026-08-08 · THE CANARY IS A FIXTURE NOW, NOT A PRODUCT TREE ────────────
// The brick is clean, so this guard's coverage claim rests entirely on a tree
// KNOWN to be dirty coming back dirty (see the canary section below). That tree
// was `apps/subly/lib`, and the arrangement had a fault line running straight
// through it: the canary's dirtiness was a PRODUCT property, owned by nobody
// here, and scheduled for deletion. Subly's l10n retrofit — Phase 4 of
// `knowledge/plans/subly-restamp-execution.md` — cleans precisely the literals
// the canary counts, so the guard was going to go RED BY IMPROVEMENT: the build
// breaks BECAUSE somebody did the right thing, and the rational response to
// that is to weaken the guard. Every switched-off check in this repo's history
// started as a check that fired on a correct change.
//
// So the primary canary is now `tooling/ci/test/fixtures/dirty-strings`, which
// this guard owns and which no product work can tidy. `apps/subly/lib` is kept
// as a SECOND canary — a real tree is better evidence than a written one, and
// it is free until the retrofit lands — with a dated entry naming the increment
// that retires it. The canary is a LIST for that reason: canaries arrive and
// leave, and neither should require rewriting the check.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments } from './text-reductions.mjs';

const ROOT = process.cwd();
const problems = [];
const ok = (m) => console.log(`ok   ${m}`);

const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib';

// The fixture this guard owns. Three parts, each asserted below, each explained
// where it lives: `dirty/` carries the violations, `quiet/` carries one near
// miss per exemption, and `expected-families.txt` declares which matcher
// families the fixture holds evidence for.
const FIXTURE = 'tooling/ci/test/fixtures/dirty-strings';
const FIXTURE_DIRTY = `${FIXTURE}/dirty`;
const FIXTURE_QUIET = `${FIXTURE}/quiet`;
const FIXTURE_FAMILIES = `${FIXTURE}/expected-families.txt`;

// Dated exclusions. Each names WHY, so it stays reviewable rather than becoming
// permanent by accident.
const EXCLUDED_ROOTS = {
  'apps/subly': '2026-07-28 · frozen as a legacy rail-prover by 39-CHASSIS cut 1; ~49 literals across 46 files. Retrofit is architecture.md §16\'s work item, and including it here would ship this guard red on day one.',
};

// Where a string reaches a person. Captures the literal so it can be reported.
const SHOWN_TO_A_PERSON = [
  { re: /\bText\(\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1/g, what: 'Text(…)' },
  { re: /\b(?:label|title|subtitle|tooltip|hintText|labelText|helperText|semanticsLabel|semanticLabel|applicationLegalese)\s*:\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1/g, what: 'a labelling parameter' },
];

// Not user-facing, even inside those positions. Each entry is a real category
// seen in this tree, not a hypothetical.
const NOT_USER_FACING = [
  { re: /^\s*$/, why: 'empty or whitespace' },
  // 🔴 TIGHTENED 2026-08-01 (full-corpus triage). This read `^[a-z][a-z0-9_]*$`
  // — ANY bare lowercase word — so `Text('settings')`, `Text('loading')`,
  // `Text('delete')` and `Text('subscriptions')` were every one of them filed as
  // "a key" and the guard printed "the brick is clean". Mutation-proven against
  // the real brick: those four literals added, exit 0. They are not keys; they
  // are the commonest labels an app ships, in the one tree that multiplies by 50.
  //
  // The distinguishing fact is a SEPARATOR: an identifier has one, a word does
  // not. So the exemption now requires at least one `_`. `analytics_opt_in`
  // stays silent; `settings` no longer does. An exemption broad enough that you
  // cannot write the input it should have caught is a hole, not a filter.
  { re: /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/, why: 'a snake_case key — it carries a separator, so it is an identifier and not prose' },
  { re: /^[A-Z][A-Z0-9_]+$/, why: 'a CONSTANT_KEY' },
  { re: /^#?[0-9a-fA-F]{3,8}$/, why: 'a hex colour' },
  { re: /^(?:https?:|mailto:|tel:|package:|asset|assets\/)/i, why: 'a URL or asset path' },
  { re: /^\{\{.*\}\}$/, why: 'a mustache token — substituted at stamp time' },
  { re: /^[^a-zA-Z]*$/, why: 'no letters at all (punctuation, digits, symbols)' },
];

/** Every literal sitting in a position a person reads from, WITHOUT the
 *  NOT_USER_FACING filter applied.
 *
 *  Split out from `scan` so the quiet fixture can be asked the two DIFFERENT
 *  questions it exists to answer: "is anything here enforced" (the filtered
 *  scan, which must be zero) and "does every exemption still have an input that
 *  reaches it" (this one, which must be non-empty for each). Asking only the
 *  first would be satisfied by an empty directory. */
function scanRaw(dir) {
  const hits = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const entry of listDir(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.dart')) continue;
      // Generated localisations are the OUTPUT of l10n, not a violation of it.
      if (/app_localizations/.test(entry)) continue;
      const rel = relative(ROOT, full).replace(/\\/g, '/');
      // Strip comments first — a literal quoted in prose is not shown to anyone,
      // and this repo has already shipped one guard that matched its own
      // explanatory comment.
      //
      // 🔴 THE SHARED REDUCER, NOT A HAND-ROLLED `/\/\/.*$/gm` (2026-08-08). The
      // hand-rolled version was not string-aware, so a literal CONTAINING `//`
      // — `Text('Visit https://nikatru.com for help')`, an ordinary user-facing
      // sentence — was cut at the slashes, and the regex then ran on to the next
      // quote in the file and SWALLOWED THE FOLLOWING LITERAL WHOLE. A hardcoded
      // string sitting after a URL was invisible: a false negative in a guard
      // whose entire job is to have no false negatives.
      //
      // text-reductions.mjs's `stripSourceComments` already refuses that exact
      // trap (its own header records it for JSONC's `"https://…"`), and the
      // string-awareness is the whole reason the reduction is shared rather than
      // re-typed per guard. Measured on the real trees the day it was swapped in:
      // brick 0→0, apps/subly 71→71, fixture 31→31 — identical hits, so the
      // defect was latent rather than active, which is precisely when it is
      // cheap to remove. Found by the canary fixture below, on its first run.
      const src = stripSourceComments(readFileSync(full, 'utf8'), '.dart');
      for (const { re, what } of SHOWN_TO_A_PERSON) {
        re.lastIndex = 0;
        for (const m of src.matchAll(re)) hits.push({ file: rel, literal: m[2], what });
      }
    }
  };
  walk(join(ROOT, dir));
  return hits;
}

/** What a person actually reads: the raw positions minus the categories that are
 *  addresses, keys and colours rather than prose. */
const scan = (dir) => scanRaw(dir).filter((h) => !NOT_USER_FACING.some((x) => x.re.test(h.literal)));

// ── The brick: must be clean. ───────────────────────────────────────────────
if (!existsSync(join(ROOT, BRICK))) {
  problems.push(`COVERAGE LOST — ${BRICK} does not exist, so this guard scanned the one tree it exists to protect and found nothing to protect.`);
} else {
  const hits = scan(BRICK);
  for (const h of hits) {
    problems.push(
      `${h.file} shows a hardcoded string in ${h.what}: "${h.literal}". Move it to lib/l10n/app_en.arb and read it through AppLocalizations. Every app the factory stamps inherits this file, and retrofitting l10n across 50 shipped apps is the expensive path (architecture.md §16).`,
    );
  }
  if (hits.length === 0) ok('the brick template shows no hardcoded user-facing strings');
}

// ── COVERAGE SELF-CHECK, and this one is not optional. ──────────────────────
// The brick is clean, so every assertion above passes over an empty result set
// — which is indistinguishable from a scanner that has stopped matching. This
// stage has already shipped three checks that ranged over nothing. So the
// matchers are proven against trees KNOWN to contain violations.
//
// A LIST, not one path (2026-08-08). See the header for why the primary canary
// is now a fixture this guard owns rather than a product tree somebody is about
// to clean. Each entry is checked INDEPENDENTLY — floor and per-family evidence
// — rather than pooled: a pooled total across roots would let one canary die in
// silence while the other carried the sum, which is the same blindness the
// per-family check below exists to remove, one level up.
const CANARY_ROOTS = [
  {
    root: FIXTURE_DIRTY,
    why: "this guard's own fixture: dirty on purpose, owned here, and unreachable by product work. It is the canary that stays.",
  },
  {
    root: 'apps/subly/lib',
    why: '2026-08-08 · RETIRES with Subly\'s l10n retrofit — Phase 4 of knowledge/plans/subly-restamp-execution.md, which cleans these very literals. Kept until then because a real tree is stronger evidence than a written one; the increment that cleans it deletes this entry and the EXCLUDED_ROOTS line in the same commit. If you are reading this after that landed, it was missed.',
  },
];
const MIN_CANARY = 20;

for (const { root, why } of CANARY_ROOTS) {
  if (!existsSync(join(ROOT, root))) {
    problems.push(
      `COVERAGE LOST — the canary tree ${root} does not exist, so the matchers were proven against nothing there and the brick's clean result above is worth less than it looks. (${why})`,
    );
    continue;
  }
  const canary = scan(root);
  if (canary.length < MIN_CANARY) {
    problems.push(
      `COVERAGE LOST — the matchers found only ${canary.length} hardcoded string(s) in ${root}, expected >= ${MIN_CANARY}. That tree is known to be full of them, so a low count means these patterns have stopped matching and the brick's clean result above proves nothing.`,
    );
    continue;
  }
  ok(`matchers verified against a known-dirty tree: ${canary.length} literal(s) found in ${root}`);

  // 🔴 AND A RELATIONSHIP, NOT ONLY A COUNT (2026-08-01 corpus triage).
  // MIN_CANARY is deliberately left FAR below every measured total — apps/subly
  // yields 71, the fixture 31 — and it must stay that way: re-pinning a floor at
  // whatever the tree happens to measure today is the stale-floor defect PR #85
  // removed from assert-guard-coverage. But a total floor is also blind in the
  // other direction: 58 of apps/subly's 71 hits come from the `Text(…)` matcher,
  // so BREAKING THE LABELLING MATCHER still clears any total floor by a wide
  // margin and prints "matchers verified".
  //
  // So the real coverage claim is derived from the matcher list itself: every
  // family must show its own evidence, in every canary, that it still matches.
  for (const { what } of SHOWN_TO_A_PERSON) {
    if (!canary.some((h) => h.what === what)) {
      problems.push(
        `COVERAGE LOST — the "${what}" matcher found NOTHING in ${root}, a tree known to be dirty in exactly that way. One matcher family has stopped matching while the others carry the total over the floor, so the brick's clean result proves nothing about ${what}.`,
      );
    }
  }
}

// ── THE DECLARATION IDENTITY — what catches a matcher family that was DELETED.
// The per-family loop above iterates over SHOWN_TO_A_PERSON, so it can see a
// family whose regex has stopped matching and is STRUCTURALLY BLIND to a family
// removed from the list: the loop then simply never asks about it. The total
// floor is blind to that too. Deleting a matcher was therefore invisible to both
// limbs — the guard would keep printing "matchers verified" while covering half
// the surface it claims.
//
// So the set of families is declared OUTSIDE the file being audited, in the
// fixture, and the two sets must be equal. A name declared with no matcher
// behind it means a family was deleted; a matcher not declared means one was
// added without the fixture earning evidence for it. Neither can be silenced by
// editing one file, which is the whole reason the declaration does not live here
// as a constant. (Same argument as the test-coverage ratchet living in a
// committed manifest rather than inside assert-guard-coverage.mjs.)
const familiesPath = join(ROOT, FIXTURE_FAMILIES);
if (!existsSync(familiesPath)) {
  problems.push(
    `COVERAGE LOST — ${FIXTURE_FAMILIES} does not exist, so nothing outside this file records which matcher families are supposed to be here and a deleted matcher would pass unremarked.`,
  );
} else {
  const declared = readFileSync(familiesPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
  const matchers = SHOWN_TO_A_PERSON.map((m) => m.what);
  if (declared.length === 0) {
    problems.push(
      `COVERAGE LOST — ${FIXTURE_FAMILIES} declares no families. An empty declaration is satisfied by any matcher list at all, including none, so emptying it deletes this check rather than resetting it.`,
    );
  }
  for (const d of declared) {
    if (!matchers.includes(d)) {
      problems.push(
        `COVERAGE LOST — ${FIXTURE_FAMILIES} declares evidence for the "${d}" family and NO MATCHER PROVIDES IT. A matcher family was deleted from this guard: the per-family check cannot see that, because it iterates over the list that shrank. Restore the matcher, or — if the family is genuinely retired — remove its evidence from the fixture and its line from the declaration in the same change.`,
      );
    }
  }
  for (const m of matchers) {
    if (!declared.includes(m)) {
      problems.push(
        `COVERAGE LOST — the "${m}" matcher is not declared in ${FIXTURE_FAMILIES}. A new matcher family must earn its own evidence in the fixture, exactly like the two that are already there; otherwise it is enforced on the brick while nothing proves it still matches anything.`,
      );
    }
  }
  if (declared.length > 0 && declared.length === matchers.length && declared.every((d) => matchers.includes(d))) {
    ok(`the ${matchers.length} matcher families are exactly those ${FIXTURE_FAMILIES} carries evidence for`);
  }
}

// ── THE EXEMPTIONS ARE LOAD-BEARING, SO THEY ARE ASSERTED TOO. ──────────────
// NOT_USER_FACING is what keeps this guard believable — a check that fires on
// keys, hex colours and asset paths is one somebody switches off within a week.
// But an exemption is also the easiest place to hide a hole, and this file has
// already shipped one: `^[a-z][a-z0-9_]*$` filed `settings`, `loading`, `delete`
// and `subscriptions` as "keys" and the guard printed clean.
//
// Two limbs pulling opposite ways, both over the quiet fixture:
//   · EVERY exemption must have at least one literal there that reaches it. An
//     exemption you cannot write the input for is a hole, not a filter — and
//     adding one now costs a near miss in the same change.
//   · the enforced scan over that tree must be ZERO. Narrow or delete an
//     exemption and its near miss starts counting HERE, next to the comment
//     explaining what it was for, rather than in some app six months later.
// The raw scan is checked non-empty first, because "zero enforced hits" is also
// true of an empty directory.
if (!existsSync(join(ROOT, FIXTURE_QUIET))) {
  problems.push(
    `COVERAGE LOST — ${FIXTURE_QUIET} does not exist, so nothing proves the NOT_USER_FACING exemptions still exempt anything, nor that they have stopped exempting prose.`,
  );
} else {
  const raw = scanRaw(FIXTURE_QUIET);
  const enforced = scan(FIXTURE_QUIET);
  if (raw.length === 0) {
    problems.push(
      `COVERAGE LOST — ${FIXTURE_QUIET} holds no literal in any position the matchers look at, so "zero enforced hits" there is a statement about an empty tree and every exemption below is unproven.`,
    );
  } else {
    for (const h of enforced) {
      problems.push(
        `${h.file} is in the QUIET fixture and now counts as user-facing: "${h.literal}" in ${h.what}. Every literal there is a near miss for a specific NOT_USER_FACING exemption, so one of them has been narrowed or removed. Either that change is wrong, or the near miss belongs in ${FIXTURE_DIRTY} now and the fixture README's table moves with it.`,
      );
    }
    for (const { re, why } of NOT_USER_FACING) {
      if (!raw.some((h) => re.test(h.literal))) {
        problems.push(
          `COVERAGE LOST — the exemption for ${why} (${re}) has no near miss in ${FIXTURE_QUIET}: nothing there reaches it, so it could be silently wrong, or silently dead, and no test would notice. Add the literal it is meant to exempt.`,
        );
      }
    }
    if (enforced.length === 0 && NOT_USER_FACING.every(({ re }) => raw.some((h) => re.test(h.literal)))) {
      ok(`all ${NOT_USER_FACING.length} exemptions still exempt: ${raw.length} near miss(es) in ${FIXTURE_QUIET}, 0 of them enforced`);
    }
  }
}

for (const [root, why] of Object.entries(EXCLUDED_ROOTS)) {
  console.log(`\n⬜ EXCLUDED · ${root}\n   ${why}`);
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-no-hardcoded-strings: FAILED');
  process.exitCode = 1;
} else {
  console.log('\nassert-no-hardcoded-strings: ok — the brick is clean, and the matchers are proven to still match');
}
