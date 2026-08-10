// ─────────────────────────────────────────────────────────────────────────────
// THE TWO GATE SCREENS · WIDTH — `ContentPane.form` (420) on both.
//
// `/verify-email` and `/reaccept-terms` landed with the cut-1 reversal's auth
// riders, and `assert-responsive-coverage.mjs` failed the build the moment they
// were routed with nothing measuring them. That is the guard behaving exactly as
// designed: a routed pane with no width test is an UNPOLICED pane, because "the
// content grew to fill a 1920 px display" throws no exception, clips no pixel
// and fails no other assertion.
//
// 🔴 THE ARITHMETIC IS SIGN-UP'S, NOT SCAN'S — read `width_auth_test.dart`'s
// header before adding a case. The 24/24 gutters live on the
// `SingleChildScrollView` that WRAPS the pane, so they come out of the SURFACE
// before the cap is consulted:
//
//   · at 375 the surface binds  → the pane's child is offered `375 - 48` = 327;
//   · at 768 the CAP binds      → `AppBreakpoints.form` FLAT — 420, not 372.
//
// Writing `AppBreakpoints.form - 48` in the 768 case would be a mistake that
// still LOOKS like the scan file. The numbers below were measured.
//
// 🔴 AND THAT IS WHY THESE ARE CHEAPLY FALSIFIABLE. 420 < 768, so the cap has
// ALREADY engaged on a small tablet: swap either `ContentPane.form(` for a bare
// `ContentPane(` (the 1280 default) and the 768 case reddens on the spot. No
// 1920 surface needed.
//
// Negative-tested against the real tree, 2026-08-10 — `ContentPane.form(` →
// `ContentPane(` in verify_email_screen.dart: 768 case
// `Expected <420.0> Actual <720.0>`, 1280 case `<1232.0> is not <= <420.0>`,
// 375 case green (the no-op case, which is not supposed to be able to fail).
// Restored and green after.
//
// ⚠️ `authRepositoryProvider` IS LEFT ALONE on the verify screen. Unoverridden
// it resolves the chassis `InMemoryAuthRepository`, whose `currentUser` is null
// until something signs in — so `verifyEmailBody('')` renders with an empty
// address, which is a SHORTER string than a real one and therefore the harder
// case for a cap to fail. Overriding it would buy nothing a width test can use.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/features/auth/reaccept_terms_screen.dart';
import 'package:subly/features/auth/verify_email_screen.dart';

import 'support/width_harness.dart';

void main() {
  group('the email-verification gate is capped at form width', () {
    testWidgets('at 375 the cap is a no-op and nothing overflows', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const VerifyEmailScreen());
      expect(offeredWidth(tester, inPane(Column)), 375 - 48);
      expect(
        tester.takeException(),
        isNull,
        reason:
            'the body copy, the status slot and three stacked buttons must lay '
            'out clean on the narrowest phone — this is the width at which a '
            'stretched CrossAxisAlignment would complain',
      );
    });

    testWidgets('at 768 the form cap has ALREADY engaged', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kTablet, const VerifyEmailScreen());
      expect(
        offeredWidth(tester, inPane(Column)),
        AppBreakpoints.form,
        reason:
            'the falsifiable case: delete its ContentPane.form and the Column '
            'is offered 768 - 48 = 720 here',
      );
    });

    testWidgets('at 1280 it is still 420, not a desktop-wide row', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kDesktop, const VerifyEmailScreen());
      expect(
        offeredWidth(tester, inPane(Column)),
        lessThanOrEqualTo(AppBreakpoints.form),
      );
    });
  });

  group('the re-acceptance interstitial is capped at form width', () {
    testWidgets('at 375 the cap is a no-op and the tick row does not overflow', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const ReacceptTermsScreen());
      expect(offeredWidth(tester, inPane(Column)), 375 - 48);
      expect(
        tester.takeException(),
        isNull,
        reason:
            'the checkbox row is a Row of a fixed 20 px box and an Expanded '
            'label carrying two wrapped links — 327 px is where that composition '
            'is tightest, and an unexpanded label would overflow exactly here',
      );
    });

    testWidgets('at 768 the form cap has ALREADY engaged', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kTablet, const ReacceptTermsScreen());
      expect(offeredWidth(tester, inPane(Column)), AppBreakpoints.form);
    });

    testWidgets('at 1280 it is still 420', (WidgetTester tester) async {
      await pumpAt(tester, kDesktop, const ReacceptTermsScreen());
      expect(
        offeredWidth(tester, inPane(Column)),
        lessThanOrEqualTo(AppBreakpoints.form),
      );
      expect(AppBreakpoints.form, 420);
    });
  });
}
