// ─────────────────────────────────────────────────────────────────────────────
// CANCEL SHEET — WIDTH + MOUNT PROPERTIES (P3 port).
//
// Two different things are pinned here, and they fail for different reasons.
//
// 1. WIDTH. The cancel sheet gets NO width code of its own: Material 3's
//    default `BottomSheetThemeData.constraints` (maxWidth 640) is the only cap,
//    and §4 of the port spec decided AGAINST putting a `ContentPane` inside it.
//    So the assertions below are deliberately the INVERSE of the other width
//    specs': they pin that the framework's 640 is what stops the sheet and that
//    nothing of ours narrowed it further. `640 - 44` is the button row under
//    the container's own `fromLTRB(22, …, 22, …)` padding — if a pane ever
//    lands in here by accident, that number moves and this goes red.
//
// 2. MOUNT LEVEL. `useRootNavigator: true` is the port's one line of product
//    code. It is invisible in a single-navigator host — every assertion you can
//    write there passes with or without it — so the two mount cases build a
//    host with a NESTED navigator, which is the shape of the real
//    insights-screen caller. That is the only place the flag can be falsified.
//
// 🔴 `find.byType(BottomSheet)` IS NOT THE SHEET'S WIDTH, AND THE TWO AGREE ON
// A PHONE, WHICH IS HOW THE MISTAKE SURVIVES. `BottomSheet.build` applies the
// theme constraints as `Align(child: ConstrainedBox(…))` INSIDE itself
// (`flutter/lib/src/material/bottom_sheet.dart:412-418`), and that `Align` has
// no `widthFactor`, so it takes the full incoming width. The element found by
// `find.byType(BottomSheet)` therefore measures the full-bleed MODAL LAYER —
// 375, 768 and 1280 respectively — while the sheet the user sees is 375, 640
// and 640. Measured on this tree, not reasoned about. Both numbers are asserted
// at every breakpoint precisely because they coincide at 375: a test that only
// read the layer would report "375 ✓" on a phone and then silently measure the
// window instead of the sheet everywhere else.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subly/data/models/subscription.dart';
import 'package:subly/features/cancel/cancel_sheet.dart';
import 'package:subly/features/shared/widgets.dart';
import 'package:subly/l10n/app_localizations.dart';

import 'support/width_harness.dart';

/// The container's own horizontal padding — `fromLTRB(22, 26, 22, 30)` in
/// `cancel_sheet.dart`. Named so the `640 - 44` below reads as the property it
/// is (sheet minus padding) rather than as a magic number.
const double kSheetHPadding = 22 * 2;

/// The M3 framework default, `_BottomSheetDefaultsM3.constraints`. Not ours.
const double kM3SheetMaxWidth = 640;

Subscription _sub() => Subscription(
  id: 'sub-1',
  name: 'Netflix',
  category: 'Streaming',
  price: 15,
  cycle: BillingCycle.monthly,
  nextRenewal: DateTime.utc(2026, 9, 12),
);

/// The open-button host from `sheet_failure_surface_test.dart:74-94`.
///
/// 🔴 WITH [defaultWidthOverrides], NOT THAT FILE'S `_WriteFailsRepository`.
/// The repository is left unoverridden on purpose, so the chain resolves
/// `SeedApiClient`, whose `deleteSubscription` completes. The failing repo would
/// make step 1 unreachable — and the 375 case has to be run on BOTH steps,
/// because the wrap risk this file exists to cover (the long
/// `' · $X/yr. Access continues until …'` span) has a sibling on step 1.
Widget _host() => ProviderScope(
  overrides: defaultWidthOverrides(),
  child: MaterialApp(
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: Scaffold(
      body: Builder(
        builder: (BuildContext context) => Center(
          child: TextButton(
            onPressed: () => showCancelSheet(context, _sub()),
            child: const Text('open'),
          ),
        ),
      ),
    ),
  ),
);

/// The same host with the open button one navigator DOWN.
///
/// This is the insights-screen caller's shape: a nested `Navigator` (there, a
/// shell branch) below the `MaterialApp`'s root one. Without it the two
/// navigators are the same object and `useRootNavigator` cannot be observed at
/// all — which is exactly why the flag shipped unproven elsewhere.
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
              onPressed: () => showCancelSheet(context, _sub()),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  ),
);

/// The full-bleed modal layer. See the header: this is the WINDOW, not the
/// sheet, everywhere the 640 cap actually bites.
Finder _modalLayer() => find.byType(BottomSheet);

/// The sheet the user sees — the `Material` the 640 `ConstrainedBox` wraps.
///
/// Found THROUGH the modal layer so no other `Material` on screen (every
/// button builds one) can become the thing being measured. The `findsWidgets`
/// check is the error message: without it, a sheet that failed to mount reaches
/// `.first` on an empty iterable and dies with `Bad state: No element`, pointing
/// at the framework instead of at the sheet.
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

/// The step-0 button row ('Keep it' · 'Confirm cancel').
///
/// Anchored on [SoftButton] rather than on `find.byType(Row)`, which matches
/// the rows the buttons build INSIDE themselves. There is exactly one `Row`
/// above a `SoftButton` here, so this is unambiguous — asserted, so that a
/// second one appearing turns into a named failure rather than a silent
/// `.first`.
Finder _buttonRow() {
  final Finder rows = find.ancestor(
    of: find.byType(SoftButton),
    matching: find.byType(Row),
  );
  expect(
    rows,
    findsOneWidget,
    reason: 'the button row is no longer the only Row above the SoftButton',
  );
  return rows;
}

Future<void> _open(WidgetTester tester, Widget host) async {
  await tester.pumpWidget(host);
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('375 · the sheet is full-bleed, and NEITHER step overflows', (
    WidgetTester tester,
  ) async {
    await setSurface(tester, kPhone);
    await _open(tester, _host());

    // Step 0. On a phone the cap is not reached, so layer and sheet agree —
    // the one width at which they do.
    expect(tester.getSize(_modalLayer()).width, 375);
    expect(tester.getSize(_sheetSurface()).width, 375);
    expect(find.text('Confirm cancel'), findsOneWidget);
    // The wrap risk: `'You’ll save $X/mo · $Y/yr. Access continues until
    // September 12.'` is the longest line in the app that has to survive the
    // narrowest surface. An overflow here is a thrown exception, not a red
    // pixel, so this is the assertion that catches it.
    expect(tester.takeException(), isNull);

    // Step 1 — reached by confirming against the resolving seed chain.
    await tester.tap(find.text('Confirm cancel'));
    await tester.pumpAndSettle();

    expect(find.text('Cancelled'), findsOneWidget);
    expect(tester.getSize(_sheetSurface()).width, 375);
    expect(tester.takeException(), isNull);
  });

  testWidgets('768 · the framework 640 is what stops the sheet', (
    WidgetTester tester,
  ) async {
    await setSurface(tester, kTablet);
    await _open(tester, _host());

    expect(tester.getSize(_sheetSurface()).width, kM3SheetMaxWidth);
    // …and the layer under it still spans the window, which is what makes the
    // line above a measurement of the CAP rather than of the surface.
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

    // 🔴 THE INVERSE ASSERTION. Every other width spec in this wave pins that a
    // cap IS applied; §4 decided this sheet gets none, so what has to be pinned
    // is that nothing narrowed the content below the framework's 640. A
    // `ContentPane.form` (420) or any stray cap lands here as 376, not 596.
    expect(
      tester.getSize(_buttonRow()).width,
      kM3SheetMaxWidth - kSheetHPadding,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    '🔴 the sheet mounts on the ROOT navigator, not the branch it was opened from',
    (WidgetTester tester) async {
      final GlobalKey<NavigatorState> nestedNavKey =
          GlobalKey<NavigatorState>();
      await setSurface(tester, kPhone);
      await _open(tester, _nestedNavHost(nestedNavKey));

      // The sheet exists…
      expect(find.byType(BottomSheet), findsOneWidget);
      // …and NOT inside the navigator whose context opened it. Delete
      // `useRootNavigator: true` from `showCancelSheet` and this line is the
      // one that goes red — the pair above/below stays green either way, which
      // is the whole reason this host exists.
      expect(
        find.descendant(
          of: find.byKey(nestedNavKey),
          matching: find.byType(BottomSheet),
        ),
        findsNothing,
      );

      // §3's warning, verified rather than argued: `Navigator.of(context)`
      // inside the sheet resolves from the SHEET's route, so moving where it
      // mounted must not break the way out of it.
      await tester.tap(find.text('Keep it'));
      await tester.pumpAndSettle();

      expect(find.byType(BottomSheet), findsNothing);
      expect(find.text('open'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets("mounted on the root, 'Done' still pops the sheet and only it", (
    WidgetTester tester,
  ) async {
    final GlobalKey<NavigatorState> nestedNavKey = GlobalKey<NavigatorState>();
    await setSurface(tester, kPhone);
    await _open(tester, _nestedNavHost(nestedNavKey));

    await tester.tap(find.text('Confirm cancel'));
    await tester.pumpAndSettle();
    expect(find.text('Cancelled'), findsOneWidget);

    // Step 1's pop is a SECOND exit path on the same route, and it is the one
    // that runs after the destructive call has already happened — a sheet that
    // will not close here strands the user on a success screen.
    await tester.tap(find.text('Done'));
    await tester.pumpAndSettle();

    expect(find.byType(BottomSheet), findsNothing);
    // The nested route it was opened from is untouched: the pop took the sheet,
    // not the caller's page.
    expect(find.text('open'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
