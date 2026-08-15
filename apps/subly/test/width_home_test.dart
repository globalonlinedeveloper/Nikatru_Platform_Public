// ─────────────────────────────────────────────────────────────────────────────
// HOME · WIDTH — the assertion `home_screen.dart` asked for BY NAME.
//
// That file's `ContentPane` carried the comment `⬜ NOT YET POLICED`: "until it
// lands, this wrapper can be deleted with every test still green". This file is
// what landed, and that comment now reads `✅ POLICED` and points here. The
// block below is the one pre-drafted in
// `Private/knowledge/plans/prefab-artifacts/p26b-home/width-behaviour.md` §4, with its
// imports adapted to `support/width_harness.dart` (the harness was extracted
// from `responsive_width_test.dart` after that draft was written, so the draft's
// "append to responsive_width_test.dart" is now "a file of its own, on the
// shared rig").
//
// Everything structural — why the assertion is on incoming `BoxConstraints`
// rather than on `getSize`, why every case pins the surface, why 1920 is the
// desktop case for a `kMaxBodyWidth` screen — lives in the harness header. Read
// it before adding a case here.
//
// 🔴 THE DRAFT'S ONE STALE SENTENCE, CORRECTED BY MEASUREMENT.
// §4 says the 1920 case "alone would pass with the pane deleted", because
// `AppScaffold` applies its own 1280 cap in the extra-large class. That was true
// of the STAMPED home, which owned an `AppScaffold`. Variant B ([ADR 037],
// P2.6a) moved scaffold ownership to `AppShell`: `HomeScreen` is branch 0's BODY
// and carries no scaffold at all, so pumped on this harness there is no shell
// cap behind the pane and BOTH the 1920 and the 1500 case are falsifiable.
// Measured against the real tree, 2026-08-09, two mutations, `flutter analyze`
// clean (29 issues, the baseline) under each so neither red is a compile error
// wearing a caught mutation's clothes:
//
//   · cap widened (`ContentPane(maxWidth: double.infinity)`, pane still present)
//     → 1920 fails `Expected <1280.0> Actual <1920.0>`, 1500 fails
//       `<1500.0> is not <= <1280.0>`, and 375 stays GREEN — which is correct,
//       375 is the no-op case and is not supposed to be able to fail;
//   · pane deleted outright → all FIVE fail on the harness's `inPane` guard
//     with its named reason ("this screen has no ContentPane at all…"), which
//     is the whole-pane regression, not the mis-set-cap one.
//
// ⚠️ "all three" until 2026-08-11, and it went stale IN PLACE: #289 added the
// 768 and 1280 cases, and a count written into a comment does not recompute.
// Re-measured against the real tree — 5 of 5 fail on `inPane`, `flutter
// analyze` held at the 28-issue baseline so the red is an assertion and not a
// compile error. (The first attempt at that mutation WAS a compile error, 36
// issues and a failure at load: the count is what distinguishes them.)
//
// The 1500 case is kept and still named as THE case, because it is the one that
// survives the screen being re-parented under a scaffold that caps at
// extra-large: at 1500 nothing above this screen ever caps anything, at any
// point in any tree it may be mounted in.
//
// ⚠️ THE 768 AND 1280 CASES CANNOT GO RED WITH THE PANE DELETED, and they are
// here anyway. 768 is below the cap and 1280 is exactly on it, so both hold
// either way — they pin the NO-OP BOUNDARY, i.e. that the cap never engages
// early and never tightens a window it was not meant to. The falsifiable pair
// is 1920 and 1500 above. This file shipped with neither of them, and the
// coverage guard could not see the hole because it only asked whether a width
// test existed, not which windows it pumped; `assert-responsive-coverage.mjs`
// now reads the widths themselves.
//
// ⚠️ `pumpAt` PINS LAYOUT CONSTRAINTS, NOT `MediaQuery` — see its doc. Every
// assertion in this file is constraint-derived (`offeredWidth`) and
// `home_screen.dart` reads `MediaQuery` nowhere, so that is sufficient here.
// Anything added below that asserts on a `MediaQuery`-derived number must pin
// `tester.view.physicalSize` and `devicePixelRatio` as well, with their own
// teardown — otherwise it measures the untouched 800×600 test view at every
// surface above.
//
// ⚠️ NO TAP CASES IN THIS FILE, and the reason is not style. `pumpAt` builds a
// bare `MaterialApp` with no router, and this screen's callbacks call
// `context.go('/settings')`, `context.push('/notifications')`,
// `context.push('/sub/<id>')` and `context.go('/insights')`. Building is safe —
// go_router is only touched on tap — but a tap here would throw "no GoRouter
// found in context", which reads like a layout failure and is not one.
// Navigation belongs in the smoke/router legs, which have a real router.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/features/home/home_screen.dart';

import 'support/width_harness.dart';

void main() {
  // ── HOME · ContentPane (kMaxBodyWidth, 1280) ───────────────────────────────
  //
  // Home was NOT in `responsive_width_test.dart`'s original three because before
  // the P2.6b merge it was the chassis placeholder — a centred Column that
  // shrink-wraps, i.e. exactly the case the harness header says `getSize` cannot
  // measure. After the merge it is the widest content in the app: a hero card
  // and a list of `RowCard`s, each of which fills whatever it is offered.
  group('home is capped at the body width', () {
    testWidgets('at 375 the cap is a no-op and nothing overflows', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const HomeScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        375,
        reason:
            'below the cap a ConstrainedBox may only tighten within what it '
            'was handed, so a phone must render exactly as it did before the '
            'pane existed. The 18px gutters are the ListView\'s OWN padding, '
            'inside the pane, so they do not come off this number',
      );
      // The hero card's two `_statBox`es are a `Row` of `Expanded`s, the pills
      // are a `Wrap`, and every `RowCard` puts a glyph, two lines of copy and a
      // price on one line. 375 is where any of them would first complain.
      expect(
        tester.takeException(),
        isNull,
        reason:
            'the hero card, the stat row and every RowCard must lay out clean '
            'on the narrowest phone',
      );
    });

    testWidgets('at 768 the cap is still a no-op', (WidgetTester tester) async {
      await pumpAt(tester, kTablet, const HomeScreen());
      expect(offeredWidth(tester, inPane(ListView)), 768);
    });

    testWidgets('at 1280 the list is at the cap', (WidgetTester tester) async {
      await pumpAt(tester, kDesktop, const HomeScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        lessThanOrEqualTo(AppBreakpoints.kMaxBodyWidth),
      );
    });

    // 🔴 A CASE THAT CAN ACTUALLY GO RED — see the file header for why the
    // draft expected this one to be a no-op and why, under variant B, it is not.
    testWidgets('at 1920 the list stops at AppBreakpoints.kMaxBodyWidth', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kWide, const HomeScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.kMaxBodyWidth,
        reason:
            'an ultra-wide window is where an uncapped dashboard is at its '
            'worst: one hero card 1920px across, and RowCards with the glyph '
            'at one edge and the price at the other',
      );
      expect(AppBreakpoints.kMaxBodyWidth, 1280);
    });

    // 🔴 AND THE ONE THE OTHER `kMaxBodyWidth` SCREENS DO NOT NEED. `AppScaffold`
    // caps the body only in its EXTRA-LARGE class (>= 1600); in LARGE (1200–1599)
    // it caps nothing. So on an ordinary maximised 1440p window this screen's own
    // `ContentPane` is the ONLY thing standing between a RowCard and the full
    // width — and it stays the only thing however this screen is re-parented,
    // which is what makes this case the durable assertion and 1920 the one that
    // depends on who is above it.
    testWidgets('at 1500 the shell caps nothing, so the pane must', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, const Size(1500, 1000), const HomeScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        lessThanOrEqualTo(AppBreakpoints.kMaxBodyWidth),
        reason:
            '1500 sits in AppScaffold\'s LARGE class, which applies no body '
            'cap at all — so a green here is the pane\'s doing and nobody '
            'else\'s',
      );
    });
  });
}
