import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/auth/age_signal_host.dart';
import 'package:nikatru_chassis_screens/auth/legal_consent_fields.dart';
import 'package:nikatru_chassis_screens/auth/sign_in_screen.dart';
import 'package:nikatru_chassis_screens/auth/sign_up_screen.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/width_harness.dart';

/// [ADR 082] §5 — the store age gate on the chassis sign-up doors, which every
/// stamped app inherits: `SignUpView` (email) and `SignInView`'s Sign in with
/// Apple (which can create an account). A store signal below adult creates
/// nothing; no signal proceeds on the 18+ declaration.
final class _Fixed implements core.AgeSignalSource {
  const _Fixed(this.signal);
  final core.AgeSignal signal;
  @override
  Future<core.AgeSignal> read() async => signal;
}

const core.AgeSignalSource _minor = _Fixed(core.BelowAdultAgeSignal());
const core.AgeSignalSource _adult = _Fixed(core.AdultAgeSignal());
const core.AgeSignalSource _none =
    _Fixed(core.NoAgeSignal(core.NoAgeSignalReason.notEligible));

void main() {
  Widget signUp(core.AgeSignalSource ages, void Function() onCreated) =>
      SignUpView(
        ageSignals: ages,
        onSignUp: ({
          required String email,
          required String password,
          required bool marketingEmail,
        }) async =>
            onCreated(),
        onHaveAccount: () {},
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
          onOpenTerms: () {},
          onOpenPrivacy: () {},
        ),
      );

  Future<void> submitSignUp(WidgetTester tester) async {
    await tester.enterText(
        find.byKey(SignUpView.emailField), 'someone@example.com');
    await tester.enterText(
        find.byKey(SignUpView.passwordField), 'correct-horse');
    await tester.tap(find.byKey(LegalConsentFieldsView.termsCheckbox));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(SignUpView.submitButton));
    await tester.pumpAndSettle();
  }

  Widget signIn(core.AgeSignalSource ages, void Function() onApple) =>
      SignInView(
        ageSignals: ages,
        onSignIn: (String _, String __) async {},
        onForgotPassword: (String _) async {},
        onNeedAccount: () {},
        showAppleButton: true,
        onSignInWithApple: () async => onApple(),
      );

  group('SignUpView — email sign-up', () {
    testWidgets('a store signal BELOW ADULT creates no account and says why',
        (WidgetTester tester) async {
      int created = 0;
      await pumpChassis(tester, kPhone, signUp(_minor, () => created++));
      await submitSignUp(tester);
      expect(created, 0,
          reason:
              'onSignUp creates the account AND records the terms; neither may happen');
      final ChassisLocalizations l10n =
          ChassisLocalizations.of(tester.element(find.byType(SignUpView)));
      expect(find.text(l10n.signUpAgeRefused), findsOneWidget);
    });

    testWidgets('NO SIGNAL proceeds on the 18+ declaration',
        (WidgetTester tester) async {
      int created = 0;
      await pumpChassis(tester, kPhone, signUp(_none, () => created++));
      await submitSignUp(tester);
      expect(created, 1);
    });

    testWidgets('an ADULT store signal proceeds', (WidgetTester tester) async {
      int created = 0;
      await pumpChassis(tester, kPhone, signUp(_adult, () => created++));
      await submitSignUp(tester);
      expect(created, 1);
    });
  });

  group('SignInView — Sign in with Apple can create an account', () {
    testWidgets('a store signal BELOW ADULT never calls the provider',
        (WidgetTester tester) async {
      int calls = 0;
      await pumpChassis(tester, kPhone, signIn(_minor, () => calls++));
      await tester.tap(find.byKey(SignInView.appleButton));
      await tester.pumpAndSettle();
      expect(calls, 0,
          reason: 'no identity may be created to delete afterwards');
      final ChassisLocalizations l10n =
          ChassisLocalizations.of(tester.element(find.byType(SignInView)));
      expect(find.text(l10n.signUpAgeRefused), findsOneWidget);
    });

    testWidgets('NO SIGNAL calls the provider', (WidgetTester tester) async {
      int calls = 0;
      await pumpChassis(tester, kPhone, signIn(_none, () => calls++));
      await tester.tap(find.byKey(SignInView.appleButton));
      await tester.pumpAndSettle();
      expect(calls, 1);
    });
  });

  // Every target's selection, from the platform the build runs on. Declared one
  // by one so a change to one target cannot hide behind another's.
  group('ageSignalHostOf — every target', () {
    test('web wins over any platform', () {
      expect(ageSignalHostOf(isWeb: true, platform: TargetPlatform.android),
          core.AgeSignalHost.web);
    });
    test('android', () {
      expect(ageSignalHostOf(isWeb: false, platform: TargetPlatform.android),
          core.AgeSignalHost.android);
    });
    test('iOS', () {
      expect(ageSignalHostOf(isWeb: false, platform: TargetPlatform.iOS),
          core.AgeSignalHost.ios);
    });
    test('macOS', () {
      expect(ageSignalHostOf(isWeb: false, platform: TargetPlatform.macOS),
          core.AgeSignalHost.macos);
    });
    test('windows', () {
      expect(ageSignalHostOf(isWeb: false, platform: TargetPlatform.windows),
          core.AgeSignalHost.windows);
    });
    test('linux', () {
      expect(ageSignalHostOf(isWeb: false, platform: TargetPlatform.linux),
          core.AgeSignalHost.linux);
    });
    test('fuchsia is other', () {
      expect(ageSignalHostOf(isWeb: false, platform: TargetPlatform.fuchsia),
          core.AgeSignalHost.other);
    });
  });
}
