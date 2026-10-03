import 'package:nikatru_core/nikatru_core.dart' show Money;

import 'payment_record.dart';

/// One price edit the user made to a plan — a `price_change` row
/// (0005_lifecycle_history_categories.sql, [ADR no.077] §5.2, ST-I4).
///
/// A record of what the USER typed, not of a charge: `payment_history` is the
/// charges. [before] or [after] is null only when the row carries neither the
/// exact amount nor the decimal one for that side.
class PlanPriceChange {
  const PlanPriceChange({
    required this.subscriptionId,
    required this.changedAt,
    required this.before,
    required this.after,
  });

  final String subscriptionId;
  final DateTime changedAt;
  final Money? before;
  final Money? after;

  /// Whether this edit RAISED the price: both sides known, in one currency,
  /// and the new amount larger. A currency change is not a rise — the two
  /// amounts do not compare.
  bool get isRise {
    final Money? a = before;
    final Money? b = after;
    return a != null &&
        b != null &&
        a.currencyCode == b.currencyCode &&
        b.minorUnits > a.minorUnits;
  }

  /// The rise as a whole percent of the old price (rounded half up), or null
  /// when [isRise] is false or the old price was zero.
  int? get risePercent {
    final Money? a = before;
    final Money? b = after;
    if (!isRise || a == null || b == null || a.minorUnits == 0) return null;
    return ((b.minorUnits - a.minorUnits) * 100 + a.minorUnits ~/ 2) ~/
        a.minorUnits;
  }

  factory PlanPriceChange.fromJson(
    Map<String, dynamic> j, {
    String fallbackCurrencyCode = Money.fallbackCurrencyCode,
  }) => PlanPriceChange(
    subscriptionId: j['subscription_id'].toString(),
    changedAt: DateTime.parse(j['changed_at'] as String),
    before: _side(j, 'old', fallbackCurrencyCode),
    after: _side(j, 'new', fallbackCurrencyCode),
  );

  /// `<side>_price_minor` when it is an integer, else `<side>_price`; the
  /// currency is `<side>_currency`, else the user's.
  static Money? _side(Map<String, dynamic> j, String side, String fallback) {
    final Object? rawCode = j['${side}_currency'];
    final String code = rawCode is String && rawCode.length == 3
        ? rawCode.toUpperCase()
        : fallback;
    final Object? minor = j['${side}_price_minor'];
    if (minor is int) return Money(minor, code);
    final Object? major = j['${side}_price'];
    if (major is num) return Money.fromMajorUnits(major, code);
    return null;
  }
}

/// The user's charges and price edits across every plan, over a window —
/// what `GET /v1/insights` serves (ST-P6 trend, ST-I4 price-rise alert).
class SpendHistory {
  const SpendHistory({required this.payments, required this.priceChanges});

  /// No history: the unconfigured posture before any charge, or a user who
  /// has none yet. Every reader treats it as "nothing to draw", never as zero.
  static const SpendHistory empty = SpendHistory(
    payments: <PaymentRecord>[],
    priceChanges: <PlanPriceChange>[],
  );

  final List<PaymentRecord> payments;
  final List<PlanPriceChange> priceChanges;

  bool get isEmpty => payments.isEmpty && priceChanges.isEmpty;

  factory SpendHistory.fromJson(
    Map<String, dynamic> j, {
    String fallbackCurrencyCode = Money.fallbackCurrencyCode,
  }) => SpendHistory(
    payments: <PaymentRecord>[
      for (final Object? p in (j['payments'] as List<dynamic>?) ?? <dynamic>[])
        PaymentRecord.fromJson(
          p! as Map<String, dynamic>,
          fallbackCurrencyCode: fallbackCurrencyCode,
        ),
    ],
    priceChanges: <PlanPriceChange>[
      for (final Object? c
          in (j['price_changes'] as List<dynamic>?) ?? <dynamic>[])
        PlanPriceChange.fromJson(
          c! as Map<String, dynamic>,
          fallbackCurrencyCode: fallbackCurrencyCode,
        ),
    ],
  );
}
