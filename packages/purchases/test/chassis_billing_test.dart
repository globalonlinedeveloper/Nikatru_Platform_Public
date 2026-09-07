import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_purchases/nikatru_purchases.dart';

/// A bridge that records what it was asked. The seam exists FOR this: a store
/// purchase sheet cannot be driven from a unit test, so without an injectable
/// bridge "the facade builds a store rail" would be a claim nobody could check.
///
/// The facade only ever CONSTRUCTS a rail, so this fake answers the interface
/// and nothing more — the behaviour of the rail it is handed to is
/// iap_rail_test.dart's subject, with a fake that scripts every outcome.
class _FakeBridge implements IapBridge {
  @override
  Future<bool> configure(IapBridgeConfig config) async => true;

  @override
  Future<Set<String>> purchasableProductIds() async => <String>{'pro_monthly'};

  @override
  Future<IapPurchaseResult> purchase(Offering offering) async =>
      const IapPurchaseResult(IapPurchaseOutcome.submitted);

  @override
  Future<IapPurchaseResult> restore() async =>
      const IapPurchaseResult(IapPurchaseOutcome.submitted);

  @override
  Future<IapCustomerState> currentCustomerState() async =>
      IapCustomerState.unknown;

  @override
  Stream<IapCustomerState> get customerState =>
      Stream<IapCustomerState>.value(IapCustomerState.unknown);
}

class _RecordingLauncher implements CheckoutLauncher {
  final List<Uri> opened = <Uri>[];
  bool answer = true;

  @override
  Future<bool> open(Uri url) async {
    opened.add(url);
    return answer;
  }
}

class _FakeCancellations implements core.CancellationTransport {
  _FakeCancellations(this.result);
  final core.Result<core.CancellationReceipt> result;
  int calls = 0;

  @override
  Future<core.Result<core.CancellationReceipt>> requestCancellation({
    required String appId,
    required String? accessToken,
  }) async {
    calls++;
    return result;
  }
}

const Offering _monthly = Offering(
  productId: 'pro_monthly',
  amountMinor: 499,
  currencyCode: 'USD',
  term: OfferingTerm.month,
  trialDays: 30,
);

const String _template =
    'https://checkout.example.test/pay?price={price_id}&cust={account_id}'
    '&app={app_id}&back={return_url}';

ChassisBillingConfig _config({
  IapBridge? bridge,
  IapBridgeConfig? bridgeConfig,
  CheckoutLauncher? launcher,
  core.CancellationTransport? cancellations,
}) =>
    ChassisBillingConfig(
      railConfig: const RailConfig(
        offerings: <Offering>[_monthly],
        checkoutUrlTemplate: _template,
        manageUrlTemplate: null,
      ),
      appId: 'probe',
      returnUrl: 'https://nikatru.test/checkout-return',
      accountId: () async => 'user-123',
      accessToken: () async => 'token',
      cancellationTransport: cancellations ??
          _FakeCancellations(
            const core.Result<core.CancellationReceipt>.ok(
              core.CancellationReceipt(
                hasActivePlan: true,
                recorded: true,
                executed: false,
              ),
            ),
          ),
      iapBridge: bridge,
      iapBridgeConfig: bridgeConfig,
      launcher: launcher ?? _RecordingLauncher(),
    );

const IapBridgeConfig _bridgeConfig = IapBridgeConfig(
  publicApiKey: 'public_test_key',
  entitlementId: 'pro',
  appUserId: 'user-123',
);

void main() {
  // ── THE FACADE PICKS THE RAIL THE REGISTER DECIDES ────────────────────────
  // Every channel, both directions, because the failure this whole facade
  // exists to prevent is a build opening the WRONG rail: an external checkout
  // inside an App Store build is a documented rejection cause, and a store
  // sheet on a channel that forbids store billing is a paywall that cannot
  // complete a sale.
  group('ChassisBilling.railFor selects by channel, not by platform', () {
    for (final PurchaseChannel channel in <PurchaseChannel>[
      PurchaseChannel.web,
      PurchaseChannel.windowsStore,
      PurchaseChannel.windowsDirect,
      PurchaseChannel.linuxSnap,
      PurchaseChannel.linuxAppImage,
    ]) {
      test('${channel.registerId} gets the hosted checkout rail', () {
        final BillingRailResult r =
            ChassisBilling.railFor(channel, _config(bridge: _FakeBridge()));
        expect(r, isA<BillingRailReady>());
        final BillingRailReady ready = r as BillingRailReady;
        expect(ready.kind, PurchaseRailKind.paddle);
        expect(ready.rail, isA<HostedCheckoutRail>());
      });
    }

    for (final PurchaseChannel channel in <PurchaseChannel>[
      PurchaseChannel.androidPlay,
      PurchaseChannel.iosAppStore,
      PurchaseChannel.macosAppStore,
    ]) {
      test('${channel.registerId} gets the store IAP rail', () {
        final BillingRailResult r = ChassisBilling.railFor(
          channel,
          _config(bridge: _FakeBridge(), bridgeConfig: _bridgeConfig),
        );
        expect(r, isA<BillingRailReady>());
        final BillingRailReady ready = r as BillingRailReady;
        expect(ready.kind.isStoreBilling, isTrue);
        expect(ready.rail, isA<IapRail>());
      });
    }

    test('a store channel with no bridge REFUSES rather than falling back',
        () async {
      // 🔴 THE FALLBACK IS THE BUG. Handing back a HostedCheckoutRail here
      // would put an external checkout inside a Play or App Store build, which
      // is the anti-steering violation and the 3.1.1 rejection respectively.
      // Refusing is the only safe answer, and it has to be a VALUE the paywall
      // can render rather than an exception it has to catch.
      final BillingRailResult r = ChassisBilling.railFor(
        PurchaseChannel.androidPlay,
        _config(),
      );
      expect(r, isA<BillingRailUnavailable>());
      expect(
        (r as BillingRailUnavailable).reason,
        BillingRailRefusal.iapBridgeMissing,
      );
      expect(r.detail, contains('nikatru_billing_revenuecat'));
    });

    test('the hosted rail is built with the CHANNEL capabilities, not the '
        'restrictive platform collapse', () async {
      // `forPlatform` takes the restrictive answer because a build that
      // constructs the rail directly does not know its channel. The facade DOES
      // know — the caller just said — so it must pass `forChannel`, or a
      // windows-direct build would inherit windows-store's answer for no reason.
      final BillingRailReady ready = ChassisBilling.railFor(
        PurchaseChannel.windowsDirect,
        _config(bridge: _FakeBridge()),
      ) as BillingRailReady;
      final HostedCheckoutRail rail = ready.rail as HostedCheckoutRail;
      expect(rail.capabilities.why,
          PurchaseCapabilities.forChannel(PurchaseChannel.windowsDirect).why);
    });
  });

  // ── THE RAIL KIND MAP IS THE REGISTER'S, NOT AN OPINION ───────────────────
  group('PurchaseRailKind mirrors tooling/channel-register.json', () {
    test('every channel maps to the rail the register decides', () {
      // 🔴 READ FROM THE REGISTER AT TEST TIME. A test that restated the
      // expected pairs would be a THIRD copy of the decision, and the whole
      // point of the guard limb this backs up is that there is one.
      // 🔴 THE PATH IS WALKED, NOT WRITTEN. `flutter test packages/purchases`
      // runs with the REPO ROOT as cwd and `melos run gate` runs with the
      // PACKAGE as cwd, so any single relative path passes under one runner and
      // silently fails under the other — which for this case would mean the
      // register comparison quietly not happening in whichever lane matters.
      Directory d = Directory.current;
      File? f;
      for (int i = 0; i < 6; i++) {
        final File candidate =
            File('${d.path}/tooling/channel-register.json');
        if (candidate.existsSync()) {
          f = candidate;
          break;
        }
        if (d.parent.path == d.path) break;
        d = d.parent;
      }
      expect(f, isNotNull,
          reason: 'tooling/channel-register.json must be findable above cwd');
      final Map<String, Object?> reg =
          jsonDecode(f!.readAsStringSync()) as Map<String, Object?>;
      final List<Object?> channels = reg['channels']! as List<Object?>;
      int compared = 0;
      for (final Object? raw in channels) {
        final Map<String, Object?> row = raw! as Map<String, Object?>;
        if (row['surface'] != 'app') continue;
        final PurchaseChannel channel = PurchaseChannel.values
            .firstWhere((PurchaseChannel c) => c.registerId == row['id']);
        final Map<String, Object?> rail =
            row['purchaseRail']! as Map<String, Object?>;
        expect(
          PurchaseRailKind.forChannel(channel).registerId,
          rail['rail'],
          reason: 'channel ${row['id']}',
        );
        compared++;
      }
      // A comparison over an empty set agrees with everything.
      expect(compared, greaterThanOrEqualTo(6));
    });

    test('only the two store rails answer isStoreBilling', () {
      expect(PurchaseRailKind.paddle.isStoreBilling, isFalse);
      expect(PurchaseRailKind.none.isStoreBilling, isFalse);
      expect(PurchaseRailKind.playBilling.isStoreBilling, isTrue);
      expect(PurchaseRailKind.appleIap.isStoreBilling, isTrue);
    });
  });
}
