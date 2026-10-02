// HostedCheckoutRail passes the client PurchaseRail conformance suite — on
// EVERY channel the rendered rail map gives the hosted kind (web, Windows
// Store, Windows direct, Snap, AppImage), each with its own capability row and
// a FakeCheckoutLauncher. Registry: tooling/ports/payments.json `client`,
// adapter `hosted`.
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

PurchaseRailFixture _hosted(PurchaseChannel channel, {bool opens = true}) =>
    () async => HostedCheckoutRail(
      config: RailConfig.fromPaywallExtra(ConformancePlans.paywallExtra),
      appId: ConformancePlans.appId,
      returnUrl: 'https://nikatru.test/checkout-return',
      accountId: () async => 'conformance-user',
      accessToken: () async => 'conformance-token',
      cancellationTransport: _Cancellations(),
      launcher: FakeCheckoutLauncher(answer: opens),
      capabilities: PurchaseCapabilities.forChannel(channel),
    );

void main() {
  final List<PurchaseChannel> hostedChannels = <PurchaseChannel>[
    for (final PurchaseChannel c in PurchaseChannel.values)
      if (PurchaseRailKind.forChannel(c) == PurchaseRailKind.hosted) c,
  ];

  test('the hosted kind covers the web and the desktop channels', () {
    // A conformance run over zero channels agrees with everything.
    expect(hostedChannels, isNotEmpty);
    expect(hostedChannels, contains(PurchaseChannel.web));
  });

  for (final PurchaseChannel channel in hostedChannels) {
    runPurchaseRailConformance(
      'HostedCheckoutRail · ${channel.registerId}',
      <PurchaseRailScenario, PurchaseRailFixture>{
        PurchaseRailScenario.loadOfferings: _hosted(channel),
        PurchaseRailScenario.purchaseSuccess: _hosted(channel),
        // The buyer cancels ON the page, which this rail cannot see.
        PurchaseRailScenario.userCancel: _hosted(channel),
        // The page opened; the merchant's notification has not landed.
        PurchaseRailScenario.pending: _hosted(channel),
        // The platform did not open the page (a popup blocker, no handler).
        PurchaseRailScenario.failure: _hosted(channel, opens: false),
        PurchaseRailScenario.restore: _hosted(channel),
        PurchaseRailScenario.entitlementConvergence: _hosted(channel),
        PurchaseRailScenario.noLifetimeInApp: _hosted(channel),
      },
    );
  }
}
