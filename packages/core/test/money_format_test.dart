// MoneyFormatter, tested in the package that owns it. The cases are the ones
// apps/subscriptiontracker/test/logic_test.dart has carried since the formatter
// replaced the en_US-hardcoded one; they stay there too, where they now
// exercise the app's re-export path.
import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

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

  // ───────────────────────────────────────────────────────────────────────────
  // A BREAKDOWN: THE PARTS A READER ADDS UP GIVE THE TOTAL THEY ARE SHOWN.
  //
  // 🔴 EVERY ASSERTION BELOW IS ON THE RENDERED STRINGS, PARSED BACK, and that
  // is the point rather than fussiness. The minor units always summed exactly —
  // there was never an arithmetic error to catch — so a test that compares
  // `Money` values passes against the defect. The contradiction only exists in
  // what a reader can see, so only what a reader can see can falsify it.
  // Source: the Play listing capture of 2026-09-20, an insights donut reading
  // $93 in the centre beside a legend reading 39 + 20 + 16 + 11 + 5 + 3.
  // ───────────────────────────────────────────────────────────────────────────
  group('formatBreakdownRounded — the column adds up to the centre', () {
    const MoneyFormatter f = MoneyFormatter('en_US');

    /// Six categories whose per-part rounding is EACH a rounding DOWN, so the
    /// fractions they throw away add up to three whole dollars. Naively
    /// rendered these print 39 + 20 + 16 + 11 + 5 + 3 = 94 against a whole that
    /// prints 97 — the defect, three dollars wide so no assertion can pass by
    /// accident on a one-cent tolerance.
    final List<MoneyBag> lossy = <MoneyBag>[
      for (final int cents in <int>[3949, 2020, 1649, 1149, 549, 349])
        MoneyBag.sum(<Money>[Money(cents, 'USD')]),
    ];

    test('the naive rendering really does disagree — the control', () {
      // Without this, every assertion below could be true of an input that was
      // never broken, and the whole group would be measuring nothing.
      final int naive = lossy
          .map((MoneyBag b) => unitsOf(f.formatBagRounded(b))[r'$']!)
          .reduce((int a, int b) => a + b);
      final MoneyBag fold = MoneyBag.sum(<Money>[
        for (final MoneyBag b in lossy) ...b.amounts,
      ]);
      expect(naive, 94);
      expect(unitsOf(f.formatBagRounded(fold))[r'$'], 97);
    });

    test('the apportioned parts sum to the total, as rendered', () {
      final ({List<String> parts, String total}) shown = f
          .formatBreakdownRounded(lossy);
      final int summed = shown.parts
          .map((String s) => unitsOf(s)[r'$']!)
          .reduce((int a, int b) => a + b);
      expect(
        summed,
        unitsOf(shown.total)[r'$'],
        reason:
            'a reader who adds ${shown.parts} must get ${shown.total} — this is '
            'the whole property',
      );
      // Largest remainder, ties by position: the three spare dollars go to the
      // three earliest parts that lost .49, not to the one that lost .20.
      expect(shown.parts, <String>[
        r'$40',
        r'$20',
        r'$17',
        r'$12',
        r'$5',
        r'$3',
      ]);
      expect(shown.total, r'$97');
    });

    test('the WHOLE does not move — only the parts do', () {
      // The fix must not change a figure the app is trusted on today. It does
      // not, because Money.wholeUnits and intl agree on half away from zero.
      final MoneyBag fold = MoneyBag.sum(<Money>[
        for (final MoneyBag b in lossy) ...b.amounts,
      ]);
      expect(f.formatBreakdownRounded(lossy).total, f.formatBagRounded(fold));
    });

    test('no part moves by a whole unit from its own exact value', () {
      final ({List<String> parts, String total}) shown = f
          .formatBreakdownRounded(lossy);
      for (int i = 0; i < lossy.length; i++) {
        final int exact = lossy[i].single.minorUnits;
        final int shownCents = unitsOf(shown.parts[i])[r'$']! * 100;
        expect(
          (shownCents - exact).abs(),
          lessThan(100),
          reason:
              'apportioning may settle a remainder, never restate a category as '
              'a different amount of money',
        );
      }
    });

    test(
      'MIXED CURRENCIES are apportioned separately, and nothing converts',
      () {
        // 🔴 THE TRAP. A remainder in paise settled with a cent would be a rate
        // table by the back door. Each currency is apportioned against its own
        // total: the dollars are short a unit, the rupees are not.
        final List<MoneyBag> parts = <MoneyBag>[
          MoneyBag.sum(const <Money>[Money(1060, 'USD'), Money(50050, 'INR')]),
          MoneyBag.sum(const <Money>[Money(1060, 'USD')]),
          MoneyBag.sum(const <Money>[Money(49900, 'INR')]),
        ];
        final ({List<String> parts, String total}) shown = f
            .formatBreakdownRounded(parts);
        expect(shown.total, r'$21 + ₹1,000');
        // 10.60 + 10.60 = 21.20 -> $21, so one of the two 11s comes back to 10.
        expect(shown.parts, <String>[r'$11 + ₹501', r'$10', '₹499']);
        int dollars = 0;
        int rupees = 0;
        for (final String part in shown.parts) {
          dollars += unitsOf(part)[r'$'] ?? 0;
          rupees += unitsOf(part)['₹'] ?? 0;
        }
        expect(dollars, unitsOf(shown.total)[r'$']);
        expect(rupees, unitsOf(shown.total)['₹']);
      },
    );

    test('a part holding no amount in a currency does not gain a zero', () {
      // `$10` must not become `$10 + ₹0`: a bag's currency set is a statement
      // about what the user holds, and apportioning is not allowed to add to it.
      final ({List<String> parts, String total}) shown = f
          .formatBreakdownRounded(<MoneyBag>[
            MoneyBag.sum(const <Money>[Money(1000, 'USD')]),
            MoneyBag.sum(const <Money>[Money(49900, 'INR')]),
          ]);
      expect(shown.parts, <String>[r'$10', '₹499']);
    });

    test('a ZERO-DECIMAL currency has no remainder to settle', () {
      // The yen's minor unit IS the yen, so every part is already whole and
      // apportionment must be a no-op rather than a rounding of something.
      final ({List<String> parts, String total}) shown = f
          .formatBreakdownRounded(<MoneyBag>[
            MoneyBag.sum(const <Money>[Money(980, 'JPY')]),
            MoneyBag.sum(const <Money>[Money(1450, 'JPY')]),
          ]);
      expect(shown.parts, <String>['¥980', '¥1,450']);
      expect(shown.total, '¥2,430');
    });

    test('NO parts reads as an empty total, in the named currency', () {
      final ({List<String> parts, String total}) shown = const MoneyFormatter(
        'en_US',
        emptyCurrencyCode: 'INR',
      ).formatBreakdownRounded(const <MoneyBag>[]);
      expect(shown.parts, isEmpty);
      expect(shown.total, '₹0');
    });
  });
}

/// The whole-unit number in each subtotal of a rendered figure, keyed by the
/// symbol it was printed under. `$40 + ₹499` → `{'$': 40, '₹': 499}`.
///
/// Parsing the OUTPUT back is deliberate: the property under test is about what
/// a reader can add up, and a reader adds up glyphs.
Map<String, int> unitsOf(String figure) {
  final Map<String, int> out = <String, int>{};
  for (final String piece in figure.split(MoneyFormatter.mixedJoiner)) {
    final String digits = piece.replaceAll(RegExp('[^0-9]'), '');
    final String symbol = plain(piece).replaceAll(RegExp('[-0-9,. ]'), '');
    out[symbol] = int.parse(digits) * (piece.startsWith('-') ? -1 : 1);
  }
  return out;
}
