// ─────────────────────────────────────────────────────────────────────────────
// l10n_parity_test.dart — every English key has a Tamil value, and the two agree
// on their placeholders.
//
// 🔴 THE HOLE THIS CLOSES, stated as the failure it actually produces.
// `flutter gen-l10n` FALLS BACK TO ENGLISH for a key that is missing from
// `app_ta.arb`. It does not fail. It does not throw at runtime. It prints a line
// into build output nobody reads. So a key added to `app_en.arb` and forgotten in
// `app_ta.arb` ships as an ENGLISH SENTENCE IN THE MIDDLE OF A TAMIL SCREEN —
// and the only person who can see that is a Tamil reader, which is nobody on
// this side of the build. Before P4 L0 the entire assertion was three spot keys
// in `chassis_properties_test.dart`; the other 131 were on trust, and P4 was
// about to add 129 more.
//
// `l10n.yaml`'s `untranslated-messages-file:` is the diagnostic half — it writes
// WHICH keys are missing, in a form a translator can be handed. This is the
// enforcement half: it fails the suite and names them. Both exist because the
// diagnostic file is a build product that nothing reads on its own.
//
// ── THREE LIMBS, AND WHY EACH ONE IS SEPARATE ────────────────────────────────
//   1. en ⊆ ta — the fallback-to-English case above.
//   2. ta ⊆ en — a Tamil key with no English original. That is a translation of
//      something that no longer exists (a rename that only landed on one side),
//      and it is dead weight the fallback can never surface, so nothing else
//      would ever report it.
//   3. placeholders agree — the case a key-set comparison is BLIND TO. A Tamil
//      value that drops `{amount}` still has the key, still passes limbs 1 and 2,
//      and renders a sentence with the number silently missing. gen-l10n resolves
//      arguments from the TEMPLATE arb, so the generated Tamil method still takes
//      the parameter and simply never uses it: no analyzer warning, no crash.
//
// ── SELF-CHECK, BECAUSE THIS FILE IS ITSELF A SCANNER ────────────────────────
// Every limb above is a set comparison that an EMPTY set satisfies. An arb that
// failed to load, a path that stopped resolving, a regex that stopped matching —
// each produces "no differences" and a green tick. So the floors below assert
// that the inputs are the size they are known to be before any comparison is
// believed. A guard that cannot tell "nothing wrong" from "nothing checked" is
// the failure this repository keeps recording.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Arb keys, minus the `@…` metadata blocks and the `@@locale` header.
Set<String> _messageKeys(Map<String, dynamic> arb) =>
    arb.keys.where((String k) => !k.startsWith('@')).toSet();

/// Every `{placeholder}` an ICU message REFERENCES.
///
/// Matches both shapes gen-l10n accepts: a plain `{amount}` and the argument of
/// a plural selector, `{count, plural, …}`. `=1{…}` and `other{…}` are arms, not
/// placeholders — neither is preceded by `{` followed by an identifier, so the
/// pattern steps over them. Nested arms are reached because the scan is over the
/// whole string rather than over a parsed tree: `other{{count} days}` yields
/// `count` from the inner brace.
final RegExp _placeholder = RegExp(r'\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,}]');

Set<String> _placeholdersIn(String value) =>
    _placeholder.allMatches(value).map((RegExpMatch m) => m.group(1)!).toSet();

Map<String, dynamic> _readArb(String relative) {
  final File f = File(relative);
  // Not a niceness: `flutter test` runs with the package root as CWD, and if
  // that ever stops being true every set below is empty and every assertion
  // passes over nothing.
  expect(
    f.existsSync(),
    isTrue,
    reason:
        'COVERAGE LOST — $relative does not exist from ${Directory.current.path}, '
        'so this test compared two empty key sets and would have passed no matter '
        'what the arb files contain.',
  );
  return jsonDecode(f.readAsStringSync()) as Map<String, dynamic>;
}

void main() {
  late Map<String, dynamic> en;
  late Map<String, dynamic> ta;
  late Set<String> enKeys;
  late Set<String> taKeys;

  setUpAll(() {
    en = _readArb('lib/l10n/app_en.arb');
    ta = _readArb('lib/l10n/app_ta.arb');
    enKeys = _messageKeys(en);
    taKeys = _messageKeys(ta);
  });

  group('the arb files are actually being read', () {
    // The floor is deliberately far below the real count (263 at P4 L0) and must
    // not be re-pinned to whatever the tree measures today — a floor tuned to the
    // current number is the stale floor this repo has already removed once. It
    // exists to separate "the sets agree" from "the sets are empty".
    test('the template holds a substantial number of messages', () {
      expect(
        enKeys.length,
        greaterThan(100),
        reason:
            'COVERAGE LOST — app_en.arb parsed to only ${enKeys.length} message key(s). '
            'The parity comparisons below are set operations, and two empty sets are equal.',
      );
    });

    test('@@locale is excluded and @-metadata is not counted as a message', () {
      expect(enKeys, isNot(contains('@@locale')));
      expect(enKeys.every((String k) => !k.startsWith('@')), isTrue);
    });
  });

  // ── THE BLOCKING SCREENS, WHERE AN UNTRANSLATED VALUE IS UNRECOVERABLE ─────
  //
  // 🔴 PARITY CANNOT SEE THIS ONE. A Tamil entry that is the English sentence
  // pasted across has the key, so limbs 1 and 2 both pass and the diagnostic
  // file stays empty — and a Tamil reader gets English anyway. The general rule
  // "ta must differ from en" would be WRONG (`OK`, a brand name and a bare `…`
  // legitimately match), so this is scoped to the screens where being stuck on
  // English has no way out.
  //
  // The force-update wall is the sharpest case in the app: when it fires it
  // REPLACES EVERYTHING and offers exactly one control. Until 2026-09-04 it had
  // no arb keys at all in either tree — `ForceUpdateGate`'s English parameter
  // defaults were the only copy any app ever shipped, and no check could see it
  // because `assert-no-hardcoded-strings.mjs` does not scan `packages/`.
  group('a screen with no way out is really translated', () {
    const List<String> unrecoverable = <String>[
      'updateRequiredTitle',
      'updateRequiredMessage',
      'updateRequiredAction',
    ];

    test('the force-update wall carries Tamil, not English pasted across', () {
      for (final String key in unrecoverable) {
        expect(
          enKeys,
          contains(key),
          reason:
              'COVERAGE LOST — $key is gone from app_en.arb, so the '
              'comparison below has nothing to compare.',
        );
        expect(
          ta[key],
          isNot(en[key]),
          reason:
              '$key is byte-identical in both locales. On a screen that replaces '
              'the whole app and cannot be dismissed, that is a Tamil reader '
              'locked out in a language they may not read.',
        );
        expect(
          (ta[key] as String).trim(),
          isNotEmpty,
          reason:
              '$key is blank in Tamil — the wall would render nothing at all',
        );
      }
    });
  });

  group('en and ta hold exactly the same keys', () {
    test('every English key has a Tamil value', () {
      final List<String> missing = (enKeys.difference(taKeys).toList()..sort());
      expect(
        missing,
        isEmpty,
        reason:
            '${missing.length} key(s) are in app_en.arb and NOT in app_ta.arb, so '
            'gen-l10n will silently serve the ENGLISH text to a Tamil reader:\n'
            '  ${missing.join('\n  ')}\n'
            'Add a Tamil value for each. `apps/subly/l10n-untranslated.json` carries '
            'the same list in the form a translator can be handed.',
      );
    });

    test('every Tamil key has an English original', () {
      final List<String> orphaned = (taKeys.difference(enKeys).toList()
        ..sort());
      expect(
        orphaned,
        isEmpty,
        reason:
            '${orphaned.length} key(s) are in app_ta.arb with no counterpart in '
            'app_en.arb. gen-l10n resolves everything from the template, so these '
            'are translated strings the app can never show — usually a rename that '
            'landed on one side only:\n  ${orphaned.join('\n  ')}',
      );
    });
  });

  group('a translated value keeps the placeholders its original references', () {
    test('there is something here to check', () {
      // Limb 3 iterates over keys WITH placeholders. If that set is ever empty —
      // a changed arb shape, a regex that stopped matching — the loop below runs
      // zero times and reports success.
      final int withPlaceholders = enKeys
          .where((String k) => _placeholdersIn(en[k] as String).isNotEmpty)
          .length;
      expect(
        withPlaceholders,
        greaterThan(10),
        reason:
            'COVERAGE LOST — only $withPlaceholders English message(s) were found to '
            'reference a placeholder. The comparison below would range over almost '
            'nothing, so a Tamil value that dropped a placeholder would pass.',
      );
    });

    test('no Tamil value drops a placeholder its English original uses', () {
      final List<String> broken = <String>[];
      for (final String key in enKeys.toList()..sort()) {
        if (!taKeys.contains(key)) continue; // reported by limb 1 already.
        final Set<String> want = _placeholdersIn(en[key] as String);
        final Set<String> got = _placeholdersIn(ta[key] as String);
        final Set<String> lost = want.difference(got);
        if (lost.isNotEmpty) {
          broken.add('$key is missing ${(lost.toList()..sort()).join(', ')}');
        }
      }
      expect(
        broken,
        isEmpty,
        reason:
            'A Tamil value no longer substitutes a value its English original does. '
            'The generated Tamil method still TAKES the argument and silently drops '
            'it, so nothing warns and the sentence renders with the number, name or '
            'date missing:\n  ${broken.join('\n  ')}',
      );
    });

    // The opposite direction is a separate failure with a separate cause: a
    // Tamil value referencing an argument the template never declares does not
    // render an empty gap, it renders the literal braces.
    test('no Tamil value invents a placeholder its English original lacks', () {
      final List<String> invented = <String>[];
      for (final String key in enKeys.toList()..sort()) {
        if (!taKeys.contains(key)) continue;
        final Set<String> extra = _placeholdersIn(
          ta[key] as String,
        ).difference(_placeholdersIn(en[key] as String));
        if (extra.isNotEmpty) {
          invented.add('$key adds ${(extra.toList()..sort()).join(', ')}');
        }
      }
      expect(
        invented,
        isEmpty,
        reason:
            'A Tamil value references an argument the template does not declare. '
            'gen-l10n resolves arguments from app_en.arb, so nothing substitutes it '
            'and the braces reach the screen verbatim:\n  ${invented.join('\n  ')}',
      );
    });
  });
}
