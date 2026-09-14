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
  chassisImportPrefix,
  dartCodeOnly,
  boundNamesOf,
  isReferencePosition,
  referenceIndexOf,
  declaredNamesOf,
  delegationOf,
  delegationOfAbs,
  delegationsUnder,
  delegationsUnderAbs,
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
  write('apps/subscriptiontracker/lib/features/settings/settings_screen.dart', adapter);
  if (target !== null) write(`${CHASSIS_DIR}/lib/${targetPath}`, target);
  for (const [rel, body] of Object.entries(extra)) write(rel, body);
  return root;
}

const ADAPTER = 'apps/subscriptiontracker/lib/features/settings/settings_screen.dart';
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
    assert.equal(delegationOf(root, 'apps/subscriptiontracker/lib/features/settings/nowhere.dart'), null);
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

  // ⏱ 2026-09-14 — O-CHASSIS-DELEGATION-RESOLVER-LIMITS, limit 1. B1 passed
  // only because its barrel sat at lib/ itself, where "relative to lib/" and
  // "relative to the barrel" are the same directory. B3 is the shape that was
  // measured failing: a barrel one directory down, exporting its sibling.
  test('B3 · a barrel in a SUBDIRECTORY resolves its export against its OWN directory', () => {
    const root = tree({
      adapter:
        `import 'package:${CHASSIS_PKG}/shell/app_shell.dart';\n` +
        '\nclass SettingsScreen {\n  Widget build(c) => const ConsentPromptCard();\n}\n',
      targetPath: 'shell/app_shell.dart',
      target: "export 'consent_prompt_card.dart';\n\nclass NikatruApp {}\n",
      extra: {
        [`${CHASSIS_DIR}/lib/shell/consent_prompt_card.dart`]: 'class ConsentPromptCard {}\n',
      },
    });
    const d = resolveIn(root);
    assert.ok(!d.lost, d.lost);
    assert.deepEqual(d.files, [`${CHASSIS_DIR}/lib/shell/app_shell.dart`, `${CHASSIS_DIR}/lib/shell/consent_prompt_card.dart`]);
    assert.equal(d.usedSymbol, 'ConsentPromptCard');
  });

  test('B3-control · the lib/-relative spelling of that path is NOT on disk, and is not invented', () => {
    // The old resolution would have looked for lib/consent_prompt_card.dart.
    // Put a DIFFERENT file there: it must not be picked up by a barrel in shell/.
    const root = tree({
      adapter:
        `import 'package:${CHASSIS_PKG}/shell/app_shell.dart';\n` +
        '\nclass SettingsScreen {\n  Widget build(c) => const Decoy();\n}\n',
      targetPath: 'shell/app_shell.dart',
      target: "export 'consent_prompt_card.dart';\n\nclass NikatruApp {}\n",
      extra: {
        [`${CHASSIS_DIR}/lib/shell/consent_prompt_card.dart`]: 'class ConsentPromptCard {}\n',
        [`${CHASSIS_DIR}/lib/consent_prompt_card.dart`]: 'class Decoy {}\n',
      },
    });
    const d = resolveIn(root);
    assert.ok(d.lost, 'a file at the lib/-relative path is not what the barrel exports');
  });

  test('B4 · an export that climbs out of the package lib/ is not followed', () => {
    const root = tree({
      adapter:
        `import 'package:${CHASSIS_PKG}/barrel.dart';\n` +
        '\nclass SettingsScreen {\n  Widget build(c) => const Outside();\n}\n',
      targetPath: 'barrel.dart',
      target: "export '../test/outside.dart';\n\nclass Inside {}\n",
      extra: { [`${CHASSIS_DIR}/test/outside.dart`]: 'class Outside {}\n' },
    });
    const d = resolveIn(root);
    assert.ok(d.lost, 'a file outside lib/ must not become evidence');
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

  // ⏱ 2026-09-14 — O-CHASSIS-DELEGATION-RESOLVER-LIMITS, limit 2, measured on
  // `bootstrapNikatru`: a parameter list CONTAINING parentheses hid the
  // declaration from both function patterns.
  test('F1 · a top-level function with a FUNCTION-TYPED parameter is public API', () => {
    const api = publicApiOf(
      'Future<void> bootstrapNikatru(Future<void> Function(Future<void> Function() appRunner) runGuarded) async {\n  x();\n}\n',
    );
    assert.ok(api.has('bootstrapNikatru'), [...api].join(','));
  });

  test('F1-delegation · a target whose ONLY public name is that function resolves, instead of refusing', () => {
    const root = tree({
      adapter:
        `import 'package:${CHASSIS_PKG}/bootstrap.dart';\n` +
        '\nvoid main() {\n  bootstrapNikatru((run) async => run());\n}\n',
      targetPath: 'bootstrap.dart',
      target:
        'Future<void> bootstrapNikatru(\n' +
        '  Future<void> Function(Future<void> Function() appRunner) runGuarded,\n' +
        ') async {\n  x();\n}\n',
    });
    const d = resolveIn(root);
    assert.ok(!d.lost, d.lost);
    assert.equal(d.usedSymbol, 'bootstrapNikatru');
  });

  test('F2 · a MEMBER with a function-typed parameter is a declared name of the adapter too', () => {
    const names = declaredNamesOf('class A {\n  void runGuarded(void Function(int Function() f) cb) {\n  }\n}\n');
    assert.ok(names.has('runGuarded'), [...names].join(','));
  });

  test('F3-bound · a fourth level of nesting is still unseen, and that is a refusal, never a pass', () => {
    const api = publicApiOf('void deep(void Function(void Function(void Function() a) b) c) {\n}\n');
    assert.ok(!api.has('deep'), 'three levels is the stated bound');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE SECOND HALF OF THE USE CHECK, AND THE SECOND MEASURED EXPLOIT.
//
// The use check shipped on 2026-09-05 asked only "does the adapter's code
// contain a name the target declares". A second independent review measured, on
// the real tree and with `origin/main`'s guard calling the SAME TREE FAILED,
// that a token THE ADAPTER ITSELF DECLARES satisfied it:
//   · `assert-consent-withdrawal-surface` (DPDP §6(3)) — control deleted, one
//     unused import of a chassis file declaring `class SettingsScreen` — EXIT 0.
//   · `assert-no-seam-forks` parity limb ([ADR 066] constraint 2) — gate
//     deleted, same shape with `class LoginScreen` — EXIT 0.
//   · and a chassis file holding the single line `final l10n = 0;` answered for
//     `settings_screen.dart`, `login_screen.dart` and `home_screen.dart` alike,
//     so the check bound NOTHING on any brick screen in the tree.
//
// Every case below is one of those, pinned. The two `-control` cases are what
// stops a resolver that simply refuses everything from passing this file: a
// refusal with no green control beside it is not evidence of anything.
// ─────────────────────────────────────────────────────────────────────────────
describe('🔴 SAME-NAME SHADOWING — the adapter\'s own names are not evidence', () => {
  const SCREEN_TARGET =
    'import "package:flutter/material.dart";\n\n' +
    'class SettingsScreen extends StatelessWidget {\n' +
    '  const SettingsScreen({super.key});\n' +
    '  @override\n' +
    '  Widget build(BuildContext context) => const SizedBox.shrink();\n' +
    '}\n';

  test('U6-shadow · the target declaring the SAME CLASS NAME the adapter declares is refused', () => {
    // The naturally-occurring case, not a contrived one: [ADR 067] decision 2
    // moves `SettingsScreen` itself into `package:nikatru_chassis_screens`.
    const root = tree({
      adapter: `${IMPORT}\nclass SettingsScreen extends StatelessWidget {\n  @override\n  Widget build(BuildContext c) => const SizedBox.shrink();\n}\n`,
      target: SCREEN_TARGET,
    });
    const d = resolveIn(root);
    assert.ok(d && d.lost, 'the adapter\'s own class must not be the reference');
    assert.match(d.lost, /is a name THIS FILE ALSO DECLARES/);
    assert.match(d.lost, /SettingsScreen/);
  });

  test('U6-shadow-control · the same target, an adapter that does NOT shadow it, resolves', () => {
    const root = tree({
      adapter: `${IMPORT}\nclass SettingsAdapter extends StatelessWidget {\n  @override\n  Widget build(BuildContext c) => const SettingsScreen();\n}\n`,
      target: SCREEN_TARGET,
    });
    const d = resolveIn(root);
    assert.ok(!d.lost, `must resolve, got: ${d && d.lost}`);
    assert.equal(d.usedSymbol, 'SettingsScreen');
  });

  test('U7-shadow · `final l10n = 0;` in the target, shadowed by the adapter\'s own local, is refused', () => {
    // The measured one-line chassis file. `l10n` is a name every brick screen
    // in the tree already spells, so accepting it bound nothing at all.
    const root = tree({
      adapter:
        `${IMPORT}\nclass SettingsScreen extends StatelessWidget {\n` +
        '  @override\n  Widget build(BuildContext context) {\n' +
        '    final l10n = AppLocalizations.of(context)!;\n' +
        '    return Text(l10n.settingsTitle);\n  }\n}\n',
      target: 'final l10n = 0;\n',
    });
    const d = resolveIn(root);
    assert.ok(d && d.lost, 'a local the adapter declares must not be the reference');
    assert.match(d.lost, /is a name THIS FILE ALSO DECLARES/);
  });

  test('U7-shadow-b · …and a MEMBER ACCESS (`context.l10n`) is not a reference either', () => {
    // Here the adapter declares nothing called `l10n` — it only ever reads one
    // off `context`. `context.l10n` names a member of `context`; the imported
    // top-level `l10n` is a different thing spelled the same way.
    const root = tree({
      adapter:
        `${IMPORT}\nclass SettingsScreen extends StatelessWidget {\n` +
        '  @override\n  Widget build(BuildContext context) => Text(context.l10n.settingsTitle);\n}\n',
      target: 'final l10n = 0;\n',
    });
    const d = resolveIn(root);
    assert.ok(d && d.lost, 'a member access must not satisfy the use check');
    assert.match(d.lost, /never references anything it declares \(l10n\)/);
  });

  test('U7-shadow-control · a lowercase top-level name referenced BARE still resolves', () => {
    const root = tree({
      adapter: `${IMPORT}\nclass SettingsScreen {\n  void go() => openSettingsBody();\n}\n`,
      target: 'void openSettingsBody() {\n  x();\n}\n',
    });
    const d = resolveIn(root);
    assert.ok(!d.lost, `must resolve, got: ${d && d.lost}`);
    assert.equal(d.usedSymbol, 'openSettingsBody');
  });

  test('P1 · a PREFIXED import (`as chassis`) resolves through `chassis.SettingsBody`', () => {
    // The member-access rule must not refuse the one honest way to write a
    // prefixed delegation — that would be a COVERAGE LOST on a real one.
    const root = tree({
      adapter:
        `import 'package:${CHASSIS_PKG}/settings_body.dart' as chassis;\n` +
        '\nclass SettingsScreen {\n  Widget build(c) => const chassis.SettingsBody();\n}\n',
    });
    const d = resolveIn(root);
    assert.ok(!d.lost, `must resolve, got: ${d && d.lost}`);
    assert.equal(d.usedSymbol, 'SettingsBody');
    assert.equal(chassisImportPrefix(`import 'package:${CHASSIS_PKG}/settings_body.dart' as chassis;\n`), 'chassis');
  });

  test('D1 · declaredNamesOf takes the VARIABLE, never its type — evidence survives', () => {
    // If the subtraction ate the type name, `final SettingsBody body = …` would
    // remove the only symbol that could ever prove the delegation.
    const names = declaredNamesOf('class S {\n  final SettingsBody body = const SettingsBody();\n}\n');
    assert.ok(names.has('body'), [...names].join(','));
    assert.equal(names.has('SettingsBody'), false, [...names].join(','));
  });

  test('D2 · declaredNamesOf sees locals and members, which publicApiOf deliberately does not', () => {
    const src = 'class S {\n  Widget build(BuildContext c) {\n    final l10n = 0;\n    return X();\n  }\n}\n';
    assert.equal(publicApiOf(src).has('l10n'), false);
    assert.ok(declaredNamesOf(src).has('l10n'));
    assert.ok(declaredNamesOf(src).has('build'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE THIRD MEASURED EXPLOIT — A BINDING IS AS GOOD A SHADOW AS A DECLARATION.
//
// The subtraction shipped on 2026-09-06 collected what the adapter DECLARES and
// not what it BINDS. A third independent review measured, on the real tree at
// `a54bea1b`, that `context` and `ref` are PARAMETERS of every
// `Widget build(BuildContext context, WidgetRef ref)` in the tree, so a chassis
// file whose only top-level name was `final context = 0;` survived the
// subtraction and was referenced bare by every screen — turning the deleted
// DPDP withdrawal control and the deleted `caps.oauthRedirect` gate from EXIT 1
// back into EXIT 0, with `origin/main`'s copy of the same two guards calling the
// same trees FAILED. Measured over `declaredNamesOf` at that head:
// `settings_screen.dart` DECLARES 54 names and references 238 bare identifiers
// it does not declare; `login_screen.dart`, 21 against 146. Any ONE of them,
// declared in the chassis file, was accepted as proof.
//
// Dart is why this shape and not its neighbour: a parameter, a local, a catch
// clause or a loop variable LEGALLY shadows an imported top-level name, so that
// tree still compiles and nothing else ever complains. Colliding instead with a
// name from another import (`Widget`, `Scaffold`) is an ambiguous-import error,
// so the compiler already refuses it. The shadowing case is the one the compiler
// waves through — so it is the one this module has to catch itself.
//
// `U8-param-control` is what stops a resolver that simply refuses everything
// from passing this file: the same adapter, with all five binding shapes in it,
// must still resolve on a name it neither declares nor binds.
// ─────────────────────────────────────────────────────────────────────────────
describe('🔴 BOUND NAMES — a parameter shadows an import exactly as a declaration does', () => {
  /** The real shape: a Riverpod screen whose `build` binds `context` and `ref`,
   *  with a catch clause, a loop variable, a typed local and a closure. */
  const riverpodAdapter = (body) =>
    `${IMPORT}\nclass SettingsScreen extends ConsumerWidget {\n` +
    '  @override\n' +
    '  Widget build(BuildContext context, WidgetRef ref) {\n' +
    '    AppLocalizations l10n = AppLocalizations.of(context)!;\n' +
    '    try {\n      load();\n    } catch (e) {\n      report(e);\n    }\n' +
    '    for (final item in items) {\n      use(item);\n    }\n' +
    `    ${body}\n` +
    '    return Scaffold(body: Text(l10n.settingsTitle), onTap: (value) => go(value));\n' +
    '  }\n}\n';

  const refusedOn = (targetSource) => {
    const root = tree({ adapter: riverpodAdapter('noop();'), target: targetSource });
    return resolveIn(root);
  };

  test('U8-param · the target\'s only public name is `context`, a PARAMETER of the adapter\'s build', () => {
    const d = refusedOn('final context = 0;\n');
    assert.ok(d && d.lost, 'a parameter must not be the reference');
    assert.match(d.lost, /is a name THIS FILE ALSO DECLARES OR BINDS/);
    assert.match(d.lost, /context/);
  });

  test('U8-param-b · …and the same with `ref`, the second parameter of every ConsumerWidget build', () => {
    const d = refusedOn('final ref = 0;\n');
    assert.ok(d && d.lost, 'the WidgetRef parameter must not be the reference');
    assert.match(d.lost, /is a name THIS FILE ALSO DECLARES OR BINDS/);
  });

  test('U8-param-c · a CATCH BINDING (`catch (e)`) is a binding, not evidence', () => {
    const d = refusedOn('final e = 0;\n');
    assert.ok(d && d.lost, 'a catch clause binds');
    assert.match(d.lost, /is a name THIS FILE ALSO DECLARES OR BINDS/);
  });

  test('U8-forin · a FOR-IN loop variable is a binding — the `final|var` pattern answers the collection', () => {
    // `for (final item in items)` matched the older pattern as `items`, the
    // thing being iterated, and left `item` in the evidence set.
    const d = refusedOn('final item = 0;\n');
    assert.ok(d && d.lost, 'a loop variable binds');
    assert.match(d.lost, /is a name THIS FILE ALSO DECLARES OR BINDS/);
  });

  test('U8-typed-local · a PLAIN TYPED LOCAL (`AppLocalizations l10n = …`) binds too', () => {
    // The `final|const|late|var` pattern cannot see this one, and `l10n` is the
    // name the second review already measured as spelled by every brick screen.
    const d = refusedOn('final l10n = 0;\n');
    assert.ok(d && d.lost, 'a typed local binds');
    assert.match(d.lost, /is a name THIS FILE ALSO DECLARES OR BINDS/);
  });

  test('U8-closure-param · a CLOSURE parameter (`(value) => …`) binds', () => {
    const d = refusedOn('final value = 0;\n');
    assert.ok(d && d.lost, 'a closure parameter binds');
    assert.match(d.lost, /is a name THIS FILE ALSO DECLARES OR BINDS/);
  });

  // 🟢 THE GREEN CONTROL for all six. Same adapter, same five binding shapes —
  // a name it neither declares nor binds still resolves, so the subtraction
  // refuses the exploit without refusing everything.
  test('U8-param-control · a genuine bare top-level name the adapter neither declares nor binds resolves', () => {
    const root = tree({
      adapter: riverpodAdapter('openSettingsBody();'),
      target: 'void openSettingsBody() {\n  x();\n}\n',
    });
    const d = resolveIn(root);
    assert.ok(!d.lost, `must resolve, got: ${d && d.lost}`);
    assert.equal(d.usedSymbol, 'openSettingsBody');
  });

  test('U8-arg-control · a CALL ARGUMENT is a reference, not a binding — evidence survives', () => {
    // `Text(SettingsBody())` must not subtract `SettingsBody`: a call's
    // arguments are references, and reading them as bindings would turn every
    // honest delegation that passes the chassis widget into a COVERAGE LOST.
    const bound = boundNamesOf('class S {\n  Widget build(BuildContext context) {\n    return Text(SettingsBody(), openSettingsBody());\n  }\n}\n');
    assert.equal(bound.has('SettingsBody'), false, [...bound].join(','));
    assert.equal(bound.has('openSettingsBody'), false, [...bound].join(','));
    assert.ok(bound.has('context'), [...bound].join(','));
  });

  test('D3 · boundNamesOf collects every binding shape, and an `if (…)` condition is not one', () => {
    const bound = boundNamesOf(
        'class S {\n  Widget build(BuildContext context, WidgetRef ref) {\n' +
        '    AppLocalizations l10n = X.of(context)!;\n' +
        '    if (isChassisReady) { load(); }\n' +
        '    try { load(); } catch (e) { report(e); }\n' +
        '    for (final item in items) { use(item); }\n' +
        '    final (a, b) = pair;\n' +
        '    return Wrap(onTap: (value) => go(value));\n  }\n}\n',
    );
    for (const n of ['context', 'ref', 'l10n', 'e', 'item', 'a', 'b', 'value']) {
      assert.ok(bound.has(n), `${n} must be collected — have ${[...bound].sort().join(',')}`);
    }
    // A condition holds REFERENCES. Subtracting them would refuse honest evidence.
    assert.equal(bound.has('isChassisReady'), false, [...bound].sort().join(','));
    assert.equal(bound.has('items'), false, [...bound].sort().join(','));
    assert.equal(bound.has('pair'), false, [...bound].sort().join(','));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 A LABEL IS NOT A REFERENCE — the use check judges POSITIONS, not text.
//
// The two subtractions above (`declaredNamesOf`, `boundNamesOf`) remove names
// the ADAPTER owns. A fourth independent review measured, on the real tree at
// `4faa5731`, that a name the adapter owns nothing of could still satisfy the
// use check by appearing where Dart never resolves a reference at all — most
// abundantly the NAMED ARGUMENT LABEL, the token before the `:` in `child:`.
// `apps/subscriptiontracker/.../settings_screen.dart` spells `child:` 51 times, so a chassis
// file whose only top-level name is `final child = 0;` was "referenced" by it
// fifty-one times without once referring to the package. R8 below is that
// exploit; the `-control` cases beside it are what stops a resolver that simply
// refuses everything from passing this file.
// ─────────────────────────────────────────────────────────────────────────────
describe('🔴 A LABEL IS NOT A REFERENCE — positions, not text', () => {
  /** The exploit's target: the Flutter argument vocabulary as a top-level name,
   *  plus a never-called free function carrying the deleted control. */
  const R8_TARGET = 'final child = 0;\n\nvoid deadShim(dynamic ref) {\n  recordAnalyticsConsent(ref, granted: false);\n}\n';

  /** An adapter body inside a `build` that is NOT a binding site for `child`. */
  const screen = (body) => `${IMPORT}\nclass SettingsScreen {\n  Widget build(c) {\n    ${body}\n  }\n}\n`;

  test('R8 · the target\'s only names are `child` (spelled only as a NAMED ARGUMENT LABEL) and a never-called shim', () => {
    // Measured on the real tree, each mutation reverted: deleting the
    // `recordAnalyticsConsent(` call at settings_screen.dart:601 took
    // assert-consent-withdrawal-surface to EXIT 1 (the green control); adding
    // ONE unused chassis import and this target took it back to EXIT 0.
    const root = tree({ adapter: screen('return Padding(padding: p, child: Text("x"));'), target: R8_TARGET });
    const d = resolveIn(root);
    assert.ok(d && d.lost, `a named argument label must not be evidence, got: ${JSON.stringify(d)}`);
    assert.match(d.lost, /never references anything it declares/);
    assert.match(d.lost, /child/);
    assert.match(d.lost, /deadShim/);
  });

  test('R8-live-control · …and the SAME target resolves once the adapter really calls the shim', () => {
    // The positive half of the rule, and the one level of resolution it does:
    // the delegating file must reference the chassis symbol that carries the
    // behaviour. When it does, this is an honest delegation and must resolve —
    // without this control, R8 above is equally consistent with "refuse
    // everything", which would redden the first real chassis unit.
    const root = tree({ adapter: screen('deadShim(c);\n    return Padding(padding: p, child: Text("x"));'), target: R8_TARGET });
    const d = resolveIn(root);
    assert.ok(!d.lost, `a real call to the shim IS evidence, got: ${d && d.lost}`);
    assert.equal(d.usedSymbol, 'deadShim');
  });

  test('L1-named-arg · a name spelled ONLY as `child:` is refused, however many times', () => {
    const many = Array.from({ length: 51 }, () => 'Padding(child: Text("x"))').join(', ');
    const root = tree({ adapter: screen(`return Row(children: [${many}]);`), target: 'final child = 0;\n' });
    const d = resolveIn(root);
    assert.ok(d && d.lost, 'fifty-one labels are still zero references');
    assert.match(d.lost, /never references anything it declares \(child\)/);
  });

  test('L1-control · the same target, referenced ONCE as a bare value, resolves', () => {
    const root = tree({ adapter: screen('return Padding(child: Text(child));'), target: 'final child = 0;\n' });
    const d = resolveIn(root);
    assert.ok(!d.lost, `a value position IS a reference, got: ${d && d.lost}`);
    assert.equal(d.usedSymbol, 'child');
  });

  test('L2-map-key · a MAP-LITERAL KEY is a slot name, not a reference', () => {
    const root = tree({ adapter: screen('final m = <String, int>{title: 1};\n    return Text("$m");'), target: 'final title = 0;\n' });
    const d = resolveIn(root);
    assert.ok(d && d.lost, 'a map key must not be evidence');
    assert.match(d.lost, /never references anything it declares \(title\)/);
  });

  test('L3-case-label · a `case x:` LABEL is not a reference', () => {
    const root = tree({ adapter: screen('switch (v) {\n      case child:\n        break;\n    }\n    return null;'), target: 'final child = 0;\n' });
    const d = resolveIn(root);
    assert.ok(d && d.lost, 'a switch-case label must not be evidence');
    assert.match(d.lost, /never references anything it declares \(child\)/);
  });

  test('L4-ternary-control · a TERNARY\'s true branch IS a reference — the colon rule is immediate, not greedy', () => {
    // `dart format` writes ` ? a : b` with spaces and `child:` without one, so
    // the discriminator is the IMMEDIATE colon. Without this control the rule
    // could tighten to `ident\s*:` and turn an honest delegation into a
    // COVERAGE LOST, which is the same silent-domain-loss shape one step over.
    const root = tree({ adapter: screen('return Text(flag ? child : other);'), target: 'final child = 0;\n' });
    const d = resolveIn(root);
    assert.ok(!d.lost, `a ternary branch IS a reference, got: ${d && d.lost}`);
    assert.equal(d.usedSymbol, 'child');
  });

  test('L5-comment · the name ONLY inside a `//` and a `///` comment is not a reference', () => {
    const root = tree({ adapter: screen('// child: the chassis body\n    /// child\n    return Text("x");'), target: 'final child = 0;\n' });
    const d = resolveIn(root);
    assert.ok(d && d.lost, 'a comment must not be evidence');
    assert.match(d.lost, /never references anything it declares \(child\)/);
  });

  test('L6-string · the name ONLY inside a STRING LITERAL, raw string or interpolation is not a reference', () => {
    const root = tree({
      adapter: screen('final a = "child";\n    final b = r\'child\';\n    return Text("$child");'),
      target: 'final child = 0;\n',
    });
    const d = resolveIn(root);
    assert.ok(d && d.lost, 'a string literal must not be evidence');
    assert.match(d.lost, /never references anything it declares \(child\)/);
  });

  // ── The position rule itself, exercised directly. ──────────────────────────
  test('L7-positions · isReferencePosition / referenceIndexOf judge each position by hand', () => {
    const at = (code, name) => referenceIndexOf(code, name);
    // NOT references
    assert.equal(at('f(child: 1);', 'child'), -1, 'named argument label');
    assert.equal(at('{child: 1}', 'child'), -1, 'map key');
    assert.equal(at('case child:', 'child'), -1, 'case label');
    assert.equal(at('child: for (final x in y) {}', 'child'), -1, 'statement label');
    assert.equal(at('this.child = v;', 'child'), -1, 'initialising formal / member');
    assert.equal(at('a?.child;', 'child'), -1, 'null-aware member access');
    assert.equal(at('a\n    ..child = 1;', 'child'), -1, 'cascade with the dot leading the next line');
    assert.equal(at('ctx\n    .child;', 'child'), -1, 'chain broken across lines by dart format');
    // ARE references
    assert.ok(at('return child;', 'child') >= 0, 'bare reference');
    assert.ok(at('child();', 'child') >= 0, 'call');
    assert.ok(at('child.length;', 'child') >= 0, 'member access ON it');
    assert.ok(at('f(1, child);', 'child') >= 0, 'call argument');
    assert.ok(at('flag ? child : other;', 'child') >= 0, 'ternary true branch');
    assert.ok(at('const [child];', 'child') >= 0, 'list element');
    // The `[start,end)` face, so a caller cannot be handed a different rule.
    assert.equal(isReferencePosition('f(child: 1);', 2, 7), false);
    assert.equal(isReferencePosition('return child;', 7, 12), true);
  });
});

describe('the walk, and what the caller owns', () => {
  test('W1 · delegationsUnder collects files AND hands every refusal to the caller', () => {
    const root = tree({
      adapter: `${IMPORT}\nclass SettingsScreen {\n  Widget build(c) => const SettingsBody();\n}\n`,
      extra: {
        'apps/subscriptiontracker/lib/features/settings/broken.dart': `import 'package:${CHASSIS_PKG}/nowhere.dart';\nclass B {}\n`,
      },
    });
    const { files, lost } = delegationsUnder(root, 'apps/subscriptiontracker/lib/features/settings');
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

  // The absolute-path face shipped as THREE byte-identical copies in
  // assert-consent-withdrawal-surface / assert-deletion-control /
  // assert-no-price-literals — the same defect one level down from the one this
  // module exists to end. Exported once; these are its cases.
  test('X1 · delegationOfAbs answers exactly what delegationOf answers', () => {
    const root = tree({ adapter: `${IMPORT}\nclass SettingsScreen {\n  Widget build(c) => const SettingsBody();\n}\n` });
    const abs = delegationOfAbs(join(root, ...ADAPTER.split('/')), root);
    assert.deepEqual(abs.files, [`${CHASSIS_DIR}/lib/settings_body.dart`]);
    assert.equal(abs.usedSymbol, 'SettingsBody');
  });

  test('X2 · delegationsUnderAbs hands the caller the refusals, exactly as the relative face does', () => {
    const root = tree({
      adapter: `${IMPORT}\nclass SettingsScreen {\n  Widget build(c) => const SettingsBody();\n}\n`,
      extra: {
        'apps/subscriptiontracker/lib/features/settings/broken.dart': `import 'package:${CHASSIS_PKG}/nowhere.dart';\nclass B {}\n`,
      },
    });
    const absDir = join(root, 'apps', 'subscriptiontracker', 'lib', 'features', 'settings');
    const { files, lost } = delegationsUnderAbs(absDir, root);
    assert.deepEqual(files, [`${CHASSIS_DIR}/lib/settings_body.dart`]);
    assert.equal(lost.length, 1, lost.join('\n'));
    assert.match(lost[0], /that file is not on disk/);
  });
});
