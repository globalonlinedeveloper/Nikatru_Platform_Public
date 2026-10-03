// ─────────────────────────────────────────────────────────────────────────────
// WIDTH — THE IMPORT HUB (`/import`), ContentPane.reading (720).
//
// Replaces `width_scan_test.dart` with the screen that replaced `/scan` (ADR 077
// §2.2, IM-01). Same pane, same three window classes, and the two phases that
// are different subtrees are both measured: the hub (a paste field and its
// button) and the review list a CSV opens onto.
//
// ⚠️ 768 IS ALREADY PAST THE CAP: `AppBreakpoints.reading - 36`, not `768 -
// 36`, because 720 < 768 — so stripping the pane out of `import_screen.dart`
// reddens the tablet case on its own, and the desktop case with it.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/widgets.dart' show Size;
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/features/import/import_screen.dart';
import 'package:subscriptiontracker/state/settings_controller.dart'
    show currencyCodeProvider;

import 'support/width_harness.dart';

/// The list's gutter: `AppSpacing.gutterCompact` on both sides.
const double _gutters = AppSpacing.gutterCompact * 2;

final List<Override> _inr = <Override>[
  currencyCodeProvider.overrideWithValue('INR'),
];

void main() {
  group('the import hub is capped at reading width', () {
    testWidgets('at 375 the cap is a no-op and nothing overflows', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const ImportScreen(), overrides: _inr);
      expect(
        offeredWidth(tester, find.byKey(E2EKeys.importPaste)),
        375 - _gutters,
        reason: 'below the cap the paste field takes the phone less gutters',
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('at 768 the reading cap has ALREADY engaged', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kTablet, const ImportScreen(), overrides: _inr);
      expect(
        offeredWidth(tester, find.byKey(E2EKeys.importPaste)),
        AppBreakpoints.reading - _gutters,
        reason: '720 < 768: the pane is what decides this width',
      );
    });

    testWidgets('at 1280 the hub is capped at reading', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kDesktop, const ImportScreen(), overrides: _inr);
      expect(
        offeredWidth(tester, find.byKey(E2EKeys.importPaste)),
        lessThanOrEqualTo(AppBreakpoints.reading),
      );
      expect(AppBreakpoints.reading, 720);
    });

    // ⏱ 2026-10-02 · train P39 (SYN-X1 C-17): expanded and extra-large.
    for (final (Size window, String _) in <(Size, String)>[
      (kExpanded, 'expanded'),
      (kWide, 'extra-large'),
    ]) {
      testWidgets('at ${window.width.toInt()} the reading cap still binds', (
        WidgetTester tester,
      ) async {
        await pumpAt(tester, window, const ImportScreen(), overrides: _inr);
        expect(
          offeredWidth(tester, find.byKey(E2EKeys.importPaste)),
          AppBreakpoints.reading - _gutters,
        );
        expect(tester.takeException(), isNull);
      });
    }

    // The other subtree: a CSV's review list, reached only after a paste and
    // the mapping step.
    testWidgets('at 1280 the REVIEW list is capped too', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kDesktop, const ImportScreen(), overrides: _inr);
      await tester.enterText(
        find.byKey(E2EKeys.importPaste),
        'name,price,currency\nNetflix,649,INR\n',
      );
      await tester.pump();
      await tester.tap(find.byKey(E2EKeys.importRead));
      for (int i = 0; i < 8; i++) {
        await tester.pump();
      }
      await tester.tap(find.byKey(E2EKeys.importContinue));
      for (int i = 0; i < 8; i++) {
        await tester.pump();
      }
      expect(
        find.byKey(E2EKeys.importAdd),
        findsOneWidget,
        reason: 'the phase sentinel: the review list is built',
      );
      expect(
        offeredWidth(tester, find.byKey(E2EKeys.importAdd)),
        lessThanOrEqualTo(AppBreakpoints.reading),
      );
      expect(tester.takeException(), isNull);
    });
  });
}
