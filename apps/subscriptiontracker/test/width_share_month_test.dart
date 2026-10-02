// THE SHARE-A-MONTH SHEET'S WIDTH DECISION — train T20, label IN-12.
//
// `showShareMonthSheet` goes through the design system's `showAdaptiveSheet`:
// a bottom sheet the width of a phone, and from a tablet up a dialog capped at
// `AppBreakpoints.medium`. Its first draft was a plain bottom sheet, which this
// file measured at 768 and 1280 — the whole window. A sheet that stretches
// raises no exception and clips no pixel, so only a measurement sees it.
//
// ⚠️ THE VIEW IS SIZED AS WELL AS THE SURFACE — `width_budget_editor_test.dart`
// records why.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/features/insights/share_month.dart';

import 'support/width_harness.dart';

Future<void> _openAt(WidgetTester tester, Size size) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final GlobalKey tiles = GlobalKey();
  await pumpAt(
    tester,
    size,
    Scaffold(
      body: Builder(
        builder: (BuildContext context) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              RepaintBoundary(key: tiles, child: const SizedBox(height: 8)),
              TextButton(
                onPressed: () => showShareMonthSheet(
                  context,
                  subs: const <Subscription>[],
                  month: DateTime(2026, 9),
                  tiles: tiles,
                  export: (core.ExportFile _) async =>
                      core.ExportOutcome.exported,
                ),
                child: const Text('open'),
              ),
            ],
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  expect(find.byKey(ShareMonthKeys.csv), findsOneWidget);
  expect(tester.takeException(), isNull);
}

double _rowWidth(WidgetTester tester) =>
    tester.getSize(find.byKey(ShareMonthKeys.csv)).width;

void main() {
  testWidgets('a phone gets a sheet the width of the phone', (
    WidgetTester tester,
  ) async {
    await _openAt(tester, kPhone);
    expect(find.byType(BottomSheet), findsOneWidget);
    expect(_rowWidth(tester), kPhone.width);
  });

  testWidgets('a tablet gets a dialog capped at 600', (
    WidgetTester tester,
  ) async {
    await _openAt(tester, kTablet);
    expect(find.byType(Dialog), findsOneWidget);
    expect(_rowWidth(tester), lessThanOrEqualTo(AppBreakpoints.medium));
  });

  // ⏱ 2026-10-02 · train P39 (SYN-X1 C-17): expanded and extra-large.
  for (final (Size window, String _) in <(Size, String)>[
    (kExpanded, 'expanded'),
    (kWide, 'extra-large'),
  ]) {
    testWidgets('${window.width.toInt()} keeps the dialog at its cap', (
      WidgetTester tester,
    ) async {
      await _openAt(tester, window);
      expect(find.byType(Dialog), findsOneWidget);
      expect(_rowWidth(tester), lessThanOrEqualTo(AppBreakpoints.medium));
    });
  }

  testWidgets('a desktop window does not stretch it to the window', (
    WidgetTester tester,
  ) async {
    await _openAt(tester, kDesktop);
    expect(find.byType(Dialog), findsOneWidget);
    expect(_rowWidth(tester), lessThanOrEqualTo(AppBreakpoints.medium));
    // Both answers are on screen, the last one included.
    final Rect csv = tester.getRect(find.byKey(ShareMonthKeys.csv));
    expect(csv.bottom, lessThanOrEqualTo(kDesktop.height));
  });
}
