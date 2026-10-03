// ─────────────────────────────────────────────────────────────────────────────
// Train ST-D9 · THE PLAN SCREENS PHOTOGRAPHED — the paywall and manage
// subscription, at the four window classes, in both themes.
//
// WHAT A GOLDEN HERE PROVES, AND WHAT IT DOES NOT. It proves the two views are
// drawn from the ST-D0 foundation (AppCard, AppListRow, DecisionStrip, the type
// ramp, the status tones) and that the layout decision per class — one 480
// column below 840, features beside plans from 840 up — did not move by
// accident. It does NOT prove contrast (`design_system`'s status and card tests
// measure that) and it does NOT prove the copy: the strings below are the
// chassis English catalogue plus fixture features.
//
// Same rig as `packages/design_system/test/foundation_golden_test.dart`: Linux
// only (the renderer the CI runner has), photographed at half density so the
// committed PNGs stay small, and the four sizes asserted to BE their classes
// before anything is photographed.
//
// Regenerate, from the repository root, with:
//   flutter test packages/chassis_screens/test/plan_golden_test.dart \
//     --update-goldens
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/monetization/manage_plan_screen.dart';
import 'package:nikatru_chassis_screens/monetization/paywall_screen.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

const List<PaywallOffer> _offers = <PaywallOffer>[
  PaywallOffer(id: 'pro_monthly', formattedPrice: r'$5.99', term: 'month'),
  PaywallOffer(id: 'pro_yearly', formattedPrice: r'$34.99', term: 'year'),
];

const List<PaywallFeature> _pro = <PaywallFeature>[
  PaywallFeature(
    icon: Icons.account_balance_wallet_outlined,
    title: 'Plan ahead',
    body: 'Set budgets and see every charge before it lands.',
  ),
  PaywallFeature(
    icon: Icons.savings_outlined,
    title: 'Find savings',
    body: 'See what you do not use and what you could cut.',
  ),
];

const List<PaywallFeature> _free = <PaywallFeature>[
  PaywallFeature(icon: Icons.list_alt_outlined, title: 'Track'),
  PaywallFeature(icon: Icons.sync, title: 'Sync across your devices'),
];

Widget _paywall() => PaywallView(
  phase: PaywallPhase.choosing,
  offers: _offers,
  canStartCheckout: true,
  checkoutStyle: PaywallCheckoutStyle.hosted,
  refusalView: PaywallRefusalView.retryable,
  proFeatures: _pro,
  freeFeatures: _free,
  onBuy: (PaywallOffer _) {},
  onCheckAgain: () {},
  onGoHome: () {},
  onRetry: () {},
  onBack: () {},
);

Widget _managePlan() => ManagePlanView(
  title: 'Manage subscription',
  isPro: true,
  planStatusLabel: 'Your subscription is active',
  planDetail: 'Planning and savings tools are on.',
  restoreHint: 'Signed in on a new device? This re-checks your subscription.',
  cancelLabel: 'Cancel subscription',
  busy: false,
  outcomeMessage: 'Your cancellation request is recorded.',
  outcomeKind: StatusKind.warn,
  onBack: () {},
  onRestore: () {},
  onCancel: () {},
);

// ⏱ 2026-10-01 · MO-08 — THE PAYWALL PER RAIL, AND MANAGE PLAN FREE AND PRO.
// The four-class set above is the layout record; these are the store-review
// record: what a buyer on each rail is shown before they pay (the cancel
// sentence and the links differ per rail — an Apple build adds the EULA, a
// store build adds Restore) and what Manage plan shows a free user and a Pro
// user whose plan was bought in a store. Compact and large, both themes.
Widget _paywallFor(PaywallCancelWhere where) => PaywallView(
  phase: PaywallPhase.choosing,
  offers: _offers,
  canStartCheckout: true,
  checkoutStyle: where == PaywallCancelWhere.here
      ? PaywallCheckoutStyle.hosted
      : PaywallCheckoutStyle.store,
  refusalView: PaywallRefusalView.retryable,
  proFeatures: _pro,
  freeFeatures: _free,
  cancelWhere: where,
  onRestore: where == PaywallCancelWhere.here ? null : () {},
  onOpenTerms: () {},
  onOpenPrivacy: () {},
  onOpenEula: where == PaywallCancelWhere.appStore ? () {} : null,
  onBuy: (PaywallOffer _) {},
  onCheckAgain: () {},
  onGoHome: () {},
  onRetry: () {},
  onBack: () {},
);

Widget _paywallWeb() => _paywallFor(PaywallCancelWhere.here);
Widget _paywallPlay() => _paywallFor(PaywallCancelWhere.googlePlay);
Widget _paywallAppStore() => _paywallFor(PaywallCancelWhere.appStore);

Widget _managePlanFree() => ManagePlanView(
  title: 'Manage plan',
  isPro: false,
  planStatusLabel: 'You are on the free plan',
  planDetail: null,
  restoreHint: 'Signed in on a new device? This re-checks your plan.',
  cancelLabel: 'Cancel Pro',
  busy: false,
  outcomeMessage: null,
  upgradeLabel: 'See plans',
  onUpgrade: () {},
  onBack: () {},
  onRestore: () {},
  onCancel: () {},
);

Widget _managePlanProInPlay() => ManagePlanView(
  title: 'Manage plan',
  isPro: true,
  planStatusLabel: 'Pro is active',
  planDetail: 'The 12-month forecast and category caps are on.',
  restoreHint: 'Signed in on a new device? This re-checks your plan.',
  cancelLabel: 'Cancel Pro',
  busy: false,
  outcomeMessage: null,
  source: PlanSourceView.googlePlay,
  periodEnds: DateTime.utc(2026, 11, 1),
  onManageInStore: () {},
  onBack: () {},
  onRestore: () {},
  onCancel: () {},
);

Future<void> _pump(
  WidgetTester tester,
  Size size,
  Brightness brightness,
  Widget screen,
) async {
  tester.view.physicalSize = size * 0.5;
  tester.view.devicePixelRatio = 0.5;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      localizationsDelegates: ChassisLocalizations.localizationsDelegates,
      supportedLocales: ChassisLocalizations.supportedLocales,
      theme: buildAppTheme(
        seed: const Color(0xFF6459F5),
        brightness: brightness,
      ),
      home: screen,
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  const Map<String, Size> classes = <String, Size>{
    'compact': Size(390, 844),
    'medium': Size(700, 1000),
    'expanded': Size(1024, 900),
    'large': Size(1440, 900),
  };

  test('each photographed size is the class it is named for', () {
    expect(windowClassFor(classes['compact']!.width), WindowClass.compact);
    expect(windowClassFor(classes['medium']!.width), WindowClass.medium);
    expect(windowClassFor(classes['expanded']!.width), WindowClass.expanded);
    expect(windowClassFor(classes['large']!.width), WindowClass.large);
  });

  const Map<String, Widget Function()> screens = <String, Widget Function()>{
    'paywall': _paywall,
    'manage_plan': _managePlan,
  };

  const Map<String, Widget Function()> perRail = <String, Widget Function()>{
    'paywall_web': _paywallWeb,
    'paywall_play': _paywallPlay,
    'paywall_appstore': _paywallAppStore,
    'manage_plan_free': _managePlanFree,
    'manage_plan_pro_play': _managePlanProInPlay,
  };

  for (final MapEntry<String, Widget Function()> s in perRail.entries) {
    for (final String c in const <String>['compact', 'large']) {
      for (final Brightness b in Brightness.values) {
        testWidgets('${s.key} · $c · ${b.name}', (WidgetTester tester) async {
          await _pump(tester, classes[c]!, b, s.value());
          await expectLater(
            find.byType(MaterialApp),
            matchesGoldenFile('goldens/${s.key}_${c}_${b.name}.png'),
          );
        }, skip: !Platform.isLinux);
      }
    }
  }

  for (final MapEntry<String, Widget Function()> s in screens.entries) {
    for (final MapEntry<String, Size> c in classes.entries) {
      for (final Brightness b in Brightness.values) {
        testWidgets('${s.key} · ${c.key} · ${b.name}', (
          WidgetTester tester,
        ) async {
          await _pump(tester, c.value, b, s.value());
          await expectLater(
            find.byType(MaterialApp),
            matchesGoldenFile('goldens/${s.key}_${c.key}_${b.name}.png'),
          );
        }, skip: !Platform.isLinux);
      }
    }
  }
}
