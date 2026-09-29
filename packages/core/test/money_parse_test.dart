import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// ST-E2 (ST-T3b): the add sheet's price field reads what a person types in
/// THEIR locale. Each case is one the strict `Money.tryParseMajor` refuses or
/// misreads, which is why the sheet silently fell back to 9.99 before.
void main() {
  Money? parse(String t, String code, String locale) =>
      MoneyParser.parse(t, currencyCode: code, localeName: locale);

  test('the three the brief names parse EXACTLY', () {
    expect(parse('1,299', 'USD', 'en'), const Money(129900, 'USD'));
    expect(parse('₹649', 'INR', 'en_IN'), const Money(64900, 'INR'));
    expect(parse('12,99', 'EUR', 'de'), const Money(1299, 'EUR'));
  });

  test('ordinary input still parses', () {
    expect(parse('9.99', 'USD', 'en'), const Money(999, 'USD'));
    expect(parse(' 15 ', 'USD', 'en'), const Money(1500, 'USD'));
    expect(parse(r'$4.5', 'USD', 'en_US'), const Money(450, 'USD'));
    expect(parse('1.299,50', 'EUR', 'de'), const Money(129950, 'EUR'));
    expect(parse('1,49,900', 'INR', 'en_IN'), const Money(14990000, 'INR'));
    expect(parse('500', 'JPY', 'ja'), const Money(500, 'JPY'));
  });

  test('refuses what does not mean one amount', () {
    expect(parse('', 'USD', 'en'), isNull);
    expect(parse('   ', 'USD', 'en'), isNull);
    expect(
      parse('-5', 'USD', 'en'),
      isNull,
      reason: 'a charge is not a refund',
    );
    expect(parse('abc', 'USD', 'en'), isNull);
    expect(parse('1.2.3', 'USD', 'en'), isNull);
    expect(parse('9.999', 'USD', 'en'), isNull, reason: 'three decimals');
    expect(
      parse('5.5', 'JPY', 'ja'),
      isNull,
      reason: 'the yen has no minor unit',
    );
    expect(parse('12.99', 'EUR', 'de'), isNot(const Money(1299, 'EUR')));
  });
}
