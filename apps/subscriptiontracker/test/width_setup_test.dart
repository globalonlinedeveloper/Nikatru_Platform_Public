// ─────────────────────────────────────────────────────────────────────────────
// WIDTH — AFTER-SIGN-IN SETUP (ST-T9, EN-18)
//
// The chassis `SetupStepsView` caps its column at `AppBreakpoints.medium`
// (600) and centres it; packages/chassis_screens/test/setup_steps_view_test
// pins that on the bare view. This file pins it on SUBLY'S setup — the
// adapter's own controls (the currency field, the catalogue tiles) inside the
// cap — at every window class, so a control that forced its own width would
// go red here rather than on a phone in a store review.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/firstrun/setup_steps_view.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/features/setup/setup_screen.dart';

import 'support/catalogue_fixture.dart';
import 'support/width_harness.dart';

void main() {
  for (final (Size window, double width) in <(Size, double)>[
    (kPhone, 375),
    (kTablet, AppBreakpoints.medium),
    // ⏱ 2026-10-02 · train P39 (SYN-X1 C-17): expanded and extra-large.
    (kExpanded, AppBreakpoints.medium),
    (kDesktop, AppBreakpoints.medium),
    (kWide, AppBreakpoints.medium),
  ]) {
    testWidgets(
      '${window.width.toInt()} — setup reads in a $width column, centred',
      (WidgetTester tester) async {
        await pumpAt(
          tester,
          window,
          SetupScreen(now: () => DateTime(2026, 10, 1)),
          overrides: <Override>[...catalogueOverrides()],
        );
        await tester.pumpAndSettle();
        Finder column() => find
            .ancestor(
              of: find.byKey(SetupStepsView.position),
              matching: find.byType(ConstrainedBox),
            )
            .last;
        expect(tester.getSize(column()).width, width);
        expect(tester.getTopLeft(column()).dx, (window.width - width) / 2);
        // The currency field fits the column, never the window.
        expect(
          tester.getSize(find.byKey(SetupKeys.currency)).width,
          lessThanOrEqualTo(width),
        );
        // …and so do the tiles, on the last step.
        for (int i = 0; i < 2; i++) {
          await tester.tap(find.byKey(SetupStepsView.advanceButton));
          await tester.pumpAndSettle();
        }
        final Finder tile = find.byKey(SetupKeys.tile('netflix'));
        expect(tile, findsOneWidget);
        expect(
          tester.getTopRight(tile).dx,
          lessThanOrEqualTo((window.width + width) / 2),
        );
        expect(tester.takeException(), isNull);
      },
    );
  }
}
