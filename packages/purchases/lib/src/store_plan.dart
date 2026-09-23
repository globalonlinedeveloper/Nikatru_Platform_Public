import 'package:flutter/foundation.dart' show debugPrint, immutable;
import 'package:nikatru_core/nikatru_core.dart' show Money;

import 'offering.dart';

/// One plan as the STORE sells it in this storefront, to this buyer — the
/// answer to `IapBridge.storePlans`, and the only source of a price, a
/// currency, a term or a trial on a store rail.
///
/// ## Why the store, and not the rail config
/// A store buyer is charged what the store charges: the storefront's own
/// currency and its own price tier, set in the store console. The rail config
/// states the WEB price in the web currency. Showing the config's amount on a
/// store paywall shows a number the buyer is not going to be charged, in a
/// currency they may not pay in — and the store's sheet, one tap later, would
/// say the true one.
///
/// ## What it deliberately does not carry
/// No `priceString`. The store hands one over ready formatted, and a displayed
/// price is DERIVED from an amount and an ISO code on this platform
/// (`Offering.formattedPrice`, `assert-no-price-literals`). The amount is
/// converted once, here, by [minorUnitsOf].
@immutable
class StorePlan {
  const StorePlan({
    required this.productId,
    required this.amountMinor,
    required this.currencyCode,
    required this.term,
    this.trial,
  });

  /// The RAIL's product id — the store identifier up to its first `:`, so a
  /// Play `pro_monthly:monthly` and an App Store `pro_monthly` are the same
  /// plan. The bridge decides this in one function.
  final String productId;

  /// The store's price in the currency's minor unit.
  final int amountMinor;

  /// ISO 4217, upper case, as the storefront charges it.
  final String currencyCode;

  /// From the store product's own billing period, never from the config.
  final OfferingTerm term;

  /// The FREE trial this buyer is eligible for, in the store's own unit; null
  /// when there is none or the buyer already used it.
  final TrialPeriod? trial;

  /// The store's decimal [price] as an integer count of [currencyCode]'s minor
  /// unit, rounded to the nearest one: 7.19 in a two-digit currency is 719,
  /// 1200.0 in a zero-digit one is 1200, 1.25 in a three-digit one is 1250.
  ///
  /// 🔴 ROUNDED, NOT TRUNCATED. The SDK sends a double, and 7.19 × 100 is
  /// 718.9999999999999 in binary floating point; a truncation would show 7.18
  /// for a product the store charges 7.19 for. Null for anything that is not a
  /// positive finite price in a three-letter currency — a plan whose price
  /// cannot be read is not shown, the same fail-closed rule as the config's.
  static int? minorUnitsOf(double price, String currencyCode) {
    if (!price.isFinite || price <= 0) return null;
    if (currencyCode.length != 3) return null;
    final int digits = Money.minorUnitDigitsFor(currencyCode.toUpperCase());
    final int minor = (price * Money.pow10(digits)).round();
    return minor > 0 ? minor : null;
  }

  /// This plan as the paywall paints it.
  Offering toOffering() => Offering(
        productId: productId,
        amountMinor: amountMinor,
        currencyCode: currencyCode,
        term: term,
        trial: trial,
      );

  @override
  String toString() =>
      'StorePlan($productId, $amountMinor $currencyCode, ${term.wire}, '
      'trial ${trial ?? 'none'})';
}

/// The offerings a STORE rail shows: the config's product ids, in the config's
/// order, each described by the store.
///
/// - A config product the store did not return is NOT offered. That is every
///   one-time product today and everything on a storefront that does not carry
///   the plan; offering it would put up a buy button with the web price on it.
/// - A store plan whose term disagrees with the config's term for the same id
///   is DROPPED with a debug line: one of the two is misconfigured, and a
///   "billed per month" line on a yearly charge is a chargeback.
/// - A store plan the config does not name is not offered. The config decides
///   WHICH plans this app sells; the store only describes them.
List<Offering> offeringsFromStore(
  List<Offering> config,
  List<StorePlan> store,
) {
  final Map<String, StorePlan> byId = <String, StorePlan>{
    for (final StorePlan p in store) p.productId: p,
  };
  final List<Offering> out = <Offering>[];
  for (final Offering c in config) {
    final StorePlan? s = byId[c.productId];
    if (s == null) continue;
    if (s.term != c.term) {
      debugPrint(
        '[purchases] dropped ${c.productId}: the store bills it per '
        '${s.term.wire} and the rail config says ${c.term.wire}.',
      );
      continue;
    }
    out.add(s.toOffering());
  }
  return List<Offering>.unmodifiable(out);
}
