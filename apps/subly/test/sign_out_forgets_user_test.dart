import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/features/auth/reaccept_terms_screen.dart';
import 'package:subly/features/auth/verify_email_screen.dart';
import 'package:subly/features/settings/settings_screen.dart';
import 'package:subly/l10n/app_localizations.dart';
import 'package:subly/state/providers.dart';

import 'support/user_state_fakes.dart';

/// WHAT A SIGN-OUT LEAVES BEHIND ON THE DEVICE.
///
/// 🔴 THE TWO DEFECTS THIS FILE EXISTS FOR, both found by asking who CALLS a
/// shipped, tested, exported capability:
///
///  (a) the Log out control was `onPressed: () => …signOut()` — not awaited and
///      not caught — while `SecureSessionStorage.removePersistedSession` throws
///      DELIBERATELY when it can neither delete the persisted session nor
///      tombstone it. The one caller of that answer discarded it, so a sign-out
///      that did not happen looked exactly like one that did, until the next
///      launch came back signed in.
///
///  (b) `EntitlementCache.clear()` had ZERO production call sites. The cache
///      honours a cached Pro answer offline for up to
///      `kEntitlementStalenessCeiling` — seven days — so the next person to sign
///      in on a shared, borrowed or resold device inherited the previous one's
///      subscription for a week. And nothing cancelled the renewal reminders, so
///      a deleted account went on notifying the device about itself.
///
/// Every assertion below is on STATE THAT SURVIVED, never on a call count: a
/// `cancelAll` that is counted and does not drop the schedule is the same
/// observation as one that works, and the device would still fire.
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

/// A signed-in user whose `signOut` can be made to fail the way the storage
/// layer really fails.
class _FakeAuth extends core.AuthRepository {
  _FakeAuth({this.signOutThrows = false});

  /// Stands in for `removePersistedSession`'s deliberate rethrow — the case
  /// where the session could be neither deleted nor tombstoned.
  final bool signOutThrows;

  bool signedIn = true;
  int signOutCalls = 0;
  int deleteCalls = 0;

  final StreamController<core.AuthUser?> _changes =
      StreamController<core.AuthUser?>.broadcast();

  @override
  core.AuthUser? get currentUser => signedIn
      ? const core.AuthUser(id: 'u1', email: 'a@b.test', emailVerified: true)
      : null;

  @override
  Stream<core.AuthUser?> authStateChanges() => _changes.stream;

  @override
  Future<void> signOut() async {
    signOutCalls++;
    if (signOutThrows) throw core.AuthFailure('keyring locked');
    signedIn = false;
    _changes.add(null);
  }

  @override
  Future<void> deleteAccount() async {
    deleteCalls++;
    // The real seam signs out whichever way the server request went.
    signedIn = false;
    _changes.add(null);
  }

  @override
  Future<core.AuthUser> signInWithEmail({
    required String email,
    required String password,
    String? captchaToken,
  }) async {
    signedIn = true;
    return currentUser!;
  }

  @override
  Future<core.AuthUser> signUpWithEmail({
    required String email,
    required String password,
    String? captchaToken,
  }) async => currentUser!;
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

({
  ProviderContainer container,
  MemSecureStore secure,
  FakeNotifications chassis,
  RecordingSublyNotifications fork,
})
_harness(_FakeAuth auth) {
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
  return (container: container, secure: secure, chassis: chassis, fork: fork);
}

Future<void> _pumpSettings(
  WidgetTester tester,
  ProviderContainer container,
) async {
  // Settings is a ListView: a tall surface renders the whole list, so the Log
  // out control has an element to tap rather than sitting below the fold.
  tester.view.physicalSize = const Size(1200, 4000);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: const MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: SettingsScreen()),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    '🔴 SIGNING OUT EMPTIES THE ENTITLEMENT CACHE AND CANCELS THE SCHEDULE',
    (WidgetTester tester) async {
      final _FakeAuth auth = _FakeAuth();
      final h = _harness(auth);
      await seedLifetimePro(h.container.read(entitlementCacheProvider));
      h.chassis.scheduled.add(
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
      expect(rawEntitlementCache(h.secure), isNotNull);
      expect(
        (await h.container.read(entitlementCacheProvider).readValid()).isPro,
        isTrue,
      );

      await _pumpSettings(tester, h.container);
      await tester.tap(find.text('Log out'));
      await tester.pumpAndSettle();

      expect(auth.signOutCalls, 1);
      expect(
        rawEntitlementCache(h.secure),
        isNull,
        reason:
            'the previous user’s Pro is honoured offline for seven days; left '
            'behind, the next person to sign in on this device inherits it',
      );
      expect(
        h.chassis.scheduled,
        isEmpty,
        reason: 'a cancelled schedule is one the device will not fire',
      );
      expect(
        h.fork.cancelAllCalls,
        greaterThan(0),
        reason:
            'the RENEWAL reminders live on Subly’s fork, not on the chassis '
            'service — cancelling only the chassis one changes nothing a user '
            'would notice',
      );
    },
  );

  testWidgets('🔴 DELETING THE ACCOUNT FORGETS IT ON THIS DEVICE TOO', (
    WidgetTester tester,
  ) async {
    final _FakeAuth auth = _FakeAuth();
    final h = _harness(auth);
    await seedLifetimePro(h.container.read(entitlementCacheProvider));
    h.chassis.scheduled.add(
      const core.DailyReminder(
        id: 1,
        title: 't',
        body: 'b',
        hour: 9,
        minute: 0,
      ),
    );

    await _pumpSettings(tester, h.container);
    await tester.tap(find.text('Delete account'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('deleteAccountPassword')),
      'correct-horse',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('deleteAccountConfirm')));
    await tester.pumpAndSettle();

    expect(auth.deleteCalls, 1);
    expect(
      rawEntitlementCache(h.secure),
      isNull,
      reason:
          'the account is gone; a cached Pro answer for it is the clearest '
          'case of state outliving the user it belonged to',
    );
    expect(h.chassis.scheduled, isEmpty);
    expect(
      h.fork.cancelAllCalls,
      greaterThan(0),
      reason:
          'a deleted user must stop being reminded about the subscriptions of '
          'an account that no longer exists',
    );
  });

  testWidgets('🔴 A SIGN-OUT THAT FAILS SAYS SO, AND STILL FORGETS THE USER', (
    WidgetTester tester,
  ) async {
    // `SecureSessionStorage.removePersistedSession` rethrows on purpose when it
    // can neither delete the session nor tombstone it (a Linux box with no
    // unlocked libsecret collection is the ordinary case). Before this, the one
    // caller of that deliberate answer threw it away.
    final _FakeAuth auth = _FakeAuth(signOutThrows: true);
    final h = _harness(auth);
    await seedLifetimePro(h.container.read(entitlementCacheProvider));

    await _pumpSettings(tester, h.container);
    await tester.tap(find.text('Log out'));
    await tester.pumpAndSettle();

    expect(
      find.text('Sign-out did not finish on this device. Please try again.'),
      findsOneWidget,
      reason:
          'a sign-out that threw and said nothing is indistinguishable from '
          'one that worked, until the next launch comes back signed in',
    );
    expect(
      rawEntitlementCache(h.secure),
      isNull,
      reason:
          'a failing sign-out is the case where local state is MOST likely to '
          'outlive the user, so the forget must not be skipped because of it',
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 🔴 THE OTHER TWO SESSION-ENDING CONTROLS, which shipped leaking while the
  // settings one was already fixed and a doc comment in `providers.dart`
  // asserted there were "both paths".
  //
  // Neither is an edge case. `ReacceptTermsScreen`'s Decline is reached by
  // EVERY signed-in user, including every Pro one, the moment `kTermsVersion`
  // moves — and it is the only way past an interstitial that is otherwise
  // "agree". `VerifyEmailScreen`'s is described in its own source as "the only
  // way OUT of the gate". Both called `signOut()` directly, so the previous
  // user's cached Pro survived them, which is the reported symptom exactly.
  //
  // Driven as widgets rather than asserted on the source, because
  // `assert-seams-wired.mjs`'s `session_end` trigger already asserts the shape;
  // what a guard cannot say is that the drop really reaches the store.
  for (final ({String name, Widget screen, Key control}) c
      in <({String name, Widget screen, Key control})>[
        (
          name: 'declining a terms change',
          screen: const ReacceptTermsScreen(),
          control: ReacceptTermsScreen.signOutButton,
        ),
        (
          name: 'signing out of the verify-email gate',
          screen: const VerifyEmailScreen(),
          control: VerifyEmailScreen.signOutButton,
        ),
      ]) {
    testWidgets('🔴 ${c.name} FORGETS THE USER TOO', (
      WidgetTester tester,
    ) async {
      tester.view.physicalSize = const Size(1200, 4000);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      final _FakeAuth auth = _FakeAuth();
      final h = _harness(auth);
      await seedLifetimePro(h.container.read(entitlementCacheProvider));
      h.chassis.scheduled.add(
        const core.DailyReminder(
          id: 1,
          title: 't',
          body: 'b',
          hour: 9,
          minute: 0,
        ),
      );
      expect(rawEntitlementCache(h.secure), isNotNull);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: h.container,
          child: MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: c.screen,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(c.control));
      await tester.pumpAndSettle();

      expect(auth.signOutCalls, 1, reason: 'the control must end the session');
      expect(
        rawEntitlementCache(h.secure),
        isNull,
        reason:
            'the previous user’s Pro is honoured offline for seven days; this '
            'control left it behind while the settings one did not',
      );
      expect(h.chassis.scheduled, isEmpty);
      expect(h.fork.cancelAllCalls, greaterThan(0));
    });
  }

  test('the cache is what the paywall reads, so emptying it re-locks', () async {
    // Guards the assertion above from being satisfied by a key nobody consults:
    // the value cleared has to be the one `readValid` answers from.
    final MemSecureStore secure = MemSecureStore();
    final core.EntitlementCache cache = core.EntitlementCache(store: secure);
    await seedLifetimePro(cache);
    expect(
      jsonDecode(rawEntitlementCache(secure)!),
      isA<Map<String, dynamic>>(),
    );
    expect((await cache.readValid()).isPro, isTrue);

    await cache.clear();
    expect(rawEntitlementCache(secure), isNull);
    expect((await cache.readValid()).isPro, isFalse);
  });
}
