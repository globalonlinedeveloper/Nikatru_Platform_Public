import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';

/// R7 — where a paywall goes after each [CheckoutRefusal].
///
/// Every expectation is WRITTEN OUT, one per refusal. A table computed from
/// `refusalRouteOf` would agree with whatever it returned, including the defect
/// this exists for: every refusal, the buyer's own cancel included, landing on
/// "Purchases are not available here".
///
/// The other half of R7 is not a test: a seventh [CheckoutRefusal] value fails
/// to COMPILE `refusalRouteOf`, because its switch has no `default`. That was
/// checked once by hand when the switch landed, and recorded with the change.
void main() {
  group('refusalRouteOf', () {
    test('purchaseCancelled goes back to the offers, silently', () {
      expect(
        refusalRouteOf(CheckoutRefusal.purchaseCancelled),
        RefusalRoute.backToChoosing,
      );
    });

    test('notSignedIn routes to sign-in', () {
      expect(
        refusalRouteOf(CheckoutRefusal.notSignedIn),
        RefusalRoute.signIn,
      );
    });

    test('couldNotOpen is retryable', () {
      expect(
        refusalRouteOf(CheckoutRefusal.couldNotOpen),
        RefusalRoute.retry,
      );
    });

    test('railNotConfigured is retryable', () {
      expect(
        refusalRouteOf(CheckoutRefusal.railNotConfigured),
        RefusalRoute.retry,
      );
    });

    test('channelNotPermitted is unavailable here', () {
      expect(
        refusalRouteOf(CheckoutRefusal.channelNotPermitted),
        RefusalRoute.unavailable,
      );
    });

    test('platformNotSupported is unavailable here', () {
      expect(
        refusalRouteOf(CheckoutRefusal.platformNotSupported),
        RefusalRoute.unavailable,
      );
    });

    test('the six cases above are every refusal there is', () {
      // Six named cases and six values: a seventh value that somehow compiled
      // would have no case above, and this count says so.
      expect(CheckoutRefusal.values, hasLength(6));
    });

    test('every route is some refusal\'s answer', () {
      expect(
        CheckoutRefusal.values.map(refusalRouteOf).toSet(),
        RefusalRoute.values.toSet(),
      );
    });
  });
}
