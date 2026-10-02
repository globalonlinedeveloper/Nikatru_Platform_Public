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
    PaywallCheckoutStyle checkoutStyle = PaywallCheckoutStyle.hosted,
    PaywallRefusalView refusalView = PaywallRefusalView.retryable,
    void Function(PaywallOffer)? onBuy,
    VoidCallback? onCheckAgain,
    VoidCallback? onGoHome,
    VoidCallback? onRetry,
    VoidCallback? onBack,
    List<PaywallFeature> proFeatures = const <PaywallFeature>[],
    List<PaywallFeature> freeFeatures = const <PaywallFeature>[],
    bool showTrial = false,
    bool loadingOffers = false,
    bool offline = false,
    VoidCallback? onReconnect,
    PaywallCancelWhere cancelWhere = PaywallCancelWhere.here,
    VoidCallback? onRestore,
    VoidCallback? onOpenTerms,
    VoidCallback? onOpenPrivacy,
    VoidCallback? onOpenEula,
  }) => PaywallView(
    phase: phase,
    offers: plans,
    canStartCheckout: canStartCheckout,
    checkoutStyle: checkoutStyle,
    refusalView: refusalView,
    onBuy: onBuy ?? (PaywallOffer _) {},
    onCheckAgain: onCheckAgain ?? () {},
    onGoHome: onGoHome ?? () {},
    onRetry: onRetry ?? () {},
    onBack: onBack,
    proFeatures: proFeatures,
    freeFeatures: freeFeatures,
    showTrial: showTrial,
    loadingOffers: loadingOffers,
    offline: offline,
    onReconnect: onReconnect,
    cancelWhere: cancelWhere,
    onRestore: onRestore,
    onOpenTerms: onOpenTerms,
    onOpenPrivacy: onOpenPrivacy,
    onOpenEula: onOpenEula,
  );

  ChassisLocalizations l10nOf(WidgetTester tester) =>
      ChassisLocalizations.of(tester.element(find.byType(PaywallView)));

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
      // ⏱ ST-D9: a plan is an `AppCard` now; a `Card` finder here could no
      // longer fail.
      expect(find.byType(AppCard), findsNothing);
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

    // O-PAYWALL-SPEAKS-ONLY-WEB-CHECKOUT. This case used to assert the
    // OPPOSITE: that the refusal's engineering reason was painted verbatim. It
    // was English on a Tamil screen, and on a store build it named the web.
    // The view no longer takes one; each refusal shows a sentence the buyer can
    // act on, and the control to act with.
    testWidgets('refused, retryable: the retry sentence and Try again', (
      WidgetTester tester,
    ) async {
      bool retried = false;
      await pumpChassis(
        tester,
        kPhone,
        view(phase: PaywallPhase.refused, onRetry: () => retried = true),
      );
      final ChassisLocalizations l10n = l10nOf(tester);
      expect(find.text(l10n.paywallRetryMessage), findsOneWidget);
      expect(find.text(l10n.paywallUnavailable), findsNothing);
      expect(find.byKey(PaywallView.upgradeButton), findsNothing);
      await tester.tap(find.byKey(PaywallView.tryAgainButton));
      expect(retried, isTrue);
    });

    testWidgets('refused, unavailable: says so, and still offers Try again', (
      WidgetTester tester,
    ) async {
      bool retried = false;
      await pumpChassis(
        tester,
        kPhone,
        view(
          phase: PaywallPhase.refused,
          refusalView: PaywallRefusalView.unavailable,
          onRetry: () => retried = true,
        ),
      );
      final ChassisLocalizations l10n = l10nOf(tester);
      expect(find.text(l10n.paywallUnavailable), findsOneWidget);
      expect(find.text(l10n.paywallRetryMessage), findsNothing);
      await tester.tap(find.byKey(PaywallView.tryAgainButton));
      expect(retried, isTrue);
    });

    // The in-flight sentence follows the RAIL, not the platform: a hosted page
    // opens in the browser and says so; a store's own sheet names neither the
    // web nor a browser. `settle: false` because the spinner never settles.
    testWidgets('opening on a hosted rail names the browser', (
      WidgetTester tester,
    ) async {
      await pumpChassis(
        tester,
        kPhone,
        view(phase: PaywallPhase.opening),
        settle: false,
      );
      final ChassisLocalizations l10n = l10nOf(tester);
      expect(find.text(l10n.paywallOpeningHosted), findsOneWidget);
      expect(find.text(l10n.paywallOpeningStore), findsNothing);
    });

    testWidgets('opening on a store rail shows the store sentence', (
      WidgetTester tester,
    ) async {
      await pumpChassis(
        tester,
        kPhone,
        view(
          phase: PaywallPhase.opening,
          checkoutStyle: PaywallCheckoutStyle.store,
        ),
        settle: false,
      );
      final ChassisLocalizations l10n = l10nOf(tester);
      expect(find.text(l10n.paywallOpeningStore), findsOneWidget);
      expect(find.text(l10n.paywallOpeningHosted), findsNothing);
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
  const List<PaywallOffer> monthTrial = <PaywallOffer>[
    PaywallOffer(
      id: 'pro_monthly',
      formattedPrice: r'$7.19',
      term: 'month',
      trial: (count: 1, unit: 'month'),
    ),
  ];

  testWidgets("a store's one-month trial reads as a month, not as days", (
    WidgetTester tester,
  ) async {
    await pumpChassis(tester, kPhone, view(plans: monthTrial, showTrial: true));
    expect(find.text(r'$7.19'), findsOneWidget);
    expect(find.textContaining('1-month free trial'), findsOneWidget);
    expect(find.textContaining('-day free trial'), findsNothing);
    final ChassisLocalizations l10n = l10nOf(tester);
    expect(find.textContaining(l10n.paywallTermsTrial), findsOneWidget);
    expect(find.textContaining(l10n.paywallTerms), findsNothing);
  });

  // 🔴 D-25: NO TRIAL COPY UNTIL THE STORE SELLS ONE. The offering still
  // carries its trial — config and store both may — and without the flag not
  // one word of it is drawn, in the plan row or in the terms line. MUTATION
  // PROOF: make `_PlanCard` read `offer.trial` without consulting `showTrial`
  // and this goes red.
  testWidgets('without showTrial, a configured trial is not worded at all', (
    WidgetTester tester,
  ) async {
    await pumpChassis(tester, kPhone, view(plans: monthTrial));
    final ChassisLocalizations l10n = l10nOf(tester);
    expect(find.text(r'$7.19'), findsOneWidget);
    expect(find.textContaining('free trial'), findsNothing);
    expect(find.text(l10n.paywallTermMonthly), findsOneWidget);
    expect(find.textContaining(l10n.paywallTerms), findsOneWidget);
    expect(find.textContaining(l10n.paywallTermsTrial), findsNothing);
  });

  // ── (5) THE ST-D9 STATES: FEATURES, LOADING, OFFLINE, TWO COLUMNS ─────────
  const List<PaywallFeature> pro = <PaywallFeature>[
    PaywallFeature(
      icon: Icons.savings_outlined,
      title: 'Plan',
      body: 'Budgets',
    ),
    PaywallFeature(icon: Icons.insights_outlined, title: 'Save'),
  ];
  const List<PaywallFeature> free = <PaywallFeature>[
    PaywallFeature(icon: Icons.sync, title: 'Sync'),
  ];

  group('ST-D9 states', () {
    // Text scaling is platform-owned: the user's 200% must reflow, never clip.
    testWidgets('at 200% text on a phone nothing overflows', (
      WidgetTester tester,
    ) async {
      await tester.binding.setSurfaceSize(kPhone);
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: ChassisLocalizations.localizationsDelegates,
          supportedLocales: ChassisLocalizations.supportedLocales,
          builder: (BuildContext context, Widget? child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(2)),
            child: child!,
          ),
          home: view(proFeatures: pro, freeFeatures: free),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });

    testWidgets('populated: the features the adapter chose, then the plans', (
      WidgetTester tester,
    ) async {
      await pumpChassis(
        tester,
        kPhone,
        view(proFeatures: pro, freeFeatures: free),
      );
      final ChassisLocalizations l10n = l10nOf(tester);
      expect(find.byKey(PaywallView.featuresCard), findsOneWidget);
      expect(find.text(l10n.paywallProAdds), findsOneWidget);
      expect(find.text(l10n.paywallAlwaysFree), findsOneWidget);
      for (final String t in <String>['Plan', 'Budgets', 'Save', 'Sync']) {
        expect(find.text(t), findsOneWidget, reason: t);
      }
      expect(find.byKey(PaywallView.offerCard('pro_monthly')), findsOneWidget);
      // The features come BEFORE the plans in reading order on a phone.
      expect(
        tester.getTopLeft(find.byKey(PaywallView.featuresCard)).dy,
        lessThan(
          tester
              .getTopLeft(find.byKey(PaywallView.offerCard('pro_monthly')))
              .dy,
        ),
      );
      // ⏱ 2026-10-01 · MO-04: the terms line comes BEFORE the plans — the
      // buyer reads how it renews and where it is cancelled before Upgrade.
      await tester.scrollUntilVisible(
        find.byKey(PaywallView.termsLine),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.byKey(PaywallView.termsLine), findsOneWidget);
    });

    testWidgets('no features: no card — the brick keeps a plans-only paywall', (
      WidgetTester tester,
    ) async {
      await pumpChassis(tester, kPhone, view());
      expect(find.byKey(PaywallView.featuresCard), findsNothing);
      expect(find.byKey(PaywallView.upgradeButton), findsNWidgets(2));
    });

    testWidgets('loading: placeholders, never "unavailable"', (
      WidgetTester tester,
    ) async {
      // `canStartCheckout: false` — a store rail says so until its plans
      // arrive, and that is exactly the window this state is for.
      await pumpChassis(
        tester,
        kPhone,
        view(
          plans: const <PaywallOffer>[],
          canStartCheckout: false,
          loadingOffers: true,
        ),
      );
      final ChassisLocalizations l10n = l10nOf(tester);
      expect(find.byType(SkeletonList), findsOneWidget);
      expect(find.text(l10n.paywallUnavailable), findsNothing);
      expect(find.byKey(PaywallView.upgradeButton), findsNothing);
    });

    testWidgets('empty: no plans and not loading says unavailable', (
      WidgetTester tester,
    ) async {
      await pumpChassis(
        tester,
        kPhone,
        view(plans: const <PaywallOffer>[], proFeatures: pro),
      );
      final ChassisLocalizations l10n = l10nOf(tester);
      expect(find.text(l10n.paywallUnavailable), findsOneWidget);
      expect(find.byType(SkeletonList), findsNothing);
      // Nothing to buy, so nothing is pitched.
      expect(find.byKey(PaywallView.featuresCard), findsNothing);
      expect(find.byKey(PaywallView.termsLine), findsNothing);
    });

    testWidgets('offline: a warning strip, and the plans stay usable', (
      WidgetTester tester,
    ) async {
      int reconnected = 0;
      String? bought;
      await pumpChassis(
        tester,
        kPhone,
        view(
          offline: true,
          onReconnect: () => reconnected++,
          onBuy: (PaywallOffer o) => bought = o.id,
        ),
      );
      final ChassisLocalizations l10n = l10nOf(tester);
      expect(find.text(l10n.offlineMessage), findsOneWidget);
      await tester.tap(find.text(l10n.retry));
      expect(reconnected, 1);
      await tester.tap(find.byKey(PaywallView.upgradeButton).first);
      expect(bought, 'pro_monthly');
    });

    testWidgets('expanded and up: features BESIDE the plans, wider cap', (
      WidgetTester tester,
    ) async {
      await pumpChassis(
        tester,
        kDesktop,
        view(proFeatures: pro, freeFeatures: free),
      );
      final Rect features = tester.getRect(
        find.byKey(PaywallView.featuresCard),
      );
      final Rect plan = tester.getRect(
        find.byKey(PaywallView.offerCard('pro_monthly')),
      );
      // ⏱ 2026-10-01 · MO-04: the plans column now OPENS with the terms line,
      // so the two columns align at the terms line, not at the first plan.
      final Rect terms = tester.getRect(find.byKey(PaywallView.termsLine));
      expect(features.top, terms.top);
      expect(features.right, lessThan(plan.left));
      expect(terms.bottom, lessThan(plan.top));
      expect(
        tester.getSize(find.byType(ListView)).width,
        PaywallView.wideMaxWidth,
      );
    });

    testWidgets('expanded, but in a phase with no plans: back to one pane', (
      WidgetTester tester,
    ) async {
      await pumpChassis(
        tester,
        kDesktop,
        view(phase: PaywallPhase.pending, proFeatures: pro),
      );
      expect(tester.getSize(find.byType(ListView)).width, AppBreakpoints.pane);
      expect(find.byKey(PaywallView.featuresCard), findsNothing);
    });
  });

  // 🔴 ST-U2 (audit C34): every entry to the paywall is a `go` onto a root
  // route, so a bare AppBar drew no arrow and a rail that sells nothing left the
  // user trapped. MUTATION PROOF: drop `leading:` from PaywallView's AppBar
  // and the first case goes red.
  group('the paywall has a way off', () {
    testWidgets('onBack draws a back button, and it fires', (
      WidgetTester tester,
    ) async {
      bool backed = false;
      await pumpChassis(tester, kPhone, view(onBack: () => backed = true));
      await tester.tap(find.byType(BackButton));
      expect(backed, isTrue);
    });

    testWidgets('no onBack, no button — the adapter decides', (
      WidgetTester tester,
    ) async {
      await pumpChassis(tester, kPhone, view());
      expect(find.byType(BackButton), findsNothing);
    });
  });

  // ── (6) ⏱ 2026-10-01 · MO-03 / MO-04 / MO-08: A STORE-COMPLIANT PAYWALL ────
  group('store compliance', () {
    testWidgets('the terms line sits ABOVE the first Upgrade', (
      WidgetTester tester,
    ) async {
      await pumpChassis(tester, kPhone, view());
      expect(
        tester.getTopLeft(find.byKey(PaywallView.termsLine)).dy,
        lessThan(tester.getTopLeft(find.byKey(PaywallView.upgradeButton).first).dy),
      );
    });

    for (final (PaywallCancelWhere where, String Function(ChassisLocalizations) line)
        in <(PaywallCancelWhere, String Function(ChassisLocalizations))>[
          (PaywallCancelWhere.here, (ChassisLocalizations l) => l.paywallCancelHere),
          (PaywallCancelWhere.appStore, (ChassisLocalizations l) => l.paywallCancelInAppStore),
          (PaywallCancelWhere.googlePlay, (ChassisLocalizations l) => l.paywallCancelInGooglePlay),
        ]) {
      testWidgets('${where.name}: the terms line says where to cancel', (
        WidgetTester tester,
      ) async {
        await pumpChassis(tester, kPhone, view(cancelWhere: where));
        final ChassisLocalizations l10n = l10nOf(tester);
        final Text terms = tester.widget<Text>(find.byKey(PaywallView.termsLine));
        expect(terms.data, endsWith(line(l10n)));
        // A store build never says the plan is cancelled "here", and a
        // hosted one never names a store.
        for (final PaywallCancelWhere other in PaywallCancelWhere.values) {
          if (other == where) continue;
          expect(find.textContaining(switch (other) {
            PaywallCancelWhere.here => l10n.paywallCancelHere,
            PaywallCancelWhere.appStore => l10n.paywallCancelInAppStore,
            PaywallCancelWhere.googlePlay => l10n.paywallCancelInGooglePlay,
          }), findsNothing);
        }
      });
    }

    // RED CONTROL (MO-03): an Apple-rail paywall shows a Terms link (and the
    // EULA); every rail shows Restore, Terms and Privacy when wired.
    testWidgets('Apple rail: Restore, Terms, EULA and Privacy are links that work', (
      WidgetTester tester,
    ) async {
      final List<String> tapped = <String>[];
      await pumpChassis(
        tester,
        kPhone,
        view(
          cancelWhere: PaywallCancelWhere.appStore,
          checkoutStyle: PaywallCheckoutStyle.store,
          onRestore: () => tapped.add('restore'),
          onOpenTerms: () => tapped.add('terms'),
          onOpenPrivacy: () => tapped.add('privacy'),
          onOpenEula: () => tapped.add('eula'),
        ),
      );
      for (final Key k in <Key>[
        PaywallView.restoreLink,
        PaywallView.termsLink,
        PaywallView.eulaLink,
        PaywallView.privacyLink,
      ]) {
        await tester.scrollUntilVisible(
          find.byKey(k),
          200,
          scrollable: find.byType(Scrollable).first,
        );
        await tester.tap(find.byKey(k));
        await tester.pump();
      }
      expect(tapped, <String>['restore', 'terms', 'eula', 'privacy']);
      final ChassisLocalizations l10n = l10nOf(tester);
      expect(find.text(l10n.termsOfService), findsOneWidget);
      expect(find.text(l10n.paywallAppleEula), findsOneWidget);
    });

    testWidgets('no EULA where none is passed (every non-Apple rail)', (
      WidgetTester tester,
    ) async {
      await pumpChassis(
        tester,
        kPhone,
        view(onOpenTerms: () {}, onOpenPrivacy: () {}, onRestore: () {}),
      );
      expect(find.byKey(PaywallView.eulaLink), findsNothing);
      expect(find.byKey(PaywallView.termsLink), findsOneWidget);
    });

    // RED CONTROL (MO-04): Tamil never shows a wire token. The plan rows are
    // `month` and `year` on the wire; neither English code may be painted.
    testWidgets('Tamil shows a sentence per term, never the wire token', (
      WidgetTester tester,
    ) async {
      await pumpChassis(tester, kPhone, view(), locale: const Locale('ta'));
      final ChassisLocalizations l10n = l10nOf(tester);
      expect(l10n.localeName, 'ta');
      expect(find.text(l10n.paywallTermMonthly), findsOneWidget);
      expect(find.text(l10n.paywallTermYearly), findsOneWidget);
      for (final Element e in find.byType(Text).evaluate()) {
        final String? data = (e.widget as Text).data;
        if (data == null) continue;
        expect(data, isNot(matches(RegExp(r'\b(month|year|one_time)\b'))), reason: data);
      }
    });

    // MO-08: each phase change after choosing is announced.
    for (final PaywallPhase phase in <PaywallPhase>[
      PaywallPhase.opening,
      PaywallPhase.pending,
      PaywallPhase.unlocked,
      PaywallPhase.refused,
    ]) {
      testWidgets('${phase.name} is a live region', (WidgetTester tester) async {
        // `opening` spins until the rail answers, so it never settles.
        await pumpChassis(
          tester,
          kPhone,
          view(phase: phase),
          settle: phase != PaywallPhase.opening,
        );
        final Semantics region = tester.widget<Semantics>(
          find.byKey(PaywallView.phaseRegion),
        );
        expect(region.properties.liveRegion, isTrue);
      });
    }

    testWidgets('choosing is not a live region', (WidgetTester tester) async {
      await pumpChassis(tester, kPhone, view());
      expect(find.byKey(PaywallView.phaseRegion), findsNothing);
    });
  });
}
