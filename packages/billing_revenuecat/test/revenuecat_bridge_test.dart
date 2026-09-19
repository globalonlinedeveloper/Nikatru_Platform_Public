import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_billing_revenuecat/nikatru_billing_revenuecat.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';
import 'package:purchases_flutter/purchases_flutter.dart' as rc;

/// The plugin's own channel name, read out of its source rather than guessed:
/// `Purchases._channel = const MethodChannel('purchases_flutter')`.
const MethodChannel _channel = MethodChannel('purchases_flutter');

const RevenueCatCapabilities _canSell = RevenueCatCapabilities(
  canPurchase: true,
  canRestore: true,
  why: 'A test host that is allowed to sell, so the SDK path is exercised.',
);

const RevenueCatCapabilities _cannotSell = RevenueCatCapabilities(
  canPurchase: false,
  canRestore: false,
  why: 'A test host that cannot sell, so the degraded path is exercised.',
);

const IapBridgeConfig _config = IapBridgeConfig(
  publicApiKey: 'public_test_key',
  entitlementId: 'pro',
  appUserId: 'user-123',
);

rc.CustomerInfo _customerInfo({
  Map<String, rc.EntitlementInfo> active = const <String, rc.EntitlementInfo>{},
  String? managementUrl,
}) =>
    rc.CustomerInfo(
      rc.EntitlementInfos(const <String, rc.EntitlementInfo>{}, active),
      const <String, String?>{},
      const <String>[],
      const <String>[],
      const <rc.StoreTransaction>[],
      '2026-09-07T00:00:00Z',
      'user-123',
      const <String, String?>{},
      '2026-09-07T00:00:00Z',
      managementURL: managementUrl,
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  /// Answers the plugin's method channel with a scripted result, so the bridge
  /// can be driven with no store, no device and no account.
  void mock(Object? Function(MethodCall call) handler) {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, (MethodCall call) async {
      return handler(call);
    });
  }

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, null);
  });

  group('configure', () {
    test('an unusable configuration never reaches the SDK', () async {
      final List<String> calls = <String>[];
      mock((MethodCall call) {
        calls.add(call.method);
        return null;
      });
      final RevenueCatBridge bridge = RevenueCatBridge(capabilities: _canSell);
      addTearDown(bridge.dispose);

      expect(
        await bridge.configure(
          const IapBridgeConfig(
            publicApiKey: '',
            entitlementId: 'pro',
            appUserId: 'user-123',
          ),
        ),
        isFalse,
      );
      // 🔴 REFUSED BEFORE THE PLATFORM CALL. Configuring an SDK with an empty
      // key is how a paywall ends up drawing a button whose failure only shows
      // up in front of a buyer.
      expect(calls, isEmpty);
    });

    test('a platform that cannot sell refuses without calling the SDK',
        () async {
      final List<String> calls = <String>[];
      mock((MethodCall call) {
        calls.add(call.method);
        return null;
      });
      final RevenueCatBridge bridge =
          RevenueCatBridge(capabilities: _cannotSell);
      addTearDown(bridge.dispose);

      expect(await bridge.configure(_config), isFalse);
      expect(calls, isEmpty);
    });

    test('a usable configuration calls setupPurchases with our account id',
        () async {
      Map<Object?, Object?>? args;
      mock((MethodCall call) {
        if (call.method == 'setupPurchases') {
          args = call.arguments as Map<Object?, Object?>;
        }
        return null;
      });
      final RevenueCatBridge bridge = RevenueCatBridge(capabilities: _canSell);
      addTearDown(bridge.dispose);

      expect(await bridge.configure(_config), isTrue);
      // [pipeline 5]M-7 — attribution before money. Without this the provider
      // mints an anonymous id and the payment arrives unclaimed.
      expect(args?['appUserId'], 'user-123');
      expect(args?['apiKey'], 'public_test_key');
    });

    test('a PlatformException from the SDK is an answer, not a crash',
        () async {
      mock((MethodCall call) {
        throw PlatformException(code: '0', message: 'nope');
      });
      final RevenueCatBridge bridge = RevenueCatBridge(capabilities: _canSell);
      addTearDown(bridge.dispose);

      expect(await bridge.configure(_config), isFalse);
    });
  });

  // ── [ADR 085] B — the SDK follows the signed-in account after configure ───
  // The method names and argument key are the plugin's own
  // (`Purchases.logIn` invokes 'logIn' with {'appUserID': …}; `logOut`
  // invokes 'logOut'), read out of purchases_flutter's source.
  group('identify and logOut re-identify the SDK after configure', () {
    /// The smallest CustomerInfo JSON `CustomerInfo.fromJson` accepts, so the
    /// plugin's own parsing of the channel answer succeeds.
    Map<String, Object?> customerInfoJson(String appUserId) => <String, Object?>{
          'entitlements': <String, Object?>{
            'all': <String, Object?>{},
            'active': <String, Object?>{},
            'verification': 'NOT_REQUESTED',
          },
          'allPurchaseDates': <String, Object?>{},
          'activeSubscriptions': <Object?>[],
          'allPurchasedProductIdentifiers': <Object?>[],
          'nonSubscriptionTransactions': <Object?>[],
          'firstSeen': '2026-09-19T00:00:00Z',
          'originalAppUserId': appUserId,
          'allExpirationDates': <String, Object?>{},
          'requestDate': '2026-09-19T00:00:00Z',
        };

    test('identify calls logIn with the NEW app user id', () async {
      final List<MethodCall> calls = <MethodCall>[];
      mock((MethodCall call) {
        calls.add(call);
        if (call.method == 'logIn') {
          return <String, Object?>{
            'customerInfo': customerInfoJson('user-456'),
            'created': false,
          };
        }
        return null;
      });
      final RevenueCatBridge bridge = RevenueCatBridge(capabilities: _canSell);
      addTearDown(bridge.dispose);

      expect(await bridge.identify('user-456'), isTrue);
      final MethodCall logIn =
          calls.singleWhere((MethodCall c) => c.method == 'logIn');
      expect(
        (logIn.arguments as Map<Object?, Object?>)['appUserID'],
        'user-456',
      );
    });

    test('logOut calls the SDK logOut', () async {
      final List<String> calls = <String>[];
      mock((MethodCall call) {
        calls.add(call.method);
        return call.method == 'logOut' ? customerInfoJson('anon') : null;
      });
      final RevenueCatBridge bridge = RevenueCatBridge(capabilities: _canSell);
      addTearDown(bridge.dispose);

      expect(await bridge.logOut(), isTrue);
      expect(calls, contains('logOut'));
    });

    test('a refusal from the SDK is false, never a throw', () async {
      mock((MethodCall call) {
        throw PlatformException(code: '0', message: 'nope');
      });
      final RevenueCatBridge bridge = RevenueCatBridge(capabilities: _canSell);
      addTearDown(bridge.dispose);

      expect(await bridge.identify('user-456'), isFalse);
      expect(await bridge.logOut(), isFalse);
    });

    test('a platform that cannot sell never reaches the SDK', () async {
      final List<String> calls = <String>[];
      mock((MethodCall call) {
        calls.add(call.method);
        return null;
      });
      final RevenueCatBridge bridge =
          RevenueCatBridge(capabilities: _cannotSell);
      addTearDown(bridge.dispose);

      expect(await bridge.identify('user-456'), isFalse);
      expect(await bridge.logOut(), isFalse);
      expect(calls, isEmpty);
    });
  });

  group('the mappings, which are where a mistranslation would live', () {
    test('a user cancel is cancelledByUser, never a failure', () {
      // RevenueCat reports a dismissed sheet as a PlatformException whose code
      // is the ordinal of PurchasesErrorCode.purchaseCancelledError. The naive
      // catch tells somebody who deliberately backed out that their purchase
      // failed.
      final int ordinal = rc.PurchasesErrorCode.values
          .indexOf(rc.PurchasesErrorCode.purchaseCancelledError);
      final IapPurchaseResult r = outcomeForPlatformException(
        PlatformException(code: '$ordinal', message: 'cancelled'),
      );
      expect(r.outcome, IapPurchaseOutcome.cancelledByUser);
    });

    test('a store refusal and an unreachable store are different answers', () {
      final int notAllowed = rc.PurchasesErrorCode.values
          .indexOf(rc.PurchasesErrorCode.purchaseNotAllowedError);
      expect(
        outcomeForPlatformException(PlatformException(code: '$notAllowed'))
            .outcome,
        IapPurchaseOutcome.storeRefused,
      );
      final int network = rc.PurchasesErrorCode.values
          .indexOf(rc.PurchasesErrorCode.networkError);
      expect(
        outcomeForPlatformException(PlatformException(code: '$network')).outcome,
        IapPurchaseOutcome.unavailable,
      );
    });

    test('an exception the helper cannot decode is "we could not ask"', () {
      // A MissingPluginException arrives with a non-numeric code and
      // `getErrorCode` throws on it. "The store said no" would be a fabricated
      // vendor answer.
      expect(
        outcomeForPlatformException(
          PlatformException(code: 'channel-error', message: 'no impl'),
        ).outcome,
        IapPurchaseOutcome.unavailable,
      );
    });

    test('customerStateFrom reads ACTIVE entitlements only', () {
      final rc.EntitlementInfo pro = rc.EntitlementInfo(
        'pro',
        true,
        true,
        '2026-09-01T00:00:00Z',
        '2026-09-01T00:00:00Z',
        'pro_monthly',
        false,
      );
      final IapCustomerState state = customerStateFrom(
        _customerInfo(active: <String, rc.EntitlementInfo>{'pro': pro}),
      );
      expect(state.holds('pro'), isTrue);
      expect(state.holds('team'), isFalse);
    });

    test('customerStateFrom refuses a non-https management URL', () {
      // 🔒 The value ends up in a platform launchUrl call — an instruction to
      // the operating system — and it arrives from a network response.
      expect(
        customerStateFrom(_customerInfo(managementUrl: 'javascript:alert(1)'))
            .managementUrl,
        isNull,
      );
      expect(
        customerStateFrom(
          _customerInfo(managementUrl: 'https://play.google.test/subs'),
        ).managementUrl?.host,
        'play.google.test',
      );
    });
  });

  group('a platform that cannot sell degrades instead of throwing', () {
    test('purchase, restore and customer state all answer a value', () async {
      mock((MethodCall call) => throw StateError('the SDK must not be reached'));
      final RevenueCatBridge bridge =
          RevenueCatBridge(capabilities: _cannotSell);
      addTearDown(bridge.dispose);

      const Offering monthly = Offering(
        productId: 'pro_monthly',
        amountMinor: 499,
        currencyCode: 'USD',
        term: OfferingTerm.month,
        trialDays: 30,
      );
      expect(
        (await bridge.purchase(monthly)).outcome,
        IapPurchaseOutcome.unavailable,
      );
      expect((await bridge.restore()).outcome, IapPurchaseOutcome.unavailable);
      expect(await bridge.currentCustomerState(), IapCustomerState.unknown);
      expect(await bridge.purchasableProductIds(), isEmpty);
    });
  });
}
