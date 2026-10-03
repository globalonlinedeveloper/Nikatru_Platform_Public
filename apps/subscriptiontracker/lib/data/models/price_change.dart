import 'package:nikatru_core/nikatru_core.dart' show Money;

import 'subscription.dart' show Subscription;

/// One price edit on a subscription — a row of the API's `price_change`
/// table, served as `price_history` on `GET /v1/subscriptions/:id` (0005,
/// ST-I4) and, until train ST-detail-stop, read by nothing in this app (DE-05).
///
/// Each side keeps its OWN currency: a row edited from ₹499 to $9.99 changed
/// both the amount and the unit, and the timeline says so rather than printing
/// two numbers in one currency.
class PriceChange {
  const PriceChange({
    required this.changedOn,
    required this.from,
    required this.to,
  });

  /// When the edit was saved (the API's `changed_at`, an instant).
  final DateTime changedOn;
  final Money from;
  final Money to;

  /// Whether the edit raised the price. A change of currency is neither a
  /// rise nor a fall — there is no rate table, and there must not be one.
  bool get isRise =>
      from.currencyCode == to.currencyCode && to.minorUnits > from.minorUnits;

  factory PriceChange.fromJson(
    Map<String, dynamic> j, {
    required String fallbackCurrencyCode,
  }) => PriceChange(
    changedOn: DateTime.parse(j['changed_at'] as String).toLocal(),
    from: _side(j, 'old', fallbackCurrencyCode),
    to: _side(j, 'new', fallbackCurrencyCode),
  );

  /// `<side>_price_minor` when it is an int that IS the decimal `<side>_price`
  /// (or there is no decimal), else the decimal; `<side>_currency`, else
  /// [fallback] — `Subscription.readPrice`'s rule, for the same reason (a
  /// pre-#1174 row holds a KRW or BHD amount at two minor digits).
  static Money _side(Map<String, dynamic> j, String side, String fallback) {
    final Object? rawCode = j['${side}_currency'];
    final String code = rawCode is String && rawCode.length == 3
        ? rawCode.toUpperCase()
        : fallback;
    final Object? minor = j['${side}_price_minor'];
    final Object? major = j['${side}_price'];
    if (minor is int) return Subscription.exactOrDecimal(minor, major, code);
    return Money.fromMajorUnits((major as num?) ?? 0, code);
  }
}
