import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/auth/legal_consent_fields.dart';
import 'package:nikatru_chassis_screens/auth/sign_up_screen.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/raw_vendor_error.dart';
import 'support/width_harness.dart';

/// `SignUpView` — the clickwrap, and the two ways past a disabled button.
///
/// 🏗️ The widget half of `property: sessionless-signup-reaches-check-inbox`.
/// Where a sessionless sign-up GOES is a router fact and stays in the brick;
/// what leaves this widget, and under what conditions, is here.
void main() {
  Widget view({
    Future<void> Function({
      required String email,
      required String password,
      required bool marketingEmail,
    })? onSignUp,
    VoidCallback? onHaveAccount,
    VoidCallback? onOpenTerms,
    VoidCallback? onOpenPrivacy,
  }) =>
      SignUpView(
        onSignUp: onSignUp ??
            ({
              required String email,
              required String password,
              required bool marketingEmail,
            }) async {},
        onHaveAccount: onHaveAccount ?? () {},
        consentFields: ({
          required bool termsAccepted,
          required bool marketingAccepted,
          required bool enabled,
          required ValueChanged<bool> onTermsChanged,
          required ValueChanged<bool> onMarketingChanged,
        }) =>
            LegalConsentFieldsView(
          termsAccepted: termsAccepted,
          marketingAccepted: marketingAccepted,
          enabled: enabled,
          showMarketing: true,
          onTermsChanged: onTermsChanged,
          onMarketingChanged: onMarketingChanged,
          onOpenTerms: onOpenTerms ?? () {},
          onOpenPrivacy: onOpenPrivacy ?? () {},
        ),
      );

  /// Fills the form and ticks the terms box, which is the only state from which
  /// a sign-up may leave this screen.
  Future<void> complete(
    WidgetTester tester, {
    String email = 'someone@example.com',
    String password = 'correct-horse',
    bool tickTerms = true,
    bool tickMarketing = false,
  }) async {
    await tester.enterText(find.byKey(SignUpView.emailField), email);
    await tester.enterText(find.byKey(SignUpView.passwordField), password);
    if (tickTerms) {
      await tester.tap(find.byKey(LegalConsentFieldsView.termsCheckbox));
    }
    if (tickMarketing) {
      await tester.tap(find.byKey(LegalConsentFieldsView.marketingCheckbox));
    }
    await tester.pumpAndSettle();
  }

  // ── (1) THE WIDTH DECISION, AT ALL THREE WINDOW CLASSES ───────────────────
  group('property: sign-up-fills-the-form-pane at every window class', () {
    Future<double> paneWidthAt(WidgetTester tester, Size size) async {
      await pumpChassis(tester, size, view());
      return tester.getSize(find.byKey(SignUpView.emailField)).width;
    }

    testWidgets('kPhone — narrower than the cap, so the pane yields',
        (WidgetTester tester) async {
      expect(await paneWidthAt(tester, kPhone), lessThan(kPhone.width));
    });

    testWidgets('kTablet — the cap holds', (WidgetTester tester) async {
      expect(await paneWidthAt(tester, kTablet), AppBreakpoints.form);
    });

    testWidgets('kDesktop — the cap still holds', (WidgetTester tester) async {
      expect(await paneWidthAt(tester, kDesktop), AppBreakpoints.form);
    });
  });

  // ── (2) THE CLICKWRAP BLOCKS IN BOTH POSITIONS ────────────────────────────
  //
  // 🔴 A DISABLED BUTTON ALONE IS BYPASSED BY THE KEYBOARD. `onSubmitted:` on
  // the password field reaches the handler directly, and an enter key that
  // walks past a legal gate is still a bypass — which is why the guard demands
  // BOTH the early-return and the disable, and why both are tested.
  group('property: sign-up-is-blocked-until-the-terms-box-is-ticked', () {
    testWidgets('the button is disabled until the box is ticked',
        (WidgetTester tester) async {
      await pumpChassis(tester, kPhone, view());
      expect(
        tester
            .widget<FilledButton>(find.byKey(SignUpView.submitButton))
            .onPressed,
        isNull,
      );
      await complete(tester);
      expect(
        tester
            .widget<FilledButton>(find.byKey(SignUpView.submitButton))
            .onPressed,
        isNotNull,
      );
    });

    testWidgets('the KEYBOARD does not walk past the gate either',
        (WidgetTester tester) async {
      int calls = 0;
      await pumpChassis(
        tester,
        kPhone,
        view(
          onSignUp: ({
            required String email,
            required String password,
            required bool marketingEmail,
          }) async =>
              calls++,
        ),
      );
      await complete(tester, tickTerms: false);
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();
      expect(calls, 0,
          reason: 'onSubmitted reaches the handler directly — the early-return '
              'guard is the half that holds there');
    });
  });

  // ── (3) THE OPTIONAL BOX MAY NOT GATE ─────────────────────────────────────
  //
  // Making a service conditional on a consent that is not necessary for it is
  // GDPR Art 7(4); research/43 declined it as legally unavailable, not as a
  // preference. So sign-up must succeed with the marketing box untouched — and
  // must carry the answer either way.
  group('property: sign-up-never-gates-on-the-marketing-box', () {
    testWidgets('an untouched marketing box still signs up, with false',
        (WidgetTester tester) async {
      final List<bool> marketing = <bool>[];
      await pumpChassis(
        tester,
        kPhone,
        view(
          onSignUp: ({
            required String email,
            required String password,
            required bool marketingEmail,
          }) async =>
              marketing.add(marketingEmail),
        ),
      );
      await complete(tester);
      await tester.tap(find.byKey(SignUpView.submitButton));
      await tester.pumpAndSettle();
      expect(marketing, <bool>[false]);
    });

    testWidgets('a ticked marketing box is carried through as true',
        (WidgetTester tester) async {
      final List<bool> marketing = <bool>[];
      await pumpChassis(
        tester,
        kPhone,
        view(
          onSignUp: ({
            required String email,
            required String password,
            required bool marketingEmail,
          }) async =>
              marketing.add(marketingEmail),
        ),
      );
      await complete(tester, tickMarketing: true);
      await tester.tap(find.byKey(SignUpView.submitButton));
      await tester.pumpAndSettle();
      expect(marketing, <bool>[true]);
    });
  });

  // ── (4) THE SHORT-PASSWORD REFUSAL NEVER LEAVES THE DEVICE ────────────────
  //
  // The server is the authority, but a round trip to be told "too short" is a
  // worse experience than being told before sending.
  group('property: sign-up-refuses-a-short-password-locally', () {
    testWidgets('a 7-character password never reaches the seam',
        (WidgetTester tester) async {
      int calls = 0;
      await pumpChassis(
        tester,
        kPhone,
        view(
          onSignUp: ({
            required String email,
            required String password,
            required bool marketingEmail,
          }) async =>
              calls++,
        ),
      );
      await complete(tester, password: 'short-1');
      await tester.tap(find.byKey(SignUpView.submitButton));
      await tester.pumpAndSettle();
      expect(calls, 0);
    });

    // ⏱ 2026-09-24 — shown MAPPED. This case asserted the server's words
    // appeared verbatim, which is the defect it now rules out.
    testWidgets('a failure from the seam is shown under the fields, mapped',
        (WidgetTester tester) async {
      await pumpChassis(
        tester,
        kPhone,
        view(
          onSignUp: ({
            required String email,
            required String password,
            required bool marketingEmail,
          }) async =>
              throw core.AuthFailure(
            'User already registered',
            code: 'user_already_exists',
          ),
        ),
      );
      await complete(tester);
      await tester.tap(find.byKey(SignUpView.submitButton));
      await tester.pumpAndSettle();
      expect(find.text(_en.authAlreadyRegistered), findsOneWidget);
      expect(find.textContaining('User already registered'), findsNothing);
    });

    // 🔴 THE `'$e'` ARM, and the RED CONTROL for this whole class of defect:
    // restore `_error = '$e'` in `SignUpView` and this case fails.
    testWidgets('a NON-AuthFailure is mapped, never printed',
        (WidgetTester tester) async {
      await pumpChassis(
        tester,
        kPhone,
        view(
          onSignUp: ({
            required String email,
            required String password,
            required bool marketingEmail,
          }) async =>
              throw const RawVendorError(),
        ),
      );
      await complete(tester);
      await tester.tap(find.byKey(SignUpView.submitButton));
      await tester.pumpAndSettle();
      expect(find.textContaining(rawVendorFragment), findsNothing);
      expect(find.text(_en.authCaptchaFailed), findsOneWidget);
    });

    // The LOCAL length refusal, raised before anything is sent. It rides the
    // same mapper as the server's, so it must still read `passwordTooShort`.
    testWidgets('a short password reads passwordTooShort, and sends nothing',
        (WidgetTester tester) async {
      int calls = 0;
      await pumpChassis(
        tester,
        kPhone,
        view(
          onSignUp: ({
            required String email,
            required String password,
            required bool marketingEmail,
          }) async =>
              calls++,
        ),
      );
      await complete(tester, password: 'short');
      await tester.tap(find.byKey(SignUpView.submitButton));
      await tester.pumpAndSettle();
      expect(find.text(_en.passwordTooShort), findsOneWidget);
      expect(find.text(_en.authUnknownError), findsNothing);
      expect(calls, 0);
    });
  });

  // ── (5) THE ADDRESS IS TRIMMED ────────────────────────────────────────────
  testWidgets('property: sign-up-trims-the-address',
      (WidgetTester tester) async {
    final List<String> sent = <String>[];
    await pumpChassis(
      tester,
      kPhone,
      view(
        onSignUp: ({
          required String email,
          required String password,
          required bool marketingEmail,
        }) async =>
            sent.add(email),
      ),
    );
    await complete(tester, email: '  someone@example.com  ');
    await tester.tap(find.byKey(SignUpView.submitButton));
    await tester.pumpAndSettle();
    expect(sent, <String>['someone@example.com']);
  });
}

/// ⏱ 2026-09-24 — the sentences the shared `authErrorText` answers with.
final ChassisLocalizations _en = lookupChassisLocalizations(const Locale('en'));
