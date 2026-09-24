// 🔴 O-IAP-BRIDGE-NOT-WIRED-IN-THE-APP, PROVEN THROUGH THE APP'S REAL WIRING.
//
// This app opts in to `billing.mobileIap`, so a store build that carries its
// RevenueCat key must sell through the store, and one that does not must sell
// nothing — never the web rail, never the web book. Every case drives
// `purchaseRailFor`, the body of `purchaseRailProvider`, with the channel a lane
// stamps, a key (or none) and a FAKE bridge in place of `RevenueCatBridge`, so
// no store SDK and no platform channel is touched.
//
// What this proves:
//   · android-play, ios-appstore and macos-appstore + a key → an [IapRail] over
//     the injected bridge, and the store's plans reach the rail WITHOUT the
//     paywall opening (the home promo card and the settings row read them too).
//   · the same channels with an EMPTY key → [UnavailablePurchaseRail]: no
//     checkout, NO offerings, and no bridge was ever built.
//   · web, windows-store, linux-appimage, apps-gov-in and dev never build a
//     bridge, even when a key is present.
//   · the signed-in user's id reaches the bridge's FIRST configure ([ADR 085] B).
//
// Red controls, run 2026-09-24T02:47Z against main 98527d61, each observed red
// and reverted; the exits are recorded in the PR that closes
// O-IAP-BRIDGE-NOT-WIRED-IN-THE-APP:
//   · `iapBridge: null` in money_providers.dart → on every store channel all
//     three "+ a RevenueCat key" cases go red: "is an IapRail over the injected
//     bridge", "asks the store once, at build — no paywall needed for plans"
//     and "the signed-in user's id reaches the bridge's FIRST configure".
//   · the bridge wired with an empty key (`revenueCatKey.isNotEmpty` dropped
//     from `bridged`) → "+ an EMPTY key → sells nothing, describes nothing"
//     goes red on every store channel.
//   · `unawaited(refreshOfferingsOf(rail))` dropped → the same three
//     "+ a RevenueCat key" cases go red on every store channel, not only "asks
//     the store once, at build": nothing configures the bridge at build.
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_purchases/nikatru_purchases.dart';
import 'package:subscriptiontracker/core/app_config.dart';
import 'package:subscriptiontracker/state/money_providers.dart';
import 'package:subscriptiontracker/state/providers.dart';

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

/// Records what the rail asked of the store. Answers like a store that is
/// reachable and sells the one plan the config sells.
class _FakeBridge implements IapBridge {
  final List<String> identities = <String>[];
  int configureCalls = 0;
  int storePlanCalls = 0;
  String? configuredKey;

  @override
  Future<bool> configure(IapBridgeConfig config) async {
    configureCalls++;
    configuredKey = config.publicApiKey;
    identities.add('configure:${config.appUserId}');
    return true;
  }

  @override
  Future<bool> identify(String appUserId) async {
    identities.add('identify:$appUserId');
    return true;
  }

  @override
  Future<bool> logOut() async {
    identities.add('logOut');
    return true;
  }

  @override
  Future<List<StorePlan>> storePlans() async {
    storePlanCalls++;
    return const <StorePlan>[
      StorePlan(
        productId: 'pro_monthly',
        amountMinor: 599,
        currencyCode: 'USD',
        term: OfferingTerm.month,
      ),
    ];
  }

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
      const Stream<IapCustomerState>.empty();
}

/// A config that sells one plan and carries a checkout template — so the only
/// things that can refuse are the channel and the bridge.
final core.AppConfig _selling = core.AppConfig(
  appId: AppConfig.appId,
  apiBaseUrl: AppConfig.apiBaseUrl,
  features: const <String, bool>{},
  paywall: const core.PaywallConfig(
    enabled: true,
    extra: <String, Object?>{
      'offerings': <Object?>[
        <String, Object?>{
          'product_id': 'pro_monthly',
          'amount_minor': 499,
          'currency_code': 'USD',
          'term': 'month',
          'trial_days': 0,
        },
      ],
      'checkout_url_template': 'https://checkout.example.test/{price_id}',
    },
  ),
  contentPack: null,
  copy: const <String, String>{},
  minSupportedVersion: '1.0.0',
);

const core.AuthUser _signedIn = core.AuthUser(
  id: 'user-under-test',
  email: 'buyer@example.test',
);

/// The rail for [channel], built by the app's own `purchaseRailFor` once the
/// config and the sign-in have settled — the order a real launch reaches.
Future<({PurchaseRail rail, List<_FakeBridge> built})> _railFor(
  String channel, {
  required String key,
  core.AuthUser? user = _signedIn,
}) async {
  final List<_FakeBridge> built = <_FakeBridge>[];
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      secureStoreProvider.overrideWithValue(_MemSecureStore()),
      appConfigProvider.overrideWith((_) async => _selling),
      authUserProvider.overrideWith((_) => Stream<core.AuthUser?>.value(user)),
      purchaseRailProvider.overrideWith(
        (ref) => purchaseRailFor(
          ref,
          channel,
          revenueCatKey: key,
          newBridge: () {
            final _FakeBridge b = _FakeBridge();
            built.add(b);
            return b;
          },
        ),
      ),
    ],
  );
  addTearDown(c.dispose);
  await c.read(appConfigProvider.future);
  await c.read(authUserProvider.future);
  final PurchaseRail rail = c.read(purchaseRailProvider);
  // Let the early store ask (configure → storePlans) run to the end.
  for (int i = 0; i < 10; i++) {
    await Future<void>.delayed(Duration.zero);
  }
  return (rail: rail, built: built);
}

const List<String> _storeChannels = <String>[
  'android-play',
  'ios-appstore',
  'macos-appstore',
];

const List<String> _neverBridged = <String>[
  'web',
  'windows-store',
  'linux-appimage',
  'apps-gov-in',
  'dev',
];

void main() {
  for (final String channel in _storeChannels) {
    group('$channel + a RevenueCat key', () {
      test('is an IapRail over the injected bridge', () async {
        final r = await _railFor(channel, key: 'public-sdk-key');
        expect(r.rail, isA<IapRail>());
        expect(r.built, hasLength(1));
        expect(r.built.single.configuredKey, 'public-sdk-key');
      });

      test(
        'asks the store once, at build — no paywall needed for plans',
        () async {
          final r = await _railFor(channel, key: 'public-sdk-key');
          final _FakeBridge bridge = r.built.single;
          expect(bridge.configureCalls, 1);
          expect(bridge.storePlanCalls, 1);
          expect(r.rail.offerings, hasLength(1));
          expect(r.rail.offerings.single.productId, 'pro_monthly');
          expect(r.rail.canStartCheckout, isTrue);
        },
      );

      test(
        "the signed-in user's id reaches the bridge's FIRST configure",
        () async {
          final r = await _railFor(channel, key: 'public-sdk-key');
          expect(r.built.single.identities, <String>[
            'configure:user-under-test',
          ]);
        },
      );
    });

    test(
      '$channel + an EMPTY key → sells nothing, describes nothing',
      () async {
        final r = await _railFor(channel, key: '');
        expect(r.rail, isA<UnavailablePurchaseRail>());
        expect(
          (r.rail as UnavailablePurchaseRail).refusal.reason,
          BillingRailRefusal.iapBridgeMissing,
        );
        expect(r.rail.canStartCheckout, isFalse);
        expect(r.rail.offerings, isEmpty);
        expect(r.built, isEmpty);
      },
    );
  }

  for (final String channel in _neverBridged) {
    test('$channel never builds a store bridge, even with a key', () async {
      final r = await _railFor(channel, key: 'public-sdk-key');
      expect(r.built, isEmpty);
      expect(r.rail, isNot(isA<IapRail>()));
    });
  }
}
