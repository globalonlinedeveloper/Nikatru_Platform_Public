import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';

void main() {
  group('[5]M-11 · the price is FORMATTED from the rail, never typed', () {
    test('an amount and an ISO code render as the buyer reads it', () {
      const Offering o = Offering(
        productId: 'pro_monthly',
        amountMinor: 499,
        currencyCode: 'USD',
        term: OfferingTerm.month,
        trialDays: 30,
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
        trialDays: 30,
      );
      expect(o.formattedPrice, r'$19.99');
    });

    test('a different CURRENCY renders with its own symbol', () {
      const Offering o = Offering(
        productId: 'pro_monthly_inr',
        amountMinor: 39900,
        currencyCode: 'INR',
        term: OfferingTerm.month,
        trialDays: 0,
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
      expect(o.trialDays, 30);
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
      expect(Offering.tryFromJson(good()..remove('trial_days'))!.trialDays, 0);
      expect(Offering.tryFromJson(good()..['trial_days'] = -5)!.trialDays, 0);
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
}
