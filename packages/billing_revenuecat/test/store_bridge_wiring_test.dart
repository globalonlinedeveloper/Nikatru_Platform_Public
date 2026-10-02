// O-BRICK-SELLS-NOTHING-IN-A-STORE (12b) — THE WIRING RULE, PROVEN WHERE IT LIVES.
//
// `StoreBridgeWiring.forChannel` is the rule every app's money provider calls
// (app #1 and every app the brick stamps). Each case below is written out on
// its own, with a fake bridge whose constructor records that it ran, so "no
// bridge was built" is observed rather than inferred from a null.
//
// The five non-store-channel cases moved here from
// apps/subscriptiontracker/test/iap_opt_in_test.dart ("<channel> never builds a
// store bridge, even with a key"): they proved the rule, not the app. The app's
// test keeps every case that needs the app's rail, sign-in and config.
//
// Red controls, each observed red and reverted (the PR records the exits):
//   · `publicKey.isNotEmpty` dropped from `bridged` → the three "+ an EMPTY key"
//     cases go red (a bridge is built keyless).
//   · `isStoreBilling` dropped → web, windows-store, linux-appimage and
//     apps-gov-in go red (`dev` and an unknown channel stay null: the register
//     does not name them, so `channelNamed` refuses them first).
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_billing_revenuecat/nikatru_billing_revenuecat.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';
import 'package:nikatru_purchases/testing.dart';

/// The wiring for [channel], with a bridge factory that counts its calls.
({IapBridge? bridge, IapBridgeConfig? config, int built}) _wire(
  String channel, {
  required String key,
  String entitlementId = 'pro',
}) {
  int built = 0;
  final w = StoreBridgeWiring.forChannel(
    channel,
    publicKey: key,
    entitlementId: entitlementId,
    newBridge: () {
      built++;
      // A store that answers nothing: the test only counts how many were built.
      return FakeIapBridge(configureAnswer: false, identifyAnswer: false);
    },
  );
  return (bridge: w.bridge, config: w.config, built: built);
}

void main() {
  group('a store channel + a public key → one bridge and its config', () {
    test('android-play', () {
      final w = _wire('android-play', key: 'public-sdk-key');
      expect(w.built, 1);
      expect(w.bridge, isA<FakeIapBridge>());
      expect(w.config?.publicApiKey, 'public-sdk-key');
      expect(w.config?.entitlementId, 'pro');
      expect(w.config?.appUserId, isNull);
    });

    test('ios-appstore', () {
      final w = _wire('ios-appstore', key: 'public-sdk-key');
      expect(w.built, 1);
      expect(w.bridge, isA<FakeIapBridge>());
      expect(w.config?.publicApiKey, 'public-sdk-key');
      expect(w.config?.entitlementId, 'pro');
    });

    test('macos-appstore', () {
      final w = _wire('macos-appstore', key: 'public-sdk-key');
      expect(w.built, 1);
      expect(w.bridge, isA<FakeIapBridge>());
      expect(w.config?.publicApiKey, 'public-sdk-key');
      expect(w.config?.entitlementId, 'pro');
    });

    test("the config carries the app's own entitlement id", () {
      final w = _wire('android-play', key: 'k', entitlementId: 'plus');
      expect(w.config?.entitlementId, 'plus');
    });

    test('production passes no factory: the default is RevenueCatBridge', () {
      final w = StoreBridgeWiring.forChannel(
        'android-play',
        publicKey: 'public-sdk-key',
        entitlementId: 'pro',
      );
      expect(w.bridge, isA<RevenueCatBridge>());
      expect(w.config, isNotNull);
    });
  });

  group('a store channel + an EMPTY key → no bridge, no config', () {
    test('android-play', () {
      final w = _wire('android-play', key: '');
      expect(w.built, 0);
      expect(w.bridge, isNull);
      expect(w.config, isNull);
    });

    test('ios-appstore', () {
      final w = _wire('ios-appstore', key: '');
      expect(w.built, 0);
      expect(w.bridge, isNull);
      expect(w.config, isNull);
    });

    test('macos-appstore', () {
      final w = _wire('macos-appstore', key: '');
      expect(w.built, 0);
      expect(w.bridge, isNull);
      expect(w.config, isNull);
    });
  });

  group('a non-store channel never builds a store bridge, even with a key', () {
    test('web', () {
      final w = _wire('web', key: 'public-sdk-key');
      expect(w.built, 0);
      expect(w.bridge, isNull);
      expect(w.config, isNull);
    });

    test('windows-store', () {
      final w = _wire('windows-store', key: 'public-sdk-key');
      expect(w.built, 0);
      expect(w.bridge, isNull);
      expect(w.config, isNull);
    });

    test('linux-appimage', () {
      final w = _wire('linux-appimage', key: 'public-sdk-key');
      expect(w.built, 0);
      expect(w.bridge, isNull);
      expect(w.config, isNull);
    });

    test('apps-gov-in', () {
      final w = _wire('apps-gov-in', key: 'public-sdk-key');
      expect(w.built, 0);
      expect(w.bridge, isNull);
      expect(w.config, isNull);
    });

    test('dev (the undeclared default)', () {
      final w = _wire('dev', key: 'public-sdk-key');
      expect(w.built, 0);
      expect(w.bridge, isNull);
      expect(w.config, isNull);
    });

    test('a channel the register does not know', () {
      final w = _wire('no-such-channel', key: 'public-sdk-key');
      expect(w.built, 0);
      expect(w.bridge, isNull);
      expect(w.config, isNull);
    });
  });
}
