import 'package:flutter/foundation.dart' show immutable;

/// How often a buyer is charged. Verbatim from the rail config — never inferred
/// from a price id, which is a vendor string we do not get to interpret.
enum OfferingTerm {
  month('month'),
  year('year'),
  oneTime('one_time');

  const OfferingTerm(this.wire);

  final String wire;

  /// Returns null for anything unrecognised. A term we cannot read is an
  /// offering we cannot describe, and an offering we cannot describe must not
  /// be shown with a guessed one — "billed monthly" on a yearly plan is a
  /// chargeback with a support ticket attached.
  static OfferingTerm? tryParse(Object? raw) {
    for (final OfferingTerm t in OfferingTerm.values) {
      if (t.wire == raw) return t;
    }
    return null;
  }
}

/// One purchasable plan, as the RAIL describes it — [pipeline 5]M-11.
///
/// ## Why there is no `priceString` field
/// The shape this replaces was `PurchaseOption(priceString: r'$2.99')`: a price
/// typed into Dart, compiled into a binary, and shipped to a store. It was
/// already wrong — the owner decided $4.99/mo and $19.99/yr on 2026-07-27 — and
/// nothing could have told us, because a hardcoded string is consistent with
/// itself forever. A displayed price that cannot disagree with the price the
/// buyer is charged is not a price; it is a decoration that happens to look like
/// one.
///
/// So the money is an AMOUNT and a CURRENCY, and the string is derived. When the
/// rail changes the price, every app changes with it at the next config fetch,
/// with no release.
@immutable
class Offering {
  const Offering({
    required this.productId,
    required this.amountMinor,
    required this.currencyCode,
    required this.term,
    required this.trialDays,
  });

  /// The merchant of record's own identifier for this price. OPAQUE: we never
  /// parse it, never derive a term from it, and never display it.
  final String productId;

  /// The charge in the currency's minor unit (499 = 4.99 USD). An integer
  /// because money in a double is a rounding bug waiting for a currency with
  /// three decimal places.
  final int amountMinor;

  /// ISO 4217, e.g. `USD`.
  final String currencyCode;

  final OfferingTerm term;

  /// Free-trial length in days; 0 when there is none.
  final int trialDays;

  /// The price as a buyer reads it, DERIVED from [amountMinor] and
  /// [currencyCode] — never a string somebody typed.
  ///
  /// 🔴 THE DERIVATION IS THE REQUIREMENT. A `display_price` field passed
  /// straight through from config would move the literal out of Dart and into
  /// JSON and satisfy nothing: the number displayed could still disagree with
  /// the number charged. `assert-no-price-literals.mjs` asserts this really
  /// computes.
  ///
  /// An UNKNOWN currency renders as `CODE 4.99` rather than guessing a symbol.
  /// A wrong symbol on a real charge is worse than a plain one.
  String get formattedPrice {
    final int units = _minorUnitDigits[currencyCode] ?? 2;
    final String major = units == 0
        ? '$amountMinor'
        : (amountMinor / _pow10(units)).toStringAsFixed(units);
    final String? symbol = _symbols[currencyCode];
    return symbol == null ? '$currencyCode $major' : '$symbol$major';
  }

  /// Currency symbols, and nothing beyond what is universally written that way.
  /// A code with no entry prints as the code — see [formattedPrice].
  static const Map<String, String> _symbols = <String, String>{
    'USD': r'$',
    'EUR': '€',
    'GBP': '£',
    'INR': '₹',
    'JPY': '¥',
    'AUD': r'A$',
    'CAD': r'C$',
  };

  /// Decimal places per currency. ISO 4217 is NOT uniform — JPY has none and
  /// KWD has three — so a hardcoded `/ 100` would misprice a yen plan by a
  /// factor of a hundred. Two is the default and covers everything sold today.
  static const Map<String, int> _minorUnitDigits = <String, int>{
    'JPY': 0,
    'KWD': 3,
  };

  static int _pow10(int n) {
    int r = 1;
    for (int i = 0; i < n; i++) {
      r *= 10;
    }
    return r;
  }

  /// Parses one offering, returning null on ANYTHING it cannot read.
  ///
  /// 🔴 FAIL CLOSED, AND THE CONSEQUENCE IS DELIBERATE: an offering that cannot
  /// be parsed is DROPPED, which means it cannot be displayed, which means it
  /// cannot be bought. The alternative — substituting a default — sells
  /// somebody a plan at a price nobody chose.
  static Offering? tryFromJson(Object? raw) {
    if (raw is! Map) return null;
    final Map<String, Object?> j = raw.cast<String, Object?>();
    final Object? id = j['product_id'];
    final Object? amount = j['amount_minor'];
    final Object? currency = j['currency_code'];
    final OfferingTerm? term = OfferingTerm.tryParse(j['term']);
    // `amount is int` excludes a JSON double: 4.99 arriving where 499 was meant
    // would silently sell at five paise. `> 0` excludes a free "purchase",
    // which is a config mistake and not a product.
    if (id is! String || id.isEmpty) return null;
    if (amount is! int || amount <= 0) return null;
    if (currency is! String || currency.length != 3) return null;
    if (term == null) return null;
    final Object? trial = j['trial_days'];
    return Offering(
      productId: id,
      amountMinor: amount,
      currencyCode: currency.toUpperCase(),
      term: term,
      // A missing trial is no trial. A NEGATIVE one is nonsense and is also no
      // trial — never a reason to drop an otherwise sellable plan.
      trialDays: trial is int && trial > 0 ? trial : 0,
    );
  }

  @override
  String toString() =>
      'Offering($productId, $amountMinor $currencyCode, ${term.wire}, '
      'trial ${trialDays}d)';
}
