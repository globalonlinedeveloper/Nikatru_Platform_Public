import 'package:flutter/foundation.dart' show immutable;
import 'package:nikatru_core/nikatru_core.dart' show Money;

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

/// The unit a free trial is counted in, as the seller states it.
enum TrialUnit {
  day('day'),
  week('week'),
  month('month'),
  year('year');

  const TrialUnit(this.wire);

  /// What the paywall's message selects on (`paywallTermWithTrial`'s `unit`).
  final String wire;
}

/// A free trial: a COUNT of a UNIT, exactly as the seller states it.
///
/// 🔴 NEVER CONVERTED. The App Store sells "1 month free", and a month is 28,
/// 29, 30 or 31 days depending on when the buyer starts, so "a 30-day free
/// trial" on that product is a claim the store does not make — and the store's
/// own sheet, one tap later, would say something else. The web rail config
/// states days (`trial_days: 30`) and maps to [TrialPeriod.days], so the web
/// copy is unchanged byte for byte.
@immutable
class TrialPeriod {
  const TrialPeriod({required this.count, required this.unit});

  /// [count] days — the only unit the web rail config states.
  const TrialPeriod.days(this.count) : unit = TrialUnit.day;

  final int count;
  final TrialUnit unit;

  /// The length in days when the unit HAS a fixed number of them, else null. A
  /// month or a year has no fixed length, and a caller that needs a day count
  /// for one has to say what it does instead rather than be handed a guess.
  int? get exactDays => switch (unit) {
        TrialUnit.day => count,
        TrialUnit.week => count * 7,
        TrialUnit.month || TrialUnit.year => null,
      };

  @override
  bool operator ==(Object other) =>
      other is TrialPeriod && other.count == count && other.unit == unit;

  @override
  int get hashCode => Object.hash(count, unit);

  @override
  String toString() => '$count ${unit.wire}';
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
///
/// ## Who describes it
/// On the web rail, the rail config. On a STORE rail, the store: `IapRail`
/// builds each one from the store's own answer (`StorePlan`), and the config
/// only says which product ids the app sells and in what order. A store buyer
/// is charged the store's price in the storefront's currency, so that is the
/// only price a store paywall may show.
@immutable
class Offering {
  const Offering({
    required this.productId,
    required this.amountMinor,
    required this.currencyCode,
    required this.term,
    this.trial,
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

  /// The free trial THIS buyer would get, in the seller's own unit; null when
  /// there is none.
  ///
  /// 🔴 REPLACED `int trialDays`, RATHER THAN GAINING A UNIT BESIDE IT. A store
  /// trial of "1 month" kept in a field called `trialDays` holds a 1 that every
  /// existing reader prints as "a 1-day free trial"; a `trialUnit` added beside
  /// it would be ignored by exactly the readers that were not updated. Removing
  /// the field makes the compiler name every one of them.
  final TrialPeriod? trial;

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
    final int units = Money.minorUnitDigitsFor(currencyCode);
    final String major = units == 0
        ? '$amountMinor'
        : (amountMinor / Money.pow10(units)).toStringAsFixed(units);
    final String? symbol = _symbols[currencyCode];
    return symbol == null ? '$currencyCode $major' : '$symbol$major';
  }

  /// The same charge as the portfolio's money type — an integer count of the
  /// currency's minor unit, with the code attached.
  ///
  /// Exists so a caller that has to DO something with this amount (compare it,
  /// show it under the reader's own locale) is not handed a string and left to
  /// parse it back. [formattedPrice] stays the paywall's answer because a
  /// paywall shows the merchant of record's own rendering and nothing else.
  Money get price => Money(amountMinor, currencyCode);

  /// 🔴 AN ALIAS ONTO THE ONE TABLE, NOT A SECOND COPY. The symbols and the
  /// per-currency minor-unit digits (JPY 0, KWD 3) used to be declared here AND
  /// again in the tracker app's formatter — which is how a symbol can be right
  /// on the paywall and wrong on the next screen. They now live once, in
  /// [Money], and this is a `const` reference to that map.
  ///
  /// ⚠️ THE NAME IS LOAD-BEARING. `assert-no-price-literals.mjs` scopes its
  /// derivation check to [formattedPrice]'s own body and reads `_symbols` there
  /// as the evidence that the symbol is LOOKED UP rather than supplied ready
  /// made by config. Renaming it, or replacing the getter's body with a plain
  /// delegation to [Money.plainFormat], reads to that guard as a paywall that
  /// no longer derives its price. The equivalence is pinned instead by a test:
  /// `offering_test.dart` asserts `formattedPrice == price.plainFormat()` over
  /// a matrix of currencies, so the two cannot drift.
  static const Map<String, String> _symbols = Money.symbols;

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
      // trial — never a reason to drop an otherwise sellable plan. The config
      // states days, so a config trial is always [TrialPeriod.days].
      trial: trial is int && trial > 0 ? TrialPeriod.days(trial) : null,
    );
  }

  @override
  String toString() =>
      'Offering($productId, $amountMinor $currencyCode, ${term.wire}, '
      'trial ${trial ?? 'none'})';
}
