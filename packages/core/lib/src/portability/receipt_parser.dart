import 'dart:convert';

import '../money/money.dart';
import 'column_mapping.dart';
import 'csv_reader.dart';
import 'import_plan.dart';

/// What one pasted or shared receipt says, read on the device (ST-X3).
///
/// Every value is TEXT AS THE RECEIPT WROTE IT (a month-name date excepted,
/// which is rewritten as `yyyy-mm-dd` because the month name already settles
/// the order). Typing is [ImportPlan]'s job, so a receipt is parsed by exactly
/// the rules a CSV row is: the same money reader, the same refusal to guess a
/// day/month order, the same "never a silent drop".
class ReceiptReading {
  const ReceiptReading({
    this.seller,
    this.amount,
    this.currencyCode,
    this.date,
    this.period,
    this.amounts = const <String>[],
  });

  /// Who was paid: a labelled line (`Merchant: …`, `Sold by …`), else the
  /// first line that is neither a title, an amount nor a date.
  final String? seller;

  /// The amount charged, its currency marker kept so `Money.parseLocalized`
  /// can refuse a mismatch. Null when the receipt does not say which of its
  /// amounts was charged — the user picks from [amounts], it is never guessed.
  final String? amount;

  /// An ISO 4217 code, only when the receipt names one unambiguously: a code,
  /// or a symbol one currency owns (`₹`, `€`, `A$`, `C$`, `US$`). `$`, `£`,
  /// `¥` and `Rs` are written for several currencies and name none.
  final String? currencyCode;

  /// `yyyy-mm-dd`, or a slash date as written (whose order the plan asks).
  final String? date;

  /// `monthly` or `yearly`, when the receipt says which and only one.
  final String? period;

  /// Every amount seen, in receipt order, for a review screen to offer.
  final List<String> amounts;
}

/// Which of the caller's [ImportField] ids each part of a receipt feeds. The
/// ids are the app's: core names none of them.
class ReceiptFieldIds {
  const ReceiptFieldIds({
    required this.seller,
    required this.amount,
    this.currency,
    this.date,
    this.period,
  });

  /// A text field.
  final String seller;

  /// A money field. When [currency] is set, it must be this field's
  /// [ImportField.currencyFieldId].
  final String amount;

  /// A currency-code field, or null to price every receipt in the plan's
  /// default currency.
  final String? currency;

  /// A date field, or null to drop the receipt's date.
  final String? date;

  /// A choice field whose choices answer to `monthly` and `yearly`, or null.
  final String? period;
}

/// Reads receipt text — an email, an SMS, a pasted page, and later the text
/// OCR finds in a photo — into an [ImportPlan] of ONE row (ST-X3).
///
/// 🔴 ON-DEVICE AND REVIEW-BEFORE-SAVE. Nothing here touches a network or a
/// store: the output is a plan, and the caller shows its candidate for the
/// user to confirm, exactly as a CSV import does. A receipt the parser cannot
/// read ends as a row ERROR naming the field, never as a silent nothing.
abstract final class ReceiptParser {
  /// Reads [text]. [currencyCodes] are the three-letter words accepted as a
  /// currency beside an amount; the default is every code core can print, so
  /// `GST 98.82` is not read as a currency called GST.
  static ReceiptReading read(String text, {Iterable<String>? currencyCodes}) {
    final Set<String> codes = (currencyCodes ?? Money.symbols.keys)
        .map((String c) => c.toUpperCase())
        .toSet();
    final List<String> lines = const LineSplitter()
        .convert(text)
        .map((String l) => l.trim())
        .where((String l) => l.isNotEmpty)
        .toList();

    String? seller;
    String? firstDate;
    String? keyedDate;
    final List<_Amount> amounts = <_Amount>[];
    final Set<String> periods = <String>{};

    for (int i = 0; i < lines.length; i++) {
      final String line = lines[i];
      final String lower = line.toLowerCase();

      // Dates first, and blanked out, so `12.09.2026` is not read as money.
      String rest = line;
      final List<String> dates = <String>[];
      for (final _DateShape shape in _dateShapes) {
        rest = rest.replaceAllMapped(shape.pattern, (Match m) {
          final String? d = shape.read(m);
          if (d != null) dates.add(d);
          return ' ';
        });
      }
      if (dates.isNotEmpty) {
        firstDate ??= dates.first;
        if (keyedDate == null && _dateKey.hasMatch(lower)) {
          keyedDate = dates.first;
        }
      }

      if (_monthly.hasMatch(lower)) periods.add('monthly');
      if (_yearly.hasMatch(lower)) periods.add('yearly');

      final RegExpMatch? label = _sellerLabel.firstMatch(line);
      if (seller == null && label != null) {
        seller = label.group(1)!.trim();
        continue;
      }

      final int rank = _rankOf(lower);
      for (final RegExpMatch m in _amount.allMatches(rest)) {
        final _Amount? a = _Amount.of(m, codes, rank: rank);
        if (a != null) amounts.add(a);
      }
    }

    // The seller when no line is labelled: the first plain line.
    if (seller == null) {
      for (final String line in lines) {
        final String lower = line.toLowerCase();
        if (_title.hasMatch(lower)) continue;
        if (!RegExp(r'\p{L}{2,}', unicode: true).hasMatch(line)) continue;
        if (_amount
            .allMatches(line)
            .any(
              (RegExpMatch m) =>
                  m.namedGroup('pre') != null || m.namedGroup('post') != null,
            )) {
          continue;
        }
        if (_dateShapes.any((_DateShape s) => s.pattern.hasMatch(line))) {
          continue;
        }
        if (_rankOf(lower) != 0) continue;
        seller = line;
        break;
      }
    }

    final _Amount? charged = _charged(amounts);
    final Set<String> receiptCodes = <String>{
      for (final _Amount a in amounts)
        if (a.code != null) a.code!,
    };
    return ReceiptReading(
      seller: seller,
      amount: charged?.text,
      currencyCode:
          charged?.code ??
          (charged != null && charged.marker == null && receiptCodes.length == 1
              ? receiptCodes.single
              : null),
      date: keyedDate ?? firstDate,
      period: periods.length == 1 ? periods.single : null,
      amounts: List<String>.unmodifiable(amounts.map((_Amount a) => a.text)),
    );
  }

  /// Reads [text] and plans it as a one-row import under the caller's
  /// [fields], [ids] naming which field receives what. The other arguments are
  /// [ImportPlan.build]'s: a duplicate of a record the caller already has
  /// lands in [ImportPlan.duplicates], an ambiguous slash date asks a
  /// [DateOrderQuestion], and a missing amount is a row error.
  static ImportPlan plan(
    String text, {
    required List<ImportField> fields,
    required ReceiptFieldIds ids,
    required String Function(ImportCandidate candidate) keyOf,
    String? defaultCurrency,
    DateOrder? dateOrder,
    Iterable<String> existingKeys = const <String>[],
    Iterable<String>? currencyCodes,
  }) {
    final ReceiptReading r = read(text, currencyCodes: currencyCodes);
    final List<String> header = <String>[ids.seller, ids.amount];
    final List<String> row = <String>[r.seller ?? '', r.amount ?? ''];
    void add(String? id, String? value) {
      if (id == null) return;
      header.add(id);
      row.add(value ?? '');
    }

    add(ids.currency, r.currencyCode);
    add(ids.date, r.date);
    add(ids.period, r.period);
    // The header IS the ids, and an id is always a synonym of itself, so the
    // mapping below is exact — no synonym is guessed for a receipt.
    final CsvTable table = CsvTable(
      delimiter: ',',
      header: List<String>.unmodifiable(header),
      rows: <List<String>>[List<String>.unmodifiable(row)],
    );
    return ImportPlan.build(
      table,
      ColumnMapping.infer(table.header, fields),
      fields: fields,
      keyOf: keyOf,
      defaultCurrency: defaultCurrency,
      dateOrder: dateOrder,
      existingKeys: existingKeys,
    );
  }

  /// The amount charged: the last one on the strongest total line. With no
  /// total line, the one amount the receipt repeats, or none.
  static _Amount? _charged(List<_Amount> amounts) {
    final List<_Amount> ranked = amounts
        .where((_Amount a) => a.rank > 0)
        .toList();
    if (ranked.isNotEmpty) {
      final int best = ranked
          .map((_Amount a) => a.rank)
          .reduce((int a, int b) => a > b ? a : b);
      return ranked.lastWhere((_Amount a) => a.rank == best);
    }
    final List<_Amount> marked = amounts
        .where((_Amount a) => a.rank == 0 && a.marker != null)
        .toList();
    final Set<String> distinct = marked.map((_Amount a) => a.number).toSet();
    return distinct.length == 1 ? marked.last : null;
  }

  /// 2: the grand total; 1: a total or a paid line; 0: an ordinary line;
  /// -1: a subtotal, tax or discount line, whose amount is never the charge.
  static int _rankOf(String lower) {
    // `Total (incl. GST)` is the charge; `GST` alone is not.
    final String l = lower.replaceAll(_inclusive, ' ');
    if (_notCharge.hasMatch(l)) return -1;
    if (_grandTotal.hasMatch(l)) return 2;
    if (_total.hasMatch(l)) return 1;
    return 0;
  }

  static final RegExp _grandTotal = RegExp(
    r'\b(grand total|total (amount )?(paid|charged)|amount (paid|charged)|you paid)\b',
  );
  static final RegExp _total = RegExp(
    r'\b(total|paid|charged|amount due|amount|net payable|debited)\b',
  );
  static final RegExp _inclusive = RegExp(
    r'\b(incl\.?|including|inclusive of)\s+(of\s+)?(all\s+)?(taxes|tax|gst|vat)\b',
  );
  static final RegExp _notCharge = RegExp(
    r'\b(sub[ -]?total|tax|gst|vat|cgst|sgst|igst|discount|savings|you saved)\b',
  );
  static final RegExp _dateKey = RegExp(
    r'\b(date|paid|charged|billed|debited|issued|ordered|on)\b',
  );
  static final RegExp _monthly = RegExp(
    r'(\bmonthly\b|\bper month\b|\bevery month\b|\b1 month\b|/\s?mo(nth)?\b)',
  );
  static final RegExp _yearly = RegExp(
    r'(\byearly\b|\bannual(ly)?\b|\bper year\b|\bevery year\b|\b12 months\b|/\s?(yr|year)\b)',
  );
  static final RegExp _title = RegExp(
    r'^(tax )?(receipt|invoice|bill|order confirmation|payment (receipt|confirmation|successful))\b',
  );
  static final RegExp _sellerLabel = RegExp(
    r'^(?:(?:merchant|seller|store|vendor)\s*:|(?:sold by|billed by|paid to)\s*:?)\s*(.+)$',
    caseSensitive: false,
  );

  /// A number with an optional currency marker before or after it. A number
  /// followed by `%` is a rate, and one inside a longer run of digits and
  /// separators is not a separate amount.
  static final RegExp _amount = RegExp(
    r'(?<![\p{L}\d.,])'
    r'(?:(?<pre>US\$|A\$|C\$|Rs\.?|₹|₨|€|£|¥|\$|[A-Z]{3})\s?)?'
    r'(?<num>\d[\d,.]*\d|\d)'
    r'(?![\d.,]*\s?%)(?![\d\p{L}])'
    r'(?:\s?(?<post>US\$|A\$|C\$|₹|€|£|¥|\$|[A-Z]{3}(?![\p{L}])|/-))?',
    unicode: true,
  );

  static const Map<String, int> _months = <String, int>{
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6, //
    'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
  };

  static const String _monthName =
      r'(?<month>jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|'
      r'july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

  static final List<_DateShape> _dateShapes = <_DateShape>[
    // 2026-09-12
    _DateShape(
      RegExp(r'\b(\d{4})-(\d{1,2})-(\d{1,2})\b'),
      (Match m) => _iso(int.parse(m[1]!), int.parse(m[2]!), int.parse(m[3]!)),
    ),
    // 12 Sep 2026, 12-Sep-2026, 12th September, 2026
    _DateShape(
      RegExp(
        r'\b(?<day>\d{1,2})(?:st|nd|rd|th)?[\s\-]+'
        '$_monthName'
        r'\.?,?[\s\-]+(?<year>\d{4})\b',
        caseSensitive: false,
      ),
      _named,
    ),
    // Sep 12, 2026
    _DateShape(
      RegExp(
        '\\b$_monthName'
        r'\.?\s+(?<day>\d{1,2})(?:st|nd|rd|th)?,?\s+(?<year>\d{4})\b',
        caseSensitive: false,
      ),
      _named,
    ),
    // 12/09/2026 — kept as written: the plan decides, or asks, the order.
    _DateShape(
      RegExp(r'\b\d{1,2}([/.\-])\d{1,2}\1(?:\d{4}|\d{2})\b'),
      (Match m) => m[0],
    ),
  ];

  static String? _named(Match m) {
    final RegExpMatch r = m as RegExpMatch;
    final int? month =
        _months[r.namedGroup('month')!.substring(0, 3).toLowerCase()];
    if (month == null) return null;
    return _iso(
      int.parse(r.namedGroup('year')!),
      month,
      int.parse(r.namedGroup('day')!),
    );
  }

  /// `yyyy-mm-dd`, or null for a date the calendar does not have.
  static String? _iso(int year, int month, int day) {
    if (month < 1 || month > 12 || day < 1) return null;
    final DateTime d = DateTime.utc(year, month, day);
    if (d.month != month || d.day != day) return null;
    String two(int n) => n.toString().padLeft(2, '0');
    return '${d.year.toString().padLeft(4, '0')}-${two(month)}-${two(day)}';
  }
}

class _DateShape {
  const _DateShape(this.pattern, this.read);

  final RegExp pattern;
  final String? Function(Match m) read;
}

class _Amount {
  const _Amount({
    required this.text,
    required this.number,
    required this.marker,
    required this.code,
    required this.rank,
  });

  /// As the plan will read it: the number, with the marker that constrains it.
  final String text;
  final String number;

  /// The currency marker written beside it, or null for a bare number.
  final String? marker;

  /// The ISO code the marker names on its own, or null.
  final String? code;
  final int rank;

  /// Markers one currency owns. `Rs`/`₨` are the rupee family and name none,
  /// but they are KEPT in [text] so `Money.parseLocalized` refuses a
  /// non-rupee default.
  static const Map<String, String> _owned = <String, String>{
    '₹': 'INR',
    '€': 'EUR',
    r'A$': 'AUD',
    r'C$': 'CAD',
    r'US$': 'USD',
  };

  static _Amount? of(RegExpMatch m, Set<String> codes, {required int rank}) {
    final String number = m.namedGroup('num')!;
    String? marker;
    String? code;
    for (final String? raw in <String?>[
      m.namedGroup('pre'),
      m.namedGroup('post'),
    ]) {
      if (raw == null || raw == '/-') continue;
      if (RegExp(r'^[A-Z]{3}$').hasMatch(raw)) {
        if (!codes.contains(raw)) continue;
        code ??= raw;
      } else {
        code ??= _owned[raw];
      }
      marker ??= raw;
    }
    // A bare number counts only on a line that says it is a total: an
    // unmarked number elsewhere is an order id, a quantity or a phone number.
    if (marker == null && rank <= 0) return null;
    if (!RegExp(
      r'[.,]\d{1,2}$|^\d+$|^\d{1,3}([.,]\d{2,3})+$',
    ).hasMatch(number)) {
      return null;
    }
    final String text = switch (marker) {
      null => number,
      r'US$' => 'USD $number',
      final String k when RegExp(r'^[A-Z]{3}$').hasMatch(k) => '$k $number',
      final String k => '$k$number',
    };
    return _Amount(
      text: text,
      number: number,
      marker: marker,
      code: code,
      rank: rank,
    );
  }
}
