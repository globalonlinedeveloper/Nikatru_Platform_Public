// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-10-01 · EN-11 / EN-12 — FIRST LAUNCH DOES NOT FLASH; RETURNING USERS
// GO STRAIGHT IN.
//
// The router starts at `/onboarding` while the "seen" flag hydrates, and the
// gate declines to decide until it lands — so a RETURNING user was shown the
// carousel for the length of a disk read, every cold start. And a device
// holding a session (a reinstall the keychain outlived) read "not seen" off a
// fresh store and was paged through the pitch for a product it already uses.
//
// The real `SublyApp`, the real router, the real `OnboardingSeenController`.
// MUTATION PROOF: return the carousel unconditionally from
// `OnboardingScreen.build` and the first case goes red; drop `&& !ctx.loggedIn`
// from `onboardingGate` and the second does; replace `_SwallowBack` with its
// child in `AnalyticsGate` and the last one does.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show InMemoryAuthRepository;
import 'package:nikatru_chassis_screens/firstrun/onboarding_screen.dart'
    show OnboardingView;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/app.dart';
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/core/router.dart';
import 'package:subscriptiontracker/features/onboarding/onboarding_screen.dart';
import 'package:subscriptiontracker/state/providers.dart';

const String _seenKey = 'nikatru.onboarding_seen';

/// A store whose onboarding read waits for [gate] — the disk read in flight.
class _SlowStore implements core.KeyValueStore {
  final Map<String, String> data = <String, String>{};
  final Completer<void> gate = Completer<void>();
  @override
  Future<bool> containsKey(String key) async => data.containsKey(key);
  @override
  Future<String?> read(String key) async {
    if (key == _seenKey) await gate.future;
    return data[key];
  }

  @override
  Future<void> remove(String key) async => data.remove(key);
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

class _NullEventTransport implements core.EventTransport {
  @override
  Future<core.Result<void>> send({
    required String appId,
    required String anonId,
    required Map<String, Object?> envelope,
    required List<Map<String, Object?>> events,
  }) async => const core.Result<void>.ok(null);
}

class _NullConsentTransport implements core.ConsentTransport {
  @override
  Future<core.Result<void>> send({
    required String appId,
    required core.ConsentArtifact artifact,
  }) async => const core.Result<void>.ok(null);
}

ProviderContainer _container(
  core.KeyValueStore store, {
  core.AuthRepository? auth,
  bool analytics = false,
}) => ProviderContainer(
  overrides: <Override>[
    keyValueStoreProvider.overrideWith((_) async => store),
    analyticsEnabledProvider.overrideWithValue(analytics),
    eventTransportProvider.overrideWithValue(_NullEventTransport()),
    consentTransportProvider.overrideWithValue(_NullConsentTransport()),
    if (auth != null) authRepositoryProvider.overrideWithValue(auth),
  ],
);

String _where(ProviderContainer c) =>
    c.read(routerProvider).routerDelegate.currentConfiguration.uri.path;

/// The page on TOP of the stack — a `push` keeps the base location in
/// `currentConfiguration.uri`, so the pushed page is read off the last match.
String _top(ProviderContainer c) => c
    .read(routerProvider)
    .routerDelegate
    .currentConfiguration
    .last
    .matchedLocation;

Future<void> _launch(WidgetTester tester, ProviderContainer c) =>
    tester.pumpWidget(
      UncontrolledProviderScope(container: c, child: const SublyApp()),
    );

void main() {
  testWidgets('a hydrating RETURNING user never renders the carousel', (
    WidgetTester tester,
  ) async {
    final _SlowStore store = _SlowStore()..data[_seenKey] = 'true';
    final ProviderContainer c = _container(store);
    addTearDown(c.dispose);

    await _launch(tester, c);
    for (int i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 16));
      expect(find.byType(OnboardingView), findsNothing, reason: 'frame $i');
    }
    expect(find.byKey(OnboardingScreen.bootFrame), findsOneWidget);

    store.gate.complete();
    await tester.pumpAndSettle();
    expect(find.byType(OnboardingView), findsNothing);
    expect(find.byKey(E2EKeys.loginHeading), findsOneWidget);
    expect(_where(c), '/sign-in');
  });

  testWidgets('a first run still gets the carousel once the flag reads false', (
    WidgetTester tester,
  ) async {
    final _SlowStore store = _SlowStore();
    final ProviderContainer c = _container(store);
    addTearDown(c.dispose);
    await _launch(tester, c);
    await tester.pump();
    expect(find.byType(OnboardingView), findsNothing);
    store.gate.complete();
    await tester.pumpAndSettle();
    expect(find.byType(OnboardingView), findsOneWidget);
  });

  testWidgets('a device holding a session skips onboarding', (
    WidgetTester tester,
  ) async {
    final InMemoryAuthRepository auth = InMemoryAuthRepository();
    addTearDown(auth.dispose);
    await auth.signInWithEmail(email: 'back@example.test', password: 'x');
    final _SlowStore store = _SlowStore()..gate.complete();
    final ProviderContainer c = _container(store, auth: auth);
    addTearDown(c.dispose);

    await _launch(tester, c);
    await tester.pumpAndSettle();
    expect(find.byType(OnboardingView), findsNothing);
    expect(_where(c), isNot('/onboarding'));
  });

  testWidgets(
    '"I already have an account" records the flag and opens sign-in',
    (WidgetTester tester) async {
      final _SlowStore store = _SlowStore()..gate.complete();
      final ProviderContainer c = _container(store);
      addTearDown(c.dispose);
      await _launch(tester, c);
      await tester.pumpAndSettle();
      expect(find.byKey(OnboardingView.haveAccountButton), findsOneWidget);
      await tester.tap(find.byKey(OnboardingView.haveAccountButton));
      await tester.pumpAndSettle();
      expect(find.byKey(E2EKeys.loginHeading), findsOneWidget);
      expect(store.data[_seenKey], 'true');
    },
  );

  testWidgets('Android back on the consent scrim does nothing', (
    WidgetTester tester,
  ) async {
    final _SlowStore store = _SlowStore()
      ..data[_seenKey] = 'true'
      ..gate.complete();
    final ProviderContainer c = _container(store, analytics: true);
    addTearDown(c.dispose);
    await _launch(tester, c);
    await tester.pumpAndSettle();
    expect(find.text('No thanks'), findsOneWidget, reason: 'scrim is up');
    unawaited(c.read(routerProvider).push<void>('/sign-up'));
    await tester.pumpAndSettle();
    expect(_top(c), '/sign-up');

    // The system back, exactly as the engine sends it.
    final ByteData message = const JSONMethodCodec().encodeMethodCall(
      const MethodCall('popRoute'),
    );
    await tester.binding.defaultBinaryMessenger.handlePlatformMessage(
      'flutter/navigation',
      message,
      (_) {},
    );
    await tester.pumpAndSettle();
    expect(
      _top(c),
      '/sign-up',
      reason: 'the page under an unanswered modal must not be popped',
    );
    expect(find.text('No thanks'), findsOneWidget);

    // Answered, the back works again.
    await tester.tap(find.text('No thanks'));
    await tester.pumpAndSettle();
    await tester.binding.defaultBinaryMessenger.handlePlatformMessage(
      'flutter/navigation',
      message,
      (_) {},
    );
    await tester.pumpAndSettle();
    expect(_top(c), '/sign-in');
  });
}
