import 'package:nikatru_core/nikatru_core.dart' show Money;

import '../../core/format/monthly_share.dart';

/// Re-exported: a file that constructs a [Subscription] necessarily
/// names the type its price is in, and one import for the pair is one
/// fewer place for the two to drift.
export 'package:nikatru_core/nikatru_core.dart' show Money;

enum BillingCycle { monthly, yearly }

/// A single tracked subscription. JSON is snake_case to match the Worker/D1 API.
///
/// Subly-domain model — lives in the app, not the shared spine (de-Subly-fy
/// G-22: `packages/core` stays app-agnostic so stamped apps don't read as clones).
class Subscription {
  const Subscription({
    required this.id,
    required this.name,
    required this.category,
    required this.price,
    required this.cycle,
    required this.nextRenewal,
    this.plan = '',
    this.glyph = '',
    this.usedPct = 0,
    this.usageNote = '',
    this.unused = false,
  });

  final String id;
  final String name;
  final String category;

  /// The charge, as an exact integer count of its own currency's minor unit.
  ///
  /// 🔴 THE CURRENCY IS PART OF THE ROW, and that is the change. It used to be
  /// a bare `double` with the currency living in Settings as a single symbol
  /// applied to every figure in the app — so a user with one dollar plan and
  /// one rupee plan had no way to say so, and the monthly total added the two
  /// numbers as though the units matched. There is no rate table and there
  /// must not be one, so the only honest total groups by currency: see
  /// [SubMath] and `MoneyBag`.
  final Money price;

  final BillingCycle cycle;
  final DateTime nextRenewal;
  final String plan;
  final String glyph;
  final int usedPct;
  final String usageNote;
  final bool unused;

  /// ISO 4217 for this row, e.g. `USD`. Derived from [price] rather than
  /// stored twice — two fields that can disagree about one fact is how the
  /// displayed price and the charged price came apart in the first place.
  String get currencyCode => price.currencyCode;

  /// Normalized to a monthly figure so totals compare like-for-like.
  ///
  /// A yearly plan divides by twelve, rounding half away from zero, so twelve
  /// of these need not add back to the yearly charge. That is right for a
  /// comparison figure and wrong for a payment; nothing here splits a payment.
  /// It is a [MonthlyShare], not a [Money], so it cannot be printed where a
  /// charge belongs: a ROW prints [price] with its cycle label.
  MonthlyShare get monthlyShare => cycle == BillingCycle.yearly
      ? MonthlyShare.ofYearly(price)
      : MonthlyShare.ofMonthly(price);

  /// What this plan charges in a year: the yearly price, or twelve monthly
  /// charges. Computed from [price], never from [monthlyShare].
  Money get yearlyCharge =>
      cycle == BillingCycle.yearly ? price : price.times(12);

  /// Whether this row's one renewal falls in [month] of [year]. The calendar's
  /// list and its month total both ask this, so they cannot disagree.
  bool renewsIn(int year, int month) =>
      nextRenewal.year == year && nextRenewal.month == month;

  bool get isActive => !unused && usedPct > 60;

  int daysUntil(DateTime now) {
    final DateTime a = DateTime(now.year, now.month, now.day);
    final DateTime b = DateTime(
      nextRenewal.year,
      nextRenewal.month,
      nextRenewal.day,
    );
    return b.difference(a).inDays;
  }

  /// [fallbackCurrencyCode] is what a row is read as when the wire carries no
  /// currency of its own — every row written before this field existed. It is
  /// the user's chosen currency where a caller has one, because that is the
  /// unit those numbers were actually typed in.
  factory Subscription.fromJson(
    Map<String, dynamic> j, {
    String fallbackCurrencyCode = Money.fallbackCurrencyCode,
  }) => Subscription(
    id: j['id'].toString(),
    name: (j['name'] ?? '') as String,
    category: (j['category'] ?? 'Other') as String,
    price: readPrice(j, fallbackCurrencyCode: fallbackCurrencyCode),
    cycle: (j['cycle'] == 'yearly')
        ? BillingCycle.yearly
        : BillingCycle.monthly,
    nextRenewal: DateTime.parse(j['next_renewal'] as String),
    plan: (j['plan'] ?? '') as String,
    glyph: (j['glyph'] ?? '') as String,
    usedPct: (j['used_pct'] as num?)?.toInt() ?? 0,
    usageNote: (j['usage_note'] ?? '') as String,
    unused: j['unused'] == true || j['unused'] == 1,
  );

  /// Reads the amount from a row, preferring the exact integer shape and
  /// falling back to the decimal one.
  ///
  /// 🔴 THE OLD COLUMN IS STILL READ, AND THAT IS THE MIGRATION. The API
  /// stores `price` as a SQLite `REAL` and the migration policy for this repo
  /// is strictly additive — no DROP, no RENAME, no type change — so a
  /// `price_minor INTEGER` beside it is the only sanctioned shape and a server
  /// that has not grown one yet must keep working. Reading `price_minor` when
  /// it is there and `price` when it is not is exactly that, and it is lossless
  /// in the direction that matters: a `REAL` that came from an integer number
  /// of minor units rounds back to the same integer.
  static Money readPrice(
    Map<String, dynamic> j, {
    String fallbackCurrencyCode = Money.fallbackCurrencyCode,
  }) {
    final Object? rawCode = j['currency'];
    final String code = rawCode is String && rawCode.length == 3
        ? rawCode.toUpperCase()
        : fallbackCurrencyCode;
    final Object? minor = j['price_minor'];
    // `is int` and not `is num`: a decimal arriving in the integer field is a
    // server that has confused the two columns, and reading 4.99 as 499 there
    // would misprice the row by a hundred. Fall through to the decimal column,
    // which is the field that shape belongs to.
    if (minor is int) return Money(minor, code);
    return Money.fromMajorUnits((j['price'] as num?) ?? 0, code);
  }

  /// 🔴 THE WIRE KEEPS ITS DECIMAL `price` AND GAINS TWO FIELDS BESIDE IT.
  /// Changing the type of a column a live server reads is not something this
  /// increment is allowed to do (see [readPrice]), and a client that silently
  /// stopped sending `price` would write zeroes into every row it touched.
  /// `price_minor` and `currency` are additive, so an old server ignores them
  /// and a new one prefers them.
  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'name': name,
    'category': category,
    'price': price.toMajorUnits(),
    'price_minor': price.minorUnits,
    'currency': price.currencyCode,
    'cycle': cycle.name,
    'next_renewal': dateOnly(nextRenewal),
    'plan': plan,
    'glyph': glyph,
    'used_pct': usedPct,
    'usage_note': usageNote,
    'unused': unused,
  };

  /// ⚠️ [price] IS A `num` OF MAJOR UNITS, NOT A [Money], AND THE ODD ONE OUT
  /// HAS A REASON. The only caller that passes it is `SeedApiClient.update`,
  /// which relays a `changes` map straight off the wire (`changes['price'] as
  /// num?`) and lives behind the frozen `data/api/` boundary. A `Money?`
  /// parameter would not compile there, and inventing a second setter so that
  /// this one could be typed differently is two ways to set one field.
  ///
  /// The amount keeps THIS row's currency, because a patch that changes the
  /// number without naming a currency has not changed the currency.
  Subscription copyWith({
    String? name,
    String? category,
    num? price,
    BillingCycle? cycle,
    DateTime? nextRenewal,
    String? plan,
    int? usedPct,
    bool? unused,
  }) => Subscription(
    id: id,
    name: name ?? this.name,
    category: category ?? this.category,
    price: price == null
        ? this.price
        : Money.fromMajorUnits(price, this.price.currencyCode),
    cycle: cycle ?? this.cycle,
    nextRenewal: nextRenewal ?? this.nextRenewal,
    plan: plan ?? this.plan,
    glyph: glyph,
    usedPct: usedPct ?? this.usedPct,
    usageNote: usageNote,
    unused: unused ?? this.unused,
  );

  /// Replaces the AMOUNT, currency and all — for a caller that really does
  /// have a [Money] (the add sheet, a currency correction).
  Subscription withPrice(Money amount) => Subscription(
    id: id,
    name: name,
    category: category,
    price: amount,
    cycle: cycle,
    nextRenewal: nextRenewal,
    plan: plan,
    glyph: glyph,
    usedPct: usedPct,
    usageNote: usageNote,
    unused: unused,
  );

  static String dateOnly(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-'
      '${d.month.toString().padLeft(2, '0')}-'
      '${d.day.toString().padLeft(2, '0')}';
}
