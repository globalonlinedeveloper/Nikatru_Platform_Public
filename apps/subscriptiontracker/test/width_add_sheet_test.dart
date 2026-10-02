// ─────────────────────────────────────────────────────────────────────────────
// WIDTH — ADD-SUBSCRIPTION SHEET (modal)
//
// ⏱ ST-T9 (AD-09, D6-6): from 600 px up the form is a DIALOG capped at 600,
// not M3's 640-wide bottom sheet, and the POPULAR grid lives on the add's
// catalogue pick step. The 375 row below is unchanged in what it pins (4
// columns of 78 px); the 768 / 1280 / EDIT rows now measure the dialog. Both
// LAYOUT and `MediaQuery` are pinned ([_pin]) because the sheet-or-dialog
// choice reads `MediaQuery` — `setSurface` alone would leave it at 800×600 and
// open a dialog at every surface, which is the trap its doc names.
//
// The POPULAR grid shipped as `GridView.count(crossAxisCount: 4)`. Four columns
// is a PHONE decision baked in: the sheet itself is width-governed (M3 caps a
// modal sheet at 640), so at every window from a small tablet up the same four
// columns divided 604 px of content into ~144 px tiles — glyph chips drawn at
// 78 px on a phone rendered at nearly double size, and a POPULAR block ~361 px
// tall before the form even starts.
//
// The port makes the column count DERIVED
// (`SliverGridDelegateWithMaxCrossAxisExtent(maxCrossAxisExtent: 96)`), and
// these three cases pin both halves of that:
//   · 375 — the phone layout must be PIXEL-IDENTICAL to what shipped (4 columns
//     of exactly 78 px). This row protects the port from itself.
//   · 768 / 1280 — the sheet surface is 640 and the tiles stay chip-sized.
//     The 1280 tile-width row IS the defect regression test: measured at 144.3
//     against the unported grid, 93.2 after.
//
// 🔴 THE 640 CAP IS NOT ON `BottomSheet`, SO DO NOT MEASURE `BottomSheet`.
// `bottom_sheet.dart:412-418` wraps the sheet in `Align > ConstrainedBox` INSIDE
// the `BottomSheet` widget, so `BottomSheet`'s own render box is FULL-BLEED —
// measured 768.0 at 768 and 1280.0 at 1280, cap present and working. A width
// assertion written against `find.byType(BottomSheet)` is therefore not merely
// wrong, it is measuring the window rather than the sheet. The rows below
// therefore measure the chassis `AppFormSheet` itself — the surface the user
// sees, in the sheet and in the dialog alike.
//
// ⚠️ (Before ST-T9; [_pin] now pins `MediaQuery` too.) `setSurface` pins
// LAYOUT CONSTRAINTS, NOT `MediaQuery` — see its doc. Every
// assertion below is layout-constraint-derived (sheet width, tile geometry), so
// that is sufficient. The sheet's `maxHeight: …size.height * 0.86` reads
// `MediaQuery` and therefore stays at 516 (86% of the untouched 800×600 view) at
// every surface here; nothing below asserts on height, and nothing may without
// also pinning `tester.view.physicalSize`.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/core/theme/app_theme.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/features/add/add_subscription_sheet.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';

import 'support/catalogue_fixture.dart';
import 'support/width_harness.dart';

/// The sheet is opened by a button, not routed to — so it needs its own host
/// rather than `pumpAt`. Shape borrowed from `sheet_failure_surface_test.dart`,
/// minus its failing repository: nothing here drives `_save`, and a repository
/// that throws would only add noise to a geometry measurement.
///
/// The theme is the app's own `buildAppTheme`, not `MaterialApp`'s default. The
/// 640 cap is an M3 default, and the claim under test is that THIS APP's theme
/// leaves it in place — a bare `MaterialApp` would prove it about a theme the
/// app does not ship.
///
/// 🔴 THE DELEGATES ARE LOAD-BEARING FOR A GEOMETRY TEST, which is the part that
/// is easy to get wrong. `l10n.yaml` sets `nullable-getter: false`, so the
/// generated `AppLocalizations.of(context)` ends in a null assertion — the sheet
/// now reads its title from the arb, so under a bare `MaterialApp` it throws
/// before it lays anything out, and every measurement below becomes a
/// `Bad state` rather than a width. See `sheet_failure_surface_test.dart`, which
/// carries the same two lines for the same reason.
Widget _host({bool edit = false}) {
  return ProviderScope(
    overrides: <Override>[...defaultWidthOverrides(), ...catalogueOverrides()],
    child: MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      theme: buildAppTheme(seed: const Color(0xFF6459F5)),
      home: Scaffold(
        body: Builder(
          builder: (BuildContext context) => Center(
            child: TextButton(
              onPressed: () => edit
                  ? showAddSubscriptionSheet(
                      context,
                      initial: Subscription(
                        id: 'sub-1',
                        name: 'Netflix',
                        category: 'Streaming',
                        price: const Money(1549, 'USD'),
                        cycle: BillingCycle.monthly,
                        nextRenewal: DateTime(2030, 1, 1),
                      ),
                    )
                  : showAddSubscriptionSheet(context),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  );
}

/// Pins the window — layout AND `MediaQuery` — to [size]; see the header.
Future<void> _pin(WidgetTester tester, Size size) async {
  await setSurface(tester, size);
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

Future<void> _openAt(
  WidgetTester tester,
  Size size, {
  bool edit = false,
}) async {
  await _pin(tester, size);
  await tester.pumpWidget(_host(edit: edit));
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

/// The form's own surface, sheet or dialog: the chassis [AppFormSheet].
Finder _form() => find.byType(AppFormSheet);

/// Every POPULAR tile on the pick step, in grid order. The tile root is the
/// `GestureDetector` that fills one cell, and a grid cell is laid out with
/// TIGHT constraints, so its size is the cell size exactly.
Finder _tiles() => find.descendant(
  of: find.byType(GridView),
  matching: find.byType(GestureDetector),
);

void main() {
  testWidgets(
    '375 — a bottom sheet, and the phone grid is 4 columns of exactly 78 px',
    (WidgetTester tester) async {
      await _openAt(tester, kPhone);

      expect(find.byType(BottomSheet), findsOneWidget);
      expect(find.byType(Dialog), findsNothing);
      expect(tester.getSize(_form()).width, 375.0);

      final Finder tiles = _tiles();
      expect(tiles, findsNWidgets(8));

      // 🔴 THE PROPERTY THE PORT EXISTS TO PROTECT. Content width is
      // 375 − 18 − 18 = 339; `maxCrossAxisExtent: 96` with `crossAxisSpacing: 9`
      // yields ceil(339 / 105) = 4 columns of (339 − 27) / 4 = 78.0. This row
      // goes red for any extent outside (84.75, 113].
      expect(tester.getSize(tiles.first).width, closeTo(78, 1.0));
      final double firstRowDy = tester.getTopLeft(tiles.at(0)).dy;
      for (int i = 1; i <= 3; i++) {
        expect(
          tester.getTopLeft(tiles.at(i)).dy,
          firstRowDy,
          reason: 'tile $i should be on the first row — 4 columns',
        );
      }
      expect(
        tester.getTopLeft(tiles.at(4)).dy,
        isNot(firstRowDy),
        reason: 'tile 4 should wrap to the second row — not 5+ columns',
      );
      expect(tester.takeException(), isNull);
    },
  );

  for (final (Size window, double dx) in <(Size, double)>[
    (kTablet, 84),
    // ⏱ 2026-10-02 · train P39 (SYN-X1 C-17): the EXPANDED class, centred
    // (1024 − 600) / 2, and the extra-large one.
    (kExpanded, 212),
    (kDesktop, 340),
    (kWide, 660),
  ]) {
    testWidgets(
      '${window.width.toInt()} — a 600 dialog, centred, tiles chip-sized',
      (WidgetTester tester) async {
        await _openAt(tester, window);

        expect(find.byType(Dialog), findsOneWidget);
        expect(find.byType(BottomSheet), findsNothing);
        expect(tester.getSize(_form()).width, AppFormSheet.dialogMaxWidth);
        expect(tester.getTopLeft(_form()).dx, dx);

        // THE DEFECT REGRESSION TEST, kept: no tile is drawn wider than
        // `maxCrossAxisExtent` at a wide window (it was 144.3 px under a fixed
        // 4-column grid). Asserted per tile.
        final Finder tiles = _tiles();
        expect(tiles, findsNWidgets(8));
        for (int i = 0; i < tiles.evaluate().length; i++) {
          expect(tester.getSize(tiles.at(i)).width, lessThanOrEqualTo(96.0));
        }
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets('the dialog keeps the keyboard contract: Esc closes it', (
    WidgetTester tester,
  ) async {
    await _openAt(tester, kDesktop);
    expect(find.byType(Dialog), findsOneWidget);
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.byType(Dialog), findsNothing);
  });

  // ⏱ train ST-D6, ST-T9: THE SAME SURFACE AS AN EDIT — the full window below
  // 600, the 600 dialog centred above it, at every window class.
  for (final (Size window, double width, double dx, bool dialog)
      in <(Size, double, double, bool)>[
        (kPhone, 375, 0, false),
        (kTablet, 600, 84, true),
        (kExpanded, 600, 212, true),
        (kDesktop, 600, 340, true),
        (kWide, 600, 660, true),
      ]) {
    testWidgets('${window.width.toInt()} — the EDIT form is the same surface', (
      WidgetTester tester,
    ) async {
      await _openAt(tester, window, edit: true);

      expect(find.byType(Dialog), dialog ? findsOneWidget : findsNothing);
      expect(tester.getSize(_form()).width, width);
      expect(tester.getTopLeft(_form()).dx, dx);
      // An edit opens on the form: no pick step, no POPULAR shortcuts.
      expect(find.byKey(E2EKeys.addSearch), findsNothing);
      expect(find.byType(GridView), findsNothing);
      expect(tester.takeException(), isNull);
    });
  }
}
