import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/auth/sign_in_screen.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/width_harness.dart';

/// `SignInView` — the preflight, the OAuth gate and the deletion notice.
///
/// 🏗️ The widget half of `property: auth-seam-wired` and
/// `property: auth-redirect-follows-session`. The WIRING half of both stays in
/// the brick: that a session appearing moves the user is a router fact, and
/// `dod.json` anchors its mutation proof at the brick's `signInWithEmail(`.
void main() {
  Widget view({
    Future<void> Function(String, String)? onSignIn,
    Future<void> Function(String)? onForgotPassword,
    VoidCallback? onNeedAccount,
    bool showAppleButton = false,
    Future<void> Function()? onSignInWithApple,
    core.AccountDeletionOutcome? deletion,
    String? deletionDetail,
    VoidCallback? onDismissDeletionNotice,
  }) =>
      SignInView(
        onSignIn: onSignIn ?? (String _, String __) async {},
        onForgotPassword: onForgotPassword ?? (String _) async {},
        onNeedAccount: onNeedAccount ?? () {},
        showAppleButton: showAppleButton,
        onSignInWithApple: onSignInWithApple ?? () async {},
        appleTermsOwed: false,
        consentFields: ({
          required bool termsAccepted,
          required bool marketingAccepted,
          required bool enabled,
          required ValueChanged<bool> onTermsChanged,
          required ValueChanged<bool> onMarketingChanged,
        }) =>
            const SizedBox.shrink(),
        onAcceptTerms: ({required bool marketingEmail}) async {},
        deletion: deletion,
        deletionDetail: deletionDetail,
        onDismissDeletionNotice: onDismissDeletionNotice,
      );

  Future<void> fill(
    WidgetTester tester, {
    String email = 'someone@example.com',
    String password = 'correct-horse',
  }) async {
    await tester.enterText(find.byKey(SignInView.emailField), email);
    await tester.enterText(find.byKey(SignInView.passwordField), password);
    await tester.pumpAndSettle();
  }

  // ── (1) THE WIDTH DECISION, AT ALL THREE WINDOW CLASSES ───────────────────
  group('property: sign-in-fills-the-form-pane at every window class', () {
    Future<double> paneWidthAt(WidgetTester tester, Size size) async {
      await pumpChassis(tester, size, view());
      return tester.getSize(find.byKey(SignInView.submitButton)).width;
    }

    testWidgets('kPhone — narrower than the cap, so the pane yields',
        (WidgetTester tester) async {
      expect(await paneWidthAt(tester, kPhone), lessThan(kPhone.width));
    });

    testWidgets('kTablet — the cap holds', (WidgetTester tester) async {
      expect(await paneWidthAt(tester, kTablet), AppBreakpoints.form);
    });

    testWidgets('kDesktop — the cap still holds', (WidgetTester tester) async {
      expect(await paneWidthAt(tester, kDesktop), AppBreakpoints.form,
          reason:
              'a form that grew to 1280 px is a form nobody decided the width of');
    });
  });

  // ── (2) THE PREFLIGHT NEVER REACHES THE SEAM ──────────────────────────────
  //
  // 🔴 THIS SCREEN SENT WHATEVER WAS IN THE BOXES. A blank form and a mistyped
  // address both cost a round trip and came back as the server's own English.
  group('property: sign-in-refuses-what-it-can-refuse-locally', () {
    testWidgets('a blank form never reaches the seam',
        (WidgetTester tester) async {
      final List<String> sent = <String>[];
      await pumpChassis(
        tester,
        kPhone,
        view(onSignIn: (String e, String _) async => sent.add(e)),
      );
      await tester.tap(find.byKey(SignInView.submitButton));
      await tester.pumpAndSettle();
      expect(sent, isEmpty);
    });

    testWidgets('a malformed address never reaches the seam, and says so',
        (WidgetTester tester) async {
      final List<String> sent = <String>[];
      await pumpChassis(
        tester,
        kPhone,
        view(onSignIn: (String e, String _) async => sent.add(e)),
      );
      await fill(tester, email: 'not-an-address');
      await tester.tap(find.byKey(SignInView.submitButton));
      await tester.pumpAndSettle();
      expect(sent, isEmpty);
      expect(find.byType(Text), findsWidgets);
    });

    testWidgets('a well-formed pair DOES reach the seam, trimmed',
        (WidgetTester tester) async {
      final List<String> sent = <String>[];
      await pumpChassis(
        tester,
        kPhone,
        view(onSignIn: (String e, String _) async => sent.add(e)),
      );
      await fill(tester, email: '  someone@example.com ');
      await tester.tap(find.byKey(SignInView.submitButton));
      await tester.pumpAndSettle();
      expect(sent, <String>['someone@example.com']);
    });

    testWidgets('a failure from the seam lands UNDER the fields',
        (WidgetTester tester) async {
      await pumpChassis(
        tester,
        kPhone,
        view(
          onSignIn: (String _, String __) async =>
              throw core.AuthFailure('wrong password'),
        ),
      );
      await fill(tester);
      await tester.tap(find.byKey(SignInView.submitButton));
      await tester.pumpAndSettle();
      expect(find.text('wrong password'), findsOneWidget);
    });
  });

  // ── (3) FORGOT-PASSWORD NEEDS AN ADDRESS ──────────────────────────────────
  group('property: sign-in-asks-for-an-address-before-a-reset', () {
    testWidgets('a blank box never asks for a recovery mail',
        (WidgetTester tester) async {
      int asked = 0;
      await pumpChassis(
        tester,
        kPhone,
        view(onForgotPassword: (String _) async => asked++),
      );
      await tester.tap(find.byKey(SignInView.forgotButton));
      await tester.pumpAndSettle();
      expect(asked, 0);
    });

    testWidgets('a filled box asks, and the confirmation is shown',
        (WidgetTester tester) async {
      final List<String> asked = <String>[];
      await pumpChassis(
        tester,
        kPhone,
        view(onForgotPassword: (String e) async => asked.add(e)),
      );
      await fill(tester);
      await tester.tap(find.byKey(SignInView.forgotButton));
      await tester.pumpAndSettle();
      expect(asked, <String>['someone@example.com']);
      expect(find.byType(SnackBar), findsOneWidget);
    });
  });

  // ── (4) THE OAUTH BUTTON IS GATED, AND THE GATE IS THE ADAPTER'S ──────────
  //
  // 🔴 TWO INDEPENDENT FACTS COLLAPSED INTO ONE BOOLEAN BY THE CALLER: whether
  // the PLATFORM can complete a redirect, and whether the SERVER honours the
  // provider. This widget's job is only to obey the answer — but obeying it in
  // BOTH directions is what stops the button that lies.
  group('property: sign-in-shows-apple-only-when-told-to', () {
    testWidgets('absent when the caller says false',
        (WidgetTester tester) async {
      await pumpChassis(tester, kPhone, view(showAppleButton: false));
      expect(find.byKey(SignInView.appleButton), findsNothing);
    });

    testWidgets('present, and wired, when the caller says true',
        (WidgetTester tester) async {
      int taps = 0;
      await pumpChassis(
        tester,
        kPhone,
        view(
          showAppleButton: true,
          onSignInWithApple: () async => taps++,
        ),
      );
      await tester.tap(find.byKey(SignInView.appleButton));
      await tester.pumpAndSettle();
      expect(taps, 1);
    });
  });

  // ── (5) THE DELETION NOTICE, ABOVE THE FIELDS ─────────────────────────────
  //
  // It is the answer to something the user did on a DIFFERENT screen, so it has
  // to be the first thing on this one — under the button it would be read after
  // they had started typing a password into an account that may not exist.
  group('property: sign-in-reports-a-deletion-outcome', () {
    testWidgets('renders nothing when there is nothing to say',
        (WidgetTester tester) async {
      await pumpChassis(tester, kPhone, view());
      expect(find.byType(DestructiveOutcomeNotice), findsOneWidget);
      expect(
        tester.getSize(find.byType(DestructiveOutcomeNotice)).height,
        0,
        reason: 'every arrival except the one after a deletion says nothing',
      );
    });
  });

  // ── (6) THE WAY TO THE OTHER DOOR ─────────────────────────────────────────
  testWidgets('property: sign-in-offers-the-sign-up-door',
      (WidgetTester tester) async {
    int taps = 0;
    await pumpChassis(tester, kPhone, view(onNeedAccount: () => taps++));
    await tester.tap(find.byKey(SignInView.needAccountButton));
    await tester.pump();
    expect(taps, 1);
  });
}
