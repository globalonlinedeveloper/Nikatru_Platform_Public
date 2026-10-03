import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/data/api/api_client.dart';
import 'package:subscriptiontracker/data/local/subscription_store.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/payment_record.dart';
import 'package:subscriptiontracker/data/models/spend_history.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/state/providers.dart';

// The provider half of the offline train (ST-N5): a list served from the copy
// is STATE (audit D19), and a failed cache write reaches the crash sink
// (AB-O2-03). The cache's own mechanics are proven in
// packages/api_client/test/read_through_cache_test.dart.

class _RefusingStore implements core.KeyValueStore {
  @override
  Future<bool> containsKey(String key) async => false;
  @override
  Future<String?> read(String key) async => null;
  @override
  Future<void> remove(String key) async {}
  @override
  Future<void> write(String key, String value) async =>
      throw StateError('disk full');
}

class _Network implements ApiClient {
  bool offline = false;
  final List<Subscription> subs = <Subscription>[
    Subscription(
      id: 'a',
      name: 'Netflix',
      category: 'Streaming',
      price: const core.Money(64900, 'INR'),
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime.utc(2026, 10, 1),
    ),
  ];

  Never _down() => throw ApiException(0, 'Network error');

  @override
  Future<List<Subscription>> getSubscriptions() async =>
      offline ? _down() : subs;
  @override
  Future<Subscription> createSubscription(Subscription draft) async => _down();
  @override
  Future<Subscription> getSubscription(String id) async => _down();
  @override
  Future<Subscription> updateSubscription(
    String id,
    Map<String, dynamic> changes,
  ) async => _down();
  @override
  Future<void> deleteSubscription(String id) async => _down();
  @override
  Future<List<PaymentRecord>> getPaymentHistory(String id) async => _down();
  @override
  Future<SpendHistory> getSpendHistory() async => _down();
  // NO-10 · "Mark as paid": not exercised by this suite.
  @override
  Future<void> recordPayment(
    String id, {
    required core.Money amount,
    required DateTime paidOn,
    required String idempotencyKey,
  }) async => _down();
  @override
  Future<BudgetInfo> getBudget() async => _down();
  @override
  Future<BudgetInfo> updateBudget(BudgetInfo budget) async => _down();
  @override
  Future<core.Entitlements> getEntitlements() async => _down();
}

void main() {
  // 🔴 AUDIT D19 — the red control. `lastReadWasFromCache` had no consumer
  // anywhere; the list served from the copy now reaches a provider a surface
  // can mark (the banner is ST-D1 D1-5).
  test('a list served from the cache exposes a stale provider', () async {
    final ProviderContainer container = ProviderContainer();
    addTearDown(container.dispose);
    final core.InMemoryKeyValueStore kv = core.InMemoryKeyValueStore();
    LocalSubscriptionStore store() =>
        LocalSubscriptionStore(Future<core.KeyValueStore>.value(kv));
    final _Network net = _Network();
    void report(bool stale) =>
        container.read(staleReadProvider.notifier).report(stale: stale);

    await cachedApiClientOver(
      net,
      store(),
      onStaleChanged: report,
    ).getSubscriptions();
    expect(container.read(staleReadProvider), isFalse);

    net.offline = true;
    final List<Subscription> shown = await cachedApiClientOver(
      net,
      store(),
      onStaleChanged: report,
    ).getSubscriptions();
    expect(shown.single.name, 'Netflix');
    expect(container.read(staleReadProvider), isTrue);
  });

  test(
    'the production wiring reports staleness and re-reads on revalidation',
    () {
      // A SOURCE reading: no test can flip the compile-time API define (see
      // subscriptions_survive_restart_test.dart for the same two-halves proof).
      final String src = File(
        'lib/state/providers/subscriptions.dart',
      ).readAsStringSync();
      final int start = src.indexOf('apiClientProvider = Provider<ApiClient>');
      final String body = src.substring(start, src.indexOf('});', start));
      expect(body, contains('staleReadProvider.notifier'));
      expect(body, contains('onRevalidated:'));
    },
  );

  // 🔴 AB-O2-03 — the red control. Production passed no `onCacheWriteFailed`,
  // so a failed mirror reached only `debugPrint`: the crash sink saw nothing.
  test(
    'when the store throws on write, the crash sink receives one report',
    () async {
      final List<FlutterErrorDetails> sink = <FlutterErrorDetails>[];
      final FlutterExceptionHandler? before = FlutterError.onError;
      FlutterError.onError = sink.add;
      addTearDown(() => FlutterError.onError = before);

      final ApiClient client = cachedApiClientOver(
        _Network(),
        LocalSubscriptionStore(
          Future<core.KeyValueStore>.value(_RefusingStore()),
        ),
      );
      expect(await client.getSubscriptions(), hasLength(1));
      expect(sink, hasLength(1));
      expect(sink.single.library, 'subscriptions_cache');
      expect('${sink.single.exception}', contains('disk full'));
    },
  );
}
