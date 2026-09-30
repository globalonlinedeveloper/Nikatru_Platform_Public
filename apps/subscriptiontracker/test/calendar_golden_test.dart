// THE CALENDAR, PIXEL FOR PIXEL — train ST-D2.
//
// The populated calendar at one window per class — compact, medium, expanded,
// large — in light and in dark, on the app's own theme and a pinned day. Eight
// goldens under `test/goldens/`. Compact and medium are the one-column screen
// (grid, then the month's rows); expanded and large are the two-pane screen
// (grid beside the rows).
//
// Regenerate, after a DELIBERATE visual change only, from this app's
// directory:
//   flutter test --update-goldens test/calendar_golden_test.dart
// and review every PNG in the diff before committing it: a golden that is
// regenerated to make a red test green asserts nothing.
//
// ⚠️ LINUX ONLY, for the reason `packages/design_system/test/
// foundation_golden_test.dart` gives: glyph anti-aliasing differs by a few
// pixels on macOS and Windows, and CI — the only gate — is Linux.

import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/calendar_fixture.dart';

void main() {
  test('each photographed size is the class it is named for', () {
    for (final MapEntry<String, Size> w in kCalendarWindows.entries) {
      expect(windowClassFor(w.value.width).name, w.key);
    }
  });

  for (final MapEntry<String, Size> w in kCalendarWindows.entries) {
    for (final Brightness b in Brightness.values) {
      testWidgets('calendar · ${w.key} · ${b.name}', (
        WidgetTester tester,
      ) async {
        await pumpCalendar(
          tester,
          size: w.value,
          repository: CalendarRepository.populated(),
          brightness: b,
          devicePixelRatio: 0.5,
        );
        expect(tester.takeException(), isNull);
        await expectLater(
          find.byType(MaterialApp),
          matchesGoldenFile('goldens/calendar_${w.key}_${b.name}.png'),
        );
      }, skip: !Platform.isLinux);
    }
  }
}
