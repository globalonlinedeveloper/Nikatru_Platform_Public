// ─────────────────────────────────────────────────────────────────────────────
// STOP A CHARGE — WIDTH + MOUNT PROPERTIES (DE-07). Replaces
// `width_cancel_sheet_test.dart`, retired with the cancel sheet; its two
// properties carry over to the flow that replaced it, and the ROUTE form gets
// its own width cases.
//
// 1. THE SHEET'S WIDTH. `showStopSheet` gets NO width code of its own:
//    Material 3's default `BottomSheetThemeData.constraints` (maxWidth 640) is
//    the only cap. So, as for the sheet before it, the assertions pin that the
//    framework's 640 is what stops the sheet and that nothing of ours narrowed
//    it further: the choices card sits inside the flow's own `AppSpacing.xl`
//    side padding, so it is `640 - 48` wide at 1280.
//
// 2. MOUNT LEVEL. `useRootNavigator: true`, falsifiable only in a host with a
//    NESTED navigator — the shape of a shell-branch caller.
//
// 3. THE ROUTE (`/sub/:id/stop`, [StopScreen]) is a `ContentPane.reading`:
//    full width on a phone, capped at `AppBreakpoints.reading` above it.
//
// 🔴 `find.byType(BottomSheet)` IS THE FULL-BLEED MODAL LAYER, NOT THE SHEET
// (`bottom_sheet.dart`'s inner `Align` has no `widthFactor`); both are asserted
// at every width because they coincide at 375.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show AppBreakpoints, AppCard, AppSpacing;
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/features/stop/stop_flow.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';

import 'support/width_harness.dart';

/// The flow's own horizontal padding — `AppSpacing.xl` each side.
const double kSheetHPadding = AppSpacing.xl * 2;

/// The M3 framework default, `_BottomSheetDefaultsM3.constraints`. Not ours.
const double kM3SheetMaxWidth = 640;

/// '1' is the seed's own Netflix, so every write the flow makes resolves.
Subscription _sub() => Subscription(
  id: '1',
  name: 'Netflix',
  category: 'Streaming',
  price: const Money(1500, 'USD'),
  cycle: BillingCycle.monthly,
  nextRenewal: DateTime.utc(2026, 9, 12),
);

Widget _host() => ProviderScope(
  overrides: defaultWidthOverrides(),
  child: MaterialApp(
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: Scaffold(
      body: Builder(
        builder: (BuildContext context) => Center(
          child: TextButton(
            onPressed: () => showStopSheet(context, _sub()),
            child: const Text('open'),
          ),
        ),
      ),
    ),
  ),
);

/// The same host with the open button one navigator DOWN — the only place
/// `useRootNavigator` can be observed at all.
Widget _nestedNavHost(GlobalKey<NavigatorState> nestedNavKey) => ProviderScope(
  overrides: defaultWidthOverrides(),
  child: MaterialApp(
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: Scaffold(
      body: Navigator(
        key: nestedNavKey,
        onGenerateRoute: (RouteSettings settings) => MaterialPageRoute<void>(
          builder: (BuildContext context) => Center(
            child: TextButton(
              onPressed: () => showStopSheet(context, _sub()),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  ),
);

Finder _modalLayer() => find.byType(BottomSheet);

/// The sheet the user sees — the `Material` the 640 `ConstrainedBox` wraps.
Finder _sheetSurface() {
  expect(
    find.descendant(
      of: find.byType(BottomSheet),
      matching: find.byType(Material),
    ),
    findsWidgets,
    reason: 'the sheet did not mount at all, so there is no width to measure',
  );
  return find
      .descendant(of: find.byType(BottomSheet), matching: find.byType(Material))
      .first;
}

/// The choose step's card of four answers.
Finder _choicesCard() => find.ancestor(
  of: find.byKey(E2EKeys.stopChoiceStop),
  matching: find.byType(AppCard),
);

Future<void> _open(WidgetTester tester, Widget host) async {
  await tester.pumpWidget(host);
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('375 · the sheet is full-bleed, and NO step overflows', (
    WidgetTester tester,
  ) async {
    await setSurface(tester, kPhone);
    await _open(tester, _host());

    expect(tester.getSize(_modalLayer()).width, 375);
    expect(tester.getSize(_sheetSurface()).width, 375);
    expect(find.byKey(E2EKeys.stopChoiceRemove), findsOneWidget);
    expect(tester.takeException(), isNull);

    // The walkthrough and "Did it work?" — the longest lines in the flow.
    await tester.tap(find.byKey(E2EKeys.stopChoiceStop));
    await tester.pumpAndSettle();
    expect(find.byKey(E2EKeys.stopNext), findsOneWidget);
    expect(tester.getSize(_sheetSurface()).width, 375);
    expect(tester.takeException(), isNull);

    await tester.tap(find.byKey(E2EKeys.stopNext));
    await tester.pumpAndSettle();
    expect(find.byKey(E2EKeys.stopItWorked), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('768 · the framework 640 is what stops the sheet', (
    WidgetTester tester,
  ) async {
    await setSurface(tester, kTablet);
    await _open(tester, _host());

    expect(tester.getSize(_sheetSurface()).width, kM3SheetMaxWidth);
    expect(tester.getSize(_modalLayer()).width, 768);
    expect(tester.takeException(), isNull);
  });

  testWidgets('1280 · still 640, and no pane landed inside it', (
    WidgetTester tester,
  ) async {
    await setSurface(tester, kDesktop);
    await _open(tester, _host());

    expect(tester.getSize(_sheetSurface()).width, kM3SheetMaxWidth);
    expect(tester.getSize(_modalLayer()).width, 1280);
    // 🔴 THE INVERSE ASSERTION: nothing narrowed the content below the
    // framework's 640. A stray `ContentPane.form` (420) lands here as 372.
    expect(
      tester.getSize(_choicesCard()).width,
      kM3SheetMaxWidth - kSheetHPadding,
    );
    expect(tester.takeException(), isNull);
  });

  // ⏱ 2026-10-02 · train P39 (SYN-X1 C-17): expanded and extra-large.
  for (final (Size window, String _) in <(Size, String)>[
    (kExpanded, 'expanded'),
    (kWide, 'extra-large'),
  ]) {
    testWidgets(
      '${window.width.toInt()} · still 640, nothing narrower inside',
      (WidgetTester tester) async {
        await setSurface(tester, window);
        await _open(tester, _host());

        expect(tester.getSize(_sheetSurface()).width, kM3SheetMaxWidth);
        expect(tester.getSize(_modalLayer()).width, window.width);
        expect(
          tester.getSize(_choicesCard()).width,
          kM3SheetMaxWidth - kSheetHPadding,
        );
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    '🔴 the sheet mounts on the ROOT navigator, not the branch it was opened from',
    (WidgetTester tester) async {
      final GlobalKey<NavigatorState> nestedNavKey =
          GlobalKey<NavigatorState>();
      await setSurface(tester, kPhone);
      await _open(tester, _nestedNavHost(nestedNavKey));

      expect(find.byType(BottomSheet), findsOneWidget);
      // Delete `useRootNavigator: true` from `showStopSheet` and this goes red.
      expect(
        find.descendant(
          of: find.byKey(nestedNavKey),
          matching: find.byType(BottomSheet),
        ),
        findsNothing,
      );

      // `Navigator.of(sheet)` resolves from the SHEET's route, so the way out
      // still pops the sheet and only it.
      await tester.tap(find.byKey(E2EKeys.stopChoiceStop));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(E2EKeys.stopNext));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(E2EKeys.stopNotYet));
      await tester.pumpAndSettle();

      expect(find.byType(BottomSheet), findsNothing);
      expect(find.text('open'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  // ── THE ROUTE ──────────────────────────────────────────────────────────────
  for (final ({Size size, double pane}) c in <({Size size, double pane})>[
    (size: kPhone, pane: kPhone.width),
    (size: kTablet, pane: AppBreakpoints.reading),
    // ⏱ 2026-10-02 · train P39 (SYN-X1 C-17): expanded and extra-large.
    (size: kExpanded, pane: AppBreakpoints.reading),
    (size: kDesktop, pane: AppBreakpoints.reading),
    (size: kWide, pane: AppBreakpoints.reading),
  ]) {
    testWidgets('${c.size.width.toInt()} · /sub/:id/stop is a reading pane', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, c.size, const StopScreen(id: '1'));
      await tester.pumpAndSettle();
      expect(find.byKey(E2EKeys.stopChoiceStop), findsOneWidget);
      // The width OFFERED to the flow inside the pane — the cap, measured
      // through the pane so no other column can become the subject.
      expect(
        offeredWidth(
          tester,
          inPaneOf(find.byKey(const Key('stop-body-pane')), StopFlow),
        ),
        c.pane,
      );
      expect(tester.takeException(), isNull);
    });
  }
}
