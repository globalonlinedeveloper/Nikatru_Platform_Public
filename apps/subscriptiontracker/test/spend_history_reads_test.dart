// ─────────────────────────────────────────────────────────────────────────────
// spend_history_reads_test.dart — `spendHistoryProvider` re-reads
// `GET /v1/insights` when what it serves can have changed (a price, a removed
// plan), and NOT on every change of the list state (PR #1154 review NIT 6).
//
// RED CONTROL: watch the whole `subscriptionsControllerProvider` again (the
// head of #1154) and the rename case reads twice.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/data/models/spend_history.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/subscriptions_controller.dart';

import 'support/width_harness.dart';

Subscription _row() => Subscription(
  id: 'sub-1',
  name: 'Netflix',
  category: 'Streaming',
  price: const Money(64900, 'INR'),
  cycle: BillingCycle.monthly,
  nextRenewal: DateTime(2030, 3, 14),
);

class _Repo implements SubscriptionRepository {
  final List<Subscription> rows = <Subscription>[_row()];
  int reads = 0;

  @override
  Future<List<Subscription>> fetchAll() async => rows;

  @override
  Future<Subscription> update(String id, Map<String, dynamic> changes) async {
    final int i = rows.indexWhere((Subscription s) => s.id == id);
    return rows[i] = rows[i].patched(changes);
  }

  @override
  Future<SpendHistory> spendHistory() async {
    reads++;
    return SpendHistory.empty;
  }

  @override
  dynamic noSuchMethod(Invocation i) =>
      throw UnimplementedError('${i.memberName} is not under test');
}

void main() {
  testWidgets('a rename does not re-read /v1/insights; a price edit does', (
    WidgetTester tester,
  ) async {
    final _Repo repo = _Repo();
    final ProviderContainer c = ProviderContainer(
      overrides: <Override>[
        ...defaultWidthOverrides(),
        subscriptionRepositoryProvider.overrideWithValue(repo),
      ],
    );
    c.listen(spendHistoryProvider, (_, _) {});
    await c.read(subscriptionsControllerProvider.future);
    await c.read(spendHistoryProvider.future);
    await tester.pump();
    final int afterLoad = repo.reads;
    expect(afterLoad, greaterThanOrEqualTo(1));

    final SubscriptionsController ctl = c.read(
      subscriptionsControllerProvider.notifier,
    );
    await ctl.updateSubscription('sub-1', <String, dynamic>{
      'name': 'Netflix 4K',
    });
    await tester.pump();
    await c.read(spendHistoryProvider.future);
    expect(
      repo.reads,
      afterLoad,
      reason: 'a rename moves no charge and no price',
    );

    await ctl.updateSubscription('sub-1', <String, dynamic>{
      'price': 799,
      'price_minor': 79900,
      'currency': 'INR',
    });
    await tester.pump();
    await c.read(spendHistoryProvider.future);
    expect(
      repo.reads,
      greaterThan(afterLoad),
      reason: 'a price edit writes a price_change row',
    );
    // The controller's own write-behind timers, drained after the container.
    c.dispose();
    await tester.pump(const Duration(minutes: 1));
  });
}
