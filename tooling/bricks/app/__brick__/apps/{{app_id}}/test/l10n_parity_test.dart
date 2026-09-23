// ─────────────────────────────────────────────────────────────────────────────
// l10n_parity_test.dart — every locale this app DECLARES carries every message
// the template does, no orphans, and the same placeholders.
//
// 🔴 WHY THIS LIVES IN THE TEMPLATE [pipeline C-16]. `flutter gen-l10n` FALLS
// BACK TO THE TEMPLATE for a key a locale is missing. It does not fail and it
// does not throw; a key added to the English arb and forgotten in another one
// ships as an English sentence in the middle of that locale's screen, and the
// only person who can see it is a reader of that language. Until 2026-09-14
// this assertion existed only in apps/subscriptiontracker, so every stamped app
// was born with zero enforcement (register row O-BRICK-NO-L10N-PARITY-TEST).
//
// ── THE LOCALE LIST IS READ, NEVER TYPED ─────────────────────────────────────
// The app's own copy of this test compared two hard-coded files. Here the set
// of locales is `AppLocalizations.supportedLocales` — the list the MaterialApp
// in lib/app.dart actually resolves against — and each one must have an arb in
// the `arb-dir` that l10n.yaml names, whose `@@locale` says so. Add a locale
// and it is checked without editing this file; drop its arb and it fails.
//
// ── SELF-CHECKS, BECAUSE EVERY LIMB IS A SET COMPARISON ──────────────────────
// Two empty sets are equal. So the template's message count is re-counted from
// the raw text by a second, independent reading, and the placeholder pattern is
// proven against literal ICU strings before any arb is judged by it.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:{{app_id.snakeCase()}}/l10n/app_localizations.dart';

/// Arb keys, minus the `@…` metadata blocks and the `@@locale` header.
Set<String> _messageKeys(Map<String, dynamic> arb) =>
    arb.keys.where((String k) => !k.startsWith('@')).toSet();

/// Every `{placeholder}` an ICU message REFERENCES, found by walking the braces
/// rather than pattern-matching them.
///
/// A pattern cannot tell an argument from the body of a select arm: in a
/// `select` whose arm is `day{day}`, the arm body looks exactly like a
/// placeholder named `day`, and the parity check then reports a placeholder the
/// template never declared. The walk knows which braces open an ARGUMENT (in
/// message text) and which open an ARM (after a `plural`, `select` or
/// `selectordinal` type), and reads each arm as message text again, so an
/// argument nested inside an arm is still found.
Set<String> _placeholdersIn(String value) => _IcuWalk(value).run();

class _IcuWalk {
  _IcuWalk(this.s);

  final String s;
  final Set<String> found = <String>{};
  int i = 0;

  static final RegExp _name = RegExp(r'^[A-Za-z_][A-Za-z0-9_]*$');
  static const Set<String> _selectors = <String>{
    'plural',
    'select',
    'selectordinal',
  };

  Set<String> run() {
    _message();
    return found;
  }

  /// Message text, up to an unmatched `}` or the end.
  void _message() {
    while (i < s.length) {
      final String c = s[i];
      if (c == '}') return;
      i++;
      if (c == '{') _argument();
    }
  }

  /// After an argument's `{`: its name, then either `}` or `, type …}`.
  void _argument() {
    _space();
    final String name = _token();
    if (_name.hasMatch(name)) found.add(name);
    _space();
    if (i < s.length && s[i] == ',') {
      i++;
      _space();
      final String type = _token();
      _space();
      if (_selectors.contains(type)) {
        if (i < s.length && s[i] == ',') i++;
        _arms();
      } else {
        _skipToClose();
      }
    }
    if (i < s.length && s[i] == '}') i++;
  }

  /// `selector{message} selector{message} …` up to the argument's own `}`.
  void _arms() {
    while (i < s.length) {
      _space();
      if (i >= s.length || s[i] == '}') return;
      final String selector = _token();
      _space();
      if (i < s.length && s[i] == '{') {
        i++;
        _message();
        if (i < s.length && s[i] == '}') i++;
      } else if (selector.isEmpty) {
        i++;
      }
    }
  }

  /// A formatted argument (`number`, `date`, …) carries no placeholder of its
  /// own after the type: skip to the brace that closes it.
  void _skipToClose() {
    int depth = 0;
    while (i < s.length) {
      final String c = s[i];
      if (c == '}' && depth == 0) return;
      if (c == '{') depth++;
      if (c == '}') depth--;
      i++;
    }
  }

  void _space() {
    while (i < s.length && s[i].trim().isEmpty) {
      i++;
    }
  }

  /// A run of characters up to whitespace or `,` `{` `}`.
  String _token() {
    final int start = i;
    while (i < s.length && !', {}\t\n\r'.contains(s[i])) {
      i++;
    }
    return s.substring(start, i);
  }
}

/// One `key: value` line of l10n.yaml, read without a YAML dependency.
String _l10nSetting(String yaml, String key) {
  final RegExpMatch? m = RegExp(
    '^$key:\\s*(\\S+)\\s*\$',
    multiLine: true,
  ).firstMatch(yaml);
  expect(
    m,
    isNotNull,
    reason:
        'COVERAGE LOST — l10n.yaml declares no `$key:`, so the arb set this '
        'test compares could not be located.',
  );
  return m!.group(1)!;
}

void main() {
  late String arbDir;
  late String templateFile;
  late Map<String, Map<String, dynamic>> arbByLocale;
  late Map<String, dynamic> template;
  late Set<String> templateKeys;
  late String templateLocale;

  setUpAll(() {
    final File yaml = File('l10n.yaml');
    expect(
      yaml.existsSync(),
      isTrue,
      reason:
          'COVERAGE LOST — l10n.yaml does not exist from '
          '${Directory.current.path}; flutter test runs from the package root.',
    );
    final String yamlText = yaml.readAsStringSync();
    arbDir = _l10nSetting(yamlText, 'arb-dir');
    templateFile = _l10nSetting(yamlText, 'template-arb-file');

    arbByLocale = <String, Map<String, dynamic>>{};
    for (final FileSystemEntity e in Directory(arbDir).listSync()) {
      if (e is! File || !e.path.endsWith('.arb')) continue;
      final Map<String, dynamic> arb =
          jsonDecode(e.readAsStringSync()) as Map<String, dynamic>;
      final Object? locale = arb['@@locale'];
      expect(
        locale,
        isA<String>(),
        reason:
            '${e.path} carries no @@locale, so it cannot be matched to a '
            'declared locale.',
      );
      arbByLocale[locale! as String] = arb;
    }
    final File templateArb = File('$arbDir/$templateFile');
    template =
        jsonDecode(templateArb.readAsStringSync()) as Map<String, dynamic>;
    templateLocale = template['@@locale']! as String;
    templateKeys = _messageKeys(template);
  });

  group('the inputs are really being read', () {
    test('the template message count agrees with a second reading of the raw '
        'file', () {
      // A top-level message key is a two-space-indented quoted name that does
      // not start with `@`. Counted from text, not from the decoded map, so a
      // decode that silently produced a smaller map cannot agree with it.
      final String raw = File('$arbDir/$templateFile').readAsStringSync();
      final int counted = RegExp(
        r'^  "([A-Za-z_][A-Za-z0-9_]*)"\s*:',
        multiLine: true,
      ).allMatches(raw).length;
      expect(templateKeys, isNotEmpty);
      expect(
        templateKeys.length,
        counted,
        reason:
            'COVERAGE LOST — the decoded template holds ${templateKeys.length} '
            'message(s) and the raw text holds $counted.',
      );
    });

    test('the placeholder pattern finds the shapes gen-l10n accepts', () {
      expect(_placeholdersIn('{name} renews on {date}.'), <String>{
        'name',
        'date',
      });
      expect(
        _placeholdersIn(
          // Spaced so the brick's mustache pass never reads a double brace.
          '{count, plural, =1{ {name} in 1 day} other{ {count} days} }',
        ),
        <String>{'count', 'name'},
      );
      expect(_placeholdersIn('no arguments here'), isEmpty);
    });

    test('every declared locale has an arb, and every arb is declared', () {
      final Set<String> declared = AppLocalizations.supportedLocales
          .map((Locale l) => l.toLanguageTag())
          .toSet();
      expect(
        declared.length,
        greaterThan(1),
        reason:
            'COVERAGE LOST — the app declares ${declared.length} locale(s); '
            'parity between one locale and itself proves nothing.',
      );
      expect(arbByLocale.keys.toSet(), declared);
      expect(declared, contains(templateLocale));
    });
  });

  group('every declared locale holds exactly the template keys', () {
    test('no locale is missing a message the template has', () {
      final List<String> missing = <String>[];
      for (final MapEntry<String, Map<String, dynamic>> e
          in arbByLocale.entries) {
        if (e.key == templateLocale) continue;
        for (final String k in templateKeys.difference(_messageKeys(e.value))) {
          missing.add('${e.key}: $k');
        }
      }
      expect(
        missing..sort(),
        isEmpty,
        reason:
            'gen-l10n will silently serve the TEMPLATE text for these, in the '
            'middle of a translated screen:\n  ${missing.join('\n  ')}',
      );
    });

    test('no locale carries a message the template does not', () {
      final List<String> orphaned = <String>[];
      for (final MapEntry<String, Map<String, dynamic>> e
          in arbByLocale.entries) {
        for (final String k in _messageKeys(e.value).difference(templateKeys)) {
          orphaned.add('${e.key}: $k');
        }
      }
      expect(
        orphaned..sort(),
        isEmpty,
        reason:
            'gen-l10n resolves every message from the template, so these can '
            'never be shown — usually a rename that landed on one side:\n  '
            '${orphaned.join('\n  ')}',
      );
    });
  });

  group('a translated value keeps exactly its original placeholders', () {
    test('no locale drops or invents a placeholder', () {
      final List<String> broken = <String>[];
      for (final MapEntry<String, Map<String, dynamic>> e
          in arbByLocale.entries) {
        if (e.key == templateLocale) continue;
        for (final String k in templateKeys.toList()..sort()) {
          final Object? value = e.value[k];
          if (value is! String) continue; // reported by the key limb.
          final Set<String> want = _placeholdersIn(template[k] as String);
          final Set<String> got = _placeholdersIn(value);
          if (want.difference(got).isNotEmpty ||
              got.difference(want).isNotEmpty) {
            broken.add('${e.key}: $k has $got, the template has $want');
          }
        }
      }
      expect(
        broken,
        isEmpty,
        reason:
            'A dropped placeholder renders the sentence with the value missing; '
            'an invented one renders the braces verbatim:\n  '
            '${broken.join('\n  ')}',
      );
    });
  });
}
