// auth_frame_adoption_test.dart — train ST-D10: every chassis auth view now
// stands in design_system's `AuthFrame`, so every stamped app inherits the
// canvas's auth pages. What this file pins is what the move ADDED or FIXED;
// each view's own suite still owns its behaviour, unchanged.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/auth/check_inbox_screen.dart';
import 'package:nikatru_chassis_screens/auth/legal_consent_fields.dart';
import 'package:nikatru_chassis_screens/auth/reaccept_terms_screen.dart';
import 'package:nikatru_chassis_screens/auth/reset_password_screen.dart';
import 'package:nikatru_chassis_screens/auth/sign_in_screen.dart';
import 'package:nikatru_chassis_screens/auth/sign_up_screen.dart';
import 'package:nikatru_chassis_screens/auth/verify_email_screen.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/width_harness.dart';

Widget _consent({
  required bool termsAccepted,
  required bool marketingAccepted,
  required bool enabled,
  required ValueChanged<bool> onTermsChanged,
  required ValueChanged<bool> onMarketingChanged,
}) => LegalConsentFieldsView(
  termsAccepted: termsAccepted,
  marketingAccepted: marketingAccepted,
  enabled: enabled,
  showMarketing: false,
  onTermsChanged: onTermsChanged,
  onMarketingChanged: onMarketingChanged,
  onOpenTerms: () {},
  onOpenPrivacy: () {},
);

SignInView _signIn({bool providers = false}) => SignInView(
  onSignIn: (String _, String _) async {},
  onForgotPassword: (String _) async {},
  onNeedAccount: () {},
  showAppleButton: providers,
  onSignInWithApple: () async {},
  appleTermsOwed: false,
  consentFields:
      ({
        required bool termsAccepted,
        required bool marketingAccepted,
        required bool enabled,
        required ValueChanged<bool> onTermsChanged,
        required ValueChanged<bool> onMarketingChanged,
      }) => const SizedBox.shrink(),
  onAcceptTerms: ({required bool marketingEmail}) async {},
);

ReacceptTermsView _reaccept({
  Future<void> Function()? onAccept,
  Widget? panel,
}) => ReacceptTermsView(
  onAccept: onAccept ?? () async {},
  onSignOut: () async {},
  consentFields: _consent,
  panel: panel,
);

void main() {
  group('every chassis auth view stands in the shared frame', () {
    final Map<String, Widget> views = <String, Widget>{
      'sign in': _signIn(),
      'sign up': SignUpView(
        onSignUp:
            ({
              required String email,
              required String password,
              required bool marketingEmail,
            }) async {},
        onHaveAccount: () {},
        consentFields: _consent,
      ),
      'check inbox': CheckInboxView(email: 'a@b.test', onBackToSignIn: () {}),
      'verify email': VerifyEmailView(
        email: 'a@b.test',
        onCheckConfirmed: () async => true,
        onResend: () async {},
        onSignOut: () async {},
      ),
      'reset password': ResetPasswordView(
        hasSession: true,
        recovering: true,
        arrival: core.PasswordResetArrival.values.first,
        problem: null,
        onSubmit: (String _) async {},
        onLeave: () {},
      ),
      're-accept terms': _reaccept(),
    };
    for (final MapEntry<String, Widget> v in views.entries) {
      testWidgets('${v.key}: AuthFrame, a heading, no AppBar', (
        WidgetTester tester,
      ) async {
        await pumpChassis(tester, kPhone, v.value);
        expect(find.byType(AuthFrame), findsOneWidget);
        expect(find.byType(AppBar), findsNothing);
      });
    }
  });

  testWidgets('sign in: the password field carries Show / Hide', (
    WidgetTester tester,
  ) async {
    await pumpChassis(tester, kPhone, _signIn());
    final TextField inner = tester.widget<TextField>(
      find.descendant(
        of: find.byKey(SignInView.passwordField),
        matching: find.byType(TextField),
      ),
    );
    expect(inner.obscureText, isTrue);
    await tester.tap(find.byKey(AuthField.revealKey));
    await tester.pump();
    expect(
      tester
          .widget<TextField>(
            find.descendant(
              of: find.byKey(SignInView.passwordField),
              matching: find.byType(TextField),
            ),
          )
          .obscureText,
      isFalse,
    );
  });

  testWidgets('sign in: "or" renders only with the provider doors', (
    WidgetTester tester,
  ) async {
    await pumpChassis(tester, kPhone, _signIn());
    expect(find.byType(AuthOrDivider), findsNothing);
    await pumpChassis(tester, kPhone, _signIn(providers: true));
    expect(find.byType(AuthOrDivider), findsOneWidget);
  });

  testWidgets('verify email is a gate: no back even when pushed', (
    WidgetTester tester,
  ) async {
    await pumpChassis(
      tester,
      kPhone,
      Builder(
        builder: (BuildContext context) => TextButton(
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => VerifyEmailView(
                email: 'a@b.test',
                onCheckConfirmed: () async => true,
                onResend: () async {},
                onSignOut: () async {},
              ),
            ),
          ),
          child: const Text('open'),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.byKey(AuthFrame.backKey), findsNothing);
  });

  group('re-accept terms · an accept that FAILS is said (M1 §2.31 gap 17)', () {
    testWidgets('the refusal is shown inline, and the box can try again', (
      WidgetTester tester,
    ) async {
      await pumpChassis(
        tester,
        kPhone,
        _reaccept(
          onAccept: () async =>
              throw core.AuthFailure.localized('Saving failed.'),
        ),
      );
      await tester.tap(find.byType(Checkbox));
      await tester.pump();
      await tester.tap(find.byKey(ReacceptTermsView.acceptButton));
      await tester.pump();
      await tester.pump();
      expect(find.byKey(ReacceptTermsView.statusLine), findsOneWidget);
      expect(find.text('Saving failed.'), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(find.byKey(ReacceptTermsView.acceptButton))
            .onPressed,
        isNotNull,
        reason: 'the latch released, so the user can accept again',
      );
    });

    testWidgets('an accept that works says nothing', (
      WidgetTester tester,
    ) async {
      await pumpChassis(tester, kPhone, _reaccept());
      await tester.tap(find.byType(Checkbox));
      await tester.pump();
      await tester.tap(find.byKey(ReacceptTermsView.acceptButton));
      await tester.pump();
      expect(find.byKey(ReacceptTermsView.statusLine), findsNothing);
    });
  });

  testWidgets('re-accept terms: a supplied panel splits the page at 1440', (
    WidgetTester tester,
  ) async {
    await pumpChassis(
      tester,
      const Size(1440, 900),
      _reaccept(panel: const ColoredBox(color: Colors.transparent)),
    );
    expect(find.byKey(AuthFrame.panelKey), findsOneWidget);
  });
}
