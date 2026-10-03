// ST-P6 (round-2 X07) — "set aside each month" for a plan that bills less
// often than monthly: pure arithmetic, on the Pro card.
//
// Red control: on the base (fbe498ac) there is no `SubMath.setAsidePerMonth`
// and no save-per-month line on Insights; this file does not compile there.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/core/format/sub_math.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';

import 'support/pro_card_harness.dart';

Subscription _row(
  String id,
  int minor,
  Cadence cycle, {
  int num = 1,
  int den = 1,
  String code = 'INR',
}) => Subscription(
  id: id,
  name: 'Plan $id',
  category: 'Cloud',
  price: Money(minor, code),
  cycle: cycle,
  nextRenewal: DateTime.now().add(const Duration(days: 90)),
  shareNumerator: num,
  shareDenominator: den,
);

void main() {
  test('RED CONTROL: a ₹1200/yr row shows ₹100/month to save', () {
    expect(
      SubMath.setAsidePerMonth(_row('y', 120000, BillingCycle.yearly)),
      const Money(10000, 'INR'),
    );
  });

  test('quarterly is a third; every 2 years is a 24th', () {
    expect(
      SubMath.setAsidePerMonth(_row('q', 30000, Cadence.quarterly)),
      const Money(10000, 'INR'),
    );
    expect(
      SubMath.setAsidePerMonth(
        _row('b', 240000, const Cadence(2, CycleUnit.year)),
      ),
      const Money(10000, 'INR'),
    );
  });

  test('rounds UP, so twelve set-asides never fall short of the charge', () {
    final Money m = SubMath.setAsidePerMonth(
      _row('y', 100000, BillingCycle.yearly),
    )!;
    expect(m, const Money(8334, 'INR'));
    expect(m.minorUnits * 12, greaterThanOrEqualTo(100000));
  });

  test('my share only (ST-P4): a yearly plan split 3 ways', () {
    expect(
      SubMath.setAsidePerMonth(
        _row('y', 360000, BillingCycle.yearly, num: 1, den: 3),
      ),
      const Money(10000, 'INR'),
    );
  });

  test('monthly, weekly and daily plans have nothing to save ahead for', () {
    for (final Cadence c in <Cadence>[
      BillingCycle.monthly,
      Cadence.weekly,
      const Cadence(10, CycleUnit.day),
    ]) {
      expect(SubMath.setAsidePerMonth(_row('m', 999, c)), isNull, reason: '$c');
    }
  });

  test('setAsides lists the charging long-cycle plans only', () {
    final Subscription paused = _row(
      'p',
      120000,
      BillingCycle.yearly,
    ).copyWith(status: SubscriptionStatus.paused);
    final List<({Subscription sub, Money perMonth})> out =
        SubMath.setAsides(<Subscription>[
          _row('y', 120000, BillingCycle.yearly),
          _row('m', 999, BillingCycle.monthly),
          paused,
        ]);
    expect(
      out.map((({Subscription sub, Money perMonth}) a) => a.sub.id),
      <String>['y'],
    );
  });

  testWidgets('the Pro card prints the line', (WidgetTester tester) async {
    await pumpProCard(tester, <Subscription>[
      _row('y', 120000, BillingCycle.yearly),
      _row('m', 999, BillingCycle.monthly),
    ]);
    final Finder line = find.byKey(const Key('insights.setAside.y'));
    expect(line, findsOneWidget);
    expect(
      (tester.widget(line) as Text).data,
      allOf(contains('100.00'), contains('Plan y'), contains('1,200.00')),
    );
    expect(find.byKey(const Key('insights.setAside.m')), findsNothing);
  });
}
