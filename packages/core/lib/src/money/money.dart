/// Thrown when two amounts in DIFFERENT currencies are added, subtracted or
/// compared as if they were the same unit.
///
/// 🔴 IT IS AN [Error], NOT AN [Exception], AND THE CHOICE IS THE POINT. A
/// caller cannot recover from this at runtime by retrying or by picking a
/// default: there is no honest answer to "what is 10 USD plus 499 INR" without
/// a dated rate, and this codebase deliberately has no rate table (see
/// [Money]'s own note). Adding unlike money is a BUG IN THE CALLER — it should
/// have grouped by currency instead — so it fails the way a bug fails.
class CurrencyMismatchError extends Error {
  CurrencyMismatchError(this.left, this.right, this.operation);

  final String left;
  final String right;
  final String operation;

  @override
  String toString() =>
      'CurrencyMismatchError: cannot $operation $left and $right. '
      'Two amounts in different currencies are unlike units and no rate table '
      'in this codebase repairs that. Group the total by currency instead.';
}

/// An exact amount of money: an INTEGER count of a currency minor unit, plus
/// the ISO 4217 code that says what unit that is.
///
/// ## Why an integer, and not a double
/// A double cannot hold 0.1, so a fold over a list of prices drifts, and the
/// drift shows up in a total the user can check against their bank. The old
/// shape stored `double price` and the app summed it; this stores the smallest
/// indivisible unit the currency actually has, and every operation below is
/// integer arithmetic.
///
/// ## Why the CODE travels with the amount
/// This is the half that a bare `Decimal` would not have fixed. Before this
/// type, an amount carried no currency at all: the user picked one symbol in
/// Settings and every stored number was RE-SYMBOLED under it. That made a
/// cross-currency total impossible to even detect — a fold over a list of
/// unlike units produced a number, and the number looked fine. With the code
/// attached, [operator +] REFUSES, and the caller has to group (see
/// `MoneyBag`) or say so.
///
/// ## 🔴 THERE IS NO FX RATE TABLE HERE, AND THERE MUST NOT BE ONE
/// A hardcoded table (`{USD:1.0, EUR:0.92, GBP:0.79, INR:83.0}`) used to
/// multiply every displayed figure in the app that this type serves. The
/// measured consequence: a user in India who picked the rupee and typed 499 for
/// a plan costing 499 rupees was shown a figure 83 times larger. A conversion
/// is only honest with a DATED rate from a source that can be cited, and v1 has
/// no such source. Until it does, unlike amounts are grouped, never converted.
///
/// ## Formatting lives elsewhere, on purpose
/// [plainFormat] is a last-resort renderer with no grouping and no locale. The
/// app formats through `intl` under the USER'S DISPLAY LOCALE, which is a
/// separate axis from the money's own currency: an Indian user tracking a
/// dollar subscription wants lakh/crore grouping AND a dollar sign. This
/// package is pure Dart and deliberately does not depend on `intl`, so the
/// locale-aware formatter is the app's — this type supplies the two tables it
/// needs ([symbolFor], [minorUnitDigitsFor]) so they exist exactly once.
class Money implements Comparable<Money> {
  /// [minorUnits] counts the currency's smallest unit — cents for the dollar,
  /// paise for the rupee, whole yen for the yen. Use [fromMajorUnits] when what
  /// you have is the number a human typed.
  const Money(this.minorUnits, this.currencyCode);

  /// Zero, which still needs a currency: "nothing" in one currency is not
  /// interchangeable with "nothing" in another as far as [operator +] is
  /// concerned, and pretending otherwise is how a mixed fold starts.
  const Money.zero(this.currencyCode) : minorUnits = 0;

  final int minorUnits;

  /// ISO 4217, upper case, e.g. `USD`. Not validated here beyond what
  /// [tryFromJson] checks — a code this type has never heard of still formats,
  /// as its own code rather than under a guessed symbol.
  final String currencyCode;

  /// What an amount is in when nothing else has said. Callers that have a real
  /// answer should pass it; this exists so a default is written ONCE.
  static const String fallbackCurrencyCode = 'USD';

  /// Currency symbols, and nothing beyond what is universally written that way.
  /// A code with no entry prints as the code — see [plainFormat].
  ///
  /// 🔴 THIS IS THE ONE COPY. It was duplicated between the purchases package
  /// and the tracker app, which is how a symbol can be right in a paywall and
  /// wrong in a total on the next screen.
  static const Map<String, String> symbols = <String, String>{
    'USD': r'$',
    'EUR': '€',
    'GBP': '£',
    'INR': '₹',
    'JPY': '¥',
    'AUD': r'A$',
    'CAD': r'C$',
  };

  /// Decimal places per currency. ISO 4217 is NOT uniform — the yen has none
  /// and the Kuwaiti dinar has three — so a hardcoded division by a hundred
  /// misprices a yen plan by a factor of a hundred. Two is the default and
  /// covers everything these apps sell today.
  static const Map<String, int> _minorUnitDigits = <String, int>{
    'JPY': 0,
    'KWD': 3,
  };

  /// The default, named so the two lookups below read as one rule.
  static const int defaultMinorUnitDigits = 2;

  static int minorUnitDigitsFor(String code) =>
      _minorUnitDigits[code] ?? defaultMinorUnitDigits;

  /// The symbol for [code], or null when there is none. NULL IS A REAL ANSWER
  /// and callers must render the code instead: a wrong symbol on a real charge
  /// is worse than a plain one.
  static String? symbolFor(String code) => symbols[code];

  int get minorUnitDigits => minorUnitDigitsFor(currencyCode);

  bool get isZero => minorUnits == 0;
  bool get isNegative => minorUnits < 0;

  /// 10 to the [n], as an int. A loop rather than `math.pow`, which returns a
  /// double and would reintroduce the very representation this type removes.
  static int pow10(int n) {
    int r = 1;
    for (int i = 0; i < n; i++) {
      r *= 10;
    }
    return r;
  }

  /// The amount as a decimal number — FOR HANDING OUT, NEVER FOR COMPUTING.
  ///
  /// Two callers need it and there are no others: `intl`'s `NumberFormat`,
  /// which only takes doubles, and a legacy wire column typed as a SQL `REAL`
  /// that this increment deliberately does not migrate.
  ///
  /// ⚠️ Never fold, compare or store the result. It is a lossy view, and every
  /// reason this class exists applies the moment it is used for anything else.
  double toMajorUnits() => minorUnits / pow10(minorUnitDigits);

  /// Builds from the number a human typed or a legacy JSON `double` carried.
  ///
  /// Rounds HALF AWAY FROM ZERO to the currency's own precision, which is what
  /// `.round()` does and what a person expects of a price. The rounding is not
  /// a nicety: `15.49 * 100` is 1548.9999999999998 in binary floating point, so
  /// truncation would store 1548 and quietly lose a paisa on every import.
  static Money fromMajorUnits(num major, String currencyCode) => Money(
        (major * pow10(minorUnitDigitsFor(currencyCode))).round(),
        currencyCode,
      );

  /// Parses what a user typed into a text field, or null if it is not a number.
  ///
  /// Deliberately strict: no symbols, no thousands separators, no locale
  /// decimal comma. The entry field this serves is numeric, and a parser that
  /// guesses at `1,234` (one thousand? one and a bit?) is a parser that will
  /// eventually guess wrong about somebody's money.
  static Money? tryParseMajor(String text, String currencyCode) {
    final num? major = num.tryParse(text.trim());
    if (major == null) return null;
    return fromMajorUnits(major, currencyCode);
  }

  void _requireSame(Money other, String operation) {
    if (currencyCode != other.currencyCode) {
      throw CurrencyMismatchError(currencyCode, other.currencyCode, operation);
    }
  }

  Money operator +(Money other) {
    _requireSame(other, 'add');
    return Money(minorUnits + other.minorUnits, currencyCode);
  }

  Money operator -(Money other) {
    _requireSame(other, 'subtract');
    return Money(minorUnits - other.minorUnits, currencyCode);
  }

  Money operator -() => Money(-minorUnits, currencyCode);

  /// Multiplication by a COUNT, not by a rate. There is no `operator *(double)`
  /// and there should not be: the only reason to multiply money by a fraction
  /// in this app would be a currency conversion, and see the class note.
  Money times(int factor) => Money(minorUnits * factor, currencyCode);

  /// Splits into [divisor] parts, rounding half away from zero.
  ///
  /// ⚠️ The remainder is DROPPED, so twelve of these do not necessarily add
  /// back up to the original — a yearly charge of 100.00 shows as 8.33 a month
  /// and twelve of those are 99.96. That is correct for the thing this is used
  /// for (a normalised monthly SHARE, for comparing plans), and wrong for
  /// splitting an actual payment; no caller in this portfolio does the latter.
  Money dividedBy(int divisor) {
    if (divisor == 0) {
      throw ArgumentError.value(divisor, 'divisor', 'cannot divide money by 0');
    }
    final int doubled = minorUnits * 2;
    final int quotient = doubled ~/ divisor;
    // Half away from zero: nudge by the sign before truncating the halves out.
    final int rounded =
        quotient.isNegative ? (quotient - 1) ~/ 2 : (quotient + 1) ~/ 2;
    return Money(rounded, currencyCode);
  }

  /// The largest of [minorUnits] and zero, in the same currency. Used where a
  /// remaining-budget figure must not read as a negative amount.
  Money clampAtZero() => minorUnits < 0 ? Money.zero(currencyCode) : this;

  /// This amount as a COUNT OF WHOLE MAJOR UNITS — 93 dollars, not 9350 cents.
  ///
  /// 🔴 IT ROUNDS THE WAY THE APP ALREADY PRINTS, AND THAT WAS MEASURED RATHER
  /// THAN ASSUMED. [dividedBy] rounds half away from zero, and so does `intl`
  /// at zero fraction digits: `NumberFormat.currency(decimalDigits: 0)` renders
  /// 92.50 as `$93`, 0.50 as `$1`, 2.50 as `$3` and -92.50 as `-$93` — measured
  /// under `en_US` on 2026-09-20, which rules out the half-to-even rule those
  /// last two would have exposed. The two agreeing is what lets
  /// `MoneyBag.apportionRounded` fix a breakdown's PARTS without moving any
  /// WHOLE the app shows today.
  int get wholeUnits => dividedBy(pow10(minorUnitDigits)).minorUnits;

  /// [units] whole major units in [currencyCode] — the inverse of [wholeUnits].
  ///
  /// The result carries no fraction at all, so rendering it at zero decimal
  /// places is exact and there is no SECOND rounding decision for a formatter
  /// to make differently. That is the property an apportioned breakdown rests
  /// on: once the shares are chosen they are displayed, not re-rounded.
  static Money fromWholeUnits(int units, String currencyCode) =>
      Money(units * pow10(minorUnitDigitsFor(currencyCode)), currencyCode);

  /// A last-resort rendering: the symbol glued to a fixed-decimal number, with
  /// NO thousands grouping and NO locale.
  ///
  /// This is what a caller with no locale in hand gets — a pure-Dart package
  /// cannot reach `intl`. An app with a display locale must format through it
  /// instead, because grouping is locale-specific and getting it wrong is the
  /// defect this whole type was built for: 1250000 rupees is written
  /// 12,50,000 in India and 1,250,000 almost everywhere else.
  ///
  /// An UNKNOWN currency renders as its code followed by the number, rather
  /// than under a guessed symbol.
  String plainFormat() {
    final int digits = minorUnitDigits;
    final String major = digits == 0
        ? '$minorUnits'
        : toMajorUnits().toStringAsFixed(digits);
    final String? symbol = symbolFor(currencyCode);
    return symbol == null ? '$currencyCode $major' : '$symbol$major';
  }

  /// The wire shape: an INTEGER of minor units and a code, never a decimal.
  Map<String, Object?> toJson() => <String, Object?>{
        'minor_units': minorUnits,
        'currency': currencyCode,
      };

  /// Parses [raw], returning null on anything it cannot read.
  ///
  /// 🔴 `amount is int` EXCLUDES A JSON DOUBLE ON PURPOSE. A `4.99` arriving
  /// where `499` was meant would silently become five paise. A wire value that
  /// is genuinely a decimal major-unit amount is a DIFFERENT shape and its
  /// reader must say so by calling [fromMajorUnits] explicitly.
  static Money? tryFromJson(Object? raw) {
    if (raw is! Map) return null;
    final Map<String, Object?> j = raw.cast<String, Object?>();
    final Object? amount = j['minor_units'];
    final Object? code = j['currency'];
    if (amount is! int) return null;
    if (code is! String || code.length != 3) return null;
    return Money(amount, code.toUpperCase());
  }

  @override
  int compareTo(Money other) {
    _requireSame(other, 'compare');
    return minorUnits.compareTo(other.minorUnits);
  }

  bool operator <(Money other) => compareTo(other) < 0;
  bool operator <=(Money other) => compareTo(other) <= 0;
  bool operator >(Money other) => compareTo(other) > 0;
  bool operator >=(Money other) => compareTo(other) >= 0;

  @override
  bool operator ==(Object other) =>
      other is Money &&
      other.minorUnits == minorUnits &&
      other.currencyCode == currencyCode;

  @override
  int get hashCode => Object.hash(minorUnits, currencyCode);

  @override
  String toString() => 'Money($minorUnits $currencyCode)';
}
