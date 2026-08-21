// Fast unit tests (no browser) for the pure logic the UI relies on. Run by
// `flutter test` in CI; the browser E2E lives under integration_test/.
import 'package:flutter_test/flutter_test.dart';

import 'package:subly/core/format/currency.dart';
import 'package:subly/data/models/subscription.dart';

void main() {
  group('Currency', () {
    test(r'USD formats with the $ symbol and two decimals', () {
      expect(const Currency(r'$').fmt(10), r'$10.00');
      expect(const Currency(r'$').fmt0(1234), r'$1,234');
    });
    test('other symbols RE-SYMBOL the stored number, never convert it', () {
      expect(const Currency('€').fmt(10), '€10.00');
      expect(const Currency('₹').fmt(1), '₹1.00');
      // The measured bug this replaces: a ₹499 plan entered as 499 rendered
      // as ₹41,417, because a hardcoded FX table multiplied by 83.
      expect(const Currency('₹').fmt0(499), '₹499');
    });
    test('the same number under two symbols differs ONLY by the glyph', () {
      // The per-symbol expectations above are not what catches a rate table:
      // whoever adds one just updates them to match. The relationship BETWEEN
      // symbols is the assertion that cannot be satisfied by any conversion,
      // so it is the one that would have caught the original bug.
      const Currency usd = Currency(r'$');
      final String tail2 = usd.fmt(499).substring(1);
      final String tail0 = usd.fmt0(1234).substring(1);
      for (final String s in const <String>['€', '£', '₹']) {
        expect(Currency(s).fmt(499), '$s$tail2');
        expect(Currency(s).fmt0(1234), '$s$tail0');
      }
    });
  });

  group('Subscription', () {
    Subscription make(double price, BillingCycle cycle) => Subscription(
          id: '1',
          name: 'X',
          category: 'Other',
          price: price,
          cycle: cycle,
          nextRenewal: DateTime(2026, 1, 1),
        );

    test('yearly price normalises to a monthly figure', () {
      expect(make(120, BillingCycle.yearly).monthlyPrice, 10);
    });
    test('monthly price passes through unchanged', () {
      expect(make(9.99, BillingCycle.monthly).monthlyPrice, 9.99);
    });
    test('json round-trips name, price and cycle', () {
      final Subscription back =
          Subscription.fromJson(make(15.49, BillingCycle.yearly).toJson());
      expect(back.cycle, BillingCycle.yearly);
      expect(back.price, 15.49);
      expect(back.name, 'X');
    });
  });
}
