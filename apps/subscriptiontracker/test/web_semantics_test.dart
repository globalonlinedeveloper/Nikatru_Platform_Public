// The web build shipped with NO accessibility tree. The defect needed two
// things to be true at once, and this file proves the half that belongs to
// THIS app:
//
//   1. `enableWebSemantics` turns semantics collection ON for the web arm and
//      leaves the other six targets alone — proven beside the function, in
//      `packages/chassis_screens/test/web_semantics_test.dart`.
//   2. `main()` actually calls it — proven HERE, from source.
//
// ⏱ 2026-09-28 · ST-Y5 (audit D26): the function and its unit tests moved into
// `package:nikatru_chassis_screens/shell/web_semantics.dart`, where
// `bootstrapNikatru` calls it for every stamped app. This app does not boot
// through `bootstrapNikatru` yet (ST-K1 — its `appRunner` inits two
// notification services in an order that bootstrap's one `notifications` slot
// cannot express), so its `main()` keeps its own direct call, and these limbs
// keep reading this app's entry point and harnesses.
// `tooling/ci/assert-a11y-primitives.mjs` limb 3 holds the same property for
// every app's `lib/main.dart` in CI.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  // The half a unit test cannot reach. `kIsWeb` is a compile-time `false` under
  // `flutter test`, so the production call site is a line no Dart test can
  // execute; what IS decidable is that the line exists. Read from source with
  // comments stripped, because the defect being closed was PRECISELY a
  // comment that named the API without calling it — a grep over raw bytes
  // would have reported this app as fixed for the last three weeks.
  group('main() calls it', () {
    test('lib/main.dart contains a live call, not a mention', () {
      final File f = File('lib/main.dart');
      expect(
        f.existsSync(),
        isTrue,
        reason:
            'the entry point moved; this test would otherwise pass vacuously '
            'over a file that is not there',
      );
      final String raw = f.readAsStringSync();
      final String src = _stripDartComments(raw);

      expect(
        raw.contains('enableWebSemantics'),
        isTrue,
        reason: 'sanity: the name should appear somewhere in the entry point',
      );
      expect(
        RegExp(r'\benableWebSemantics\s*\(').hasMatch(src),
        isTrue,
        reason:
            'lib/main.dart mentions enableWebSemantics only inside a comment. '
            'That is the exact shape of the defect this file closes: '
            'lib/app.dart named `ensureSemantics` in prose while the shipped '
            'web build compiled no semantics tree at all.',
      );

      // It must run before the first frame. `runApp` is inside the telemetry
      // bootstrap's `appRunner` further down the file; a call placed after it
      // is a call made after frames have already been built with no tree.
      final int callAt = src.indexOf(RegExp(r'\benableWebSemantics\s*\('));
      final int runAppAt = src.indexOf(RegExp(r'\brunApp\s*\('));
      expect(
        runAppAt,
        greaterThan(-1),
        reason: 'main() must still call runApp',
      );
      expect(
        callAt,
        lessThan(runAppAt),
        reason:
            'semantics collection has to be on BEFORE the first frame — a '
            'frame built without a handle outstanding carries no tree, and on '
            'web that is what a screen reader arriving at the page reads',
      );
    });

    // 🔴 THE CLASS, NOT THE INSTANCE. The nightly failure was app_test.dart;
    // store_screenshots_test.dart boots the same `main()` and would have failed
    // the same way on its next capture. Every integration harness that imports
    // the entry point must hand the handle back, and a new one that forgets is
    // red here in `flutter test` rather than red in a live lane nobody watches.
    // MUTATION: delete `releaseWebSemantics();` from either harness and this
    // goes red naming that file. Run on 2026-09-11.
    test('every integration harness that boots main() releases the handle', () {
      final Directory dir = Directory('integration_test');
      expect(
        dir.existsSync(),
        isTrue,
        reason: 'the harness directory moved; this would pass over nothing',
      );
      final RegExp importsMain = RegExp(
        r'''import\s+['"]package:subscriptiontracker/main\.dart['"]''',
      );
      final RegExp releases = RegExp(r'\breleaseWebSemantics\s*\(');
      final List<File> booting = <File>[
        for (final FileSystemEntity e in dir.listSync(recursive: true))
          if (e is File &&
              e.path.endsWith('.dart') &&
              importsMain.hasMatch(_stripDartComments(e.readAsStringSync())))
            e,
      ];
      expect(
        booting,
        isNotEmpty,
        reason:
            'no integration harness imports lib/main.dart — the release check '
            'below would range over nothing and pass',
      );
      for (final File f in booting) {
        expect(
          releases.hasMatch(_stripDartComments(f.readAsStringSync())),
          isTrue,
          reason:
              '${f.path} boots the app through lib/main.dart, which holds a '
              'SemanticsHandle on web, and never calls releaseWebSemantics(). '
              "flutter_test's _verifySemanticsHandlesWereDisposed fails that "
              'test after its body passes — nightly e2e run 34453685391.',
        );
      }
    });
  });
}

/// Strips `//` and `/* */` while leaving string literals intact, so a comment
/// naming an identifier cannot be mistaken for a use of it. Deliberately a
/// local copy: `test/chassis_properties_test.dart` has the same helper and is
/// being edited on another branch right now, and a shared helper would couple
/// two files that have no other reason to move together.
String _stripDartComments(String src) {
  final StringBuffer out = StringBuffer();
  int i = 0;
  String? quote;
  while (i < src.length) {
    final String ch = src[i];
    final String next = i + 1 < src.length ? src[i + 1] : '';
    if (quote != null) {
      out.write(ch);
      if (ch == r'\') {
        if (next.isNotEmpty) out.write(next);
        i += 2;
        continue;
      }
      if (ch == quote) quote = null;
      i++;
      continue;
    }
    if (ch == "'" || ch == '"') {
      quote = ch;
      out.write(ch);
      i++;
      continue;
    }
    if (ch == '/' && next == '/') {
      while (i < src.length && src[i] != '\n') {
        i++;
      }
      continue;
    }
    if (ch == '/' && next == '*') {
      i += 2;
      while (i + 1 < src.length && !(src[i] == '*' && src[i + 1] == '/')) {
        i++;
      }
      i += 2;
      continue;
    }
    out.write(ch);
    i++;
  }
  return out.toString();
}
