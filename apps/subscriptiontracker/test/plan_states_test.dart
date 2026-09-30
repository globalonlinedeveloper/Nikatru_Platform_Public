// ─────────────────────────────────────────────────────────────────────────────
// Train ST-D9 · THE PLAN SCREENS' STATES, THROUGH THIS APP'S ADAPTERS.
//
// `packages/chassis_screens/test/{paywall,manage_plan}_view_test.dart` hold the
// VIEWS to their states with the inputs handed in. This file holds the half
// only the app can: that each state is REACHED from a real provider — the served
// config's pitch codes, the rail's own answer, the network signal, the
// entitlement read — and that the D-11 / D-25 / D9-3 rulings are wired where
// they are enforced, not merely drawable.
//
//   state      paywall                              manage subscription
//   loading    a store rail still being asked       the entitlement not read yet
//   empty      nothing sold: "not available here"   no plan: the way to the plans
//   error      (the refusals: paywall_refusal_…)    the entitlement read failed
//   offline    the network signal: a warning strip  the same strip
//   populated  the served pitch, in this app's words an active plan (chassis case)
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/monetization/manage_plan_screen.dart'
    show ManagePlanView;
import 'package:nikatru_chassis_screens/monetization/paywall_screen.dart'
    show PaywallView;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';
import 'package:subscriptiontracker/features/monetization/manage_plan_screen.dart';
import 'package:subscriptiontracker/features/monetization/paywall_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/money_providers.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/width_harness.dart';

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

/// A hosted rail that sells one plan, and asks nobody for it.
class _Rail implements PurchaseRail {
  @override
  PurchaseRailKind get railKind => PurchaseRailKind.paddle;

  @override
  List<Offering> get offerings => const <Offering>[
    Offering(
      productId: 'pro_monthly',
      amountMinor: 599,
      currencyCode: 'USD',
      term: OfferingTerm.month,
    ),
  ];

  @override
  bool get canStartCheckout => true;

  @override
  Future<CheckoutStart> startCheckout(Offering offering) async =>
      const CheckoutRefused(
        CheckoutRefusal.notSignedIn,
        detail: 'this test buys nothing',
      );

  @override
  Future<CancellationOutcome> requestCancellation() async =>
      CancellationOutcome.noActivePlan;
}

/// A store rail whose store has not answered: its plans are still unknown.
///
/// `canStartCheckout` is FALSE while it has no plans — the real `IapRail`'s
/// shape (`_railKind.isStoreBilling && _offered.value.isNotEmpty`). A fake
/// answering true here is what first hid that the loading state could never
/// show on a store build.
class _AskingRail extends ChangeNotifier
    implements PurchaseRail, LoadsOfferings {
  final Completer<void> answer = Completer<void>();

  @override
  PurchaseRailKind get railKind => PurchaseRailKind.playBilling;

  @override
  List<Offering> get offerings => const <Offering>[];

  @override
  bool get canStartCheckout => offerings.isNotEmpty;

  @override
  Listenable get offeringsChanged => this;

  @override
  Future<void> refreshOfferings() => answer.future;

  @override
  Future<CheckoutStart> startCheckout(Offering offering) async =>
      const CheckoutRefused(
        CheckoutRefusal.notSignedIn,
        detail: 'this test buys nothing',
      );

  @override
  Future<CancellationOutcome> requestCancellation() async =>
      CancellationOutcome.noActivePlan;
}

class _Unreachable extends NetworkReachabilityController {
  @override
  bool build() => true;
}

const core.Entitlements _free = core.Entitlements(
  appId: 'subscriptiontracker',
  isPro: false,
  items: <core.Entitlement>[],
);

List<Override> _money({
  PurchaseRail? rail,
  bool selling = true,
  PaywallPitch pitch = (
    pro: const <String>[],
    free: const <String>[],
    trialCopy: false,
  ),
  bool offline = false,
  Future<core.Entitlements> Function()? entitlements,
}) => <Override>[
  secureStoreProvider.overrideWithValue(_MemSecureStore()),
  sellingEnabledProvider.overrideWithValue(selling),
  paywallPitchProvider.overrideWithValue(pitch),
  purchaseRailProvider.overrideWithValue(rail ?? _Rail()),
  if (offline) networkUnreachableProvider.overrideWith(_Unreachable.new),
  entitlementsProvider.overrideWith(
    (_) => entitlements?.call() ?? Future<core.Entitlements>.value(_free),
  ),
];

AppLocalizations _l10n(WidgetTester tester, Type screen) =>
    AppLocalizations.of(tester.element(find.byType(screen)));

ChassisLocalizations _chassis(WidgetTester tester, Type screen) =>
    ChassisLocalizations.of(tester.element(find.byType(screen)));

void main() {
  // ── THE PITCH IS READ FROM CONFIG (D-11 / D-25) ────────────────────────────
  group('paywallPitchProvider reads the served paywall block', () {
    ProviderContainer containerFor(Map<String, Object?> extra) {
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          appConfigProvider.overrideWith(
            (_) async => core.AppConfig(
              appId: 'subscriptiontracker',
              apiBaseUrl: 'https://example.invalid/v1',
              features: const <String, bool>{},
              paywall: core.PaywallConfig(enabled: true, extra: extra),
              contentPack: null,
              copy: const <String, String>{},
              minSupportedVersion: '1.0.0',
            ),
          ),
        ],
      );
      addTearDown(c.dispose);
      return c;
    }

    test('the served codes and flag, exactly', () async {
      final ProviderContainer c = containerFor(<String, Object?>{
        'pro_features': <Object?>['plan', 'save'],
        'free_features': <Object?>['track', 'remind', 'sync'],
        'trial_copy': true,
      });
      await c.read(appConfigProvider.future);
      final PaywallPitch p = c.read(paywallPitchProvider);
      expect(p.pro, <String>['plan', 'save']);
      expect(p.free, <String>['track', 'remind', 'sync']);
      expect(p.trialCopy, isTrue);
    });

    test('a config that says nothing pitches nothing, and no trial', () async {
      final ProviderContainer c = containerFor(<String, Object?>{});
      await c.read(appConfigProvider.future);
      final PaywallPitch p = c.read(paywallPitchProvider);
      expect(p.pro, isEmpty);
      expect(p.free, isEmpty);
      expect(p.trialCopy, isFalse, reason: 'D-25: no flag, no trial copy');
    });

    test(
      'junk is dropped, not drawn: non-strings and a non-true flag',
      () async {
        final ProviderContainer c = containerFor(<String, Object?>{
          'pro_features': <Object?>['plan', 7, null],
          'free_features': 'sync',
          'trial_copy': 'yes',
        });
        await c.read(appConfigProvider.future);
        final PaywallPitch p = c.read(paywallPitchProvider);
        expect(p.pro, <String>['plan']);
        expect(p.free, isEmpty);
        expect(p.trialCopy, isFalse);
      },
    );
  });

  // ── D9-3: A CHANNEL WHOSE RAIL IS `none` PITCHES NOTHING ─────────────────
  test('channelMaySell: only a declared rail-none channel says no', () {
    expect(channelMaySell('apps-gov-in'), isFalse);
    for (final String id in <String>[
      'web',
      'android-play',
      'ios-appstore',
      'windows-store',
      'dev',
    ]) {
      expect(channelMaySell(id), isTrue, reason: id);
    }
  });

  // ── PAYWALL ────────────────────────────────────────────────────────────────
  group('paywall states', () {
    testWidgets('populated: the served codes, in this app\'s words', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        const PaywallScreen(),
        overrides: _money(
          pitch: (
            pro: const <String>['plan', 'save', 'not-a-feature'],
            free: const <String>['sync'],
            trialCopy: false,
          ),
        ),
      );
      final AppLocalizations l10n = _l10n(tester, PaywallScreen);
      expect(find.byKey(PaywallView.featuresCard), findsOneWidget);
      expect(find.text(l10n.paywallFeaturePlan), findsOneWidget);
      expect(find.text(l10n.paywallFeatureSave), findsOneWidget);
      expect(find.text(l10n.paywallFeatureSync), findsOneWidget);
      expect(find.textContaining('not-a-feature'), findsNothing);
      expect(find.byKey(PaywallView.upgradeButton), findsOneWidget);
    });

    testWidgets('loading: a store still being asked shows placeholders', (
      WidgetTester tester,
    ) async {
      final _AskingRail rail = _AskingRail();
      addTearDown(rail.dispose);
      await pumpAt(
        tester,
        kPhone,
        const PaywallScreen(),
        overrides: _money(rail: rail),
      );
      expect(find.byType(SkeletonList), findsOneWidget);
      expect(
        find.text(_chassis(tester, PaywallScreen).paywallUnavailable),
        findsNothing,
      );
      // The store answers with nothing: now it IS unavailable.
      rail.answer.complete();
      await tester.pumpAndSettle();
      expect(find.byType(SkeletonList), findsNothing);
      expect(
        find.text(_chassis(tester, PaywallScreen).paywallUnavailable),
        findsOneWidget,
      );
    });

    testWidgets('empty: nothing sold draws no pitch and no plan', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        const PaywallScreen(),
        overrides: _money(
          selling: false,
          pitch: (
            pro: const <String>['plan', 'save'],
            free: const <String>[],
            trialCopy: false,
          ),
        ),
      );
      expect(
        find.text(_chassis(tester, PaywallScreen).paywallUnavailable),
        findsOneWidget,
      );
      expect(find.byKey(PaywallView.featuresCard), findsNothing);
      expect(find.byKey(PaywallView.upgradeButton), findsNothing);
    });

    testWidgets('offline: the network signal draws the warning strip', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        const PaywallScreen(),
        overrides: _money(offline: true),
      );
      expect(
        find.text(_chassis(tester, PaywallScreen).offlineMessage),
        findsOneWidget,
      );
      expect(find.byKey(PaywallView.upgradeButton), findsOneWidget);
    });
  });

  // ── MANAGE SUBSCRIPTION ────────────────────────────────────────────────────
  group('manage subscription states', () {
    testWidgets('loading: a placeholder, and Restore is already there', (
      WidgetTester tester,
    ) async {
      final Completer<core.Entitlements> never = Completer<core.Entitlements>();
      await pumpAt(
        tester,
        kPhone,
        const ManagePlanScreen(),
        overrides: _money(entitlements: () => never.future),
      );
      expect(find.byType(SkeletonList), findsOneWidget);
      expect(find.byKey(ManagePlanView.restoreTile), findsOneWidget);
    });

    testWidgets('error: the read failed — says so, and Restore stays', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        const ManagePlanScreen(),
        overrides: _money(
          entitlements: () =>
              Future<core.Entitlements>.error(StateError('no server')),
        ),
      );
      expect(
        find.text(_chassis(tester, ManagePlanScreen).managePlanLoadFailed),
        findsOneWidget,
      );
      expect(find.byKey(ManagePlanView.restoreTile), findsOneWidget);
      expect(find.byKey(ManagePlanView.cancelTile), findsNothing);
    });

    testWidgets('empty (no plan), selling: the way to the plans', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        const ManagePlanScreen(),
        overrides: _money(),
      );
      final AppLocalizations l10n = _l10n(tester, ManagePlanScreen);
      expect(find.text(l10n.planInactive), findsOneWidget);
      expect(find.text(l10n.planInactiveDetail), findsOneWidget);
      expect(find.text(l10n.seeProPlans), findsOneWidget);
      expect(find.byKey(ManagePlanView.cancelTile), findsNothing);
    });

    testWidgets('empty (no plan), nothing sold: no way to a paywall', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        const ManagePlanScreen(),
        overrides: _money(selling: false),
      );
      expect(find.byKey(ManagePlanView.upgradeTile), findsNothing);
      expect(find.byKey(ManagePlanView.restoreTile), findsOneWidget);
    });

    testWidgets('offline: the warning strip, and every control stays', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        const ManagePlanScreen(),
        overrides: _money(offline: true),
      );
      expect(
        find.text(_chassis(tester, ManagePlanScreen).offlineMessage),
        findsOneWidget,
      );
      expect(find.byKey(ManagePlanView.restoreTile), findsOneWidget);
    });
  });
}
