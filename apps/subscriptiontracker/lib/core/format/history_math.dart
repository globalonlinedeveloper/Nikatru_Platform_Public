import 'package:nikatru_core/nikatru_core.dart' show Money, MoneyBag;

import '../../data/models/payment_record.dart';
import '../../data/models/spend_history.dart';
import '../../data/models/subscription.dart';

/// Pure derivations over what the user was actually CHARGED and what they
/// edited — the [SpendHistory] — where [SubMath] derives from the rows held.
///
/// ⏱ 2026-09-30 · ST-P6 (round-2 F23) and ST-I4 (round-2 X09). The six-month
/// trend removed on 2026-07-27 plotted five invented figures, because the app
/// held no history. It holds one now: `payment_history`, written by the
/// platform's nightly renewals pass and by "mark as paid", served by
/// `GET /v1/insights`. So a trend can come back, and every point is a sum of
/// real charges.
class HistoryMath {
  HistoryMath._();

  /// How many months a trend covers: this month and the eleven before it.
  static const int trendMonths = 12;

  /// How long a price rise stays worth a look.
  static const int priceRiseDays = 90;

  /// What was charged in each of the [trendMonths] months ending with [now]'s
  /// month, oldest first — always [trendMonths] points, a month with no charge
  /// an EMPTY bag (not a zero in some currency), so a chart can tell "nothing
  /// was charged" from "no history".
  static List<({DateTime month, MoneyBag charged})> spendTrend(
    List<PaymentRecord> payments,
    DateTime now,
  ) {
    final DateTime first = DateTime(now.year, now.month - (trendMonths - 1));
    final List<List<Money>> buckets = <List<Money>>[
      for (int k = 0; k < trendMonths; k++) <Money>[],
    ];
    for (final PaymentRecord p in payments) {
      final int k =
          (p.date.year - first.year) * 12 + (p.date.month - first.month);
      if (k >= 0 && k < trendMonths) buckets[k].add(p.amount);
    }
    return <({DateTime month, MoneyBag charged})>[
      for (int k = 0; k < trendMonths; k++)
        (
          month: DateTime(first.year, first.month + k),
          charged: MoneyBag.sum(buckets[k]),
        ),
    ];
  }

  /// Whether [trend] holds any charge at all — a trend with none is not drawn.
  static bool hasSpend(List<({DateTime month, MoneyBag charged})> trend) =>
      trend.any((({DateTime month, MoneyBag charged}) m) => !m.charged.isEmpty);

  /// The most recent RISE per plan in [changes], within [priceRiseDays] of
  /// [now], for the CHARGING plans in [subs] only — a paused or removed plan's
  /// rise costs the user nothing. Newest first.
  ///
  /// Only the LATEST edit of a plan counts: a rise the user then took back is
  /// not a rise, so a plan whose newest edit lowered the price has none.
  static List<({Subscription sub, PlanPriceChange change})> priceRises(
    List<Subscription> subs,
    List<PlanPriceChange> changes,
    DateTime now,
  ) {
    final Map<String, PlanPriceChange> latest = <String, PlanPriceChange>{};
    for (final PlanPriceChange c in changes) {
      final PlanPriceChange? seen = latest[c.subscriptionId];
      if (seen == null || c.changedAt.isAfter(seen.changedAt)) {
        latest[c.subscriptionId] = c;
      }
    }
    final DateTime since = now.subtract(const Duration(days: priceRiseDays));
    final List<({Subscription sub, PlanPriceChange change})> out =
        <({Subscription sub, PlanPriceChange change})>[
          for (final Subscription s in subs)
            if (s.isCharging)
              if (latest[s.id] case final PlanPriceChange c)
                if (c.isRise && !c.changedAt.isBefore(since))
                  (sub: s, change: c),
        ];
    out.sort(
      (
        ({Subscription sub, PlanPriceChange change}) a,
        ({Subscription sub, PlanPriceChange change}) b,
      ) => b.change.changedAt.compareTo(a.change.changedAt),
    );
    return out;
  }
}
