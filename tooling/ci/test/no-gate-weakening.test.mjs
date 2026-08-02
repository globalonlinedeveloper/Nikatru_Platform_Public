// ─────────────────────────────────────────────────────────────────────────────
// no-gate-weakening.test.mjs — assert-no-gate-weakening.mjs must be able to FAIL.
//
// [pipeline N-4] C-12 makes the inherited rule set REACH every app; this guard
// makes sure no app hollows it out locally. Both can be true of the tree while
// one app is exempt in practice — a fail-shape no other guard reports, because
// they all check that the checks exist rather than that an app opted out.
//
// 🔴 THE REAL TREE WAS MUTATED FIRST. Eleven mutations against a short-path clone
// of this repository (with a genuine mason-stamped `apps/probe` in it), all
// caught, all restored byte-identically:
//
//   a new `// ignore:` in the brick's lib tree · `ignore_for_file: type=lint` ·
//   `@TestOn(` · `skip: true` · `analyzer: errors: <rule>: ignore` ·
//   `analyzer: exclude:` · a per-app dart_test.yaml (added to the index, since
//   the scan is over TRACKED files) · the allowlisted suppression disappearing ·
//   the suppression detector itself neutered · the brick path drifting · an
//   allowlist entry with no reason.
//
// The fixtures below encode what those runs showed. They are the regression net,
// not the evidence.
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
const GUARD = join(CI_DIR, 'assert-no-gate-weakening.mjs');
const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-ngw-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

/** The domain is `git ls-files`, deliberately — a filesystem walk would fail the
 *  build on generated files nobody wrote (apps/subly/.dart_tool/dartpad/
 *  web_plugin_registrant.dart carries `ignore_for_file: type=lint`). So a fixture
 *  that is not a git repository would give this guard nothing to scan. */
function fixture(files, { untracked = {} } = {}) {
  const dir = join(TMP, `f${seq++}`);
  const write = (rel, body) => {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  for (const [rel, body] of Object.entries(files)) write(rel, body);
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'fixture');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture', '--no-gpg-sign');
  // Written AFTER the commit, so they exist on disk and are invisible to
  // `git ls-files` — the generated-file case, modelled rather than described.
  for (const [rel, body] of Object.entries(untracked)) write(rel, body);
  return dir;
}

function run(cwd) {
  const r = spawnSync(process.execPath, [GUARD, cwd], { encoding: 'utf8', cwd });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const CLEAN_DART = "import 'package:flutter/material.dart';\n\nclass HomeScreen {}\n";
const CLEAN_TEST = "void main() {\n  testWidgets('renders', (t) async {\n    expect(1, 1);\n  });\n}\n";
const CLEAN_OPTIONS = 'include: package:nikatru_lints/analysis_options.yaml\n';

const base = (over = {}, opts = {}) => fixture({
  [`${BRICK}/lib/main.dart`]: CLEAN_DART,
  [`${BRICK}/lib/app.dart`]: CLEAN_DART,
  [`${BRICK}/test/smoke_test.dart`]: CLEAN_TEST,
  [`${BRICK}/analysis_options.yaml`]: CLEAN_OPTIONS,
  'apps/subly/lib/main.dart': CLEAN_DART,
  'apps/subly/analysis_options.yaml': CLEAN_OPTIONS,
  ...over,
}, opts);

describe('assert-no-gate-weakening', () => {
  test('passes on a tree where no app has opted itself out', () => {
    const { code, out } = run(base());
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}no gate weakening/);
    // The allowlist is empty in a fixture, so its self-check must say 0/0 rather
    // than firing — an exception list is only checked against what it excuses.
    assert.match(out, /6 clauses, detectors self-tested first/);
  });

  // ── clause 1: any suppression, allowlisted or it fails ────────────────────
  test('FAILS on a new // ignore: in an app-owned Dart tree', () => {
    const { code, out } = run(base({ [`${BRICK}/lib/main.dart`]: `// ignore: avoid_print\n${CLEAN_DART}` }));
    assert.equal(code, 1);
    assert.match(out, /suppresses `avoid_print` and is not on the allowlist/);
    // The line number belongs in the message and NEVER in the contract — a
    // line-pinned allowlist rotted three times in five days in the real tree.
    assert.match(out, /lib\/main\.dart:1/);
  });

  test('FAILS on a file-level ignore_for_file, and says it is file-level', () => {
    const { code, out } = run(base({ [`${BRICK}/lib/app.dart`]: `// ignore_for_file: prefer_final_locals\n${CLEAN_DART}` }));
    assert.equal(code, 1);
    assert.match(out, /FOR THE WHOLE FILE/);
  });

  test('catches every rule in a comma-separated suppression, not just the first', () => {
    const { code, out } = run(base({ [`${BRICK}/lib/app.dart`]: `// ignore: avoid_print, prefer_final_locals\n${CLEAN_DART}` }));
    assert.equal(code, 1);
    assert.match(out, /avoid_print/);
    assert.match(out, /prefer_final_locals/);
  });

  // ── clause 2: the blanket, which names no rule at all ─────────────────────
  test('FAILS on ignore_for_file: type=lint with the reason it is worse', () => {
    const { code, out } = run(base({ [`${BRICK}/lib/app.dart`]: `// ignore_for_file: type=lint\n${CLEAN_DART}` }));
    assert.equal(code, 1);
    assert.match(out, /names NO rule, so it disables every one of them at once/);
  });

  // ── the generated-file case the drafted scope would have failed on ────────
  test('a GENERATED, untracked file carrying type=lint is not the app\'s doing', () => {
    const { code, out } = run(base({}, {
      untracked: { 'apps/subly/.dart_tool/dartpad/web_plugin_registrant.dart': '// ignore_for_file: type=lint\n' },
    }));
    assert.equal(code, 0, 'a guard that fails on a file nobody wrote is a guard somebody switches off');
    assert.match(out, /ok {2}no gate weakening/);
  });

  // ── clauses 3 + 4: the app's own analyzer block ───────────────────────────
  test('FAILS when the app downgrades an inherited rule to ignore', () => {
    const { code, out } = run(base({
      [`${BRICK}/analysis_options.yaml`]: `${CLEAN_OPTIONS}analyzer:\n  errors:\n    avoid_print: ignore\n`,
    }));
    assert.equal(code, 1, 'this sits UNDER a perfectly correct include, where the inheritance guard cannot see it');
    assert.match(out, /downgrades `avoid_print` to `ignore`/);
  });

  test('FAILS on an analyzer exclude glob', () => {
    const { code, out } = run(base({
      [`${BRICK}/analysis_options.yaml`]: `${CLEAN_OPTIONS}analyzer:\n  exclude:\n    - lib/generated/**\n`,
    }));
    assert.equal(code, 1);
    assert.match(out, /An excluded path is not analyzed at all/);
  });

  test('a normal analysis_options.yaml with only an include passes', () => {
    const { code } = run(base());
    assert.equal(code, 0);
  });

  // ── clause 5: skipped tests ───────────────────────────────────────────────
  test('FAILS on skip: true in a test tree', () => {
    const { code, out } = run(base({
      [`${BRICK}/test/smoke_test.dart`]: "void main() {\n  testWidgets('renders', (t) async {}, skip: true);\n}\n",
    }));
    assert.equal(code, 1);
    assert.match(out, /carries `skip:`/);
  });

  test('FAILS on @Skip and on @TestOn', () => {
    for (const annotation of ["@Skip('flaky')", "@TestOn('vm')"]) {
      const { code, out } = run(base({ [`${BRICK}/test/smoke_test.dart`]: `${annotation}\n${CLEAN_TEST}` }));
      assert.equal(code, 1, annotation);
      assert.match(out, /carries `@(Skip|TestOn)\(`/);
    }
  });

  // The false-alarm side. `skip:` inside a comment or a string is not a skipped
  // test, and a guard that cries wolf is one somebody switches off.
  test('does NOT fire on the word skip: inside a comment or a string', () => {
    const { code, out } = run(base({
      [`${BRICK}/test/smoke_test.dart`]:
        "void main() {\n  // never write skip: true here\n  final s = 'skip: true';\n  testWidgets('renders', (t) async {\n    expect(1, 1);\n  });\n}\n",
    }));
    assert.equal(code, 0, out);
  });

  // …and clause 5 is scoped to TEST trees, because `skip:` is a test-API named
  // argument. Scanning lib/ for it would be a false-positive generator.
  test('clause 5 does not range over lib/', () => {
    const { code } = run(base({ [`${BRICK}/lib/app.dart`]: 'final x = Foo(skip: true);\n' }));
    assert.equal(code, 0);
  });

  // ── clause 6: a per-app dart_test.yaml ────────────────────────────────────
  test('FAILS on a per-app dart_test.yaml, which shrinks the suite without touching a test', () => {
    const { code, out } = run(base({ [`${BRICK}/dart_test.yaml`]: 'tags:\n  browser:\n    skip: true\n' }));
    assert.equal(code, 1);
    assert.match(out, /can narrow which tests run/);
  });

  // ── the domain, and the detectors ─────────────────────────────────────────
  test('COVERAGE LOST when the scan reaches no app-owned Dart file at all', () => {
    const { code, out } = run(fixture({ 'README.md': '# nothing here\n' }));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /ZERO tracked Dart files/);
  });

  test('COVERAGE LOST when the brick tree is not reached — the template is where one edit hits fifty apps', () => {
    const { code, out } = run(fixture({
      'apps/subly/lib/main.dart': CLEAN_DART,
      'apps/subly/analysis_options.yaml': CLEAN_OPTIONS,
    }));
    assert.equal(code, 1);
    assert.match(out, /the scan reached no file under/);
  });

  // The trees an app owns. `live_probe/` is on the list because the drafted
  // scope did not reach it and BOTH of the repo's real suppressions live there.
  test('scans live_probe/, which the drafted scope missed', () => {
    const { code, out } = run(base({ 'apps/subly/live_probe/probe.dart': `// ignore: avoid_print\n${CLEAN_DART}` }));
    assert.equal(code, 1, 'both of the tree\'s two real suppressions live in live_probe/');
    assert.match(out, /live_probe\/probe\.dart:1 suppresses `avoid_print`/);
  });

  test('scans integration_test/ and test_driver/ too', () => {
    for (const tree of ['integration_test', 'test_driver']) {
      const { code, out } = run(base({ [`apps/subly/${tree}/x.dart`]: `// ignore: avoid_print\n${CLEAN_DART}` }));
      assert.equal(code, 1, tree);
      assert.match(out, new RegExp(`${tree}/x\\.dart:1 suppresses`));
    }
  });

  // Nothing outside an app's own trees is this guard's business — the shared
  // packages are C-12's subject, and claiming them here would be scope creep
  // that shows up as somebody else's red build.
  test('does not range over packages/ or services/', () => {
    const { code } = run(base({ 'packages/core/lib/x.dart': `// ignore: avoid_print\n${CLEAN_DART}` }));
    assert.equal(code, 0);
  });

  // ── the allowlist's own two directions ────────────────────────────────────
  // 🔴 THESE TWO ARE THE PAIR. The stale-entry check is SCOPED to the tree the
  // allowlist describes, derived from whether the allowlisted files are present
  // at all — without that scoping every fixture above would fail, and with it
  // alone the check could quietly never run anywhere. So one case proves the
  // scope is real and the other proves it still fires.
  const ALLOWLISTED = 'apps/subly/live_probe/c6_consent_live_probe.dart';

  test('the stale-entry check FIRES when the allowlisted file is present and the suppression is gone', () => {
    const { code, out } = run(base({ [ALLOWLISTED]: `${CLEAN_DART}\nvoid log(String s) { print(s); }\n` }));
    assert.equal(code, 1, 'an allowlist entry nobody can find is a licence nobody is watching');
    assert.match(out, /matches NOTHING in the scanned tree/);
  });

  test('…and does NOT fire while the suppression it excuses is still there', () => {
    const { code, out } = run(base({ [ALLOWLISTED]: `${CLEAN_DART}\n// ignore: avoid_print\nvoid log(String s) { print(s); }\n` }));
    assert.equal(code, 0, out);
    assert.match(out, /1\/1 allowlist entr\(ies\) still describe something real/);
  });

  test('a tree the allowlist is not about PRINTS that the stale check was skipped', () => {
    const { code, out } = run(base());
    assert.equal(code, 0, out);
    assert.match(out, /the stale-entry check was NOT performed here/);
  });
});
