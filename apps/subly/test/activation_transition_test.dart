import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/data/models/subscription.dart';
import 'package:subly/data/subscriptions/subscription_repository.dart';
import 'package:subly/services/notifications/notification_service.dart';
import 'package:subly/state/analytics_funnel.dart';
import 'package:subly/state/providers.dart';
import 'package:subly/state/subscriptions_controller.dart';

/// ACTIVATION MUST KEY OFF A REAL TRANSITION.
///
/// `activation` is a once-per-install signal and the denominator the whole funnel
/// is read against. `SubscriptionsController.addSubscription` decided whether it
/// had fired by reading `state.valueOrNull ?? const []` — so a list that was
/// still LOADING, or one whose fetch had FAILED, was indistinguishable from a
/// user who owns nothing, and an add during either state re-fired activation on
/// an install that activated months ago. Nothing could go red: the event was
/// logged successfully, it was just a lie, and a false activation cannot be told
/// from a real one after the fact.
///
/// Absent is not empty. These tests pin that distinction.
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

/// Records event names instead of touching a transport.
class _RecordingAnalytics implements core.Analytics {
  final List<String> events = <String>[];
  @override
  Future<void> log(String event, {Map<String, Object?>? params}) async =>
      events.add(event);
  @override
  Future<void> flush() async {}
  @override
  Future<void> purge() async => events.clear();
}

/// The list source, under the test's control: it can hang (still loading), throw
/// (failed) or answer.
class _FakeRepository implements SubscriptionRepository {
  _FakeRepository({this.initial = const <Subscription>[]});

  List<Subscription> initial;
  Completer<List<Subscription>>? pending;
  Object? fetchError;

  @override
  Future<List<Subscription>> fetchAll() {
    final Object? err = fetchError;
    if (err != null) return Future<List<Subscription>>.error(err);
    final Completer<List<Subscription>>? p = pending;
    if (p != null) return p.future;
    return Future<List<Subscription>>.value(initial);
  }

  @override
  Future<Subscription> add(Subscription draft) async => Subscription(
    id: 'created',
    name: draft.name,
    category: draft.category,
    price: draft.price,
    cycle: draft.cycle,
    nextRenewal: draft.nextRenewal,
  );

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName} is not under test');
}

class _SilentNotifications extends NotificationService {
  _SilentNotifications() : super.forTesting();
  @override
  Future<void> syncAll(
    List<Subscription> subs, {
    required ReminderCopy copy,
    int daysBefore = 2,
  }) async {}
  @override
  Future<void> cancelAll() async {}
  @override
  Future<void> scheduleWeeklyDigest({
    required ReminderCopy copy,
    required int count,
    required String formattedTotal,
  }) async {}
  @override
  Future<void> cancelWeeklyDigest() async {}
}

Subscription _draft() => Subscription(
  id: '',
  name: 'Hulu',
  category: 'Other',
  price: 9.99,
  cycle: BillingCycle.monthly,
  nextRenewal: DateTime.utc(2026, 9, 1),
);

({ProviderContainer container, _RecordingAnalytics analytics}) _harness(
  _FakeRepository repo,
) {
  final _RecordingAnalytics analytics = _RecordingAnalytics();
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      keyValueStoreProvider.overrideWith((Ref ref) async => _MemStore()),
      subscriptionRepositoryProvider.overrideWithValue(repo),
      sublyNotificationServiceProvider.overrideWithValue(
        _SilentNotifications(),
      ),
      analyticsFunnelProvider.overrideWith(
        (Ref ref) async => AnalyticsFunnel(analytics: analytics),
      ),
    ],
  );
  addTearDown(c.dispose);
  return (container: c, analytics: analytics);
}

void main() {
  group('G-12 activation fires on a transition, not on an absent value', () {
    test('an OBSERVED empty list then a first add DOES activate', () async {
      final _FakeRepository repo = _FakeRepository();
      final ({ProviderContainer container, _RecordingAnalytics analytics}) h =
          _harness(repo);
      await h.container.read(analyticsFunnelProvider.future);
      await h.container.read(subscriptionsControllerProvider.future);

      await h.container
          .read(subscriptionsControllerProvider.notifier)
          .addSubscription(_draft());

      expect(h.analytics.events, contains('activation'));
    });

    test('an OBSERVED non-empty list does not activate again', () async {
      final _FakeRepository repo = _FakeRepository(
        initial: <Subscription>[
          Subscription(
            id: 'existing',
            name: 'Netflix',
            category: 'Other',
            price: 15,
            cycle: BillingCycle.monthly,
            nextRenewal: DateTime.utc(2026, 9, 1),
          ),
        ],
      );
      final ({ProviderContainer container, _RecordingAnalytics analytics}) h =
          _harness(repo);
      await h.container.read(analyticsFunnelProvider.future);
      await h.container.read(subscriptionsControllerProvider.future);

      await h.container
          .read(subscriptionsControllerProvider.notifier)
          .addSubscription(_draft());

      expect(h.analytics.events, isNot(contains('activation')));
    });

    test('a STILL-LOADING list is not an empty list', () async {
      // The user taps Add before the first fetch has answered — on a cold start
      // over a slow connection, which is exactly when it happens.
      final _FakeRepository repo = _FakeRepository()
        ..pending = Completer<List<Subscription>>();
      final ({ProviderContainer container, _RecordingAnalytics analytics}) h =
          _harness(repo);
      await h.container.read(analyticsFunnelProvider.future);
      // Start the build but do NOT let it settle.
      final SubscriptionsController controller = h.container.read(
        subscriptionsControllerProvider.notifier,
      );
      expect(
        h.container.read(subscriptionsControllerProvider).hasValue,
        isFalse,
        reason: 'precondition: the list has never been observed',
      );

      await controller.addSubscription(_draft());

      expect(
        h.analytics.events,
        isNot(contains('activation')),
        reason:
            'a list nobody has seen yet is not evidence that the user owns nothing',
      );
      repo.pending!.complete(const <Subscription>[]);
    });

    test('a FAILED list is not an empty list', () async {
      final _FakeRepository repo = _FakeRepository()
        ..fetchError = StateError('offline');
      final ({ProviderContainer container, _RecordingAnalytics analytics}) h =
          _harness(repo);
      await h.container.read(analyticsFunnelProvider.future);
      await expectLater(
        h.container.read(subscriptionsControllerProvider.future),
        throwsA(isA<StateError>()),
      );

      await h.container
          .read(subscriptionsControllerProvider.notifier)
          .addSubscription(_draft());

      expect(
        h.analytics.events,
        isNot(contains('activation')),
        reason: 'a fetch that failed says nothing about how many subs exist',
      );
    });
  });
}
