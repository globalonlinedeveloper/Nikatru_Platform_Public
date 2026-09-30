import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/data/api/api_client.dart';
import 'package:subscriptiontracker/data/api/cached_api_client.dart';
import 'package:subscriptiontracker/data/local/subscription_store.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/payment_record.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/mock_auth_repository.dart';

// 🔴 REVIEW #1075 ROUND 2, MAJOR 2 — the offline copy belongs to one account,
// and EVERY sign-out path drops it, the forced 401 included. The cache's own
// mechanics (the epoch, a read in flight at sign-out, a joined request, the
// fresh window) are proven in packages/api_client/test/read_through_cache_test.

/// A session the server has revoked: the 401 path signs it out.
class _Revoked extends MockAuthRepository {
  int signOuts = 0;
  @override
  Future<bool> sessionIsGone() async => true;
  @override
  Future<void> signOut({
    core.SignOutScope scope = core.SignOutScope.local,
  }) async {
    signOuts += 1;
    await super.signOut(scope: scope);
  }
}

class _Network implements ApiClient {
  _Network(this.rows);
  List<Subscription> rows;
  bool offline = false;

  Never _down() => throw ApiException(0, 'Network error');

  @override
  Future<List<Subscription>> getSubscriptions() async =>
      offline ? _down() : rows;
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
  Future<BudgetInfo> getBudget() async => _down();
  @override
  Future<BudgetInfo> updateBudget(BudgetInfo budget) async => _down();
  @override
  Future<core.Entitlements> getEntitlements() async => _down();
}

Subscription _row(String id, String name) => Subscription(
  id: id,
  name: name,
  category: 'Streaming',
  price: const core.Money(64900, 'INR'),
  cycle: BillingCycle.monthly,
  nextRenewal: DateTime.utc(2026, 10, 1),
);

void main() {
  late core.InMemoryKeyValueStore kv;
  late String? user;
  CachedApiClient client(ApiClient net) => CachedApiClient(
    net,
    LocalSubscriptionStore(Future<core.KeyValueStore>.value(kv)),
    currentUser: () => user,
  );

  setUp(() {
    kv = core.InMemoryKeyValueStore();
    user = 'user-a';
  });

  test('after a 401 sign-out the cache is empty', () async {
    final _Network net = _Network(<Subscription>[_row('a', "A's gym")]);
    final CachedApiClient c = client(net);
    await c.getSubscriptions();
    expect(await kv.read('$kLocalSubscriptionsKey.u.user-a'), isNotNull);

    final _Revoked auth = _Revoked();
    await signOutOnlyIfSessionIsGone(auth, onSignedOut: c.forgetCache);

    expect(auth.signOuts, 1);
    expect(await kv.read('$kLocalSubscriptionsKey.u.user-a'), isNull);
    // Offline, nothing is left to serve anyone.
    net.offline = true;
    await expectLater(c.getSubscriptions(), throwsA(isA<ApiException>()));
  });

  test("the next user is never shown the previous user's list", () async {
    final _Network net = _Network(<Subscription>[_row('a', "A's gym")]);
    await client(net).getSubscriptions();
    user = 'user-b'; // a forced sign-out ran no drops; B signs in, offline
    net.offline = true;
    await expectLater(
      client(net).getSubscriptions(),
      throwsA(isA<ApiException>()),
      reason: 'B has no copy of its own, and is never served A\'s',
    );
  });

  test('the production wiring drops the copy on the 401 path and on the '
      'explicit sign-out', () {
    // A SOURCE reading: the configured branch is compile-time (see
    // subscriptions_survive_restart_test.dart for the same two-halves proof);
    // the behaviour itself is the first test above.
    final String providers = File(
      'lib/state/providers/subscriptions.dart',
    ).readAsStringSync();
    expect(providers, contains('onSignedOut: () async {'));
    expect(providers, contains('await client.forgetCache()'));
    final String auth = File(
      'lib/state/providers/auth.dart',
    ).readAsStringSync();
    expect(auth, contains('await api.forgetCache();'));
  });
}
