import '../../data/models/subscription.dart';

class CategoryTotal {
  const CategoryTotal(this.name, this.value);
  final String name;
  final double value;
}

/// Pure derivations shared by Home / Insights / Budget / Calendar.
class SubMath {
  SubMath._();

  static double totalMonthly(List<Subscription> s) =>
      s.fold(0.0, (double a, Subscription x) => a + x.monthlyPrice);

  static List<CategoryTotal> categoryTotals(List<Subscription> s) {
    final Map<String, double> m = <String, double>{};
    for (final Subscription x in s) {
      m[x.category] = (m[x.category] ?? 0) + x.monthlyPrice;
    }
    final List<CategoryTotal> list = m.entries
        .map((MapEntry<String, double> e) => CategoryTotal(e.key, e.value))
        .toList();
    list.sort((CategoryTotal a, CategoryTotal b) => b.value.compareTo(a.value));
    return list;
  }

  static List<Subscription> byMonthlyDesc(List<Subscription> s) {
    final List<Subscription> l = List<Subscription>.of(s);
    l.sort((Subscription a, Subscription b) =>
        b.monthlyPrice.compareTo(a.monthlyPrice));
    return l;
  }

  static List<Subscription> upcoming(List<Subscription> s, DateTime now,
      {int take = 4}) {
    final List<Subscription> l = List<Subscription>.of(s);
    l.sort((Subscription a, Subscription b) =>
        a.daysUntil(now).compareTo(b.daysUntil(now)));
    return l.take(take).toList();
  }

  static List<Subscription> unused(List<Subscription> s) =>
      s.where((Subscription x) => x.unused).toList();

  /// What the user would keep, per month, by cancelling every row they have
  /// flagged unused.
  ///
  /// 🔴 THIS IS 0.00 FOR EVERY REAL USER, AND THE CALLER — NOT THIS FUNCTION —
  /// IS WHERE THAT HAS TO BE HANDLED. `Subscription.unused` is written in
  /// exactly two places: `data/seed/demo_data.dart` (the demo set) and
  /// `SeedApiClient.update`, relaying an `unused` field the API would have to
  /// send. **No control anywhere in the app sets it**, so on real rows
  /// [unused] returns an empty list and this fold returns 0.00, permanently.
  ///
  /// The ARITHMETIC is deliberately unchanged: `monthlyPrice` is the right unit
  /// for "you would keep this much every month", and normalising a yearly plan
  /// to a twelfth is exactly right for a recurring saving. The dishonesty was
  /// never the sum — it was rendering the sum when the input cannot exist. A
  /// "Potential savings £0.00" tile is not a zero, it is a missing feature
  /// wearing a number.
  ///
  /// ✅ So the rule for callers is: render this ONLY when `unused(s)` is
  /// non-empty. `home_screen.dart` already does (`if (showUnused &&
  /// unused.isNotEmpty)`). `insights_screen.dart` does NOT — it draws the
  /// savings card and its `/mo` pill unconditionally, with an
  /// `insightsNothingFlagged` line underneath, so a real user sees the pill
  /// read 0.00 beside "nothing flagged". That is the same defect one screen
  /// over and it is that file's to fix.
  static double savings(List<Subscription> s) =>
      unused(s).fold(0.0, (double a, Subscription x) => a + x.monthlyPrice);

  /// The money that will actually leave the account in the next [days] days.
  ///
  /// 🔴 `price`, NOT `monthlyPrice`, AND THE SWAP IS THE WHOLE FIGURE.
  /// `monthlyPrice` is a NORMALISED monthly share — a yearly plan divided by
  /// twelve — which is what makes `totalMonthly` comparable across cycles. It
  /// is the wrong unit for a horizon: a £120/yr renewal falling on Thursday
  /// takes **£120** off the card on Thursday, not £10. This summed the £10, so
  /// "DUE IN 7 DAYS" understated an imminent annual charge by 12x — and it
  /// understated it, which is the one direction a warning about money must not
  /// err in.
  ///
  /// A row is counted at most once because the window (`0..days`) is measured
  /// against the ONE `nextRenewal` each row carries; a 30-day horizon does not
  /// double-count a monthly plan that would also bill again in 31 days. That is
  /// a floor on the horizon, not a ceiling, and it is honest in the safe
  /// direction.
  static double dueWithin(List<Subscription> s, DateTime now, int days) =>
      s.where((Subscription x) {
        final int d = x.daysUntil(now);
        return d >= 0 && d <= days;
      }).fold(0.0, (double a, Subscription x) => a + x.price);
}
