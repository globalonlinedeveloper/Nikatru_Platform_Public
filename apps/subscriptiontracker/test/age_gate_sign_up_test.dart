// ─────────────────────────────────────────────────────────────────────────────
// age_gate_sign_up_test.dart — [ADR 082] §5 on the live app's sign-up doors.
//
// The app keeps its own `SignUpScreen` and `LoginScreen` (sign-up toggle and
// Sign in with Apple), so the store age gate is proven here as well as on the
// chassis views every stamped app inherits. What each case pins:
//   · a store signal below adult → the account is NOT created (the repository is
//     never called) and the refusal is shown;
//   · no signal → the account is created on the 18+ declaration;
//   · Sign in with Apple with a below-adult signal → the provider is never called.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show AuthProviders;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/features/auth/legal_consent_fields.dart';
import 'package:subscriptiontracker/features/auth/login_screen.dart';
import 'package:subscriptiontracker/features/auth/sign_up_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/mock_auth_repository.dart';

final class _Fixed implements core.AgeSignalSource {
  const _Fixed(this.signal);
  final core.AgeSignal signal;
  @override
  Future<core.AgeSignal> read() async => signal;
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

/// Records whether Sign in with Apple reached the provider.
class _AppleAuth extends MockAuthRepository {
  int appleCalls = 0;
  @override
  Future<void> signInWithApple() async {
    appleCalls++;
    await super.signInWithApple();
  }
}

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  required core.AgeSignal signal,
  required MockAuthRepository auth,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        keyValueStoreProvider.overrideWith((ref) async => _MemStore()),
        authRepositoryProvider.overrideWithValue(auth),
        ageSignalSourceProvider.overrideWithValue(_Fixed(signal)),
        authProvidersProvider.overrideWithValue(
          const AuthProviders(apple: true, google: false),
        ),
      ],
      child: MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: child,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _submitSignUpScreen(WidgetTester tester) async {
  await tester.enterText(find.byType(TextField).at(0), 'someone@example.com');
  await tester.enterText(find.byType(TextField).at(1), 'correct-horse');
  await tester.tap(find.byKey(LegalConsentFields.termsCheckbox));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(SignUpScreen.submitButton));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
}

AppLocalizations _l10n(WidgetTester tester) =>
    AppLocalizations.of(tester.element(find.byType(Scaffold).first));

void main() {
  group('SignUpScreen — email sign-up', () {
    testWidgets(
      'a store signal BELOW ADULT creates no account and shows the refusal',
      (WidgetTester tester) async {
        final MockAuthRepository auth = MockAuthRepository();
        await _pump(
          tester,
          const SignUpScreen(),
          signal: const core.BelowAdultAgeSignal(),
          auth: auth,
        );
        await _submitSignUpScreen(tester);
        expect(
          auth.currentUser,
          isNull,
          reason: 'signUpWithEmail must never be reached',
        );
        expect(find.text(_l10n(tester).signUpAgeRefused), findsOneWidget);
      },
    );

    testWidgets('NO SIGNAL creates the account on the 18+ declaration', (
      WidgetTester tester,
    ) async {
      final MockAuthRepository auth = MockAuthRepository();
      await _pump(
        tester,
        const SignUpScreen(),
        signal: const core.NoAgeSignal(core.NoAgeSignalReason.unavailable),
        auth: auth,
      );
      await _submitSignUpScreen(tester);
      expect(auth.currentUser, isNotNull);
    });
  });

  group('LoginScreen — Sign in with Apple can create an account', () {
    testWidgets('a store signal BELOW ADULT never calls the provider', (
      WidgetTester tester,
    ) async {
      final _AppleAuth auth = _AppleAuth();
      await _pump(
        tester,
        const LoginScreen(),
        signal: const core.BelowAdultAgeSignal(),
        auth: auth,
      );
      await tester.ensureVisible(find.text(_l10n(tester).continueWithApple));
      await tester.pumpAndSettle();
      await tester.tap(find.text(_l10n(tester).continueWithApple));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(auth.appleCalls, 0);
    });

    testWidgets('NO SIGNAL calls the provider', (WidgetTester tester) async {
      final _AppleAuth auth = _AppleAuth();
      await _pump(
        tester,
        const LoginScreen(),
        signal: const core.NoAgeSignal(core.NoAgeSignalReason.noApiOnTarget),
        auth: auth,
      );
      await tester.ensureVisible(find.text(_l10n(tester).continueWithApple));
      await tester.pumpAndSettle();
      await tester.tap(find.text(_l10n(tester).continueWithApple));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(auth.appleCalls, 1);
    });
  });
}
