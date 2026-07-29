// ─────────────────────────────────────────────────────────────────────────────
// stamp-wiring.test.mjs — assert-stamp-wiring.mjs must be able to FAIL.
//
// [pipeline S-2] "The stamp wires every chassis capability the register says it
// must."
//
// ⚠️ REAL-TREE MUTATIONS FIRST (2026-07-29, eight). Fixtures are written second
// and deliberately mirror the real shapes, because a fixture the guard's author
// invents encodes the same misunderstanding as the guard — that is how
// assert-seams-wired.mjs once shipped with all six of its fixtures passing
// against a version that could not fail.
//
//   M1  the createLocalNotificationService() call deleted   -> SURVIVED, and the
//       guard was RIGHT: `NotificationCapabilities.forPlatform(` in
//       settings_screen.dart is a second real call site, so the capability was
//       still wired. The PREDICTION was wrong, not the guard. Re-run as M1b with
//       every notifications call site removed -> caught.
//   M2  the InAppReviewPrompter() call deleted              -> caught
//   M3  the nikatru_lints include repointed                 -> caught
//   M4  the dependency line dropped, the call kept          -> passes HERE by
//       design; assert-capability-register.mjs owns that direction.
//   M5  the brick consumerRoot pointed at a bad path        -> COVERAGE LOST
//   M6  the call left only inside a /* comment */           -> caught
//   M7  the brick DECLARES TelemetryBootstrap, calls gone   -> caught
//   M8  the brick removed from review.consumers             -> caught by the
//       reverse direction; nothing else in the repo would have noticed, because
//       platform_storage still claims the same package.
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
const GUARD = join(CI_DIR, 'assert-stamp-wiring.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-wiring-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';

// ── the shape of the real tree, in miniature ─────────────────────────────────
// `store` is a single-owner package (all public symbols count). `shared` hosts
// TWO capabilities, exactly as packages/platform_storage hosts platform_storage
// and review — that split is where attribution has to be evidence-based.
const PKGS = {
  'packages/core': {
    'seams.dart': `
abstract class KeyValueStore { Future<String?> read(String k); }
abstract class ReviewPrompter { Future<void> requestReview(); }
class NoOpAnalytics { const NoOpAnalytics(); }
`,
  },
  'packages/store': {
    'store.dart': `
import 'package:nikatru_core/seams.dart';
class PrefsKeyValueStore implements KeyValueStore {
  static Future<PrefsKeyValueStore> create() async => PrefsKeyValueStore();
  Future<String?> read(String k) async => null;
}
class StorageCapabilities { const StorageCapabilities(); }
`,
    // The review half of the SAME package, and the implements clause carries an
    // import prefix — `implements core.ReviewPrompter` — which a bare-word
    // matcher would miss. That is the real shape in packages/platform_storage.
    'review.dart': `
import 'package:nikatru_core/seams.dart' as core;
class InAppReviewPrompter implements core.ReviewPrompter {
  Future<void> requestReview() async {}
}
class ReviewCapabilities { const ReviewCapabilities(); }
`,
  },
  // No Dart payload at all — the packages/analysis shape. Its wiring is an
  // analyzer include, so demanding a call site would fire on correct input.
  'packages/lintset': {
    'nikatru_lintset.dart': '// This package intentionally ships no Dart code.\n',
  },
};

const CAPS = [
  {
    id: 'core', owner: 'packages/core', package: 'nikatru_core',
    seams: [
      { file: 'packages/core/lib/seams.dart', symbol: 'KeyValueStore' },
      { file: 'packages/core/lib/seams.dart', symbol: 'ReviewPrompter' },
    ],
    consumers: [BRICK],
  },
  {
    id: 'store', owner: 'packages/store', package: 'nikatru_store',
    implementsSeams: ['KeyValueStore'],
    capabilityMatrix: { symbol: 'StorageCapabilities' },
    consumers: [BRICK],
  },
  {
    id: 'review', owner: 'packages/store', package: 'nikatru_store',
    implementsSeams: ['ReviewPrompter'],
    capabilityMatrix: { symbol: 'ReviewCapabilities' },
    consumers: [BRICK],
  },
  {
    id: 'lints', owner: 'packages/lintset', package: 'nikatru_lintset',
    consumers: [BRICK],
  },
];

const GOOD_LIB = `
import 'package:nikatru_core/seams.dart' as core;
import 'package:nikatru_store/store.dart';

final store = PrefsKeyValueStore.create();
final prompter = InAppReviewPrompter();
final analytics = const core.NoOpAnalytics();
`;

const GOOD_PUBSPEC = `
name: probe
dependencies:
  nikatru_core:
    path: ../../packages/core
  nikatru_store:
    path: ../../packages/store
dev_dependencies:
  nikatru_lintset:
    path: ../../packages/lintset
`;

const GOOD_OPTS = 'include: package:nikatru_lintset/analysis_options.yaml\n';

function write(root, rel, body) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
}

function tree({
  lib = GOOD_LIB,
  pubspec = GOOD_PUBSPEC,
  opts = GOOD_OPTS,
  caps = CAPS,
  consumerRoots = ['apps/subly', BRICK],
  pkgs = PKGS,
} = {}) {
  const root = join(TMP, `r${seq++}`);
  write(root, 'tooling/capability-register.json',
    JSON.stringify({ consumerRoots, capabilities: caps }, null, 2));
  write(root, `${BRICK}/lib/providers.dart`, lib);
  write(root, `${BRICK}/pubspec.yaml`, pubspec);
  write(root, `${BRICK}/analysis_options.yaml`, opts);
  for (const [pkg, files] of Object.entries(pkgs)) {
    for (const [name, body] of Object.entries(files)) write(root, `${pkg}/lib/${name}`, body);
  }
  return root;
}

const run = (cwd) => {
  const r = spawnSync(process.execPath, [GUARD], { cwd, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('assert-stamp-wiring', () => {
  test('passes when every claimed capability is really called', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /core → NoOpAnalytics/);
    assert.match(out, /store → PrefsKeyValueStore/);
    assert.match(out, /review → InAppReviewPrompter/);
    assert.match(out, /lints → analysis_options\.yaml/);
  });

  // 🔴 THE DEFECT S-2 EXISTS FOR. The package resolves, analyzes and ships, and
  // nothing in it ever runs.
  test('FAILS when a capability is depended on but never called', () => {
    const { code, out } = run(tree({
      lib: GOOD_LIB.replace('final prompter = InAppReviewPrompter();', ''),
    }));
    assert.equal(code, 1);
    assert.match(out, /review — the stamp DEPENDS on `nikatru_store` but never CALLS it/);
  });

  // 🔴 M6 — strip comments before scanning, including the one you just wrote.
  test('FAILS when the only call site is inside a comment', () => {
    const { code, out } = run(tree({
      lib: GOOD_LIB.replace(
        'final prompter = InAppReviewPrompter();',
        '/* final prompter = InAppReviewPrompter(); */',
      ),
    }));
    assert.equal(code, 1, 'a commented-out call is not wiring');
    assert.match(out, /review — the stamp DEPENDS/);
  });

  test('FAILS when the only call site is inside a string literal', () => {
    const { code, out } = run(tree({
      lib: GOOD_LIB.replace(
        'final prompter = InAppReviewPrompter();',
        "final doc = 'call InAppReviewPrompter() to review';",
      ),
    }));
    assert.equal(code, 1, 'a call named in a string is documentation, not wiring');
    assert.match(out, /review — the stamp DEPENDS/);
  });

  // 🔴 M7 — declaration-vs-usage, the mistake that has now cost this repo six times.
  test('FAILS when the brick DECLARES the symbol rather than calling the package\'s', () => {
    const { code, out } = run(tree({
      lib: GOOD_LIB.replace(
        'final prompter = InAppReviewPrompter();',
        'class InAppReviewPrompter {}\nfinal p = InAppReviewPrompter();',
      ),
    }));
    assert.equal(code, 1, 'the brick constructs its OWN class of that name');
    assert.match(out, /Struck as brick-declared: InAppReviewPrompter/);
  });

  // ── the anti-vacuity family: a scan that stopped scanning ──────────────────
  test('COVERAGE LOST when the brick consumerRoot does not resolve', () => {
    const { code, out } = run(tree({ consumerRoots: ['apps/subly', `${BRICK}_BROKEN`] }));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });

  test('COVERAGE LOST when no consumerRoot names the brick at all', () => {
    const { code, out } = run(tree({ consumerRoots: ['apps/subly'] }));
    assert.equal(code, 1);
    assert.match(out, /expected exactly ONE consumerRoot/);
  });

  // The original S-2 defect in its purest form: quantifying over an empty set.
  test('COVERAGE LOST when no capability claims the brick', () => {
    const { code, out } = run(tree({
      caps: CAPS.map((c) => ({ ...c, consumers: ['apps/subly'] })),
    }));
    assert.equal(code, 1, 'an empty set makes "every capability is wired" vacuously true');
    assert.match(out, /no capability lists the brick as a consumer/);
  });

  test('COVERAGE LOST when the stamped pubspec declares no nikatru package', () => {
    const { code, out } = run(tree({ pubspec: 'name: probe\ndependencies:\n  flutter:\n' }));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });

  // ── the relationship floor, both directions ───────────────────────────────
  test('FAILS when the stamp depends on a package no capability claims', () => {
    const { code, out } = run(tree({
      pubspec: `${GOOD_PUBSPEC}  nikatru_ghost:\n    path: ../../packages/ghost\n`,
    }));
    assert.equal(code, 1);
    assert.match(out, /nikatru_ghost — the stamped pubspec depends on it, but NO capability/);
  });

  // 🔴 M8 — the shrink nothing else can see. `store` still claims the package,
  // so the pubspec relationship stays satisfied while `review` silently drops
  // out of every check.
  test('FAILS when a capability sharing a package loses the brick from its consumers', () => {
    const { code, out } = run(tree({
      caps: CAPS.map((c) => (c.id === 'review' ? { ...c, consumers: ['apps/subly'] } : c)),
    }));
    assert.equal(code, 1, 'the stamp still calls InAppReviewPrompter');
    assert.match(out, /review — the stamp CALLS `InAppReviewPrompter`/);
  });

  // ── the non-Dart capability ───────────────────────────────────────────────
  test('FAILS when a non-Dart capability is declared but never included', () => {
    const { code, out } = run(tree({ opts: 'include: package:flutter_lints/flutter.yaml\n' }));
    assert.equal(code, 1);
    assert.match(out, /lints — the stamp declares `nikatru_lintset` but nothing/);
  });

  test('a package named only in a config COMMENT is not wiring', () => {
    const { code, out } = run(tree({ opts: '# include: package:nikatru_lintset/analysis_options.yaml\n' }));
    assert.equal(code, 1, 'commented-out config is not configuration');
    assert.match(out, /lints — the stamp declares/);
  });

  // ── attribution on a shared package ───────────────────────────────────────
  // Both capabilities live in packages/store. Calling only the storage half must
  // NOT satisfy the review half, or two capabilities collapse into one check.
  test('a shared package does not let one capability vouch for the other', () => {
    const { code, out } = run(tree({
      lib: GOOD_LIB.replace('final prompter = InAppReviewPrompter();', ''),
    }));
    assert.equal(code, 1);
    assert.match(out, /review — the stamp DEPENDS/);
    assert.doesNotMatch(out, /store — the stamp DEPENDS/, 'the storage half is genuinely wired');
  });

  // "Cannot be checked" must never read as "passes".
  test('FAILS when a capability on a shared package has no attributable symbol', () => {
    const { code, out } = run(tree({
      caps: CAPS.map((c) =>
        c.id === 'review'
          ? { id: 'review', owner: 'packages/store', package: 'nikatru_store', consumers: [BRICK] }
          : c),
    }));
    assert.equal(code, 1, 'no seams, no implementsSeams, no capabilityMatrix — nothing to look for');
    assert.match(out, /review — ZERO attributable symbols/);
  });
});
