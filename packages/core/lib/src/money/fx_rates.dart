import 'money.dart';

/// A DATED table of exchange rates, and the one place in this codebase that
/// converts [Money] from one currency to another.
///
/// ## 🔴 WHY THIS EXISTS WHEN [Money] SAYS THERE MUST BE NO RATE TABLE
/// [Money]'s note forbids a HARDCODED table — the `{USD:1.0, INR:83.0}` one
/// that showed a user who typed ₹499 a figure 83 times larger — and says a
/// conversion is only honest with a dated rate from a source that can be
/// cited. This is that: the platform Worker caches the European Central Bank's
/// euro reference rates every night (`GET /v1/fx/latest`,
/// services/platform/src/fx.ts), and this type carries them with the ECB's own
/// date for the fix ([asOf]) and its own name for the series ([source]), so a
/// converted figure can always say what it was converted with and when.
/// Nothing converts implicitly: [Money] still refuses to add unlike units, and
/// a caller that wants one number asks this table for it, by name.
///
/// ## Shape
/// EUR is the base: [tryFromJson] reads units of each currency per ONE euro,
/// and every other pair is a CROSS rate through EUR — ₹649 to dollars is
/// 649 ÷ (INR per euro) × (USD per euro). The arithmetic is exact: every rate is
/// held as the decimal it was written as, not as a binary double, and the one
/// rounding step lands in the target currency's minor units, HALF TO EVEN, so a
/// long list of conversions does not drift in one direction.
///
/// ## Overrides win
/// A user who knows the rate their own card charged can say so: an override is
/// a pair `FROM/TO` → how many TO one FROM buys, in the FX market's own
/// notation (`USD/INR: 88` is one dollar for 88 rupees). It wins over the
/// table for that pair in BOTH directions, and it can name a currency the table
/// does not quote at all.
///
/// ## Staleness
/// The ECB publishes on TARGET business days only, so a table three days old
/// is a weekend, not a fault. [isStaleAt] turns true once the fix is more than
/// [staleAfter] old; the UI shows that, it does not hide the figure.
class FxTable {
  FxTable._(this.asOf, this.source, this._perEuro, this._overrides);

  /// A table quoting [ratesPerEuro] (units per ONE euro) as of the ECB date
  /// [asOf], optionally with user [overrides] keyed `FROM/TO`.
  ///
  /// Throws [ArgumentError] on a rate that is not finite and positive, a code
  /// that is not three capitals, or a malformed override key: every one of
  /// those is a caller bug, and a table built from it would convert wrongly
  /// without saying so.
  factory FxTable({
    required DateTime asOf,
    required Map<String, num> ratesPerEuro,
    String source = '',
    Map<String, num> overrides = const <String, num>{},
  }) {
    final Map<String, _Rational> perEuro = <String, _Rational>{
      baseCurrency: _Rational.one,
    };
    ratesPerEuro.forEach((String code, num rate) {
      if (!_isCode(code) || code == baseCurrency) {
        throw ArgumentError.value(
          code,
          'ratesPerEuro',
          'not a quoted currency code',
        );
      }
      perEuro[code] = _Rational.ofPositive(rate, 'ratesPerEuro[$code]');
    });
    final DateTime day = DateTime.utc(asOf.year, asOf.month, asOf.day);
    return FxTable._(day, source, perEuro, _parseOverrides(overrides));
  }

  /// The currency every rate in the table is quoted against.
  static const String baseCurrency = 'EUR';

  /// How old a fix may be before [isStaleAt] says so. The Worker reads at
  /// 06:00 UTC, so an ordinary weekend leaves Friday's fix a little over three
  /// days old on the Monday morning and never trips this; a long weekend (a
  /// Monday or Friday TARGET holiday, Easter, Christmas) can, for the mornings
  /// before the next fix, and the flag then says what is true.
  static const Duration staleAfter = Duration(days: 4);

  /// The ECB's date for the fix, at midnight UTC.
  final DateTime asOf;

  /// The ECB's name for the series, for the attribution line. Empty when the
  /// table was built by hand.
  final String source;

  final Map<String, _Rational> _perEuro;
  final Map<String, _Rational> _overrides;

  /// The key an override for one [from] → [to] pair is stored under.
  static String pairKey(String from, String to) => '$from/$to';

  /// Reads the `GET /v1/fx/latest` payload (contracts/fx/latest.v1.example.json
  /// `response`), or null on anything it cannot read: a base other than EUR, an
  /// `asOf` that is not a calendar day, a rate that is not a positive number.
  ///
  /// Null rather than a partial table, deliberately — the same rule as
  /// [Money.tryFromJson]. A table missing one bad row would convert the rest
  /// and make the missing currency look merely unsupported.
  static FxTable? tryFromJson(
    Object? raw, {
    Map<String, num> overrides = const <String, num>{},
  }) {
    if (raw is! Map) return null;
    final Map<String, Object?> j = raw.cast<String, Object?>();
    if (j['base'] != baseCurrency) return null;
    final DateTime? asOf = _parseDay(j['asOf']);
    if (asOf == null) return null;
    final Object? source = j['source'];
    final Object? rates = j['rates'];
    if (source is! String || rates is! Map) return null;
    final Map<String, num> perEuro = <String, num>{};
    for (final MapEntry<Object?, Object?> e in rates.entries) {
      final Object? code = e.key;
      final Object? rate = e.value;
      if (code is! String || !_isCode(code) || code == baseCurrency) {
        return null;
      }
      if (rate is! num || !rate.isFinite || rate <= 0) return null;
      perEuro[code] = rate;
    }
    return FxTable(
      asOf: asOf,
      ratesPerEuro: perEuro,
      source: source,
      overrides: overrides,
    );
  }

  /// This table with [overrides] in place of the ones it had.
  FxTable withOverrides(Map<String, num> overrides) =>
      FxTable._(asOf, source, _perEuro, _parseOverrides(overrides));

  /// The currencies the TABLE quotes, the base included. Overrides can reach
  /// further; ask [canConvert] for a pair.
  Iterable<String> get currencies => _perEuro.keys;

  /// True once the fix is more than [staleAfter] older than [now].
  bool isStaleAt(DateTime now) => now.toUtc().difference(asOf) > staleAfter;

  /// Whether [convert] has a rate for [from] → [to].
  bool canConvert(String from, String to) => _rate(from, to) != null;

  /// [amount] in [to], rounded half to even into [to]'s minor units, or null
  /// when neither an override nor the table can price the pair.
  ///
  /// NULL IS A REAL ANSWER, the same as [Money.symbolFor]'s: the ECB does not
  /// quote every currency a user can type, and a converted total that silently
  /// left one out would be the wrong-number defect this type exists to end. The
  /// caller shows that amount in its own currency instead.
  Money? convert(Money amount, String to) {
    if (amount.currencyCode == to) return amount;
    final _Rational? r = _rate(amount.currencyCode, to);
    if (r == null) return null;
    final BigInt n =
        BigInt.from(amount.minorUnits) *
        r.numerator *
        _pow10(Money.minorUnitDigitsFor(to));
    final BigInt d =
        r.denominator * _pow10(Money.minorUnitDigitsFor(amount.currencyCode));
    return Money(_roundHalfEven(n, d).toInt(), to);
  }

  /// How many [to] one [from] buys: an override for the pair, else its
  /// inverse, else the cross rate through EUR.
  _Rational? _rate(String from, String to) {
    if (from == to) return _Rational.one;
    final _Rational? direct = _overrides[pairKey(from, to)];
    if (direct != null) return direct;
    final _Rational? inverse = _overrides[pairKey(to, from)];
    if (inverse != null) return inverse.reciprocal;
    final _Rational? fromPerEuro = _perEuro[from];
    final _Rational? toPerEuro = _perEuro[to];
    if (fromPerEuro == null || toPerEuro == null) return null;
    return toPerEuro.dividedBy(fromPerEuro);
  }

  static Map<String, _Rational> _parseOverrides(Map<String, num> overrides) {
    final Map<String, _Rational> out = <String, _Rational>{};
    overrides.forEach((String key, num rate) {
      final List<String> pair = key.split('/');
      if (pair.length != 2 ||
          !_isCode(pair[0]) ||
          !_isCode(pair[1]) ||
          pair[0] == pair[1]) {
        throw ArgumentError.value(
          key,
          'overrides',
          'not a FROM/TO pair of two codes',
        );
      }
      out[key] = _Rational.ofPositive(rate, 'overrides[$key]');
    });
    return out;
  }

  static bool _isCode(String s) => RegExp(r'^[A-Z]{3}$').hasMatch(s);

  static DateTime? _parseDay(Object? raw) {
    if (raw is! String) return null;
    final RegExpMatch? m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(raw);
    if (m == null) return null;
    final int y = int.parse(m[1]!);
    final int mo = int.parse(m[2]!);
    final int d = int.parse(m[3]!);
    final DateTime day = DateTime.utc(y, mo, d);
    // DateTime normalises 2026-02-30 to March; a date that moved is not a day.
    if (day.year != y || day.month != mo || day.day != d) return null;
    return day;
  }

  static BigInt _pow10(int n) => BigInt.from(10).pow(n);

  /// n ÷ d to the nearest integer, ties to the even neighbour. d is positive.
  static BigInt _roundHalfEven(BigInt n, BigInt d) {
    // Truncates toward zero; the lines below step away from zero when due.
    final BigInt q = n ~/ d;
    final BigInt twiceRem = (n - q * d).abs() * BigInt.two;
    final BigInt away = n.isNegative ? -BigInt.one : BigInt.one;
    if (twiceRem > d) return q + away;
    if (twiceRem == d && q.isOdd) return q + away;
    return q;
  }
}

/// A positive rate held as the exact decimal it was written as.
class _Rational {
  const _Rational(this.numerator, this.denominator);

  static final _Rational one = _Rational(BigInt.one, BigInt.one);

  final BigInt numerator;
  final BigInt denominator;

  /// [v] as written — `103.987` is 103987/1000, never the nearest binary
  /// double — refusing anything that is not finite and positive.
  static _Rational ofPositive(num v, String name) {
    if (!v.isFinite || v <= 0) {
      throw ArgumentError.value(v, name, 'a rate must be finite and positive');
    }
    if (v is int) return _Rational(BigInt.from(v), BigInt.one);
    // `toString` is the shortest decimal that reads back as the same double,
    // which for a rate typed or published in decimal is that decimal.
    final String s = v.toString().toLowerCase();
    final List<String> parts = s.split('e');
    final String mantissa = parts[0];
    final int exponent = parts.length > 1 ? int.parse(parts[1]) : 0;
    final int dot = mantissa.indexOf('.');
    final String digits = dot < 0 ? mantissa : mantissa.replaceFirst('.', '');
    final int scale = (dot < 0 ? 0 : mantissa.length - dot - 1) - exponent;
    final BigInt n = BigInt.parse(digits);
    return scale >= 0
        ? _Rational(n, BigInt.from(10).pow(scale))
        : _Rational(n * BigInt.from(10).pow(-scale), BigInt.one);
  }

  _Rational get reciprocal => _Rational(denominator, numerator);

  _Rational dividedBy(_Rational other) =>
      _Rational(numerator * other.denominator, denominator * other.numerator);
}
