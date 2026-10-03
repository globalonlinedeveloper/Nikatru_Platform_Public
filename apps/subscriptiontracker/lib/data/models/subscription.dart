import 'package:nikatru_core/nikatru_core.dart'
    show Cadence, CycleUnit, Money, RecurrenceSchedule;

import '../../core/format/monthly_share.dart';

/// Re-exported: a file that constructs a [Subscription] necessarily
/// names the type its price is in, and one import for the pair is one
/// fewer place for the two to drift. [Cadence] and [CycleUnit] for the same
/// reason: a row names how often it bills.
export 'package:nikatru_core/nikatru_core.dart'
    show Cadence, CycleUnit, Money, RecurrenceSchedule;

/// The legacy name of a row's cadence.
///
/// ⏱ 2026-09-28 · ST-T3b (ST-E4). This was `enum BillingCycle { monthly,
/// yearly }` — two members, so a weekly, quarterly or every-10-days plan could
/// not be written down at all. It is `packages/core`'s (every, unit)
/// [Cadence] now, the one the platform Worker rolls renewals by
/// (`contracts/renewals/`). The alias keeps `BillingCycle.monthly` and
/// `BillingCycle.yearly` meaning exactly what they meant — (1, month) and
/// (1, year) — so a caller that only ever knew the two is untouched.
typedef BillingCycle = Cadence;

/// Where a row is in its life ([ADR no.077] §5.1, 0003's `status`).
///
/// Only [active] and [trialing] are CHARGING: a paused or cancelled row keeps
/// its history on screen and leaves every total and every reminder.
enum SubscriptionStatus {
  active,
  trialing,
  paused,
  cancelled;

  /// The wire value; an unknown one decodes as [active], which is what 0003's
  /// `DEFAULT 'active'` makes every row that predates the column.
  static SubscriptionStatus parse(Object? raw) =>
      SubscriptionStatus.values.firstWhere(
        (SubscriptionStatus s) => s.name == raw,
        orElse: () => SubscriptionStatus.active,
      );
}

/// HOW a row is paid — the API's `rail` (0003, `RAILS` in
/// services/subscriptiontracker-api `routes/subscriptions.ts`). The stop flow
/// picks its walkthrough by it, the detail's India rail panel shows for the
/// three mandate rails, and "How to cancel" offers the store's manage page
/// for the two store rails (DE-06..08).
enum PaymentRail {
  upiAutopay('upi_autopay'),
  cardEmandate('card_emandate'),
  nach('nach'),
  appStore('app_store'),
  play('play'),
  paypal('paypal'),
  manual('manual'),
  unknown('unknown');

  const PaymentRail(this.wire);

  /// The value on the wire.
  final String wire;

  /// The rail for [raw], or null for none or a value this build does not
  /// know — never a guess, because the walkthrough a guess picks is wrong.
  static PaymentRail? tryParse(Object? raw) {
    for (final PaymentRail r in PaymentRail.values) {
      if (r.wire == raw) return r;
    }
    return null;
  }

  /// A standing instruction the user's bank, card or UPI app holds, which
  /// keeps charging until it is revoked THERE (the India rail panel, R3).
  bool get isMandate =>
      this == PaymentRail.upiAutopay ||
      this == PaymentRail.cardEmandate ||
      this == PaymentRail.nach;
}

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
    this.status = SubscriptionStatus.active,
    this.firstChargeOn,
    this.trialEndsOn,
    this.cancelledOn,
    this.deletedAt,
    this.notes = '',
    this.cancelUrl,
    this.reminderDays,
    this.noticeDays,
    this.noticeDaysSupported = false,
    this.serviceId,
    this.previousPrice,
    this.categoryId,
    this.rail,
    this.railHolder,
    this.priceAfterTrial,
    this.priceAfterTrialSupported = false,
    this.tags = const <String>[],
    this.sharedWith,
    this.shareNumerator = 1,
    this.shareDenominator = 1,
  });

  /// The catalogue service this row was picked from (ST-T9, AD-03) — the
  /// pack's id, e.g. `netflix` — or null for a row added by hand
  /// (`service_id`, 0003). Home shows the catalogue's logo for it (HO-06).
  final String? serviceId;

  /// The category BY ID (ST-T9, AD-05) — the API's `category_id` (0005): a
  /// built-in's id (`streaming`) or one of the user's own. [category] stays
  /// the stored name beside it, which the server resolves from this.
  final String? categoryId;

  /// How it is paid (ST-T9, AD-06) — the API's closed `rail` set
  /// ([kRails]) — or null when the user did not say (or the wire carried a
  /// value this build does not know). The stop flow picks its walkthrough by
  /// it and the detail's India rail panel shows for a mandate (DE-07, DE-08).
  final PaymentRail? rail;

  /// Whose card / which UPI handle, as a label the user typed — the API's
  /// `rail_holder`. Never a number: a label like "HDFC card" or "Mum's UPI".
  final String? railHolder;

  /// What a trial turns into (ST-T9, AD-08): the API's
  /// `price_after_trial_minor`, in [price]'s currency. Null when unknown.
  final Money? priceAfterTrial;

  /// Whether the wire CARRIED `price_after_trial_minor` (train T11's column):
  /// the sheet offers the "Then" field only then, as [noticeDaysSupported]
  /// does for notice — a server without the column would drop the value.
  final bool priceAfterTrialSupported;

  /// The rails the sheet offers, in its order — every [PaymentRail] but
  /// `unknown`, which is a reading, not a choice.
  static const List<PaymentRail> kRails = <PaymentRail>[
    PaymentRail.upiAutopay,
    PaymentRail.cardEmandate,
    PaymentRail.nach,
    PaymentRail.appStore,
    PaymentRail.play,
    PaymentRail.paypal,
    PaymentRail.manual,
  ];

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

  /// How often this row bills, or NULL when the wire carried no cadence at
  /// all (0001's `cycle` is nullable, and 0003 lets a body clear the pair).
  ///
  /// 🔴 NULL IS NOT "MONTHLY" FOR THE DATE. A row with no cadence cannot be
  /// rolled forward, so a past [nextRenewal] on it reads "Overdue" rather than
  /// being invented into a next month. Its TOTALS still count it as monthly
  /// ([billingCadence]) — the figure every total showed for it before, kept
  /// rather than silently dropped out of the user's spend.
  final Cadence? cycle;

  /// The next charge date AS STORED. The server rolls it nightly; between
  /// passes (and always, in the unconfigured posture) a screen reads
  /// [nextCharge], never this, or a row three days past reads "Due today".
  final DateTime nextRenewal;
  final String plan;
  final String glyph;
  final int usedPct;
  final String usageNote;
  final bool unused;

  /// Where the row is in its life. See [SubscriptionStatus].
  final SubscriptionStatus status;

  /// The first charge ('YYYY-MM-DD' on the wire), when the user said so.
  final DateTime? firstChargeOn;

  /// The day a free trial turns into [price] every [cycle]. Set with
  /// [SubscriptionStatus.trialing]; the trial-end reminder is armed off it.
  final DateTime? trialEndsOn;

  /// The day the user marked it cancelled.
  final DateTime? cancelledOn;

  /// A soft delete: set, the row is gone from every list, and an Undo clears
  /// it. The server keeps the row and its history either way.
  final DateTime? deletedAt;

  /// Free text the user keeps about it.
  final String notes;

  /// Where to cancel it — an http(s) URL the API validated.
  final String? cancelUrl;

  /// The user's own free-text labels ("family", "work") — the API's `tags`
  /// (0009_tags.sql, ST-AD12). Normalised by [normaliseTags]: trimmed, never
  /// blank, one spelling per tag whatever its case, at most [maxTags] of at
  /// most [maxTagLength] characters each — the bounds the route enforces, so
  /// a list this model holds is a list the server accepts.
  final List<String> tags;

  /// The route's bounds on [tags] (`MAX_TAGS`, `MAX_TAG` in
  /// services/subscriptiontracker-api/src/routes/subscriptions.ts).
  static const int maxTags = 10;
  static const int maxTagLength = 32;

  /// Whether this row carries [tag], compared without case: "Family" and
  /// "family" are one label, and a filter must not split them.
  bool hasTag(String tag) {
    final String want = tag.trim().toLowerCase();
    return tags.any((String t) => t.toLowerCase() == want);
  }

  /// [raw] as a tag list: strings only, trimmed, blanks dropped, the first
  /// spelling of each case-insensitive duplicate kept, capped at [maxTags]
  /// tags of at most [maxTagLength] characters. Anything that is not a list
  /// is no tags — never a guess.
  static List<String> normaliseTags(Object? raw) {
    if (raw is! List) return const <String>[];
    final List<String> out = <String>[];
    final Set<String> seen = <String>{};
    for (final Object? t in raw) {
      if (t is! String) continue;
      final String trimmed = t.trim();
      if (trimmed.isEmpty) continue;
      final String tag = trimmed.length > maxTagLength
          ? trimmed.substring(0, maxTagLength).trim()
          : trimmed;
      if (!seen.add(tag.toLowerCase())) continue;
      out.add(tag);
      if (out.length == maxTags) break;
    }
    return List<String>.unmodifiable(out);
  }

  /// The cadence every MONEY figure is computed with: [cycle], or monthly for
  /// a row that has none (see [cycle] on why the date does not do the same).
  Cadence get billingCadence => cycle ?? Cadence.monthly;

  /// Whether this row is still charging: active or trialing, and not deleted.
  /// Totals, due counts and reminders range over these rows only.
  bool get isCharging =>
      deletedAt == null &&
      (status == SubscriptionStatus.active ||
          status == SubscriptionStatus.trialing);

  /// The first charge on or after [now]'s date — [nextRenewal] rolled by
  /// [cycle] through `packages/core`'s [RecurrenceSchedule], the rule the platform
  /// Worker rolls the stored date by. A row with no cadence is not rolled.
  DateTime nextCharge(DateTime now) {
    final Cadence? c = cycle;
    if (c == null || !c.isValid) return nextRenewal;
    return RecurrenceSchedule.nextOnOrAfter(
      nextRenewal,
      c,
      DateTime(now.year, now.month, now.day),
    );
  }

  /// Days before the charge to remind, e.g. `[7, 1]` — the API's
  /// `reminder_days` (0003). NULL = the account default in Settings (ST-R3).
  final List<int>? reminderDays;

  /// Days of notice the plan needs to be cancelled — the API's `notice_days`
  /// (0004, ST-R8). NULL = none; a "Cancel by" reminder is armed only for a
  /// value.
  final int? noticeDays;

  /// Whether the wire CARRIED `notice_days` at all. The detail screen offers
  /// the field only then: an API that predates 0004 would drop the value and
  /// answer with a row that no longer has it. Deploy order is the API first.
  final bool noticeDaysSupported;

  /// The price before the newest price change, when the row carries its
  /// `price_history` (`GET /v1/subscriptions/:id` serves it, newest first;
  /// ST-I4). Null when there is no history on this row. Home's price-rise
  /// decision reads it (HO-05).
  final Money? previousPrice;

  /// The last day to cancel before the charge on or after [now]
  /// ([nextCharge]), or null when the plan names no notice period.
  DateTime? cancelByFor(DateTime now) {
    final int? notice = noticeDays;
    if (notice == null) return null;
    final DateTime next = nextCharge(now);
    return DateTime(next.year, next.month, next.day - notice);
  }

  /// Who the plan is shared with — a LABEL the user typed ("family",
  /// "flatmates"), never an account (0003's `shared_with`).
  final String? sharedWith;

  /// The user's own part of the plan: [shareNumerator] of [shareDenominator]
  /// (0003's `share_numerator` / `share_denominator`, both NOT NULL DEFAULT 1).
  /// 1/1 is an unshared plan, and is how a share is undone.
  ///
  /// ⏱ 2026-09-30 · ST-P4 (round-2 F38). The columns existed since 0003 and no
  /// client read them, so a Netflix split three ways counted in full in every
  /// total. [myMonthlyShare] and [myYearlyCharge] are what the SPEND figures
  /// now sum; [price] stays what the card is CHARGED, because a shared plan is
  /// still billed in full to whoever pays it.
  final int shareNumerator;
  final int shareDenominator;

  /// Whether the user pays less than the whole plan.
  bool get isShared => shareNumerator < shareDenominator;

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
  ///
  /// Any other cadence is its charges per year over twelve
  /// ([Cadence.chargesPerYear]), rounded ONCE: a weekly plan's share is
  /// price x 52 / 12, an every-10-days plan's price x 365 / 120.
  MonthlyShare get monthlyShare => MonthlyShare.of(price, billingCadence);

  /// [monthlyShare] of the user's own part of the plan ([shareNumerator] of
  /// [shareDenominator]), rounded once. Equal to [monthlyShare] when unshared.
  MonthlyShare get myMonthlyShare => MonthlyShare.of(
    price,
    billingCadence,
    shareNumerator: shareNumerator,
    shareDenominator: shareDenominator,
  );

  /// [yearlyCharge] of the user's own part, rounded once. Equal to
  /// [yearlyCharge] when unshared.
  Money get myYearlyCharge {
    if (!isShared) return yearlyCharge;
    final ({int numerator, int denominator}) r = billingCadence.chargesPerYear;
    return price
        .times(r.numerator * shareNumerator)
        .dividedBy(r.denominator * shareDenominator);
  }

  /// What this plan charges in a year: the yearly price, twelve monthly
  /// charges, 52 weekly ones. Computed from [price], never from
  /// [monthlyShare].
  Money get yearlyCharge {
    final ({int numerator, int denominator}) r = billingCadence.chargesPerYear;
    return r.denominator == 1
        ? price.times(r.numerator)
        : price.times(r.numerator).dividedBy(r.denominator);
  }

  /// Every charge this row makes from [from] to [to], both inclusive: the
  /// [RecurrenceSchedule] chain [nextCharge] reads its first link from, so a
  /// weekly plan charges four or five times in a month and a stored date three
  /// months stale lands on its rolled day. A row with no cadence charges once,
  /// on its stored date, when that falls inside.
  ///
  /// ⏱ ST truth pass (CA-01, IN-03). The calendar and the forecast used to
  /// read the STORED date once — one dot for a weekly plan, a forecast month
  /// for a quarterly plan only when its stored month came round.
  List<DateTime> chargesBetween(DateTime from, DateTime to) {
    final Cadence? c = cycle;
    if (c != null && c.isValid) {
      return RecurrenceSchedule.occurrencesBetween(nextRenewal, c, from, to);
    }
    final DateTime d = DateTime(
      nextRenewal.year,
      nextRenewal.month,
      nextRenewal.day,
    );
    final bool inside =
        !d.isBefore(DateTime(from.year, from.month, from.day)) &&
        !d.isAfter(DateTime(to.year, to.month, to.day));
    return inside ? <DateTime>[d] : const <DateTime>[];
  }

  /// The charges that fall in [month] of [year] ([chargesBetween]). The
  /// calendar's dots, its list and its month total all read this.
  List<DateTime> chargesIn(int year, int month) =>
      chargesBetween(DateTime(year, month), DateTime(year, month + 1, 0));

  /// Whether this row charges at all in [month] of [year].
  bool renewsIn(int year, int month) => chargesIn(year, month).isNotEmpty;

  bool get isActive => !unused && usedPct > 60;

  /// Whole days from [now]'s date to [nextCharge]. Never negative for a row
  /// with a cadence — its next charge is rolled to today or later — so a
  /// negative value means exactly one thing: a row with no cadence whose date
  /// has passed, which the due label reads as "Overdue".
  ///
  /// ⏱ 2026-09-28 · ST-T3b (ST-M3). This measured to the STORED [nextRenewal],
  /// so a monthly row three days past its date read -3, and `DueInfo` printed
  /// "Due today" for it — and for every past date — until the nightly pass
  /// happened to run. In the unconfigured posture no pass ever runs.
  int daysUntil(DateTime now) {
    final DateTime a = DateTime.utc(now.year, now.month, now.day);
    final DateTime next = nextCharge(now);
    final DateTime b = DateTime.utc(next.year, next.month, next.day);
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
    cycle: readCadence(j),
    nextRenewal: DateTime.parse(j['next_renewal'] as String),
    plan: (j['plan'] ?? '') as String,
    glyph: (j['glyph'] ?? '') as String,
    usedPct: (j['used_pct'] as num?)?.toInt() ?? 0,
    usageNote: (j['usage_note'] ?? '') as String,
    unused: j['unused'] == true || j['unused'] == 1,
    status: SubscriptionStatus.parse(j['status']),
    firstChargeOn: _dateOrNull(j['first_charge_on']),
    trialEndsOn: _dateOrNull(j['trial_ends_on']),
    cancelledOn: _dateOrNull(j['cancelled_on']),
    deletedAt: _instantOrNull(j['deleted_at']),
    notes: (j['notes'] ?? '') as String,
    cancelUrl: j['cancel_url'] as String?,
    reminderDays: readReminderDays(j['reminder_days']),
    noticeDays: readNoticeDays(j['notice_days']),
    noticeDaysSupported: j.containsKey('notice_days'),
    serviceId: _textOrNull(j['service_id']),
    categoryId: _textOrNull(j['category_id']),
    rail: PaymentRail.tryParse(j['rail']),
    railHolder: _textOrNull(j['rail_holder']),
    priceAfterTrial: j['price_after_trial_minor'] is int
        ? Money(
            j['price_after_trial_minor'] as int,
            readPrice(
              j,
              fallbackCurrencyCode: fallbackCurrencyCode,
            ).currencyCode,
          )
        : null,
    priceAfterTrialSupported: j.containsKey('price_after_trial_minor'),
    previousPrice: readPreviousPrice(
      j['price_history'],
      fallbackCurrencyCode: fallbackCurrencyCode,
    ),
    tags: normaliseTags(j['tags']),
    sharedWith: _textOrNull(j['shared_with']),
    shareNumerator: readShare(j).numerator,
    shareDenominator: readShare(j).denominator,
  );

  static String? _textOrNull(Object? raw) =>
      raw is String && raw.isNotEmpty ? raw : null;

  /// The OLD price of the newest entry in a `price_history` list, or null for
  /// no history or a shape this cannot read — never a guess.
  static Money? readPreviousPrice(
    Object? raw, {
    String fallbackCurrencyCode = Money.fallbackCurrencyCode,
  }) {
    if (raw is! List || raw.isEmpty) return null;
    final Object? newest = raw.first;
    if (newest is! Map) return null;
    final Object? code = newest['old_currency'];
    final String currency = code is String && code.length == 3
        ? code.toUpperCase()
        : fallbackCurrencyCode;
    final Object? minor = newest['old_price_minor'];
    final Object? major = newest['old_price'];
    if (minor is int) return exactOrDecimal(minor, major, currency);
    if (major is num) return Money.fromMajorUnits(major, currency);
    return null;
  }

  /// The (`share_numerator`, `share_denominator`) pair off the wire, under the
  /// API's own rule (`checkShare`): whole numbers, 1 <= numerator <=
  /// denominator. Anything else — absent, half a pair, a numerator above its
  /// denominator — is the whole plan, 1/1, never a guessed fraction.
  static ({int numerator, int denominator}) readShare(Map<String, dynamic> j) {
    final Object? n = j['share_numerator'];
    final Object? d = j['share_denominator'];
    if (n is int && d is int && n >= 1 && n <= d) {
      return (numerator: n, denominator: d);
    }
    return (numerator: 1, denominator: 1);
  }

  /// `reminder_days` off the wire: a list of whole days, deduplicated and
  /// nearest-to-the-charge LAST (the order the reminders fire in), or null
  /// for "the default". Anything malformed is the default, never a guess.
  static List<int>? readReminderDays(Object? raw) {
    if (raw is! List) return null;
    final Set<int> days = <int>{};
    for (final Object? d in raw) {
      if (d is! int || d < 0) return null;
      days.add(d);
    }
    if (days.isEmpty) return null;
    return List<int>.unmodifiable(days.toList()..sort((int a, int b) => b - a));
  }

  static int? readNoticeDays(Object? raw) =>
      raw is int && raw >= 0 ? raw : null;

  /// The row's cadence: 0003's (`cycle_every`, `cycle_unit`) pair when it is
  /// there, else the legacy `cycle` — every row a pre-0003 server, or this
  /// app's own local store before ST-T3b, ever wrote. NULL when neither is.
  ///
  /// ⚠️ THE LEGACY DECODE USED TO MAP EVERYTHING THAT WAS NOT 'yearly' TO
  /// MONTHLY, a null `cycle` included. The TOTALS keep that reading
  /// ([billingCadence]); the DATE no longer invents a month for it.
  static Cadence? readCadence(Map<String, dynamic> j) =>
      Cadence.tryParse(j['cycle_every'], j['cycle_unit']) ??
      Cadence.fromLegacy(j['cycle']);

  static DateTime? _dateOrNull(Object? raw) {
    if (raw is! String || raw.isEmpty) return null;
    try {
      return RecurrenceSchedule.parseYmd(raw);
    } on FormatException {
      return null;
    }
  }

  static DateTime? _instantOrNull(Object? raw) =>
      raw is String && raw.isNotEmpty ? DateTime.tryParse(raw) : null;

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
    final Object? major = j['price'];
    if (minor is int) return exactOrDecimal(minor, major, code);
    return Money.fromMajorUnits((major as num?) ?? 0, code);
  }

  /// `minor` when it IS `major` in [code]'s ISO 4217 scale, else `major`.
  ///
  /// ⏱ 2026-10-03 · PR #1174 lead ruling 1(a), review finding 2. Before #1174
  /// money.dart wrote every code but JPY and KWD with two minor digits, so a
  /// ₩14,900 plan was stored as `price=14900, price_minor=1490000`; read with
  /// the ISO table (KRW 0) that is ₩1,490,000. The REAL `price` is right under
  /// both scales, so when the two disagree the decimal wins. With no decimal
  /// beside it (null, or not a number) the exact form is all there is.
  static Money exactOrDecimal(int minor, Object? major, String code) {
    if (major is! num) return Money(minor, code);
    final Money decimal = Money.fromMajorUnits(major, code);
    return decimal.minorUnits == minor ? Money(minor, code) : decimal;
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
    // The pair AND the legacy value it means — the API 400s a body where the
    // two disagree, and derives `cycle` itself when only the pair is sent, so
    // sending both (consistently) keeps an old local store readable by an old
    // build too. NULL for both halves when the row has no cadence.
    'cycle': cycle?.legacyCycle,
    'cycle_every': cycle?.every,
    'cycle_unit': cycle?.unit.name,
    'next_renewal': dateOnly(nextRenewal),
    'plan': plan,
    'glyph': glyph,
    'used_pct': usedPct,
    'usage_note': usageNote,
    'unused': unused,
    'status': status.name,
    'first_charge_on': firstChargeOn == null ? null : dateOnly(firstChargeOn!),
    'trial_ends_on': trialEndsOn == null ? null : dateOnly(trialEndsOn!),
    'cancelled_on': cancelledOn == null ? null : dateOnly(cancelledOn!),
    'deleted_at': deletedAt?.toUtc().toIso8601String(),
    'notes': notes,
    'cancel_url': cancelUrl,
    // Sent only when set: a NULL `reminder_days` is the default already, and
    // an API before 0004 has no `notice_days` to receive.
    if (reminderDays != null) 'reminder_days': reminderDays,
    if (noticeDays != null) 'notice_days': noticeDays,
    // The cache round-trips this row through toJson, so the capability rides
    // with it: a cached row must not lose the field the API had emitted.
    if (noticeDaysSupported && noticeDays == null) 'notice_days': null,
    // ST-T9: the server has stored these three since 0003 and the client never
    // sent them. Sent only when set, so an edit that does not touch them
    // cannot clear a value another device wrote.
    if (serviceId != null) 'service_id': serviceId,
    if (categoryId != null) 'category_id': categoryId,
    if (rail != null) 'rail': rail!.wire,
    if (railHolder != null) 'rail_holder': railHolder,
    // Train T11's column, behind its capability exactly like `notice_days`.
    if (priceAfterTrialSupported)
      'price_after_trial_minor': priceAfterTrial?.minorUnits,
    // ST-AD12 (0009_tags.sql). Always sent: an API before 0009 ignores a key
    // its validator does not name, and `[]` is how a PATCH clears them.
    'tags': tags,
    // ST-P4: sent only for a shared plan. An unshared row's 1/1 is 0003's
    // DEFAULT already, and a PATCH that undoes a share sends the pair as 1/1
    // (see [changesFrom]), which is how the API says a share is undone.
    if (isShared || sharedWith != null) ...<String, dynamic>{
      'shared_with': sharedWith,
      'share_numerator': shareNumerator,
      'share_denominator': shareDenominator,
    },
  };

  /// ⚠️ [price] IS A `num` OF MAJOR UNITS, NOT A [Money], AND THE ODD ONE OUT
  /// HAS A REASON: it keeps THIS row's currency, because a change that names a
  /// number without naming a currency has not changed the currency. A caller
  /// that has a [Money] uses [withPrice].
  ///
  /// Only the fields a caller would set to a VALUE are here. A nullable field
  /// that has to be CLEARED (`deletedAt` on Undo, a trial end) goes through
  /// [patched], which reads an explicit null as "clear" exactly as the API's
  /// PATCH does.
  Subscription copyWith({
    String? name,
    String? category,
    num? price,
    Cadence? cycle,
    DateTime? nextRenewal,
    String? plan,
    int? usedPct,
    bool? unused,
    SubscriptionStatus? status,
    String? notes,
    List<String>? tags,
  }) => _with(
    name: name ?? this.name,
    category: category ?? this.category,
    price: price == null
        ? this.price
        : Money.fromMajorUnits(price, this.price.currencyCode),
    cycle: cycle ?? this.cycle,
    nextRenewal: nextRenewal ?? this.nextRenewal,
    plan: plan ?? this.plan,
    usedPct: usedPct ?? this.usedPct,
    unused: unused ?? this.unused,
    status: status ?? this.status,
    notes: notes ?? this.notes,
    tags: tags == null ? null : normaliseTags(tags),
  );

  /// Replaces the AMOUNT, currency and all — for a caller that really does
  /// have a [Money] (the add sheet, a currency correction).
  Subscription withPrice(Money amount) => _with(price: amount);

  /// This row with a PATCH body applied — the in-memory twin of
  /// `PATCH /v1/subscriptions/:id` (services/subscriptiontracker-api
  /// `validate`), for the seed client and for an optimistic update.
  ///
  /// Every key [changes] carries is applied, an explicit null clears, and the
  /// route's two cross-key rules are mirrored so the twin cannot answer
  /// differently from the server:
  ///   · a `price` or `currency` without `price_minor` drops the stored exact
  ///     amount — [readPrice] prefers `price_minor`, so a stale one would
  ///     outrank the new decimal;
  ///   · a legacy `cycle` without the pair re-derives the pair from it.
  Subscription patched(Map<String, dynamic> changes) {
    final Map<String, dynamic> merged = <String, dynamic>{
      ...toJson(),
      ...changes,
    };
    if (!changes.containsKey('price_minor') &&
        (changes.containsKey('price') || changes.containsKey('currency'))) {
      merged.remove('price_minor');
    }
    if (changes.containsKey('cycle') && !changes.containsKey('cycle_unit')) {
      final Cadence? legacy = Cadence.fromLegacy(changes['cycle']);
      merged['cycle_every'] = legacy?.every;
      merged['cycle_unit'] = legacy?.unit.name;
    }
    merged['id'] = id;
    return Subscription.fromJson(
      merged,
      fallbackCurrencyCode: price.currencyCode,
    );
  }

  /// The PATCH body that turns [before] into this row: ONLY the keys whose
  /// wire value changed (ST-E1), so an edit that renames a row sends a name
  /// and nothing else — never a whole row that would stamp stale values over
  /// a concurrent change.
  ///
  /// Keys that the API judges TOGETHER travel together, because it 400s them
  /// apart ([ADR no.077] §5, `validate` in routes/subscriptions.ts):
  ///   · `price`, `price_minor`, `currency` — the exact amount must be sent
  ///     with the decimal and the currency it is an amount of;
  ///   · `cycle`, `cycle_every`, `cycle_unit` — half a cadence is not one.
  Map<String, dynamic> changesFrom(Subscription before) {
    final Map<String, dynamic> a = before.toJson();
    final Map<String, dynamic> b = toJson();
    final Map<String, dynamic> out = <String, dynamic>{};
    for (final String k in b.keys) {
      if (k == 'id') continue;
      if (!_sameWireValue(a[k], b[k])) out[k] = b[k];
    }
    for (final List<String> group in _togetherKeys) {
      if (group.any(out.containsKey)) {
        for (final String k in group) {
          out[k] = b[k];
        }
      }
    }
    // A share undone leaves its keys out of [toJson]; the API's undo is an
    // explicit 1/1 and a null label. AFTER the groups, which would otherwise
    // copy the absent keys back as null.
    if (before.isShared || before.sharedWith != null) {
      if (!b.containsKey('share_numerator')) {
        out['shared_with'] = null;
        out['share_numerator'] = 1;
        out['share_denominator'] = 1;
      }
    }
    return out;
  }

  /// Wire equality: a list (`tags`, `reminder_days`) is compared by its
  /// elements, since two decodes of one list are two objects and `!=` would
  /// send every list on every edit.
  static bool _sameWireValue(Object? a, Object? b) {
    if (a is List && b is List) {
      if (a.length != b.length) return false;
      for (int i = 0; i < a.length; i++) {
        if (a[i] != b[i]) return false;
      }
      return true;
    }
    return a == b;
  }

  static const List<List<String>> _togetherKeys = <List<String>>[
    <String>['price', 'price_minor', 'currency'],
    <String>['cycle', 'cycle_every', 'cycle_unit'],
    <String>['share_numerator', 'share_denominator'],
  ];

  Subscription _with({
    String? name,
    String? category,
    Money? price,
    Cadence? cycle,
    DateTime? nextRenewal,
    String? plan,
    int? usedPct,
    bool? unused,
    SubscriptionStatus? status,
    String? notes,
    List<String>? tags,
  }) => Subscription(
    id: id,
    name: name ?? this.name,
    category: category ?? this.category,
    price: price ?? this.price,
    cycle: cycle ?? this.cycle,
    nextRenewal: nextRenewal ?? this.nextRenewal,
    plan: plan ?? this.plan,
    glyph: glyph,
    usedPct: usedPct ?? this.usedPct,
    usageNote: usageNote,
    unused: unused ?? this.unused,
    status: status ?? this.status,
    firstChargeOn: firstChargeOn,
    trialEndsOn: trialEndsOn,
    cancelledOn: cancelledOn,
    deletedAt: deletedAt,
    notes: notes ?? this.notes,
    cancelUrl: cancelUrl,
    reminderDays: reminderDays,
    noticeDays: noticeDays,
    noticeDaysSupported: noticeDaysSupported,
    serviceId: serviceId,
    previousPrice: previousPrice,
    categoryId: category == null || category == this.category
        ? categoryId
        : null,
    rail: rail,
    railHolder: railHolder,
    priceAfterTrial: priceAfterTrial,
    priceAfterTrialSupported: priceAfterTrialSupported,
    tags: tags ?? this.tags,
    sharedWith: sharedWith,
    shareNumerator: shareNumerator,
    shareDenominator: shareDenominator,
  );

  /// The mark a row wears when nobody chose one: the first three letters of
  /// its name, upper case, padded with X. ONE rule, applied by the add sheet
  /// before POST (so the Worker stores it) and by the seed client for a draft
  /// that arrives without one — they used to be one inline copy in the seed
  /// client, so a live row carried no glyph at all (ST-E2).
  static String glyphFor(String name) {
    final String trimmed = name.trim();
    return trimmed.padRight(3, 'X').substring(0, 3).toUpperCase();
  }

  static String dateOnly(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-'
      '${d.month.toString().padLeft(2, '0')}-'
      '${d.day.toString().padLeft(2, '0')}';
}
