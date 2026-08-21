// ─────────────────────────────────────────────────────────────────────────────
// WIDTH · INSIGHTS (`/insights`) — the cap this screen never had.
//
// Insights was a bare `ListView(padding: fromLTRB(18, 58, 18, 108))`. It never
// overflowed and never clipped, so no existing assertion could fail — but
// between 1200 and 1599 `AppScaffold` does NOT cap the body (only its
// extra-large class, >=1600, does), and both cards took every pixel the drawer
// left them. A defect with no exception and no red pixel is only visible to a
// MEASUREMENT, which is what this file is.
//
// 🔴 CORRECTED 2026-08-21 — THIS HEADER SAID "a 1550 px savings row" AND THAT
// WIDTH CANNOT OCCUR. `AppScaffold` hands the body `min(W - 361, 1280)` (the
// 360px drawer plus its 1px divider come off first), so 1280 is the ceiling at
// any window width and 1238 is the ceiling inside the LARGE class. The widest
// a savings row has ever been is ~1204 after the page gutters and card
// padding. The defect was real; the number was invented.
//
// 🔴 THE CAP IS NOW `AppBreakpoints.reading` (720), NOT `kMaxBodyWidth` (1280),
// and that is why the 768 and 1280 cases below changed from no-ops into real
// assertions. A 1280 cap could never bind — the body cannot exceed 1280 in the
// first place — so the old wrapper was measurable only at 1920 and did nothing
// at any width a user has. `insights_screen.dart` carries the reasoning for
// 720; this file only has to agree with it.
//
// Everything structural — why the assertion reads `constraints` and not `size`,
// why every case pins the surface, why the falsifiable desktop case is 1920 and
// not 1280 — is documented once in `support/width_harness.dart`. Read that
// header rather than restating it here.
//
// 🔴 WHAT IS PUMPED IS `InsightsScreen`, NOT the router's `_GatedInsights`.
// `router.dart:265` wraps this screen in the chassis `PaywallGate` (unlocked by
// default). Width is a property of the SCREEN; the gate is a property of the
// route, and it is tested where it lives. Pumping the wrapper here would make
// this file go red the day the gate's default flips — a failure that names the
// width cap while meaning something else entirely.
//
// ⚠️ NO OVERRIDES BEYOND THE HARNESS DEFAULTS, AND THAT IS DELIBERATE.
// `defaultWidthOverrides()` leaves `subscriptionRepositoryProvider` alone, so
// the unconfigured chain resolves `SeedApiClient`. Seed ids 6/7/10 are
// `unused: true` (`data/seed/demo_data.dart`), which is what makes the savings
// card render its POPULATED branch — the widest content on the page (glyph +
// two-line note + a 48 px gradient button, per row). An empty savings card has
// no rows to stretch and nothing the cap is there to prevent.
// (The button was 36 when this header was written; `insights_screen.dart`
// raised it to 48 against androidTapTargetGuideline and the number here was
// left behind. Corrected 2026-08-21.)
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/features/insights/insights_screen.dart';

import 'support/width_harness.dart';

void main() {
  group('insights is capped at the body width', () {
    // 375 is the TIGHTEST FIT on this screen, and the exception check is the
    // half that matters. The donut is a fixed 126×126 (`insights_screen.dart`'s
    // `SizedBox`), so the category row's legend gets whatever is left of the
    // card's content box — 375 less the 18/18 page gutters less the card's
    // 20/20 padding, less 126 for the donut and 18 for the gap: about 155 px,
    // shared by a 10 px swatch, a category name and a right-aligned figure.
    // It lays out clean today; `takeException()` is what proves it stays that
    // way when somebody adds a category or lengthens a name.
    testWidgets('at 375 the cap is a no-op and the donut row still fits', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const InsightsScreen());

      // 🔴 FIRST, PROVE THE MEASUREMENT IS NOT VACUOUS. The seed chain resolves
      // asynchronously; if it had not landed within `pumpAt`'s pumps, the screen
      // would fall back to `valueOrNull ?? const []` and render an EMPTY savings
      // card and a segment-less donut — no rows to stretch, and a
      // `takeException()` check with nothing left on the page to overflow.
      // Measured: 3 Cancel buttons (seed ids 6/7/10) and no empty state.
      expect(
        find.text('Cancel'),
        findsWidgets,
        reason:
            'the savings card must be in its POPULATED branch — that is the '
            'widest content on this page and the only reason 375 is a tight fit',
      );
      expect(
        find.text('Nothing flagged — nice.'),
        findsNothing,
        reason:
            'the empty state is the shape whose width nobody cares about; if it '
            'is on screen the two assertions below are measuring nothing',
      );

      expect(
        offeredWidth(tester, inPane(ListView)),
        375,
        reason:
            'below the cap a ConstrainedBox may only tighten within what it was '
            'handed, so a phone must render exactly as it did before the pane '
            'existed — the page gutters are inside the ListView, not the pane',
      );
      expect(
        tester.takeException(),
        isNull,
        reason:
            'the donut row and the populated savings rows must lay out clean on '
            'the narrowest phone — this is the tight fit the pane must not break',
      );
    });

    // 🔴 NO LONGER A NO-OP, AND THAT IS THE POINT OF THE NEW CAP. 768 is the
    // first surface in this file where the pane actually takes width away:
    // under the old `kMaxBodyWidth` default this case asserted 768 and was
    // true with the wrapper deleted.
    testWidgets('at 768 the cap binds', (WidgetTester tester) async {
      await pumpAt(tester, kTablet, const InsightsScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.reading,
        reason:
            'a small tablet is already past `reading`, so the pane must hold '
            'the column at 720 rather than hand the surface through',
      );
    });

    testWidgets('at 1280 the body is held at reading', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kDesktop, const InsightsScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.reading,
        reason:
            'the ordinary desktop window. Under the old 1280 cap this case '
            'could only assert `<= 1280`, which is true of the surface itself '
            'and so could not fail; 720 is a number the wrapper alone produces',
      );
    });

    // 🔴 THE WIDEST CASE. Delete the `ContentPane` from `insights_screen.dart`
    // and `inPane` reports "this screen has no ContentPane at all"; widen it
    // back to the default and the offered width becomes 1280 instead of 720.
    // Unlike before, the two cases above fail in the same edit.
    testWidgets('at 1920 the body is capped at exactly reading', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kWide, const InsightsScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.reading,
        reason:
            'unconstrained, the savings rows ran the full 1920 px — a glyph at '
            'one edge and a Cancel button at the other, with a third of a '
            'screen of nothing between them',
      );
      // Pinned so a change to the design system's own number is a red test
      // here rather than a silent re-layout of this screen.
      expect(AppBreakpoints.reading, 720);
    });
  });
}
