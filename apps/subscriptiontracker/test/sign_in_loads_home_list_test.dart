// ⏱ 2026-10-02 · ruling on #1155 (pre-merge E2E run 37047693623, f95c8012):
// A SIGN-IN LANDS ON HOME WITH THE LIST LOADED, NOT "YOUR SESSION HAS ENDED".
//
// The E2E signed in (the clickwrap interstitial was served, so the session
// was valid) and Home said "We couldn't load your subscriptions | Your session
// has ended." — `dataFailedBodyFor` on an `ApiException(401)`.
//
// CAUSE. T16 mounted `DeviceSurfacesHost` at the app ROOT, and it listened to
// `subscriptionsControllerProvider` with `fireImmediately: true` so the glance
// is written on every sync. That built the (keep-alive) list controller at
// BOOT, on the sign-in screen, with nobody signed in: the list read went out
// with no bearer token, the Worker answered 401, and the controller kept that
// error. Nothing rebuilt it when the session arrived, so the first Home after
// sign-in showed the signed-out failure. Before T16 only a signed-in screen
// ever built the controller.
//
// The fake API below answers exactly as the deployed Worker does: 401 to a
// read made with no session, the list to one made with a session.
//
// RED CONTROLS: drop the `ref.listen(authUserProvider, …)` from
// `SubscriptionsController.build` AND restore the host's unconditional
// `listenManual(subscriptionsControllerProvider, fireImmediately: true)` and
// the first case goes red on the failure text; restore only the latter and the
// second case does (a list read with nobody signed in); drop only the former
// and the third case does (the 401 outlives the sign-in).
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart' show ApiException;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/app.dart';
import 'package:subscriptiontracker/data/api/seed_api_client.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/features/auth/login_screen.dart';
import 'package:subscriptiontracker/features/home/home_screen.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/subscriptions_controller.dart';

import 'support/mock_auth_repository.dart';
import 'support/user_state_fakes.dart';
import 'support/width_harness.dart' show MemStore;

/// The deployed Worker's answer, by whether the request carried a session.
class _WorkerLikeApi extends SeedApiClient {
  _WorkerLikeApi(this.auth);
  final MockAuthRepository auth;
  int signedOutReads = 0;
  int signedInReads = 0;

  @override
  Future<List<Subscription>> getSubscriptions() async {
    if (await auth.currentAccessToken() == null) {
      signedOutReads++;
      throw ApiException(401, 'unauthorized');
    }
    signedInReads++;
    return super.getSubscriptions();
  }
}

void main() {
  late MockAuthRepository auth;
  late _WorkerLikeApi api;
  late ProviderContainer c;

  Future<void> bootSignedOut(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1200, 4000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    auth = MockAuthRepository();
    api = _WorkerLikeApi(auth);
    final MemStore store = MemStore()
      ..data['nikatru.onboarding_seen'] = 'true'
      ..data['nikatru.signed_in_before'] = 'true';
    // The ROOT's policy (`rootProviderScope`): no automatic retry. Riverpod's
    // default retry would re-read the failed list after the sign-in and hide
    // exactly the stuck 401 this file is about.
    c = ProviderContainer(
      retry: noProviderRetry,
      overrides: <Override>[
        keyValueStoreProvider.overrideWith((_) async => store),
        authRepositoryProvider.overrideWithValue(auth),
        apiClientProvider.overrideWithValue(api),
        legalReacceptanceNeededProvider.overrideWithValue(false),
        analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
        secureStoreProvider.overrideWithValue(MemSecureStore()),
        notificationServiceProvider.overrideWithValue(FakeNotifications()),
        renewalRemindersProvider.overrideWithValue(
          RecordingSublyNotifications(),
        ),
      ],
    );
    addTearDown(c.dispose);
    await tester.pumpWidget(
      UncontrolledProviderScope(container: c, child: const SublyApp()),
    );
    await tester.pumpAndSettle(const Duration(milliseconds: 400));
    expect(find.byType(LoginScreen), findsOneWidget);
  }

  testWidgets('signing in from a cold, signed-out boot lands on Home with the '
      'list loaded, not "Your session has ended"', (WidgetTester tester) async {
    await bootSignedOut(tester);

    await auth.signInWithEmail(email: 'a@b.test', password: 'pw');
    await tester.pumpAndSettle(const Duration(milliseconds: 400));

    expect(find.byType(HomeScreen), findsWidgets);
    expect(
      find.textContaining('Your session has ended'),
      findsNothing,
      reason:
          'Home kept the 401 a signed-out boot read earned (E2E run '
          '37047693623)',
    );
    final AsyncValue<List<Subscription>> list = c.read(
      subscriptionsControllerProvider,
    );
    expect(list.hasError, isFalse, reason: '${list.error}');
    expect(list.value, isNotEmpty);
    expect(api.signedInReads, greaterThan(0));
  });

  testWidgets('nothing reads the list while nobody is signed in', (
    WidgetTester tester,
  ) async {
    await bootSignedOut(tester);
    // The invariant `refreshOnReturn` documents: ONLY A LIST THAT EXISTS.
    expect(
      c.exists(subscriptionsControllerProvider),
      isFalse,
      reason: 'something mounted on /sign-in built the list',
    );
    expect(
      api.signedOutReads,
      0,
      reason:
          'a list read went out with no session — the Worker answers it 401 '
          'and the 401 handler runs a sign-out for a user who is not there',
    );
  });

  test(
    'a list read before the session existed is read again at sign-in',
    () async {
      final MockAuthRepository auth = MockAuthRepository();
      final _WorkerLikeApi api = _WorkerLikeApi(auth);
      final ProviderContainer c = ProviderContainer(
        retry: noProviderRetry,
        overrides: <Override>[
          authRepositoryProvider.overrideWithValue(auth),
          apiClientProvider.overrideWithValue(api),
          keyValueStoreProvider.overrideWith((_) async => MemStore()),
          secureStoreProvider.overrideWithValue(MemSecureStore()),
          notificationServiceProvider.overrideWithValue(FakeNotifications()),
          renewalRemindersProvider.overrideWithValue(
            RecordingSublyNotifications(),
          ),
        ],
      );
      addTearDown(c.dispose);
      // Any root-level reader (the glance did) keeps the list alive.
      c.listen(subscriptionsControllerProvider, (_, _) {});
      await expectLater(
        c.read(subscriptionsControllerProvider.future),
        throwsA(isA<ApiException>()),
      );

      await auth.signInWithEmail(email: 'a@b.test', password: 'pw');
      await pumpEventQueue();

      final List<Subscription> subs = await c.read(
        subscriptionsControllerProvider.future,
      );
      expect(subs, isNotEmpty);
      expect(api.signedInReads, 1);
    },
  );
}
