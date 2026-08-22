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
// The ENFORCED domain was the brick template, and only the brick template. That
// was not modesty about the rule; it is where the rule is nearly free. A literal
// fixed there never reaches the 50 apps the factory will stamp, and a literal
// fixed in one stamped app fixes one app. `apps/subly/lib` joined it on
// 2026-08-11 for the other reason a rule becomes free — the tree ran out of
// literals (see the 2026-08-11 note below).
//
// ── 2026-08-08 · THE CANARY IS A FIXTURE NOW, NOT A PRODUCT TREE ────────────
// The brick is clean, so this guard's coverage claim rests entirely on a tree
// KNOWN to be dirty coming back dirty (see the canary section below). That tree
// was `apps/subly/lib`, and the arrangement had a fault line running straight
// through it: the canary's dirtiness was a PRODUCT property, owned by nobody
// here, and scheduled for deletion. Subly's l10n retrofit — Phase 4 of
// `Private/plans/subly-restamp-execution.md` — cleans precisely the literals
// the canary counts, so the guard was going to go RED BY IMPROVEMENT: the build
// breaks BECAUSE somebody did the right thing, and the rational response to
// that is to weaken the guard. Every switched-off check in this repo's history
// started as a check that fired on a correct change.
//
// So the primary canary is now `tooling/ci/test/fixtures/dirty-strings`, which
// this guard owns and which no product work can tidy. `apps/subly/lib` was kept
// alongside it as a SECOND canary — a real tree is better evidence than a
// written one, and it was free until the retrofit landed. The canary is a LIST
// for that reason: canaries arrive and leave, and neither should require
// rewriting the check.
//
// ── 2026-08-08 · THE SUBLY CANARY IS RETIRED, ON SCHEDULE ───────────────────
// P4 L0 of `Private/plans/subly-restamp-execution.md` is the increment the
// entry named as its own expiry, and this is that increment: the .arb now holds
// every key Subly's screens need, so the waves that follow will empty
// `apps/subly/lib` of the literals this guard was counting there. Removing the
// entry BEFORE the cleaning is deliberate — the alternative is a build that goes
// red because somebody did the right thing, and the rational response to that is
// to weaken the guard. Every switched-off check in this repo's history started as
// a check that fired on a correct change.
//
// Measured the day it was removed, so the claim that the fixture alone carries
// the floor is a number rather than a hope: `apps/subly/lib` 59 hits (49 `Text(…)`
// + 10 labelling), the fixture 32 (23 + 9). MIN_CANARY is 20, and BOTH matcher
// families still have their own evidence in the fixture — which is the property
// the per-family check below actually needs, and the one a total would hide.
// `expected-families.txt` is untouched: it declares matchers, not canaries.
//
// ── 2026-08-11 · apps/subly IS ENFORCED NOW, AND THE WINDOW IS WHY ───────────
// Retiring the canary above left this app scanned by NOTHING: its own DoD §4-E
// note said so in as many words — "no guard counts literals here". The retrofit
// then did its job, and the tree that measured 59 hits on the day it stopped
// being a canary measures FIVE.
//
// Five is the whole argument. A guard is adopted at the moment the tree is clean
// and the cost of the last mile is a handful of lines; every month it waits, the
// screens grow new literals nobody counted and the adoption cost climbs back out
// of reach. That is how apps/subly came to be excluded in the first place, and
// how a `$2.99` sat in shipping code for months while the owner had decided
// $4.99 — assert-no-price-literals.mjs exists because the obvious guard was
// looking somewhere else.
//
// The five remaining are all DATA INTERPOLATION (`'${s.category} · $usage'`),
// which is not a translation defect at all, so they are dispatched by a matcher
// EXEMPTION rather than by a waiver — an exemption is falsifiable (add prose
// beside the interpolation and it counts again), a waiver is not. Exactly one
// literal needs a named allowlist entry, and it carries its reason.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments } from './text-reductions.mjs';

const ROOT = process.cwd();
const problems = [];
/** 👤 OWNER lines. Printed on EVERY run and never counted as a problem — see the
 *  reverse-direction section below for why an unrendered translated key is an
 *  owner judgement rather than a build break. */
const notes = [];
const ok = (m) => console.log(`ok   ${m}`);

const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib';

/**
 * THE TREES THIS GUARD ENFORCES. A LIST, for the same reason the canary is one:
 * a domain that grows by adding an object rather than by rewriting the loop is a
 * domain somebody actually grows.
 *
 * The brick is where the rule is nearly free — a literal fixed there never
 * reaches the 50 apps the factory will stamp. `apps/subly/lib` is where the rule
 * is nearly free RIGHT NOW, which is a different and perishable reason, so it is
 * recorded next to the entry rather than left to be re-derived later.
 */
const ENFORCED_ROOTS = [
  {
    root: BRICK,
    why: 'the brick template — every app the factory stamps inherits this file, so a literal fixed here is fixed 50 times',
    remedy: 'Move it to lib/l10n/app_en.arb and read it through AppLocalizations. Every app the factory stamps inherits this file, and retrofitting l10n across 50 shipped apps is the expensive path (architecture.md §16).',
  },
  {
    root: 'apps/subly/lib',
    why: "the factory's first app, and the tree the retrofit just emptied — adopted at 5 remaining literals, because the cost of adopting this rule only ever goes up",
    remedy: "Add the key to apps/subly/lib/l10n/app_en.arb (and app_ta.arb — l10n_parity_test.dart asserts parity in BOTH directions), run `flutter gen-l10n`, and read it through AppLocalizations.",
  },
];

/**
 * ⚠️ THE ONLY WAIVER, AND IT IS KEYED TO AN EXACT LITERAL AT AN EXACT PATH.
 *
 * A waiver by DIRECTORY or by file would silently cover the next literal that
 * lands beside it — which is precisely how `apps/subly` came to be excluded
 * wholesale and how a wrong price hid inside the exclusion. Keyed this narrowly,
 * a new literal at the same path is still a failure.
 *
 * AND AN UNUSED ENTRY IS A FAILURE TOO (asserted below). A waiver that no longer
 * matches anything is an exemption nobody can see the input for — dead weight
 * that makes the enforced domain look narrower than it is.
 */
const ALLOWED = [
  {
    file: 'apps/subly/lib/features/auth/login_screen.dart',
    literal: 'debug: $detail',
    why: 'guarded by `if (kDebugMode && detail != null)`. kDebugMode is a const, so the tree-shaker removes this whole branch from every release artifact — it is E2E diagnostic output (E2EKeys.accountDeletionNoticeDetail), read by `flutter drive`, never by a user. [ADR 027]',
  },
];

// The fixture this guard owns. Three parts, each asserted below, each explained
// where it lives: `dirty/` carries the violations, `quiet/` carries one near
// miss per exemption, and `expected-families.txt` declares which matcher
// families the fixture holds evidence for.
const FIXTURE = 'tooling/ci/test/fixtures/dirty-strings';
const FIXTURE_DIRTY = `${FIXTURE}/dirty`;
const FIXTURE_QUIET = `${FIXTURE}/quiet`;
const FIXTURE_FAMILIES = `${FIXTURE}/expected-families.txt`;

// 🔴 THERE IS NO EXCLUSION LIST ANY MORE, and its removal is the point rather
// than tidying. `EXCLUDED_ROOTS` held exactly one dated entry — `apps/subly`,
// frozen as a legacy rail-prover by 39-CHASSIS cut 1 — and it never filtered
// anything: nothing below ever scanned outside the brick, the fixture and the
// canary list, so the map's only effect was the ⬜ EXCLUDED notice it printed at
// the end of every run. With the entry gone the map and its printing loop were
// dead code that inflated the guard's apparent reach, so both went with it
// (2026-08-08, P4 L0). Re-adding an exclusion is five lines; carrying an empty
// mechanism that reads like enforcement is the more expensive mistake.

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
  // 🔴 THE EXEMPTION THAT LET apps/subly BE ENFORCED (2026-08-11). Every one of
  // that tree's five surviving hits is a composition of values — `'${s.category}
  // · $usage'`, `'$_pct%'` — where the literal parts carry no letters at all.
  // There is no prose to translate; the words come from the data and were
  // localised where the data was made.
  //
  // NARROW BY CONSTRUCTION, and the falsifying input is easy to write: one
  // letter outside an interpolation and it counts again, so `'Welcome, $name'`
  // and `'debug: $detail'` are both still failures. It requires at least one
  // interpolation, which is what keeps it from swallowing the plain
  // no-letters-at-all case above rather than duplicating it.
  //
  // A nested brace inside `${…}` simply does not match, which fails CLOSED —
  // the literal is enforced. That is the safe direction to be wrong in.
  {
    re: /^(?:[^a-zA-Z$]*(?:\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*))+[^a-zA-Z$]*$/,
    why: 'composed only of interpolations — every letter comes from a value, so there is no prose here to translate',
  },
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
  for (const { rel, body } of readDartTree(dir)) {
    for (const { re, what } of SHOWN_TO_A_PERSON) {
      re.lastIndex = 0;
      for (const m of body.matchAll(re)) hits.push({ file: rel, literal: m[2], what });
    }
  }
  return hits;
}

/** THE ONE .dart WALK IN THIS FILE — every `.dart` under `dir`, comment-stripped,
 *  as `{ rel, body }`.
 *
 *  Split out from `scanRaw` on 2026-08-21 because the reverse direction added
 *  below needs the same FILES for a different question: the forward limb asks
 *  what literals sit in the bodies, the reverse limb asks which `.<key>`
 *  accessors do. Two walks would be two chances to disagree about what counts
 *  as a render file — and the two limbs' whole claim is that they are opposite
 *  halves of ONE domain, so a divergence there is the check quietly measuring
 *  two different trees while printing one number. Same argument text-reductions
 *  makes for why the reduction is shared rather than re-typed per guard.
 *
 *  🔴 THE `app_localizations` SKIP IS LOAD-BEARING FOR BOTH LIMBS, and for the
 *  reverse one it is the whole measurement: gen-l10n output declares a getter
 *  for EVERY key in the .arb, so counting it would make every key "read" and the
 *  reverse limb would print a clean zero forever. It is also gitignored
 *  factory-wide (.gitignore:191), which is how the same probe once answered one
 *  way on a workstation and another in a guard-only CI job on an identical
 *  commit — assert-consent-withdrawal-surface.mjs:550-555 records that scar
 *  (that citation read 551-556 until it was re-taken on 2026-08-21). */
function readDartTree(dir) {
  const out = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const entry of listDir(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      // 🔴 PINNED 2026-08-22, HAVING SHIPPED UNFALSIFIABLE. `if (false)` here
      // left `node --test tooling/ci/test/no-hardcoded-strings.test.mjs` at
      // EXIT 0, tests 80, pass 80, fail 0 — the 2026-08-21 sweep enumerated the
      // reverse limb and never entered this walk, because the walk read as
      // inherited code. It is not: this file SPLIT it out of `scanRaw` in the
      // same change, so every clause here is load-bearing for a limb that did
      // not exist before. Latent, measured the same day: the only non-`.dart`
      // files under the two enforced trees are the four `.arb` files, and all
      // four sit under `/l10n/`, which the render-domain filter drops anyway.
      // The hiding direction is the dangerous one — without this line any
      // non-Dart file under `lib/` whose bytes contain `.someKey` reads as a
      // render surface and deletes an owner line in silence. Pinned by `does NOT
      // treat a non-.dart file under an enforced tree as a render surface`, and
      // RED against it when dropped.
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
      // brick 0→0, apps/subly 59→59, fixture 32→32 — identical hits, so the
      // defect was latent rather than active, which is precisely when it is
      // cheap to remove. Found by the canary fixture below, on its first run.
      // (Those two totals read 71 and 31 until 2026-08-08. They were the counts
      // from an earlier tree, copied forward rather than re-measured, and they
      // were the numbers the retirement argument below was reasoning from.)
      out.push({ rel, body: stripSourceComments(readFileSync(full, 'utf8'), '.dart') });
    }
  };
  walk(join(ROOT, dir));
  return out;
}

/** What a person actually reads: the raw positions minus the categories that are
 *  addresses, keys and colours rather than prose. */
const scan = (dir) => scanRaw(dir).filter((h) => !NOT_USER_FACING.some((x) => x.re.test(h.literal)));

// ── The enforced trees: must be clean. ──────────────────────────────────────
const waived = new Set();
for (const { root, why, remedy } of ENFORCED_ROOTS) {
  if (!existsSync(join(ROOT, root))) {
    problems.push(`COVERAGE LOST — ${root} does not exist, so this guard scanned a tree it exists to protect and found nothing to protect. (${why})`);
    continue;
  }
  let counted = 0;
  for (const h of scan(root)) {
    const waiver = ALLOWED.find((a) => a.file === h.file && a.literal === h.literal);
    if (waiver) {
      waived.add(waiver);
      continue;
    }
    counted++;
    problems.push(`${h.file} shows a hardcoded string in ${h.what}: "${h.literal}". ${remedy}`);
  }
  if (counted === 0) ok(`${root} shows no hardcoded user-facing strings`);
}

// A waiver that matches nothing is an exemption with no visible input — the same
// defect the quiet fixture exists to prevent one level down, and the reason the
// old wholesale `apps/subly` exclusion could sit in this file printing a notice
// while filtering nothing.
for (const a of ALLOWED) {
  if (!waived.has(a)) {
    problems.push(
      `COVERAGE LOST — the allowlist entry for "${a.literal}" in ${a.file} matched NOTHING. Either the literal was fixed — in which case delete the entry in the same change — or it moved, and the waiver is now covering nothing while reading like a live exemption.`,
    );
  }
}
if (ALLOWED.length > 0 && waived.size === ALLOWED.length) {
  ok(`${ALLOWED.length} named allowlist entr(y/ies), every one still matching the literal it was written for`);
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
  // `apps/subly/lib` sat here until 2026-08-08 and was removed by the increment
  // its own entry named — P4 L0 of Private/plans/subly-restamp-execution.md.
  // It stays a LIST with one element on purpose: the shape is what let a canary
  // be retired by deleting an object rather than by rewriting the loop below,
  // and the next real tree that is known-dirty in these ways can be added the
  // same way.
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
  // MIN_CANARY is deliberately left FAR below every measured total — the fixture
  // yields 32 — and it must stay that way: re-pinning a floor at whatever the
  // tree happens to measure today is the stale-floor defect PR #85 removed from
  // assert-guard-coverage. But a total floor is also blind in the other
  // direction: 23 of the fixture's 32 hits come from the `Text(…)` matcher, so
  // BREAKING THE LABELLING MATCHER still clears any total floor by a wide margin
  // and prints "matchers verified". (The retired apps/subly canary was worse on
  // this axis, not better: 49 of its 59 were `Text(…)`.)
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

// ── THE OTHER DIRECTION, AND THIS HALF PRINTS RATHER THAN FAILS. ────────────
// Everything above proves that every string a screen SHOWS came from the .arb.
// Nothing above proves the converse — that every string the .arb DECLARES
// reaches a screen — and the two are genuinely different claims: this guard's
// own remedy strings say "Move it to lib/l10n/app_en.arb and read it through
// AppLocalizations", and only the first half of that sentence was ever checked.
// So a key can be written, reviewed, TRANSLATED INTO TAMIL, and rendered by
// nothing, indefinitely, with every guard in the stage green. That has already
// happened at least SIX times: `offlineMessage` (the brick's own header records
// it at lib/state/providers.dart:54-62), `consentReadPolicy`, and the FOUR keys
// this limb prints today — appTitle, errorTitle, errorMessage and
// notificationActionOpen.
// (This read "at least four times … and the two keys this limb prints today"
// until 2026-08-21. "Two" was inherited from a research note about the
// errorTitle/errorMessage pair and never re-taken against the limb's own output;
// counted from that output on 2026-08-21 it is four printed plus the one
// suppressed, so the incident count is six and not four.)
//
// 🔴 IT PRINTS, IT NEVER FAILS, AND THAT IS THE HOUSE RULE RATHER THAN TIMIDITY.
// CLAUDE.md: "When a capability's on-switch is owner-gated, the guard must PRINT
// the gap on every run rather than fail the build — otherwise it blocks all CI
// on work only the owner can do." Whether a reviewed, translated string should
// be rendered, deleted, or is waiting on a surface nobody has built yet is an
// owner judgement in exactly that sense — there is no builder-side "correct"
// answer to fail somebody for not having chosen. The two model prints are
// assert-adapter-capabilities.mjs's `max_promos_per_week` tripwire and
// assert-consent-withdrawal-surface.mjs's `consentReadPolicy` line.
//
// 🔴 AND IT PRINTS THE SIZE OF THE DOMAIN IT SCANNED. That is the single
// property that makes the adapter tripwire honest — "zero code paths read
// `max_promos_per_week` (185 non-test Dart file(s) scanned)" is a measurement,
// where a bare "zero readers" is indistinguishable from a scan that reached
// nothing. Every number in the print below is derived on the run that prints it.
//
// ── WHY THE READER DOMAIN IS THE UNION OF THE ENFORCED TREES, NOT EACH TREE ──
// Measured 2026-08-21, and it is the difference between 5 findings and 23. The
// brick's 155 keys are a strict SUBSET of apps/subly's 309 — 0 brick keys are
// absent from subly's arb — because subly was stamped FROM the brick and then
// diverged: it rewrote `login_screen.dart` while keeping the inherited chassis
// keys, so `navExplore`, `signInTitle`, `homeTagline`, `needAccount` and TEN
// more (14 keys in all) sit in subly's .arb and are rendered only by the brick's
// screens — and `legalMustAcceptTerms` sits in the BRICK's .arb and is rendered
// only by subly's. Asked per-tree, this limb reports 19 + 4 = 23 keys, of which
// FIFTEEN — those 14 plus `legalMustAcceptTerms` — are rendered by the sibling
// tree in the same lineage; the natural owner answer ("delete it") would then
// break the other tree. The other 8 per-tree lines are the 5 union findings
// counted once per tree that declares them, three of them (appTitle, errorTitle,
// errorMessage) being in BOTH arbs. Asked over the union it reports 5, every one
// of which is genuinely rendered nowhere. A false positive here is not noise: it
// is an invitation to delete shipping copy.
// (This read "eleven more" and "of which 18" until 2026-08-21. Re-measured that
// day: 14, and 15. 18 came from 23 − 5, which is the wrong subtraction — the
// three double-declared keys are counted twice on the per-tree side and once on
// the union side, so the two sums are not in the same units.)
//
// ── WHAT THIS LIMB DOES NOT CATCH (stated 2026-08-21) ───────────────────────
// An owner acting on a print needs its edges, and an overclaiming comment is
// worse than none. Four holes, each measured rather than assumed:
//  · REACHABILITY IS BY LITERAL GETTER NAME. `ACCESSOR_OF` matches the text
//    `.key`. A key resolved dynamically would read as unrendered. Measured
//    2026-08-21 over the 71 render files: 0 map-style `l10n[…]` accesses and 0
//    `noSuchMethod` overrides, so the domain is CLOSED today — and stops being
//    closed the first time somebody writes one. DOMAIN OF THE SECOND ZERO, since
//    a zero without one is not a measurement: `noSuchMethod` occurs 20 times
//    across 14 `.dart` files in the two enforced app trees (1 file in the
//    brick's `test/`, 13 under `apps/subly/test/`, `build/` excluded), and 0 of
//    those files sit under any `lib/` path — which is what puts every one of
//    them outside the render domain.
//    (This read "the one `noSuchMethod` in either tree is a mock in the brick's
//    `test/`" until 2026-08-21. There are 14 such files, not one; the
//    conclusion — 0 across the 71 render files — was and is right, but the
//    parenthetical asserting it was never measured.)
//    (⚠️ AND "occurs 20 times" IS THE WRONG UNIT — corrected 2026-08-22, and the
//    dated sentence above is left byte-unchanged rather than repaired in place.
//    Re-measured that day over the same domain (all `.dart` under the two app
//    trees, `build/` excluded): 34 raw occurrences of the token, on 20 LINES, of
//    which 19 are `dynamic noSuchMethod` override declarations, across 14
//    distinct files, 0 of them under any `lib/` path. 20 is the matching-line
//    count — a unit the sentence does not state — and the 20th line is not an
//    override at all but a `///` doc-comment mention at
//    apps/subly/test/width_calendar_test.dart:629. The subject two lines up is
//    "0 `noSuchMethod` overrides", so the figure that belongs beside it is 19.
//    The unit matters here more than it would anywhere else: this is the guard
//    whose whole thesis is that you strip comments before you count a name, and
//    the miscount folded a comment mention into its own domain figure. Compare
//    the `consentReadPolicy` count below, which is a token count and says so.
//    THE CONCLUSION IS UNMOVED and was re-taken the same day: 0 of the 14 files
//    sit under a `lib/` path, and across the 71 render bodies `l10n[` occurs 0
//    times and `noSuchMethod` 0 times, so the domain is closed today.)
//  · A `.key` MATCH IS NOT PROOF OF A RENDER. `.appTitle` on any receiver
//    counts. The bias is deliberate and one-way: a false "rendered" silently
//    deletes an owner line, a false "unrendered" is an owner line with a
//    file:line beside it that the owner dismisses in seconds.
//  · IT READS THE ENGLISH TEMPLATE ONLY. Nothing here says anything about
//    app_ta.arb. That is also why the owner answer "delete it" means BOTH sides:
//    apps/subly/test/l10n_parity_test.dart:46 takes the whole key set and :161
//    and :186 loop over it, so deleting only the English half turns that suite
//    red.
//  · TWO ENFORCED TREES, NOT FIFTY. A key the brick declares and some future
//    stamped app renders is outside this union until that app joins
//    ENFORCED_ROOTS — the same perishable-window argument the 2026-08-11 note
//    above makes for why apps/subly was adopted when it was.
const TEMPLATE_ARB = 'l10n/app_en.arb';
/**
 * A `.<key>` accessor in a screen. Named rather than inlined so a mutation can
 * break exactly this and see whether the limb notices.
 *
 * BOTH DIRECTIONS ARE PINNED, and until 2026-08-21 only one was. The comment
 * here claimed the limb "notices, through MAX_UNREAD_SHARE" — true only of the
 * NARROWING direction, where the matcher stops matching and every key looks
 * unread (`FAILS on the REAL repo when the accessor matcher stops matching`).
 * The WIDENING direction is the dangerous one and had no input at all: replacing
 * this with `new RegExp('[.]' + key)` — dropping the trailing `\b` — makes
 * `.appTitleSuffix` satisfy `appTitle`, which deletes an owner line silently.
 * The review that found it measured that mutation GREEN on the pre-fix suite
 * (EXIT 0, 72/72 — their number, not one re-taken here, because the pre-fix
 * suite no longer exists). What IS re-taken here, 2026-08-21, is the state that
 * ships: the same mutation is RED against `a key is NOT rendered by a LONGER
 * accessor that merely starts with it`.
 */
const ACCESSOR_OF = (key) => new RegExp(`\\.${key}\\b`);
/** ARB keys are Dart identifiers by gen-l10n's own rules. Anything else cannot
 *  be turned into a regex safely, and guessing is how a scan silently narrows. */
const ARB_KEY_SHAPE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
/**
 * WHERE A NON-RENDER READER COULD BE. 🔴 THIS LIST IS THE `generate-discovery`
 * LESSON WRITTEN DOWN. Three config keys were once "proven" to have zero readers
 * by a sweep of Dart and TypeScript; the reader was JavaScript, in
 * tooling/sites/generate-discovery.mjs, and the keys were rendering three live
 * bullets on nikatru.com. An .arb key can be read by a screen, by a guard, by a
 * generator or by nothing at all, so the sweep covers the generator languages as
 * well as Dart, across the WHOLE tree rather than a named directory.
 *
 * 🔴 THE WALK READS THE WORKING TREE, SO IT DOES NOT AGREE WITH `git ls-files`,
 * AND THAT DISAGREEMENT IS THE POINT. Re-measured 2026-08-21 on this
 * workstation: the walk finds 749 files, `git ls-files` for these five
 * extensions (minus `app_localizations`, `build/`, `node_modules/`) returns 748,
 * and 359 survive the enforced-tree and IS_TEST_PATH filters to be swept. The
 * one-file gap is an UNTRACKED file — `services/platform/test/…` — which is
 * exactly the case this paragraph exists to describe: on a workstation a
 * throwaway script that happens to name a key moves that key from "nothing in
 * the tree names it" to "something else reads it", pointing the owner at a file
 * that was never committed. CI always checks out clean, so the two numbers agree
 * there. The print names file and line, so the evidence is inspectable; this
 * limb does not detect the case.
 * (This read "748 … and 748 too … 0 untracked files" until 2026-08-21. The
 * equality was inherited from earlier in the same run rather than re-taken at
 * write time; there was one untracked file by then. The swept 359 is unmoved
 * because the untracked file is under a `test/` path and IS_TEST_PATH drops it.)
 */
const CONSUMER_EXTS = ['.mjs', '.js', '.ts', '.tsx', '.dart'];
const CONSUMER_PRUNE = new Set(['build', 'node_modules']);
/** Path shapes that make a file a test. Stated rather than assumed, because it
 *  is what separates "a guard reads this key" from "only a test names it". */
const IS_TEST_PATH = /(^|\/)(tests?|integration_test)\/|(_|\.)test\.[a-z]+$/;
/**
 * ⚠️ A SANITY CEILING, NOT A FLOOR TO RE-PIN. Measured 2026-08-21: 5 of 309
 * keys, 1.6%. If `ACCESSOR_OF` stops matching, EVERY key becomes "unread" and
 * this limb would print a 309-line owner gap that reads like a catastrophe and
 * is actually a broken scan. A quarter of a reviewed corpus being unrendered is
 * not an owner backlog; it is this check having stopped checking. Left far above
 * every plausible real value on purpose — re-pinning it at whatever the tree
 * measures today is the stale-floor defect PR #85 removed from
 * assert-guard-coverage.
 */
const MAX_UNREAD_SHARE = 0.25;
/**
 * 👤 KEYS ANOTHER GUARD ALREADY PRINTS AN OWNER LINE FOR. Two lines for one key
 * is worse than none: the owner reads the second as a second gap.
 *
 * 🔴 IT IS CONDITIONAL, NOT A MUTE. The entry only suppresses the key while the
 * crediting guard still exists AND still names it IN CODE. Wire
 * `consentReadPolicy` up and it leaves the unread set anyway; delete
 * assert-consent-withdrawal-surface.mjs's limb and the key falls straight
 * through into the print below instead of disappearing. So this cannot become a
 * hole by someone editing the OTHER file, which is the only way a hardcoded
 * suppression list ever goes wrong.
 *
 * 🔴 "IN CODE" IS THE WORD THAT MAKES THAT TRUE, AND IT WAS MISSING UNTIL
 * 2026-08-21. The name check read the crediting guard's RAW bytes, comments
 * included — the one place in this limb where unstripped source ran in the
 * HIDING direction, the exact opposite of the one-way bias argued for the
 * consumer sweep below. Measured 2026-08-21: `consentReadPolicy` occurs TWICE in
 * assert-consent-withdrawal-surface.mjs, once as live code and once inside a
 * comment (2 raw → 1 after stripSourceComments). Deleting that guard's limb
 * while leaving its dated prose — which LOCKED requires, since a dated record is
 * not rewritten — therefore left the suppression standing and the key printed by
 * NOBODY, while the owner line below promised the opposite in as many words
 * ("if that limb goes, this one starts printing it"). The check now runs on
 * stripped source, so prose alone cannot hold a suppression open.
 *
 * A hand-written list is used HERE and nowhere else in this limb, and the reason
 * is that "who else already prints this" is not a property of the tree — it is a
 * fact about another guard's output, which no scan of the source can derive.
 * The unread SET itself is derived; only the de-duplication is declared.
 */
const ALREADY_PRINTED_ELSEWHERE = [
  {
    key: 'consentReadPolicy',
    by: 'tooling/ci/assert-consent-withdrawal-surface.mjs',
    why: 'the retired dialog-shaped consent prompt linked the policy and the live inline scrim does not, which is an owner/legal question that guard is the right place to ask',
  },
];

{
  const declaredIn = new Map(); // key -> [root, …]
  const englishValue = new Map(); // key -> the template value, for the literal-echo check
  let arbsRead = 0;
  for (const { root } of ENFORCED_ROOTS) {
    const abs = join(ROOT, root, ...TEMPLATE_ARB.split('/'));
    if (!existsSync(abs)) {
      problems.push(
        `COVERAGE LOST — ${root}/${TEMPLATE_ARB} does not exist, so the reverse direction read no keys for this tree. "No unrendered keys" and "the file the keys live in has moved" are the same silence from a scanner and completely different facts.`,
      );
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(abs, 'utf8'));
    } catch (e) {
      problems.push(
        `COVERAGE LOST — ${root}/${TEMPLATE_ARB} did not parse as JSON (${e.message}), so every key it declares was invisible to the reverse direction rather than checked.`,
      );
      continue;
    }
    const keys = Object.keys(parsed).filter((k) => !k.startsWith('@'));
    if (keys.length === 0) {
      problems.push(
        `COVERAGE LOST — ${root}/${TEMPLATE_ARB} declares no message keys, so the reverse direction ranged over nothing there and its clean result is a statement about an empty file.`,
      );
      continue;
    }
    // 🔴 THIS TRIPWIRE SHIPPED UNFALSIFIABLE AND WAS PINNED ON 2026-08-21.
    // Measured that day: replacing the condition below with `if (false)` left
    // `node --test tooling/ci/test/no-hardcoded-strings.test.mjs` at EXIT 0,
    // tests 69, pass 69, fail 0 — no input in the suite reached it, so it could
    // be deleted for free while still being able to redden a real build. Both
    // real arbs hold only identifiers (measured: 155 + 309 keys, 0 odd), which
    // is exactly why the fixture has to carry the input; the test that pins it
    // is `FAILS when the arb declares a key that is not a Dart identifier`.
    const odd = keys.filter((k) => !ARB_KEY_SHAPE.test(k));
    if (odd.length > 0) {
      problems.push(
        `COVERAGE LOST — ${root}/${TEMPLATE_ARB} declares ${odd.length} key(s) that are not Dart identifiers (${odd.slice(0, 3).join(', ')}), and this limb builds a regex per key. They were SKIPPED rather than checked, so the count below does not cover them.`,
      );
    }
    arbsRead++;
    for (const k of keys) {
      if (!ARB_KEY_SHAPE.test(k)) continue;
      if (!declaredIn.has(k)) {
        declaredIn.set(k, []);
        englishValue.set(k, String(parsed[k]));
      }
      declaredIn.get(k).push(root);
    }
  }

  // The render domain: the SAME files the forward limb enforces, narrowed by two
  // STATED exclusions, which is what makes the two halves provably one domain
  // rather than two lists that agree today.
  //
  // 🔴 BOTH EXCLUSIONS ARE LATENT ON THIS TREE AND BOTH HAVE A FAILING INPUT
  // (2026-08-21). Re-measured that day over the 71 `.dart` files the two roots
  // hold once `app_localizations*` is dropped: 0 sit under a `/l10n/` path and 0
  // match IS_TEST_PATH, so the printed 71 is the same number with or without
  // this filter — which is exactly the state in which a clause quietly stops
  // being checked by anything.
  //  · `/l10n/` goes on top of the generated-file NAME skip, and is not
  //    redundant with it: `readDartTree` filters on the BASENAME, so a
  //    hand-written `lib/l10n/l10n_extensions.dart` is caught by this clause and
  //    by nothing else. A getter declared there is the output of l10n, not a
  //    render of it. Pinned by `does NOT treat a hand-written file under
  //    lib/l10n/ as a render surface`, and RED against it when dropped; the
  //    review that found it reports the pre-fix suite stayed green.
  //  · IS_TEST_PATH is applied HERE rather than asserted in the print, because
  //    the domain sentence below calls these files "non-test" and until this
  //    line existed nothing made that adjective true: `readDartTree` filters
  //    only `app_localizations`, while the consumer sweep applies IS_TEST_PATH
  //    explicitly — so the two halves of what the print calls ONE domain were
  //    using two different rules for the same word. What it forecloses is a
  //    `_test.dart` landing under `apps/subly/lib` and counting as a render
  //    surface: a test that merely NAMES a key would then delete an owner line,
  //    while the byte-identical file one directory up is correctly excluded from
  //    the consumer sweep. Pinned by `does NOT treat a _test.dart under an
  //    enforced tree as a render surface`.
  // The forward limb is deliberately NOT narrowed: a hardcoded literal under
  // `lib/` is a violation wherever it sits.
  const renderFiles = ENFORCED_ROOTS.flatMap(({ root }) => readDartTree(root)).filter(
    (f) => !f.rel.includes('/l10n/') && !IS_TEST_PATH.test(f.rel),
  );

  // Everything else in the tree, in the languages a non-render reader is written
  // in. Walked through `listDir`, so nested checkouts and `.claude` are out.
  //
  // 🔴 EVERY `continue` IN THIS WALK NARROWS THE SWEEP, so every one of them is
  // a place a real reader can be lost, and every one of them has a failing input
  // as of 2026-08-21 (`the non-render sweep is narrowed only in ways that have a
  // failing input`): the dot-directory skip, `CONSUMER_PRUNE`, the extension
  // list, the `app_localizations` name skip, `inEnforced` and `IS_TEST_PATH`.
  // Before that date the first four had none — a hand-written `node_modules`
  // could have grown to `node_modules|docs` and no test would have moved.
  const consumerFiles = [];
  {
    // `rel` is always a FILE path here, so the `rel === root` half this carried
    // until 2026-08-21 could never be true — a condition with no reachable input,
    // which is the thing this pass exists to remove rather than to leave looking
    // like a guard. The prefix test is the whole rule.
    const inEnforced = (rel) => ENFORCED_ROOTS.some(({ root }) => rel.startsWith(`${root}/`));
    const walk = (d) => {
      for (const entry of listDir(d, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.') || CONSUMER_PRUNE.has(entry.name)) continue;
          walk(join(d, entry.name));
          continue;
        }
        if (!CONSUMER_EXTS.some((x) => entry.name.endsWith(x))) continue;
        if (/app_localizations/.test(entry.name)) continue;
        const rel = relative(ROOT, join(d, entry.name)).replace(/\\/g, '/');
        if (inEnforced(rel) || IS_TEST_PATH.test(rel)) continue;
        consumerFiles.push(rel);
      }
    };
    walk(ROOT);
  }

  if (arbsRead === 0) {
    // Already reported above, per root. Nothing further can be said.
  } else if (renderFiles.length === 0) {
    problems.push(
      `COVERAGE LOST — the reverse direction found ${declaredIn.size} declared key(s) and ZERO non-test .dart file(s) to look for accessors in, across ${ENFORCED_ROOTS.length} enforced tree(s). Every key would read as unrendered, which is a broken scan wearing the costume of a finding.`,
    );
  } else if (consumerFiles.length === 0) {
    problems.push(
      `COVERAGE LOST — the reverse direction found no ${CONSUMER_EXTS.join('/')} file(s) outside the enforced trees, so "nothing else reads this key" below would be a statement about an empty sweep. That is the sweep the generate-discovery.mjs incident was about.`,
    );
  } else {
    const renderBody = renderFiles.map((f) => f.body).join('\n');
    const unread = [...declaredIn.keys()].filter((k) => !ACCESSOR_OF(k).test(renderBody));

    if (unread.length > declaredIn.size * MAX_UNREAD_SHARE) {
      problems.push(
        `COVERAGE LOST — ${unread.length} of ${declaredIn.size} declared key(s) reached no accessor across ${renderFiles.length} non-test .dart file(s). That is over ${Math.round(MAX_UNREAD_SHARE * 100)}% of a reviewed, translated corpus, which is not an owner backlog: the accessor matcher has stopped matching. The owner gap this limb exists to print has been SUPPRESSED rather than printed, because a list that long is noise.`,
      );
    } else {
      // The de-duplication, applied only while the crediting guard still names
      // the key. See ALREADY_PRINTED_ELSEWHERE.
      const suppressed = ALREADY_PRINTED_ELSEWHERE.filter((e) => {
        if (!unread.includes(e.key)) return false;
        const abs = join(ROOT, e.by);
        if (!existsSync(abs)) return false;
        // STRIPPED, not raw — see ALREADY_PRINTED_ELSEWHERE. A key named only in
        // the crediting guard's prose is named by nobody who prints.
        const crediting = stripSourceComments(readFileSync(abs, 'utf8'), e.by.slice(e.by.lastIndexOf('.')));
        return new RegExp(`\\b${e.key}\\b`).test(crediting);
      });
      const printable = unread.filter((k) => !suppressed.some((e) => e.key === k));

      // Who else names the key, and where its English copy already ships as a
      // literal. Both derived; neither is a list of key names.
      const consumers = new Map(printable.map((k) => [k, []]));
      const echoes = new Map(printable.map((k) => [k, []]));
      if (printable.length > 0) {
        const anyKey = new RegExp(`\\b(${printable.join('|')})\\b`);
        for (const rel of consumerFiles) {
          const raw = readFileSync(join(ROOT, rel), 'utf8');
          // ⚠️ A SPEED SKIP, NOT A TRIPWIRE, AND CLAIMED AS NOTHING. A file that
          // mentions neither a key nor a value cannot contribute either way, so
          // skipping the strip for it changes the ANSWER not at all and only the
          // cost: measured 2026-08-21 on this workstation, median of five runs
          // each, the whole guard takes 1.89 s with this line and 4.43 s without
          // — a wall-clock figure, so read the RATIO (about 2.3x) rather than the
          // seconds, which move with the machine. Disabling it is therefore a
          // strict WIDENING — it reads more files and reports the same thing —
          // so no test can go red on `if (false)` here and none
          // claims to. The direction that WOULD hide a reader, always skipping,
          // is caught by the consumer and echo cases below.
          // (This read "keeps this limb under a second on the real tree" until
          // 2026-08-21. No such measurement was taken; the two numbers above
          // were, and they are of the guard, not of the limb alone.)
          if (!anyKey.test(raw) && !printable.some((k) => raw.includes(englishValue.get(k)))) continue;
          // 🔴 An extension `stripSourceComments` does not know comes back
          // VERBATIM AND SILENTLY. That bias runs one way here and it is the
          // safe way: an unstripped comment can only MANUFACTURE a reader, never
          // hide one, so it can move a key from "nothing reads it" to "this file
          // names it — go and look". The line printed names file and line, so
          // the owner is pointed at the evidence rather than told a conclusion.
          const lines = stripSourceComments(raw, rel.slice(rel.lastIndexOf('.'))).split('\n');
          for (let i = 0; i < lines.length; i++) {
            for (const k of printable) {
              if (new RegExp(`\\b${k}\\b`).test(lines[i])) consumers.get(k).push(`${rel}:${i + 1}`);
              const v = englishValue.get(k);
              // `v !== ''` is not defensive text: an arb key whose English value
              // is the empty string makes `''` and `""` the needle, so EVERY
              // consumer line carrying an empty literal would be reported to the
              // owner as "its English copy ships as a hardcoded LITERAL at
              // <file:line>" — a file:line pointing at nothing, in the one print
              // whose whole promise is that the evidence is inspectable. Pinned
              // 2026-08-21 by `a key with an EMPTY English value reports no
              // literal echo`, and RED against it when dropped; the review that
              // found it reports the pre-fix suite stayed green.
              if (v !== '' && (lines[i].includes(`'${v}'`) || lines[i].includes(`"${v}"`))) {
                echoes.get(k).push(`${rel}:${i + 1}`);
              }
            }
          }
        }
      }

      const where = (k) => `${k} [declared in ${declaredIn.get(k).length} of ${ENFORCED_ROOTS.length} enforced tree(s)]`;
      const site = (list) => `${list[0]}${list.length > 1 ? ` (+${list.length - 1} more)` : ''}`;
      const read = printable.filter((k) => consumers.get(k).length > 0);
      const dark = printable.filter((k) => consumers.get(k).length === 0);
      const domain =
        `${declaredIn.size} message key(s) from ${arbsRead} tracked ${TEMPLATE_ARB} file(s) · ` +
        `${renderFiles.length} non-test .dart file(s) in ${ENFORCED_ROOTS.length} enforced tree(s) searched for a \`.<key>\` accessor · ` +
        `${consumerFiles.length} non-test ${CONSUMER_EXTS.join('/')} file(s) elsewhere searched for any other reader. ` +
        'Generated gen-l10n accessors are excluded from both — they declare a getter for every key, so counting them would make all of them "read".';

      // 🔴 THE SUPPRESSION NOTE IS NOT PART OF THE OWNER BRANCH (fixed
      // 2026-08-21). It used to live only inside the `else`, so when the ONLY
      // unread key was a suppressed one the guard took the `ok …` branch and
      // printed "every declared l10n key reaches a screen" while knowing a key
      // reached none, and the line naming the guard that owns it was never
      // emitted at all. Latent on the real tree — there are 4 other printable
      // keys today — which is precisely why it needed an input rather than an
      // argument; `PRINTS the crediting line even when the suppressed key is the
      // ONLY unread one` is it.
      const creditLines = suppressed.map(
        (e) =>
          `    · ${e.key} is unrendered too and is deliberately NOT listed above: ${e.by} already prints its own 👤 OWNER line for it (${e.why}). Two lines for one key is worse than none; if that limb goes, this one starts printing it.`,
      );

      if (printable.length === 0 && suppressed.length === 0) {
        ok(`every declared l10n key reaches a screen (${domain})`);
      } else if (printable.length === 0) {
        notes.push(
          [
            `👤 OWNER l10n render direction — 0 of ${declaredIn.size} translated, reviewed key(s) need a line here, and ${suppressed.length} unrendered key(s) are printed by the guard that owns them.`,
            `    DOMAIN, so the number above is a measurement and not a blind spot: ${domain}`,
            ...creditLines,
          ].join('\n'),
        );
      } else {
        const lines = [
          `👤 OWNER l10n render direction — ${printable.length} translated, reviewed key(s) of ${declaredIn.size} reach NO surface.`,
          `    DOMAIN, so the number above is a measurement and not a blind spot: ${domain}`,
          '    Whether such a key should be rendered, deleted, or is waiting on a surface nobody has built yet is an OWNER',
          '    judgement, so this prints and never fails. Any of those three answers stops the line appearing.',
        ];
        if (read.length > 0) {
          lines.push(
            `    · NOT RENDERED, BUT SOMETHING ELSE READS THE KEY — do not delete before reading the consumer (${read.length}):`,
          );
          for (const k of read) lines.push(`        ${where(k)} — read at ${site(consumers.get(k))}`);
        }
        if (dark.length > 0) {
          lines.push(`    · NOTHING IN THE TREE NAMES THE KEY AT ALL (${dark.length}):`);
          for (const k of dark) {
            const echo = echoes.get(k);
            lines.push(
              echo.length > 0
                ? `        ${where(k)} — but its English copy ships as a hardcoded LITERAL at ${site(echo)}. The surface exists and does not read l10n from there, so "delete the key" and "make that surface localisable" are different owner answers, and a Tamil user reads English until one is chosen.`
                : `        ${where(k)} — and its English copy appears nowhere else in the tree either. Nothing shows this string.`,
            );
          }
        }
        lines.push(...creditLines);
        notes.push(lines.join('\n'));
      }
    }
  }
}

if (notes.length) {
  console.log('');
  for (const n of notes) console.log(n);
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-no-hardcoded-strings: FAILED');
  process.exitCode = 1;
} else {
  console.log(
    `\nassert-no-hardcoded-strings: ok — ${ENFORCED_ROOTS.length} enforced tree(s) are clean, and the matchers are proven to still match`,
  );
}
