import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';

/// THE SHAPE OF THE URL THE RAIL WILL BUILD, PINNED BEFORE THERE IS A REAL
/// TEMPLATE TO BUILD IT FROM.
///
/// `RailConfig.checkoutUrlTemplate` is null today and stays null until the owner
/// pastes a template out of a seller console nobody has yet (OWNER_QUEUE A-1).
/// That is the whole reason these tests exist NOW rather than then: the day the
/// template arrives is the day a wrong assumption about encoding becomes a
/// broken checkout for the first real buyer, and the failure is invisible until
/// that buyer hits it. So the behaviour of [RailConfig.fill] is MEASURED and
/// written down here — including the shape that does NOT work — and a template
/// that does not fit lands as a red test instead of as a production surprise.
///
/// ## The other end of the wire, quoted rather than assumed
/// The Worker reads attribution back out of the merchant of record's
/// notification from a free-form `custom_data` object with two keys OUR checkout
/// sets — `nikatru_user_id` and `nikatru_app_id`
/// (`services/platform/src/lib/mor/paddle.ts`, `PADDLE_CUSTOM_DATA_USER_ID` /
/// `PADDLE_CUSTOM_DATA_APP_ID`, read at `parseSubscription`). Those two strings
/// are our own contract with ourselves, and the client half is the checkout URL.
/// So the JSON-shaped query value below is not a hypothetical: it is the shape
/// the two halves have to meet in.
///
/// 🔴 NOTHING HERE CHANGES `rail_config.dart`. These tests describe what the
/// rail does today. Where the measurement found a limit, the limit is pinned and
/// named — changing the rail is a decision, not a test edit.
void main() {
  /// One value carrying every character that can break a query parameter: `&`
  /// ends it, `=` splits it, a space is illegal raw, and `+` is the nasty one —
  /// Dart's `Uri.queryParameters` decodes a bare `+` as a SPACE, so a `+` that
  /// survives as itself proves the value was percent-encoded rather than merely
  /// passed through.
  const String hostile = 'a&b=c d+e';

  /// A real-shaped account id with a `+` in it (the address-tag form a mail
  /// provider hands out, and a shape ids get built from).
  const String hostileAccount = 'usr_01J+aa bb&cc=dd';

  group('[5]M-7 · fill percent-encodes EVERY value it substitutes', () {
    test('all four placeholders fill, and every value round-trips exactly', () {
      final String? filled = RailConfig.fill(
        'https://pay.example.test/checkout'
        '?price={price_id}&app={app_id}&acct={account_id}&back={return_url}',
        appId: 'subly',
        priceId: hostile,
        accountId: hostileAccount,
        returnUrl: 'https://nikatru.com/checkout-return?x=1&y=2',
      );
      expect(filled, isNotNull);

      // No placeholder survives: a URL still carrying `{price_id}` is the
      // failure `fill` exists to prevent, and it would 404 for a real buyer.
      for (final String p in <String>[
        '{price_id}',
        '{app_id}',
        '{account_id}',
        '{return_url}',
      ]) {
        expect(filled, isNot(contains(p)), reason: '$p was not substituted');
      }

      // MEASURED, not assumed: the encoded form of the hostile value.
      expect(filled, contains('price=a%26b%3Dc%20d%2Be'));

      final Uri u = Uri.parse(filled!);
      expect(u.queryParameters['price'], hostile);
      expect(u.queryParameters['app'], 'subly');
      expect(u.queryParameters['acct'], hostileAccount);
      expect(
        u.queryParameters['back'],
        'https://nikatru.com/checkout-return?x=1&y=2',
      );

      // The `&` and `=` inside a value did not become new parameters. Without
      // the encoding this URL would carry `b`, `c d`, `y` and `e` as parameters
      // of its own and the account id would arrive truncated at the `&`.
      expect(u.queryParameters.keys.toSet(), <String>{
        'price',
        'app',
        'acct',
        'back',
      });
      expect(u.queryParametersAll['acct'], <String>[hostileAccount]);
    });

    test('a `+` survives as a `+` and not as a space', () {
      // The single most likely silent corruption: `+` is legal raw in a query
      // and decodes to a space, so an id containing one would arrive with a
      // space in it and match no account. Asserted on its own because the
      // round-trip above would still pass if `+` were dropped from `hostile`.
      final String? filled = RailConfig.fill(
        'https://pay.example.test/c?acct={account_id}',
        appId: 'a',
        priceId: 'p',
        accountId: 'usr+01J',
        returnUrl: 'https://nikatru.com/checkout-return',
      );
      expect(filled, contains('acct=usr%2B01J'));
      expect(Uri.parse(filled!).queryParameters['acct'], 'usr+01J');
    });

    test('the same placeholder used twice fills in both positions', () {
      expect(
        RailConfig.fill(
          'https://pay.example.test/c?a={app_id}&b={app_id}',
          appId: 'subly',
          priceId: 'p',
          accountId: 'u',
          returnUrl: 'r',
        ),
        'https://pay.example.test/c?a=subly&b=subly',
      );
    });

    test('a value substituted into the PATH cannot add a path segment', () {
      // `/` is encoded, so a price id containing one stays inside its own
      // segment instead of navigating somewhere else on the seller's host.
      final String? filled = RailConfig.fill(
        'https://pay.example.test/{app_id}/{price_id}',
        appId: 'subly',
        priceId: 'pro/monthly',
        accountId: 'u',
        returnUrl: 'r',
      );
      expect(filled, 'https://pay.example.test/subly/pro%2Fmonthly');
      expect(Uri.parse(filled!).pathSegments, <String>['subly', 'pro/monthly']);
    });
  });

  group('the `custom_data` shape the Worker reads — MEASURED, then pinned', () {
    /// The two keys `services/platform/src/lib/mor/paddle.ts` reads back off the
    /// notification. Written out here so a rename on the Worker side that does
    /// not reach the client half is a red test in this package too.
    const String userIdKey = 'nikatru_user_id';
    const String appIdKey = 'nikatru_app_id';

    test('a PRE-ENCODED custom_data template composes correctly — one decode '
        'yields valid JSON with the raw values inside', () {
      // The JSON's own punctuation is percent-encoded (as it would be in a URL
      // copied out of a console) and the placeholders sit BARE inside it:
      //   {"nikatru_user_id":"{account_id}","nikatru_app_id":"{app_id}"}
      const String template =
          'https://pay.example.test/checkout?items=1&custom_data='
          '%7B%22nikatru_user_id%22%3A%22{account_id}%22%2C'
          '%22nikatru_app_id%22%3A%22{app_id}%22%7D';

      final String? filled = RailConfig.fill(
        template,
        appId: 'subly',
        priceId: 'pro_monthly',
        accountId: hostileAccount,
        returnUrl: 'https://nikatru.com/checkout-return',
      );
      expect(filled, isNotNull);

      // 📌 THE MEASUREMENT. `fill` encodes each value EXACTLY ONCE, and the
      // template's structure is already encoded exactly once, so the two
      // layers agree: a single `Uri.queryParameters` decode recovers the JSON
      // *and* the raw values inside it. This is the answer the shape question
      // was asked for — the custom_data form IS expressible.
      final String? raw = Uri.parse(filled!).queryParameters['custom_data'];
      expect(raw, '{"$userIdKey":"$hostileAccount","$appIdKey":"subly"}');

      final Map<String, Object?> decoded =
          jsonDecode(raw!) as Map<String, Object?>;
      expect(decoded[userIdKey], hostileAccount);
      expect(decoded[appIdKey], 'subly');
    });

    test('a RAW-braces custom_data template also composes — Uri normalisation '
        'encodes the structure and the values are already encoded', () {
      // The same template as above, pasted UNENCODED: literal `{`, `"` and `,`
      // in the query. Measured because it is at least as likely a paste as the
      // encoded form, and the two could easily have behaved differently.
      const String template =
          'https://pay.example.test/checkout?custom_data='
          '{"nikatru_user_id":"{account_id}","nikatru_app_id":"{app_id}"}';

      // It survives the https-only gate: `Uri.tryParse` tolerates these
      // characters in a query, so the template is STORED rather than refused.
      final RailConfig c = RailConfig.fromPaywallExtra(<String, Object?>{
        'checkout_url_template': template,
        'offerings': <Object?>[
          <String, Object?>{
            'product_id': 'pro_monthly',
            'amount_minor': 499,
            'currency_code': 'USD',
            'term': 'month',
          },
        ],
      });
      expect(c.checkoutUrlTemplate, template);
      expect(c.canCheckout, isTrue);

      final String? filled = RailConfig.fill(
        c.checkoutUrlTemplate,
        appId: 'subly',
        priceId: 'pro_monthly',
        accountId: hostileAccount,
        returnUrl: 'https://nikatru.com/checkout-return',
      );
      // The braces and quotes are still LITERAL in the filled string — `fill`
      // is a string substitution and normalises nothing.
      expect(filled, contains('custom_data={"$userIdKey":"'));

      // `Uri.parse` then normalises them (`{`→`%7B`, `"`→`%22`) while leaving
      // `:` and `,` alone, and the values were already encoded by `fill`, so
      // the decode still yields exactly the same JSON as the encoded template.
      final Uri u = Uri.parse(filled!);
      final String? raw = u.queryParameters['custom_data'];
      expect(raw, '{"$userIdKey":"$hostileAccount","$appIdKey":"subly"}');
      expect(
        (jsonDecode(raw!) as Map<String, Object?>)[userIdKey],
        hostileAccount,
      );
    });

    test('🔴 THE LIMIT — a placeholder whose own BRACES are percent-encoded is '
        'never substituted, and the literal text ships to the buyer', () {
      // `%7Baccount_id%7D` is what a template becomes when it is run through a
      // URL encoder wholesale — a plausible copy path out of a console, and
      // one nothing in this package can distinguish from a template that
      // simply has no placeholders.
      const String template =
          'https://pay.example.test/checkout?custom_data='
          '%7B%22nikatru_user_id%22%3A%22%7Baccount_id%7D%22%7D';

      final String? filled = RailConfig.fill(
        template,
        appId: 'subly',
        priceId: 'pro_monthly',
        accountId: 'usr_01J',
        returnUrl: 'https://nikatru.com/checkout-return',
      );

      // PINNED AS-IS. `replaceAll` matches the literal `{account_id}` and this
      // template contains no such text, so it comes back UNCHANGED — the
      // checkout opens, the buyer pays, and the attribution arrives as the
      // seven-character string "{account_id}" instead of an account. The Worker
      // would then read a `nikatru_user_id` that resolves to nobody
      // (services/platform/src/lib/mor/paddle.ts, `accountUserId`).
      expect(filled, template);
      final String? raw = Uri.parse(filled!).queryParameters['custom_data'];
      expect(raw, '{"$userIdKey":"{account_id}"}');
      expect(
        (jsonDecode(raw!) as Map<String, Object?>)[userIdKey],
        '{account_id}',
      );
      // 📌 THE RULE THIS PINS, for whoever pastes the real template:
      //    the JSON's punctuation may be encoded or not, but the FOUR
      //    placeholders must appear with LITERAL braces. `%7B…%7D` is silent.
    });

    test('a placeholder this package does not define is left verbatim', () {
      // Same class as the encoded-brace case and the same silence: `fill`
      // knows four names and passes everything else through. A template
      // needing `{customer_email}` would ship that text to the seller.
      final String? filled = RailConfig.fill(
        'https://pay.example.test/c?u={account_id}&e={customer_email}',
        appId: 'subly',
        priceId: 'pro',
        accountId: 'usr_01J',
        returnUrl: 'https://nikatru.com/checkout-return',
      );
      expect(filled, 'https://pay.example.test/c?u=usr_01J&e={customer_email}');
    });
  });

  group('🔒 https-and-absolute-host, or the template is refused', () {
    // A template is a string from a config document served over the network and
    // it ends up in a platform `launchUrl` call — an instruction to the
    // operating system. The refusal happens in RailConfig, so no call site has
    // to remember. Asserted here on BOTH templates: `manage_url_template` gets
    // the identical treatment and is launched by the same kind of call, and
    // nothing else in this package's tests covers it.
    const List<String> refused = <String>[
      'javascript:alert(1)',
      'file:///etc/passwd',
      'intent://evil#Intent;scheme=http;end',
      'data:text/html,<script>alert(1)</script>',
      'http://pay.example.test/x', // downgraded scheme
      'HTTP://pay.example.test/x',
      '//pay.example.test/x', // scheme-relative
      '/relative/path',
      'checkout.html',
      'https:///no-host',
      'https://', // no host, nothing else either
      '',
    ];

    for (final String hostile in refused) {
      test('${hostile.isEmpty ? '<empty string>' : hostile} is refused', () {
        final RailConfig c = RailConfig.fromPaywallExtra(<String, Object?>{
          'checkout_url_template': hostile,
          'manage_url_template': hostile,
          'offerings': <Object?>[
            <String, Object?>{
              'product_id': 'pro_monthly',
              'amount_minor': 499,
              'currency_code': 'USD',
              'term': 'month',
            },
          ],
        });
        expect(c.checkoutUrlTemplate, isNull);
        expect(c.manageUrlTemplate, isNull);
        // A refused template is a rail that cannot sell, which is the same
        // state as a rail nobody configured — and the paywall says so.
        expect(c.canCheckout, isFalse);
      });
    }

    test('a non-string template is refused rather than stringified', () {
      for (final Object? v in <Object?>[
        42,
        true,
        <String>['https://x.test/'],
        null,
      ]) {
        final RailConfig c = RailConfig.fromPaywallExtra(<String, Object?>{
          'checkout_url_template': v,
          'manage_url_template': v,
        });
        expect(c.checkoutUrlTemplate, isNull, reason: 'for $v');
        expect(c.manageUrlTemplate, isNull, reason: 'for $v');
      }
    });

    test('BOTH templates are accepted when both are absolute https', () {
      // The negative case for the whole group: without this, a `_url` that
      // returned null unconditionally would pass every test above.
      final RailConfig c = RailConfig.fromPaywallExtra(<String, Object?>{
        'checkout_url_template':
            'https://pay.example.test/checkout?price={price_id}&acct={account_id}',
        'manage_url_template':
            'https://pay.example.test/manage?acct={account_id}',
        'offerings': <Object?>[
          <String, Object?>{
            'product_id': 'pro_monthly',
            'amount_minor': 499,
            'currency_code': 'USD',
            'term': 'month',
          },
        ],
      });
      expect(c.checkoutUrlTemplate, isNotNull);
      expect(c.manageUrlTemplate, isNotNull);
      expect(c.canCheckout, isTrue);

      // And the manage template fills through the same function, with the same
      // encoding, so the cancel flow's second half cannot be broken by an id
      // that would have been fine on the checkout half.
      final String? manage = RailConfig.fill(
        c.manageUrlTemplate,
        appId: 'subly',
        priceId: 'pro_monthly',
        accountId: hostileAccount,
        returnUrl: 'https://nikatru.com/checkout-return',
      );
      expect(Uri.parse(manage!).queryParameters['acct'], hostileAccount);
    });

    test('an uppercase scheme is accepted — schemes are case-insensitive', () {
      // MEASURED: `Uri.parse` lowercases the scheme, so the guard compares
      // 'https' and passes, and the ORIGINAL casing is what gets stored. Pinned
      // because it looks like a hole and is not one; a future "tighten the
      // scheme check" pass that starts refusing this would be rejecting a URL
      // the operating system opens perfectly well.
      final RailConfig c = RailConfig.fromPaywallExtra(<String, Object?>{
        'checkout_url_template': 'HTTPS://pay.example.test/x?p={price_id}',
        'offerings': <Object?>[
          <String, Object?>{
            'product_id': 'pro_monthly',
            'amount_minor': 499,
            'currency_code': 'USD',
            'term': 'month',
          },
        ],
      });
      expect(c.checkoutUrlTemplate, 'HTTPS://pay.example.test/x?p={price_id}');
      expect(c.canCheckout, isTrue);
    });
  });
}
