// 🔴 THE PROOF THAT "NOT LOADED" IS NEVER "NO SUBSCRIPTIONS" ON THE REMINDER
// PATH.
//
// `SubscriptionsController` re-syncs the OS reminder set on every settings
// and locale change. It used to feed the sync `state.value ?? const []`
// — so a settings change while the first fetch was still loading, or after it
// had failed, called `syncAll(const [])`, which cancelled every renewal
// reminder and scheduled none, on a device that still had every subscription.
// (#609 removed the same pattern from the five screens; the controller kept
// it.) `cancelSubscription` folded a failed state into an empty list the same
// way.
//
// MUTATION PROOF (run and recorded in the PR): make `observedList` return
// `state.value ?? const <Subscription>[]` and the mid-load, failed-load
// and cancel-with-no-list cases go red.
import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/data/api/api_client.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/payment_record.dart';
import 'package:subscriptiontracker/data/models/spend_history.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/services/notifications/notification_service.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/settings_controller.dart';
import 'package:subscriptiontracker/state/subscriptions_controller.dart';

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

/// Records every list the wiring hands to the OS-facing seams.
class _RecordingNotificationService extends RenewalReminders {
  _RecordingNotificationService() : super.forTesting();

  final List<List<Subscription>> synced = <List<Subscription>>[];
  int ownedCancels = 0;
  int cancelAlls = 0;

  @override
  Future<void> syncAll(
    List<Subscription> subs, {
    required ReminderCopy copy,
    ReminderRules rules = const ReminderRules(),
  }) async {
    synced.add(List<Subscription>.unmodifiable(subs));
  }

  @override
  Future<void> cancelOwnedRenewals() async {
    ownedCancels += 1;
  }

  @override
  Future<void> cancelAll() async {
    cancelAlls += 1;
  }

  @override
  Future<void> scheduleWeeklyDigest({
    required ReminderCopy copy,
    required int count,
    required String formattedTotal,
  }) async {}

  @override
  Future<void> cancelWeeklyDigest() async {}
}

Subscription _sub(String id) => Subscription(
  id: id,
  name: id,
  category: 'Entertainment',
  price: const Money(64900, 'INR'),
  cycle: BillingCycle.monthly,
  nextRenewal: DateTime(2030, 7, 22),
);

/// The API, reduced to a list behind a gate the test opens (or never does).
class _GatedApi implements ApiClient {
  _GatedApi(this.subs);
  List<Subscription> subs;
  Completer<void> gate = Completer<void>();
  Object? failure;

  @override
  Future<List<Subscription>> getSubscriptions() async {
    await gate.future;
    final Object? f = failure;
    if (f != null) throw f;
    return subs;
  }

  @override
  Future<Subscription> createSubscription(Subscription draft) async => draft;
  @override
  Future<Subscription> getSubscription(String id) async =>
      subs.firstWhere((Subscription s) => s.id == id);

  /// Applies the PATCH like the route does — `cancelSubscription` is a soft
  /// delete (`deleted_at`) since ST-T3b, so a fake that ignored the body
  /// would leave the row in every later fetch.
  @override
  Future<Subscription> updateSubscription(
    String id,
    Map<String, dynamic> changes,
  ) async {
    final Subscription updated = subs
        .firstWhere((Subscription s) => s.id == id)
        .patched(changes);
    subs = <Subscription>[
      for (final Subscription s in subs) s.id == id ? updated : s,
    ];
    return updated;
  }

  @override
  Future<void> deleteSubscription(String id) async {
    subs = subs.where((Subscription s) => s.id != id).toList();
  }

  // NO-10 · "Mark as paid": not exercised by this suite.
  @override
  Future<void> recordPayment(
    String id, {
    required Money amount,
    required DateTime paidOn,
    required String idempotencyKey,
  }) async {}

  @override
  Future<List<PaymentRecord>> getPaymentHistory(String id) async =>
      const <PaymentRecord>[];
  @override
  Future<SpendHistory> getSpendHistory() async => SpendHistory.empty;
  @override
  Future<BudgetInfo> getBudget() async => const BudgetInfo(
    monthlyBudget: Money(1, 'USD'),
    categories: <BudgetCap>[],
  );
  @override
  Future<BudgetInfo> updateBudget(BudgetInfo budget) async => budget;
  @override
  Future<core.Entitlements> getEntitlements() async => core.Entitlements.none;
}

ProviderContainer _container(
  _GatedApi api,
  _RecordingNotificationService notifier,
) {
  final ProviderContainer c = ProviderContainer(
    // As the app's root ProviderScope (main.dart): no automatic retry (Riverpod 3).
    retry: (int retryCount, Object error) => null,
    overrides: <Override>[
      keyValueStoreProvider.overrideWith((ref) async => _MemStore()),
      apiClientProvider.overrideWithValue(api),
      renewalRemindersProvider.overrideWithValue(notifier),
    ],
  );
  addTearDown(c.dispose);
  return c;
}

void main() {
  test(
    '🔴 a settings change MID-LOAD syncs nothing — reminders stay intact',
    () async {
      final _GatedApi api = _GatedApi(<Subscription>[_sub('netflix')]);
      final _RecordingNotificationService notifier =
          _RecordingNotificationService();
      final ProviderContainer c = _container(api, notifier);

      // Start the load; the gate is closed, so the controller is `loading`.
      final Future<List<Subscription>> loading = c.read(
        subscriptionsControllerProvider.future,
      );
      await Future<void>.delayed(Duration.zero);
      expect(c.read(subscriptionsControllerProvider).isLoading, isTrue);

      // The user flips a toggle while the list is still on its way.
      await c.read(settingsControllerProvider.notifier).toggle('weekly');
      await Future<void>.delayed(Duration.zero);

      expect(
        notifier.synced,
        isEmpty,
        reason:
            'a sync while loading used to be syncAll(const []) — every '
            'reminder cancelled, none scheduled',
      );
      expect(notifier.ownedCancels, 0);
      expect(notifier.cancelAlls, 0);

      // The list arrives: the ONE sync carries the real list.
      api.gate.complete();
      await loading;
      expect(notifier.synced, hasLength(1));
      expect(notifier.synced.single.map((Subscription s) => s.id), <String>[
        'netflix',
      ]);
    },
  );

  test('🔴 a settings change after a FAILED load syncs nothing', () async {
    final _GatedApi api = _GatedApi(<Subscription>[_sub('netflix')])
      ..failure = ApiException(0, 'Network error');
    api.gate.complete();
    final _RecordingNotificationService notifier =
        _RecordingNotificationService();
    final ProviderContainer c = _container(api, notifier);

    await expectLater(
      c.read(subscriptionsControllerProvider.future),
      throwsA(isA<ApiException>()),
    );
    expect(c.read(subscriptionsControllerProvider).hasError, isTrue);

    await c.read(settingsControllerProvider.notifier).toggle('weekly');
    await Future<void>.delayed(Duration.zero);

    expect(
      notifier.synced,
      isEmpty,
      reason: 'a failed load is not an empty list',
    );
    expect(notifier.ownedCancels, 0);
  });

  test('a settings change with a LOADED list re-syncs that list', () async {
    final _GatedApi api = _GatedApi(<Subscription>[_sub('a'), _sub('b')])
      ..gate.complete();
    final _RecordingNotificationService notifier =
        _RecordingNotificationService();
    final ProviderContainer c = _container(api, notifier);
    await c.read(subscriptionsControllerProvider.future);
    notifier.synced.clear();

    await c.read(settingsControllerProvider.notifier).toggle('weekly');
    await Future<void>.delayed(Duration.zero);

    expect(notifier.synced, hasLength(1));
    expect(notifier.synced.single, hasLength(2));
  });

  test('cancelSubscription with no observed list re-fetches rather than '
      'inventing an empty list', () async {
    final _GatedApi api = _GatedApi(<Subscription>[_sub('a'), _sub('b')])
      ..failure = ApiException(0, 'Network error');
    api.gate.complete();
    final _RecordingNotificationService notifier =
        _RecordingNotificationService();
    final ProviderContainer c = _container(api, notifier);
    await expectLater(
      c.read(subscriptionsControllerProvider.future),
      throwsA(isA<ApiException>()),
    );

    // The network is back; the cancel itself succeeds.
    api.failure = null;
    await c
        .read(subscriptionsControllerProvider.notifier)
        .cancelSubscription('a');
    final List<Subscription> after = await c.read(
      subscriptionsControllerProvider.future,
    );
    expect(after.map((Subscription s) => s.id), <String>['b']);
    // Never synced an EMPTY list on the way.
    expect(notifier.synced.where((List<Subscription> l) => l.isEmpty), isEmpty);
  });

  test('a sync failure is a STATE, not an uncaught error', () async {
    final _GatedApi api = _GatedApi(<Subscription>[_sub('a')])..gate.complete();
    final _ThrowingNotificationService notifier =
        _ThrowingNotificationService();
    final ProviderContainer c = ProviderContainer(
      // As the app's root ProviderScope (main.dart): no automatic retry (Riverpod 3).
      retry: (int retryCount, Object error) => null,
      overrides: <Override>[
        keyValueStoreProvider.overrideWith((ref) async => _MemStore()),
        apiClientProvider.overrideWithValue(api),
        renewalRemindersProvider.overrideWithValue(notifier),
      ],
    );
    addTearDown(c.dispose);
    final List<Subscription> list = await c.read(
      subscriptionsControllerProvider.future,
    );
    expect(list, hasLength(1), reason: 'the list survives a reminder failure');
    expect(c.read(reminderSyncFailureProvider), isA<UnimplementedError>());
  });
}

/// The desktop plugin as it was: a throw out of the schedule.
class _ThrowingNotificationService extends RenewalReminders {
  _ThrowingNotificationService() : super.forTesting();

  @override
  Future<void> syncAll(
    List<Subscription> subs, {
    required ReminderCopy copy,
    ReminderRules rules = const ReminderRules(),
  }) async {
    throw UnimplementedError('zonedSchedule() has not been implemented');
  }

  @override
  Future<void> cancelWeeklyDigest() async {}
}
