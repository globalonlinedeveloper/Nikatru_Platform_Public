import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/core/router.dart';
import 'package:subly/l10n/app_localizations.dart';
import 'package:subly/features/auth/login_screen.dart';
import 'package:subly/features/onboarding/onboarding_screen.dart';
import 'package:subly/state/providers.dart';

/// WHERE A SIGNED-OUT USER LANDS, ASSERTED AFTER EVERYTHING SETTLES.
///
/// 🔴 THE BUG THIS EXISTS FOR. `settings_screen.dart` used to run:
///
/// ```dart
/// await ref.read(authRepositoryProvider).signOut();
/// if (context.mounted) context.go('/onboarding');
/// ```
///
/// while `core/router.dart` independently redirects a signed-out user off
/// `/settings` to `/sign-in`. Two navigations, one tap. Which one won depended on
/// whether the awaited continuation resumed before or after the router's
/// refresh — and `/onboarding` is inside the router's `authFlow` allowlist, so
/// when the explicit `go` won, **the router did not correct it**. The user was
/// dropped into the first-run marketing carousel after logging out, and had to
/// tap Skip to reach the login form.
///
/// 🔬 WHY THE NIGHTLY E2E DID NOT CATCH IT FOR WEEKS, which is the reusable
/// lesson: that suite polls `find.text('Welcome back')` every 200ms and returns
/// the instant it matches ONCE. The form really does render on the way past, so
/// the poll could pass on a state the app was merely TRANSITING. The screenshot
/// from a PASSING run shows the onboarding carousel animating in over the login
/// screen. **A polling assertion about a final destination can be satisfied by a
/// frame in transit — assert after a settle, not on first sight.**
///
/// This test is a widget test precisely so it runs on every push rather than
/// once a night against production.
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

/// A fake that reproduces the REAL ordering, which is the whole point.
///
/// gotrue emits `AuthChangeEvent.signedOut` to its subscribers BEFORE it awaits
/// the `POST /logout` round-trip (`gotrue_client.dart`). So the auth stream
/// fires immediately and `signOut()`'s future completes ~100–300ms later. A fake
/// whose `signOut` did both at once would close the race window and this test
/// would pass against the broken code — proving nothing.
class _RaceyAuth extends core.AuthRepository {
  _RaceyAuth({this.logoutLatency = const Duration(milliseconds: 250)});

  /// Stands in for the network leg of `POST /logout`.
  final Duration logoutLatency;

  bool signedIn = true;
  int signOutCalls = 0;

  final StreamController<core.AuthUser?> _authChanges =
      StreamController<core.AuthUser?>.broadcast();

  @override
  core.AuthUser? get currentUser =>
      signedIn
      ? const core.AuthUser(
          id: 'u1',
          email: 'a@b.test',
          emailVerified: true,
        )
      : null;

  @override
  Stream<core.AuthUser?> authStateChanges() => _authChanges.stream;

  @override
  Future<void> signOut() async {
    signOutCalls++;
    signedIn = false;
    // 1. subscribers are notified FIRST — the router can redirect from here
    _authChanges.add(null);
    // 2. …and only then does the network leg complete
    await Future<void>.delayed(logoutLatency);
  }

  @override
  Future<core.AuthUser> signInWithEmail({
    required String email,
    required String password,
  }) async => currentUser!;
  @override
  Future<core.AuthUser> signUpWithEmail({
    required String email,
    required String password,
  }) async => currentUser!;
  @override
  Future<void> deleteAccount() async => signOut();
  @override
  Future<String?> currentAccessToken() async => signedIn ? 'token' : null;
  @override
  Future<core.AuthSession?> currentSession() async => null;
  @override
  Future<void> sendPasswordReset(String email) async {}
  @override
  Future<void> signInWithApple() async {}
  @override
  Future<core.AuthUser> updateProfile({required String displayName}) async =>
      currentUser!;
}

/// P2.6a: the union router's onboarding gate DECLINES TO DECIDE while the
/// seen-flag is still hydrating (null) and sends seen=false to /onboarding —
/// so a router test that never answers the question stalls before its first
/// real frame. Predicted by the re-stamp red-team pass, observed here.
class _OnboardingSeen extends OnboardingSeenController {
  @override
  bool? build() => true;
}

void main() {
  testWidgets(
    '🔴 SIGN-OUT LANDS ON THE LOGIN SCREEN, NOT THE ONBOARDING CAROUSEL',
    (WidgetTester tester) async {
      // Settings is a ListView; a tall surface renders the whole list so the
      // Log out control has an element to tap rather than being below the fold.
      tester.view.physicalSize = const Size(1200, 4000);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      final _RaceyAuth auth = _RaceyAuth();
      final ProviderContainer container = ProviderContainer(
        overrides: <Override>[
          onboardingSeenProvider.overrideWith(_OnboardingSeen.new),
          // This user has accepted the current terms. Stated, not defaulted: a
          // signed-in user with no acceptance on record is sent to /reaccept-terms
          // by the router, which is correct and is what every pre-clickwrap install
          // sees once. The gate itself is driven in legal_gates_test.dart.
          legalReacceptanceNeededProvider.overrideWithValue(false),
          authRepositoryProvider.overrideWithValue(auth),
          keyValueStoreProvider.overrideWith((ref) async => _MemStore()),
          analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp.router(
            // P2.6b: home reads l10n now; a host without delegates throws on the
            // first frame that renders it (nullable-getter: false).
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            routerConfig: container.read(routerProvider),
          ),
        ),
      );
      await tester.pumpAndSettle();
      container.read(routerProvider).go('/settings');
      await tester.pumpAndSettle();

      await tester.tap(find.text('Log out'));

      // Settle PAST the logout latency. This is the assertion the nightly E2E
      // could not make: it polled and stopped at the first match, so it could
      // return true during the auth-route frame and never see what came next.
      await tester.pumpAndSettle(const Duration(seconds: 1));

      expect(auth.signOutCalls, 1, reason: 'the tap must reach the repository');

      expect(
        find.byType(LoginScreen),
        findsOneWidget,
        reason:
            'a signed-out user belongs on /sign-in — the router redirects them '
            'there from any route outside authFlow',
      );
      expect(
        find.byType(OnboardingScreen),
        findsNothing,
        reason:
            'THE BUG: an explicit go("/onboarding") in the sign-out handler '
            'raced the router. /onboarding is inside authFlow, so the router '
            'does not correct it, and the user is stranded in the first-run '
            'carousel after logging out',
      );
    },
  );

  testWidgets(
    'the destination is stable regardless of how slow the logout round-trip is',
    (WidgetTester tester) async {
      // The failure was timing-dependent, so pinning ONE latency would leave a
      // test that passes for the wrong reason on a faster machine. A near-zero
      // and a slow round-trip must reach the same screen.
      for (final Duration latency in <Duration>[
        Duration.zero,
        const Duration(milliseconds: 800),
      ]) {
        tester.view.physicalSize = const Size(1200, 4000);
        tester.view.devicePixelRatio = 1.0;

        final _RaceyAuth auth = _RaceyAuth(logoutLatency: latency);
        final ProviderContainer container = ProviderContainer(
          overrides: <Override>[
            onboardingSeenProvider.overrideWith(_OnboardingSeen.new),
            // This user has accepted the current terms. Stated, not defaulted: a
            // signed-in user with no acceptance on record is sent to /reaccept-terms
            // by the router, which is correct and is what every pre-clickwrap install
            // sees once. The gate itself is driven in legal_gates_test.dart.
            legalReacceptanceNeededProvider.overrideWithValue(false),
            authRepositoryProvider.overrideWithValue(auth),
            keyValueStoreProvider.overrideWith((ref) async => _MemStore()),
            analyticsConsentProvider.overrideWithValue(
              core.ConsentStatus.denied,
            ),
          ],
        );

        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: MaterialApp.router(
              // P2.6b: home reads l10n now; a host without delegates throws on the
              // first frame that renders it (nullable-getter: false).
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              routerConfig: container.read(routerProvider),
            ),
          ),
        );
        await tester.pumpAndSettle();
        container.read(routerProvider).go('/settings');
        await tester.pumpAndSettle();

        await tester.tap(find.text('Log out'));
        await tester.pumpAndSettle(const Duration(seconds: 2));

        expect(
          find.byType(LoginScreen),
          findsOneWidget,
          reason: 'logout latency $latency must still land on /sign-in',
        );
        expect(
          find.byType(OnboardingScreen),
          findsNothing,
          reason: 'logout latency $latency must not strand the user',
        );

        container.dispose();
        tester.view.reset();
      }
    },
  );
}
