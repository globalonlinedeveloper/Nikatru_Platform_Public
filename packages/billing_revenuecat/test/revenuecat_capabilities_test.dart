import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_billing_revenuecat/nikatru_billing_revenuecat.dart';

void main() {
  // ── [pipeline C-7] EVERY ROW IS REACHABLE FROM A TEST ─────────────────────
  // The matrix takes the platform as a PARAMETER precisely so that five of the
  // six rows are not permanently unexercised on whatever host CI happens to be.
  // A matrix that can only be evaluated on the current platform is a comment
  // with a type.
  group('RevenueCatCapabilities covers all six targets plus web', () {
    for (final TargetPlatform p in TargetPlatform.values) {
      test('${p.name} declares an answer with a substantive reason', () {
        final RevenueCatCapabilities c =
            RevenueCatCapabilities.forPlatform(p, isWeb: false);
        expect(c.why.length, greaterThan(20),
            reason: 'a false with no reason is indistinguishable from an '
                'oversight');
      });
    }

    test('web is answered before the platform is consulted', () {
      // A Flutter web build still reports SOME TargetPlatform, so `isWeb` has
      // to win — otherwise a web build on a Mac would claim the macOS answer.
      final RevenueCatCapabilities web = RevenueCatCapabilities.forPlatform(
        TargetPlatform.macOS,
        isWeb: true,
      );
      expect(web.canPurchase, isFalse);
      expect(web.canRestore, isFalse);
      expect(web.why, contains('merchant of record'));
    });
  });

  group('the answers are the ones ADR 039 and the tree support', () {
    test('android, iOS and macOS can purchase — the store-rail channels', () {
      for (final TargetPlatform p in <TargetPlatform>[
        TargetPlatform.android,
        TargetPlatform.iOS,
        TargetPlatform.macOS,
      ]) {
        final RevenueCatCapabilities c =
            RevenueCatCapabilities.forPlatform(p, isWeb: false);
        expect(c.canPurchase, isTrue, reason: p.name);
        expect(c.canRestore, isTrue, reason: p.name);
      }
    });

    test('macOS can purchase, and its reason cites the ruling', () {
      // 🔴 THE HOUSE RULE, STILL A TEST. macOS was DENIED as unverified until
      // 2026-09-19. It flipped only when BOTH halves were sourced: [ADR 078]
      // §11.1 Q4 (the Mac App Store sells in-app at v1) and the plugin's own
      // pubspec, which declares `flutter.plugin.platforms.macos` in
      // purchases_flutter 10.13.1 (pub.dev versions API, read 2026-09-19).
      // If the ruling or the plugin's platform list changes, this is the test
      // that asks for the new source.
      final RevenueCatCapabilities c = RevenueCatCapabilities.forPlatform(
        TargetPlatform.macOS,
        isWeb: false,
      );
      expect(c.canPurchase, isTrue);
      expect(c.why, contains('ADR 078'));
    });

    test('windows, linux and fuchsia degrade for MECHANICAL reasons', () {
      for (final TargetPlatform p in <TargetPlatform>[
        TargetPlatform.windows,
        TargetPlatform.linux,
        TargetPlatform.fuchsia,
      ]) {
        final RevenueCatCapabilities c =
            RevenueCatCapabilities.forPlatform(p, isWeb: false);
        expect(c.canPurchase, isFalse, reason: p.name);
        expect(c.canRestore, isFalse, reason: p.name);
      }
    });

    test('at least one platform can actually sell', () {
      // The floor that kills "seven rows of false is a complete matrix". A
      // bridge that works nowhere degrades perfectly and delivers nothing.
      final Iterable<RevenueCatCapabilities> all = TargetPlatform.values
          .map((TargetPlatform p) =>
              RevenueCatCapabilities.forPlatform(p, isWeb: false));
      expect(all.where((RevenueCatCapabilities c) => c.canPurchase), isNotEmpty);
    });
  });
}
