// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-10-01 · EN-14 — THE VERIFY-EMAIL WAITING ROOM RECOVERS FROM A
// MISTAKE: Resend rests like `/check-inbox`'s and the rest survives leaving,
// and somebody who registered with a typo has a way out that keeps what they
// typed.
//
// MUTATION PROOF: drop the seeding in `_VerifyEmailScreenState.initState` and
// the first case goes red; send `_useDifferent` to '/sign-in' and the second
// does.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show InMemoryAuthRepository;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show ChassisLocalizations;
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/core/router.dart';
import 'package:subscriptiontracker/features/auth/verify_email_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/user_state_fakes.dart';

class _MemStore implements core.KeyValueStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<bool> containsKey(String key) async => data.containsKey(key);
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> remove(String key) async => data.remove(key);
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

class _OnboardingSeen extends OnboardingSeenController {
  @override
  bool? build() => true;
}

const String _address = 'typo@exmaple.test';

ProviderContainer _container(InMemoryAuthRepository auth) => ProviderContainer(
  overrides: <Override>[
    onboardingSeenProvider.overrideWith(_OnboardingSeen.new),
    legalReacceptanceNeededProvider.overrideWithValue(false),
    authRepositoryProvider.overrideWithValue(auth),
    keyValueStoreProvider.overrideWith((ref) async => _MemStore()),
    analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
    secureStoreProvider.overrideWithValue(MemSecureStore()),
    notificationServiceProvider.overrideWithValue(FakeNotifications()),
    renewalRemindersProvider.overrideWithValue(RecordingSublyNotifications()),
  ],
);

String _where(ProviderContainer c) =>
    c.read(routerProvider).routerDelegate.currentConfiguration.uri.path;

Future<void> _pump(WidgetTester tester, ProviderContainer c) async {
  await tester.binding.setSurfaceSize(const Size(800, 1600));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  c.listen(routerProvider, (_, _) {});
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp.router(
        localizationsDelegates: <LocalizationsDelegate<dynamic>>[
          ...AppLocalizations.localizationsDelegates,
          ChassisLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        routerConfig: c.read(routerProvider),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  late InMemoryAuthRepository auth;
  setUp(() async {
    auth = InMemoryAuthRepository(emailVerified: false);
    await auth.signInWithEmail(email: _address, password: 'x');
  });
  tearDown(() => auth.dispose());

  testWidgets('Resend rests 30 s, and the rest survives leaving', (
    WidgetTester tester,
  ) async {
    final ProviderContainer c = _container(auth);
    addTearDown(c.dispose);
    await _pump(tester, c);
    expect(_where(c), '/verify-email');

    OutlinedButton resend() => tester.widget<OutlinedButton>(
      find.byKey(VerifyEmailScreen.resendButton),
    );
    expect(resend().onPressed, isNotNull);
    await tester.tap(find.byKey(VerifyEmailScreen.resendButton));
    await tester.pumpAndSettle();
    expect(auth.verificationResends, 1);
    expect(resend().onPressed, isNull, reason: 'resting after a send');

    // Leave (the screen is torn down) and come straight back.
    await tester.pumpWidget(const SizedBox());
    await _pump(tester, c);
    expect(_where(c), '/verify-email');
    expect(
      resend().onPressed,
      isNull,
      reason: 'the rest outlives the screen that started it',
    );
  });

  testWidgets('"Use a different email" signs out to sign-up, address filled', (
    WidgetTester tester,
  ) async {
    final ProviderContainer c = _container(auth);
    addTearDown(c.dispose);
    await _pump(tester, c);
    expect(_where(c), '/verify-email');

    await tester.tap(find.byKey(VerifyEmailScreen.useDifferentButton));
    await tester.pumpAndSettle();
    expect(auth.currentUser, isNull, reason: 'signed out of the typo');
    expect(_where(c), '/sign-up');
    expect(
      tester.widget<TextField>(find.byKey(E2EKeys.loginEmail)).controller!.text,
      _address,
    );
  });
}
