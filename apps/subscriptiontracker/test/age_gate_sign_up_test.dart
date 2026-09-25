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

/// Records whether Sign in with Apple reached the provider — and WHEN, into
/// [log], so an ordering against the consent write can be asserted.
class _AppleAuth extends MockAuthRepository {
  _AppleAuth([this.log]);
  final List<String>? log;
  int appleCalls = 0;
  @override
  Future<void> signInWithApple() async {
    log?.add('apple');
    appleCalls++;
    await super.signInWithApple();
  }
}

/// ⏱ 2026-09-25 · O-GOOGLE-SIGN-IN-NOT-BUILT. [_AppleAuth] for the Google
/// door: records `google` into [log], and never reaches Apple.
class _GoogleAuth extends _AppleAuth {
  _GoogleAuth([super.log]);
  int googleCalls = 0;
  @override
  Future<void> signInWithGoogle() async {
    log?.add('google');
    googleCalls++;
  }
}

/// A device that has accepted the CURRENT terms (a returning user, here).
class _AcceptedHere extends LegalAcceptanceController {
  @override
  String? build() => kLegalVersions.stamp;
}

/// Captures what would have gone to the append-only consent record, in order.
class _RecordingTransport implements core.ConsentTransport {
  _RecordingTransport(this.log);
  final List<String> log;
  @override
  Future<core.Result<void>> send({
    required String appId,
    required core.ConsentArtifact artifact,
  }) async {
    log.add('consent:${artifact.purpose}:${artifact.granted}');
    return const core.Result<void>.ok(null);
  }
}

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  required core.AgeSignal signal,
  required MockAuthRepository auth,
  bool? termsOwed,
  core.ConsentTransport? transport,
  AuthProviders providers = const AuthProviders(apple: true, google: false),
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        // Null leaves the REAL legal provider in place — an empty store, which
        // is a device that owes the clickwrap.
        // false = a device that has ACCEPTED the current terms: the source
        // provider the Apple door compares, stamped with the current versions.
        if (termsOwed == false)
          legalAcceptanceProvider.overrideWith(_AcceptedHere.new),
        if (transport != null)
          consentTransportProvider.overrideWithValue(transport),
        keyValueStoreProvider.overrideWith((ref) async => _MemStore()),
        authRepositoryProvider.overrideWithValue(auth),
        ageSignalSourceProvider.overrideWithValue(_Fixed(signal)),
        authProvidersProvider.overrideWithValue(providers),
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
        termsOwed: false,
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
        termsOwed: false,
      );
      await tester.ensureVisible(find.text(_l10n(tester).continueWithApple));
      await tester.pumpAndSettle();
      await tester.tap(find.text(_l10n(tester).continueWithApple));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(auth.appleCalls, 1);
    });
  });

  // ⏱ 2026-09-15 · O-SIWA-NO-CLICKWRAP on the app's own LoginScreen (sign-IN arm,
  // which is where the router sends every signed-out visitor).
  group('LoginScreen — the Apple door carries the clickwrap', () {
    Future<void> tapApple(WidgetTester tester) async {
      await tester.ensureVisible(find.text(_l10n(tester).continueWithApple));
      await tester.pumpAndSettle();
      await tester.tap(find.text(_l10n(tester).continueWithApple));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
    }

    testWidgets(
      'FIRST TIME: no Apple sign-in until the terms are ticked, and the terms '
      'artifact is written BEFORE the provider is called',
      (WidgetTester tester) async {
        final List<String> log = <String>[];
        final _AppleAuth auth = _AppleAuth(log);
        await _pump(
          tester,
          const LoginScreen(),
          signal: const core.NoAgeSignal(core.NoAgeSignalReason.noApiOnTarget),
          auth: auth,
          transport: _RecordingTransport(log),
        );
        expect(find.byType(LegalConsentFields), findsOneWidget);
        await tapApple(tester);
        expect(auth.appleCalls, 0, reason: 'unticked: no Apple account');
        expect(log, isEmpty);

        await tester.ensureVisible(
          find.byKey(LegalConsentFields.termsCheckbox),
        );
        await tester.tap(find.byKey(LegalConsentFields.termsCheckbox));
        await tester.pumpAndSettle();
        await tapApple(tester);
        expect(auth.appleCalls, 1);
        expect(
          log.indexOf('consent:terms:true'),
          isNonNegative,
          reason: 'the accepted terms must be on the consent record',
        );
        expect(
          log.indexOf('consent:terms:true'),
          lessThan(log.indexOf('apple')),
          reason:
              'the account can exist the moment the redirect returns, so '
              'the acceptance must already be on record: $log',
        );
      },
    );

    testWidgets('RETURNING: a device that has accepted is not re-prompted', (
      WidgetTester tester,
    ) async {
      final List<String> log = <String>[];
      final _AppleAuth auth = _AppleAuth(log);
      await _pump(
        tester,
        const LoginScreen(),
        signal: const core.NoAgeSignal(core.NoAgeSignalReason.noApiOnTarget),
        auth: auth,
        termsOwed: false,
        transport: _RecordingTransport(log),
      );
      expect(find.byType(LegalConsentFields), findsNothing);
      await tapApple(tester);
      expect(log, <String>[
        'apple',
      ], reason: 'no second acceptance for somebody who already accepted');
    });
  });

  // ⏱ 2026-09-25 · O-GOOGLE-SIGN-IN-NOT-BUILT. Google FORCED ON (the shipping
  // declaration keeps it off): it can create an account exactly as Apple can,
  // so it answers the SAME clickwrap and the SAME age gate, in the same order.
  group('LoginScreen — the Google door carries the same gates', () {
    const AuthProviders both = AuthProviders(apple: true, google: true);

    Future<void> tapGoogle(WidgetTester tester) async {
      await tester.ensureVisible(find.text(_l10n(tester).continueWithGoogle));
      await tester.pumpAndSettle();
      await tester.tap(find.text(_l10n(tester).continueWithGoogle));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
    }

    testWidgets(
      'FIRST TIME: no Google sign-in until the terms are ticked, and the '
      'terms artifact is written BEFORE the provider is called',
      (WidgetTester tester) async {
        final List<String> log = <String>[];
        final _GoogleAuth auth = _GoogleAuth(log);
        await _pump(
          tester,
          const LoginScreen(),
          signal: const core.NoAgeSignal(core.NoAgeSignalReason.noApiOnTarget),
          auth: auth,
          transport: _RecordingTransport(log),
          providers: both,
        );
        expect(
          find.byType(LegalConsentFields),
          findsOneWidget,
          reason: 'one clickwrap above both doors, never one each',
        );
        await tapGoogle(tester);
        expect(auth.googleCalls, 0, reason: 'unticked: no Google account');
        expect(log, isEmpty);

        await tester.ensureVisible(
          find.byKey(LegalConsentFields.termsCheckbox),
        );
        await tester.tap(find.byKey(LegalConsentFields.termsCheckbox));
        await tester.pumpAndSettle();
        await tapGoogle(tester);
        expect(auth.googleCalls, 1);
        expect(auth.appleCalls, 0);
        expect(
          log.indexOf('consent:terms:true'),
          isNonNegative,
          reason: 'the accepted terms must be on the consent record',
        );
        expect(
          log.indexOf('consent:terms:true'),
          lessThan(log.indexOf('google')),
          reason: 'the acceptance must already be on record: $log',
        );
      },
    );

    testWidgets('a store signal BELOW ADULT never calls Google', (
      WidgetTester tester,
    ) async {
      final _GoogleAuth auth = _GoogleAuth();
      await _pump(
        tester,
        const LoginScreen(),
        signal: const core.BelowAdultAgeSignal(),
        auth: auth,
        termsOwed: false,
        providers: both,
      );
      await tapGoogle(tester);
      expect(auth.googleCalls, 0);
      expect(find.text(_l10n(tester).signUpAgeRefused), findsOneWidget);
    });

    testWidgets('RETURNING: Google is not re-prompted, and calls only Google', (
      WidgetTester tester,
    ) async {
      final List<String> log = <String>[];
      final _GoogleAuth auth = _GoogleAuth(log);
      await _pump(
        tester,
        const LoginScreen(),
        signal: const core.NoAgeSignal(core.NoAgeSignalReason.noApiOnTarget),
        auth: auth,
        termsOwed: false,
        transport: _RecordingTransport(log),
        providers: both,
      );
      expect(find.byType(LegalConsentFields), findsNothing);
      await tapGoogle(tester);
      expect(log, <String>['google']);
    });
  });
}
