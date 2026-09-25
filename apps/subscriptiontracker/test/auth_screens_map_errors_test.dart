// ─────────────────────────────────────────────────────────────────────────────
// auth_screens_map_errors_test.dart — ⏱ 2026-09-24. No raw exception text on
// the app's own sign-up and reset screens.
//
// Both did `catch (e) { _error = '$e'; }` beside their mapped `AuthFailure`
// arm, so anything that was NOT an AuthFailure — the vendor's own exception, a
// captcha refusal the adapter did not wrap — was printed to the user whole. Both
// now hand every failure to the shared `authErrorText`
// (`package:nikatru_chassis_screens/auth/auth_error_text.dart`).
//
// The sign-up group also pins the local length refusal: it was raised as a bare
// `AuthFailure(l10n.passwordTooShort)`, which the mapper read as unmatched
// server English and showed as "Something went wrong".
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/features/auth/legal_consent_fields.dart';
import 'package:subscriptiontracker/features/auth/reset_password_screen.dart';
import 'package:subscriptiontracker/features/auth/sign_up_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/mock_auth_repository.dart';

/// A vendor exception that reached the screen UNWRAPPED — deliberately not an
/// AuthFailure, because only the `'$e'` arm ever saw one. The text is
/// gotrue-dart's own format for a captcha refusal.
class _RawVendorError implements Exception {
  const _RawVendorError();
  @override
  String toString() =>
      'AuthApiException(message: $_raw (invalid-input-response), '
      'statusCode: 400, code: captcha_failed)';
}

const String _raw = 'captcha protection: request disallowed';

/// Refuses every account-changing call with [boom], and counts sign-ups.
class _Refusing extends MockAuthRepository {
  _Refusing(this.boom);
  final Object boom;
  int signUps = 0;

  @override
  Future<core.AuthUser> signUpWithEmail({
    required String email,
    required String password,
    String? captchaToken,
  }) async {
    signUps++;
    throw boom;
  }

  @override
  Future<core.AuthUser> updatePassword({required String newPassword}) async =>
      throw boom;
}

class _MemStore implements core.KeyValueStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<bool> containsKey(String key) async => data.containsKey(key);
  @override
  Future<void> remove(String key) async => data.remove(key);
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

Future<void> _pump(
  WidgetTester tester,
  Widget child,
  MockAuthRepository auth,
) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        keyValueStoreProvider.overrideWith((ref) async => _MemStore()),
        authRepositoryProvider.overrideWithValue(auth),
        ageSignalSourceProvider.overrideWithValue(
          const core.NoAgeSignalSource(core.NoAgeSignalReason.noApiOnTarget),
        ),
      ],
      // The SAME delegate list `SublyApp` composes (`lib/app.dart`): the error
      // sentences are the chassis strings now.
      child: MaterialApp(
        localizationsDelegates: <LocalizationsDelegate<dynamic>>[
          ...AppLocalizations.localizationsDelegates,
          ChassisLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: child,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

final ChassisLocalizations _en = lookupChassisLocalizations(const Locale('en'));

void main() {
  group('SignUpScreen', () {
    Future<void> submit(WidgetTester tester, {required String password}) async {
      await tester.enterText(
        find.byType(TextField).at(0),
        'someone@example.com',
      );
      await tester.enterText(find.byType(TextField).at(1), password);
      await tester.tap(find.byKey(LegalConsentFields.termsCheckbox));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(SignUpScreen.submitButton));
      await tester.pumpAndSettle();
    }

    // 🔴 THE `'$e'` ARM, and a RED CONTROL: restore `_error = '$e'` in
    // `sign_up_screen.dart` and this case fails.
    testWidgets('a NON-AuthFailure is mapped, never printed', (
      WidgetTester tester,
    ) async {
      final _Refusing auth = _Refusing(const _RawVendorError());
      await _pump(tester, const SignUpScreen(), auth);
      await submit(tester, password: 'correct-horse');

      expect(auth.signUps, 1);
      expect(find.textContaining(_raw), findsNothing);
      expect(find.textContaining('AuthApiException'), findsNothing);
      expect(find.text(_en.authCaptchaFailed), findsOneWidget);
    });

    testWidgets('a weak-password refusal with reasons reads by its reason', (
      WidgetTester tester,
    ) async {
      final _Refusing auth = _Refusing(
        core.AuthFailure(
          'Password is known to be weak and easy to guess.',
          code: core.AuthFailure.weakPassword,
          reasons: const <String>[core.AuthFailure.reasonPwned],
        ),
      );
      await _pump(tester, const SignUpScreen(), auth);
      await submit(tester, password: 'correct-horse');

      expect(find.text(_en.passwordBreached), findsOneWidget);
      expect(find.textContaining('known to be weak'), findsNothing);
    });

    // 🔴 ITEM 2 — the local length refusal. Nothing is sent, and the sentence is
    // the length rule, not "Something went wrong".
    testWidgets('a short password reads passwordTooShort, and sends nothing', (
      WidgetTester tester,
    ) async {
      final _Refusing auth = _Refusing(const _RawVendorError());
      await _pump(tester, const SignUpScreen(), auth);
      await submit(tester, password: 'short');

      expect(auth.signUps, 0);
      expect(find.text(_en.passwordTooShort), findsOneWidget);
      expect(find.text(_en.authUnknownError), findsNothing);
    });
  });

  group('ResetPasswordScreen', () {
    Future<void> submit(WidgetTester tester) async {
      await tester.enterText(
        find.byKey(ResetPasswordScreen.passwordField),
        'correct-horse-1',
      );
      await tester.enterText(
        find.byKey(ResetPasswordScreen.confirmField),
        'correct-horse-1',
      );
      await tester.tap(find.byKey(ResetPasswordScreen.submitButton));
      await tester.pumpAndSettle();
    }

    /// A signed-in session, which is the state that shows the form.
    Future<_Refusing> signedIn(Object boom) async {
      final _Refusing auth = _Refusing(boom);
      await auth.signInWithEmail(email: 'a@b.com', password: 'pw');
      return auth;
    }

    // 🔴 THE `'$e'` ARM.
    testWidgets('a NON-AuthFailure is mapped, never printed', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        const ResetPasswordScreen(),
        await signedIn(const _RawVendorError()),
      );
      await submit(tester);

      expect(find.byKey(ResetPasswordScreen.doneLine), findsNothing);
      expect(find.textContaining(_raw), findsNothing);
      expect(find.text(_en.authCaptchaFailed), findsOneWidget);
    });

    // ITEM 3 end to end on this screen: the reasons the adapter now carries
    // reach the sentence. Before, `pwned` could only ever read "stronger".
    testWidgets('a breached password says so', (WidgetTester tester) async {
      await _pump(
        tester,
        const ResetPasswordScreen(),
        await signedIn(
          core.AuthFailure(
            'Password is known to be weak and easy to guess.',
            code: core.AuthFailure.weakPassword,
            reasons: const <String>[core.AuthFailure.reasonPwned],
          ),
        ),
      );
      await submit(tester);

      expect(find.text(_en.passwordBreached), findsOneWidget);
    });
  });
}
