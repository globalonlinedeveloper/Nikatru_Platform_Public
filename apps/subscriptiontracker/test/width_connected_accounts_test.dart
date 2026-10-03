// ⏱ 2026-10-01 · SE-04 — Settings' "Connected accounts" sheet at every window
// class. The sheet is `showAdaptiveSheet`: a bottom sheet on a phone, a
// dialog capped at `AppBreakpoints.medium` from a tablet up — and the view
// inside holds the form cap (`ConnectedAccountsView`'s own width decision).
//
// RED CONTROL: open it with `showModalBottomSheet` directly — the kTablet,
// kExpanded, kDesktop and kWide cases find no Dialog and a list the width of
// the window.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/settings/connected_accounts_view.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/features/auth/connected_accounts_sheet.dart';

import 'support/width_harness.dart';

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
            onPressed: () => showConnectedAccountsSheet(context),
            child: const Text('open'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  expect(find.byType(ConnectedAccountsView), findsOneWidget);
  expect(tester.takeException(), isNull);
}

/// The width of the list itself — a row, which stretches to the cap.
double _listWidth(WidgetTester tester) =>
    tester.getSize(find.byType(ListTile).first).width;

void main() {
  testWidgets('a phone gets a sheet, the list inside its padding', (
    WidgetTester tester,
  ) async {
    await _openAt(tester, kPhone);
    expect(find.byType(BottomSheet), findsOneWidget);
    expect(_listWidth(tester), lessThan(kPhone.width));
  });

  testWidgets('a tablet gets a dialog, the list at the form cap', (
    WidgetTester tester,
  ) async {
    await _openAt(tester, kTablet);
    expect(find.byType(Dialog), findsOneWidget);
    expect(_listWidth(tester), lessThanOrEqualTo(AppBreakpoints.form));
  });

  testWidgets('a desktop gets the same dialog, not a banner', (
    WidgetTester tester,
  ) async {
    await _openAt(tester, kDesktop);
    expect(find.byType(Dialog), findsOneWidget);
    expect(_listWidth(tester), lessThanOrEqualTo(AppBreakpoints.form));
  });

  // ⏱ 2026-10-03 · merged over main's P39 (SYN-X1 C-17), which declared the
  // EXPANDED (1024) class and made kWide (1920) a required window: the same
  // dialog at both, the list still at the form cap rather than the window.
  testWidgets('an expanded window (1024) gets the same dialog, at the cap', (
    WidgetTester tester,
  ) async {
    await _openAt(tester, kExpanded);
    expect(find.byType(Dialog), findsOneWidget);
    expect(_listWidth(tester), lessThanOrEqualTo(AppBreakpoints.form));
  });

  testWidgets('a wide window (1920) gets the same dialog, at the cap', (
    WidgetTester tester,
  ) async {
    await _openAt(tester, kWide);
    expect(find.byType(Dialog), findsOneWidget);
    expect(_listWidth(tester), lessThanOrEqualTo(AppBreakpoints.form));
  });
}
