import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/app.dart';
import 'package:subscriptiontracker/core/app_config.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/state/money_providers.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/subscriptions_controller.dart';

/// ⏱ 2026-09-30 · ST-N6 (D23, F37) and AB-M3-03 — a return to the app
/// re-reads the list and the plan, and a change of account re-reads the plan.
///
/// Every read here used to happen ONCE per process: a web tab left open, or a
/// phone app back from the background, showed what the server said at launch.
/// Each case below counts requests at a fake seam and fails on the base (one
/// GET, where a return must make two).

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

class _MemSecureStore implements core.SecureStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<void> delete(String key) async => data.remove(key);
  @override
  Future<void> deleteAll() async => data.clear();
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

Subscription _sub(String id) => Subscription(
  id: id,
  name: 'Sub $id',
  category: 'Other',
  price: const Money(100, 'USD'),
  cycle: BillingCycle.monthly,
  nextRenewal: DateTime.utc(2026, 10, 30),
);

/// `GET /v1/subscriptions`, counted. [answers] is what each successive fetch
/// returns; a [StateError] entry is thrown instead (a flat network).
class _CountingRepository implements SubscriptionRepository {
  _CountingRepository(this.answers);

  final List<Object> answers;
  int fetches = 0;

  @override
  Future<List<Subscription>> fetchAll() async {
    final Object answer = answers[fetches.clamp(0, answers.length - 1)];
    fetches++;
    if (answer is StateError) throw answer;
    return answer as List<Subscription>;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName} is not under test');
}

/// `GET /v1/entitlements`, counted; [isPro] is what the server says NOW.
class _CountingServer implements core.EntitlementTransport {
  bool isPro = true;
  int fetches = 0;

  @override
  Future<core.Result<core.Entitlements>> fetch({
    required String appId,
    required String? accessToken,
  }) async {
    fetches++;
    return core.Result<core.Entitlements>.ok(
      core.Entitlements(
        appId: appId,
        isPro: isPro,
        items: const <core.Entitlement>[],
      ),
    );
  }
}

/// A config that has a paywall, so the lock reads the entitlement.
final core.AppConfig _selling = core.AppConfig(
  appId: AppConfig.appId,
  apiBaseUrl: AppConfig.apiBaseUrl,
  features: const <String, bool>{},
  paywall: const core.PaywallConfig(enabled: true, extra: <String, Object?>{}),
  contentPack: null,
  copy: const <String, String>{},
  minSupportedVersion: '1.0.0',
);

void _backToTheFront(WidgetTester tester) {
  for (final AppLifecycleState s in <AppLifecycleState>[
    AppLifecycleState.inactive,
    AppLifecycleState.hidden,
    AppLifecycleState.paused,
    AppLifecycleState.hidden,
    AppLifecycleState.inactive,
    AppLifecycleState.resumed,
  ]) {
    tester.binding.handleAppLifecycleStateChanged(s);
  }
}

void main() {
  group('a return to the app, through the REAL root (SublyApp)', () {
    late DateTime now;
    late _CountingRepository repo;
    late _CountingServer server;
    late ProviderContainer c;

    Future<void> launch(WidgetTester tester) async {
      now = DateTime.utc(2026, 9, 30, 12);
      c = ProviderContainer(
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((_) async => _MemStore()),
          secureStoreProvider.overrideWithValue(_MemSecureStore()),
          nowProvider.overrideWithValue(() => now),
          subscriptionRepositoryProvider.overrideWithValue(repo),
          appConfigProvider.overrideWith((_) async => _selling),
          entitlementTransportProvider.overrideWithValue(server),
        ],
      );
      addTearDown(c.dispose);
      // Alive and read, as the home screen keeps them.
      c.listen(subscriptionsControllerProvider, (_, _) {});
      c.listen(paywallLockedProvider, (_, _) {});
      await tester.pumpWidget(
        UncontrolledProviderScope(container: c, child: const SublyApp()),
      );
      await tester.pumpAndSettle(const Duration(milliseconds: 400));
    }

    testWidgets('D23/F37: paused -> resumed GETs the list again (2, not 1)', (
      WidgetTester tester,
    ) async {
      repo = _CountingRepository(<Object>[
        <Subscription>[_sub('a')],
        <Subscription>[_sub('a'), _sub('from-another-device')],
      ]);
      server = _CountingServer();
      await launch(tester);
      expect(repo.fetches, 1);

      now = now.add(const Duration(minutes: 5));
      _backToTheFront(tester);
      await tester.pumpAndSettle(const Duration(milliseconds: 400));

      expect(repo.fetches, 2, reason: 'the return re-read the list');
      expect(
        c.read(subscriptionsControllerProvider).requireValue.map((s) => s.id),
        <String>['a', 'from-another-device'],
      );
    });

    testWidgets('AB-M3-03: a refund elsewhere locks the paywall on return', (
      WidgetTester tester,
    ) async {
      repo = _CountingRepository(<Object>[<Subscription>[]]);
      server = _CountingServer();
      await launch(tester);
      expect(c.read(paywallLockedProvider), isFalse);

      server.isPro = false; // refunded on another target
      now = now.add(const Duration(minutes: 5));
      _backToTheFront(tester);
      await tester.pumpAndSettle(const Duration(milliseconds: 400));

      expect(c.read(paywallLockedProvider), isTrue);
    });

    testWidgets('a focus flick inside the floor re-reads nothing', (
      WidgetTester tester,
    ) async {
      repo = _CountingRepository(<Object>[<Subscription>[]]);
      server = _CountingServer();
      await launch(tester);
      final int before = server.fetches;

      now = now.add(const Duration(seconds: 3));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle(const Duration(milliseconds: 400));

      expect(repo.fetches, 1);
      expect(server.fetches, before);
    });
  });

  group('SubscriptionsController.refresh', () {
    ProviderContainer container(_CountingRepository repo) {
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((_) async => _MemStore()),
          subscriptionRepositoryProvider.overrideWithValue(repo),
        ],
      );
      addTearDown(c.dispose);
      c.listen(subscriptionsControllerProvider, (_, _) {});
      return c;
    }

    test('a failed re-read keeps the list the user already has', () async {
      final _CountingRepository repo = _CountingRepository(<Object>[
        <Subscription>[_sub('a'), _sub('b')],
        StateError('offline'),
      ]);
      final ProviderContainer c = container(repo);
      await c.read(subscriptionsControllerProvider.future);

      await c.read(subscriptionsControllerProvider.notifier).refresh();

      final SubscriptionsController ctl = c.read(
        subscriptionsControllerProvider.notifier,
      );
      expect(repo.fetches, 2);
      expect(ctl.observedList?.map((s) => s.id), <String>['a', 'b']);
    });

    test('a failed FIRST load is retried by refresh', () async {
      final _CountingRepository repo = _CountingRepository(<Object>[
        StateError('offline'),
        <Subscription>[_sub('a')],
      ]);
      final ProviderContainer c = container(repo);
      await expectLater(
        c.read(subscriptionsControllerProvider.future),
        throwsA(isA<StateError>()),
      );

      await c.read(subscriptionsControllerProvider.notifier).refresh();
      final List<Subscription> list = await c.read(
        subscriptionsControllerProvider.future,
      );
      expect(list.map((s) => s.id), <String>['a']);
    });
  });

  test(
    'AB-M3-03: signing in as someone else re-reads the plan for them',
    () async {
      final StreamController<core.AuthUser?> auth =
          StreamController<core.AuthUser?>();
      addTearDown(auth.close);
      final _CountingServer server = _CountingServer();
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          secureStoreProvider.overrideWithValue(_MemSecureStore()),
          appConfigProvider.overrideWith((_) async => _selling),
          authUserProvider.overrideWith((_) => auth.stream),
          entitlementTransportProvider.overrideWithValue(server),
        ],
      );
      addTearDown(c.dispose);
      c.listen(entitlementsProvider, (_, _) {});
      c.listen(authUserProvider, (_, _) {});

      auth.add(const core.AuthUser(id: 'a', email: 'a@example.test'));
      await Future<void>.delayed(Duration.zero);
      await c.read(entitlementsProvider.future);
      expect(server.fetches, 1, reason: 'the launch read, and only that');

      auth.add(const core.AuthUser(id: 'b', email: 'b@example.test'));
      await Future<void>.delayed(Duration.zero);
      await c.read(entitlementsProvider.future);
      expect(server.fetches, 2, reason: 'account B is asked about, not A');

      auth.add(const core.AuthUser(id: 'b', email: 'b@example.test'));
      await Future<void>.delayed(Duration.zero);
      await c.read(entitlementsProvider.future);
      expect(server.fetches, 2, reason: 'the same account again is no change');
    },
  );
}
