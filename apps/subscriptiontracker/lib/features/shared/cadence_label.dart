import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';

/// The per-cycle caption under a price — "per month", "per year", "every 2
/// weeks" — for any [Cadence] (ST-E4).
///
/// 🔴 ONE FUNCTION FOR EVERY SCREEN. Home, calendar, scan and detail each
/// spelled `s.cycle == BillingCycle.yearly ? perYear : perMonth`, so the day a
/// row could be weekly all four would have called it "per month". A row with
/// no cadence is captioned monthly, the same reading its totals use
/// ([Subscription.billingCadence]).
String cadenceCaption(AppLocalizations l10n, Cadence? cadence) {
  final Cadence c = cadence ?? Cadence.monthly;
  if (c == Cadence.monthly) return l10n.perMonth;
  if (c == Cadence.yearly) return l10n.perYear;
  return switch (c.unit) {
    CycleUnit.day => l10n.perEveryDays(c.every),
    CycleUnit.week => l10n.perEveryWeeks(c.every),
    CycleUnit.month => l10n.perEveryMonths(c.every),
    CycleUnit.year => l10n.perEveryYears(c.every),
  };
}
