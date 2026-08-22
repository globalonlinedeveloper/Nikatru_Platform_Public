// ─────────────────────────────────────────────────────────────────────────────
// no-hardcoded-strings.test.mjs — assert-no-hardcoded-strings.mjs must FAIL.
//
// [pipeline C-12, second clause] Zero hardcoded user-facing strings (DoD §4-E).
//
// ⚠️ SECOND LINE OF EVIDENCE. Five mutations ran against the REAL tree first:
//   1. a nav label hardcoded again                        → caught
//   2. a `Text()` literal reintroduced                    → caught
//   3. interpolation replaced by a plain literal          → caught
//   4. a NON user-facing literal (a snake_case key, a hex colour) → correctly
//      SILENT, which matters as much as the catches
//   5. the matchers themselves broken → the brick still printed "clean" and the
//      CANARY fired. That is the whole reason the canary exists.
//
// 🔬 THE GUARD FOUND SIX VIOLATIONS I HAD MISSED BY EYE — the consent prompt's
// title and both body paragraphs, and all three navigation labels. Reading the
// file was not enough; running the matcher was.
//
// WHY A CANARY AT ALL: the brick is clean, so every enforcement assertion passes
// over an EMPTY result set — indistinguishable from a scanner that has stopped
// matching. This stage already shipped three checks that ranged over nothing, so
// the matchers are proven against trees known to be full of violations.
//
// ── 2026-08-08 · SEVEN MORE MUTATIONS, ALL AGAINST THE REAL TREE ────────────
// The canary moved off `apps/subly/lib` and onto a fixture this guard owns
// (`tooling/ci/test/fixtures/dirty-strings`), because Subly's l10n retrofit was
// about to clean the canary and turn the guard RED BY IMPROVEMENT. Everything
// added in that change was mutation-proven on the real repository, not on a
// fixture written by the same hand as the guard:
//   6. the labelling matcher DELETED from the list → the old guard exited 0
//      (measured, `git show HEAD:` + splice); the new one exits 1 on the
//      declaration identity. Both canary floors — 22 and 58 — still cleared it,
//      which is exactly why a floor could never have caught this.
//      (Re-measured 2026-08-08 with one canary left: the fixture still clears
//      the floor at 32 with the family gone, and the mutation is still caught.)
//   7. the labelling regex made unmatchable but LEFT IN THE LIST → caught by the
//      per-family evidence check, in BOTH canaries.
//   8. a matcher family ADDED with no fixture evidence → caught twice over.
//   9. the fixture's `dirty/` directory removed → COVERAGE LOST.
//  10. the fixture's `dirty/` emptied of literals (the retrofit shape) → COVERAGE
//      LOST, not a pass.
//  11. `expected-families.txt` deleted → COVERAGE LOST.
//  12. the hex-colour exemption deleted → the quiet fixture's `#6459F5` starts
//      counting and is named.
//  13. one exemption's near miss removed from `quiet/` → COVERAGE LOST naming
//      the exemption that no longer has an input reaching it.
// Cases 6 and 7 are re-run below AGAINST THE REAL REPOSITORY rather than a
// fixture, because a fixture I wrote encodes the same misunderstanding as the
// guard I wrote — this repo has already shipped a guard whose six fixture tests
// all passed against a broken version.
//
// ── 2026-08-08 · THE apps/subly CANARY IS RETIRED (P4 L0) ───────────────────
// The guard's second canary was the product tree `apps/subly/lib`, and its own
// entry named the increment that would remove it: Subly's l10n retrofit, which
// is the change this edit ships with. Three cases below changed rather than
// vanished, because "the tree is no longer a canary" is itself a claim that
// needs a failing input:
//   · the two-canary output assertion became a ONE-canary assertion that also
//     requires apps/subly to be absent from the output entirely;
//   · "FAILS when the apps/subly canary stops looking dirty" became "PASSES when
//     apps/subly/lib is clean" — RED BY IMPROVEMENT was the whole failure mode
//     being removed, so the input that used to fail must now pass, and against
//     the pre-retirement guard this case fails;
//   · "a family missing from ONE canary while the other still has it" has no
//     second canary to describe, and became the REAL-REPO measurement that the
//     surviving fixture clears the floor on its own.
// Deleting them instead would have left the retirement asserted by nothing.
//
// ── 2026-08-21 · THE REVERSE LIMB'S TRIPWIRES, WALKED ONE BY ONE ────────────
// Two adversarial reviews of the reverse limb found the same class of defect
// twice — an assertion nothing can falsify — so every condition the new block
// adds was disabled individually against the REAL tree and the suite re-run.
// Baseline before any of it: EXIT 0, tests 69, pass 69, fail 0.
//   RED when disabled (so an input reaches them): the missing-arb, unparseable-
//   arb, no-message-keys, no-render-files, no-consumer-files and
//   MAX_UNREAD_SHARE branches; the `printable.length > 0` consumer sweep; the
//   ok/print fork; both bucket headers; the literal-echo line; the consumer
//   line-match; the enforced/test exclusion in the consumer walk; and the final
//   `notes.length` print.
//   GREEN when disabled, i.e. DEFECTS, and the reason three cases below exist:
//     · `if (odd.length > 0)` — the non-Dart-identifier COVERAGE-LOST branch.
//       EXIT 0, 69/69 with it deleted. Both real arbs hold identifiers only
//       (155 + 309 keys, 0 odd), so only a fixture can reach it → `FAILS when
//       the arb declares a key that is not a Dart identifier`.
//     · the DOMAIN sentence — replaced by a literal `DOMAIN: (elided)`, still
//       EXIT 0, 69/69, on the fixture AND real-repo paths. It was asserted only
//       on the `ok …` branch, never on the 👤 OWNER branch that actually prints
//       a gap, and it is the only thing separating this print from a bare
//       "0 unread keys" → assertions added to `PRINTS an unrendered key…` and
//       to `prints the three dead keys…`.
//     · `if (!unread.includes(e.key))` — the half of the de-duplication that is
//       conditional on the key still being unread. EXIT 0 with it deleted, so a
//       key the owner had already wired up kept drawing a "deliberately NOT
//       listed above" line → `stops crediting the other guard once the key IS
//       rendered`.
//   NOT ASSERTED, DELIBERATELY, and named so the next reader is not misled:
//   the `!anyKey.test(raw) && …` pre-filter is a speed skip whose disabling is
//   a strict WIDENING (it reads more files, same answer); the direction that
//   would hide a reader — always skipping — is caught by the consumer and echo
//   cases. And `/app_localizations/` in the CONSUMER walk is redundant today:
//   every generated file lives under an enforced root and is already dropped by
//   `inEnforced`, so no input distinguishes it. Left in place rather than
//   removed, and claimed as nothing.
//   Each of the three fixes above was then re-mutated with its test in place and
//   confirmed RED: 72 tests, 71 pass, 1 fail, and the failing name is the one
//   written beside it. The `non-test` adjective fix was proven the same way —
//   dropping `IS_TEST_PATH` from the render domain fails `does NOT treat a
//   _test.dart under an enforced tree as a render surface`, 72/71/1.
//
// ── 2026-08-21 · 🔴 THAT SWEEP WAS NOT EXHAUSTIVE, AND SAYING IT WAS IS THE ──
// ── WORSE HALF OF THE DEFECT. ───────────────────────────────────────────────
// The block above says "every condition the new block adds was disabled
// individually". A tenth adversarial review refuted that with counter-examples
// and was right: MORE conditions survived `if (false)` on that suite, and one of
// them made the guard PRINT the owner a promise the code could not keep. A
// record claiming a sweep was exhaustive is worse than no record, because the
// next reader stops looking — so this correction is APPENDED and the paragraphs
// above are left byte-unchanged rather than quietly repaired.
//
// WHAT WAS MISSED, and where each is pinned now:
//   1. 🔴 the crediting-guard name check ran on RAW bytes, so `consentReadPolicy`
//      surviving only inside a COMMENT there held the suppression open — while
//      the print told the owner "if that limb goes, this one starts printing
//      it". Measured 2026-08-21: that key occurs twice in the real crediting
//      guard, once as code and once in prose, and LOCKED forbids rewriting the
//      dated prose, so deleting the limb the legal way leaves exactly that
//      input. The guard now strips before testing the name →
//      `stops crediting a guard that names the key only in a COMMENT`.
//   2. `!f.rel.includes('/l10n/')` in the render domain — not redundant with the
//      `app_localizations` name skip, because that one matches on the BASENAME →
//      `does NOT treat a hand-written file under lib/l10n/ as a render surface`.
//   3. `v !== ''` on the literal-echo check → `a key with an EMPTY English value
//      reports no literal echo`.
//   4. ACCESSOR_OF's trailing `\b`, in the WIDENING direction (`.appTitleSuffix`
//      satisfying `appTitle`) → `a key is NOT rendered by a LONGER accessor that
//      merely starts with it`.
//   5. FOUR `continue`s in the non-render walk — the dot-directory skip,
//      CONSUMER_PRUNE, the extension list and the `app_localizations` name skip.
//      All four now have an input → `the non-render sweep is narrowed only in
//      ways that have a failing input`. ⚠️ The dot-directory decoy must NOT be
//      under `.claude`: `listDir` drops that name itself (tree-walk.mjs's
//      SCRATCH_DIR_NAME), so a `.claude` decoy leaves the mutation GREEN — the
//      first version of this case did exactly that and proved nothing.
//   6. `if (arbsRead === 0)`, whose body is an empty block and therefore reads
//      like a comment. Without it a run where NO tree has an arb prints
//      `ok every declared l10n key reaches a screen` over zero keys →
//      `FAILS when NEITHER enforced tree has an app_en.arb…`.
//   7. `site()`'s `(+N more)` count → `names one reader site and counts the rest`.
//   8. 🔴 the ok/print fork itself: when the ONLY unread key was a suppressed
//      one, `printable.length === 0` sent the guard down the `ok …` branch — it
//      printed "every declared l10n key reaches a screen" while knowing one
//      reached none, and the crediting line lived only in the other branch so
//      nothing was said at all. The suppression lines are now built once and
//      emitted on both branches → `PRINTS the crediting line even when the
//      suppressed key is the ONLY unread one`.
// CORRECTING THE PARAGRAPH ABOVE: `/app_localizations/` in the CONSUMER walk is
// no longer "redundant today … claimed as nothing" — item 5 gives it an input,
// and it was never redundant by construction, only by the tree's current shape.
// The pre-filter claim is unchanged and still honest: disabling it is a strict
// widening, so no test can go red on `if (false)` there and none claims to.
//
// TWO CONDITIONS WERE DELETED RATHER THAN PINNED, which is the other legal
// answer to an unfalsifiable condition: `inEnforced`'s `rel === root` half (the
// argument is always a FILE path, so it could never be true) and the
// `for (const e of suppressed)` loop that existed only inside the owner branch.
//
// ── THE CORRECTED SWEEP, AND HOW TO RE-RUN IT ──────────────────────────────
// Method, so the next reader can repeat it rather than trust it: the guard and
// its two relative imports were copied into a scratch mirror alongside a copy of
// THIS file with its `REPO` constant repointed at the real repository — so the
// `against the REAL repository` cases still ran against the real tree, and no
// mutated guard ever existed inside the checkout. One condition mutated per run,
// whole file re-run, `code=$?` captured on its own line.
// Baseline in that mirror before any mutation: EXIT 0, tests 80, pass 80, fail 0
// — identical to the working tree, which is what makes the mirror admissible.
//
// FORTY-ONE conditions, every one of them in or reached by this block, each
// disabled alone. FORTY came back RED. The enumeration, so "every" is a list and
// not an adjective: the four per-arb COVERAGE-LOST branches (missing,
// unparseable, no-message-keys, non-identifier) · the `@`-metadata filter · the
// odd-key `continue` · the first-declaration-wins guard · both render-domain
// exclusions (`/l10n/`, IS_TEST_PATH) · all six narrowings in the non-render
// walk (dot-directory, CONSUMER_PRUNE, extension list, `app_localizations`,
// `inEnforced`, IS_TEST_PATH) · `arbsRead === 0` · the empty-render and
// empty-consumer branches · ACCESSOR_OF's trailing `\b` · MAX_UNREAD_SHARE · all
// three halves of the suppression filter (still-unread, file-exists,
// names-it-in-stripped-code) plus the strip itself · `printable` ·
// `printable.length > 0` · the consumer line match · both halves of the
// literal-echo test · `site()`'s count · `where()`'s count · the DOMAIN sentence
// · all three arms of the ok/print fork · both bucket headers · the echo ternary
// · `creditLines` · the final `notes.length` print.
// THE ONE GREEN IS THE PRE-FILTER, and it is green BY CONSTRUCTION rather than
// by omission: disabling `if (!anyKey.test(raw) && …) continue;` makes the sweep
// read MORE files and return the same answer, so no test can go red on it. It is
// claimed as nothing, here and at its own line, and its dangerous direction —
// always skipping — is covered by the consumer and echo cases.
//
// ── 2026-08-22 · THAT SWEEP WAS NOT EXHAUSTIVE EITHER, AND THE GAP WAS A ────
// ── BOUNDARY RATHER THAN A CONDITION. ───────────────────────────────────────
// The 41-condition block above is left byte-unchanged and every one of its
// verdicts reproduced this day. What it missed is where it stopped looking: it
// enumerated the reverse limb and the non-render walk and treated
// `readDartTree` as inherited code. `readDartTree` is not inherited — the same
// change SPLIT it out of `scanRaw` so both limbs provably range over one
// domain, which is exactly what makes every clause inside it load-bearing for a
// limb that did not exist before.
//
// Method identical to the block above, so the two runs are comparable: guard
// plus its two relative imports copied into a scratch mirror, a copy of THIS
// file with `REPO` repointed at the real repository, ONE condition disabled per
// run, the whole file re-run, `code=$?` captured on its own line, and no
// mutated guard ever inside the checkout. Baseline in that mirror before any
// mutation: EXIT 0, tests 80, pass 80, fail 0 — identical to the working tree.
//
// FORTY-NINE conditions this time, in 54 runs — the extra five runs are second
// DIRECTIONS on a condition already counted (`if (true)` as well as
// `if (false)` on the first-declaration-wins guard, both directions of
// ACCESSOR_OF) plus two mutations re-run in corrected form, see the trap below.
// The eight beyond the 41 above are `readDartTree`'s four — the `existsSync`
// short-circuit, the directory recursion, the `.dart` extension filter and the
// `app_localizations` name skip — and four the earlier list folded into a
// neighbour's row rather than disabling on its own: the DIRECTORY RECURSION in
// the non-render walk (that list says "all six narrowings" and there are seven
// `continue`-shaped decisions there), the consumer line loop bound, and the
// `read` and `dark` partition predicates behind the two bucket headers.
//
// 🔴 ONE NEW GREEN, i.e. one more assertion nothing could falsify, and it is a
// HIDING one: `if (!entry.endsWith('.dart')) continue;`. `if (false)` on it left
// the file at EXIT 0, 80/80/0. Measured the same day, the whole reason nothing
// reached it: the only non-`.dart` files under the two enforced trees are the
// four `.arb` files, and all four sit under `/l10n/`, which the render-domain
// filter drops anyway. Now pinned by `does NOT treat a non-.dart file under an
// enforced tree as a render surface`, and RED against it when dropped.
// Everything else came back RED, and the pre-filter is still the one green
// claimed as nothing.
//
// ⚠️ AND A METHOD TRAP THIS RUN WALKED INTO, recorded because it would have
// been reported as two findings: a mutation that changes the SOURCE can still
// change nothing. `const x = '(elided)' && <expr>` and `const x = [] && <expr>`
// both evaluate to `<expr>` in JavaScript, so the first-draft mutations of the
// DOMAIN sentence and of `creditLines` were semantic no-ops and came back GREEN
// on a limb that is properly pinned. `guardCopy`'s `assert.notEqual(out, src)`
// catches a TEXTUAL no-op and cannot catch this one. Re-run in corrected form,
// both are RED — the DOMAIN sentence against `says so, with the domain sizes,
// when every declared key reaches a screen` (8 cases), `creditLines` against
// `PRINTS the crediting line even when the suppressed key is the ONLY unread
// one`. A GREEN row is only a finding once the mutation is shown to have
// changed behaviour.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-no-hardcoded-strings.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-strings-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib';
const SUBLY = 'apps/subly/lib';
const FIXTURE = 'tooling/ci/test/fixtures/dirty-strings';

// A clean brick: every visible string comes from l10n.
const CLEAN_BRICK = `
class HomeScreen extends StatelessWidget {
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return AppScaffold(
      title: Text(l10n.appTitle),
      destinations: [
        AppDestination(icon: Icons.home, label: l10n.navHome),
      ],
      body: Text(l10n.welcomeTo(AppConfig.appName)),
    );
  }
}
`;

/**
 * A canary tree needs to be KNOWN dirty, at or above the floor of 20 — the real
 * fixture holds 32 (23 `Text(…)` + 9 labelling), measured 2026-08-08. A fixture
 * below the floor would fail for the wrong reason, and one with NO dirty tree
 * would let broken matchers look clean, which is the exact failure the canary
 * exists to catch.
 *
 * 🔴 DIRTY IN EVERY WAY THE GUARD MATCHES, not only the commonest one
 * (2026-08-01). The guard requires each matcher FAMILY to show its own evidence,
 * because 23 of the fixture's 32 hits are `Text(…)` — so deleting the
 * labelling-parameter matcher outright still clears the total floor by a wide
 * margin and prints "matchers verified". A tree dirty in only one way would
 * encode exactly that blind spot; `labelled` is the second family's evidence.
 */
function dirtyTree(n = 25, labelled = 4) {
  let s = 'class S extends StatelessWidget {\n  Widget build(BuildContext c) {\n    return Column(children: [\n';
  for (let i = 0; i < n; i++) s += `      Text('Legacy label number ${i}'),\n`;
  for (let i = 0; i < labelled; i++) s += `      AppTile(label: 'Legacy tile number ${i}'),\n`;
  return `${s}    ]);\n  }\n}\n`;
}

/**
 * The quiet half of the fixture: ONE near miss per NOT_USER_FACING exemption, in
 * positions the matchers do look at. The guard asserts both directions over it —
 * every exemption must be reached by something here, and nothing here may count
 * — so a tree missing one line is a genuinely different input, not noise.
 */
const QUIET = `
class Q extends StatelessWidget {
  Widget build(BuildContext c) {
    return Column(children: [
      Text(''),
      Text('analytics_opt_in'),
      Text('PLATFORM_BASE_URL'),
      Text('#6459F5'),
      Text('https://nikatru.com/privacy'),
      Text('{{app_id}}'),
      Text(' — '),
      Text('\${s.category} · \$usage'),
    ]);
  }
}
`;

/** The declaration the guard holds its own matcher list against. */
const FAMILIES = '# comments and blanks are ignored\n\nText(…)\na labelling parameter\n';

// ⚠️ THE `subly` PARAMETER IS BACK, and it means the OPPOSITE of what it meant
// before 2026-08-08. It used to plant a DIRTY `apps/subly/lib` because the guard
// needed a known-dirty canary there; from 2026-08-11 that tree is ENFORCED, so
// the default is CLEAN and a dirty one is a failure. Same directory, opposite
// obligation — which is why the cases below assert on both.
const CLEAN_SUBLY = `
class SublyHome extends StatelessWidget {
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Column(children: [
      Text(l10n.homeTitle),
      Text('\${s.category} · \$usage'),
    ]);
  }
}
`;

/** The one literal the guard's ALLOWED list waives, at the path it waives it
 *  for. A fixture root without it makes the waiver stale, which is itself a
 *  failure — so it is planted by default and removed deliberately. */
const ALLOWLISTED_FILE = `${SUBLY}/features/auth/login_screen.dart`;
const ALLOWLISTED = "const probe = Text('debug: $detail');\n";

// ── 2026-08-21 · THE REVERSE DIRECTION NEEDS AN .arb IN EVERY FIXTURE TREE ───
// The guard now also asks which DECLARED keys reach no screen, so a fixture with
// no `l10n/app_en.arb` is not a clean tree — it is a tree the reverse limb could
// not read, and it says so as COVERAGE LOST. Each root's arb is planted with the
// root itself and removed with it, so "the tree is gone" stays one input rather
// than becoming two half-states.
//
// 🔴 THE TWO DEFAULT ARBs ARE DISJOINT ON PURPOSE. The real trees overlap
// heavily — the brick's 155 keys are a subset of subly's 309 — and the union
// domain is what makes that safe. Overlapping them HERE would hide the opposite
// failure: a default fixture where every key is declared in both trees cannot
// tell a per-root scan from a union scan, so the union decision would be
// untested by construction. The overlap is exercised deliberately instead, in
// `the reader domain is the union of the enforced trees` below.
const arb = (o) => (typeof o === 'string' ? o : `${JSON.stringify(o, null, 2)}\n`);
const BRICK_ARB = { '@@locale': 'en', appTitle: 'Demo', navHome: 'Home', welcomeTo: 'Welcome to {name}' };
const SUBLY_ARB = { '@@locale': 'en', homeTitle: 'Your subscriptions' };

/** The rest of the tree — where a NON-render reader lives. The reverse limb
 *  refuses to report "nothing else reads this key" when it swept nothing, so a
 *  fixture with no consumer files at all is COVERAGE LOST rather than a clean
 *  run. The default is the real crediting guard's one live line, because the
 *  de-duplication of `consentReadPolicy` is keyed to that file existing. */
const CONSENT_GUARD = 'tooling/ci/assert-consent-withdrawal-surface.mjs';
const CONSUMERS = { [CONSENT_GUARD]: "const POLICY_LINK_KEY = 'consentReadPolicy';\n" };

function tree({
  brick = CLEAN_BRICK,
  subly = CLEAN_SUBLY,
  allowlisted = ALLOWLISTED,
  fixture = dirtyTree(),
  quiet = QUIET,
  families = FAMILIES,
  omitBrick = false,
  brickArb = BRICK_ARB,
  sublyArb = SUBLY_ARB,
  consumers = CONSUMERS,
} = {}) {
  const root = join(TMP, `r${seq++}`);
  const files = {};
  if (!omitBrick) {
    if (brick !== null) files[`${BRICK}/features/home/home_screen.dart`] = brick;
    if (brickArb !== null) files[`${BRICK}/l10n/app_en.arb`] = arb(brickArb);
  }
  if (subly !== null) files[`${SUBLY}/features/home/home_screen.dart`] = subly;
  if (allowlisted !== null) files[ALLOWLISTED_FILE] = allowlisted;
  // The arb belongs to the ROOT, so it is planted whenever the root will exist
  // at all — otherwise "the enforced tree is gone" and "its arb is gone" become
  // two different inputs and every existing case would have to say which it meant.
  if ((subly !== null || allowlisted !== null) && sublyArb !== null) {
    files[`${SUBLY}/l10n/app_en.arb`] = arb(sublyArb);
  }
  for (const [rel, body] of Object.entries(consumers ?? {})) files[rel] = body;
  if (fixture !== null) files[`${FIXTURE}/dirty/legacy_screen.dart`] = fixture;
  if (quiet !== null) files[`${FIXTURE}/quiet/not_user_facing.dart`] = quiet;
  if (families !== null) files[`${FIXTURE}/expected-families.txt`] = families;
  for (const [f, body] of Object.entries(files)) {
    const p = join(root, f);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

const run = (cwd, guard = GUARD) => {
  const r = spawnSync(process.execPath, [guard], { cwd, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

/**
 * A RUNNABLE COPY OF THE REAL GUARD, optionally mutated, to be pointed at the
 * REAL repository.
 *
 * ⚠️ This is the lesson from `assert-seams-wired.mjs`, which shipped with a
 * caller check that matched the function's own declaration: ALL SIX of its
 * fixture tests passed against the broken version, and only breaking the actual
 * repo exposed it. A fixture written by the same hand as the guard encodes the
 * same misunderstanding.
 *
 * The guard's shared modules are copied alongside it — DERIVED from the import
 * statements and followed transitively, not named here. A hand-written list of
 * "the files to copy" goes stale the moment the guard imports one more, and it
 * goes stale as MODULE_NOT_FOUND, which reads exactly like the mutation working.
 */
function guardCopy(mutate = (s) => s) {
  const dir = join(TMP, `g${seq++}`);
  mkdirSync(dir, { recursive: true });
  const src = readFileSync(GUARD, 'utf8');
  const copied = new Set();
  for (const queue = [src]; queue.length > 0; ) {
    for (const m of queue.pop().matchAll(/from\s*['"]\.\/([A-Za-z0-9._-]+\.mjs)['"]/g)) {
      if (copied.has(m[1])) continue;
      copied.add(m[1]);
      copyFileSync(join(CI_DIR, m[1]), join(dir, m[1]));
      queue.push(readFileSync(join(CI_DIR, m[1]), 'utf8'));
    }
  }
  assert.ok(copied.size > 0, 'the guard imports nothing relative any more; re-check this helper');
  const out = mutate(src);
  assert.notEqual(out, src, 'the mutation changed nothing, so the test below would prove nothing');
  const p = join(dir, 'assert-no-hardcoded-strings.mjs');
  writeFileSync(p, out);
  return p;
}

/** Break the `.<key>` accessor matcher without removing it. Every declared key
 *  then looks unrendered, which is a BROKEN SCAN wearing the costume of a
 *  finding — the reverse limb must say so instead of printing a 309-line owner
 *  gap. Spliced by line index rather than by an exact string, because the line
 *  is a template literal full of backslashes and a mismatched needle would make
 *  `guardCopy` throw in a way that reads exactly like the mutation working. */
const breakAccessorMatcher = (src) => {
  const lines = src.split('\n');
  const i = lines.findIndex((l) => l.startsWith('const ACCESSOR_OF ='));
  assert.notEqual(i, -1, 'ACCESSOR_OF moved; re-point this mutation');
  lines[i] = 'const ACCESSOR_OF = () => /a shape no source line has/;';
  return lines.join('\n');
};

/** Point the `consentReadPolicy` de-duplication at a guard that is not there.
 *  The suppression must then STOP suppressing — otherwise deleting the other
 *  guard's owner line would silently delete this key from both prints at once. */
const orphanTheSuppression = (src) =>
  src.replace(`by: '${CONSENT_GUARD}',`, "by: 'tooling/ci/assert-a-guard-nobody-wrote.mjs',");

/** Delete a whole matcher family from the list — the mutation NEITHER the floor
 *  NOR the per-family loop can see, because the loop iterates over the list that
 *  shrank. */
const deleteLabellingMatcher = (src) => {
  const lines = src.split('\n');
  const i = lines.findIndex((l) => l.includes("what: 'a labelling parameter'"));
  assert.notEqual(i, -1, 'the labelling matcher moved; re-point this mutation');
  lines.splice(i, 1);
  return lines.join('\n');
};

describe('assert-no-hardcoded-strings', () => {
  test('passes when the brick reads everything from l10n', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, new RegExp(`${BRICK.replace(/[{}]/g, '\\$&')} shows no hardcoded user-facing strings`));
    assert.match(out, /matchers verified against a known-dirty tree/);
    assert.match(out, /matcher families are exactly those/);
    assert.match(out, /exemptions still exempt/);
  });

  // The canary list is down to one entry, and "one" is a claim with two halves:
  // the surviving canary reports, and the retired one is GONE rather than
  // quietly still being read. Asserting only the first half would pass against a
  // guard that still scanned apps/subly and merely stopped printing about it.
  //
  // ⚠️ `apps/subly` IS in the output again since 2026-08-11 — on the other side
  // of the ledger. So the assertion is not "it is absent" but "it is not a
  // canary", which is the distinction that actually matters and the one a plain
  // absence check could never express.
  test('reports one canary, and apps/subly is an ENFORCED tree rather than one', () => {
    const { out } = run(tree());
    assert.match(out, new RegExp(`known-dirty tree: \\d+ literal\\(s\\) found in ${FIXTURE}/dirty`));
    assert.equal([...out.matchAll(/known-dirty tree:/g)].length, 1, out);
    assert.match(out, new RegExp(`${SUBLY} shows no hardcoded user-facing strings`));
    assert.doesNotMatch(out, new RegExp(`known-dirty tree: \\d+ literal\\(s\\) found in ${SUBLY}`));
  });

  // ── THE DOMAIN, 2026-08-11 ────────────────────────────────────────────────
  // apps/subly was excluded wholesale, then a canary, then nothing at all — and
  // "nothing at all" is what its own DoD §4-E note recorded: "no guard counts
  // literals here". These cases are the claim that it is counted now.
  describe('apps/subly is enforced, not merely mentioned', () => {
    test('FAILS on an English literal in a Subly screen', () => {
      const { code, out } = run(tree({ subly: `${CLEAN_SUBLY}\nconst probe = Text('Renewal calendar');\n` }));
      assert.equal(code, 1, 'a new literal landed in a Subly screen and nothing said so');
      assert.match(out, new RegExp(`${SUBLY}/features/home/home_screen.dart shows a hardcoded string in Text\\(…\\): "Renewal calendar"`));
      // The remedy has to name THIS app's arb pair — the brick's advice would
      // send the author to a file that does not exist here.
      assert.match(out, /app_ta\.arb/);
    });

    test('FAILS on a hardcoded label parameter in a Subly screen', () => {
      const { code, out } = run(tree({ subly: `${CLEAN_SUBLY}\nconst probe = AppTile(label: 'Budget & goals');\n` }));
      assert.equal(code, 1);
      assert.match(out, /a labelling parameter: "Budget & goals"/);
    });

    test('FAILS when the enforced Subly tree is gone — a domain that can vanish is not a domain', () => {
      const { code, out } = run(tree({ subly: null, allowlisted: null }));
      assert.equal(code, 1);
      assert.match(out, new RegExp(`COVERAGE LOST — ${SUBLY} does not exist`));
    });
  });

  // ── The one waiver, and why it is keyed to a literal rather than a path ────
  describe('the allowlist is narrow and cannot go stale quietly', () => {
    test('the waived literal is silent, and the guard says how many waivers are live', () => {
      const { code, out } = run(tree());
      assert.equal(code, 0, out);
      assert.match(out, /1 named allowlist entr\(y\/ies\), every one still matching/);
    });

    // 🔴 THE FAILURE A PATH-KEYED WAIVER COULD NOT HAVE. The waived file gains a
    // second literal; a directory or file exclusion would have covered it in
    // silence, which is precisely how `$2.99` sat in apps/subly for months.
    test('a NEW literal in the waived file still counts', () => {
      const { code, out } = run(tree({ allowlisted: `${ALLOWLISTED}const oops = Text('Sign in failed');\n` }));
      assert.equal(code, 1, 'a waiver keyed to a path would have swallowed this');
      assert.match(out, /"Sign in failed"/);
      // …and the waiver itself is still live, so this is not a stale-entry hit.
      assert.match(out, /every one still matching/);
    });

    test('FAILS when the waived literal is gone — a waiver for nothing reads like a live exemption', () => {
      const { code, out } = run(tree({ allowlisted: '// the debug notice was removed\n' }));
      assert.equal(code, 1);
      assert.match(out, /COVERAGE LOST — the allowlist entry for "debug: \$detail"/);
      assert.match(out, /matched NOTHING/);
    });
  });

  // ── The exemption that made the adoption affordable, and its limits ────────
  describe('a literal made only of interpolations is not prose', () => {
    for (const [label, literal] of [
      ['two interpolations and a separator', '${s.category} · ${s.plan}'],
      ['one interpolation and a percent sign', '$_pct%'],
      ['a bare interpolation', '${subs.length}'],
    ]) {
      test(`stays quiet on ${label}`, () => {
        const { code, out } = run(tree({ subly: `${CLEAN_SUBLY}\nconst x = Text('${literal}');\n` }));
        assert.equal(code, 0, `fired on ${label}: ${out}`);
      });
    }

    // 🔴 THE FALSIFYING INPUT. An exemption you cannot write the failing case for
    // is a hole, not a filter — so here it is, twice, in the two shapes that
    // actually occur: a word before the interpolation, and a word between two.
    for (const [label, literal] of [
      ['prose before an interpolation', 'Renews in ${s.category}'],
      ['prose between two interpolations', '${a} of ${b}'],
      ['a debug prefix', 'trace: $detail'],
    ]) {
      test(`FAILS on ${label} — one letter outside an interpolation and it counts`, () => {
        const { code, out } = run(tree({ subly: `${CLEAN_SUBLY}\nconst x = Text('${literal}');\n` }));
        assert.equal(code, 1, `the interpolation exemption swallowed ${label}`);
        assert.match(out, /shows a hardcoded string/);
      });
    }
  });

  describe('a string shown to a person must come from l10n', () => {
    test('FAILS on a Text() literal', () => {
      const { code, out } = run(tree({
        brick: CLEAN_BRICK.replace('Text(l10n.welcomeTo(AppConfig.appName))', "Text('Welcome aboard')"),
      }));
      assert.equal(code, 1);
      assert.match(out, /shows a hardcoded string in Text\(…\): "Welcome aboard"/);
    });

    test('FAILS on a hardcoded label parameter', () => {
      const { code, out } = run(tree({
        brick: CLEAN_BRICK.replace('label: l10n.navHome', "label: 'Home'"),
      }));
      assert.equal(code, 1);
      assert.match(out, /a labelling parameter: "Home"/);
    });

    test('FAILS on a hardcoded title', () => {
      const { code, out } = run(tree({
        brick: CLEAN_BRICK.replace('title: Text(l10n.appTitle)', "title: Text('My App')"),
      }));
      assert.equal(code, 1);
      assert.match(out, /"My App"/);
    });

    // 🔴 THE DEFECT THIS FILE SHIPPED WITH, mutation-proven on the real brick
    // 2026-08-01: `settings`, `loading`, `delete` and `subscriptions` all matched
    // the NOT_USER_FACING entry `^[a-z][a-z0-9_]*$` — "a lowercase key" — so the
    // guard scanned them and printed "the brick is clean", exit 0. They are the
    // commonest labels an app ships, in the one tree that multiplies by 50.
    // Reverting the exemption to `^[a-z][a-z0-9_]*$` turns every case below red.
    for (const word of ['settings', 'loading', 'delete', 'subscriptions', 'save']) {
      test(`FAILS on the bare lowercase label '${word}'`, () => {
        const { code, out } = run(tree({
          brick: `${CLEAN_BRICK}\nconst probe = Text('${word}');\n`,
        }));
        assert.equal(code, 1, `'${word}' was filed as a key, not as prose`);
        assert.match(out, new RegExp(`shows a hardcoded string in Text\\(…\\): "${word}"`));
      });
    }
  });

  // Silence matters as much as noise — a guard that fires on keys and hex
  // colours is one somebody switches off within a week.
  describe('does NOT fire on strings nobody reads', () => {
    for (const [label, literal] of [
      ['a snake_case key', 'analytics_opt_in'],
      ['a hex colour', '#6459F5'],
      ['a URL', 'https://nikatru.com/privacy'],
      ['an asset path', 'assets/icons/home.png'],
      ['a CONSTANT_KEY', 'PLATFORM_BASE_URL'],
      ['a mustache token', '{{app_id}}'],
      ['punctuation only', ' — '],
    ]) {
      test(`stays quiet on ${label}`, () => {
        const { code } = run(tree({
          brick: `${CLEAN_BRICK}\nconst x = Text('${literal}');\n`,
        }));
        assert.equal(code, 0, `fired on ${label}: ${literal}`);
      });
    }

    // The repo has already shipped a guard that matched its own explanatory
    // comment. Comments are stripped before matching.
    test('stays quiet on a literal quoted inside a comment', () => {
      const { code } = run(tree({
        brick: `${CLEAN_BRICK}\n// never write Text('Hardcoded thing') here\n`,
      }));
      assert.equal(code, 0);
    });

    test('stays quiet on a literal inside a BLOCK comment', () => {
      const { code } = run(tree({
        brick: `${CLEAN_BRICK}\n/* an example: Text('Hardcoded thing') */\n`,
      }));
      assert.equal(code, 0);
    });

    // Generated localisations are the OUTPUT of l10n, not a breach of it.
    test('stays quiet on the generated app_localizations file', () => {
      const root = tree();
      const p = join(root, BRICK, 'l10n/app_localizations.dart');
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, "String get navHome => 'Home';\nText('Welcome to it');\n");
      assert.equal(run(root).code, 0);
    });
  });

  // 🔴 THE FALSE NEGATIVE THE CANARY FIXTURE FOUND ON ITS FIRST RUN (2026-08-08).
  // Comments used to be stripped with a hand-rolled `/\/\/.*$/gm`, which is not
  // string-aware: an ordinary user-facing sentence CONTAINING `//` was cut at
  // the slashes, and the matcher then ran on to the next quote in the file and
  // consumed the FOLLOWING literal as part of one long match. A hardcoded string
  // sitting after a URL was invisible to a guard whose whole job is to have no
  // false negatives. Both literals below must be reported BY NAME; under the old
  // stripper the second one was not reported at all.
  describe('a `//` inside a string does not blind the scanner', () => {
    const WITH_URL = `${CLEAN_BRICK}
const a = Text('Visit https://nikatru.com for help');
const b = Text('Hardcoded right after a URL');
`;

    test('reports the sentence containing the URL', () => {
      const { code, out } = run(tree({ brick: WITH_URL }));
      assert.equal(code, 1);
      assert.match(out, /"Visit https:\/\/nikatru\.com for help"/);
    });

    test('still reports the literal that FOLLOWS it', () => {
      const { out } = run(tree({ brick: WITH_URL }));
      assert.match(out, /"Hardcoded right after a URL"/);
    });
  });

  // ── The canaries. Without them a broken matcher prints "clean" and passes. ──
  describe('the matchers are proven to still match', () => {
    test('FAILS when the fixture canary stops looking dirty', () => {
      const { code, out } = run(tree({ fixture: '// all the fixture strings were removed\n' }));
      assert.equal(code, 1);
      assert.match(out, new RegExp(`COVERAGE LOST — the matchers found only 0 hardcoded string\\(s\\) in ${FIXTURE}/dirty`));
      // …and the enforcement half still said "clean", which is the point.
      assert.match(out, new RegExp(`${BRICK.replace(/[{}]/g, '\\$&')} shows no hardcoded user-facing strings`));
    });

    test('FAILS when the fixture canary is deleted outright', () => {
      const { code, out } = run(tree({ fixture: null }));
      assert.equal(code, 1);
      assert.match(out, new RegExp(`COVERAGE LOST — the canary tree ${FIXTURE}/dirty does not exist`));
    });

    // 🔴 RED BY IMPROVEMENT, AS A TEST CASE. This exact input — a product tree
    // that somebody has just cleaned — used to fail the build with
    // `COVERAGE LOST … 0 hardcoded string(s) in apps/subly/lib`, which is a guard
    // punishing the work it exists to encourage. It must now pass, and it fails
    // against the pre-retirement guard, so it is a real negative test of the
    // retirement rather than a restatement of it.
    // ⚠️ The second half of this assertion changed on 2026-08-11: a cleaned
    // apps/subly must still pass, but it is no longer ABSENT from the output —
    // it is reported clean as an enforced tree. "Passes" and "is not read at
    // all" were indistinguishable while the tree was excluded, and they are the
    // difference between the guard covering this app and not.
    test('PASSES once apps/subly/lib is cleaned — the retrofit must not turn this red', () => {
      const root = tree();
      const p = join(root, `${SUBLY}/legacy_screen.dart`);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, `${CLEAN_BRICK}\n// every literal here now comes from l10n\n`);
      const { code, out } = run(root);
      assert.equal(code, 0, out);
      assert.match(out, new RegExp(`${SUBLY} shows no hardcoded user-facing strings`));
      assert.doesNotMatch(out, new RegExp(`COVERAGE LOST.*${SUBLY}`));
    });

    test('FAILS when the brick tree it protects is gone', () => {
      const { code, out } = run(tree({ omitBrick: true }));
      assert.equal(code, 1);
      assert.match(out, /COVERAGE LOST/);
    });

    // 🔴 THE TOTAL FLOOR CANNOT SEE HALF THE MATCHERS DIE. The fixture yields 23
    // `Text(…)` hits against 9 labelling-parameter hits, so losing the second
    // family entirely still clears MIN_CANARY. The dirty tree here is dirty in
    // ONE way only — a well-above-floor 30 `Text(…)` literals and no labelled
    // ones — which is precisely the shape a total count calls healthy.
    test('FAILS when one matcher family has no evidence, though the total is high', () => {
      const { code, out } = run(tree({ fixture: dirtyTree(30, 0) }));
      assert.equal(code, 1, 'a 30-hit total hid a family that matched nothing');
      assert.match(out, /COVERAGE LOST — the "a labelling parameter" matcher found NOTHING/);
      // …and the enforcement half still said "clean", which is the point.
      assert.match(out, new RegExp(`${BRICK.replace(/[{}]/g, '\\$&')} shows no hardcoded user-facing strings`));
    });

    // 🔴 THE MEASUREMENT THE RETIREMENT RESTS ON, taken against the REAL repo
    // rather than asserted in a comment. Dropping the second canary is only safe
    // if the surviving one carries the floor and BOTH families on its own — the
    // pooled-canary blindness this suite already tests for, one level up. A
    // fixture cannot answer this: it would just report whatever this file wrote.
    test('the real fixture is the only canary, and clears the floor by itself', () => {
      const { code, out } = run(REPO, guardCopy((s) => `${s}\n// unmutated; run against the real tree\n`));
      assert.equal(code, 0, out);
      const cleared = [...out.matchAll(/known-dirty tree: (\d+) literal/g)].map((m) => Number(m[1]));
      assert.equal(cleared.length, 1, `exactly one canary should report: ${out}`);
      assert.ok(cleared[0] >= 20, `the sole canary is under the floor at ${cleared[0]}`);
      assert.doesNotMatch(out, /COVERAGE LOST/);
    });

    // The floor is deliberately left FAR below the measured total and must not
    // be re-pinned to it — a floor tuned to today's measurement is the stale
    // floor PR #85 removed from assert-guard-coverage. This proves the headroom
    // is real: a tree well under the real 32, but over the floor and dirty in
    // both ways, is still a valid canary.
    test('passes on a dirty tree well below the measured total but above the floor', () => {
      const { code, out } = run(tree({ fixture: dirtyTree(18, 3) }));
      assert.equal(code, 0, out);
      assert.match(out, /known-dirty tree: 21 literal/);
    });
  });

  // ── The declaration identity: the only limb that can see a DELETED family. ──
  describe('the matcher list is held against a declaration outside it', () => {
    test('FAILS when the declaration is missing', () => {
      const { code, out } = run(tree({ families: null }));
      assert.equal(code, 1);
      assert.match(out, new RegExp(`COVERAGE LOST — ${FIXTURE}/expected-families.txt does not exist`));
    });

    test('FAILS when the declaration is emptied rather than deleted', () => {
      const { code, out } = run(tree({ families: '# everything below was removed\n' }));
      assert.equal(code, 1, 'an empty declaration is satisfied by any matcher list at all');
      assert.match(out, /declares no families/);
    });

    test('FAILS when the declaration names a family no matcher provides', () => {
      const { code, out } = run(tree({ families: `${FAMILIES}a family nobody implements\n` }));
      assert.equal(code, 1);
      assert.match(out, /declares evidence for the "a family nobody implements" family and NO MATCHER PROVIDES IT/);
    });

    // 🔴 THE REAL-TREE MUTATION, and the reason this whole limb exists. Deleting
    // a matcher family clears every floor — measured on the real repo when this
    // was written: 22 fixture hits and 58 subly hits, both far above 20 — and the
    // per-family loop cannot see it, because it iterates over the list that
    // shrank. Before this change the same mutation exited 0.
    //
    // ⚠️ The count below is 1, not 2, since the apps/subly canary was retired
    // (2026-08-08). That is not a weakened assertion: it is the claim that the
    // SURVIVING canary still clears the floor with a whole matcher family gone,
    // which is precisely why a floor cannot be the thing catching this. Re-run on
    // the real tree the day it changed — the fixture reported 23 with the
    // labelling family spliced out, comfortably over 20, and the guard still
    // exited 1 on the declaration identity.
    test('FAILS on the REAL repo when a matcher family is deleted from the guard', () => {
      const { code, out } = run(REPO, guardCopy(deleteLabellingMatcher));
      assert.equal(code, 1, 'a deleted matcher family passed against the real tree');
      assert.match(out, /declares evidence for the "a labelling parameter" family and NO MATCHER PROVIDES IT/);
      // The floor did NOT catch it — that is the whole point, so it is asserted
      // rather than left as a claim in a comment. The canary still cleared
      // MIN_CANARY with a whole matcher family gone, and still printed ok.
      const cleared = [...out.matchAll(/known-dirty tree: (\d+) literal/g)].map((m) => Number(m[1]));
      assert.equal(cleared.length, 1, `the surviving canary should still have reported: ${out}`);
      for (const n of cleared) assert.ok(n >= 20, `a floor of 20 would have caught this at ${n}`);
    });

    // …and the control. Without it, "the mutated copy exits 1" could just mean
    // the copying is broken.
    test('an UNMUTATED copy of the guard passes against the REAL repo', () => {
      const copy = guardCopy((s) => `${s}\n// a comment, so this counts as a mutation and nothing else\n`);
      const { code, out } = run(REPO, copy);
      assert.equal(code, 0, out);
    });
  });

  // ── The exemptions are load-bearing, so they are asserted in both directions.
  describe('the NOT_USER_FACING exemptions are proven, not assumed', () => {
    test('FAILS when the quiet fixture is missing', () => {
      const { code, out } = run(tree({ quiet: null }));
      assert.equal(code, 1);
      assert.match(out, new RegExp(`COVERAGE LOST — ${FIXTURE}/quiet does not exist`));
    });

    test('FAILS when the quiet fixture holds nothing the matchers even look at', () => {
      const { code, out } = run(tree({ quiet: 'const x = 1;\n' }));
      assert.equal(code, 1, '"zero enforced hits" is also true of an empty tree');
      assert.match(out, /holds no literal in any position the matchers look at/);
    });

    test('FAILS when a literal in the quiet fixture starts counting', () => {
      const { code, out } = run(tree({ quiet: `${QUIET}\nconst oops = Text('Now this is prose');\n` }));
      assert.equal(code, 1, 'an exemption was narrowed and nothing said so');
      assert.match(out, /is in the QUIET fixture and now counts as user-facing: "Now this is prose"/);
    });

    // Drop one line and the exemption it was the only input for has nothing
    // reaching it — so it could be silently wrong, or silently dead.
    for (const [what, line] of [
      ['the mustache token', "      Text('{{app_id}}'),\n"],
      ['the hex colour', "      Text('#6459F5'),\n"],
      ['the CONSTANT_KEY', "      Text('PLATFORM_BASE_URL'),\n"],
      ['the snake_case key', "      Text('analytics_opt_in'),\n"],
    ]) {
      test(`FAILS when ${what} exemption loses its near miss`, () => {
        const quiet = QUIET.replace(line, '');
        assert.notEqual(quiet, QUIET, 'the near-miss line moved; re-point this case');
        const { code, out } = run(tree({ quiet }));
        assert.equal(code, 1, `${what} exemption had no input reaching it and nothing said so`);
        assert.match(out, /has no near miss in/);
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ── THE REVERSE DIRECTION: a translated key that reaches no screen. ──────
  //
  // The half above proves every SHOWN string came from the arb. This half asks
  // the converse, and it PRINTS rather than fails — CLAUDE.md's owner-gated
  // rule, the same shape as assert-adapter-capabilities' `max_promos_per_week`
  // tripwire and assert-consent-withdrawal-surface's `consentReadPolicy` line.
  //
  // 🔴 SO THE FIRST THING EVERY CASE HERE ASSERTS IS `code === 0`. A print that
  // can redden the build is a print somebody switches off, and "it fires" is
  // the easy half to get right — the hard half is that it fires and the build
  // still passes. The genuinely load-bearing cases are the NEGATIVE ones: the
  // key that IS rendered must drop out of the print, and an empty domain must
  // be COVERAGE LOST rather than a clean zero.
  // ─────────────────────────────────────────────────────────────────────────
  describe('the reverse direction prints unrendered keys and never fails the build', () => {
    const GHOST = { ...SUBLY_ARB, ghostKey: 'Ghost copy' };

    test('says so, with the domain sizes, when every declared key reaches a screen', () => {
      const { code, out } = run(tree());
      assert.equal(code, 0, out);
      assert.match(out, /ok {3}every declared l10n key reaches a screen/);
      // A bare "no unread keys" is worth nothing; the domain is what makes it a
      // measurement. Both halves of the sweep have to be in the sentence.
      assert.match(out, /\d+ message key\(s\) from 2 tracked l10n\/app_en\.arb file\(s\)/);
      assert.match(out, /\d+ non-test \.dart file\(s\) in 2 enforced tree\(s\)/);
      assert.match(out, /\d+ non-test [^ ]+ file\(s\) elsewhere searched for any other reader/);
      assert.doesNotMatch(out, /👤 OWNER/);
    });

    test('PRINTS an unrendered key as an owner gap and still exits 0', () => {
      const { code, out } = run(tree({ sublyArb: GHOST }));
      assert.equal(code, 0, `an owner judgement reddened the build:\n${out}`);
      assert.match(out, /👤 OWNER l10n render direction — 1 translated, reviewed key\(s\) of 5 reach NO surface/);
      assert.match(out, /NOTHING IN THE TREE NAMES THE KEY AT ALL \(1\)/);
      assert.match(out, /ghostKey \[declared in 1 of 2 enforced tree\(s\)\]/);
      assert.match(out, /appears nowhere else in the tree either/);
      // 🔴 THE DOMAIN SENTENCE, WITH ITS NUMBERS, ON THE PATH THAT ACTUALLY
      // PRINTS A GAP. Until 2026-08-21 it was asserted only on the `ok …` path,
      // so replacing the line with a literal `DOMAIN: (elided)` left this file
      // at EXIT 0, 69/69 — and that sentence is the entire difference between a
      // measurement and a blind spot. The fixture is fully known, so the numbers
      // are exact here rather than `\d+`: 5 union keys from 2 arbs, 3 .dart
      // render files (both home screens plus the allowlisted login screen), and
      // 1 consumer file outside the enforced trees.
      assert.match(
        out,
        /DOMAIN, so the number above is a measurement and not a blind spot: 5 message key\(s\) from 2 tracked l10n\/app_en\.arb file\(s\) · 3 non-test \.dart file\(s\) in 2 enforced tree\(s\) searched for a `\.<key>` accessor · 1 non-test \.mjs\/\.js\/\.ts\/\.tsx\/\.dart file\(s\) elsewhere searched for any other reader\./,
      );
      // …and the sentence that says WHY the generated accessors are out of both
      // halves. Without it the exclusion looks like a scan that missed them.
      assert.match(out, /Generated gen-l10n accessors are excluded from both/);
      // The forward half must be unaffected — this is one guard, not two.
      assert.match(out, new RegExp(`${SUBLY} shows no hardcoded user-facing strings`));
    });

    // 🔴 THE `non-test` ADJECTIVE IN THAT SENTENCE, MADE FALSIFIABLE. It was a
    // label with nothing behind it until 2026-08-21: `readDartTree` filters only
    // `app_localizations`, so a test file under an enforced tree counted as a
    // render surface while the identical file one directory up was excluded from
    // the consumer sweep by IS_TEST_PATH. Latent on the real tree — measured
    // 2026-08-21, 0 of its 71 render files match IS_TEST_PATH — so a fixture is
    // the only place the input exists.
    test('does NOT treat a _test.dart under an enforced tree as a render surface', () => {
      const { code, out } = run(tree({
        sublyArb: GHOST,
        consumers: {
          ...CONSUMERS,
          [`${SUBLY}/features/home/home_screen_test.dart`]: 'const probe = Text(l10n.ghostKey);\n',
        },
      }));
      assert.equal(code, 0, out);
      assert.match(out, /👤 OWNER l10n render direction — 1 translated, reviewed key\(s\) of 5 reach NO surface/);
      assert.match(out, /ghostKey \[declared in 1 of 2 enforced tree\(s\)\]/);
      // …and the printed domain stays at 3, so the file was EXCLUDED rather than
      // scanned-and-missed. A count of 4 here would mean the word is still a label.
      assert.match(out, /3 non-test \.dart file\(s\) in 2 enforced tree\(s\)/);
    });

    // 🔴 THE NEGATIVE HALF, AND THE ONLY ONE THAT PROVES THE LIMB IS DERIVED
    // FROM THE TREE. Same arb, same key — the ONLY difference is a screen that
    // renders it. If the print survived this it would be reporting a list, not a
    // measurement, and it would never stop printing once the owner acted.
    test('DROPS the key the moment a screen renders it', () => {
      const rendered = `${CLEAN_SUBLY}\nconst probe = Text(l10n.ghostKey);\n`;
      const { code, out } = run(tree({ sublyArb: GHOST, subly: rendered }));
      assert.equal(code, 0, out);
      assert.doesNotMatch(out, /ghostKey/);
      assert.doesNotMatch(out, /👤 OWNER/);
      assert.match(out, /ok {3}every declared l10n key reaches a screen/);
    });

    test('files a key with a NON-render reader separately, and names the reader', () => {
      const { code, out } = run(tree({
        sublyArb: GHOST,
        consumers: { ...CONSUMERS, 'tooling/ci/assert-something.mjs': "const KEY = 'ghostKey';\n" },
      }));
      assert.equal(code, 0, out);
      assert.match(out, /NOT RENDERED, BUT SOMETHING ELSE READS THE KEY — do not delete before reading the consumer \(1\)/);
      assert.match(out, /ghostKey \[declared in 1 of 2 enforced tree\(s\)\] — read at tooling\/ci\/assert-something\.mjs:1/);
      assert.doesNotMatch(out, /NOTHING IN THE TREE NAMES THE KEY AT ALL/);
    });

    // The AppErrorScreen shape, derived rather than hardcoded: the key is dead,
    // but its English copy is alive as a literal somewhere that cannot read
    // l10n. "Delete the key" and "make that surface localisable" are different
    // owner answers and the print must not hide which one is on the table.
    test('names the file where an unrendered key’s copy already ships as a literal', () => {
      const { code, out } = run(tree({
        sublyArb: GHOST,
        consumers: { ...CONSUMERS, 'packages/design_system/lib/fallback.dart': "const t = 'Ghost copy';\n" },
      }));
      assert.equal(code, 0, out);
      assert.match(out, /ships as a hardcoded LITERAL at packages\/design_system\/lib\/fallback\.dart:1/);
      assert.match(out, /different owner answers/);
    });

    // The OTHER half of "the suppression is conditional": it is conditional on
    // the key still being UNREAD, not only on the crediting guard still existing.
    // Measured 2026-08-21, deleting that half (`if (false)` on the
    // `!unread.includes(e.key)` line) left this file green — so a key the owner
    // had already wired up would keep drawing a line saying it is unrendered and
    // deliberately not listed, which is a false owner gap in a print whose one
    // job is not to file those.
    test('stops crediting the other guard once the key IS rendered', () => {
      const wired = { ...GHOST, consentReadPolicy: 'Read the privacy policy' };
      const { code, out } = run(tree({
        sublyArb: wired,
        subly: `${CLEAN_SUBLY}\nconst probe = Text(l10n.consentReadPolicy);\n`,
      }));
      assert.equal(code, 0, out);
      assert.doesNotMatch(out, /deliberately NOT listed above/);
      assert.doesNotMatch(out, /consentReadPolicy/);
      // …and the print is still live for the key that really is unrendered, so
      // this is not passing because the owner block vanished.
      assert.match(out, /ghostKey \[declared in 1 of 2 enforced tree\(s\)\]/);
    });

    // 🔴 …AND CONDITIONAL ON THE CREDITING GUARD NAMING IT IN *CODE*, WHICH IS
    // THE HALF THAT WAS FALSE UNTIL 2026-08-21. The name check read the other
    // guard's RAW bytes, so a key surviving only inside a COMMENT there held the
    // suppression open — and the print promises the owner the opposite in as many
    // words ("if that limb goes, this one starts printing it"). That is not a
    // hypothetical shape: `consentReadPolicy` occurs twice in the real crediting
    // guard, once as code and once in prose (measured 2026-08-21: 2 raw, 1 after
    // stripSourceComments), and LOCKED forbids rewriting the dated prose — so
    // deleting the limb the honest way leaves exactly this input behind.
    // Mutating the check back to `return existsSync(abs);` is RED against this
    // case (re-measured 2026-08-21). The pre-fix suite it survived was 72 cases
    // and no longer exists, so that half of the record is the review's number
    // and is attributed rather than re-taken.
    test('stops crediting a guard that names the key only in a COMMENT', () => {
      const orphaned = { ...SUBLY_ARB, consentReadPolicy: 'Read the privacy policy' };
      const { code, out } = run(tree({
        sublyArb: orphaned,
        consumers: { [CONSENT_GUARD]: "// the limb that printed 'consentReadPolicy' was deleted; this note is dated\nconst UNRELATED = 1;\n" },
      }));
      assert.equal(code, 0, out);
      assert.match(out, /consentReadPolicy \[declared in 1 of 2 enforced tree\(s\)\]/);
      assert.doesNotMatch(out, /deliberately NOT listed above/);
    });

    // 🔴 THE CONTROL FOR THE CASE ABOVE — same arb, same key, crediting guard
    // naming it in LIVE CODE — AND the input for a second defect fixed the same
    // day. When the ONLY unread key is a suppressed one, `printable.length === 0`
    // and the guard used to take the `ok …` branch: it printed "every declared
    // l10n key reaches a screen" while knowing one reached none, and the line
    // naming the guard that owns it lived only in the other branch, so it was
    // never emitted. Latent on the real tree only because 4 other keys are
    // printable today.
    test('PRINTS the crediting line even when the suppressed key is the ONLY unread one', () => {
      const onlyCredited = { ...SUBLY_ARB, consentReadPolicy: 'Read the privacy policy' };
      const { code, out } = run(tree({ sublyArb: onlyCredited }));
      assert.equal(code, 0, out);
      assert.doesNotMatch(out, /every declared l10n key reaches a screen/);
      assert.match(
        out,
        /👤 OWNER l10n render direction — 0 of 5 translated, reviewed key\(s\) need a line here, and 1 unrendered key\(s\) are printed by the guard that owns them\./,
      );
      assert.match(out, new RegExp(`consentReadPolicy is unrendered too and is deliberately NOT listed above: ${CONSENT_GUARD}`));
      // …and the domain is still stated on this branch too, so the 0 above is a
      // measurement rather than a scan that reached nothing.
      assert.match(out, /DOMAIN, so the number above is a measurement and not a blind spot: 5 message key\(s\)/);
      // The key is credited, not filed — one line for one key.
      assert.doesNotMatch(out, /consentReadPolicy \[declared in/);
    });

    // 🔴 THE OTHER HALF OF THE RENDER-DOMAIN NARROWING, `/l10n/`. `readDartTree`
    // filters on the BASENAME (`app_localizations*`), so a HAND-WRITTEN helper
    // under `lib/l10n/` is caught by this clause and by nothing else — and a
    // getter declared there is the output of l10n, not a render of it. Latent:
    // measured 2026-08-21, 0 of the 71 real render files sit under a `/l10n/`
    // path, so nothing reached the clause until this case; the review that found
    // it measured the pre-fix suite green. What is re-taken here is the state
    // that ships: dropping the clause is RED against this case.
    test('does NOT treat a hand-written file under lib/l10n/ as a render surface', () => {
      const { code, out } = run(tree({
        sublyArb: GHOST,
        consumers: {
          ...CONSUMERS,
          [`${SUBLY}/l10n/l10n_extensions.dart`]: 'String probe(l10n) => l10n.ghostKey;\n',
        },
      }));
      assert.equal(code, 0, out);
      assert.match(out, /ghostKey \[declared in 1 of 2 enforced tree\(s\)\]/);
      // …and the printed domain stays at 3, so the file was EXCLUDED rather than
      // scanned-and-missed.
      assert.match(out, /3 non-test \.dart file\(s\) in 2 enforced tree\(s\)/);
    });

    // 🔴 THE THIRD RENDER-DOMAIN NARROWING, AND THE ONE NO SWEEP HAD REACHED:
    // `readDartTree`'s `if (!entry.endsWith('.dart')) continue;`. Measured
    // 2026-08-22 — `if (false)` on that line left this whole file at EXIT 0,
    // tests 80, pass 80, fail 0. The two clauses above were swept in the
    // 2026-08-21 pass because they sit in the reverse limb; this one sits in the
    // walk, which that pass treated as inherited code. It is not inherited: the
    // walk was SPLIT OUT of `scanRaw` by the same change, precisely so both
    // limbs range over one domain, which makes every clause in it load-bearing
    // for a limb that did not exist before.
    // LATENT, measured rather than assumed: the only non-`.dart` files under the
    // two enforced trees today are the four `.arb` files, and all four sit under
    // `/l10n/`, which the clause above drops anyway — so nothing in the real tree
    // and nothing in any fixture reached it.
    // THE DIRECTION THAT BITES IS THE HIDING ONE, which is why the fixture is a
    // `.json` rather than a stray `.txt`: with the clause gone, any non-Dart file
    // under `lib/` whose bytes merely CONTAIN `.someKey` is read as a render
    // surface, and the key silently leaves the owner print. A false "rendered"
    // deletes an owner line; that is the one failure this limb's whole one-way
    // bias exists to prevent.
    test('does NOT treat a non-.dart file under an enforced tree as a render surface', () => {
      const { code, out } = run(tree({
        sublyArb: GHOST,
        consumers: {
          ...CONSUMERS,
          [`${SUBLY}/features/home/home_copy.json`]: '{ "note": "l10n.ghostKey" }\n',
        },
      }));
      assert.equal(code, 0, out);
      assert.match(out, /👤 OWNER l10n render direction — 1 translated, reviewed key\(s\) of 5 reach NO surface/);
      assert.match(out, /ghostKey \[declared in 1 of 2 enforced tree\(s\)\]/);
      // …and the printed domain stays at 3. A 4 here would mean the file was
      // scanned and merely happened not to match, which is a different guard.
      assert.match(out, /3 non-test \.dart file\(s\) in 2 enforced tree\(s\)/);
    });

    // 🔴 THE ACCESSOR MATCHER'S TRAILING `\b`, IN THE WIDENING DIRECTION. The
    // narrowing direction is pinned against the real repo by MAX_UNREAD_SHARE;
    // this one had no input at all until 2026-08-21, and it is the dangerous
    // side — `new RegExp('[.]' + key)` makes `.appTitleSuffix` satisfy
    // `appTitle`, which deletes an owner line silently instead of adding a
    // false one. Nothing reached it before this case; the review that found it
    // measured the pre-fix suite green, and dropping the `\b` is RED here.
    test('a key is NOT rendered by a LONGER accessor that merely starts with it', () => {
      const nearMiss = `${CLEAN_SUBLY}\nconst probe = Text(l10n.ghostKeySuffix);\n`;
      const { code, out } = run(tree({ sublyArb: GHOST, subly: nearMiss }));
      assert.equal(code, 0, out);
      assert.match(out, /👤 OWNER l10n render direction — 1 translated, reviewed key\(s\) of 5 reach NO surface/);
      assert.match(out, /ghostKey \[declared in 1 of 2 enforced tree\(s\)\]/);
    });

    // 🔴 THE `v !== ''` GUARD ON THE LITERAL-ECHO CHECK. An arb key whose English
    // value is the empty string makes `''` and `""` the needle, so every consumer
    // line carrying an empty literal would be reported to the owner as "its
    // English copy ships as a hardcoded LITERAL at <file:line>" — a file:line
    // pointing at nothing, in the one print whose whole promise is that the
    // evidence is inspectable. Nothing reached the guard before this case; the
    // review that found it measured the pre-fix suite green, and dropping the
    // guard is RED here (re-measured 2026-08-21).
    test('a key with an EMPTY English value reports no literal echo', () => {
      const { code, out } = run(tree({
        sublyArb: { ...SUBLY_ARB, blankKey: '' },
        consumers: { ...CONSUMERS, 'tooling/ci/assert-something.mjs': "const nothing = '';\n" },
      }));
      assert.equal(code, 0, out);
      assert.match(
        out,
        /blankKey \[declared in 1 of 2 enforced tree\(s\)\] — and its English copy appears nowhere else in the tree either/,
      );
      assert.doesNotMatch(out, /ships as a hardcoded LITERAL/);
    });

    // 🔴 EVERY NARROWING IN THE NON-RENDER WALK, IN ONE INPUT. Each `continue`
    // there is a place a real reader can be lost — the generate-discovery.mjs
    // incident is the whole reason the sweep is wide — and four of the six had
    // no failing input until 2026-08-21: the dot-directory skip, CONSUMER_PRUNE,
    // the extension list and the `app_localizations` name skip. A hand-written
    // prune list that grows from `node_modules` to `node_modules|docs` moved no
    // test before this case existed.
    test('the non-render sweep is narrowed only in ways that have a failing input', () => {
      const names = "const KEY = 'ghostKey';\n";
      const { code, out } = run(tree({
        sublyArb: GHOST,
        consumers: {
          ...CONSUMERS,
          'node_modules/some-pkg/reader.mjs': names, // CONSUMER_PRUNE
          'build/generated/reader.mjs': names, // CONSUMER_PRUNE
          // The dot-directory skip. `.github`, NOT `.claude`: `listDir` drops
          // `.claude` itself (tree-walk.mjs's SCRATCH_DIR_NAME), so a `.claude`
          // decoy would be excluded by the shared module and prove nothing about
          // this guard's own clause. Measured 2026-08-21 — with `.claude` here
          // the mutation that deletes the clause stayed GREEN at 80/80.
          '.github/scripts/reader.mjs': names,
          'docs/notes.md': names, // CONSUMER_EXTS
          'packages/design_system/lib/app_localizations.dart': names, // the generated-name skip
        },
      }));
      assert.equal(code, 0, out);
      // Exactly ONE file was swept — the crediting guard planted by default —
      // so all five decoys were excluded rather than read and ignored.
      assert.match(out, /1 non-test \.mjs\/\.js\/\.ts\/\.tsx\/\.dart file\(s\) elsewhere searched for any other reader/);
      assert.match(out, /NOTHING IN THE TREE NAMES THE KEY AT ALL \(1\)/);
      assert.doesNotMatch(out, /— read at /);
    });

    // `site()` names the first reader and COUNTS the rest, and the count is what
    // stops a one-line print reading as a one-site fact. The real repo prints
    // `(+2 more)` for appTitle today, but a real-repo count is a moving number,
    // so the pin is a fixture with exactly two readers.
    test('names one reader site and counts the rest', () => {
      const names = "const KEY = 'ghostKey';\n";
      const { code, out } = run(tree({
        sublyArb: GHOST,
        consumers: { ...CONSUMERS, 'tooling/ci/assert-one.mjs': names, 'tooling/ci/assert-two.mjs': names },
      }));
      assert.equal(code, 0, out);
      assert.match(out, /— read at tooling\/ci\/assert-(?:one|two)\.mjs:1 \(\+1 more\)/);
    });

    // ── The union domain, which is the difference between 5 findings and 23 ──
    // Subly was stamped FROM the brick and diverged, so a chassis key sits in
    // BOTH arbs and is rendered by whichever tree still has that screen. Asked
    // per-tree this limb reports FIFTEEN keys that a sibling renders (measured
    // 2026-08-21 — this read "eighteen", which was 23 − 5 and double-counted the
    // three keys declared in both arbs), and the natural owner answer — delete
    // it — breaks the other tree.
    describe('the reader domain is the union of the enforced trees', () => {
      const SHARED_BRICK = { ...BRICK_ARB, sharedChassisKey: 'Shared' };

      test('a key declared in the brick and rendered only by Subly is NOT reported', () => {
        const { code, out } = run(tree({
          brickArb: SHARED_BRICK,
          subly: `${CLEAN_SUBLY}\nconst probe = Text(l10n.sharedChassisKey);\n`,
        }));
        assert.equal(code, 0, out);
        assert.doesNotMatch(out, /sharedChassisKey/);
      });

      // …and the control, so the case above is not passing because the key is
      // invisible to the limb altogether.
      test('the same key IS reported when neither tree renders it', () => {
        const { code, out } = run(tree({ brickArb: SHARED_BRICK }));
        assert.equal(code, 0, out);
        assert.match(out, /sharedChassisKey \[declared in 1 of 2 enforced tree\(s\)\]/);
      });
    });

    // ── COVERAGE LOST: an empty domain is not "no unread keys". ─────────────
    describe('a scan that reached nothing says so instead of printing a clean zero', () => {
      test('FAILS when an enforced tree has no app_en.arb', () => {
        const { code, out } = run(tree({ brickArb: null }));
        assert.equal(code, 1, 'the reverse limb read no keys and called the tree clean');
        assert.match(out, new RegExp(`COVERAGE LOST — ${BRICK.replace(/[{}]/g, '\\$&')}/l10n/app_en.arb does not exist`));
      });

      // 🔴 THE `arbsRead === 0` BRANCH, WHICH IS AN EMPTY BLOCK AND THEREFORE
      // READS LIKE A COMMENT. It is not: without it, a run where NO enforced
      // tree has an arb falls through to the normal path with an empty key set,
      // and the guard prints `ok every declared l10n key reaches a screen` —
      // over zero keys — beside the COVERAGE LOST lines. Measured 2026-08-21,
      // the case above only removes ONE arb, so nothing reached this branch
      // before this case; `if (false)` on it is RED against this one.
      test('FAILS when NEITHER enforced tree has an app_en.arb, and prints no clean zero', () => {
        const { code, out } = run(tree({ brickArb: null, sublyArb: null }));
        assert.equal(code, 1, 'the reverse direction read no keys at all and still called the tree clean');
        assert.equal(
          (out.match(/does not exist, so the reverse direction read no keys/g) ?? []).length,
          2,
          'both roots must be reported, not only the first',
        );
        assert.doesNotMatch(out, /every declared l10n key reaches a screen/);
        assert.doesNotMatch(out, /👤 OWNER l10n render direction/);
      });

      test('FAILS when the arb does not parse as JSON', () => {
        const { code, out } = run(tree({ brickArb: '{ "appTitle": "Demo",,, }\n' }));
        assert.equal(code, 1, 'an unparseable arb made every key it holds invisible');
        assert.match(out, /did not parse as JSON/);
      });

      test('FAILS when the arb holds only metadata and no message keys', () => {
        const { code, out } = run(tree({ brickArb: { '@@locale': 'en' } }));
        assert.equal(code, 1, '"no unrendered keys" was a statement about an empty file');
        assert.match(out, /declares no message keys/);
      });

      // 🔴 THE TRIPWIRE THAT SHIPPED WITH NO INPUT REACHING IT. Measured
      // 2026-08-21: replacing the guard's `if (odd.length > 0)` with
      // `if (false)` left this file at EXIT 0, tests 69, pass 69, fail 0. Both
      // real arbs hold only Dart identifiers (155 + 309 keys, 0 odd, measured
      // the same day), so a fixture is the only place the input can exist — and
      // a COVERAGE-LOST branch that can redden a real build while nothing can
      // falsify it is an assertion the next reader is free to delete.
      test('FAILS when the arb declares a key that is not a Dart identifier', () => {
        const { code, out } = run(tree({ brickArb: { ...BRICK_ARB, 'not-an-identifier': 'x' } }));
        assert.equal(code, 1, 'a key this limb cannot build a regex for was silently skipped');
        assert.match(out, /declares 1 key\(s\) that are not Dart identifiers \(not-an-identifier\)/);
        assert.match(out, /They were SKIPPED rather than checked/);
        // …and the message is TRUE: the key really is outside the count below,
        // which is the whole reason the branch says COVERAGE LOST rather than
        // reporting the key as unrendered. 4 is the default union, unchanged.
        assert.match(out, /4 message key\(s\) from 2 tracked l10n\/app_en\.arb file\(s\)/);
      });

      test('FAILS when there is no .dart to look for accessors in', () => {
        const { code, out } = run(tree({ brick: null, subly: null, allowlisted: null }));
        assert.equal(code, 1, 'every key would read as unrendered, which is a broken scan');
        assert.match(out, /ZERO non-test \.dart file\(s\) to look for accessors in/);
      });

      // 🔴 THE generate-discovery.mjs LESSON AS A FAILING INPUT. Three config
      // keys were once "proven" unread by a sweep that never opened a .mjs; the
      // reader was JavaScript and the keys were rendering live bullets on
      // nikatru.com. "Nothing else reads this key" is only worth saying when
      // something outside the render trees was actually read.
      test('FAILS when the non-render sweep had no files to sweep', () => {
        const { code, out } = run(tree({ consumers: null }));
        assert.equal(code, 1, '"nothing else reads it" was a statement about an empty sweep');
        assert.match(out, /found no .+ file\(s\) outside the enforced trees/);
      });
    });

    // ── Against the REAL repository. A fixture I wrote encodes the same ─────
    // misunderstanding as the limb I wrote — assert-seams-wired.mjs shipped with
    // all six of its fixture tests passing against a broken guard.
    describe('against the REAL repository', () => {
      test('prints the three dead keys, exits 0, and states its domain', () => {
        const { code, out } = run(REPO);
        assert.equal(code, 0, out);
        assert.match(out, /👤 OWNER l10n render direction/);
        for (const key of ['errorTitle', 'errorMessage', 'notificationActionOpen']) {
          assert.match(out, new RegExp(`${key} \\[declared in \\d of 2 enforced tree\\(s\\)\\]`), key);
        }
        // appTitle has a LIVE JavaScript reader — assert-stamp-text-fidelity.mjs
        // fails the brick lane when it disagrees with the stamped display name.
        // Filing it beside errorTitle would invite a delete that reddens CI, so
        // the bucket it lands in is asserted, not just its presence.
        assert.match(out, /appTitle \[declared in 2 of 2 enforced tree\(s\)\] — read at tooling\/ci\/assert-stamp-text-fidelity\.mjs:\d+/);
        assert.match(out, /ships as a hardcoded LITERAL at packages\/design_system\/lib\/src\/widgets\/system_screens\.dart:\d+/);
        assert.doesNotMatch(out, /COVERAGE LOST/);

        // 🔴 THE DOMAIN SENTENCE, PINNED TO THE REST OF THE PRINT. The title of
        // this test claimed "states its domain" and nothing checked it — until
        // 2026-08-21 the line could be replaced with a literal `DOMAIN:
        // (elided)` and this file stayed at EXIT 0, 69/69. The counts are not
        // written down here, because a real-repo count is a moving number and a
        // test that pins one is a test somebody edits every week. What IS pinned
        // is that the sentence carries derived numbers AND that they agree with
        // the rest of the print — the property "(elided)" cannot satisfy and a
        // stale hardcoded number could.
        const d = out.match(
          /DOMAIN, so the number above is a measurement and not a blind spot: (\d+) message key\(s\) from (\d+) tracked l10n\/app_en\.arb file\(s\) · (\d+) non-test \.dart file\(s\) in (\d+) enforced tree\(s\) searched for a `\.<key>` accessor · (\d+) non-test [^ ]+ file\(s\) elsewhere searched for any other reader\./,
        );
        assert.ok(d, `the DOMAIN sentence is missing or reshaped:\n${out}`);
        const [keys, arbs, dartFiles, trees, elsewhere] = d.slice(1).map(Number);
        const head = out.match(/👤 OWNER l10n render direction — (\d+) translated, reviewed key\(s\) of (\d+) reach NO surface/);
        assert.ok(head, 'the owner header is missing');
        assert.equal(Number(head[2]), keys, 'the header and the domain disagree about how many keys were read');
        // One arb and one enforced tree per root, and both halves non-empty —
        // the three ways this sentence could be true of nothing.
        assert.equal(arbs, trees, 'an enforced tree contributed no arb');
        assert.equal(trees, 2, 'ENFORCED_ROOTS changed; re-read this assertion');
        assert.ok(dartFiles > 0 && elsewhere > 0, `an empty half: ${dartFiles} render, ${elsewhere} elsewhere`);
        // The printed key lines must account for exactly the header's count, so
        // the header cannot drift from the buckets underneath it.
        assert.equal(
          (out.match(/^ {8}\w+ \[declared in \d of \d enforced tree\(s\)\]/gm) ?? []).length,
          Number(head[1]),
          'the owner header counts keys the buckets do not list',
        );
        assert.match(out, /Generated gen-l10n accessors are excluded from both/);
      });

      // Printing one key twice is worse than not printing it: the owner reads
      // the second line as a second gap.
      test('does NOT re-print consentReadPolicy, and says which guard owns it', () => {
        const { out } = run(REPO);
        assert.doesNotMatch(out, /consentReadPolicy \[declared in/);
        assert.match(out, new RegExp(`consentReadPolicy is unrendered too and is deliberately NOT listed above: ${CONSENT_GUARD}`));
      });

      // 🔴 …AND THE SUPPRESSION IS CONDITIONAL, NOT A MUTE. If the crediting
      // guard's limb goes, the key must fall through into THIS print rather than
      // vanishing from both. Nothing in this file can be edited to hide a key.
      test('starts printing consentReadPolicy when the crediting guard is gone', () => {
        const { code, out } = run(REPO, guardCopy(orphanTheSuppression));
        assert.equal(code, 0, out);
        assert.match(out, /consentReadPolicy \[declared in 1 of 2 enforced tree\(s\)\]/);
        assert.doesNotMatch(out, /deliberately NOT listed above/);
      });

      // 🔴 THE MUTATION THE SANITY CEILING EXISTS FOR, run against the real tree
      // rather than a fixture. Break the accessor matcher and all 309 reviewed
      // keys look unrendered — an owner gap so large it is obviously a broken
      // scan, and one that a limb which merely "prints and never fails" would
      // happily print forever.
      test('FAILS on the REAL repo when the accessor matcher stops matching', () => {
        const { code, out } = run(REPO, guardCopy(breakAccessorMatcher));
        assert.equal(code, 1, 'a broken accessor matcher printed a 309-key owner gap and passed');
        assert.match(out, /COVERAGE LOST — \d+ of \d+ declared key\(s\) reached no accessor/);
        assert.match(out, /the accessor matcher has stopped matching/);
        // …and the owner print was suppressed rather than drowned in noise.
        assert.doesNotMatch(out, /👤 OWNER l10n render direction/);
      });
    });
  });
});
