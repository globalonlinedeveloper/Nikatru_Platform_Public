// ─────────────────────────────────────────────────────────────────────────────
// WIDTH — THE ROUTED ONBOARDING CAROUSEL (`/onboarding`), ContentPane.reading.
//
// 🔴 THIS IS THE OTHER ONBOARDING SCREEN. `responsive_width_test.dart:33-88`
// measures `features/firstrun/onboarding_screen.dart` — the STAMPED twin, the
// one every app the factory produces inherits. The screen measured here is
// `features/onboarding/onboarding_screen.dart`, Subly's own carousel, and it is
// the one the router actually shows: `core/router.dart` sends a fresh install to
// this widget, and `chassis_properties_test.dart`'s onboarding-shown-once
// property asserts against it. So until this file existed, the screen with the
// width cap had no user and the screen with the user had no width cap.
//
// The arithmetic is `.reading`'s, and it is NOT the sibling file's arithmetic
// even though both screens are capped at 720: the gutters here are 30/30, not
// 32/32, because that is the padding this screen already had. Copying `- 64`
// across from the neighbouring file would be off by four pixels in a way no
// reader would question.
//
// 🔴 AND THE PAD IS INSIDE THE CAP, WHICH IS WHY 768 IS THE FALSIFYING CASE.
// `ContentPane.reading(padding: …)` applies the inset within `maxWidth`, so
// above 720 the 30/30 comes out of the CAP (720 - 60 = 660) and below it out of
// the SURFACE (375 - 60 = 315). Strip the pane out of the screen and the 768
// case reads 708 on the spot — no 1920 surface needed, unlike the
// `kMaxBodyWidth` groups in `responsive_width_test.dart`. Verified by doing
// exactly that (negative test, 2026-08-09).
//
// 📐 The rig is `test/support/width_harness.dart`; its header is the primary
// record for why the assertion is on incoming `constraints` and never on `size`
// — a shrink-wrapping `Column` of centred text would make a `size` assertion
// pass with the cap deleted, and go on passing until somebody shipped a longer
// sentence. That trap is live here: this carousel's copy comes from the arb, so
// a `size` assertion could be disarmed by editing a translation.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/features/onboarding/onboarding_screen.dart';

import 'support/width_harness.dart';

/// The 30/30 gutters this screen already had, now applied inside the cap.
const double kGutters = 60;

void main() {
  group('the routed onboarding carousel is capped at reading width', () {
    testWidgets('at 375 the cap is a no-op and nothing overflows', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const OnboardingScreen());
      expect(
        offeredWidth(tester, inPane(Column)),
        375 - kGutters,
        reason:
            'below the cap a ConstrainedBox may only tighten within what it '
            'was handed, so a phone must render exactly as it did before the '
            'pane existed — 375 less the 30/30 gutters that were already there',
      );
      expect(
        tester.takeException(),
        isNull,
        reason:
            'the blobs, the PageView and the scale-safe ConstrainedBox must lay '
            'out clean on the narrowest phone',
      );
    });

    // ⚠️ 768 IS ALREADY PAST THE CAP. `AppBreakpoints.reading - 60`, NOT
    // `768 - 60`: 720 < 768, so a small tablet is the FIRST of these widths at
    // which this screen stops growing, and the gutters come out of the cap
    // rather than out of the surface. Writing `768 - 60` here — copying the
    // shape of the phone case above, which really is `375 - 60` — is the exact
    // mistake `responsive_width_test.dart:53-59` exists to warn the next reader
    // off, and this is the case that goes red when the pane is deleted.
    testWidgets('at 768 the reading cap has ALREADY engaged', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kTablet, const OnboardingScreen());
      expect(
        offeredWidth(tester, inPane(Column)),
        AppBreakpoints.reading - kGutters,
        reason:
            'a tablet is wider than 720, so this is the width at which the '
            'pane starts mattering — and the width at which deleting it goes '
            'red without needing a 1920 surface',
      );
    });

    testWidgets('at 1280 the carousel is capped at AppBreakpoints.reading', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kDesktop, const OnboardingScreen());
      expect(
        offeredWidth(tester, inPane(Column)),
        lessThanOrEqualTo(AppBreakpoints.reading),
        reason:
            'unconstrained this ran 1220 px lines — about 200 characters, '
            'against the 45–75 the eye can track — and stretched the Skip/Next '
            'row from one edge of the display to the other',
      );
      expect(AppBreakpoints.reading, 720);
    });

    // The half a per-page cap would have missed. The dots row, the Skip/Next
    // row and the wordmark share the carousel's padding, so capping only the
    // PageView's pages (which is what the stamped twin does, because its
    // controls sit outside that padding) would leave a 720 px slide sitting
    // under a 1280 px button. Measured through a widget that is NOT inside the
    // PageView.
    testWidgets('the controls below the pages are capped too', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kDesktop, const OnboardingScreen());
      final Finder skipRow = find
          .ancestor(of: find.byType(FilledButton), matching: find.byType(Row))
          .first;
      expect(
        offeredWidth(tester, skipRow),
        lessThanOrEqualTo(AppBreakpoints.reading),
        reason:
            'the Skip/Next row is outside the PageView, so a cap applied per '
            'page would leave it spanning the whole window',
      );
    });
  });
}
