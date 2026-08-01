import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';

void main() {
  group('[5]M-15 · two fields, because they are different questions', () {
    test('iOS CAN open a checkout and is NOT ALLOWED to — both, not one', () {
      final PurchaseCapabilities c = PurchaseCapabilities.forChannel(
        PurchaseChannel.iosAppStore,
      );
      // 🔴 THE WHOLE POINT OF THE SECOND FIELD. A one-boolean matrix has to
      // pick a lie: "we cannot take payment on iOS" (false — the code works) or
      // "we can" (false in the way that gets an app rejected).
      expect(c.technicallySupported, isTrue);
      expect(c.channelPermitted, isFalse);
      expect(c.canStartCheckout, isFalse);
    });

    test('web can and may', () {
      final PurchaseCapabilities c = PurchaseCapabilities.forChannel(
        PurchaseChannel.web,
      );
      expect(c.canStartCheckout, isTrue);
    });

    test('EVERY channel carries a substantive reason', () {
      for (final PurchaseChannel ch in PurchaseChannel.values) {
        final PurchaseCapabilities c = PurchaseCapabilities.forChannel(ch);
        // A `false` with no reason is indistinguishable from an oversight, and
        // a row nobody can review is a row nobody reviews.
        expect(
          c.why.length,
          greaterThan(20),
          reason: '${ch.registerId} has no substantive `why`',
        );
      }
    });

    test(
        'at least one channel can actually sell — six rows of false is a DEAD rail',
        () {
      // M-15's original wording scored a matrix of six `false`s as complete and
      // perfectly degrading. It described a rail that could never take a rupee.
      expect(
        PurchaseChannel.values.where(
          (PurchaseChannel c) =>
              PurchaseCapabilities.forChannel(c).canStartCheckout,
        ),
        isNotEmpty,
      );
    });
  });

  group('forPlatform takes the RESTRICTIVE channel', () {
    test('Windows resolves to windows-store, not windows-direct', () {
      // Windows ships through both and a build cannot tell at runtime which one
      // installed it. Taking the permissive answer would put an external
      // checkout inside a Store build on the strength of the direct build's
      // freedom.
      final PurchaseCapabilities p = PurchaseCapabilities.forPlatform(
        TargetPlatform.windows,
        isWeb: false,
      );
      expect(p.canStartCheckout, isFalse);
      expect(
        PurchaseCapabilities.forChannel(PurchaseChannel.windowsDirect)
            .canStartCheckout,
        isTrue,
        reason: 'the permissive channel really is permissive — so the '
            'restrictive resolution above is a choice, not an accident',
      );
    });

    test('isWeb wins over the host platform', () {
      // A web build reports a host TargetPlatform. Reading that rather than
      // kIsWeb would mark a web build ios-appstore-forbidden.
      expect(
        PurchaseCapabilities.forPlatform(
          TargetPlatform.iOS,
          isWeb: true,
        ).canStartCheckout,
        isTrue,
      );
    });

    test('every TargetPlatform resolves without throwing', () {
      for (final TargetPlatform p in TargetPlatform.values) {
        expect(
          () => PurchaseCapabilities.forPlatform(p, isWeb: false),
          returnsNormally,
        );
      }
    });
  });
}
