// ─────────────────────────────────────────────────────────────────────────────
// AUTH · WIDTH — sign-up, `ContentPane.form` (420).
//
// The screen carried a private `ConstrainedBox(maxWidth: 420)` before
// `AppBreakpoints.form` existed (`app_scaffold.dart:64-69` names it among the
// six hand-copied 420s), and it now takes the number from the chassis. Nothing
// in the repository asserted on it: strip the pane out and every test stayed
// green. This file is that assertion.
//
// 🔴 THIS FILE COVERED TWO SCREENS UNTIL 2026-08-10, AND THE OTHER ONE IS GONE.
// `/sign-in` became the canonical auth route that day and it builds the LIVE
// `LoginScreen` (measured by `width_login_test.dart`), so the stamped
// `SignInScreen` twin was left with no route and was removed rather than kept
// as a pane no user can open. Its three cases went with it — a width test whose
// subject nothing routes to is the DEAD COVERAGE `assert-responsive-coverage`
// exists to fail on, and it is worse than no test because it makes the gap
// invisible. What remains is sign-up, unchanged and still able to regress alone.
//
// Everything structural — why the assertion is on incoming `BoxConstraints`
// rather than on `getSize`, why every case pins the surface — lives in
// `support/width_harness.dart`. Read that header before adding a case here.
//
// 🔴 THE ARITHMETIC, AND IT IS NOT THE SCAN SCREEN'S.
// `width_scan_test.dart` asserts `AppBreakpoints.reading - 48` because there the
// 24/24 gutters are the pane's OWN `padding:`, applied INSIDE the cap. Here they
// are not: the padding lives on the `SingleChildScrollView` that WRAPS the pane
// (`sign_up_screen.dart:69`), so it comes out of the SURFACE before the cap is
// ever consulted. Two consequences, and they pull in opposite directions:
//
//   · at 375 the surface binds  → the form is offered `375 - 48` = 327;
//   · at 768 the CAP binds      → the form is offered `AppBreakpoints.form`
//                                 FLAT — 420, not 372.
//
// Writing `AppBreakpoints.form - 48` in the 768 case would be the mirror image
// of the mistake `responsive_width_test.dart:161-167` warns about, and it would
// be a mistake that still LOOKS like the scan file. The number below was
// measured, not derived by analogy.
//
// 🔴 AND THAT IS WHY THIS FILE IS FALSIFIABLE CHEAPLY. 420 < 768, so the cap has
// ALREADY engaged on a small tablet: widen `ContentPane.form` and the 768 case
// goes red on the spot. No 1920 surface required, unlike the `kMaxBodyWidth`
// screens whose cap IS the ordinary desktop width.
//
// Negative-tested against the real tree, 2026-08-09 — `ContentPane.form(` →
// `ContentPane(` (the default 1280 cap), `flutter analyze` clean at the
// 29-issue baseline, so the red is not a compile error: sign-up 768
// `Expected <420.0> Actual <720.0>`, sign-up 1280 `<1232.0> is not <= <420.0>`,
// sign-up 375 green (the no-op case, and it is not supposed to be able to fail).
//
// ⚠️ NO TAP CASES. The footer button calls `context.go('/sign-in')`, and
// `pumpAt` builds a bare `MaterialApp` with no router — a tap would throw "no
// GoRouter found in context", which reads like a layout failure and is not one.
// Building never touches go_router.
//
// ⚠️ `authRepositoryProvider` IS DELIBERATELY LEFT ALONE. Unoverridden it
// resolves the demo `InMemory` repository, which is the state a real signed-out
// user is in — and the one where every control the cap has to bound (both
// fields, the filled button, the text button) is actually on screen.
// Overriding it with a fake would buy nothing and could only take controls away.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/features/auth/sign_up_screen.dart';

import 'support/width_harness.dart';

void main() {
  // ── SIGN-UP · ContentPane.form (420) ───────────────────────────────────────
  group('sign-up is capped at form width', () {
    testWidgets('at 375 the cap is a no-op and nothing overflows', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const SignUpScreen());
      expect(
        offeredWidth(tester, inPane(Column)),
        375 - 48,
        reason:
            'below the cap a ConstrainedBox may only tighten within what it '
            'was handed, so a phone must render exactly as it did before the '
            'pane existed — 375 less the 24/24 padding of the '
            'SingleChildScrollView that wraps the pane',
      );
      expect(
        tester.takeException(),
        isNull,
        reason:
            'the fields, the error slot and both buttons must lay out clean '
            'on the narrowest phone — this is the width at which a stretched '
            'CrossAxisAlignment would complain',
      );
    });

    // ⚠️ 768 IS ALREADY PAST THE CAP, and the number is `AppBreakpoints.form`
    // FLAT — see the file header for why there is no `- 48` here even though
    // there is one in the case above. This is the case a deleted pane reddens
    // without a 1920 surface.
    testWidgets('at 768 the form cap has ALREADY engaged', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kTablet, const SignUpScreen());
      expect(
        offeredWidth(tester, inPane(Column)),
        AppBreakpoints.form,
        reason:
            'the falsifiable case for this screen: delete its ContentPane.form '
            'and the Column is offered 768 - 48 = 720 here',
      );
    });

    testWidgets('at 1280 the form is still 420, not a desktop-wide row', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kDesktop, const SignUpScreen());
      expect(
        offeredWidth(tester, inPane(Column)),
        lessThanOrEqualTo(AppBreakpoints.form),
        reason:
            'a sign-up form as wide as a desktop window puts the label and '
            'its field far enough apart that the eye has to travel between '
            'them — the reason AppBreakpoints.form is 420 at all',
      );
      expect(AppBreakpoints.form, 420);
    });
  });
}
