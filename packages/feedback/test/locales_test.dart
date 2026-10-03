import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_feedback/nikatru_feedback.dart';

/// The repository root, from this package's directory (flutter test runs a
/// package's tests with the package as the working directory).
Directory _root() {
  Directory d = Directory.current;
  while (!File('${d.path}/tooling/i18n/locales.json').existsSync()) {
    d = d.parent;
  }
  return d;
}

/// The supported codes the register declares, and the ARBs this package lacks
/// for them. A fixture register with one extra supported locale makes this
/// non-empty until its ARB exists.
List<String> missingArbs(Map<String, Object?> register, Directory arbDir) {
  final List<String> missing = <String>[];
  for (final Object? row in register['locales']! as List<Object?>) {
    final Map<String, Object?> r = row! as Map<String, Object?>;
    if (r['status'] != 'supported') continue;
    final String code = r['code']! as String;
    if (!File(
      '${arbDir.path}/feedback_${code.replaceAll('-', '_')}.arb',
    ).existsSync())
      missing.add(code);
  }
  return missing;
}

void main() {
  final Directory root = _root();
  final Map<String, Object?> register =
      jsonDecode(
            File('${root.path}/tooling/i18n/locales.json').readAsStringSync(),
          )
          as Map<String, Object?>;
  final Directory arbs = Directory('${root.path}/packages/feedback/lib/l10n');
  final List<String> supported = <String>[
    for (final Object? row in register['locales']! as List<Object?>)
      if ((row! as Map<String, Object?>)['status'] == 'supported')
        (row as Map<String, Object?>)['code']! as String,
  ];

  test(
    '🔴 [Do 1] the package\'s locales ARE the register\'s supported set, read from it',
    () {
      expect(kFeedbackLocaleCodes, supported);
      expect(missingArbs(register, arbs), isEmpty);
    },
  );

  test(
    '🔴 a register with one extra supported locale fails until its ARB exists',
    () {
      final Map<String, Object?> fixture =
          jsonDecode(jsonEncode(register)) as Map<String, Object?>;
      (fixture['locales']! as List<Object?>).add(<String, Object?>{
        'code': 'bn',
        'status': 'supported',
      });
      expect(missingArbs(fixture, arbs), <String>['bn']);
    },
  );

  test('every supported locale answers in its own language, never a blank', () {
    for (final String code in supported) {
      final FeedbackStrings s = FeedbackStrings.of(Locale(code));
      expect(s.reportProblem, isNotEmpty);
      expect(s.sentBody('FB-1'), contains('FB-1'));
    }
    expect(
      FeedbackStrings.of(const Locale('ta')).reportProblem,
      isNot(FeedbackStrings.of(const Locale('en')).reportProblem),
    );
  });
}
