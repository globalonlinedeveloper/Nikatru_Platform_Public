// ─────────────────────────────────────────────────────────────────────────────
// MoneyFormatter — ONE implementation, beside the Money it renders.
//
// ⏱ 2026-09-11. Until this date the class existed TWICE: in
// apps/subscriptiontracker/lib/core/format/money_format.dart and as a copy in the
// app brick, and nothing held the two equal (deleting the brick copy left
// assert-no-seam-forks at exit 0). A copy that no guard compares is a fork
// waiting for its first one-sided fix, and every stamped app would inherit the
// stale side. It lives here because this is where `Money` and `MoneyBag` live,
// and because the two other homes were wrong: packages/design_system must stay
// domain-free (assert-package-boundaries.mjs rule B), and a new package for one
// class would be a second place to look for money. `intl` is pure Dart, so
// rule A (core stays pure Dart) holds, and limb C already treats core as a
// legitimate `intl` host. Both old paths are now re-exports of this file.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:intl/intl.dart';

import 'money.dart';
import 'money_bag.dart';

/// Renders [Money] for a reader, under TWO INDEPENDENT AXES.
///
/// ## The two axes, and why conflating them was the defect
/// The shape this replaces was `Currency(symbol)` with
/// `NumberFormat('#,##0.00', 'en_US')` and the symbol glued to the front. It got
/// both axes wrong at once:
///
///  1. **The display locale was hardcoded to `en_US`.** Grouping is a property
///     of the READER, not of the money. India groups the last three digits and
///     then in pairs, so one and a quarter million rupees is written
///     `12,50,000`; `en_US` writes `1,250,000`. A Tamil-reading user saw the
///     wrong grouping on every screen in the app, in every currency.
///  2. **The currency was a bare symbol with no code**, so the number of
///     decimal places could not follow it (the yen has none, the Kuwaiti dinar
///     has three) and the symbol could not move to where a locale puts it.
///
/// These are separate: an Indian reader tracking a dollar subscription needs
/// INDIAN grouping around a DOLLAR sign with the dollar's two decimal places.
/// So [localeName] comes from the app's resolved locale and everything else
/// comes from the [Money]'s own currency code.
///
/// ## 🔴 Nothing here converts
/// There is no rate table and there must not be one — see [Money]'s note. Where
/// unlike currencies would have to be summed, the caller hands over a
/// [MoneyBag] and [formatBag] renders EVERY subtotal joined by [mixedJoiner],
/// e.g. a dollar figure and a rupee figure side by side. A converted single
/// number would need a dated rate this app does not have, and the previous
/// attempt at one showed a user who typed 499 a figure 83 times larger.
///
/// ## 🔴 The locale trap, measured
/// `NumberFormat`'s locale data is looked up at construction and an unknown or
/// not-yet-loaded locale FAILS THERE — the same trap
/// `subscriptions_controller.dart` records for `DateFormat.MMMd`, where a bare
/// `ProviderContainer` (no `MaterialApp`, so no
/// `GlobalMaterialLocalizations.delegate` to load the symbol tables) can only
/// resolve the compiled-in `en_US`. `Intl.verifiedLocale` raises an
/// [ArgumentError] rather than an [Exception] on that path, so BOTH are caught
/// below. Degrading to [fallbackLocaleName] keeps the container-driven tests
/// on their real code path instead of turning a formatting detail into an
/// unrelated failure somewhere else.
class MoneyFormatter {
  const MoneyFormatter(
    this.localeName, {
    this.emptyCurrencyCode = Money.fallbackCurrencyCode,
  });

  /// The READER's locale — `AppLocalizations.localeName`, or the resolved
  /// device locale where there is no widget in the loop. Never the currency's.
  final String localeName;

  /// What a total over NO amounts renders as.
  ///
  /// 🔴 AN EMPTY BAG HAS NO CURRENCY OF ITS OWN, and defaulting it to the
  /// dollar is the same defect one size smaller: a new user who has chosen the
  /// rupee and added nothing yet would be shown a dollar zero on the home hero.
  /// So the caller names the currency it would have been in — the user's own
  /// choice — and screens that cannot reach one (the scan results, which only
  /// render when there is something to total) keep the default because the
  /// empty branch is unreachable there.
  final String emptyCurrencyCode;

  /// The one locale compiled into `intl`, and therefore the only one that can
  /// be relied on before anything has loaded the symbol tables.
  static const String fallbackLocaleName = 'en_US';

  /// What separates the subtotals of a mixed-currency total. Deliberately NOT
  /// an ARB key: it joins two already-localized figures, and asking a
  /// translator for a plus sign asks for punctuation rather than language —
  /// the same rule `budget_screen.dart` records for its own separator.
  static const String mixedJoiner = ' + ';

  /// `NumberFormat` parses a pattern and resolves locale data on construction,
  /// which is far too expensive to repeat per frame per row. Keyed by all three
  /// things that change the output.
  static final Map<String, NumberFormat> _cache = <String, NumberFormat>{};

  /// The amount at its currency's own precision — two places for the dollar,
  /// none for the yen, three for the Kuwaiti dinar.
  String format(Money amount) => _formatterFor(
    amount.currencyCode,
    amount.minorUnitDigits,
  ).format(amount.toMajorUnits());

  /// The amount rounded to whole units, for the compact figures (donut centre,
  /// budget caps, category legends) where decimals are noise.
  String formatRounded(Money amount) =>
      _formatterFor(amount.currencyCode, 0).format(amount.toMajorUnits());

  /// Every subtotal in [bag], joined.
  ///
  /// One currency — the case essentially every user is in — renders exactly as
  /// [format] would. Two or more render as two or more figures, which is the
  /// honest answer and is why this returns a String rather than a Money.
  String formatBag(MoneyBag bag) => bag.isEmpty
      ? format(Money.zero(emptyCurrencyCode))
      : bag.amounts.map(format).join(mixedJoiner);

  String formatBagRounded(MoneyBag bag) => bag.isEmpty
      ? formatRounded(Money.zero(emptyCurrencyCode))
      : bag.amounts.map(formatRounded).join(mixedJoiner);

  /// A set of PARTS and the WHOLE they make up, rendered at whole-unit
  /// precision so THE PARTS A READER ADDS UP GIVE THE TOTAL THE READER IS
  /// SHOWN.
  ///
  /// ## 🔴 Rendering the two independently is the defect
  /// [formatBagRounded] per row shows sum-of-rounded; [formatBagRounded] on the
  /// fold shows rounded-sum. The minor units always summed exactly — there was
  /// never an arithmetic error — but those two renderings differ whenever the
  /// discarded fractions add past a unit, and a card that puts them side by
  /// side is a card that contradicts itself. Measured on the Play listing
  /// capture of 2026-09-20: an insights donut reading `$93` in its centre
  /// beside six legend rows reading 39 + 20 + 16 + 11 + 5 + 3. The apportioning
  /// rule, and the two approaches rejected, are on
  /// [MoneyBag.apportionRounded].
  ///
  /// ## 🔴 The total is DERIVED from [parts] and is deliberately not an argument
  /// A caller that could pass its own fold could pass a different one, and this
  /// method would become a second place for the two to disagree rather than the
  /// one place they cannot. Both callers already hold a partition of the same
  /// list — `SubMath.categoryTotals` over the subscriptions whose
  /// `SubMath.totalMonthly` the same screen prints — so nothing is lost by
  /// folding it here, and the screen stops computing a second fold that could
  /// drift from the first.
  ///
  /// ## ⚠️ The WHOLE does not move; only the parts do
  /// `total` is byte-identical to `formatBagRounded` of the exact fold:
  /// [Money.wholeUnits] rounds half away from zero and so, measured, does
  /// `intl` at zero fraction digits. So this changes no figure the app is
  /// trusted on today — it moves individual rows by less than one unit each so
  /// that the column adds up.
  ({List<String> parts, String total}) formatBreakdownRounded(
    Iterable<MoneyBag> parts,
  ) {
    final List<MoneyBag> shares = MoneyBag.apportionRounded(parts);
    return (
      parts: <String>[for (final MoneyBag bag in shares) formatBagRounded(bag)],
      total: formatBagRounded(
        MoneyBag.sum(<Money>[
          for (final MoneyBag bag in shares) ...bag.amounts,
        ]),
      ),
    );
  }

  NumberFormat _formatterFor(String currencyCode, int decimalDigits) {
    final String key = '$localeName|$currencyCode|$decimalDigits';
    final NumberFormat? cached = _cache[key];
    if (cached != null) return cached;
    final NumberFormat built = _build(localeName, currencyCode, decimalDigits);
    _cache[key] = built;
    return built;
  }

  static NumberFormat _build(
    String localeName,
    String currencyCode,
    int decimalDigits,
  ) {
    // A code with no symbol renders under the CODE plus a space, never a
    // guessed glyph: a wrong symbol on a real amount is worse than a plain one.
    final String symbol = Money.symbolFor(currencyCode) ?? '$currencyCode ';
    try {
      return NumberFormat.currency(
        locale: localeName,
        symbol: symbol,
        decimalDigits: decimalDigits,
      );
    } on Exception {
      return _fallback(symbol, decimalDigits);
    } on ArgumentError {
      // `Intl.verifiedLocale` throws an Error, not an Exception, for a locale
      // whose data is absent. Both arms exist because the class of the throw
      // depends on which layer of intl rejects it.
      return _fallback(symbol, decimalDigits);
    }
  }

  static NumberFormat _fallback(String symbol, int decimalDigits) =>
      NumberFormat.currency(
        locale: fallbackLocaleName,
        symbol: symbol,
        decimalDigits: decimalDigits,
      );
}
