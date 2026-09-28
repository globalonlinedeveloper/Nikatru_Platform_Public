/// THE RENEWAL RULE — "given a charge date and a cadence, when is the next
/// one" — for every app on the platform.
///
/// 🔴 ONE RULE, TWO RUNTIMES. The platform Worker's nightly fan-out
/// (`services/platform/src/renewals.ts`, `advance` / `rollForward`) rolls
/// `next_renewal` and writes `payment_history` for every app database; this
/// file is what an app shows between those passes, offline, and in the
/// unconfigured posture where no Worker runs at all. A TypeScript function
/// cannot be called from Dart, so what the two share is the ANSWERS:
/// `contracts/renewals/vectors.json` holds them, and
/// `test/renewal_schedule_test.dart` and the Worker's `renewals.test.ts` each
/// iterate every vector. A change to one implementation reds the other's suite
/// rather than shipping a screen that disagrees with the server.
///
/// Pure date arithmetic on the year/month/day FIELDS only — no time of day,
/// no zone — so no runner's timezone or DST transition can move a result.
library;

/// The units a cadence is counted in ([ADR no.077] §5.1: `cycle_unit`).
enum CycleUnit { day, week, month, year }

/// "Every [every] [unit]s": a subscription's billing cadence.
///
/// The legacy two-value `cycle` (`monthly` / `yearly`) is (1, month) and
/// (1, year); [fromLegacy] and [legacyCycle] are the two directions of that
/// mapping, and nothing else in the platform should spell it.
class Cadence {
  const Cadence(this.every, this.unit);

  /// Every 1 month.
  static const Cadence monthly = Cadence(1, CycleUnit.month);

  /// Every 1 year.
  static const Cadence yearly = Cadence(1, CycleUnit.year);

  /// Every 1 week.
  static const Cadence weekly = Cadence(1, CycleUnit.week);

  /// Every 3 months.
  static const Cadence quarterly = Cadence(3, CycleUnit.month);

  /// The API's own bound on `cycle_every`: a year counted in the finest unit.
  static const int maxEvery = 366;

  final int every;
  final CycleUnit unit;

  /// Whether this is a cadence the rule accepts: 1..[maxEvery].
  bool get isValid => every >= 1 && every <= maxEvery;

  /// The legacy `cycle` value this cadence means, or null for any other — the
  /// same mapping the API keeps (`legacyCycle` in
  /// `services/subscriptiontracker-api/src/routes/subscriptions.ts`).
  String? get legacyCycle {
    if (every != 1) return null;
    return switch (unit) {
      CycleUnit.month => 'monthly',
      CycleUnit.year => 'yearly',
      _ => null,
    };
  }

  /// A legacy `cycle` as a cadence, or null for anything but the two values.
  static Cadence? fromLegacy(Object? cycle) => switch (cycle) {
    'monthly' => monthly,
    'yearly' => yearly,
    _ => null,
  };

  /// The wire pair (`cycle_every`, `cycle_unit`) as a cadence, or null when
  /// either is missing or out of range — the caller then falls back to
  /// [fromLegacy], never to a guessed month.
  static Cadence? tryParse(Object? every, Object? unit) {
    if (every is! int) return null;
    final CycleUnit? u = CycleUnit.values
        .where((CycleUnit x) => x.name == unit)
        .firstOrNull;
    if (u == null) return null;
    final Cadence c = Cadence(every, u);
    return c.isValid ? c : null;
  }

  /// How many charges a year this cadence makes, as an exact fraction
  /// (numerator, denominator) — so a money figure derived from it rounds ONCE.
  ///
  /// A year is 12 months, 52 weeks and 365 days here. Those are comparison
  /// figures (a weekly plan's "per month" is 52/12 charges), never a payment:
  /// the dates a charge actually lands on come from [RenewalSchedule].
  ({int numerator, int denominator}) get chargesPerYear => switch (unit) {
    CycleUnit.day => (numerator: 365, denominator: every),
    CycleUnit.week => (numerator: 52, denominator: every),
    CycleUnit.month => (numerator: 12, denominator: every),
    CycleUnit.year => (numerator: 1, denominator: every),
  };

  @override
  bool operator ==(Object other) =>
      other is Cadence && other.every == every && other.unit == unit;

  @override
  int get hashCode => Object.hash(every, unit);

  @override
  String toString() => 'Cadence($every ${unit.name})';
}

/// The result of [RenewalSchedule.rollForward]: the first charge date on or
/// after `today`, and every charge date crossed on the way (one payment each).
class RenewalRoll {
  const RenewalRoll(this.next, this.crossings);
  final DateTime next;
  final List<DateTime> crossings;
}

/// The renewal rule. See the library comment for why it exists twice.
abstract final class RenewalSchedule {
  /// At most this many crossings per [rollForward] — the Worker's own guard,
  /// so a pathological backlog costs the same bound in both runtimes.
  static const int maxCrossings = 240;

  /// [date] advanced by one [cadence] step.
  ///
  /// `day`/`week` add calendar days. `month`/`year` add months and CLAMP to
  /// the month's last day — never overflow: Jan 31 + 1 month is Feb 28/29,
  /// not "Feb 31" normalised into March, which skipped February's charge.
  ///
  /// [anchorDay] is the day of month a chain returns to after a clamp
  /// (Jan 31 → Feb 28 → Mar 31); it defaults to [date]'s own day and is
  /// ignored for `day`/`week`. Only the date FIELDS of [date] are read; the
  /// result is a local-midnight [DateTime] with the answer's fields.
  static DateTime advance(DateTime date, Cadence cadence, {int? anchorDay}) {
    if (!cadence.isValid) {
      throw RangeError.range(cadence.every, 1, Cadence.maxEvery, 'every');
    }
    switch (cadence.unit) {
      case CycleUnit.day:
      case CycleUnit.week:
        final int days = cadence.unit == CycleUnit.week
            ? cadence.every * 7
            : cadence.every;
        // UTC so no DST day is 23 or 25 hours; DateTime.utc normalises an
        // overflowing day into the right month and year, which is exactly
        // what adding calendar days means.
        final DateTime d = DateTime.utc(date.year, date.month, date.day + days);
        return DateTime(d.year, d.month, d.day);
      case CycleUnit.month:
      case CycleUnit.year:
        final int anchor = (anchorDay ?? date.day).clamp(1, 31);
        final int months = cadence.unit == CycleUnit.year
            ? cadence.every * 12
            : cadence.every;
        final int total = date.year * 12 + (date.month - 1) + months;
        final int year = total ~/ 12;
        final int month = total % 12 + 1;
        final int day = anchor < _daysInMonth(year, month)
            ? anchor
            : _daysInMonth(year, month);
        return DateTime(year, month, day);
    }
  }

  /// Roll [next] forward until it is on or after [today], recording each
  /// date crossed. A date equal to [today] is NOT crossed: that charge has
  /// not happened yet. The anchor is read from [next] once (or taken from
  /// [anchorDay]) and carried through the whole chain.
  static RenewalRoll rollForward(
    DateTime next,
    Cadence cadence,
    DateTime today, {
    int? anchorDay,
  }) {
    final List<DateTime> crossings = <DateTime>[];
    final int anchor = anchorDay ?? next.day;
    final int todayKey = _key(today);
    DateTime cur = DateTime(next.year, next.month, next.day);
    while (_key(cur) < todayKey && crossings.length < maxCrossings) {
      crossings.add(cur);
      cur = advance(cur, cadence, anchorDay: anchor);
    }
    return RenewalRoll(cur, crossings);
  }

  /// The first charge on or after [today] for a row whose stored next charge
  /// is [next] — what a screen shows when the nightly pass has not run yet.
  static DateTime nextOnOrAfter(
    DateTime next,
    Cadence cadence,
    DateTime today, {
    int? anchorDay,
  }) => rollForward(next, cadence, today, anchorDay: anchorDay).next;

  /// `YYYY-MM-DD` for [d]'s date fields — the wire's date shape.
  static String ymd(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-'
      '${d.month.toString().padLeft(2, '0')}-'
      '${d.day.toString().padLeft(2, '0')}';

  /// A `YYYY-MM-DD` string as a local-midnight [DateTime]. Throws a
  /// [FormatException] on anything else, rather than inventing a date.
  static DateTime parseYmd(String s) {
    final RegExpMatch? m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})').firstMatch(s);
    if (m == null) throw FormatException('not a YYYY-MM-DD date', s);
    final int y = int.parse(m.group(1)!);
    final int mo = int.parse(m.group(2)!);
    final int d = int.parse(m.group(3)!);
    if (mo < 1 || mo > 12 || d < 1 || d > _daysInMonth(y, mo)) {
      throw FormatException('not a calendar date', s);
    }
    return DateTime(y, mo, d);
  }

  static int _key(DateTime d) => d.year * 10000 + d.month * 100 + d.day;

  /// Day 0 of the next month IS the last day of [month].
  static int _daysInMonth(int year, int month) =>
      DateTime.utc(year, month + 1, 0).day;
}
