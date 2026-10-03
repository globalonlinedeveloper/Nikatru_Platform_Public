import 'package:nikatru_core/nikatru_core.dart'
    show Cadence, Money, MoneyBag, MoneyFormatter;

/// A plan's NORMALISED monthly share: a monthly plan's price, or a yearly
/// plan's price divided by twelve (`Money.dividedBy`, half away from zero, so
/// twelve shares can land up to 6 minor units either side of the charge).
///
/// 🔴 A COMPARISON FIGURE, NEVER A CHARGE, AND THE TYPE IS WHAT SAYS SO. It
/// used to be a plain `Money` getter on `Subscription`, the same type as
/// the charge, so `money.format` took either and five screens printed a yearly
/// plan's twelfth where the user reads what leaves the account: "10.04 per
/// year" for a 120.53-a-year plan, and a calendar month total 12x short
/// (O-MONTHLY-SHARE-SHOWN-AS-A-CHARGE).
///
/// Deliberately NO `implements Money`: `money.format(share)`,
/// `share.times(12)` and `share.minorUnits` do not compile, so a share reaches
/// a screen only through [MonthlySharePrinting] and reaches arithmetic only
/// through [sum] and [descending]. An extension type is erased at compile time
/// on every backend, so this costs nothing at runtime.
extension type const MonthlyShare._(Money _amount) {
  /// A monthly plan's share is its price.
  const MonthlyShare.ofMonthly(Money price) : this._(price);

  /// A yearly plan's share is a twelfth of its price.
  MonthlyShare.ofYearly(Money price) : this._(price.dividedBy(12));

  /// Any cadence's share: price x (charges per year) / 12, rounded ONCE
  /// (half away from zero). Monthly and yearly land exactly on [ofMonthly]
  /// and [ofYearly] — 12/12 and 1/12 — so the two plans every row had before
  /// ST-T3b print what they printed.
  ///
  /// ⏱ 2026-09-30 · ST-P4 (round-2 F38): [shareNumerator] / [shareDenominator]
  /// is the user's own part of a shared plan ("my 1 of 3"), folded into the
  /// SAME single rounding — a third of a twelfth rounded twice is not a third
  /// of the price. 1/1, the default, is the whole price, exactly as before.
  factory MonthlyShare.of(
    Money price,
    Cadence cadence, {
    int shareNumerator = 1,
    int shareDenominator = 1,
  }) {
    final ({int numerator, int denominator}) r = cadence.chargesPerYear;
    final int over = r.denominator * 12 * shareDenominator;
    final int times = r.numerator * shareNumerator;
    if (times == over) return MonthlyShare.ofMonthly(price);
    return MonthlyShare._(price.times(times).dividedBy(over));
  }

  /// Per-currency sum; the result is a PER-MONTH total and is printed only
  /// under a per-month label.
  static MoneyBag sum(Iterable<MonthlyShare> shares) =>
      MoneyBag.sum(shares.map((MonthlyShare s) => s._amount));

  /// What [months] of this share add up to — the money a CANCELLED plan has
  /// not taken since (`SubMath.savedSinceCancelled`). A sum over whole months,
  /// so it is a real amount and prints as one.
  Money accruedOver(int months) => _amount.times(months);

  /// Larger first, within ONE currency. The cross-currency order is
  /// `SubMath`'s presentation rule, never a comparison of amounts.
  static int descending(MonthlyShare a, MonthlyShare b) {
    assert(
      a._amount.currencyCode == b._amount.currencyCode,
      'shares in two currencies do not compare',
    );
    return b._amount.minorUnits.compareTo(a._amount.minorUnits);
  }
}

/// The ONLY route from a [MonthlyShare] to a string.
extension MonthlySharePrinting on MoneyFormatter {
  /// The bare figure, ONLY as the argument of a message whose own text carries
  /// the per-month unit. Since ST-U3 no message does — the remove sheet's
  /// "savings" sentences were the last — so nothing in lib/ calls this;
  /// `test/monthly_share_display_test.dart` pins that, and uses it to prove the
  /// share never appears on screen.
  String formatShareFigure(MonthlyShare share) => format(share._amount);
}
