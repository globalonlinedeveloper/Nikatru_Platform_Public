import 'money.dart';

/// A total over amounts that may be in DIFFERENT currencies: one subtotal per
/// currency, and never a single number.
///
/// ## Why this type exists instead of a `Money` total
/// [Money.operator +] refuses to add unlike currencies, which is correct and
/// leaves every caller that folds a list with a problem: a user tracking a
/// dollar subscription and a rupee one still has to be shown a monthly total.
/// The two honest answers are "convert with a dated rate" and "report both",
/// and this codebase has no rate source, so this is the second one made
/// explicit.
///
/// 🔴 THE DISHONEST ANSWER IS THE ONE THIS REPLACES. Folding unlike units into
/// a double produced a number that looked exactly like a real total. Nothing
/// downstream — no test, no type, no reviewer reading the screen — could tell
/// the difference between "you spend 91.48 a month" and "you spend 40.00 plus
/// 5148 rupees a month, added together as if the units matched".
///
/// The overwhelmingly common case is ONE currency, where [isMixed] is false and
/// [single] is the ordinary total. Mixed is the rare case, and it is the one
/// that has to stop being silently wrong.
class MoneyBag {
  const MoneyBag(this.byCurrency);

  /// Empty in [currencyCode] — a bag with one zero subtotal, so a caller with
  /// no rows still has something to render under the user's chosen currency.
  MoneyBag.zero(String currencyCode)
      : byCurrency = <String, Money>{currencyCode: Money.zero(currencyCode)};

  /// Sums [amounts], grouping by currency code. Insertion order is preserved,
  /// so the currency the user's first row is in leads the rendering.
  factory MoneyBag.sum(Iterable<Money> amounts) {
    final Map<String, Money> totals = <String, Money>{};
    for (final Money m in amounts) {
      final Money? running = totals[m.currencyCode];
      totals[m.currencyCode] = running == null ? m : running + m;
    }
    return MoneyBag(totals);
  }

  /// Subtotal per ISO 4217 code. Empty only when nothing was summed.
  final Map<String, Money> byCurrency;

  bool get isEmpty => byCurrency.isEmpty;
  bool get isMixed => byCurrency.length > 1;

  /// The subtotals, in insertion order.
  Iterable<Money> get amounts => byCurrency.values;

  /// The one subtotal, when there is exactly one currency in play.
  ///
  /// Throws [StateError] when the bag is mixed or empty, because there is no
  /// honest single answer in either case and returning a zero would be a
  /// missing total wearing a number.
  Money get single {
    if (byCurrency.length != 1) {
      throw StateError(
        'MoneyBag.single on a bag holding ${byCurrency.length} currencies '
        '(${byCurrency.keys.join(', ')}). Render every subtotal, or ask for '
        'the one in a named currency.',
      );
    }
    return byCurrency.values.first;
  }

  /// The subtotal in [currencyCode], or a zero in that currency when this bag
  /// holds none. Safe because the currency is NAMED by the caller, so nothing
  /// is being merged across units.
  Money inCurrency(String currencyCode) =>
      byCurrency[currencyCode] ?? Money.zero(currencyCode);

  /// [parts] snapped to WHOLE major units in a way that still sums to their own
  /// total, snapped the same way.
  ///
  /// ## 🔴 The defect this closes is a DISPLAY one; the arithmetic was right
  /// Round each part on its own and you show SUM-OF-ROUNDED. Round the fold on
  /// its own and you show ROUNDED-SUM. Those are different numbers whenever the
  /// fractions each part discards add past a unit, and both were on screen at
  /// once: the Play listing captured on 2026-09-20 read `$93` in the middle of
  /// the insights donut with a legend beside it reading 39 + 20 + 16 + 11 + 5 +
  /// 3 = `$94`. A reader who adds the column is doing arithmetic the layout
  /// invited, so the layout has to survive it.
  ///
  /// ## The rule: largest remainder, and why not the alternatives
  /// Every part keeps its FLOOR, and the units the whole is short by go one
  /// each to the parts that lost the most to that floor — ties by position, so
  /// the answer is deterministic and a redraw never reshuffles the column. No
  /// part moves by a whole unit from its own exact value, and no part is ever
  /// printed as a larger share than a neighbour it is smaller than.
  ///
  /// Printing minor units everywhere would agree too, and was rejected: it
  /// changes every compact figure in the app — donut centre, legend, budget
  /// bars — from `$39` to `$39.49` to fix a seam in one of them. Dropping the
  /// centre total would also agree, by deleting the figure the card exists to
  /// state.
  ///
  /// ## 🔴 PER CURRENCY, WHICH IS THE ONLY WAY IT MEANS ANYTHING
  /// A bag can hold a dollar subtotal and a rupee one, and there is no rate
  /// table in this codebase (see [Money]). Apportioning ACROSS them would be
  /// inventing one — a remainder in paise would be settled with a cent. So each
  /// currency is apportioned against its own total, independently, and a part
  /// holding nothing in a currency stays ABSENT from it rather than gaining a
  /// zero subtotal it never had. Each bag keeps its own currency order, so the
  /// rendering order of a mixed figure is unchanged.
  static List<MoneyBag> apportionRounded(Iterable<MoneyBag> parts) {
    final List<MoneyBag> list = List<MoneyBag>.of(parts);
    final List<Map<String, Money>> shares = <Map<String, Money>>[
      for (int i = 0; i < list.length; i++) <String, Money>{},
    ];
    for (final String code in _codesInOrder(list)) {
      final int scale = Money.pow10(Money.minorUnitDigitsFor(code));
      // Parallel arrays over the parts that HOLD this currency — index k below
      // is a position in these, and `holders[k]` is the part it belongs to.
      final List<int> holders = <int>[];
      final List<int> units = <int>[];
      final List<int> remainders = <int>[];
      int exact = 0;
      for (int i = 0; i < list.length; i++) {
        final Money? m = list[i].byCurrency[code];
        if (m == null) continue;
        // FLOOR, never truncation. Dart's `%` is non-negative for a positive
        // divisor, so this floors a negative amount too and every remainder
        // lands in [0, scale) — which is what makes the sort below compare
        // like with like instead of ranking a negative part's -0.49 as
        // "nothing lost".
        final int remainder = m.minorUnits % scale;
        holders.add(i);
        units.add((m.minorUnits - remainder) ~/ scale);
        remainders.add(remainder);
        exact += m.minorUnits;
      }
      int allocated = 0;
      for (final int u in units) {
        allocated += u;
      }
      // `short` is in [0, holders.length]: the exact total is the floors plus
      // the remainders, and the remainders are each below one unit.
      int short = Money(exact, code).wholeUnits - allocated;
      final List<int> byRemainderDesc =
          List<int>.generate(holders.length, (int k) => k)
            ..sort((int a, int b) {
              final int byLoss = remainders[b].compareTo(remainders[a]);
              return byLoss != 0 ? byLoss : a.compareTo(b);
            });
      for (int k = 0; k < byRemainderDesc.length && short > 0; k++) {
        units[byRemainderDesc[k]] += 1;
        short -= 1;
      }
      for (int k = 0; k < holders.length; k++) {
        shares[holders[k]][code] = Money.fromWholeUnits(units[k], code);
      }
    }
    return <MoneyBag>[
      for (int i = 0; i < list.length; i++)
        // Keyed off the ORIGINAL bag's key order, not the order the currencies
        // were apportioned in: `byCurrency` is insertion-ordered and that order
        // is what a mixed figure renders in.
        MoneyBag(<String, Money>{
          for (final String code in list[i].byCurrency.keys)
            code: shares[i][code]!,
        }),
    ];
  }

  /// Every currency in [parts], in order of first appearance — the order
  /// [MoneyBag.sum] would give the fold of the same parts.
  static List<String> _codesInOrder(List<MoneyBag> parts) {
    final List<String> codes = <String>[];
    for (final MoneyBag bag in parts) {
      for (final String code in bag.byCurrency.keys) {
        if (!codes.contains(code)) codes.add(code);
      }
    }
    return codes;
  }

  /// Every subtotal multiplied by a count — a per-year figure from a per-month
  /// one, for instance. Still a count, never a rate.
  MoneyBag times(int factor) => MoneyBag(<String, Money>{
        for (final MapEntry<String, Money> e in byCurrency.entries)
          e.key: e.value.times(factor),
      });

  @override
  String toString() =>
      'MoneyBag(${byCurrency.values.map((Money m) => m.toString()).join(', ')})';
}
