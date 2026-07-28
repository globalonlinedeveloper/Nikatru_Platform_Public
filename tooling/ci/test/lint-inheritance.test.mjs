// ─────────────────────────────────────────────────────────────────────────────
// lint-inheritance.test.mjs — assert-lint-inheritance.mjs must be able to FAIL.
//
// [pipeline C-12] One inherited convention set reaches every app — and can fail
// a build.
//
// ⚠️ SECOND LINE OF EVIDENCE. The DESIGN of this guard was settled by a LIVE
// SPIKE on a real stamped app before a line of it was written, because the C-12
// lock said to settle rule-inheritance by spike rather than design around an
// assumption. What the spike measured:
//
//   include declared, no dev_dependency → `include_file_not_found` WARNING and
//                                         `flutter analyze` EXIT 1 (fails loud)
//   include resolving, default severity → prefer_final_locals and avoid_print
//                                         both fire as INFO — and EXIT 0.
//                                         ← inheritance "working", enforcing
//                                           nothing, because the brick lane runs
//                                           `flutter analyze --no-fatal-infos`
//   severity raised in the shared file  → the same rules fire as ERROR, EXIT 1
//                                         in the freshly stamped app
//
// The middle row is why this guard checks severity as well as presence. Then
// five mutations were run against the REAL tree, all caught:
//   1. the brick reverting to its own weaker `flutter_lints` config
//   2. the `errors:` block removed — inherited, and unable to fail anything
//   3. the include kept but the dev_dependency dropped
//   4. the include present ONLY INSIDE A COMMENT — the actual historical state,
//      where the package's one mention of its own mechanism was not code
//   5. the shared set emptied of linter rules
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
const GUARD = join(CI_DIR, 'assert-lint-inheritance.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-lints-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const SHARED_OK = `# Nikatru portfolio baseline lints.
include: package:flutter_lints/flutter.yaml

linter:
  rules:
    prefer_final_locals: true
    avoid_print: true

analyzer:
  language:
    strict-casts: true
  errors:
    avoid_print: error
    include_file_not_found: error
  exclude:
    - "**/*.g.dart"
`;

const INHERIT_OK = 'include: package:nikatru_lints/analysis_options.yaml\n';
const PUBSPEC_OK = 'name: x\ndev_dependencies:\n  nikatru_lints:\n    path: ../analysis\n';

/**
 * A tree mirroring the real one: TEN analysis_options.yaml files, because the
 * guard floors at 10 — a thinner fixture would fail for a reason unrelated to
 * the case under test, and one with no inheriting files at all would agree with
 * a guard whose scan had stopped working.
 */
function tree({ shared = SHARED_OK, overrides = {}, dropPubspec = [] } = {}) {
  const root = join(TMP, `r${seq++}`);
  const files = {
    'packages/analysis/lib/analysis_options.yaml': shared,
    // The self-apply: exempt, reaches the set by relative path so the lint
    // package can analyze itself before the workspace resolves.
    'packages/analysis/analysis_options.yaml': '# Self-apply\ninclude: lib/analysis_options.yaml\n',
  };
  const members = [
    'apps/subly',
    'packages/api_client',
    'packages/core',
    'packages/design_system',
    'packages/notifications',
    'packages/platform_storage',
    'packages/telemetry',
    'tooling/bricks/app/__brick__/apps/{{app_id}}',
  ];
  for (const m of members) {
    files[`${m}/analysis_options.yaml`] = overrides[m] ?? INHERIT_OK;
    if (!dropPubspec.includes(m)) files[`${m}/pubspec.yaml`] = PUBSPEC_OK;
  }
  for (const [f, body] of Object.entries(files)) {
    const p = join(root, f);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('add', '-A');
  return root;
}

const run = (cwd) => {
  const r = spawnSync(process.execPath, [GUARD], { cwd, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';

describe('assert-lint-inheritance', () => {
  test('passes on a tree shaped like the real repository', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0);
    assert.match(out, /10 analysis_options\.yaml file\(s\) found/);
    assert.match(out, /8 file\(s\) inherit the shared set/);
    assert.match(out, /2 rule\(s\) escalated to error/);
  });

  describe('every file inherits the set', () => {
    // THE ORIGINAL DEFECT. The brick shipped one line while apps/subly carried
    // strict-casts, prefer_final_locals and avoid_print — so every stamped app
    // was born with LESS checking than the only app that existed.
    test('FAILS when the brick keeps its own weaker config', () => {
      const { code, out } = run(tree({
        overrides: { [BRICK]: 'include: package:flutter_lints/flutter.yaml\n' },
      }));
      assert.equal(code, 1);
      assert.match(out, /does not include `package:nikatru_lints/);
    });

    // 🔴 THE ACTUAL HISTORICAL STATE: packages/analysis mentioned this exact
    // include INSIDE A COMMENT while using none of it. A raw-text grep would
    // have scored that file compliant, so comments are stripped before matching.
    test('FAILS when the include is present only inside a comment', () => {
      const { code, out } = run(tree({
        overrides: {
          [BRICK]: '# include: package:nikatru_lints/analysis_options.yaml\ninclude: package:flutter_lints/flutter.yaml\n',
        },
      }));
      assert.equal(code, 1);
      assert.match(out, /does not include `package:nikatru_lints/);
    });

    // The include cannot resolve without the dependency, so every rule in it
    // silently stops applying to that package.
    test('FAILS when the include is kept but the dependency is dropped', () => {
      const { code, out } = run(tree({ dropPubspec: [] , overrides: {} }));
      assert.equal(code, 0); // baseline
      const bad = tree({});
      writeFileSync(join(bad, BRICK, 'pubspec.yaml'), 'name: x\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n');
      const r = run(bad);
      assert.equal(r.code, 1);
      assert.match(r.out, /does not declare `nikatru_lints`/);
    });

    // A commented-out dependency is not a dependency.
    test('FAILS when the dependency is only commented out', () => {
      const bad = tree({});
      writeFileSync(join(bad, BRICK, 'pubspec.yaml'), 'name: x\ndev_dependencies:\n  # nikatru_lints:\n  #   path: ../analysis\n');
      const { code, out } = run(bad);
      assert.equal(code, 1);
      assert.match(out, /does not declare `nikatru_lints`/);
    });
  });

  // ── SEVERITY, NOT PRESENCE — the amendment, and the half a naive guard
  //    would have missed entirely. ────────────────────────────────────────────
  describe('the set can actually fail a build', () => {
    test('FAILS when nothing is escalated to error', () => {
      const { code, out } = run(tree({
        shared: SHARED_OK.replace(/  errors:\n    avoid_print: error\n    include_file_not_found: error\n/, ''),
      }));
      assert.equal(code, 1);
      assert.match(out, /declares no rule at `error` severity/);
      assert.match(out, /presence without enforcement/);
    });

    // An `errors:` block over an empty linter is an escalation of nothing.
    test('FAILS when the shared set is emptied of rules', () => {
      const { code, out } = run(tree({
        shared: SHARED_OK.replace(/    prefer_final_locals: true\n    avoid_print: true\n/, ''),
      }));
      assert.equal(code, 1);
      assert.match(out, /declares no enabled linter rules/);
    });

    test('FAILS when the shared set is missing entirely', () => {
      const root = tree();
      rmSync(join(root, 'packages/analysis/lib/analysis_options.yaml'));
      const { code, out } = run(root);
      assert.equal(code, 1);
      assert.match(out, /is MISSING/);
    });
  });

  test('FAILS rather than reporting clean when the scan finds almost nothing', () => {
    const root = tree();
    for (const m of ['apps/subly', 'packages/api_client', 'packages/core']) {
      rmSync(join(root, m, 'analysis_options.yaml'));
    }
    spawnSync('git', ['add', '-A'], { cwd: root });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — found only \d+ analysis_options\.yaml/);
  });
});
