// ST-P6 (round-2 F23) — the spending trend is back, drawn from payment_history
// (GET /v1/insights) and nothing else.
//
// Red control: on the base (fbe498ac) there is no trend at all — the
// 2026-07-27 removal note in insights_screen.dart — so there is no
// `HistoryMath`, no `spendHistoryProvider`, and no `insights.trend` node; this
// file does not compile there.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' show MoneyBag;
import 'package:subscriptiontracker/core/format/history_math.dart';
import 'package:subscriptiontracker/data/models/payment_record.dart';
import 'package:subscriptiontracker/data/models/spend_history.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';

import 'support/pro_card_harness.dart';

PaymentRecord _p(DateTime d, int minor, [String code = 'INR']) =>
    PaymentRecord(date: d, amount: Money(minor, code));

List<Subscription> _subs() => <Subscription>[
  Subscription(
    id: 'n',
    name: 'Netflix',
    category: 'Video',
    price: const Money(64900, 'INR'),
    cycle: BillingCycle.monthly,
    nextRenewal: DateTime.now().add(const Duration(days: 5)),
  ),
];

void main() {
  group('HistoryMath.spendTrend', () {
    final DateTime now = DateTime(2026, 9, 30);

    test('always 12 months, oldest first, ending with this month', () {
      final List<({DateTime month, MoneyBag charged})> t =
          HistoryMath.spendTrend(const <PaymentRecord>[], now);
      expect(t, hasLength(12));
      expect(t.first.month, DateTime(2025, 10));
      expect(t.last.month, DateTime(2026, 9));
      expect(HistoryMath.hasSpend(t), isFalse);
    });

    test(
      'each charge lands in its own month; outside the window is dropped',
      () {
        final List<({DateTime month, MoneyBag charged})> t =
            HistoryMath.spendTrend(<PaymentRecord>[
              _p(DateTime(2026, 9, 3), 64900),
              _p(DateTime(2026, 9, 20), 19900),
              _p(DateTime(2025, 10, 1), 100),
              _p(DateTime(2025, 9, 30), 99999), // one day before the window
              _p(DateTime(2026, 3, 3), 799, 'USD'),
            ], now);
        expect(t.last.charged.single, const Money(84800, 'INR'));
        expect(t.first.charged.single, const Money(100, 'INR'));
        expect(t[5].charged.single, const Money(799, 'USD'));
        expect(t[1].charged.isEmpty, isTrue);
      },
    );
  });

  test('SpendHistory decodes GET /v1/insights', () {
    final SpendHistory h = SpendHistory.fromJson(<String, dynamic>{
      'since': '2025-10-01',
      'payments': <dynamic>[
        <String, dynamic>{
          'id': 'p',
          'amount': 649,
          'paid_at': '2026-09-03T00:00:00Z',
          'currency': 'INR',
        },
      ],
      'price_changes': <dynamic>[],
    }, fallbackCurrencyCode: 'USD');
    expect(h.payments.single.amount, const Money(64900, 'INR'));
    expect(h.priceChanges, isEmpty);
  });

  group('the Pro card', () {
    testWidgets('RED CONTROL: a trend computed from payment_history renders '
        '12 points', (WidgetTester tester) async {
      final DateTime now = DateTime.now();
      await pumpProCard(
        tester,
        _subs(),
        history: SpendHistory(
          payments: <PaymentRecord>[
            for (int k = 0; k < 12; k++)
              _p(DateTime(now.year, now.month - k, 3), 64900),
          ],
          priceChanges: const <PlanPriceChange>[],
        ),
      );
      final Finder trend = find.byKey(const Key('insights.trend'));
      expect(trend, findsOneWidget);
      expect(
        find.descendant(of: trend, matching: find.byType(FractionallySizedBox)),
        findsNWidgets(12),
      );
      // The sentence carries the real sum: 12 x 649.
      expect(find.textContaining('7,788'), findsWidgets);
    });

    testWidgets('no charge recorded: a sentence, never twelve empty bars', (
      WidgetTester tester,
    ) async {
      await pumpProCard(tester, _subs(), history: SpendHistory.empty);
      expect(find.byKey(const Key('insights.trend')), findsNothing);
      expect(find.byKey(const Key('insights.trend.none')), findsOneWidget);
    });

    testWidgets('a failed read (null) draws no trend at all', (
      WidgetTester tester,
    ) async {
      await pumpProCard(tester, _subs());
      expect(find.byKey(const Key('insights.trend')), findsNothing);
      expect(find.byKey(const Key('insights.trend.none')), findsNothing);
      // The forecast itself still stands.
      expect(
        find.byKey(const Key('insights.forecast.unlocked')),
        findsOneWidget,
      );
    });
  });
}
