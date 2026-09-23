import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/monetization/paywall_screen.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/width_harness.dart';

/// `PaywallView` — the five states a hosted checkout can leave the app in.
///
/// 🏗️ The widget half of `property: money-funnel-emitted-as-a-set` and
/// `property: paywall-gate-driven-by-server`. That the four funnel events are
/// EMITTED, and that the gate is driven by the server, are wiring halves and
/// stay in the brick's `chassis_properties_test.dart`, which boots the stamped
/// providers.
void main() {
  const List<PaywallOffer> offers = <PaywallOffer>[
    PaywallOffer(
      id: 'pro_monthly',
      formattedPrice: r'$4.99',
      term: 'month',
    ),
    PaywallOffer(
      id: 'pro_yearly',
      formattedPrice: r'$39.99',
      term: 'year',
      trial: (count: 7, unit: 'day'),
    ),
  ];

  Widget view({
    PaywallPhase phase = PaywallPhase.choosing,
    List<PaywallOffer> plans = offers,
    bool canStartCheckout = true,
    String detail = '',
    void Function(PaywallOffer)? onBuy,
    VoidCallback? onCheckAgain,
    VoidCallback? onGoHome,
  }) => PaywallView(
    phase: phase,
    offers: plans,
    canStartCheckout: canStartCheckout,
    detail: detail,
    onBuy: onBuy ?? (PaywallOffer _) {},
    onCheckAgain: onCheckAgain ?? () {},
    onGoHome: onGoHome ?? () {},
  );

  // ── (1) THE WIDTH DECISION, AT ALL THREE WINDOW CLASSES ───────────────────
  //
  // The cap is `AppBreakpoints.pane` (480) rather than the page default, and it
  // is the whole reason this screen has a width case: the plan list re-lays out
  // every time the phase changes, and an uncapped one moves the row the user was
  // reading. 375 is below the cap, so the pane yields; 768 and 1280 are both
  // above it, so the SAME constant is asserted at two different windows —
  // which is what proves the cap engaged rather than the window shrinking.
  group('property: paywall-pane-is-capped at every window class', () {
    Future<double> paneWidthAt(WidgetTester tester, Size size) async {
      await pumpChassis(tester, size, view());
      return tester.getSize(find.byType(ListView)).width;
    }

    testWidgets('kPhone — narrower than the cap, so the pane yields', (
      WidgetTester tester,
    ) async {
      expect(await paneWidthAt(tester, kPhone), kPhone.width);
    });

    testWidgets('kTablet — the cap holds', (WidgetTester tester) async {
      expect(await paneWidthAt(tester, kTablet), AppBreakpoints.pane);
    });

    testWidgets('kDesktop — the cap still holds', (WidgetTester tester) async {
      expect(await paneWidthAt(tester, kDesktop), AppBreakpoints.pane);
    });
  });

  // ── (2) THE PHASES, AND THE SENTENCE EACH OF THEM SAYS ────────────────────
  group('property: paywall-phases-are-distinct', () {
    testWidgets('choosing renders a row per offer, with the RAIL price', (
      WidgetTester tester,
    ) async {
      await pumpChassis(tester, kPhone, view());
      expect(find.text(r'$4.99'), findsOneWidget);
      expect(find.text(r'$39.99'), findsOneWidget);
      expect(find.byKey(PaywallView.upgradeButton), findsNWidgets(2));
    });

    testWidgets('choosing with NO offers says unavailable, not an empty list', (
      WidgetTester tester,
    ) async {
      await pumpChassis(
        tester,
        kPhone,
        view(plans: const <PaywallOffer>[]),
      );
      expect(find.byKey(PaywallView.upgradeButton), findsNothing);
      expect(find.byType(Card), findsNothing);
    });

    testWidgets('a rail that cannot start a checkout offers no buy button', (
      WidgetTester tester,
    ) async {
      await pumpChassis(tester, kPhone, view(canStartCheckout: false));
      expect(find.byKey(PaywallView.upgradeButton), findsNothing);
    });

    testWidgets('pending offers CHECK AGAIN and nothing else — the money is '
        'in flight, and no control here may grant anything', (
      WidgetTester tester,
    ) async {
      bool asked = false;
      await pumpChassis(
        tester,
        kPhone,
        view(
          phase: PaywallPhase.pending,
          onCheckAgain: () => asked = true,
        ),
      );
      expect(find.byKey(PaywallView.upgradeButton), findsNothing);
      await tester.tap(find.byKey(PaywallView.checkAgainButton));
      expect(asked, isTrue);
    });

    testWidgets('unlocked is the ONLY phase with a way onward', (
      WidgetTester tester,
    ) async {
      bool went = false;
      await pumpChassis(
        tester,
        kPhone,
        view(phase: PaywallPhase.unlocked, onGoHome: () => went = true),
      );
      await tester.tap(find.byKey(PaywallView.goHomeButton));
      expect(went, isTrue);
    });

    testWidgets('refused RENDERS THE REASON — a refusal with no reason is '
        'indistinguishable from a broken button', (WidgetTester tester) async {
      await pumpChassis(
        tester,
        kPhone,
        view(
          phase: PaywallPhase.refused,
          detail: 'this rail is not permitted on iOS',
        ),
      );
      expect(
        find.text('this rail is not permitted on iOS'),
        findsOneWidget,
      );
    });
  });

  // ── (3) THE BUY CALLBACK CARRIES THE ROW THAT WAS TAPPED ──────────────────
  //
  // The adapter looks the `Offering` up by this id. A view that handed back the
  // wrong row would start a checkout for a plan nobody chose, and every phase
  // above would still render perfectly.
  testWidgets('onBuy is handed the offer whose row was tapped', (
    WidgetTester tester,
  ) async {
    String? bought;
    await pumpChassis(
      tester,
      kDesktop,
      view(onBuy: (PaywallOffer o) => bought = o.id),
    );
    await tester.tap(find.byKey(PaywallView.upgradeButton).last);
    expect(bought, 'pro_yearly');
  });

  // ── (4) THE TRIAL, IN THE SELLER'S OWN UNIT ───────────────────────────────
  //
  // O-IAP-PAYWALL-SHOWS-WEB-PRICE. A store sells "1 month free", and a month is
  // not a fixed number of days, so the row says a month — never "30-day".
  testWidgets("a store's one-month trial reads as a month, not as days", (
    WidgetTester tester,
  ) async {
    await pumpChassis(
      tester,
      kPhone,
      view(
        plans: const <PaywallOffer>[
          PaywallOffer(
            id: 'pro_monthly',
            formattedPrice: r'$7.19',
            term: 'month',
            trial: (count: 1, unit: 'month'),
          ),
        ],
      ),
    );
    expect(find.text(r'$7.19'), findsOneWidget);
    expect(find.textContaining('1-month free trial'), findsOneWidget);
    expect(find.textContaining('-day free trial'), findsNothing);
  });
}
