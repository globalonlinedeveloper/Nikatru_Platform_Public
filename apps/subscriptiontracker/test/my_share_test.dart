// ST-P4 (round-2 F38) — a shared plan counts as the USER'S share in every
// spend total ("my 1 of 3"), from 0003's share_numerator / share_denominator.
//
// Red control: on the base (fbe498ac) `Subscription` has no share fields and
// `SubMath.totalMonthly` sums the whole price, so a 1/3 row totals 300.00 —
// the first test fails there (it does not compile).
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/core/format/sub_math.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';

Subscription _row({
  String id = 's',
  int minor = 30000,
  Cadence cycle = BillingCycle.monthly,
  int num = 1,
  int den = 1,
  String? label,
}) => Subscription(
  id: id,
  name: 'Netflix',
  category: 'Video',
  price: Money(minor, 'INR'),
  cycle: cycle,
  nextRenewal: DateTime(2026, 10, 3),
  shareNumerator: num,
  shareDenominator: den,
  sharedWith: label,
);

void main() {
  test('RED CONTROL: totals use my share for a 1/3 shared row', () {
    final List<Subscription> subs = <Subscription>[_row(num: 1, den: 3)];
    expect(SubMath.totalMonthly(subs).single, const Money(10000, 'INR'));
    expect(SubMath.totalYearly(subs).single, const Money(120000, 'INR'));
    expect(
      SubMath.categoryTotals(subs).single.value.single,
      const Money(10000, 'INR'),
    );
  });

  test('a yearly shared plan rounds ONCE: 1,000 a year split 3 ways', () {
    final Subscription s = _row(
      minor: 100000,
      cycle: BillingCycle.yearly,
      num: 1,
      den: 3,
    );
    // A month: 100000 x 1 / (12 x 3) = 2777.78 → 2778, one rounding.
    // A year: 100000 x 1 / 3 = 33333.33 → 33333.
    expect(
      SubMath.totalMonthly(<Subscription>[s]).single,
      const Money(2778, 'INR'),
    );
    expect(s.myYearlyCharge, const Money(33333, 'INR'));
  });

  test('an unshared row is untouched, and CHARGES stay the whole price', () {
    final Subscription whole = _row();
    final Subscription shared = _row(id: 't', num: 1, den: 3);
    expect(
      SubMath.totalMonthly(<Subscription>[whole]).single,
      const Money(30000, 'INR'),
    );
    // The card is still billed in full for a shared plan.
    expect(
      SubMath.chargedInMonth(<Subscription>[shared], 2026, 10).single,
      const Money(30000, 'INR'),
    );
  });

  group('the wire', () {
    Map<String, dynamic> j(Map<String, dynamic> extra) => <String, dynamic>{
      'id': '1',
      'name': 'Netflix',
      'price': 300,
      'price_minor': 30000,
      'currency': 'INR',
      'cycle': 'monthly',
      'next_renewal': '2026-10-03',
      ...extra,
    };

    test('decodes the pair and the label', () {
      final Subscription s = Subscription.fromJson(
        j(<String, dynamic>{
          'shared_with': 'flatmates',
          'share_numerator': 1,
          'share_denominator': 3,
        }),
      );
      expect(s.isShared, isTrue);
      expect(s.sharedWith, 'flatmates');
      expect((s.shareNumerator, s.shareDenominator), (1, 3));
    });

    test('anything outside the API rule is the whole plan, never a guess', () {
      for (final Map<String, dynamic> bad in <Map<String, dynamic>>[
        <String, dynamic>{'share_numerator': 1},
        <String, dynamic>{'share_numerator': 4, 'share_denominator': 3},
        <String, dynamic>{'share_numerator': 0, 'share_denominator': 3},
        <String, dynamic>{'share_numerator': '1', 'share_denominator': 3},
      ]) {
        final Subscription s = Subscription.fromJson(j(bad));
        expect((s.shareNumerator, s.shareDenominator), (1, 1), reason: '$bad');
      }
    });

    test(
      'an unshared row sends no share keys; a shared one sends the pair',
      () {
        expect(_row().toJson().containsKey('share_numerator'), isFalse);
        final Map<String, dynamic> out = _row(num: 1, den: 3).toJson();
        expect(out['share_numerator'], 1);
        expect(out['share_denominator'], 3);
      },
    );

    test('undoing a share PATCHes 1/1 and a null label', () {
      final Subscription before = _row(num: 1, den: 3, label: 'flatmates');
      final Subscription after = _row();
      expect(after.changesFrom(before), <String, dynamic>{
        'shared_with': null,
        'share_numerator': 1,
        'share_denominator': 1,
      });
    });

    test('changing the share sends the pair together', () {
      final Subscription before = _row(num: 1, den: 3);
      final Subscription after = _row(num: 1, den: 4);
      final Map<String, dynamic> out = after.changesFrom(before);
      expect(out['share_numerator'], 1);
      expect(out['share_denominator'], 4);
    });

    test('a share survives a patched() round trip', () {
      final Subscription s = _row(
        num: 2,
        den: 5,
      ).patched(<String, dynamic>{'name': 'Netflix Premium'});
      expect((s.shareNumerator, s.shareDenominator), (2, 5));
    });
  });
}
