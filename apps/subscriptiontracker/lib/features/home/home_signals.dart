// HOME'S DECISIONS — HO-05. The unused strip asked one question that only the
// demo data could ever raise (`Subscription.unused` has no writer in the app),
// so on every real account the screen asked nothing. These are the signals a
// real row DOES carry, each with exactly one answer:
//
//   · a free trial ending in ≤ 7 days            → Open
//   · a yearly plan charging in ≤ 60 days        → Open
//   · a price that rose since the last charge    → Open
//   · "Still using {name}?" (a row flagged rare) → Stop
//
// PURE, so `test/home_find_test.dart` drives every boundary without a widget,
// and the screen only decides how a signal looks.
import 'package:flutter/foundation.dart' show immutable;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models/subscription.dart';

/// What a [HomeSignal] is about.
enum HomeSignalKind { trialEnding, yearlyDue, priceRose, stillUsing }

/// One decision Home asks, about one row.
@immutable
class HomeSignal {
  const HomeSignal(this.kind, this.subscription, {this.days = 0, this.was});

  final HomeSignalKind kind;
  final Subscription subscription;

  /// Whole local days until the trial ends or the yearly charge lands.
  final int days;

  /// The price before the rise, for [HomeSignalKind.priceRose].
  final Money? was;
}

/// The horizons, named once.
abstract final class HomeSignals {
  /// A trial ending this soon is a decision to make now.
  static const int trialDays = 7;

  /// A yearly charge this close is worth a look before it lands.
  static const int yearlyDays = 60;

  /// ONE strip — the most urgent — because Home asks ONE decision at a time
  /// (the rule the unused strip set). Three stacked strips on a phone pushed
  /// every row of the list below the fold; the next signal surfaces once this
  /// one is answered.
  static const int maxShown = 1;

  /// Every signal [subs] raise at [now], most urgent kind first, soonest
  /// first within a kind. [stillUsing] says which rows to ask "Still using?"
  /// about; null asks about none.
  ///
  /// ⚠️ A PREDICATE, AND THE CALLER OWNS IT: the only row-level answer today
  /// is the usage flag that nothing in the app writes (`insights_readers_test`
  /// ratchets who may read it), so Home passes it — gated on Settings' "Flag
  /// subscriptions you don't use" — and this file reads no usage field.
  static List<HomeSignal> of(
    List<Subscription> subs,
    DateTime now, {
    bool Function(Subscription s)? stillUsing,
  }) {
    final DateTime today = DateTime.utc(now.year, now.month, now.day);
    int daysTo(DateTime d) =>
        DateTime.utc(d.year, d.month, d.day).difference(today).inDays;

    final List<HomeSignal> out = <HomeSignal>[];
    for (final Subscription s in subs) {
      if (s.deletedAt != null) continue;
      final DateTime? trialEnd = s.trialEndsOn;
      if (s.status == SubscriptionStatus.trialing && trialEnd != null) {
        final int d = daysTo(trialEnd);
        if (d >= 0 && d <= trialDays) {
          out.add(HomeSignal(HomeSignalKind.trialEnding, s, days: d));
          continue;
        }
      }
      if (!s.isCharging) continue;
      final Money? was = s.previousPrice;
      if (was != null &&
          was.currencyCode == s.price.currencyCode &&
          was.minorUnits < s.price.minorUnits) {
        out.add(HomeSignal(HomeSignalKind.priceRose, s, was: was));
        continue;
      }
      if (s.cycle?.unit == CycleUnit.year) {
        final int d = s.daysUntil(now);
        if (d >= 0 && d <= yearlyDays) {
          out.add(HomeSignal(HomeSignalKind.yearlyDue, s, days: d));
          continue;
        }
      }
      if (stillUsing != null && stillUsing(s)) {
        out.add(HomeSignal(HomeSignalKind.stillUsing, s));
      }
    }
    out.sort((HomeSignal a, HomeSignal b) {
      final int byKind = a.kind.index.compareTo(b.kind.index);
      if (byKind != 0) return byKind;
      final int byDays = a.days.compareTo(b.days);
      return byDays != 0
          ? byDays
          : a.subscription.id.compareTo(b.subscription.id);
    });
    return out;
  }
}

/// The catalogue logo for a `service_id`, as an asset path — HO-06.
///
/// 🔴 EMPTY UNTIL THE CONTENT PACK CARRIES LOGOS (train T9, pack v2). The
/// lookup ships now so the row's seam exists and is tested; every row falls
/// back to its monogram until the pack fills this map. A test overrides it
/// with a test pack.
final Provider<Map<String, String>> serviceLogoAssetsProvider =
    Provider<Map<String, String>>((Ref ref) => const <String, String>{});
