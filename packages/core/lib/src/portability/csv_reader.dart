/// A parsed CSV file: the delimiter it used, its header record and its data
/// records, exactly as written (cells are NOT trimmed — that is the mapping's
/// and the plan's call, not the reader's).
class CsvTable {
  const CsvTable({
    required this.delimiter,
    required this.header,
    required this.rows,
    this.skippedBlankRecords = 0,
  });

  /// `,`, `;` or TAB — sniffed unless the caller named one.
  final String delimiter;

  /// The first non-blank record. Empty for an empty file.
  final List<String> header;

  /// Every data record after [header], in file order. A row may be shorter or
  /// longer than [header]: the reader reports what the file says, and the
  /// import plan decides what a ragged row means.
  final List<List<String>> rows;

  /// Records dropped because every cell was empty — a blank line, or the
  /// `,,,,` padding a spreadsheet leaves under a table. COUNTED rather than
  /// silently dropped, so a caller can say so.
  final int skippedBlankRecords;
}

/// An RFC 4180 reader that accepts what real spreadsheets write (ST-X2).
///
/// RFC 4180 describes one dialect; the files users bring are several. This
/// reads all of them the same way: quoted fields with doubled quotes, line
/// breaks INSIDE quotes (kept verbatim), CRLF, LF or a lone CR between records,
/// a leading UTF-8 BOM, and a delimiter of `,`, `;` (the European export,
/// where `,` is the decimal separator) or TAB, SNIFFED when not given.
///
/// It is lenient where refusing would lose a whole file over one cell: text
/// after a closing quote is appended to the field, and a quote in the middle
/// of an unquoted field is literal.
class CsvReader {
  /// [restoreNeutralised] undoes `CsvCodec.neutralise`: a cell that is `'`
  /// followed by `=`, `+`, `-`, `@`, TAB or CR loses the `'`. OFF by default
  /// because it cannot tell the codec's apostrophe from one a user typed —
  /// turn it on only for a file this codebase wrote, such as re-importing
  /// its own export.
  const CsvReader({this.restoreNeutralised = false});

  final bool restoreNeutralised;

  /// The delimiters [sniffDelimiter] chooses among, in tie-break order.
  static const List<String> candidateDelimiters = <String>[',', ';', '\t'];

  /// How many records the sniffer samples.
  static const int sniffSample = 10;

  /// Parses [text]. [delimiter], when given, is used as-is and not sniffed.
  CsvTable read(String text, {String? delimiter}) {
    final String body = _stripBom(text);
    final String d = delimiter ?? sniffDelimiter(body);
    final List<List<String>> records = <List<String>>[];
    int blank = 0;
    for (final List<String> record in _parse(body, d)) {
      if (record.every((String c) => c.isEmpty)) {
        blank++;
        continue;
      }
      records.add(
        restoreNeutralised ? record.map(_restore).toList() : record,
      );
    }
    if (records.isEmpty) {
      return CsvTable(
        delimiter: d,
        header: const <String>[],
        rows: const <List<String>>[],
        skippedBlankRecords: blank,
      );
    }
    return CsvTable(
      delimiter: d,
      header: records.first,
      rows: records.sublist(1),
      skippedBlankRecords: blank,
    );
  }

  /// Picks the delimiter of [text] among [candidateDelimiters].
  ///
  /// Each candidate splits the first [sniffSample] non-blank records, counting
  /// only delimiters OUTSIDE quotes (the reader itself does the split, so a
  /// quoted `"Netflix, Premium"` is one cell). A candidate that gives every
  /// sampled record the same column count, and more than one column, is
  /// consistent; the consistent one with the most columns wins. `12,99` in a
  /// `;` file splits into ragged rows under `,`, which is exactly what rules
  /// the comma out. With no consistent candidate, the widest header wins, and
  /// `,` when nothing splits at all.
  static String sniffDelimiter(String text) {
    final String body = _stripBom(text);
    String best = candidateDelimiters.first;
    int bestColumns = 1;
    bool bestConsistent = false;
    for (final String d in candidateDelimiters) {
      final List<List<String>> sample = _parse(body, d, maxRecords: sniffSample)
          .where((List<String> r) => !r.every((String c) => c.isEmpty))
          .toList();
      if (sample.isEmpty) continue;
      final int columns = sample.first.length;
      final bool consistent =
          columns > 1 && sample.every((List<String> r) => r.length == columns);
      final bool better = consistent
          ? (!bestConsistent || columns > bestColumns)
          : (!bestConsistent && columns > bestColumns);
      if (better) {
        best = d;
        bestColumns = columns;
        bestConsistent = consistent;
      }
    }
    return best;
  }

  static String _stripBom(String text) =>
      text.startsWith('\uFEFF') ? text.substring(1) : text;

  static String _restore(String cell) {
    if (cell.length < 2 || cell[0] != "'") return cell;
    const Set<String> leads = <String>{'=', '+', '-', '@', '\t', '\r'};
    return leads.contains(cell[1]) ? cell.substring(1) : cell;
  }

  /// The state machine. Returns every record, blank ones included, so the
  /// caller decides what blank means.
  static List<List<String>> _parse(
    String text,
    String delimiter, {
    int? maxRecords,
  }) {
    final List<List<String>> records = <List<String>>[];
    List<String> record = <String>[];
    final StringBuffer field = StringBuffer();
    bool inQuotes = false;
    bool fieldStarted = false;
    int i = 0;
    final int n = text.length;

    void endField() {
      record.add(field.toString());
      field.clear();
      fieldStarted = false;
    }

    void endRecord() {
      endField();
      records.add(record);
      record = <String>[];
    }

    while (i < n) {
      if (maxRecords != null && records.length >= maxRecords) return records;
      final String c = text[i];
      if (inQuotes) {
        if (c == '"') {
          if (i + 1 < n && text[i + 1] == '"') {
            field.write('"');
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field.write(c);
        i++;
        continue;
      }
      if (c == '"' && !fieldStarted) {
        inQuotes = true;
        fieldStarted = true;
        i++;
        continue;
      }
      if (c == delimiter) {
        endField();
        i++;
        continue;
      }
      if (c == '\r' || c == '\n') {
        endRecord();
        i += (c == '\r' && i + 1 < n && text[i + 1] == '\n') ? 2 : 1;
        continue;
      }
      field.write(c);
      fieldStarted = true;
      i++;
    }
    // The last record, unless the text ended on a line break (which already
    // closed it) and nothing followed.
    if (fieldStarted || field.isNotEmpty || record.isNotEmpty || inQuotes) {
      endRecord();
    }
    return records;
  }
}
