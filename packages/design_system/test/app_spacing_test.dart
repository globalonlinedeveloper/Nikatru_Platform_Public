import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

void main() {
  group('AppSpacing.pagePadding — the per-class table', () {
    // The table is the contract, asserted as a table. Written this way so that
    // changing one class's inset is a one-line diff in a test that names every
    // other class too — the shape that stops "I widened compact" quietly
    // widening everything.
    const Map<WindowClass, EdgeInsets> expected = <WindowClass, EdgeInsets>{
      WindowClass.compact: EdgeInsets.all(18),
      WindowClass.medium: EdgeInsets.fromLTRB(18, 18, 18, 0),
      WindowClass.expanded: EdgeInsets.fromLTRB(24, 18, 24, 0),
      WindowClass.large: EdgeInsets.fromLTRB(32, 24, 32, 0),
      WindowClass.extraLarge: EdgeInsets.fromLTRB(32, 24, 32, 0),
    };

    test('every window class maps to its documented inset', () {
      for (final MapEntry<WindowClass, EdgeInsets> row in expected.entries) {
        expect(AppSpacing.pagePadding(row.key), row.value,
            reason:
                'pagePadding(${row.key}) drifted from the documented table');
      }
    });

    test('the table covers all five classes', () {
      // A class the function forgot would fall through to whatever the switch
      // returned last, which is a layout bug that looks like a working
      // function. `WindowClass.values` is the source of truth, never a literal
      // count, so adding a sixth class fails HERE rather than shipping.
      expect(expected.keys.toSet(), WindowClass.values.toSet());
    });

    test('the bottom inset is zero exactly when the navigation is not a bar',
        () {
      // The substantive asymmetry, asserted on its own so it cannot be lost in
      // a wholesale table edit: only `compact` puts navigation UNDER the body,
      // and only `compact` therefore needs to sit off it.
      expect(AppSpacing.pagePadding(WindowClass.compact).bottom, 18);
      for (final WindowClass c in WindowClass.values) {
        if (c == WindowClass.compact) continue;
        expect(AppSpacing.pagePadding(c).bottom, 0,
            reason: 'a fixed bottom inset at $c is subtracted from the '
                'scrollable extent and reads as "the list ended"');
      }
    });

    test('gutters widen with the window and never narrow', () {
      final List<double> lefts = WindowClass.values
          .map((WindowClass c) => AppSpacing.pagePadding(c).left)
          .toList();
      for (int i = 1; i < lefts.length; i++) {
        expect(lefts[i], greaterThanOrEqualTo(lefts[i - 1]),
            reason: 'gutters must be monotonic across the classes — a wider '
                'window with a narrower margin is a typo, not a design');
      }
      expect(lefts.toSet().length, greaterThan(1),
          reason: 'if every class returned the same inset the function would '
              'be a constant wearing a parameter');
    });

    test('the named gutters are the ones the table uses', () {
      expect(AppSpacing.gutterCompact, 18);
      expect(AppSpacing.gutterExpanded, 24);
      expect(AppSpacing.gutterLarge, 32);
    });
  });
}
