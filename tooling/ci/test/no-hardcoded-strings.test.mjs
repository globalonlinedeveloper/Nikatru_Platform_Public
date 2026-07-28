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
// the matchers are proven against a tree known to be full of violations
// (apps/subly), which is excluded from enforcement precisely because it is.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-no-hardcoded-strings.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-strings-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib';

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
 * The canary needs a tree KNOWN to be dirty, at or above the floor of 20 — the
 * real apps/subly holds 58. A fixture below the floor would fail for the wrong
 * reason, and one with NO dirty tree would let broken matchers look clean, which
 * is the exact failure the canary exists to catch.
 */
function dirtySubly(n = 25) {
  let s = 'class S extends StatelessWidget {\n  Widget build(BuildContext c) {\n    return Column(children: [\n';
  for (let i = 0; i < n; i++) s += `      Text('Legacy label number ${i}'),\n`;
  return `${s}    ]);\n  }\n}\n`;
}

function tree({ brick = CLEAN_BRICK, subly = dirtySubly(), omitBrick = false } = {}) {
  const root = join(TMP, `r${seq++}`);
  const files = {};
  if (!omitBrick) files[`${BRICK}/features/home/home_screen.dart`] = brick;
  files['apps/subly/lib/legacy_screen.dart'] = subly;
  for (const [f, body] of Object.entries(files)) {
    const p = join(root, f);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

const run = (cwd) => {
  const r = spawnSync(process.execPath, [GUARD], { cwd, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('assert-no-hardcoded-strings', () => {
  test('passes when the brick reads everything from l10n', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0);
    assert.match(out, /the brick template shows no hardcoded user-facing strings/);
    assert.match(out, /matchers verified against a known-dirty tree/);
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

    // Generated localisations are the OUTPUT of l10n, not a breach of it.
    test('stays quiet on the generated app_localizations file', () => {
      const root = tree();
      const p = join(root, BRICK, 'l10n/app_localizations.dart');
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, "String get navHome => 'Home';\nText('Welcome to it');\n");
      assert.equal(run(root).code, 0);
    });
  });

  // ── The canary. Without it a broken matcher prints "clean" and passes. ─────
  describe('the matchers are proven to still match', () => {
    test('FAILS when the known-dirty tree stops looking dirty', () => {
      const { code, out } = run(tree({ subly: '// all the legacy strings were removed\n' }));
      assert.equal(code, 1);
      assert.match(out, /COVERAGE LOST — the matchers found only 0 hardcoded string\(s\)/);
      // …and the enforcement half still said "clean", which is the point.
      assert.match(out, /the brick template shows no hardcoded user-facing strings/);
    });

    test('FAILS when the brick tree it protects is gone', () => {
      const { code, out } = run(tree({ omitBrick: true }));
      assert.equal(code, 1);
      assert.match(out, /COVERAGE LOST/);
    });
  });
});
