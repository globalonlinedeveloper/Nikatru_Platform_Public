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

  /// [owed] is whether THIS DEVICE still owes the terms clickwrap; [log]
  /// records the ORDER of the two effects, which is the whole of
  /// O-SIWA-NO-CLICKWRAP: `accept:<marketing>` must come before `apple`.
  Widget signIn(
    core.AgeSignalSource ages,
    void Function() onApple, {
    bool owed = false,
    List<String>? log,
  }) =>
      SignInView(
        ageSignals: ages,
        onSignIn: (String _, String __) async {},
        onForgotPassword: (String _) async {},
        onNeedAccount: () {},
        showAppleButton: true,
        onSignInWithApple: () async {
          log?.add('apple');
          onApple();
        },
        appleTermsOwed: owed,
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
        onAcceptTerms: ({required bool marketingEmail}) async =>
            log?.add('accept:$marketingEmail'),
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

  // ⏱ 2026-09-15 · O-SIWA-NO-CLICKWRAP. Sign in with Apple can create an account,
  // so a device that owes the terms answers the SAME clickwrap before the
  // provider is called, and the acceptance is recorded FIRST. A device that has
  // accepted (a returning user) is never shown it.
  group('SignInView — the Apple door carries the clickwrap', () {
    testWidgets(
        'FIRST TIME: the provider is unreachable until the terms are ticked, '
        'and the acceptance is recorded BEFORE it is called',
        (WidgetTester tester) async {
      final List<String> log = <String>[];
      await pumpChassis(
          tester, kPhone, signIn(_none, () {}, owed: true, log: log));
      expect(find.byType(LegalConsentFieldsView), findsOneWidget,
          reason: 'a device that owes the terms must be shown them');
      await tester.ensureVisible(find.byKey(SignInView.appleButton));
      await tester.tap(find.byKey(SignInView.appleButton));
      await tester.pumpAndSettle();
      expect(log, isEmpty,
          reason: 'unticked: no acceptance and no Apple account');
      await tester.tap(find.byKey(LegalConsentFieldsView.termsCheckbox));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(SignInView.appleButton));
      await tester.pumpAndSettle();
      expect(log, <String>['accept:false', 'apple'],
          reason: 'the account can exist the moment the redirect returns, so '
              'the acceptance must already be on record');
    });

    testWidgets(
        'the optional marketing box never opens the door on its own, '
        'and its answer is what gets recorded', (WidgetTester tester) async {
      final List<String> log = <String>[];
      await pumpChassis(
          tester, kPhone, signIn(_none, () {}, owed: true, log: log));
      await tester.tap(find.byKey(LegalConsentFieldsView.marketingCheckbox));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(SignInView.appleButton));
      await tester.tap(find.byKey(SignInView.appleButton));
      await tester.pumpAndSettle();
      expect(log, isEmpty, reason: 'GDPR Art 7(4): marketing may not gate');
      await tester.tap(find.byKey(LegalConsentFieldsView.termsCheckbox));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(SignInView.appleButton));
      await tester.pumpAndSettle();
      expect(log, <String>['accept:true', 'apple']);
    });

    testWidgets('RETURNING: a device that has accepted is not re-prompted',
        (WidgetTester tester) async {
      final List<String> log = <String>[];
      await pumpChassis(
          tester, kPhone, signIn(_none, () {}, owed: false, log: log));
      expect(find.byType(LegalConsentFieldsView), findsNothing);
      await tester.tap(find.byKey(SignInView.appleButton));
      await tester.pumpAndSettle();
      expect(log, <String>['apple'],
          reason: 'no second acceptance for somebody who already accepted');
    });

    testWidgets('a store signal BELOW ADULT records no acceptance either',
        (WidgetTester tester) async {
      final List<String> log = <String>[];
      await pumpChassis(
          tester, kPhone, signIn(_minor, () {}, owed: true, log: log));
      await tester.tap(find.byKey(LegalConsentFieldsView.termsCheckbox));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(SignInView.appleButton));
      await tester.tap(find.byKey(SignInView.appleButton));
      await tester.pumpAndSettle();
      expect(log, isEmpty,
          reason: 'the age gate runs first; a refused tap creates nothing '
              'and records nothing');
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
