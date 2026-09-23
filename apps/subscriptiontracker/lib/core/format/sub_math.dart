import 'package:nikatru_core/nikatru_core.dart' show Money, MoneyBag;

import '../../data/models/subscription.dart';
import 'monthly_share.dart';

class CategoryTotal {
  const CategoryTotal(this.name, this.value);
  final String name;

  /// A bag, not a [Money]: one category can hold rows in two currencies, and
  /// there is no rate table here to collapse them with.
  final MoneyBag value;
}

/// Pure derivations shared by Home / Insights / Budget / Calendar.
///
/// 🔴 EVERY TOTAL HERE IS A [MoneyBag], AND THAT IS THE DEFECT BEING CLOSED.
/// These folds used to run over `double`, which meant a user with a dollar
/// subscription and a rupee one got a single number that was the sum of two
/// unlike units — arithmetically fine, financially meaningless, and impossible
/// for anything downstream to detect because it looked exactly like a real
/// total. A bag keeps the subtotals apart; the formatter renders every one of
/// them. There is deliberately no conversion (see `Money`): an honest
/// cross-currency figure needs a DATED rate, and v1 has no source for one.
///
/// For the overwhelmingly common single-currency user, every function below
/// produces a one-entry bag and every screen renders exactly what it did.
class SubMath {
  SubMath._();

  /// The per-month total of every plan's [MonthlyShare]. A PER-MONTH figure:
  /// it is printed only under a per-month label, never as a charge.
  static MoneyBag totalMonthly(List<Subscription> s) =>
      MonthlyShare.sum(s.map((Subscription x) => x.monthlyShare));

  /// What the plans charge in a year: each row's [Subscription.yearlyCharge].
  ///
  /// 🔴 NOT `totalMonthly(s).times(12)`. Twelve rounded twelfths of a yearly
  /// price are not the price (120.53 a year is a 10.04 share, and 12 x 10.04
  /// is 120.48), so a yearly figure is summed from the charges themselves.
  static MoneyBag totalYearly(List<Subscription> s) =>
      MoneyBag.sum(s.map((Subscription x) => x.yearlyCharge));

  /// The money that leaves the account in [month] of [year]: the whole
  /// [Subscription.price] of every row whose one renewal falls in it.
  ///
  /// 🔴 `price`, NOT THE SHARE, for the reason [dueWithin] gives: a yearly
  /// renewal in March takes the whole yearly price in March. The calendar
  /// summed the twelfth and read 12x short in the month the money went.
  static MoneyBag chargedInMonth(List<Subscription> s, int year, int month) =>
      MoneyBag.sum(
        s
            .where((Subscription x) => x.renewsIn(year, month))
            .map((Subscription x) => x.price),
      );

  static List<CategoryTotal> categoryTotals(List<Subscription> s) {
    final Map<String, List<MonthlyShare>> m = <String, List<MonthlyShare>>{};
    for (final Subscription x in s) {
      (m[x.category] ??= <MonthlyShare>[]).add(x.monthlyShare);
    }
    final List<CategoryTotal> list = m.entries
        .map(
          (MapEntry<String, List<MonthlyShare>> e) =>
              CategoryTotal(e.key, MonthlyShare.sum(e.value)),
        )
        .toList();
    final List<String> order = _order(s);
    list.sort((CategoryTotal a, CategoryTotal b) {
      final int byAmount = _compareDesc(
        _orderKey(a.value),
        _orderKey(b.value),
        order,
      );
      return byAmount != 0 ? byAmount : _compareNames(a.name, b.name);
    });
    return list;
  }

  static List<Subscription> byMonthlyDesc(List<Subscription> s) {
    final List<String> order = _order(s);
    final List<Subscription> l = List<Subscription>.of(s);
    l.sort((Subscription a, Subscription b) {
      final int byCurrency = _compareCurrency(
        a.currencyCode,
        b.currencyCode,
        order,
      );
      if (byCurrency != 0) return byCurrency;
      final int byAmount = MonthlyShare.descending(
        a.monthlyShare,
        b.monthlyShare,
      );
      return byAmount != 0 ? byAmount : _tieBreak(a, b);
    });
    return l;
  }

  /// The currency codes in the order they first appear in [s].
  ///
  /// 🔴 ORDERING ACROSS CURRENCIES IS A PRESENTATION RULE AND NEVER A CLAIM
  /// THAT THE AMOUNTS COMPARE. "Is 40 dollars more than 3000 rupees" has no
  /// answer here, so the rule below never asks it: rows GROUP by currency, the
  /// groups run in order of first appearance, and only WITHIN a group does the
  /// amount decide. That is a well-defined total order, it is stable, and for
  /// a single-currency list — everyone, in practice — it is byte-for-byte the
  /// old "biggest first".
  static List<String> _order(List<Subscription> s) {
    final List<String> order = <String>[];
    for (final Subscription x in s) {
      if (!order.contains(x.currencyCode)) order.add(x.currencyCode);
    }
    return order;
  }

  /// The last word when the figure a list is sorted by is a TIE.
  ///
  /// 🔴 A SORT THAT TIES FALLS BACK TO ITS INPUT ORDER, AND THE INPUT ORDER IS
  /// NOT THE SAME ON EVERY TARGET. The phone list is append order
  /// (`subscriptions_controller.dart`), the signed-in list is the API's
  /// `ORDER BY price DESC`, and ids are random uuids. So two rows renewing on
  /// the same day, or costing the same, used to swap places between the phone
  /// and the tablet capture of one seed. The key below is total and ignores
  /// input order: the name as a reader sorts it (case-folded), then the exact
  /// name so "abc" and "ABC" still order, then the id so two rows with one
  /// name still order. `test/sub_math_order_test.dart` feeds one set in two
  /// orders and asserts one output.
  static int _tieBreak(Subscription a, Subscription b) {
    final int byName = _compareNames(a.name, b.name);
    return byName != 0 ? byName : a.id.compareTo(b.id);
  }

  static int _compareNames(String a, String b) {
    final int folded = a.toLowerCase().compareTo(b.toLowerCase());
    return folded != 0 ? folded : a.compareTo(b);
  }

  static Money _orderKey(MoneyBag bag) => bag.isEmpty
      ? const Money.zero(Money.fallbackCurrencyCode)
      : bag.amounts.first;

  static int _compareDesc(Money a, Money b, List<String> order) {
    final int byCurrency = _compareCurrency(
      a.currencyCode,
      b.currencyCode,
      order,
    );
    return byCurrency != 0 ? byCurrency : b.minorUnits.compareTo(a.minorUnits);
  }

  /// Currency groups in [order]; 0 when [a] and [b] are the same currency.
  static int _compareCurrency(String a, String b, List<String> order) {
    if (a == b) return 0;
    final int ia = order.indexOf(a);
    final int ib = order.indexOf(b);
    // A code the order does not know sorts last rather than first, which is
    // what `indexOf`'s -1 would otherwise do.
    return (ia < 0 ? order.length : ia).compareTo(ib < 0 ? order.length : ib);
  }

  /// The weight a [bag] carries in a CHART, in minor units of [currencyCode].
  ///
  /// 🔴 A CHART IS A COMPARISON, AND UNLIKE CURRENCIES DO NOT COMPARE. A donut
  /// segment or a progress bar is a claim that this slice is that fraction of
  /// the whole; with two currencies in the list there is no whole, and adding
  /// their minor units would be the same silent fold this file exists to
  /// remove — worse here, because 100 yen and 100 dollars would draw the same
  /// segment.
  ///
  /// So the rule is: a chart is drawn IN THE USER'S OWN CURRENCY, and a
  /// subtotal in any other currency weighs nothing in it. The FIGURES beside
  /// the chart still print every subtotal (`MoneyFormatter.formatBag`), so
  /// nothing is hidden — what is withheld is only the claim that the shapes
  /// are proportional to something they are not.
  static double chartWeight(MoneyBag bag, String currencyCode) =>
      bag.inCurrency(currencyCode).minorUnits.toDouble();

  static List<Subscription> upcoming(
    List<Subscription> s,
    DateTime now, {
    int take = 4,
  }) {
    final List<Subscription> l = List<Subscription>.of(s);
    l.sort((Subscription a, Subscription b) {
      final int byDate = a.daysUntil(now).compareTo(b.daysUntil(now));
      return byDate != 0 ? byDate : _tieBreak(a, b);
    });
    return l.take(take).toList();
  }

  static List<Subscription> unused(List<Subscription> s) =>
      s.where((Subscription x) => x.unused).toList();

  /// What the user would keep, per month, by cancelling every row they have
  /// flagged unused.
  ///
  /// 🔴 THIS IS ZERO FOR EVERY REAL USER, AND THE CALLER — NOT THIS FUNCTION —
  /// IS WHERE THAT HAS TO BE HANDLED. `Subscription.unused` is written in
  /// exactly two places: `data/seed/demo_data.dart` (the demo set) and
  /// `SeedApiClient.update`, relaying an `unused` field the API would have to
  /// send. **No control anywhere in the app sets it**, so on real rows
  /// [unused] returns an empty list and this fold returns an empty bag,
  /// permanently.
  ///
  /// The ARITHMETIC is deliberately unchanged: `monthlyShare` is the right unit
  /// for "you would keep this much every month", and normalising a yearly plan
  /// to a twelfth is exactly right for a recurring saving. The dishonesty was
  /// never the sum — it was rendering the sum when the input cannot exist. A
  /// "Potential savings 0.00" tile is not a zero, it is a missing feature
  /// wearing a number.
  ///
  /// ✅ So the rule for callers is: render this ONLY when `unused(s)` is
  /// non-empty. `home_screen.dart` already does (`if (showUnused &&
  /// unused.isNotEmpty)`). `insights_screen.dart` does NOT — it draws the
  /// savings card and its `/mo` pill unconditionally, with an
  /// `insightsNothingFlagged` line underneath, so a real user sees the pill
  /// read 0.00 beside "nothing flagged". That is the same defect one screen
  /// over and it is that file's to fix.
  static MoneyBag savings(List<Subscription> s) =>
      MonthlyShare.sum(unused(s).map((Subscription x) => x.monthlyShare));

  /// The money that will actually leave the account in the next [days] days.
  ///
  /// 🔴 `price`, NOT `monthlyShare`, AND THE SWAP IS THE WHOLE FIGURE.
  /// `monthlyShare` is a NORMALISED monthly share — a yearly plan divided by
  /// twelve — which is what makes `totalMonthly` comparable across cycles. It
  /// is the wrong unit for a horizon: a 120-a-year renewal falling on Thursday
  /// takes the whole 120 off the card on Thursday, not a twelfth of it. This
  /// summed the twelfth, so "DUE IN 7 DAYS" understated an imminent annual
  /// charge by 12x — and it understated it, which is the one direction a
  /// warning about money must not err in.
  ///
  /// A row is counted at most once because the window (`0..days`) is measured
  /// against the ONE `nextRenewal` each row carries; a 30-day horizon does not
  /// double-count a monthly plan that would also bill again in 31 days. That is
  /// a floor on the horizon, not a ceiling, and it is honest in the safe
  /// direction.
  static MoneyBag dueWithin(List<Subscription> s, DateTime now, int days) =>
      MoneyBag.sum(
        s
            .where((Subscription x) {
              final int d = x.daysUntil(now);
              return d >= 0 && d <= days;
            })
            .map((Subscription x) => x.price),
      );
}
