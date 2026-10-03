// THE BUDGET EDITOR'S WIDTH DECISION — train ST-D3, label D3-2.
//
// `showBudgetEditorSheet` goes through the design system's `showAdaptiveSheet`:
// a bottom sheet the width of a phone, and from 600 dp up a dialog capped at
// `AppBreakpoints.medium` (600). A sheet that stretched to 1920 would raise no
// exception and clip no pixel, so only a measurement sees it.
//
// ⚠️ THE VIEW IS SIZED AS WELL AS THE SURFACE. The window class is read off
// `MediaQuery.sizeOf`, which follows the view; `setSurfaceSize` alone would
// leave every case at the test binding's default 800 × 600 — the medium class
// — and the phone case would measure a dialog.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/core/format/money_format.dart';
import 'package:subscriptiontracker/core/format/sub_math.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/features/insights/budget_editor.dart';

import 'support/width_harness.dart';

const BudgetInfo _budget = BudgetInfo(
  monthlyBudget: Money(550000, 'INR'),
  categories: <BudgetCap>[],
);

Future<void> _openAt(WidgetTester tester, Size size) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await pumpAt(
    tester,
    size,
    Scaffold(
      body: Builder(
        builder: (BuildContext context) => Center(
          child: TextButton(
            onPressed: () => showBudgetEditorSheet(
              context,
              budget: _budget,
              spent: MoneyBag.sum(const <Money>[Money(504900, 'INR')]),
              categories: <CategoryTotal>[
                CategoryTotal(
                  'Video',
                  MoneyBag.sum(const <Money>[Money(129700, 'INR')]),
                ),
              ],
            ),
            child: const Text('open'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  expect(find.byType(BudgetEditor), findsOneWidget);
  expect(tester.takeException(), isNull);
}

double _editorWidth(WidgetTester tester) =>
    tester.getSize(find.byType(BudgetEditor)).width;

void main() {
  testWidgets('a phone gets a sheet the width of the phone', (
    WidgetTester tester,
  ) async {
    await _openAt(tester, kPhone);
    expect(find.byType(BottomSheet), findsOneWidget);
    expect(_editorWidth(tester), kPhone.width);
  });

  testWidgets('a tablet gets a dialog capped at 600', (
    WidgetTester tester,
  ) async {
    await _openAt(tester, kTablet);
    expect(find.byType(Dialog), findsOneWidget);
    expect(_editorWidth(tester), lessThanOrEqualTo(AppBreakpoints.medium));
  });

  testWidgets('a desktop gets the same 600 dialog, not a banner', (
    WidgetTester tester,
  ) async {
    await _openAt(tester, kDesktop);
    expect(find.byType(Dialog), findsOneWidget);
    expect(_editorWidth(tester), lessThanOrEqualTo(AppBreakpoints.medium));
  });

  // ⏱ 2026-10-01 · train P39 (SYN-X1 C-17): the EXPANDED class.
  testWidgets('at 1024 (expanded) it is the same 600 dialog', (
    WidgetTester tester,
  ) async {
    await _openAt(tester, kExpanded);
    expect(find.byType(Dialog), findsOneWidget);
    expect(_editorWidth(tester), lessThanOrEqualTo(AppBreakpoints.medium));
  });

  testWidgets('at 1920 the dialog is still 600 at most', (
    WidgetTester tester,
  ) async {
    await _openAt(tester, kWide);
    expect(_editorWidth(tester), lessThanOrEqualTo(AppBreakpoints.medium));
  });
}
