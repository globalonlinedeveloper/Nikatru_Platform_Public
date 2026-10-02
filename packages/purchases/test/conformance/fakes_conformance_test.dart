// The shared fakes (package:nikatru_purchases/testing.dart) pass the SAME
// conformance suites the production rails and bridges pass, so a fake cannot
// promise a behaviour no real rail has. Registry: tooling/ports/payments.json
// `client`, adapters `fake-rail` and `fake-bridge`.
//
// Red control, observed red and reverted (the PR records the exit):
//   · FakePurchaseRail.startCheckout returning `CheckoutSubmitted` for a
//     `CheckoutRefusal.purchaseCancelled` refusal (a fake that reports success
//     on a user cancel) → "PurchaseRail conformance · FakePurchaseRail ·
//     play-billing user cancel" goes red.
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';
import 'package:nikatru_purchases/testing.dart';

PurchaseRailFixture _rail(PurchaseRailKind kind, {CheckoutRefusal? refusal}) =>
    () async => FakePurchaseRail(
      railKind: kind,
      offerings: ConformancePlans.config,
      refusal: refusal,
    );

IapBridgeFixture _bridge({
  IapPurchaseOutcome purchase = IapPurchaseOutcome.submitted,
  bool withLifetime = false,
  bool claimsPro = false,
}) =>
    () async => FakeIapBridge(
      plans: ConformancePlans.storePlans(withLifetime: withLifetime),
      purchaseAnswer: IapPurchaseResult(purchase),
      state: claimsPro
          ? IapCustomerState(
              activeEntitlementIds: <String>{
                ConformancePlans.bridgeConfig.entitlementId,
              },
              managementUrl: null,
            )
          : IapCustomerState.unknown,
    );

void main() {
  // Every kind that sells: the hosted page and each store's sheet.
  for (final PurchaseRailKind kind in <PurchaseRailKind>[
    PurchaseRailKind.hosted,
    PurchaseRailKind.playBilling,
    PurchaseRailKind.appleIap,
  ]) {
    runPurchaseRailConformance(
      'FakePurchaseRail · ${kind.wire}',
      <PurchaseRailScenario, PurchaseRailFixture>{
        PurchaseRailScenario.loadOfferings: _rail(kind),
        PurchaseRailScenario.purchaseSuccess: _rail(kind),
        // A hosted fake cannot see a cancel on its page, exactly like the
        // real one; a store fake's sheet is dismissed.
        PurchaseRailScenario.userCancel: _rail(
          kind,
          refusal: kind.isStoreBilling
              ? CheckoutRefusal.purchaseCancelled
              : null,
        ),
        PurchaseRailScenario.pending: _rail(kind),
        PurchaseRailScenario.failure: _rail(
          kind,
          refusal: CheckoutRefusal.couldNotOpen,
        ),
        PurchaseRailScenario.restore: _rail(kind),
        PurchaseRailScenario.entitlementConvergence: _rail(kind),
        PurchaseRailScenario.noLifetimeInApp: _rail(kind),
      },
    );
  }

  runIapBridgeConformance(
    'FakeIapBridge',
    <IapBridgeScenario, IapBridgeFixture>{
      IapBridgeScenario.loadOfferings: _bridge(),
      IapBridgeScenario.purchaseSuccess: _bridge(),
      IapBridgeScenario.userCancel: _bridge(
        purchase: IapPurchaseOutcome.cancelledByUser,
      ),
      IapBridgeScenario.pending: _bridge(),
      IapBridgeScenario.failure: _bridge(
        purchase: IapPurchaseOutcome.storeRefused,
      ),
      IapBridgeScenario.restore: _bridge(),
      IapBridgeScenario.entitlementConvergence: _bridge(claimsPro: true),
      IapBridgeScenario.noLifetimeInApp: _bridge(withLifetime: true),
    },
  );

  group('the runners refuse a missing fixture', () {
    test('runPurchaseRailConformance throws, naming the scenario', () {
      expect(
        () => runPurchaseRailConformance(
          'incomplete',
          <PurchaseRailScenario, PurchaseRailFixture>{
            PurchaseRailScenario.loadOfferings: _rail(PurchaseRailKind.hosted),
          },
        ),
        throwsA(
          isA<ConformanceFixtureMissing>().having(
            (ConformanceFixtureMissing e) => e.missing,
            'missing',
            contains('user cancel'),
          ),
        ),
      );
    });

    test('runIapBridgeConformance throws, naming the scenario', () {
      expect(
        () => runIapBridgeConformance(
          'incomplete',
          <IapBridgeScenario, IapBridgeFixture>{},
        ),
        throwsA(
          isA<ConformanceFixtureMissing>().having(
            (ConformanceFixtureMissing e) => e.missing,
            'missing',
            hasLength(IapBridgeScenario.values.length),
          ),
        ),
      );
    });
  });
}
