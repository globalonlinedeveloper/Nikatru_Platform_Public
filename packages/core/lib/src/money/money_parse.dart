import 'package:intl/intl.dart' show NumberFormat;

import 'money.dart';

/// What a person TYPES into an amount field, read as [Money] — in their
/// locale's own separators, with or without a currency sign.
///
/// 🔴 NOT [Money.tryParseMajor], ON PURPOSE, AND THAT ONE STAYS STRICT.
/// `tryParseMajor` refuses `1,299` because a parser that guesses at a
/// separator will one day guess wrong about somebody's money. This one does
/// not guess: it reads the separators the LOCALE declares (intl's number
/// symbols), so `1,299` is one thousand two hundred and ninety-nine in `en`,
/// `12,99` is twelve euros ninety-nine in `de`, and the only input it accepts
/// is one that means exactly one amount there. Anything else is null — the
/// field shows an error rather than a number the user did not type.
///
/// Refused, each for a reason a person would recognise:
///   · empty, or no digits at all;
///   · negative (`-5`) — a subscription charge is not a refund;
///   · two decimal separators, or a group separator after the decimal one;
///   · more fraction digits than the currency has (`9.999` dollars, `5.5` yen).
abstract final class MoneyParser {
  /// [text] in [localeName]'s separators, as [currencyCode] money, or null.
  static Money? parse(
    String text, {
    required String currencyCode,
    required String localeName,
  }) {
    final String decimal;
    final String group;
    try {
      final NumberFormat f = NumberFormat.decimalPattern(localeName);
      decimal = f.symbols.DECIMAL_SEP;
      group = f.symbols.GROUP_SEP;
    } on Object {
      return parse(text, currencyCode: currencyCode, localeName: 'en_US');
    }
    // Drop everything that is not a digit or a separator: currency signs and
    // codes (₹, $, INR), spaces, and the narrow no-break space some locales
    // group with. A minus sign is looked for FIRST, so it cannot be dropped.
    final String trimmed = text.trim();
    if (trimmed.isEmpty || trimmed.contains('-') || trimmed.contains('−')) {
      return null;
    }
    final StringBuffer kept = StringBuffer();
    for (final int rune in trimmed.runes) {
      final String ch = String.fromCharCode(rune);
      final bool digit = rune >= 0x30 && rune <= 0x39;
      if (digit || ch == decimal || ch == group) kept.write(ch);
    }
    final String s = kept.toString();
    if (!s.contains(RegExp('[0-9]'))) return null;
    final List<String> parts = s.split(decimal);
    if (parts.length > 2) return null;
    final String whole = parts[0].replaceAll(group, '');
    final String fraction = parts.length == 2 ? parts[1] : '';
    if (fraction.contains(group)) return null;
    if (whole.isEmpty && fraction.isEmpty) return null;
    final int digits = Money.minorUnitDigitsFor(currencyCode);
    if (fraction.length > digits) return null;
    final int wholeUnits = whole.isEmpty ? 0 : int.parse(whole);
    final int minor =
        wholeUnits * Money.pow10(digits) +
        (fraction.isEmpty ? 0 : int.parse(fraction.padRight(digits, '0')));
    return Money(minor, currencyCode);
  }
}
