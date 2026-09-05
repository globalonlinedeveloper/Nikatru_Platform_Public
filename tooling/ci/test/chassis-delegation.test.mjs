// ─────────────────────────────────────────────────────────────────────────────
// chassis-delegation.test.mjs — the negative cases for chassis-delegation.mjs,
// the ONE reading of "this brick screen was emptied into
// `package:nikatru_chassis_screens`, and here is the file that now carries it".
//
// The module scans nothing and owns no coverage claim — the eleven guards that
// import it each carry their own COVERAGE LOST over what they read, and each
// has its own delegation cases against its own subject. What THIS file exists
// for is the thing those cannot see: the module's REFUSALS. A resolver that
// stopped refusing would make every one of those eleven suites green while the
// property they pin was asserted nowhere, which is the exact shape
// `assert-guard-coverage.mjs`'s NOT_A_SCANNER exemption is granted against.
//
// 🔴 THE USE CHECK IS THE LIMB WITH A MEASURED HISTORY. Shipped without it on
// 2026-09-05, and an independent reviewer then demonstrated on the real tree
// that ONE UNUSED IMPORT plus a package file merely CONTAINING the token turned
// a deleted DPDP withdrawal control and a deleted caps gate from EXIT 1 into
// EXIT 0. Cases U1–U5 are that finding, pinned: an import is a claim about
// where behaviour went, a reference is evidence, and a mention inside a comment
// or a string literal is neither.
//
// Run:  node --test tooling/ci/test/chassis-delegation.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  CHASSIS_DIR,
  CHASSIS_PKG,
  chassisImportPaths,
  dartCodeOnly,
  delegationOf,
  delegationsUnder,
  publicApiOf,
} from '../chassis-delegation.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-chassis-deleg-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

const WIDGET =
  'import "package:flutter/material.dart";\n\n' +
  'class SettingsBody extends StatelessWidget {\n' +
  '  const SettingsBody({super.key});\n' +
  '  @override\n' +
  '  Widget build(BuildContext context) => const SizedBox.shrink();\n' +
  '}\n';

/** A throwaway repository root with an adapter and (optionally) a package. */
function tree({ adapter, target = WIDGET, targetPath = 'settings_body.dart', extra = {} } = {}) {
  const root = join(TMP, `case-${(seq += 1)}`);
  const write = (rel, body) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };
  write('apps/subly/lib/features/settings/settings_screen.dart', adapter);
  if (target !== null) write(`${CHASSIS_DIR}/lib/${targetPath}`, target);
  for (const [rel, body] of Object.entries(extra)) write(rel, body);
  return root;
}

const ADAPTER = 'apps/subly/lib/features/settings/settings_screen.dart';
const IMPORT = `import 'package:${CHASSIS_PKG}/settings_body.dart';\n`;

const resolveIn = (root) => delegationOf(root, ADAPTER);

describe('the three answers stay three answers', () => {
  // GREEN CONTROL. Without it every refusal below is equally consistent with a
  // resolver that refuses everything — which would pass this file and redden
  // the first real chassis unit.
  test('A1 · an honest delegation resolves to the package file, and says what it used', () => {
    const root = tree({ adapter: `${IMPORT}\nclass SettingsScreen {\n  Widget build(c) => const SettingsBody();\n}\n` });
    const d = resolveIn(root);
    assert.deepEqual(d.files, [`${CHASSIS_DIR}/lib/settings_body.dart`]);
    assert.equal(d.usedSymbol, 'SettingsBody');
  });

  test('A2 · a file that imports nothing from the package is NOT a delegation', () => {
    const root = tree({ adapter: 'class SettingsScreen {\n  Widget build(c) => const Text("x");\n}\n' });
    assert.equal(resolveIn(root), null);
  });

  test('A3 · a file that is not on disk is NOT a delegation either', () => {
    const root = tree({ adapter: IMPORT });
    assert.equal(delegationOf(root, 'apps/subly/lib/features/settings/nowhere.dart'), null);
  });

  // `null` and `{ lost }` must never collapse: a resolver that stopped reaching
  // its target would start reporting "nothing to do".
  test('A4 · a target that is not on disk is a REFUSAL, not "no delegation"', () => {
    const root = tree({
      adapter: `${IMPORT}\nclass SettingsScreen {\n  Widget build(c) => const SettingsBody();\n}\n`,
      target: null,
    });
    const d = resolveIn(root);
    assert.ok(d && d.lost, 'must be a refusal');
    assert.match(d.lost, /that file is not on disk/);
    assert.match(d.lost, /asserted NOWHERE by anything/);
  });

  test('A5 · TWO different chassis imports is refused, not guessed', () => {
    const root = tree({
      adapter:
        `${IMPORT}import 'package:${CHASSIS_PKG}/other_body.dart';\n` +
        '\nclass SettingsScreen {\n  Widget build(c) => const SettingsBody();\n}\n',
      extra: { [`${CHASSIS_DIR}/lib/other_body.dart`]: 'class OtherBody {}\n' },
    });
    const d = resolveIn(root);
    assert.match(d.lost, /imports 2 different `package:nikatru_chassis_screens` paths/);
    assert.match(d.lost, /will not guess between two of them/);
  });

  test('A6 · a target declaring NO public name is refused', () => {
    const root = tree({
      adapter: `${IMPORT}\nclass SettingsScreen {\n  Widget build(c) => const SettingsBody();\n}\n`,
      target: 'const _private = 1;\n',
    });
    assert.match(resolveIn(root).lost, /declares no public top-level name/);
  });
});

describe('ONE LEVEL of barrel expansion, and no further', () => {
  test('B1 · a barrel resolves to the barrel AND what it re-exports', () => {
    const root = tree({
      adapter:
        `import 'package:${CHASSIS_PKG}/barrel.dart';\n` +
        '\nclass SettingsScreen {\n  Widget build(c) => const SettingsBody();\n}\n',
      targetPath: 'barrel.dart',
      target: "export 'src/settings_body.dart';\n",
      extra: { [`${CHASSIS_DIR}/lib/src/settings_body.dart`]: WIDGET },
    });
    const d = resolveIn(root);
    assert.deepEqual(d.files, [`${CHASSIS_DIR}/lib/barrel.dart`, `${CHASSIS_DIR}/lib/src/settings_body.dart`]);
  });

  test('B2 · a barrel over a barrel is NOT walked — the second level is not read', () => {
    const root = tree({
      adapter:
        `import 'package:${CHASSIS_PKG}/barrel.dart';\n` +
        '\nclass SettingsScreen {\n  Widget build(c) => const SettingsBody();\n}\n',
      targetPath: 'barrel.dart',
      target: "export 'inner.dart';\n",
      extra: {
        [`${CHASSIS_DIR}/lib/inner.dart`]: "export 'src/settings_body.dart';\n",
        [`${CHASSIS_DIR}/lib/src/settings_body.dart`]: WIDGET,
      },
    });
    const d = resolveIn(root);
    // `SettingsBody` is two levels down, so the resolver cannot see it and the
    // adapter's reference cannot be substantiated. A walk nobody bounded is a
    // walk that eventually reads the whole repository, so the bound is the
    // point — and it REFUSES rather than quietly resolving to nothing.
    assert.ok(d.lost, 'the second level must not be reached');
  });
});

describe('🔴 THE USE CHECK — an import is a claim, a reference is evidence', () => {
  const withBody = (body) => tree({ adapter: IMPORT + body });

  test('U1 · a resolvable import the adapter NEVER references is refused', () => {
    const d = resolveIn(withBody('\nclass SettingsScreen {\n  Widget build(c) => const Text("x");\n}\n'));
    assert.ok(d.lost, 'an unused import must not resolve');
    assert.match(d.lost, /never references anything it declares \(SettingsBody\)/);
    assert.match(d.lost, /dead code wearing a delegation's costume/);
  });

  test('U2 · a mention inside a COMMENT is not a reference', () => {
    const d = resolveIn(withBody('\n// SettingsBody moved here\nclass SettingsScreen {}\n'));
    assert.ok(d.lost, 'a comment must not satisfy the use check');
  });

  test('U3 · a mention inside a STRING LITERAL is not a reference', () => {
    const d = resolveIn(withBody("\nclass SettingsScreen {\n  final s = 'SettingsBody';\n}\n"));
    assert.ok(d.lost, 'a string literal must not satisfy the use check');
  });

  test("U4 · a mention inside a TRIPLE-QUOTED block is not a reference either", () => {
    const d = resolveIn(withBody("\nclass SettingsScreen {\n  final s = '''\nSettingsBody\n''';\n}\n"));
    assert.ok(d.lost, 'a triple-quoted string must not satisfy the use check');
  });

  test('U5 · the IMPORT LINE itself is not a reference — a delegation cannot prove itself', () => {
    // The import path contains `settings_body`, not `SettingsBody`, but the
    // directive is blanked regardless: nothing about the delegation's own text
    // may count as evidence that it is used.
    const code = dartCodeOnly(`import 'package:${CHASSIS_PKG}/SettingsBody.dart';\nclass X {}\n`);
    assert.doesNotMatch(code, /SettingsBody/);
  });

  test('U6 · a PRIVATE name in the target cannot be the reference', () => {
    const root = tree({
      adapter: `${IMPORT}\nclass SettingsScreen {\n  Widget build(c) => const _SettingsBody();\n}\n`,
      target: 'class _SettingsBody extends StatelessWidget {}\n',
    });
    assert.match(resolveIn(root).lost, /declares no public top-level name/);
  });

  test('U7 · a TOP-LEVEL FUNCTION counts as public API — the shape the exploit used', () => {
    // The reviewer's package file held a free function, not a widget. If those
    // did not count, the honest version of that delegation would be refused and
    // the rule would be unusable for exactly the case it was written for.
    const api = publicApiOf('void recordAnalyticsConsentBody(WidgetRef ref, {bool granted = false}) {\n  x();\n}\n');
    assert.ok(api.has('recordAnalyticsConsentBody'), [...api].join(','));
  });
});

describe('the walk, and what the caller owns', () => {
  test('W1 · delegationsUnder collects files AND hands every refusal to the caller', () => {
    const root = tree({
      adapter: `${IMPORT}\nclass SettingsScreen {\n  Widget build(c) => const SettingsBody();\n}\n`,
      extra: {
        'apps/subly/lib/features/settings/broken.dart': `import 'package:${CHASSIS_PKG}/nowhere.dart';\nclass B {}\n`,
      },
    });
    const { files, lost } = delegationsUnder(root, 'apps/subly/lib/features/settings');
    assert.deepEqual(files, [`${CHASSIS_DIR}/lib/settings_body.dart`]);
    assert.equal(lost.length, 1, lost.join('\n'));
    assert.match(lost[0], /that file is not on disk/);
  });

  test('W2 · the import scan reads RAW source — a blanked literal would find nothing', () => {
    // The defect this pins: assert-seams-wired.mjs matched the import regex
    // against comment- and literal-blanked text, so its whole delegation limb
    // was unreachable while every line of it read as shipped.
    const raw = `import 'package:${CHASSIS_PKG}/settings_body.dart';\nclass X {}\n`;
    assert.deepEqual(chassisImportPaths(raw), ['settings_body.dart']);
    assert.deepEqual(chassisImportPaths(dartCodeOnly(raw)), []);
  });

  test('W3 · this module lives FLAT in tooling/ci, where the stray-.mjs check requires it', () => {
    assert.equal(join(CI_DIR, 'chassis-delegation.mjs').includes('test'), false);
  });
});
