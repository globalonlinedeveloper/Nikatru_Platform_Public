// ─────────────────────────────────────────────────────────────────────────────
// adapter-set.test.mjs — the ONE adapter derivation, and proof that both guards
// which range over it get the same answer.
//
// adapter-set.mjs replaced two copies (assert-package-boundaries.mjs limb c and
// assert-adapter-capabilities.mjs's domain) that differed on one rule: the
// first counted a dependency sourced from a NON-flutter `sdk:` as third-party,
// the second excluded every `sdk:` dependency. They agreed on the real tree, so
// nothing went red; they disagreed on a tree that carried such a package.
//
// The agreement case below plants exactly that package next to COPIES OF THE
// REAL pubspecs (derived from the tree, not typed) and runs BOTH guards over
// it. Mutation-verified 2026-09-19: restoring assert-package-boundaries.mjs's
// old private pubspec reader (only `sdk: flutter` was an SDK) turned it red,
// because that guard then counted `packages/sdk_only` as an adapter and
// assert-adapter-capabilities.mjs did not.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { deriveAdapters, pubspecDeps, isThirdParty } from '../adapter-set.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-adapter-set-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });
let seq = 0;

const spec = (name, deps, dev = '  lints: ^6.0.0\n') =>
  `name: ${name}\npublish_to: none\nresolution: workspace\n\nenvironment:\n  sdk: ">=3.5.0 <4.0.0"\n\ndependencies:\n${deps}\ndev_dependencies:\n${dev}`;

/** A package whose only non-path dependencies come from an SDK — one of them a
 *  NON-flutter SDK, the rule the two old copies disagreed on. */
const SDK_ONLY = spec('nikatru_sdk_only', '  flutter:\n    sdk: flutter\n  some_tool:\n    sdk: dart\n  nikatru_core:\n    path: ../core\n');

function write(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const f = join(root, rel);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, body);
  }
  return root;
}

describe('adapter-set — deriveAdapters', () => {
  const root = () =>
    write(join(TMP, `u${seq++}`), {
      'packages/core/pubspec.yaml': spec('nikatru_core', '  crypto: ^3.0.0\n'),
      'packages/design_system/pubspec.yaml': spec('nikatru_design_system', '  intl: ^0.20.0\n'),
      'packages/api_client/pubspec.yaml': spec('nikatru_api_client', '  dio: ^5.4.0\n  nikatru_core:\n    path: ../core\n'),
      'packages/analysis/pubspec.yaml': spec('nikatru_analysis', '  flutter_lints: ^6.0.0\n'),
      'packages/sdk_only/pubspec.yaml': SDK_ONLY,
      'packages/commented/pubspec.yaml': spec('nikatru_commented', '  # dio: ^5.4.0 — deliberately absent\n  nikatru_core:\n    path: ../core\n'),
      'packages/dev_only/pubspec.yaml': spec('nikatru_dev_only', '  nikatru_core:\n    path: ../core\n', '  mocktail: ^1.0.0\n'),
      'packages/from_git/pubspec.yaml': spec('nikatru_from_git', '  forked_sdk:\n    git:\n      url: https://example.invalid/forked_sdk.git\n'),
      'packages/no_pubspec/README.md': 'not a package\n',
    });

  test('derives exactly the packages that declare a third-party dependency', () => {
    const got = deriveAdapters(root()).map((a) => `${a.dir}=${a.vendors.join('+')}`).sort();
    assert.deepEqual(got, ['packages/api_client=dio', 'packages/from_git=forked_sdk']);
  });

  test('core and design_system are never adapters, whatever they declare', () => {
    const names = deriveAdapters(root()).map((a) => a.name);
    assert.ok(!names.includes('core') && !names.includes('design_system'), names.join(', '));
  });

  test('a dependency from ANY sdk is not a vendor, not only sdk: flutter', () => {
    const r = root();
    const deps = pubspecDeps(r, 'packages/sdk_only');
    assert.equal(deps.get('some_tool'), 'sdk');
    assert.equal(isThirdParty('some_tool', deps.get('some_tool')), false);
    assert.ok(!deriveAdapters(r).some((a) => a.name === 'sdk_only'));
  });

  test('a commented-out dependency and a dev dependency are not vendors', () => {
    const names = deriveAdapters(root()).map((a) => a.name);
    assert.ok(!names.includes('commented'), names.join(', '));
    assert.ok(!names.includes('dev_only'), names.join(', '));
  });

  test('a tree with no packages/ derives the empty set rather than throwing', () => {
    assert.deepEqual(deriveAdapters(join(TMP, `empty${seq++}`)), []);
  });
});

describe('adapter-set — both guards range over ONE adapter set', () => {
  /** The real packages' pubspecs, copied (derived from the tree, not typed),
   *  plus the real capability register so assert-adapter-capabilities reaches
   *  its domain line, plus the package the old copies disagreed on. */
  function realShapedTree() {
    const root = join(TMP, `g${seq++}`);
    for (const name of readdirSync(join(REPO, 'packages'))) {
      const src = join(REPO, 'packages', name, 'pubspec.yaml');
      if (!existsSync(src)) continue;
      mkdirSync(join(root, 'packages', name), { recursive: true });
      copyFileSync(src, join(root, 'packages', name, 'pubspec.yaml'));
    }
    mkdirSync(join(root, 'tooling'), { recursive: true });
    copyFileSync(join(REPO, 'tooling', 'capability-register.json'), join(root, 'tooling', 'capability-register.json'));
    return write(root, { 'packages/sdk_only/pubspec.yaml': SDK_ONLY });
  }
  const runGuard = (guard, cwd) => {
    const r = spawnSync(process.execPath, [join(CI_DIR, guard)], { cwd, encoding: 'utf8' });
    return `${r.stdout}${r.stderr}`;
  };
  const listAfter = (out, re, guard) => {
    const m = re.exec(out);
    assert.ok(m, `${guard} printed no derived adapter list:\n${out.slice(0, 2000)}`);
    return m[1].split(',').map((s) => s.trim()).filter(Boolean).sort();
  };

  test('assert-package-boundaries and assert-adapter-capabilities derive the same adapter set', () => {
    const root = realShapedTree();
    const expected = deriveAdapters(root).map((a) => a.name).sort();
    assert.ok(expected.length >= 6, `the copied real tree derived only ${expected.length} adapter(s); the fixture is not reaching the tree`);
    assert.ok(!expected.includes('sdk_only'), 'the planted SDK-only package must not be an adapter');

    const fromCapabilities = listAfter(
      runGuard('assert-adapter-capabilities.mjs', root),
      /ok {3}\d+ adapter\(s\) derived from the tree: ([^\n]*)/,
      'assert-adapter-capabilities',
    );
    const fromBoundaries = listAfter(
      runGuard('assert-package-boundaries.mjs', root),
      /derived \d+ wrapped vendor\(s\) from \d+ adapter\(s\) \[([^\]]*)\]/,
      'assert-package-boundaries',
    );
    assert.deepEqual(fromBoundaries, fromCapabilities, 'the two guards range over different adapter sets');
    assert.deepEqual(fromCapabilities, expected);
  });
});
