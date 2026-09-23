import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';

void main() {
  group('[5]M-11 · the price is FORMATTED from the rail, never typed', () {
    test('an amount and an ISO code render as the buyer reads it', () {
      const Offering o = Offering(
        productId: 'pro_monthly',
        amountMinor: 499,
        currencyCode: 'USD',
        term: OfferingTerm.month,
        trial: TrialPeriod.days(30),
      );
      // The symbol comes from ICU data, not from a symbol table anybody typed.
      expect(o.formattedPrice, r'$4.99');
    });

    test('a DIFFERENT amount renders differently — the formatter is real', () {
      // Without this the previous test passes against a hardcoded return.
      const Offering o = Offering(
        productId: 'pro_yearly',
        amountMinor: 1999,
        currencyCode: 'USD',
        term: OfferingTerm.year,
        trial: TrialPeriod.days(30),
      );
      expect(o.formattedPrice, r'$19.99');
    });

    test('a different CURRENCY renders with its own symbol', () {
      const Offering o = Offering(
        productId: 'pro_monthly_inr',
        amountMinor: 39900,
        currencyCode: 'INR',
        term: OfferingTerm.month,
      );
      expect(o.formattedPrice, contains('399'));
      expect(o.formattedPrice, isNot(contains(r'$')));
    });
  });

  group('parsing FAILS CLOSED — an offering we cannot read cannot be sold', () {
    Map<String, Object?> good() => <String, Object?>{
          'product_id': 'pro_monthly',
          'amount_minor': 499,
          'currency_code': 'usd',
          'term': 'month',
          'trial_days': 30,
        };

    test('the good shape parses, and lowercases the currency', () {
      final Offering? o = Offering.tryFromJson(good());
      expect(o, isNotNull);
      expect(o!.currencyCode, 'USD');
      expect(o.term, OfferingTerm.month);
      expect(o.trial, const TrialPeriod.days(30));
    });

    for (final MapEntry<String, Object?> bad in <String, Object?>{
      // A JSON double where minor units were meant would sell at five paise.
      'amount_minor': 4.99,
      'currency_code': 'US',
      // An unrecognised term must never be guessed: "billed monthly" on a
      // yearly plan is a chargeback with a support ticket attached.
      'term': 'fortnight',
      'product_id': '',
    }.entries) {
      test('${bad.key} = ${bad.value} ⇒ DROPPED, not defaulted', () {
        final Map<String, Object?> j = good()..[bad.key] = bad.value;
        expect(Offering.tryFromJson(j), isNull);
      });
    }

    test('a zero or negative price is not a product', () {
      expect(Offering.tryFromJson(good()..['amount_minor'] = 0), isNull);
      expect(Offering.tryFromJson(good()..['amount_minor'] = -100), isNull);
    });

    test('a missing or negative trial is NO trial, and never drops the plan',
        () {
      expect(Offering.tryFromJson(good()..remove('trial_days'))!.trial, isNull);
      expect(Offering.tryFromJson(good()..['trial_days'] = -5)!.trial, isNull);
    });

    test('a non-map is not an offering', () {
      expect(Offering.tryFromJson('pro_monthly'), isNull);
      expect(Offering.tryFromJson(null), isNull);
    });
  });

  group('RailConfig — a rail we cannot read sells nothing', () {
    test('unreadable offerings are dropped, readable ones survive', () {
      final RailConfig c = RailConfig.fromPaywallExtra(<String, Object?>{
        'offerings': <Object?>[
          <String, Object?>{
            'product_id': 'a',
            'amount_minor': 499,
            'currency_code': 'USD',
            'term': 'month',
          },
          <String, Object?>{'product_id': 'b'},
          'not an object',
        ],
      });
      expect(c.offerings, hasLength(1));
      expect(c.offerings.single.productId, 'a');
    });

    test('canCheckout is FALSE without a template — the state today', () {
      // No seller account exists (OWNER_QUEUE A-1), so no template has been
      // pasted out of a console nobody has. The paywall says so rather than
      // opening a URL somebody guessed.
      final RailConfig c = RailConfig.fromPaywallExtra(<String, Object?>{
        'offerings': <Object?>[
          <String, Object?>{
            'product_id': 'a',
            'amount_minor': 499,
            'currency_code': 'USD',
            'term': 'month',
          },
        ],
      });
      expect(c.offerings, hasLength(1));
      expect(c.canCheckout, isFalse);
    });

    test('canCheckout is FALSE with a template but nothing to sell', () {
      final RailConfig c = RailConfig.fromPaywallExtra(<String, Object?>{
        'checkout_url_template': 'https://pay.example.test/{price_id}',
      });
      expect(c.canCheckout, isFalse);
    });

    group('🔒 a template is an instruction to the OPERATING SYSTEM', () {
      // It arrives in a config document over the network and ends up in
      // `launchUrl`. Anything that is not absolute https is refused HERE, so no
      // call site has to remember.
      for (final String hostile in <String>[
        'javascript:alert(1)',
        'file:///etc/passwd',
        'intent://evil#Intent;scheme=http;end',
        'http://pay.example.test/x',
        '/relative/path',
        'https:///no-host',
      ]) {
        test('$hostile is refused', () {
          final RailConfig c = RailConfig.fromPaywallExtra(<String, Object?>{
            'checkout_url_template': hostile,
            'offerings': <Object?>[
              <String, Object?>{
                'product_id': 'a',
                'amount_minor': 499,
                'currency_code': 'USD',
                'term': 'month',
              },
            ],
          });
          expect(c.checkoutUrlTemplate, isNull);
          expect(c.canCheckout, isFalse);
        });
      }

      test('a plain https template is accepted — the check is not "refuse all"',
          () {
        final RailConfig c = RailConfig.fromPaywallExtra(<String, Object?>{
          'checkout_url_template': 'https://pay.example.test/{price_id}',
          'offerings': <Object?>[
            <String, Object?>{
              'product_id': 'a',
              'amount_minor': 499,
              'currency_code': 'USD',
              'term': 'month',
            },
          ],
        });
        expect(c.canCheckout, isTrue);
      });
    });

    test(
        'fill percent-encodes, so an account id cannot break out of its parameter',
        () {
      final String? url = RailConfig.fill(
        'https://pay.example.test/x?p={price_id}&c={account_id}&r={return_url}',
        appId: 'probe',
        priceId: 'pro',
        accountId: 'a&b=c',
        returnUrl: 'https://back.example.test/?x=1',
      );
      final Uri u = Uri.parse(url!);
      expect(u.queryParameters['c'], 'a&b=c');
      expect(u.queryParameters['r'], 'https://back.example.test/?x=1');
    });

    test(
        'fill on a null template yields null, never a URL with {price_id} in it',
        () {
      expect(
        RailConfig.fill(
          null,
          appId: 'a',
          priceId: 'b',
          accountId: 'c',
          returnUrl: 'd',
        ),
        isNull,
      );
    });

    test(
        'longestTrialDays reads the rail, which is what CI compares M-8 against',
        () {
      final RailConfig c = RailConfig.fromPaywallExtra(<String, Object?>{
        'offerings': <Object?>[
          <String, Object?>{
            'product_id': 'a',
            'amount_minor': 499,
            'currency_code': 'USD',
            'term': 'month',
            'trial_days': 7,
          },
          <String, Object?>{
            'product_id': 'b',
            'amount_minor': 1999,
            'currency_code': 'USD',
            'term': 'year',
            'trial_days': 30,
          },
        ],
      });
      expect(c.longestTrialDays, 30);
    });
  });

  group('the offering and the portfolio money type CANNOT DRIFT', () {
    // 🔴 WHY THIS GROUP EXISTS. `assert-no-price-literals.mjs` scopes its
    // derivation check to `formattedPrice`'s own body, so that getter has to
    // keep computing in place rather than delegating to `Money.plainFormat`.
    // Two renderings of one rule is exactly the duplication that let a symbol
    // be right on the paywall and wrong on the next screen, so the two are
    // pinned to each other here. If either changes alone, this goes red.
    const List<(int, String)> matrix = <(int, String)>[
      (499, 'USD'),
      (1999, 'USD'),
      (39900, 'INR'),
      (1250, 'EUR'),
      (500, 'JPY'),
      (1005, 'KWD'),
      (499, 'ZZZ'),
    ];

    for (final (int amount, String code) in matrix) {
      test('$amount $code renders identically either way', () {
        final Offering o = Offering(
          productId: 'p',
          amountMinor: amount,
          currencyCode: code,
          term: OfferingTerm.month,
        );
        expect(o.price, Money(amount, code));
        expect(o.formattedPrice, o.price.plainFormat());
      });
    }

    test('the minor-unit digits come from the SHARED table', () {
      // A yen plan has no decimal places and a Kuwaiti one has three. A
      // hardcoded division by a hundred misprices the first by 100x, and
      // that table now has exactly one home.
      const Offering yen = Offering(
        productId: 'p',
        amountMinor: 500,
        currencyCode: 'JPY',
        term: OfferingTerm.month,
      );
      expect(yen.formattedPrice, '¥500');
      expect(Money.minorUnitDigitsFor('JPY'), 0);
    });
  });

  // A store's price arrives as a double in major units. It is converted to the
  // same minor units the rail config states, by the same digits table the
  // formatter uses, so a store price and a config price cannot disagree about
  // where the decimal point is.
  group("the store's plan, in the rail's own terms", () {
    test('minorUnitsOf rounds to the currency\'s own minor units', () {
      expect(StorePlan.minorUnitsOf(7.19, 'USD'), 719);
      expect(StorePlan.minorUnitsOf(179.0, 'INR'), 17900);
      expect(StorePlan.minorUnitsOf(500, 'JPY'), 500);
      expect(
        StorePlan.minorUnitsOf(1.234, 'KWD'),
        1234,
        reason: 'KWD has ${Money.minorUnitDigitsFor('KWD')} minor digits',
      );
    });

    test('minorUnitsOf refuses what is not a price', () {
      expect(StorePlan.minorUnitsOf(0, 'USD'), isNull);
      expect(StorePlan.minorUnitsOf(-1, 'USD'), isNull);
      expect(StorePlan.minorUnitsOf(double.nan, 'USD'), isNull);
      expect(StorePlan.minorUnitsOf(4.99, 'US'), isNull);
    });

    const Offering monthly = Offering(
      productId: 'pro_monthly',
      amountMinor: 499,
      currencyCode: 'USD',
      term: OfferingTerm.month,
      trial: TrialPeriod.days(30),
    );
    const Offering yearly = Offering(
      productId: 'pro_yearly',
      amountMinor: 4999,
      currencyCode: 'USD',
      term: OfferingTerm.year,
    );

    test("offeringsFromStore keeps the config's order and the store's price",
        () {
      final List<Offering> out = offeringsFromStore(
        const <Offering>[monthly, yearly],
        const <StorePlan>[
          StorePlan(
            productId: 'pro_yearly',
            amountMinor: 5999,
            currencyCode: 'EUR',
            term: OfferingTerm.year,
          ),
          StorePlan(
            productId: 'pro_monthly',
            amountMinor: 719,
            currencyCode: 'USD',
            term: OfferingTerm.month,
            trial: TrialPeriod(count: 1, unit: TrialUnit.month),
          ),
        ],
      );
      expect(
        out.map((Offering o) => o.productId),
        <String>['pro_monthly', 'pro_yearly'],
      );
      expect(out.first.amountMinor, 719);
      expect(
        out.first.trial,
        const TrialPeriod(count: 1, unit: TrialUnit.month),
      );
      expect(out.last.currencyCode, 'EUR');
    });

    test('offeringsFromStore never falls back to the config', () {
      expect(offeringsFromStore(const <Offering>[monthly], const []), isEmpty);
    });

    test('offeringsFromStore sells nothing the config does not declare', () {
      expect(
        offeringsFromStore(const <Offering>[
          monthly
        ], const <StorePlan>[
          StorePlan(
            productId: 'pro_once',
            amountMinor: 9999,
            currencyCode: 'USD',
            term: OfferingTerm.oneTime,
          ),
        ]),
        isEmpty,
      );
    });

    test('a trial counts days only where a day count is exact', () {
      expect(const TrialPeriod.days(30).exactDays, 30);
      expect(const TrialPeriod(count: 2, unit: TrialUnit.week).exactDays, 14);
      expect(
          const TrialPeriod(count: 1, unit: TrialUnit.month).exactDays, isNull);
      expect(
          const TrialPeriod(count: 1, unit: TrialUnit.year).exactDays, isNull);
    });
  });
}
