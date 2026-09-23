import 'package:nikatru_core/nikatru_core.dart'
    show Money, MoneyBag, MoneyFormatter;

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

  /// Per-currency sum; the result is a PER-MONTH total and is printed only
  /// under a per-month label.
  static MoneyBag sum(Iterable<MonthlyShare> shares) =>
      MoneyBag.sum(shares.map((MonthlyShare s) => s._amount));

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
  /// the per-month unit (`cancelStep1Body` and `cancelStep2Body`, both
  /// "{monthly}/mo"). `test/monthly_share_display_test.dart` pins its callers.
  String formatShareFigure(MonthlyShare share) => format(share._amount);
}
