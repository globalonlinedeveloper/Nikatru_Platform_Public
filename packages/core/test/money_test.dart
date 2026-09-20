import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

void main() {
  group('Money — integer minor units', () {
    test('stores the smallest unit, not a decimal', () {
      const Money m = Money(1549, 'USD');
      expect(m.minorUnits, 1549);
      expect(m.currencyCode, 'USD');
      expect(m.minorUnitDigits, 2);
    });

    test('minor-unit digits are per currency, not a hardcoded two', () {
      // ISO 4217 is not uniform. A blanket division by 100 misprices a yen
      // plan by a factor of a hundred, which is the defect the table exists
      // to prevent.
      expect(Money.minorUnitDigitsFor('JPY'), 0);
      expect(Money.minorUnitDigitsFor('KWD'), 3);
      expect(Money.minorUnitDigitsFor('USD'), 2);
      expect(Money.minorUnitDigitsFor('ZZZ'), 2);
      expect(const Money(500, 'JPY').plainFormat(), '¥500');
      expect(const Money(500, 'KWD').plainFormat(), 'KWD 0.500');
    });

    test('an unknown code renders as the CODE, never a guessed symbol', () {
      expect(Money.symbolFor('ZZZ'), isNull);
      expect(const Money(499, 'ZZZ').plainFormat(), 'ZZZ 4.99');
    });

    test('fromMajorUnits rounds to the currency precision, never truncates',
        () {
      // 15.49 * 100 is 1548.9999999999998 in binary floating point. Truncation
      // would lose a cent on every single import.
      expect(Money.fromMajorUnits(15.49, 'USD').minorUnits, 1549);
      expect(Money.fromMajorUnits(2.99, 'USD').minorUnits, 299);
      expect(Money.fromMajorUnits(0.1, 'USD').minorUnits, 10);
      expect(Money.fromMajorUnits(499, 'JPY').minorUnits, 499);
      expect(Money.fromMajorUnits(1.005, 'KWD').minorUnits, 1005);
    });

    test('a fold of a tenth ten times is EXACT, which a double is not', () {
      // The property that a double cannot have. 0.1 summed ten times is
      // 0.9999999999999999 as a double; here it is exactly one unit.
      Money running = const Money.zero('USD');
      for (int i = 0; i < 10; i++) {
        running += Money.fromMajorUnits(0.1, 'USD');
      }
      expect(running, const Money(100, 'USD'));
      expect(running.toMajorUnits(), 1.0);
    });

    test(
        'tryParseMajor takes what a user types, and refuses what it cannot '
        'read rather than guessing', () {
      expect(Money.tryParseMajor('12.5', 'USD'), const Money(1250, 'USD'));
      expect(Money.tryParseMajor('  499 ', 'INR'), const Money(49900, 'INR'));
      expect(Money.tryParseMajor('', 'USD'), isNull);
      expect(Money.tryParseMajor('abc', 'USD'), isNull);
      // A grouped number is ambiguous across locales, so it is REFUSED.
      expect(Money.tryParseMajor('1,234', 'USD'), isNull);
    });
  });

  group('Money — unlike currencies are unlike units', () {
    test('adding two currencies THROWS instead of producing a number', () {
      expect(
        () => const Money(1000, 'USD') + const Money(49900, 'INR'),
        throwsA(isA<CurrencyMismatchError>()),
      );
      expect(
        () => const Money(1000, 'USD') - const Money(49900, 'INR'),
        throwsA(isA<CurrencyMismatchError>()),
      );
      expect(
        () => const Money(1000, 'USD').compareTo(const Money(1, 'INR')),
        throwsA(isA<CurrencyMismatchError>()),
      );
    });

    test('the same currency adds, subtracts and orders normally', () {
      expect(
        const Money(1000, 'USD') + const Money(549, 'USD'),
        const Money(1549, 'USD'),
      );
      expect(
        const Money(1000, 'USD') - const Money(549, 'USD'),
        const Money(451, 'USD'),
      );
      expect(const Money(1000, 'USD') > const Money(549, 'USD'), isTrue);
      expect(const Money(1000, 'USD').times(12), const Money(12000, 'USD'));
      expect((-const Money(1000, 'USD')).minorUnits, -1000);
    });

    test('equality is by AMOUNT AND CODE, so 100 USD is not 100 INR', () {
      expect(const Money(100, 'USD'), isNot(const Money(100, 'INR')));
      expect(const Money(100, 'USD'), const Money(100, 'USD'));
      expect(
        const Money(100, 'USD').hashCode,
        const Money(100, 'USD').hashCode,
      );
    });

    test('there is no multiply-by-a-rate, and clampAtZero keeps the code', () {
      expect(const Money(-500, 'INR').clampAtZero(), const Money.zero('INR'));
      expect(const Money(500, 'INR').clampAtZero(), const Money(500, 'INR'));
    });
  });

  group('Money — division rounds half away from zero', () {
    test('a yearly charge normalises to a monthly share', () {
      expect(const Money(12000, 'USD').dividedBy(12), const Money(1000, 'USD'));
      expect(const Money(10000, 'USD').dividedBy(12), const Money(833, 'USD'));
      expect(const Money(1549, 'USD').dividedBy(12), const Money(129, 'USD'));
    });

    test('an exact half rounds AWAY from zero in both directions', () {
      expect(const Money(5, 'USD').dividedBy(2), const Money(3, 'USD'));
      expect(const Money(-5, 'USD').dividedBy(2), const Money(-3, 'USD'));
      expect(const Money(-7, 'USD').dividedBy(2), const Money(-4, 'USD'));
    });

    test('dividing by zero is refused, not silently infinite', () {
      expect(
        () => const Money(100, 'USD').dividedBy(0),
        throwsA(isA<ArgumentError>()),
      );
    });
  });

  group('Money — the wire shape', () {
    test('round-trips through json as an INTEGER plus a code', () {
      const Money m = Money(49900, 'INR');
      expect(m.toJson(), <String, Object?>{
        'minor_units': 49900,
        'currency': 'INR',
      });
      expect(Money.tryFromJson(m.toJson()), m);
    });

    test(
        'a JSON DOUBLE is refused, because 4.99 where 499 was meant would '
        'silently become five paise', () {
      expect(
        Money.tryFromJson(<String, Object?>{
          'minor_units': 4.99,
          'currency': 'USD',
        }),
        isNull,
      );
      expect(
        Money.tryFromJson(<String, Object?>{
          'minor_units': 499,
          'currency': 'DOLLARS',
        }),
        isNull,
      );
      expect(Money.tryFromJson(null), isNull);
      expect(Money.tryFromJson('499'), isNull);
    });

    test('a lower-case code is normalised, not rejected', () {
      expect(
        Money.tryFromJson(<String, Object?>{
          'minor_units': 499,
          'currency': 'inr',
        }),
        const Money(499, 'INR'),
      );
    });
  });

  group('MoneyBag — a total over unlike units', () {
    test('one currency behaves exactly like an ordinary total', () {
      final MoneyBag bag = MoneyBag.sum(const <Money>[
        Money(1549, 'USD'),
        Money(1199, 'USD'),
      ]);
      expect(bag.isMixed, isFalse);
      expect(bag.single, const Money(2748, 'USD'));
    });

    test('two currencies stay SEPARATE and are never merged', () {
      final MoneyBag bag = MoneyBag.sum(const <Money>[
        Money(1549, 'USD'),
        Money(49900, 'INR'),
        Money(1199, 'USD'),
      ]);
      expect(bag.isMixed, isTrue);
      expect(bag.byCurrency['USD'], const Money(2748, 'USD'));
      expect(bag.byCurrency['INR'], const Money(49900, 'INR'));
      // The whole point: there is no single number to hand a caller, and
      // asking for one FAILS rather than inventing a converted figure.
      expect(() => bag.single, throwsA(isA<StateError>()));
    });

    test('insertion order is preserved so the leading currency is stable', () {
      final MoneyBag bag = MoneyBag.sum(const <Money>[
        Money(49900, 'INR'),
        Money(1549, 'USD'),
      ]);
      expect(bag.byCurrency.keys.toList(), <String>['INR', 'USD']);
    });

    test('an empty bag in a named currency is a zero, not a throw', () {
      final MoneyBag bag = MoneyBag.zero('GBP');
      expect(bag.isMixed, isFalse);
      expect(bag.single, const Money.zero('GBP'));
      expect(MoneyBag.sum(const <Money>[]).isEmpty, isTrue);
      expect(
        MoneyBag.sum(const <Money>[]).inCurrency('GBP'),
        const Money.zero('GBP'),
      );
    });

    test('times multiplies every subtotal, keeping them apart', () {
      final MoneyBag year = MoneyBag.sum(const <Money>[
        Money(1000, 'USD'),
        Money(49900, 'INR'),
      ]).times(12);
      expect(year.byCurrency['USD'], const Money(12000, 'USD'));
      expect(year.byCurrency['INR'], const Money(598800, 'INR'));
    });
  });

  group('Money — whole major units, the unit a compact figure is printed in', () {
    test('rounds half AWAY FROM ZERO, which is what intl prints', () {
      // Measured against `NumberFormat.currency(decimalDigits: 0)` under en_US
      // on 2026-09-20: 92.50 -> $93, 0.50 -> $1, 2.50 -> $3, -92.50 -> -$93.
      // The last two are the ones a half-to-even rule would have got wrong, and
      // they are here because `MoneyBag.apportionRounded` picks a total with
      // this rule and the formatter then has to agree with it.
      expect(const Money(9250, 'USD').wholeUnits, 93);
      expect(const Money(9249, 'USD').wholeUnits, 92);
      expect(const Money(50, 'USD').wholeUnits, 1);
      expect(const Money(250, 'USD').wholeUnits, 3);
      expect(const Money(-9250, 'USD').wholeUnits, -93);
      expect(const Money(-9350, 'USD').wholeUnits, -94);
    });

    test('follows the CURRENCY, not a hardcoded hundred', () {
      // The yen's minor unit is the yen, so its whole-unit count is itself; a
      // division by 100 here would misprice a yen plan by a factor of a hundred.
      expect(const Money(2430, 'JPY').wholeUnits, 2430);
      expect(const Money(2500, 'KWD').wholeUnits, 3);
    });

    test('fromWholeUnits is the inverse and carries no fraction', () {
      expect(Money.fromWholeUnits(93, 'USD'), const Money(9300, 'USD'));
      expect(Money.fromWholeUnits(2430, 'JPY'), const Money(2430, 'JPY'));
      expect(Money.fromWholeUnits(-94, 'USD').wholeUnits, -94);
      // The property the apportioning rests on: a value built this way is
      // already whole, so displaying it makes no second rounding decision.
      expect(Money.fromWholeUnits(41, 'USD').minorUnits % 100, 0);
    });
  });
}
