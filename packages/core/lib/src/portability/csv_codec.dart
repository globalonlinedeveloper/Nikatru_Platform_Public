import 'dart:convert';

import '../money/money.dart';

/// Writes a table as the CSV a spreadsheet opens correctly (ST-X1).
///
/// Every choice below is the one that makes the file open RIGHT in Excel,
/// Numbers and Sheets without an import dialog, because an export a user has
/// to fix by hand is an export they do not trust:
///
/// * A UTF-8 byte-order mark first. Without it Excel on Windows decodes the
///   file as the system code page and `₹`, `€` and every non-Latin name come
///   out as mojibake.
/// * CRLF after EVERY record, the last included — RFC 4180's line end, and the
///   one that no reader mistakes for part of a field.
/// * A field is quoted only when it has to be (it holds `"`, `,`, CR or LF),
///   with inner quotes doubled, so plain cells stay readable in a text editor.
/// * Every cell passes through [neutralise] first: an export is data the user
///   typed or synced, and a spreadsheet will EXECUTE a cell that starts like a
///   formula.
class CsvCodec {
  const CsvCodec();

  /// The media type a file exporter declares for [encodeBytes].
  static const String mimeType = 'text/csv';

  static const String _bom = '\uFEFF';
  static const String _eol = '\r\n';

  /// The characters a spreadsheet reads as the start of a formula (OWASP's
  /// CSV-injection list): `=`, `+`, `-`, `@`, and TAB / CR, which some
  /// importers strip before evaluating what follows.
  static const Set<String> _formulaLeads = <String>{
    '=',
    '+',
    '-',
    '@',
    '\t',
    '\r',
  };

  /// RFC 4180 text: a UTF-8 BOM (U+FEFF) first, CRLF after EVERY record (the
  /// last too), a field quoted when it contains `"`, `,`, CR or LF (inner quotes
  /// doubled), and every cell (header included) passed through [neutralise]
  /// first.
  ///
  /// Throws [ArgumentError] when a row's length differs from [header]'s: a
  /// ragged row shifts every later cell into the wrong column, and a file that
  /// opens with prices under "Name" is worse than no file.
  String encode(List<String> header, Iterable<List<String>> rows) {
    final StringBuffer out = StringBuffer(_bom);
    _writeRecord(out, header);
    int index = 0;
    for (final List<String> row in rows) {
      if (row.length != header.length) {
        throw ArgumentError.value(
          row,
          'rows[$index]',
          'has ${row.length} cells; the header has ${header.length}',
        );
      }
      _writeRecord(out, row);
      index++;
    }
    return out.toString();
  }

  /// `utf8.encode(encode(...))` — the bytes a file exporter writes.
  List<int> encodeBytes(List<String> header, Iterable<List<String>> rows) =>
      utf8.encode(encode(header, rows));

  /// CSV/formula injection: a cell that opens with `=`, `+`, `-`, `@`, a TAB or
  /// a CR gets a leading `'`. Everything else is returned unchanged.
  ///
  /// The apostrophe is the spreadsheet's own "treat as text" marker, so the
  /// cell still SHOWS what the user typed. The cost is that a negative amount
  /// exports as `'-5.00`; `CsvReader(restoreNeutralised: true)` undoes it.
  static String neutralise(String cell) {
    if (cell.isEmpty) return cell;
    return _formulaLeads.contains(cell[0]) ? "'$cell" : cell;
  }

  /// Money as TWO cells: decimal MAJOR units with the currency's minor digits
  /// and no grouping and no symbol (`Money(64900, 'INR')` → `649.00`, JPY with
  /// no minor digits → `1200`), and the ISO-4217 code. Never a formatted
  /// symbol.
  ///
  /// Why two cells and integer arithmetic: a symbol is not a currency (`$` is
  /// written for a dozen of them) and grouping is locale-specific, so a
  /// formatted `₹1,299` is text no other sheet can sum. The digits are built
  /// from [Money.minorUnits] directly rather than through a double, so no
  /// amount is ever rounded on its way out.
  static List<String> moneyCells(Money m) {
    final int digits = m.minorUnitDigits;
    final int scale = Money.pow10(digits);
    final int magnitude = m.minorUnits.abs();
    final String whole = '${magnitude ~/ scale}';
    final String sign = m.isNegative ? '-' : '';
    if (digits == 0) return <String>['$sign$whole', m.currencyCode];
    final String fraction = '${magnitude % scale}'.padLeft(digits, '0');
    return <String>['$sign$whole.$fraction', m.currencyCode];
  }

  void _writeRecord(StringBuffer out, List<String> cells) {
    for (int i = 0; i < cells.length; i++) {
      if (i > 0) out.write(',');
      out.write(_field(neutralise(cells[i])));
    }
    out.write(_eol);
  }

  static String _field(String cell) {
    final bool needsQuotes = cell.contains('"') ||
        cell.contains(',') ||
        cell.contains('\r') ||
        cell.contains('\n');
    if (!needsQuotes) return cell;
    return '"${cell.replaceAll('"', '""')}"';
  }
}
