// ─────────────────────────────────────────────────────────────────────────────
// PAYWALL · WIDTH — `ContentPane.pane` (480), the screen that NAMES the bug the
// whole pane family exists for.
//
// `paywall_screen.dart:132-139` records it: `_body` returns a different number
// of widgets per `_PaywallPhase`, so the ListView's extent changes every time
// the phase does, and under the `Center` this screen used to have that
// re-centred the whole scroller — press Buy and the plan list you were looking
// at slides. `.pane` is the 480 the file used to hold privately. Nothing in the
// repository asserted on either half of that: the pane was deletable green.
//
// Everything structural — why the assertion is on incoming `BoxConstraints`
// rather than on `getSize`, why every case pins the surface — lives in
// `support/width_harness.dart`. Read that header before adding a case here.
//
// 🔴 THE ARITHMETIC, AND IT IS THE OPPOSITE OF THE AUTH SCREENS'.
// Here the 24/24 gutters are the `ListView`'s own `padding:`, INSIDE the pane
// (`paywall_screen.dart:142`), so they never come off what the pane offers:
//
//   · at 375 the surface binds → the ListView is offered 375, whole;
//   · at 768 the CAP binds     → the ListView is offered `AppBreakpoints.pane`
//                                FLAT (480), and the offering Card inside it
//                                gets `480 - 48` = 432.
//
// Both numbers are asserted below, because they fail for different reasons: the
// first if the pane goes, the second if the pane stays and the ListView's
// padding moves. Measured, not derived by analogy — `width_auth_test.dart`'s
// header is the same warning pointing the other way.
//
// 🔴 AND THAT MAKES THIS FILE FALSIFIABLE CHEAPLY. 480 < 768, so the cap has
// ALREADY engaged on a small tablet: widen `ContentPane.pane` and the 768 case
// goes red on the spot, with no 1920 surface required.
//
// Negative-tested against the real tree, 2026-08-09, two mutations, `flutter
// analyze` clean at the 29-issue baseline under each — and they land on
// DIFFERENT assertions, which is why both assertions are here:
//
//   · `ContentPane.pane(` → `ContentPane(` (default 1280) → 768 fails
//     `Expected <480.0> Actual <768.0>`, 1920 fails `<480.0>` vs `<1280.0>`,
//     375 green (the no-op case);
//   · the ListView's `padding` MOVED OUTSIDE the pane (pane and cap untouched)
//     → the 768 ListView assertion stays GREEN, 480 either way, and the CARD
//     assertion is the one that catches it: `Expected <432.0> Actual <480.0>`
//     (375 goes red too, 327 for 375). An assertion on the scroller alone
//     could not see this; that is what the second expect is for.
//
// 🔴 WHY THIS FILE OVERRIDES `purchaseRailProvider` WHEN NO OTHER WIDTH FILE
// OVERRIDES ANYTHING. The shipped `HostedCheckoutRail` refuses with
// `railNotConfigured` today (no `checkout_url_template` — OWNER_QUEUE A-1), so
// `canStartCheckout` is false and the choosing phase renders ONE line of copy:
// `l10n.paywallUnavailable`. Measured on the harness defaults: **zero `Card`s,
// zero `ListTile`s**. That is the empty state the harness header refuses to
// measure — "no rows to stretch, no chevrons at the far edge, nothing the cap
// is there to prevent". The fake rail below is `chassis_properties_test`'s
// `_moneyContainer`/`_FakeRail` idiom (a fake RAIL, never a fake gate) reused so
// this file measures the populated paywall: the price row, which is the widest
// thing on the screen and the one element `.pane` was chosen to bound.
//
// ⚠️ NO TAP CASES. The Upgrade button runs the real `_buy` funnel and the
// unlocked state calls `context.go('/')`; `pumpAt` has no router. The purchase
// funnel is `chassis_properties_test`'s property and has its own container.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/monetization/paywall_screen.dart'
    show PaywallView;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';
import 'package:nikatru_purchases/testing.dart';
import 'package:subscriptiontracker/features/monetization/paywall_screen.dart';
import 'package:subscriptiontracker/state/money_providers.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/width_harness.dart';

/// In-memory [core.SecureStore] — the real one is a platform channel a widget
/// test has not got. Same shape as `chassis_properties_test`'s `_MemSecureStore`.
///
/// The paywall only reaches it through `entitlementConvergenceProvider`, i.e. on
/// the Buy path, which this file never walks. It is overridden anyway because
/// the container is the money container: leaving one seam of it un-faked makes
/// the next case added here fail for a reason that has nothing to do with width.
class _MemSecureStore implements core.SecureStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<void> delete(String key) async => data.remove(key);
  @override
  Future<void> deleteAll() async => data.clear();
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

/// A rail that really offers something — see the file header.
///
/// TWO offerings, not one: the monthly carries a trial so its subtitle is
/// `paywallTermWithTrial`, the longest string this screen renders, and it is the
/// one that would wrap or overflow first if the cap moved.
FakePurchaseRail _offeringRail() => FakePurchaseRail(
  offerings: const <Offering>[
    Offering(
      productId: 'pro_monthly',
      amountMinor: 499,
      currencyCode: 'USD',
      term: OfferingTerm.month,
      trial: TrialPeriod.days(30),
    ),
    Offering(
      productId: 'pro_yearly',
      amountMinor: 4999,
      currencyCode: 'USD',
      term: OfferingTerm.year,
    ),
  ],
  canStartCheckout: true,
  refusal: CheckoutRefusal.notSignedIn,
  refusalDetail: 'width test does not buy anything',
);

/// The money seams this screen needs on top of the harness's two.
List<Override> _moneyOverrides() => <Override>[
  secureStoreProvider.overrideWithValue(_MemSecureStore()),
  sellingEnabledProvider.overrideWithValue(true),
  purchaseRailProvider.overrideWithValue(_offeringRail()),
];

void main() {
  // ── PAYWALL · ContentPane.pane (480) ───────────────────────────────────────
  group('paywall is capped at pane width', () {
    testWidgets('at 375 the cap is a no-op and nothing overflows', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        const PaywallScreen(),
        overrides: _moneyOverrides(),
      );
      expect(
        offeredWidth(tester, inPane(ListView)),
        375,
        reason:
            'below the cap a ConstrainedBox may only tighten within what it '
            'was handed, so a phone must render exactly as it did before the '
            'pane existed. The 24/24 gutters are the ListView\'s OWN padding, '
            'inside the pane, so they do not come off this number',
      );
      // ⏱ ST-D9: a plan is the foundation's `AppCard`, no longer a `Card`.
      expect(
        find.byType(AppCard),
        findsNWidgets(2),
        reason:
            'the state sentinel: with the shipped rail this screen renders one '
            'line of copy and no cards at all, and a width measured on THAT is '
            'a width nobody cares about — see the file header',
      );
      expect(
        tester.takeException(),
        isNull,
        reason:
            'a plan card stacks a formatted price, its term and an Upgrade '
            'button — 375 is where that first complains if it is going to',
      );
    });

    // ⚠️ 768 IS ALREADY PAST THE CAP — the number is `AppBreakpoints.pane`
    // FLAT, because the gutters are inside it. This is the case a deleted pane
    // reddens without a 1920 surface.
    testWidgets('at 768 the pane cap has ALREADY engaged', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kTablet,
        const PaywallScreen(),
        overrides: _moneyOverrides(),
      );
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.pane,
        reason:
            'a tablet is wider than 480, so this is the width at which the '
            'pane starts mattering — and the width at which deleting it goes '
            'red, unlike the kMaxBodyWidth screens that need a 1920 surface',
      );
      // The PRICE ROW, not the scroller again. This is the element the choice
      // of `.pane` was actually about: uncapped, the price sits at one edge of
      // the window and the Upgrade button at the other, with a tablet's worth
      // of nothing between them. `pane - 48` is the ListView's own padding,
      // which is inside the cap.
      expect(
        offeredWidth(tester, find.byType(AppCard).first),
        AppBreakpoints.pane - 48,
        reason:
            'the offering card is offered the capped width less the '
            'ListView\'s 24/24 padding — this is the assertion that also '
            'fails if that padding moves OUTSIDE the pane',
      );
    });

    // ⏱ 2026-10-01 · train P39 (SYN-X1 C-17): the EXPANDED class. With no
    // pitch served the paywall is the 480 pane at every width, and 1024 is
    // past the 840 two-column threshold that only a pitch opens.
    testWidgets('at 1024 (expanded) the paywall is still 480', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kExpanded,
        const PaywallScreen(),
        overrides: _moneyOverrides(),
      );
      expect(offeredWidth(tester, inPane(ListView)), AppBreakpoints.pane);
      expect(tester.takeException(), isNull);
    });

    testWidgets('at 1920 the paywall is still 480, not a wall of card', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kWide,
        const PaywallScreen(),
        overrides: _moneyOverrides(),
      );
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.pane,
        reason:
            'the cap is absolute, not a fraction of the window: the same 480 '
            'at 1920 as at 768',
      );
      expect(AppBreakpoints.pane, 480);
    });

    // ⏱ ST-D9: WITH A PITCH FROM CONFIG, from 840 up the features sit BESIDE
    // the plans, and the cap is two panes and their gap — the one wider paywall.
    // Without one (the cases above: the default config pitches nothing) it is
    // the 480 pane at every width, which is what those cases still hold. No
    // kDesktop case, argued in `assert-responsive-coverage.mjs` WIDTH_EXEMPT:
    // both caps have already engaged below 1280, so 1920 asserts the same.
    testWidgets('at 1920 with a pitch: two columns, capped at wideMaxWidth', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kWide,
        const PaywallScreen(),
        overrides: <Override>[
          ..._moneyOverrides(),
          paywallPitchProvider.overrideWithValue((
            pro: <String>['plan', 'save'],
            free: <String>['sync'],
            trialCopy: false,
          )),
        ],
      );
      expect(offeredWidth(tester, inPane(ListView)), PaywallView.wideMaxWidth);
      final Rect features = tester.getRect(
        find.byKey(PaywallView.featuresCard),
      );
      final Rect plan = tester.getRect(find.byType(AppCard).last);
      expect(features.right, lessThan(plan.left));
      expect(tester.takeException(), isNull);
    });
  });
}
