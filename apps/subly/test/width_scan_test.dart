// ─────────────────────────────────────────────────────────────────────────────
// WIDTH — SCAN / FIRST-RUN SETUP (`/scan`), ContentPane.reading (720).
//
// The arithmetic here is ONBOARDING's, not settings'. Both screens are capped
// at `AppBreakpoints.reading`, and 720 < 768, so a small tablet is the FIRST of
// these widths at which this screen stops growing. Writing `768 - 48` in the
// tablet case — copying the shape of the phone case, which really is
// `375 - 48` — is the exact mistake `responsive_width_test.dart:161-167` exists
// to warn the next reader off. The number below is `AppBreakpoints.reading - 48`
// and it is a different number.
//
// 🔴 AND THAT IS WHY THIS FILE IS FALSIFIABLE WHERE THE `kMaxBodyWidth` GROUPS
// ARE NOT. Strip the pane out of `scan_screen.dart` and the 768 case goes red on
// the spot (768 - 48 ≠ 720 - 48) — no 1920 surface required. The two `ListView`
// groups in `responsive_width_test.dart` need 1920 to distinguish a present cap
// from an absent one, because their cap IS the ordinary desktop width. Choosing
// `.reading` bought this screen a cheaper red.
//
// ⚠️ THE TIMER IS DRIVEN BY HAND, AND `pumpAndSettle` IS NOT AN OPTION.
// `ScanScreen` runs a 560 ms `Timer.periodic` for five steps before it flips to
// its results phase. `pumpAndSettle` waits for quiescence, so against a periodic
// timer it either burns the full ~3.4 s of fake time or spins — either way it is
// a lie about what is being waited for. The harness's [pumpAt] does 12
// ZERO-duration pumps, which advance no timers at all (its doc says so), so the
// first three cases below measure the SCANNING phase as pumped. The results case
// then walks the clock forward in explicit 560 ms steps and uses
// `find.text('All set')` as the phase sentinel — a positive proof it arrived,
// rather than an assumption that six pumps were enough.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/features/scan/scan_screen.dart';

import 'support/width_harness.dart';

void main() {
  group('scan is capped at reading width', () {
    testWidgets('at 375 the cap is a no-op and nothing overflows', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const ScanScreen());
      expect(
        offeredWidth(tester, inPane(Column)),
        375 - 48,
        reason:
            'below the cap a ConstrainedBox may only tighten within what it '
            'was handed, so a phone must render exactly as it did before the '
            'pane existed — 375 less the 24/24 gutters that were already there',
      );
      expect(
        tester.takeException(),
        isNull,
        reason:
            'the 158px ring, the 200px bar and the status line must lay out '
            'clean on the narrowest phone',
      );
    });

    // ⚠️ 768 IS ALREADY PAST THE CAP. `AppBreakpoints.reading - 48`, NOT
    // `768 - 48`: 720 < 768, so the pane is doing its job here already and the
    // 24/24 gutters come out of the CAP rather than out of the surface. This is
    // the one case in this file that a stripped pane reddens without help — see
    // the file header.
    testWidgets('at 768 the reading cap has ALREADY engaged', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kTablet, const ScanScreen());
      expect(
        offeredWidth(tester, inPane(Column)),
        AppBreakpoints.reading - 48,
        reason:
            'a tablet is wider than 720, so this is the width at which the '
            'pane starts mattering — and the width at which deleting it goes '
            'red, unlike the kMaxBodyWidth screens that need a 1920 surface',
      );
    });

    testWidgets('at 1280 the scanning body is capped at reading', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kDesktop, const ScanScreen());
      expect(
        offeredWidth(tester, inPane(Column)),
        lessThanOrEqualTo(AppBreakpoints.reading),
        reason:
            '720 < 1280, so the ordinary desktop window already distinguishes '
            'a present cap from an absent one — this screen needs no kWide '
            'case to be falsifiable',
      );
      expect(AppBreakpoints.reading, 720);
    });

    // The other half of the screen. `_results` is a different subtree — a
    // gradient hero over a ListView — reached only after `_done` flips, so the
    // three cases above never touch it. Uncapped at 1280 the hero is a
    // wall-to-wall banner, which is the concrete thing `.reading` was chosen
    // for; measuring only the scanning phase would leave that unproven.
    testWidgets('at 1280 the RESULTS hero is capped too', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kDesktop, const ScanScreen());

      // Five steps then the flip: six periods of the 560 ms timer. Explicit
      // durations, because only a pump WITH a duration advances fake time.
      for (int i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 560));
      }

      expect(
        find.text('All set'),
        findsOneWidget,
        reason:
            'the phase sentinel: the results subtree only exists once _done is '
            'true, so without this the case could pass having measured the '
            'scanning phase a second time — which is the case above, verbatim',
      );

      // The hero ITSELF, not the body Column again. Found through its own copy
      // rather than by type, because `RowCard` puts a Container on every row
      // below it and `find.byType(Container).first` would be right by accident.
      final Finder hero = find
          .ancestor(
            of: find.text('YOUR SUBSCRIPTIONS'),
            matching: find.byType(Container),
          )
          .first;
      expect(
        offeredWidth(tester, hero),
        lessThanOrEqualTo(AppBreakpoints.reading),
        reason:
            'the congratulation hero is display copy, not data density — '
            'uncapped it is offered the full 1280 window and renders as a '
            'wall-to-wall gradient banner. This is the concrete thing the '
            '.reading choice was made for',
      );
      expect(
        tester.takeException(),
        isNull,
        reason: 'the results list must lay out clean under the cap',
      );
    });
  });
}
