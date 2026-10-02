import 'package:nikatru_core/nikatru_core.dart'
    show FxTable, FxTableBags, MoneyBag;

/// Totals in the user's HOME currency (T12, IN-06): every amount the rate
/// table can price is converted into [home] and summed; anything it cannot
/// price stays beside the total in its own currency.
///
/// 🔴 ONLY TOTALS CONVERT. A row still prints its own price in its own
/// currency — that is what the user is charged — and only a figure that ADDS
/// rows (a tile, the budget, a category) is folded into one number, with a
/// caption that names the rates it used (`FxCaption`).
///
/// With no table ([fx] null — a first launch offline, a demo build) every
/// total is returned untouched: grouped by currency, exactly as before.
class HomeTotals {
  const HomeTotals(this.fx, this.home);

  final FxTable? fx;
  final String home;

  /// [bag] in [home] where the table can price it.
  MoneyBag of(MoneyBag bag) => fx?.convertBag(bag, home).bag ?? bag;

  /// Whether converting [bag] actually changed a currency — a caption is owed.
  bool converts(MoneyBag bag) => fx?.convertBag(bag, home).converted ?? false;
}
