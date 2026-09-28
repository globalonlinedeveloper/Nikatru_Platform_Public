import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// `Money.parseLocalized` — the import-file reader beside the strict
/// `tryParseMajor`. Each case is a cell a real export writes.
void main() {
  void reads(String text, String code, int minor) {
    expect(
      Money.parseLocalized(text, code),
      Money(minor, code),
      reason: '"$text" in $code',
    );
  }

  test('a comma followed by three digits is a thousands separator', () {
    reads('1,299', 'INR', 129900);
    reads('12,345,678', 'USD', 1234567800);
  });

  test('any other lone comma is the decimal separator', () {
    reads('12,99', 'EUR', 1299);
    reads('0,500', 'EUR', 50);
    reads('9,5', 'EUR', 950);
  });

  test('with both separators the LAST one is the decimal', () {
    reads('1.299,50', 'EUR', 129950);
    reads('1,299.50', 'USD', 129950);
    reads('1.234.567,89', 'EUR', 123456789);
  });

  test('Indian 2-2-3 grouping', () {
    reads('1,25,000', 'INR', 12500000);
    reads('12,50,000.75', 'INR', 125000075);
  });

  test('symbols and codes are stripped, spaces trimmed', () {
    reads('₹649', 'INR', 64900);
    reads(r'$9.99', 'USD', 999);
    reads('Rs. 649', 'INR', 64900);
    // `Rs` is the rupee FAMILY, not India's alone: a Pakistani export reads.
    reads('Rs 1,500', 'PKR', 150000);
    reads('rs 649', 'INR', 64900);
    reads('INR 649', 'INR', 64900);
    reads('649 INR', 'INR', 64900);
    reads('€ 12,99', 'EUR', 1299);
    reads('12,99 €', 'EUR', 1299);
    reads('  £4.99  ', 'GBP', 499);
    reads(r'A$15.00', 'AUD', 1500);
    reads('1 299,50', 'EUR', 129950);
    reads('¥1,200', 'JPY', 1200);
  });

  test('a code or owned symbol of ANOTHER currency is refused, not relabelled',
      () {
    expect(Money.parseLocalized('EUR 12,99', 'INR'), isNull);
    expect(Money.parseLocalized('€12,99', 'INR'), isNull);
    expect(Money.parseLocalized('₹649', 'USD'), isNull);
  });

  test('rounding is the currency\'s own, via fromMajorUnits', () {
    reads('15.49', 'USD', 1549);
    reads('1200', 'JPY', 1200);
    reads('0.500', 'KWD', 500);
    reads('-2.50', 'USD', -250);
  });

  test('garbage and empty are null', () {
    for (final String bad in <String>[
      '',
      '   ',
      'abc',
      'free',
      '12abc',
      '1,2,3',
      '1..2',
      '12,',
      '₹',
      '1,299,50.00.1',
      '1.2.3,4',
    ]) {
      expect(Money.parseLocalized(bad, 'INR'), isNull, reason: '"$bad"');
    }
  });

  test('tryParseMajor stays strict — the two are different contracts', () {
    expect(Money.tryParseMajor('1,299', 'INR'), isNull);
    expect(Money.tryParseMajor('₹649', 'INR'), isNull);
    expect(Money.tryParseMajor('649', 'INR'), const Money(64900, 'INR'));
  });
}
