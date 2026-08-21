// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS · WIDTH — the cap that BINDS, and the surfaces that prove it.
//
// This file replaces the `settings is capped at the body width` group in
// `test/responsive_width_test.dart`, and the replacement is not tidying. That
// group asserted `AppBreakpoints.kMaxBodyWidth` (1280) at 1920, and it was
// green for a cap that could never engage: measured 2026-08-21, `AppScaffold`
// hands its body `min(W - 361, 1280)` — a 360 px drawer plus its 1 px divider
// take the width first — so a maximised 1440 px desktop offers this screen
// 1079 px and 1280 is never reached at any real desktop size.
// `settings_screen.dart` now caps at [AppBreakpoints.reading] (720); the
// argument for 720 rather than 840 or 960 is written on the `ContentPane.reading`
// call itself, because that is where somebody will go to change it.
//
// 📐 THE RIG LIVES IN `test/support/width_harness.dart` and its header is the
// primary record for the three rules every case here obeys: the assertion is on
// incoming `constraints`, never on `size`; every case PINS the surface; and a
// case that cannot fail is worse than no case at all.
//
// 🔴 THE ONE RULE THIS FILE READS DIFFERENTLY FROM THE REST. The harness header
// says "the distinguishing surface for a `kMaxBodyWidth` screen is 1920, not
// 1280 — at 1280 the assertion is true whether or not the pane is there". That
// is an argument about the DEFAULT cap, not about this screen: at 720 the pane
// is falsifiable from 721 px upward, so [kTablet] (768) and [kDesktop] (1280)
// are real cases here rather than no-ops. The no-op boundary moves down with
// the cap, which is why the boundary case below pins 720 exactly, not 768.
//
// ⚠️ AND THE CASE THAT ONLY EXISTS BECAUSE OF THE MEASUREMENT ABOVE: [kShell],
// 1079. That is the width this screen is ACTUALLY handed on the commonest
// desktop window there is, and it is the width at which the previous cap was
// provably inert. A width test for this screen that pumps only 1920 measures a
// window almost nobody has and skips the one everybody does.
//
// ⚠️ NO TAP CASES HERE. `pumpAt` builds a bare `MaterialApp` with no router and
// this screen's rows call `context.go(...)`; building is safe because go_router
// is only touched on tap, but a tap would throw "no GoRouter found in context",
// which reads like a layout failure and is not one.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/features/settings/settings_screen.dart';

import 'support/width_harness.dart';

/// The body width `AppScaffold` hands a branch on a maximised 1440 px desktop:
/// `min(1440 - 361, 1280)`. Named, because a bare `1079` in a `Size` reads as
/// an arbitrary number and it is the opposite of one.
const Size kShell = Size(1079, 900);

/// Exactly the cap — the no-op boundary. See the file header for why it is here
/// and not at [kTablet].
const Size kAtCap = Size(720, 900);

void main() {
  group('settings is capped at the reading width', () {
    testWidgets('at 375 the cap is a no-op and nothing overflows', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const SettingsScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        375,
        reason:
            'below the cap a ConstrainedBox may only tighten within what it '
            'was handed, so a phone must render exactly as it did before the '
            'cap moved. The 18px gutters are the ListView OWN padding, inside '
            'the pane, so they do not come off this number',
      );
      // The currency strip is a `Row` of four `Expanded` chips and every
      // `_LinkRow` puts a glyph, a label and a chevron on one line. 375 is
      // where any of them would first complain.
      expect(
        tester.takeException(),
        isNull,
        reason:
            'the currency strip, the toggle rows and every _LinkRow must lay '
            'out clean on the narrowest phone',
      );
    });

    testWidgets('at 720 the cap is exactly a no-op', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kAtCap, const SettingsScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.reading,
        reason:
            'the boundary: a cap must not engage EARLY. A pixel of tightening '
            'here would mean the pane is subtracting something of its own — a '
            'stray inset, a wrong constant — rather than capping',
      );
    });

    // 🔴 A CASE THAT CAN ACTUALLY GO RED, and one the old cap could not have
    // had: 768 is below `kMaxBodyWidth`, so the group this file replaces
    // asserted a no-op here.
    testWidgets('at 768 the cap already binds', (WidgetTester tester) async {
      await pumpAt(tester, kTablet, const SettingsScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.reading,
        reason:
            'a small tablet is the FIRST window where this screen stops being '
            'a phone column, and it is where the cap has to start working',
      );
    });

    // 🔴 THE CASE THIS FILE EXISTS FOR — see the file header.
    testWidgets('at the real desktop body width (1079) the cap binds', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kShell, const SettingsScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.reading,
        reason:
            '1079 is what AppScaffold hands this branch on a maximised 1440 '
            'display, and it is the width at which the previous 1280 cap was '
            'provably inert: every row spread its glyph to one edge and its '
            'chevron to the other with a thousand pixels of nothing between',
      );
      expect(
        AppBreakpoints.reading,
        lessThan(kShell.width),
        reason:
            'if the cap is ever raised above 1079 this case silently stops '
            'being able to fail — which is the exact defect it was written to '
            'replace, so it must go red HERE and say so',
      );
    });

    testWidgets('at 1280 it is still the reading width, not the body width', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kDesktop, const SettingsScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.reading,
        reason:
            'the regression this guards is somebody restoring the default '
            'ContentPane() — at 1280 that reads as green under a '
            'lessThanOrEqualTo(kMaxBodyWidth) assertion and is still wrong',
      );
    });

    testWidgets('at 1920 the list stops at AppBreakpoints.reading', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kWide, const SettingsScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.reading,
        reason:
            'without a binding cap every ListTile here stretches the full '
            'display: the leading icon at one edge, the trailing chevron at '
            'the other, and the eye travelling between them for every row',
      );
      // Pins the constant itself, so a change to `AppBreakpoints.reading` in
      // the design system cannot silently redefine what this whole file means.
      expect(AppBreakpoints.reading, 720);
    });
  });
}
