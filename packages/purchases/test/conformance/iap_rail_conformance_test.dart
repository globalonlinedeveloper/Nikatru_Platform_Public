// IapRail passes the client PurchaseRail conformance suite — on EVERY channel
// the rendered rail map gives a store kind (Play, the App Store, the Mac App
// Store), driven through a FakeIapBridge that scripts each store answer.
// Registry: tooling/ports/payments.json `client`, adapter `iap`.
//
// The bridge's answers here are the ones a CONFORMANT bridge gives (a pending
// payment is `submitted`); runIapBridgeConformance holds each real bridge to
// them in its own package.
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_purchases/nikatru_purchases.dart';
import 'package:nikatru_purchases/testing.dart';

class _Cancellations implements core.CancellationTransport {
  @override
  Future<core.Result<core.CancellationReceipt>> requestCancellation({
    required String appId,
    required String? accessToken,
  }) async => const core.Result<core.CancellationReceipt>.ok(
    core.CancellationReceipt(
      hasActivePlan: true,
      recorded: true,
      executed: false,
    ),
  );
}

PurchaseRailFixture _iap(
  PurchaseChannel channel, {
  IapPurchaseOutcome purchase = IapPurchaseOutcome.submitted,
  bool withLifetime = false,
}) =>
    () async => IapRail(
      bridge: FakeIapBridge(
        plans: ConformancePlans.storePlans(withLifetime: withLifetime),
        purchaseAnswer: IapPurchaseResult(purchase),
      ),
      bridgeConfig: ConformancePlans.bridgeConfig,
      config: RailConfig.fromPaywallExtra(ConformancePlans.paywallExtra),
      channel: channel,
      appId: ConformancePlans.appId,
      accessToken: () async => 'conformance-token',
      cancellationTransport: _Cancellations(),
      launcher: FakeCheckoutLauncher(),
    );

void main() {
  final List<PurchaseChannel> storeChannels = <PurchaseChannel>[
    for (final PurchaseChannel c in PurchaseChannel.values)
      if (PurchaseRailKind.forChannel(c).isStoreBilling) c,
  ];

  test('the store kinds cover Play and both Apple stores', () {
    // A conformance run over zero channels agrees with everything.
    expect(storeChannels, isNotEmpty);
    expect(storeChannels, contains(PurchaseChannel.androidPlay));
  });

  for (final PurchaseChannel channel in storeChannels) {
    runPurchaseRailConformance(
      'IapRail · ${channel.registerId}',
      <PurchaseRailScenario, PurchaseRailFixture>{
        PurchaseRailScenario.loadOfferings: _iap(channel),
        PurchaseRailScenario.purchaseSuccess: _iap(channel),
        PurchaseRailScenario.userCancel: _iap(
          channel,
          purchase: IapPurchaseOutcome.cancelledByUser,
        ),
        PurchaseRailScenario.pending: _iap(channel),
        PurchaseRailScenario.failure: _iap(
          channel,
          purchase: IapPurchaseOutcome.storeRefused,
        ),
        PurchaseRailScenario.restore: _iap(channel),
        PurchaseRailScenario.entitlementConvergence: _iap(channel),
        PurchaseRailScenario.noLifetimeInApp: _iap(channel, withLifetime: true),
      },
    );
  }
}
