import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/core/router.dart';
import 'package:subly/l10n/app_localizations.dart';
import 'package:subly/features/auth/login_screen.dart';
import 'package:subly/features/onboarding/onboarding_screen.dart';
import 'package:subly/features/settings/settings_screen.dart';
import 'package:subly/state/providers.dart';

import 'support/user_state_fakes.dart';

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
  core.AuthUser? get currentUser => signedIn
      ? const core.AuthUser(id: 'u1', email: 'a@b.test', emailVerified: true)
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
    String? captchaToken,
  }) async => currentUser!;
  @override
  Future<core.AuthUser> signUpWithEmail({
    required String email,
    required String password,
    String? captchaToken,
  }) async => currentUser!;
  @override
  Future<void> deleteAccount() async => signOut();
  @override
  Future<String?> currentAccessToken() async => signedIn ? 'token' : null;
  @override
  Future<core.AuthSession?> currentSession() async => null;
  @override
  Future<void> sendPasswordReset(String email, {String? captchaToken}) async {}
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
  testWidgets('🔴 SIGN-OUT LANDS ON THE LOGIN SCREEN, NOT THE ONBOARDING CAROUSEL', (
    WidgetTester tester,
  ) async {
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
        // Sign-out also forgets the user's device-local state now, and both
        // of those seams are platform channels: unmocked, they never complete
        // (not "fail"), so the handler would stop half-way and this test would
        // go on passing while asserting only the first half of the action.
        secureStoreProvider.overrideWithValue(MemSecureStore()),
        notificationServiceProvider.overrideWithValue(FakeNotifications()),
        sublyNotificationServiceProvider.overrideWithValue(
          RecordingSublyNotifications(),
        ),
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
  });

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

  // ───────────────────────────────────────────────────────────────────────────
  // 🔴 THE FORGET SURVIVES THE ROUTER TEARING THE PAGE DOWN.
  //
  // This is the only harness in the repo that can see the defect, and the
  // defect was shipped in the fix for a different one. `signOutAndForgetUser`
  // read its providers AFTER `await signOut()`:
  //
  //     await ref.read(authRepositoryProvider).signOut();   // ~800ms
  //     await forgetSignedInUser(ref);                      // ref.read → BOOM
  //
  // gotrue emits on the auth stream BEFORE the network leg finishes, the router
  // then replaces the whole StatefulShellRoute `/settings` lives in, and
  // `WidgetRef.read` on a disposed element THROWS `StateError` in release
  // (flutter_riverpod 2.6.1 consumer.dart:548-551 — a real throw, not an
  // `assert`). Two things went wrong at once: nothing was cleared, and
  // `_signOut`'s `catch` told the user a completely successful sign-out had
  // failed.
  //
  // ⚠️ WHY `sign_out_forgets_user_test.dart` CANNOT SEE IT, which is the reusable
  // part: that file pumps `SettingsScreen` under a plain `MaterialApp` with no
  // router, so nothing ever unmounts, and its fake completes `signOut()` with
  // zero latency. Both halves of the race are absent. This file's `_RaceyAuth`
  // exists precisely because a fake that emits and completes at the same moment
  // "would close the race window and this test would pass against the broken
  // code — proving nothing" (the note at its declaration, written for the
  // navigation defect and true again for this one).
  testWidgets(
    '🔴 A SLOW SIGN-OUT STILL EMPTIES THE ENTITLEMENT CACHE, AND SAYS NOTHING FAILED',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1200, 4000);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      // 800ms: long enough that the redirect, the shell rebuild and this
      // element's disposal all land INSIDE the window, which is what a phone on
      // a slow mobile connection does every time.
      final _RaceyAuth auth = _RaceyAuth(
        logoutLatency: const Duration(milliseconds: 800),
      );
      final MemSecureStore secure = MemSecureStore();
      final FakeNotifications chassis = FakeNotifications();
      final RecordingSublyNotifications fork = RecordingSublyNotifications();
      final ProviderContainer container = ProviderContainer(
        overrides: <Override>[
          onboardingSeenProvider.overrideWith(_OnboardingSeen.new),
          legalReacceptanceNeededProvider.overrideWithValue(false),
          authRepositoryProvider.overrideWithValue(auth),
          keyValueStoreProvider.overrideWith((ref) async => _MemStore()),
          analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
          secureStoreProvider.overrideWithValue(secure),
          notificationServiceProvider.overrideWithValue(chassis),
          sublyNotificationServiceProvider.overrideWithValue(fork),
        ],
      );
      addTearDown(container.dispose);

      await seedLifetimePro(container.read(entitlementCacheProvider));
      chassis.scheduled.add(
        const core.DailyReminder(
          id: 1,
          title: 't',
          body: 'b',
          hour: 9,
          minute: 0,
        ),
      );
      // The seed is real, so an empty cache afterwards means the sign-out did
      // it rather than that there was never anything there.
      expect(rawEntitlementCache(secure), isNotNull);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp.router(
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

      // 🔴 PUMP FRAMES *DURING* THE LATENCY, AND THIS IS THE WHOLE HARNESS.
      // A bare `pumpAndSettle(2s)` DOES NOT REPRODUCE THE FIELD ORDERING and
      // this test passed against the broken code until it was measured: fake
      // async elapses the clock first, so the 800ms timer fires — resuming the
      // continuation — BEFORE the frame that rebuilds the router and disposes
      // this page. In the field 800ms is ~48 real frames, and the redirect
      // lands in the first of them. So: deliver the stream event, draw ONE
      // frame 100ms in (short of the latency, so the network leg is still in
      // flight), and only then settle past it.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pump(const Duration(milliseconds: 300));

      // The precondition, asserted rather than assumed. If this ever stops
      // being true the test below still passes and proves nothing — a harness
      // whose race window has quietly closed is the failure mode this file
      // already documents once (`_RaceyAuth`'s own doc).
      expect(
        find.byType(SettingsScreen),
        findsNothing,
        reason:
            'the router must have torn this page down while `signOut()` is '
            'still in flight — that is the window the defect lived in',
      );
      expect(auth.signOutCalls, 1, reason: 'the tap must reach the repository');

      // …and now let the network leg finish and the drops run.
      await tester.pumpAndSettle(const Duration(seconds: 2));

      expect(
        find.byType(LoginScreen),
        findsOneWidget,
        reason: 'the page really was replaced — the race window really opened',
      );
      expect(
        rawEntitlementCache(secure),
        isNull,
        reason:
            'THE BUG: the drops were resolved from a `ref` whose element the '
            'router had already disposed, so the clear never ran and the next '
            'person to sign in on this device inherits seven days of Pro',
      );
      expect(
        chassis.scheduled,
        isEmpty,
        reason:
            'the schedule is dropped on the same path, and for the same reason',
      );
      expect(
        fork.cancelAllCalls,
        greaterThan(0),
        reason:
            'the RENEWAL reminders live on Subly’s fork, not the chassis seam',
      );
      expect(
        find.text('Sign-out did not finish on this device. Please try again.'),
        findsNothing,
        reason:
            'the OTHER half of the same defect: the StateError landed in '
            '`_signOut`\'s catch, so a completely successful sign-out reported '
            'itself as failed',
      );
    },
  );
}
