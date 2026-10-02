// RevenueCatBridge passes the client IapBridge conformance suite, driven
// through a FAKE METHOD CHANNEL — the same harness revenuecat_bridge_test.dart
// uses (`setMockMethodCallHandler` on the plugin's own channel), answering with
// the JSON shapes the plugin's own `fromJson` factories parse
// (purchases_flutter 10.13.1: Offerings, Package, StoreProduct, CustomerInfo,
// PurchaseResult). No store, no device, no account. Registry:
// tooling/ports/payments.json `client`, adapter `revenuecat-bridge`.
//
// Red control, observed red and reverted (the PR records the exit):
//   · `paymentPendingError` mapped back to `storeRefused` →
//     "IapBridge conformance · RevenueCatBridge pending" goes red.
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_billing_revenuecat/nikatru_billing_revenuecat.dart';
import 'package:nikatru_purchases/testing.dart';
import 'package:purchases_flutter/purchases_flutter.dart' as rc;

/// The plugin's own channel name: `Purchases._channel`.
const MethodChannel _channel = MethodChannel('purchases_flutter');

const RevenueCatCapabilities _canSell = RevenueCatCapabilities(
  canPurchase: true,
  canRestore: true,
  why: 'A conformance host that is allowed to sell.',
);

Map<String, Object?> _entitlement(String id) => <String, Object?>{
  'identifier': id,
  'isActive': true,
  'willRenew': true,
  'latestPurchaseDate': '2026-10-01T00:00:00Z',
  'originalPurchaseDate': '2026-10-01T00:00:00Z',
  'productIdentifier': 'pro_monthly',
  'isSandbox': true,
};

Map<String, Object?> _customerInfo({bool claimsPro = false}) {
  final Map<String, Object?> active = <String, Object?>{
    if (claimsPro)
      ConformancePlans.bridgeConfig.entitlementId: _entitlement(
        ConformancePlans.bridgeConfig.entitlementId,
      ),
  };
  return <String, Object?>{
    'entitlements': <String, Object?>{
      'all': active,
      'active': active,
      'verification': 'NOT_REQUESTED',
    },
    'allPurchaseDates': <String, Object?>{},
    'activeSubscriptions': <Object?>[],
    'allPurchasedProductIdentifiers': <Object?>[],
    'nonSubscriptionTransactions': <Object?>[],
    'firstSeen': '2026-10-01T00:00:00Z',
    'originalAppUserId': ConformancePlans.bridgeConfig.appUserId,
    'allExpirationDates': <String, Object?>{},
    'requestDate': '2026-10-01T00:00:00Z',
  };
}

/// One store product as the plugin sends it. A Play subscription is named
/// `<subscription>:<base plan>`; [period] null is a non-subscription product.
Map<String, Object?> _package(String storeId, double price, String? period) =>
    <String, Object?>{
      'identifier': storeId,
      'packageType': 'CUSTOM',
      'product': <String, Object?>{
        'identifier': storeId,
        'description': 'description',
        'title': 'title',
        'price': price,
        'priceString': 'formatted by the store',
        'currencyCode': 'USD',
        'subscriptionPeriod': period,
      },
      'presentedOfferingContext': <String, Object?>{
        'offeringIdentifier': 'default',
      },
    };

Map<String, Object?> _offerings({bool withLifetime = false}) {
  final Map<String, Object?> offering = <String, Object?>{
    'identifier': 'default',
    'serverDescription': 'conformance',
    'metadata': <String, Object?>{},
    'availablePackages': <Object?>[
      _package('pro_monthly:monthly', 7.19, 'P1M'),
      _package('pro_yearly:yearly', 49.99, 'P1Y'),
      if (withLifetime) _package('pro_lifetime', 89.0, null),
    ],
  };
  return <String, Object?>{
    'all': <String, Object?>{'default': offering},
    'current': offering,
  };
}

/// The store's sheet: completes, or fails with [error] (a PurchasesErrorCode).
IapBridgeFixture _store({
  rc.PurchasesErrorCode? error,
  bool withLifetime = false,
  bool claimsPro = false,
}) => () async {
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(_channel, (MethodCall call) async {
        switch (call.method) {
          case 'getOfferings':
            return _offerings(withLifetime: withLifetime);
          case 'purchasePackage':
            if (error != null) {
              throw PlatformException(
                code: '${rc.PurchasesErrorCode.values.indexOf(error)}',
                message: error.name,
              );
            }
            return <String, Object?>{
              'customerInfo': _customerInfo(claimsPro: claimsPro),
              'transaction': <String, Object?>{
                'transactionIdentifier': 'tx-1',
                'productIdentifier': 'pro_monthly',
                'purchaseDate': '2026-10-01T00:00:00Z',
              },
            };
          case 'restorePurchases':
          case 'getCustomerInfo':
            return _customerInfo(claimsPro: claimsPro);
          default:
            return null;
        }
      });
  final RevenueCatBridge bridge = RevenueCatBridge(capabilities: _canSell);
  addTearDown(bridge.dispose);
  return bridge;
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, null);
  });

  runIapBridgeConformance(
    'RevenueCatBridge',
    <IapBridgeScenario, IapBridgeFixture>{
      IapBridgeScenario.loadOfferings: _store(),
      IapBridgeScenario.purchaseSuccess: _store(),
      IapBridgeScenario.userCancel: _store(
        error: rc.PurchasesErrorCode.purchaseCancelledError,
      ),
      IapBridgeScenario.pending: _store(
        error: rc.PurchasesErrorCode.paymentPendingError,
      ),
      IapBridgeScenario.failure: _store(
        error: rc.PurchasesErrorCode.purchaseNotAllowedError,
      ),
      IapBridgeScenario.restore: _store(),
      IapBridgeScenario.entitlementConvergence: _store(claimsPro: true),
      IapBridgeScenario.noLifetimeInApp: _store(withLifetime: true),
    },
  );
}
