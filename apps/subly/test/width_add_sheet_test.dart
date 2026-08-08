// ─────────────────────────────────────────────────────────────────────────────
// WIDTH — ADD-SUBSCRIPTION SHEET (modal)
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
// wrong, it is measuring the window rather than the sheet. [_surface] finds the
// node the cap actually lands on; [surfaceCapWidth] reads its incoming
// constraint rather than its size, so the assertion cannot be quietly disarmed
// by content that happens to shrink-wrap narrower (the harness header's rule).
//
// ⚠️ `setSurface` pins LAYOUT CONSTRAINTS, NOT `MediaQuery` — see its doc. Every
// assertion below is layout-constraint-derived (sheet width, tile geometry), so
// that is sufficient. The sheet's `maxHeight: …size.height * 0.86` reads
// `MediaQuery` and therefore stays at 516 (86% of the untouched 800×600 view) at
// every surface here; nothing below asserts on height, and nothing may without
// also pinning `tester.view.physicalSize`.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subly/core/theme/app_theme.dart';
import 'package:subly/data/seed/demo_data.dart';
import 'package:subly/features/add/add_subscription_sheet.dart';

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
Widget _host() {
  return ProviderScope(
    overrides: defaultWidthOverrides(),
    child: MaterialApp(
      theme: buildAppTheme(seed: const Color(0xFF6459F5)),
      home: Scaffold(
        body: Builder(
          builder: (BuildContext context) => Center(
            child: TextButton(
              onPressed: () => showAddSubscriptionSheet(context),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  );
}

Future<void> _openSheetAt(WidgetTester tester, Size size) async {
  await setSurface(tester, size);
  await tester.pumpWidget(_host());
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

/// The sheet's own surface — the `Material` the M3 `ConstrainedBox` wraps. See
/// the header for why this and not `find.byType(BottomSheet)`.
Finder _surface() => find
    .descendant(of: find.byType(BottomSheet), matching: find.byType(Material))
    .first;

/// The width the sheet surface was OFFERED, i.e. the M3 cap as applied at this
/// window: `min(640, windowWidth)`.
double surfaceCapWidth(WidgetTester tester) => offeredWidth(tester, _surface());

/// Every POPULAR tile, in grid order. The tile root is the `GestureDetector`
/// that fills one cell, and a grid cell is laid out with TIGHT constraints, so
/// its size is the cell size exactly.
Finder _tiles() => find.descendant(
  of: find.byType(GridView),
  matching: find.byType(GestureDetector),
);

void main() {
  testWidgets(
    '375 — the phone layout is pixel-identical: 4 columns of exactly 78 px',
    (WidgetTester tester) async {
      await _openSheetAt(tester, kPhone);

      // Below 640 there is nothing to cap, so the sheet is the full window.
      expect(surfaceCapWidth(tester), 375.0);
      expect(tester.getSize(_surface()).width, 375.0);

      final Finder tiles = _tiles();
      expect(tiles, findsNWidgets(DemoData.popular.length));

      // 🔴 THE PROPERTY THE PORT EXISTS TO PROTECT. Content width is
      // 375 − 18 − 18 = 339; `maxCrossAxisExtent: 96` with `crossAxisSpacing: 9`
      // yields ceil(339 / 105) = 4 columns of (339 − 27) / 4 = 78.0 — the same
      // number `crossAxisCount: 4` produced. This row goes red for any extent
      // outside (84.75, 113]: 80 would give 5 columns, 120 would give 3.
      expect(tester.getSize(tiles.first).width, closeTo(78, 1.0));

      // Four columns, asserted by row membership rather than by re-deriving the
      // arithmetic: tiles 0-3 share a row, tile 4 opens the next one.
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

  testWidgets('768 — the sheet surface is capped at the M3 default 640', (
    WidgetTester tester,
  ) async {
    await _openSheetAt(tester, kTablet);

    // `buildAppTheme` sets `useMaterial3: true` and no `bottomSheetTheme`
    // override exists anywhere in the design system, so `_BottomSheetDefaultsM3`
    // supplies `BoxConstraints(maxWidth: 640)`. VERIFIED here rather than taken
    // on the framework's word.
    expect(surfaceCapWidth(tester), 640.0);
    expect(tester.getSize(_surface()).width, 640.0);
    // Centred: (768 − 640) / 2.
    expect(tester.getTopLeft(_surface()).dx, 64.0);

    expect(tester.takeException(), isNull);
  });

  testWidgets(
    '1280 — capped at 640 and no POPULAR tile exceeds maxCrossAxisExtent 96',
    (WidgetTester tester) async {
      await _openSheetAt(tester, kDesktop);

      expect(surfaceCapWidth(tester), 640.0);
      expect(tester.getSize(_surface()).width, 640.0);
      expect(tester.getTopLeft(_surface()).dx, 320.0);

      final Finder tiles = _tiles();
      expect(tiles, findsNWidgets(DemoData.popular.length));

      // 🔴 THE DEFECT REGRESSION TEST. Under the shipped
      // `GridView.count(crossAxisCount: 4)` these tiles measured 144.3 px wide —
      // a 78 px chip drawn at nearly double size. With the column count derived
      // from `maxCrossAxisExtent: 96` the same 604 px of content gives 6 columns
      // of 93.2. Asserted per tile, not on the first one, so a delegate that
      // sized only the leading cell correctly could not slip through.
      for (int i = 0; i < tiles.evaluate().length; i++) {
        expect(
          tester.getSize(tiles.at(i)).width,
          lessThanOrEqualTo(96.0),
          reason:
              'tile $i is wider than maxCrossAxisExtent — the grid is back on '
              'a fixed column count',
        );
      }

      expect(tester.takeException(), isNull);
    },
  );
}
