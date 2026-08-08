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
    ]);
  }
}
`;

/** The declaration the guard holds its own matcher list against. */
const FAMILIES = '# comments and blanks are ignored\n\nText(…)\na labelling parameter\n';

// ⚠️ NO `subly` PARAMETER, since 2026-08-08. `tree()` used to plant a dirty
// `apps/subly/lib/legacy_screen.dart` in every fixture root because the guard
// required one; it now scans no product tree at all, and leaving the parameter
// would have every case below feeding the guard a directory it never opens —
// input that looks like coverage and is not. The one case that still needs an
// `apps/subly` tree writes it itself, in the open.
function tree({
  brick = CLEAN_BRICK,
  fixture = dirtyTree(),
  quiet = QUIET,
  families = FAMILIES,
  omitBrick = false,
} = {}) {
  const root = join(TMP, `r${seq++}`);
  const files = {};
  if (!omitBrick) files[`${BRICK}/features/home/home_screen.dart`] = brick;
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
    assert.match(out, /the brick template shows no hardcoded user-facing strings/);
    assert.match(out, /matchers verified against a known-dirty tree/);
    assert.match(out, /matcher families are exactly those/);
    assert.match(out, /exemptions still exempt/);
  });

  // The canary list is down to one entry, and "one" is a claim with two halves:
  // the surviving canary reports, and the retired one is GONE rather than
  // quietly still being read. Asserting only the first half would pass against a
  // guard that still scanned apps/subly and merely stopped printing about it.
  test('reports the fixture canary and no longer touches any product tree', () => {
    const { out } = run(tree());
    assert.match(out, new RegExp(`known-dirty tree: \\d+ literal\\(s\\) found in ${FIXTURE}/dirty`));
    assert.equal([...out.matchAll(/known-dirty tree:/g)].length, 1, out);
    assert.doesNotMatch(out, /apps\/subly/, 'a retired canary is still named in the output');
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
      assert.match(out, /the brick template shows no hardcoded user-facing strings/);
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
    test('PASSES once apps/subly/lib is cleaned — the retrofit must not turn this red', () => {
      const root = tree();
      const p = join(root, 'apps/subly/lib/legacy_screen.dart');
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, `${CLEAN_BRICK}\n// every literal here now comes from l10n\n`);
      const { code, out } = run(root);
      assert.equal(code, 0, out);
      assert.doesNotMatch(out, /apps\/subly/);
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
      assert.match(out, /the brick template shows no hardcoded user-facing strings/);
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
});
