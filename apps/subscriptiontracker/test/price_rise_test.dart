// ST-I4 (round-2 X09) — a price rise raises an alert in "Worth a look", read
// from the price_change log (0005) that GET /v1/insights serves.
//
// Red control: on the base (fbe498ac) signals.dart says "PRICE RISE IS NOT
// DRAWN" — there is no `PlanPriceChange`, no `PriceRiseSignal`, and `signalsFor`
// takes no price history; this file does not compile there.
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/data/models/spend_history.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/features/insights/signals.dart';

final DateTime _now = DateTime(2026, 9, 30, 12);

Subscription _row(String id, {SubscriptionStatus? status}) => Subscription(
  id: id,
  name: 'Plan $id',
  category: 'Cat $id',
  price: const Money(79900, 'INR'),
  cycle: BillingCycle.monthly,
  nextRenewal: DateTime(2026, 10, 20),
  status: status ?? SubscriptionStatus.active,
);

PlanPriceChange _change(
  String id,
  int from,
  int to, {
  int daysAgo = 3,
  String fromCode = 'INR',
  String toCode = 'INR',
}) => PlanPriceChange(
  subscriptionId: id,
  changedAt: _now.subtract(Duration(days: daysAgo)),
  before: Money(from, fromCode),
  after: Money(to, toCode),
);

List<PriceRiseSignal> _rises(
  List<Subscription> subs,
  List<PlanPriceChange> changes,
) => signalsFor(
  subs,
  _now,
  answered: subs.map((Subscription s) => s.id).toSet(),
  priceChanges: changes,
).whereType<PriceRiseSignal>().toList();

void main() {
  test('RED CONTROL: a price rise raises an alert, first in the list', () {
    final List<InsightSignal> all = signalsFor(
      <Subscription>[_row('a')],
      _now,
      priceChanges: <PlanPriceChange>[_change('a', 64900, 79900)],
    );
    expect(all.first, isA<PriceRiseSignal>());
    final PriceRiseSignal r = all.first as PriceRiseSignal;
    expect(r.sub.id, 'a');
    expect(r.change.risePercent, 23); // 649 → 799 is +23.1 %
  });

  test('a cut, a currency change, or an old rise is no alert', () {
    expect(
      _rises(
        <Subscription>[_row('a')],
        <PlanPriceChange>[_change('a', 79900, 64900)],
      ),
      isEmpty,
    );
    expect(
      _rises(
        <Subscription>[_row('a')],
        <PlanPriceChange>[_change('a', 799, 79900, fromCode: 'USD')],
      ),
      isEmpty,
    );
    expect(
      _rises(
        <Subscription>[_row('a')],
        <PlanPriceChange>[_change('a', 64900, 79900, daysAgo: 91)],
      ),
      isEmpty,
    );
  });

  test('only the LATEST edit counts: a rise taken back is not a rise', () {
    expect(
      _rises(
        <Subscription>[_row('a')],
        <PlanPriceChange>[
          _change('a', 64900, 79900, daysAgo: 10),
          _change('a', 79900, 64900, daysAgo: 2),
        ],
      ),
      isEmpty,
    );
  });

  test('a paused plan, or one not in the list, raises nothing', () {
    expect(
      _rises(
        <Subscription>[_row('a', status: SubscriptionStatus.paused)],
        <PlanPriceChange>[_change('a', 64900, 79900)],
      ),
      isEmpty,
    );
    expect(
      _rises(
        <Subscription>[_row('a')],
        <PlanPriceChange>[_change('zzz', 64900, 79900)],
      ),
      isEmpty,
    );
  });

  test('newest rise first', () {
    final List<PriceRiseSignal> r = _rises(
      <Subscription>[_row('a'), _row('b')],
      <PlanPriceChange>[
        _change('a', 100, 200, daysAgo: 20),
        _change('b', 100, 200, daysAgo: 1),
      ],
    );
    expect(r.map((PriceRiseSignal s) => s.sub.id), <String>['b', 'a']);
  });

  test(
    'PlanPriceChange decodes the wire: exact amounts first, then decimals',
    () {
      final PlanPriceChange c = PlanPriceChange.fromJson(<String, dynamic>{
        'id': 'x',
        'subscription_id': 'a',
        'old_price': 649,
        'new_price': 799,
        'old_price_minor': null,
        'new_price_minor': 79900,
        'old_currency': null,
        'new_currency': 'inr',
        'changed_at': '2026-09-27T10:00:00.000Z',
      }, fallbackCurrencyCode: 'INR');
      expect(c.before, const Money(64900, 'INR'));
      expect(c.after, const Money(79900, 'INR'));
      expect(c.isRise, isTrue);
    },
  );
}
