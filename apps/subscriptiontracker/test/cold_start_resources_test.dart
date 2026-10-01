// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-10-01 · EN-09 / EN-10 — COLD START SAYS ITS LANGUAGE AND DOES NOT
// FLASH THE WRONG COLOUR.
//
// Three surfaces paint before any Dart runs, and each one was wrong:
//   · the web page had a bare `<html>`, so a screen reader guessed its voice
//     (WCAG 3.1.1) — `resolveAndLabelPage` corrects it at runtime, and
//     this pins the static default the first paint needs;
//   · the iOS launch screen was hard-coded WHITE, so a dark-mode launch flashed
//     white before the dark first frame;
//   · Android 12+ ignores `launch_background` and paints its own system
//     splash, with no colour or icon chosen by the app.
//
// Files, read as files: these are build inputs no widget test can render.
// MUTATION PROOF: drop `lang="en"`, restore the storyboard's white
// `backgroundColor`, or delete either `values*-v31/styles.xml`, and the
// matching case goes red.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

String _read(String path) {
  final File f = File(path);
  expect(f.existsSync(), isTrue, reason: '$path must exist');
  return f.readAsStringSync();
}

void main() {
  test('web/index.html carries a static lang for the first paint', () {
    final String html = _read('web/index.html');
    expect(RegExp(r'<html\s+lang="en"\s*>').hasMatch(html), isTrue);
  });

  test(
    'the iOS launch screen paints a named colour with a dark appearance',
    () {
      final String sb = _read('ios/Runner/Base.lproj/LaunchScreen.storyboard');
      expect(
        sb,
        contains('<color key="backgroundColor" name="LaunchBackground"/>'),
      );
      expect(sb, isNot(contains('red="1" green="1" blue="1"')));
      final Map<String, Object?> set =
          jsonDecode(
                _read(
                  'ios/Runner/Assets.xcassets/LaunchBackground.colorset/'
                  'Contents.json',
                ),
              )
              as Map<String, Object?>;
      final List<Object?> colors = set['colors']! as List<Object?>;
      bool isDark(Object? c) =>
          ((c! as Map<String, Object?>)['appearances'] as List<Object?>? ??
                  const <Object?>[])
              .any(
                (Object? a) => (a! as Map<String, Object?>)['value'] == 'dark',
              );
      expect(colors.where(isDark), hasLength(1), reason: 'a dark appearance');
      expect(
        colors.where((Object? c) => !isDark(c)),
        hasLength(1),
        reason: 'and the light one',
      );
    },
  );

  for (final (String dir, String colour) in <(String, String)>[
    ('values-v31', '#F4F4F8'),
    ('values-night-v31', '#12111C'),
  ]) {
    test('Android 12+ $dir sets the system splash colour and icon', () {
      final String xml = _read('android/app/src/main/res/$dir/styles.xml');
      expect(xml, contains('<style name="LaunchTheme"'));
      expect(
        xml,
        contains(
          '<item name="android:windowSplashScreenBackground">$colour</item>',
        ),
      );
      expect(xml, contains('android:windowSplashScreenAnimatedIcon'));
      expect(
        xml.replaceAll('<!--', '').replaceAll('-->', ''),
        isNot(contains('--')),
        reason:
            'XML forbids a double hyphen inside a comment, and aapt '
            'refuses the whole build over one',
      );
    });
  }
}
