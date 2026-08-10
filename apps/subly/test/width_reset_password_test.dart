// ─────────────────────────────────────────────────────────────────────────────
// THE RESET-PASSWORD SCREEN · WIDTH — `ContentPane.form` (420).
//
// `/reset-password` is a new routed surface, and `assert-responsive-coverage.mjs`
// fails the build the moment a route exists with nothing measuring it. That is
// the guard working: "the content grew to fill a 1920 px display" throws no
// exception, clips no pixel and fails no other assertion, so a routed pane with
// no width test is an unpoliced one.
//
// 🔴 THE ARITHMETIC IS SIGN-UP'S, NOT SCAN'S — read `width_auth_test.dart`'s
// header before adding a case. The 24/24 gutters live on the
// `SingleChildScrollView` that WRAPS the pane, so they come out of the SURFACE
// before the cap is consulted:
//
//   · at 375 the surface binds  → the pane's child is offered `375 - 48` = 327;
//   · at 768 the CAP binds      → `AppBreakpoints.form` FLAT — 420, not 372.
//
// 🔴 THE FORM STATE HAS TO BE FORCED, AND THAT IS THE ONE THING THIS FILE DOES
// DIFFERENTLY FROM ITS SIBLINGS. Unoverridden, `authRepositoryProvider` resolves
// the demo repository with nobody signed in — and this screen's whole point is
// that no session means the DEAD-LINK state, which is two sentences and one
// button. Measuring that would be measuring the wrong widget: the composition a
// cap has to bound here is two stacked fields, an error slot and two buttons.
// Signing the repository in first is what puts the form on screen.
//
// Negative-tested against the real tree, 2026-08-11 — `ContentPane.form(` →
// `ContentPane(` (the default 1280 cap) in `reset_password_screen.dart`, with
// `flutter analyze` re-run at the 29-issue baseline so the red is a failed
// assertion and not a compile error. The run's output is quoted in this
// increment's report; restored and green after.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show InMemoryAuthRepository;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/features/auth/reset_password_screen.dart';
import 'package:subly/state/providers.dart';

import 'support/width_harness.dart';

void main() {
  late InMemoryAuthRepository auth;

  /// A repository holding a session, so the screen renders its FORM rather than
  /// the dead-link explanation. See the header.
  Future<List<Override>> signedIn() async {
    auth = InMemoryAuthRepository();
    addTearDown(auth.dispose);
    await auth.signInWithEmail(email: 'a@b.test', password: 'pw');
    return <Override>[authRepositoryProvider.overrideWithValue(auth)];
  }

  group('the reset-password form is capped at form width', () {
    testWidgets('at 375 the cap is a no-op and nothing overflows', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        const ResetPasswordScreen(),
        overrides: await signedIn(),
      );
      expect(
        find.byKey(ResetPasswordScreen.passwordField),
        findsOneWidget,
        reason:
            'the SUBJECT check. Without a session this screen renders the '
            'dead-link state, and every measurement below would be of two '
            'sentences and a button instead of the form',
      );
      expect(offeredWidth(tester, inPane(Column)), 375 - 48);
      expect(
        tester.takeException(),
        isNull,
        reason:
            'two obscured fields, an error slot and two stacked buttons must '
            'lay out clean on the narrowest phone — this is the width at which '
            'a stretched CrossAxisAlignment would complain',
      );
    });

    testWidgets('at 768 the form cap has ALREADY engaged', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kTablet,
        const ResetPasswordScreen(),
        overrides: await signedIn(),
      );
      expect(
        offeredWidth(tester, inPane(Column)),
        AppBreakpoints.form,
        reason:
            'the cheaply falsifiable case: delete the ContentPane.form and the '
            'Column is offered 768 - 48 = 720 here. No 1920 surface needed, '
            'because 420 < 768',
      );
    });

    testWidgets('at 1280 it is still 420, not a desktop-wide row', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kDesktop,
        const ResetPasswordScreen(),
        overrides: await signedIn(),
      );
      expect(
        offeredWidth(tester, inPane(Column)),
        lessThanOrEqualTo(AppBreakpoints.form),
        reason:
            'a password field as wide as a desktop window puts its label and '
            'its box far enough apart that the eye has to travel — the reason '
            'AppBreakpoints.form is 420 at all',
      );
      expect(AppBreakpoints.form, 420);
    });
  });

  // The other state is a routed surface too, and it is the one a user reaches
  // most often. It has no fields to stretch, but it carries the longest sentence
  // on the screen — which is exactly what a missing cap would run edge to edge.
  testWidgets('the DEAD-LINK state is capped too', (WidgetTester tester) async {
    await pumpAt(tester, kTablet, const ResetPasswordScreen());
    expect(
      find.byKey(ResetPasswordScreen.linkDeadLine),
      findsOneWidget,
      reason:
          'no session and no recovery in flight — the state an expired, reused '
          'or wrong-device link produces',
    );
    expect(offeredWidth(tester, inPane(Column)), AppBreakpoints.form);
  });
}
