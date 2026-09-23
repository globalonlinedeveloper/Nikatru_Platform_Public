// Fast unit tests (no browser) for the pure logic the UI relies on. Run by
// `flutter test` in CI; the browser E2E lives under integration_test/.
import 'package:flutter_test/flutter_test.dart';

import 'package:subscriptiontracker/core/format/money_format.dart';
import 'package:subscriptiontracker/core/format/monthly_share.dart';
import 'package:subscriptiontracker/core/format/sub_math.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';

/// `intl` separates a LETTER-ended currency symbol from its number with a
/// NON-BREAKING space (U+00A0) — correct rendering, and invisible in a failure
/// message, where `ZZZ 4.99` and `ZZZ 4.99` print identically and differ
/// at offset 3. Normalised here so an assertion about the CODE is not secretly
/// an assertion about which space character intl chose.
String plain(String s) => s.replaceAll(' ', ' ');

void main() {
  group('MoneyFormatter — the money and the reader are two axes', () {
    test(r'USD under en_US formats with the $ symbol and two decimals', () {
      const MoneyFormatter f = MoneyFormatter('en_US');
      expect(f.format(const Money(1000, 'USD')), r'$10.00');
      expect(f.formatRounded(const Money(123400, 'USD')), r'$1,234');
    });

    test('other currencies RE-SYMBOL the stored number, never convert it', () {
      const MoneyFormatter f = MoneyFormatter('en_US');
      expect(f.format(const Money(1000, 'EUR')), '€10.00');
      expect(f.format(const Money(100, 'INR')), '₹1.00');
      // The measured bug this replaces: a 499-rupee plan entered as 499
      // rendered as 41,417, because a hardcoded FX table multiplied by 83.
      expect(f.formatRounded(const Money(49900, 'INR')), '₹499');
    });

    test('the same amount under two currencies differs ONLY by the symbol', () {
      // The per-currency expectations above are not what catches a rate table:
      // whoever adds one just updates them to match. The relationship BETWEEN
      // currencies is the assertion no conversion can satisfy, so it is the one
      // that would have caught the original bug.
      //
      // 🔴 THE COMPARISON NO LONGER SLICES THE FIRST CODE UNIT OFF. The old
      // form was `usd.fmt(499).substring(1)`, which assumed a one-code-unit
      // symbol glued to the FRONT — true only because the old formatter did
      // exactly that in every locale. A formatter that honours the locale can
      // put the symbol behind the number (de_DE) or use a two-character one
      // (A$), so the symbol is REPLACED rather than positionally removed and
      // the invariant survives the thing that used to break it.
      const MoneyFormatter f = MoneyFormatter('en_US');
      final String usd = f
          .format(const Money(49900, 'USD'))
          .replaceFirst(Money.symbolFor('USD')!, '¤');
      final String usd0 = f
          .formatRounded(const Money(123400, 'USD'))
          .replaceFirst(Money.symbolFor('USD')!, '¤');
      for (final String code in const <String>['EUR', 'GBP', 'INR']) {
        expect(
          f
              .format(Money(49900, code))
              .replaceFirst(Money.symbolFor(code)!, '¤'),
          usd,
        );
        expect(
          f
              .formatRounded(Money(123400, code))
              .replaceFirst(Money.symbolFor(code)!, '¤'),
          usd0,
        );
      }
    });

    test('🔴 GROUPING FOLLOWS THE READER, NOT THE MONEY', () {
      // THE DEFECT, in one assertion. The old formatter was
      // `NumberFormat('#,##0.00', 'en_US')` — a locale compiled in and a
      // reader's own convention ignored — so one and a quarter million rupees
      // came out `1,250,000` for every user on earth. India groups the last
      // three digits and then in pairs.
      const Money lakhs = Money(125000000, 'INR');
      expect(const MoneyFormatter('en_US').formatRounded(lakhs), '₹1,250,000');
      expect(const MoneyFormatter('ta').formatRounded(lakhs), '₹12,50,000');
      expect(const MoneyFormatter('en_IN').formatRounded(lakhs), '₹12,50,000');
    });

    test('the two axes are INDEPENDENT — an Indian reader, a US price', () {
      // The case a single "currency setting" cannot express: Indian grouping
      // around a dollar sign, with the dollar's own two decimal places.
      expect(
        const MoneyFormatter('en_IN').format(const Money(125000000, 'USD')),
        r'$12,50,000.00',
      );
    });

    test('decimal places follow the CURRENCY, not a hardcoded two', () {
      const MoneyFormatter f = MoneyFormatter('en_US');
      expect(f.format(const Money(500, 'JPY')), '¥500');
      expect(plain(f.format(const Money(1005, 'KWD'))), 'KWD 1.005');
    });

    test('an unknown currency prints its CODE rather than a guessed glyph', () {
      expect(
        plain(const MoneyFormatter('en_US').format(const Money(499, 'ZZZ'))),
        'ZZZ 4.99',
      );
    });

    test('an unknown locale DEGRADES to en_US instead of throwing', () {
      // The same trap `subscriptions_controller.dart` records for DateFormat:
      // a formatter built outside a MaterialApp can only be sure of `en_US`.
      // Throwing here would surface as an unrelated failure somewhere else.
      expect(
        const MoneyFormatter('zz_ZZ').format(const Money(1000, 'USD')),
        r'$10.00',
      );
    });

    test('an EMPTY total reads in the currency the caller names', () {
      // A new user who has chosen the rupee and added nothing yet must not be
      // shown a dollar zero on the home hero. An empty bag has no currency of
      // its own, so the screen supplies the one it would have been in.
      const MoneyBag nothing = MoneyBag(<String, Money>{});
      expect(const MoneyFormatter('en_US').formatBag(nothing), r'$0.00');
      expect(
        const MoneyFormatter(
          'en_US',
          emptyCurrencyCode: 'INR',
        ).formatBag(nothing),
        '₹0.00',
      );
    });

    test('a mixed total prints EVERY subtotal and converts none of them', () {
      const MoneyFormatter f = MoneyFormatter('en_US');
      final MoneyBag bag = MoneyBag.sum(const <Money>[
        Money(4000, 'USD'),
        Money(49900, 'INR'),
      ]);
      expect(f.formatBag(bag), r'$40.00 + ₹499.00');
      expect(f.formatBagRounded(bag), r'$40 + ₹499');
    });
  });

  group('Subscription', () {
    Subscription make(Money price, BillingCycle cycle) => Subscription(
      id: '1',
      name: 'X',
      category: 'Other',
      price: price,
      cycle: cycle,
      nextRenewal: DateTime(2026, 1, 1),
    );

    test('yearly price normalises to a monthly figure', () {
      expect(
        MonthlyShare.sum(<MonthlyShare>[
          make(const Money(12000, 'USD'), BillingCycle.yearly).monthlyShare,
        ]).single,
        const Money(1000, 'USD'),
      );
    });
    test('monthly price passes through unchanged', () {
      expect(
        MonthlyShare.sum(<MonthlyShare>[
          make(const Money(999, 'USD'), BillingCycle.monthly).monthlyShare,
        ]).single,
        const Money(999, 'USD'),
      );
    });
    test('json round-trips name, price and cycle', () {
      final Subscription back = Subscription.fromJson(
        make(const Money(1549, 'USD'), BillingCycle.yearly).toJson(),
      );
      expect(back.cycle, BillingCycle.yearly);
      expect(back.price, const Money(1549, 'USD'));
      expect(back.name, 'X');
    });
    test('the CURRENCY round-trips too, which is the point of the change', () {
      final Subscription back = Subscription.fromJson(
        make(const Money(49900, 'INR'), BillingCycle.monthly).toJson(),
      );
      expect(back.currencyCode, 'INR');
      expect(back.price, const Money(49900, 'INR'));
    });
    test(
      'a row with no currency reads under the fallback the caller names',
      () {
        // Every row written before this field existed. The user's own chosen
        // currency is the honest reading, because it is the unit those digits
        // were typed in.
        final Subscription back = Subscription.fromJson(<String, dynamic>{
          'id': '9',
          'name': 'Legacy',
          'category': 'Other',
          'price': 15.49,
          'cycle': 'monthly',
          'next_renewal': '2026-08-01',
        }, fallbackCurrencyCode: 'INR');
        expect(back.price, const Money(1549, 'INR'));
      },
    );
    test('the exact integer column WINS over the legacy decimal one', () {
      final Subscription back = Subscription.fromJson(<String, dynamic>{
        'id': '9',
        'name': 'X',
        'category': 'Other',
        'price': 0.01,
        'price_minor': 1549,
        'currency': 'usd',
        'cycle': 'monthly',
        'next_renewal': '2026-08-01',
      });
      expect(back.price, const Money(1549, 'USD'));
    });
    test(
      'the wire keeps its decimal price — nothing silently changed type',
      () {
        final Map<String, dynamic> j = make(
          const Money(1549, 'USD'),
          BillingCycle.monthly,
        ).toJson();
        expect(j['price'], 15.49);
        expect(j['price_minor'], 1549);
        expect(j['currency'], 'USD');
      },
    );
  });

  group('SubMath — a total over unlike currencies is never one number', () {
    Subscription sub(String id, Money price, {int inDays = 5}) => Subscription(
      id: id,
      name: id,
      category: id == 'c' ? 'Other' : 'Streaming',
      price: price,
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime.now().add(Duration(days: inDays)),
    );

    test('one currency behaves exactly as the old double fold did', () {
      final MoneyBag total = SubMath.totalMonthly(<Subscription>[
        sub('a', const Money(1549, 'USD')),
        sub('b', const Money(1199, 'USD')),
      ]);
      expect(total.isMixed, isFalse);
      expect(total.single, const Money(2748, 'USD'));
    });

    test('two currencies stay APART instead of adding to a fake total', () {
      final MoneyBag total = SubMath.totalMonthly(<Subscription>[
        sub('a', const Money(4000, 'USD')),
        sub('b', const Money(49900, 'INR')),
      ]);
      expect(total.isMixed, isTrue);
      expect(total.byCurrency['USD'], const Money(4000, 'USD'));
      expect(total.byCurrency['INR'], const Money(49900, 'INR'));
      // The old code produced 539.0 here — forty dollars plus four hundred and
      // ninety nine rupees, added as though the units matched.
      expect(() => total.single, throwsA(isA<StateError>()));
    });

    test('a chart weighs only the currency it is drawn in', () {
      final List<Subscription> subs = <Subscription>[
        sub('a', const Money(4000, 'USD')),
        sub('b', const Money(49900, 'INR')),
      ];
      expect(SubMath.chartWeight(SubMath.totalMonthly(subs), 'USD'), 4000.0);
      expect(SubMath.chartWeight(SubMath.totalMonthly(subs), 'INR'), 49900.0);
      expect(SubMath.chartWeight(SubMath.totalMonthly(subs), 'GBP'), 0.0);
    });

    test('ordering groups by currency and never compares across them', () {
      final List<Subscription> ordered = SubMath.byMonthlyDesc(<Subscription>[
        sub('a', const Money(1000, 'USD')),
        sub('b', const Money(999999, 'INR')),
        sub('c', const Money(5000, 'USD')),
      ]);
      // USD leads because it appeared first; within it, the larger amount wins.
      // The rupee row is never ranked against a dollar one.
      expect(ordered.map((Subscription s) => s.id).toList(), <String>[
        'c',
        'a',
        'b',
      ]);
    });

    test('dueWithin folds the FULL charge, grouped by currency', () {
      final MoneyBag due = SubMath.dueWithin(
        <Subscription>[
          sub('a', const Money(12000, 'USD'), inDays: 3),
          sub('b', const Money(49900, 'INR'), inDays: 3),
          sub('c', const Money(9900, 'USD'), inDays: 40),
        ],
        DateTime.now(),
        7,
      );
      expect(due.byCurrency['USD'], const Money(12000, 'USD'));
      expect(due.byCurrency['INR'], const Money(49900, 'INR'));
    });
  });
}
