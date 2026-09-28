import '../money/money.dart';
import 'column_mapping.dart';
import 'csv_reader.dart';

/// Which part of a slash date is the day. `03/04/2026` is 3 April under
/// [dayFirst] and March 4 under [monthFirst], and nothing in the cell says
/// which.
enum DateOrder { dayFirst, monthFirst }

/// Something the plan will not decide for the user. While any is open the
/// rows it affects are held in [ImportPlan.awaiting], not guessed.
sealed class ImportQuestion {
  const ImportQuestion();
}

/// "Is `03/04/2026` 3 April or March 4?" — asked when EVERY slash date in a
/// column has day and month both ≤ 12, so no value in the file settles it.
///
/// 🔴 THE ENGINE DOES NOT GUESS. A wrong guess moves every renewal in the file
/// by up to eleven months and the result looks entirely plausible. Answer by
/// building the plan again with `dateOrder:` set to one of [options].
class DateOrderQuestion extends ImportQuestion {
  const DateOrderQuestion({
    required this.fieldId,
    required this.column,
    required this.samples,
  });

  final String fieldId;
  final int column;

  /// A few of the ambiguous cells, as written, for the question's wording.
  final List<String> samples;

  List<DateOrder> get options => DateOrder.values;
}

/// One reason a row cannot be imported.
class ImportProblem {
  const ImportProblem(this.fieldId, this.reason);

  /// The field the problem is in, or null for a whole-row problem.
  final String? fieldId;
  final String reason;

  @override
  String toString() => fieldId == null ? reason : '$fieldId: $reason';
}

/// A row that will NOT be imported, with every reason, and its cells as
/// written so a screen can show the user what was refused.
class ImportRowError {
  const ImportRowError({
    required this.row,
    required this.problems,
    required this.cells,
  });

  /// 1-based data row: the first record after the header is row 1.
  final int row;
  final List<ImportProblem> problems;
  final List<String> cells;
}

/// A row that parsed cleanly: typed values by field id, plus every unknown
/// column's cell (by header), kept.
class ImportCandidate {
  const ImportCandidate({
    required this.row,
    required this.values,
    required this.extras,
  });

  /// 1-based data row: the first record after the header is row 1.
  final int row;

  /// Field id → a `String` (text, currency code, choice), a [Money] or a UTC
  /// date-only [DateTime]. A field that was empty or unmapped is absent.
  final Map<String, Object?> values;

  /// Unknown column header → cell, so nothing the user wrote is lost.
  final Map<String, String> extras;

  String? text(String fieldId) {
    final Object? v = values[fieldId];
    return v is String ? v : null;
  }

  Money? money(String fieldId) {
    final Object? v = values[fieldId];
    return v is Money ? v : null;
  }

  DateTime? date(String fieldId) {
    final Object? v = values[fieldId];
    return v is DateTime ? v : null;
  }
}

/// A clean row that is already present — in the caller's list, or earlier in
/// the same file.
class ImportDuplicate {
  const ImportDuplicate({
    required this.candidate,
    required this.key,
    this.ofRow,
  });

  final ImportCandidate candidate;
  final String key;

  /// The earlier row of the same file it repeats, or null when it matches a
  /// record the caller already has.
  final int? ofRow;
}

/// What an import WOULD do, before it does anything (ST-X2).
///
/// 🔴 NEVER A SILENT DROP. Every data row of the table ends in exactly one of
/// [candidates], [errors], [duplicates] or — only while a [questions] entry is
/// open — [awaiting], and [accountedFor] equals [rowCount] by construction. A
/// screen can therefore always say "12 to add, 2 already there, 1 refused"
/// and have the numbers add up to the file.
class ImportPlan {
  const ImportPlan._({
    required this.rowCount,
    required this.candidates,
    required this.errors,
    required this.duplicates,
    required this.awaiting,
    required this.questions,
  });

  /// Plans [table] under [mapping].
  ///
  /// * [defaultCurrency] prices a money cell whose row has no currency.
  /// * [dateOrder] answers a [DateOrderQuestion] (for every date field — a
  ///   file is written under one locale); it also overrides the order the
  ///   file's own values imply.
  /// * [existingKeys] are the caller's records under [keyOf] (build one with
  ///   [keyOn], and compute the caller's side with [keyFor] so both sides
  ///   normalise identically).
  factory ImportPlan.build(
    CsvTable table,
    ColumnMapping mapping, {
    required List<ImportField> fields,
    required String Function(ImportCandidate candidate) keyOf,
    String? defaultCurrency,
    DateOrder? dateOrder,
    Iterable<String> existingKeys = const <String>[],
  }) {
    assert(
      fields.map((ImportField f) => f.id).toSet().length == fields.length,
      'ImportField ids must be unique: a repeated id makes columnOf ambiguous',
    );
    final int width = mapping.header.length;
    String cell(List<String> row, int? column) =>
        column == null || column >= row.length ? '' : row[column].trim();

    // Column-level date decisions, made before any row is read.
    final List<ImportQuestion> questions = <ImportQuestion>[];
    final Map<String, DateOrder?> orderByField = <String, DateOrder?>{};
    for (final ImportField f in fields) {
      if (f.kind != ImportFieldKind.date) continue;
      final int? column = mapping.columnOf(f.id);
      if (column == null) continue;
      bool dayFirst = false;
      bool monthFirst = false;
      final List<String> ambiguous = <String>[];
      for (final List<String> row in table.rows) {
        final _SlashDate? s = _SlashDate.tryParse(cell(row, column));
        if (s == null) continue;
        if (s.a > 12) dayFirst = true;
        if (s.b > 12) monthFirst = true;
        if (s.a <= 12 && s.b <= 12 && ambiguous.length < 3) {
          ambiguous.add(cell(row, column));
        }
      }
      final DateOrder? decided = dateOrder ??
          (dayFirst && !monthFirst
              ? DateOrder.dayFirst
              : monthFirst && !dayFirst
                  ? DateOrder.monthFirst
                  : null);
      orderByField[f.id] = decided;
      if (decided == null && (ambiguous.isNotEmpty || dayFirst || monthFirst)) {
        questions.add(
          DateOrderQuestion(fieldId: f.id, column: column, samples: ambiguous),
        );
      }
    }

    final String Function(ImportCandidate) key = keyOf;
    final Set<String> existing = existingKeys.toSet();
    final Map<String, int> seen = <String, int>{};
    final List<ImportCandidate> candidates = <ImportCandidate>[];
    final List<ImportRowError> errors = <ImportRowError>[];
    final List<ImportDuplicate> duplicates = <ImportDuplicate>[];
    final List<int> awaiting = <int>[];

    for (int r = 0; r < table.rows.length; r++) {
      final int rowNumber = r + 1;
      final List<String> row = table.rows[r];
      final List<ImportProblem> problems = <ImportProblem>[];
      bool waits = false;
      if (row.length > width &&
          row.skip(width).any((String c) => c.trim().isNotEmpty)) {
        problems.add(ImportProblem(
          null,
          'the row has ${row.length} cells but the header has $width, '
          'so its extra cells belong to no column',
        ));
      }
      final Map<String, Object?> values = <String, Object?>{};
      // Currency codes first: a money field reads its row's code.
      for (final ImportField f in fields) {
        if (f.kind != ImportFieldKind.currencyCode) continue;
        final String raw = cell(row, mapping.columnOf(f.id));
        if (raw.isEmpty) continue;
        final String code = raw.toUpperCase();
        if (!RegExp(r'^[A-Z]{3}$').hasMatch(code)) {
          problems.add(ImportProblem(f.id, '"$raw" is not an ISO 4217 code'));
        } else {
          values[f.id] = code;
        }
      }
      for (final ImportField f in fields) {
        final int? column = mapping.columnOf(f.id);
        final String raw = cell(row, column);
        if (raw.isEmpty) {
          if (f.isRequired) {
            problems.add(ImportProblem(
              f.id,
              column == null ? 'no column is mapped to it' : 'it is empty',
            ));
          }
          continue;
        }
        switch (f.kind) {
          case ImportFieldKind.currencyCode:
            break;
          case ImportFieldKind.text:
            values[f.id] = raw;
          case ImportFieldKind.money:
            final Object? rowCode =
                f.currencyFieldId == null ? null : values[f.currencyFieldId];
            final String? code = rowCode is String ? rowCode : defaultCurrency;
            if (code == null) {
              problems.add(ImportProblem(
                f.id,
                'the row has no currency and no default was given',
              ));
              break;
            }
            final Money? m = Money.parseLocalized(raw, code);
            if (m == null) {
              problems.add(ImportProblem(f.id, '"$raw" is not an amount in $code'));
            } else {
              values[f.id] = m;
            }
          case ImportFieldKind.choice:
            final String? choice = _choose(f, raw);
            if (choice == null) {
              problems.add(ImportProblem(
                f.id,
                '"$raw" is not one of ${f.choices.keys.join(', ')}',
              ));
            } else {
              values[f.id] = choice;
            }
          case ImportFieldKind.date:
            final _SlashDate? slash = _SlashDate.tryParse(raw);
            if (slash != null) {
              final DateOrder? order = orderByField[f.id];
              if (order == null) {
                waits = true;
                break;
              }
              final DateTime? d = slash.resolve(order);
              if (d == null) {
                problems.add(ImportProblem(
                  f.id,
                  '"$raw" is not a date read ${order.name}',
                ));
              } else {
                values[f.id] = d;
              }
              break;
            }
            final DateTime? iso = _parseIso(raw);
            if (iso == null) {
              problems.add(ImportProblem(f.id, '"$raw" is not a date'));
            } else {
              values[f.id] = iso;
            }
        }
      }

      if (problems.isNotEmpty) {
        errors.add(ImportRowError(
          row: rowNumber,
          problems: problems,
          cells: List<String>.unmodifiable(row),
        ));
        continue;
      }
      if (waits) {
        awaiting.add(rowNumber);
        continue;
      }
      final ImportCandidate candidate = ImportCandidate(
        row: rowNumber,
        values: values,
        extras: _extras(mapping, row),
      );
      final String k = key(candidate);
      if (existing.contains(k)) {
        duplicates.add(ImportDuplicate(candidate: candidate, key: k));
      } else if (seen.containsKey(k)) {
        duplicates.add(
          ImportDuplicate(candidate: candidate, key: k, ofRow: seen[k]),
        );
      } else {
        seen[k] = rowNumber;
        candidates.add(candidate);
      }
    }
    return ImportPlan._(
      rowCount: table.rows.length,
      candidates: List<ImportCandidate>.unmodifiable(candidates),
      errors: List<ImportRowError>.unmodifiable(errors),
      duplicates: List<ImportDuplicate>.unmodifiable(duplicates),
      awaiting: List<int>.unmodifiable(awaiting),
      questions: List<ImportQuestion>.unmodifiable(questions),
    );
  }

  /// Data rows in the table (the header excluded).
  final int rowCount;
  final List<ImportCandidate> candidates;
  final List<ImportRowError> errors;
  final List<ImportDuplicate> duplicates;

  /// Row numbers held back by an open question. Empty once all are answered.
  final List<int> awaiting;
  final List<ImportQuestion> questions;

  /// True when nothing is held back and the plan can be applied.
  bool get isResolved => questions.isEmpty && awaiting.isEmpty;

  /// The four buckets' sizes summed — always [rowCount].
  int get accountedFor =>
      candidates.length + errors.length + duplicates.length + awaiting.length;

  /// A duplicate key over three of the caller's fields: a normalised name, a
  /// price (minor units and code) and a choice such as a billing cycle. The
  /// field ids are the caller's, so core names none of them.
  static String Function(ImportCandidate) keyOn({
    required String nameField,
    String? moneyField,
    String? choiceField,
  }) =>
      (ImportCandidate c) => keyFor(
            name: c.text(nameField) ?? '',
            price: moneyField == null ? null : c.money(moneyField),
            cycle: choiceField == null ? null : c.text(choiceField),
          );

  /// The same key, for a record the caller already has. `Netflix ` and
  /// `netflix` are one name; `649.00 INR` and `649 INR` are one price.
  static String keyFor({required String name, Money? price, String? cycle}) =>
      '${ImportField.normalise(name)}|'
      '${price == null ? '' : '${price.minorUnits} ${price.currencyCode}'}|'
      '${cycle ?? ''}';

  static String? _choose(ImportField f, String raw) {
    final String n = ImportField.normalise(raw);
    for (final MapEntry<String, List<String>> e in f.choices.entries) {
      if (ImportField.normalise(e.key) == n) return e.key;
      if (e.value.any((String s) => ImportField.normalise(s) == n)) {
        return e.key;
      }
    }
    return null;
  }

  static Map<String, String> _extras(ColumnMapping mapping, List<String> row) {
    final Map<String, String> out = <String, String>{};
    for (final int c in mapping.unknownColumns) {
      final String header = mapping.header[c].trim();
      String name = header.isEmpty ? 'column ${c + 1}' : header;
      if (out.containsKey(name)) name = '$name (column ${c + 1})';
      out[name] = c < row.length ? row[c] : '';
    }
    return out;
  }

  /// `yyyy-mm-dd` (also `/` or `.`), or a full ISO-8601 timestamp, as a UTC
  /// date-only value.
  static DateTime? _parseIso(String raw) {
    final RegExpMatch? m =
        RegExp(r'^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$').firstMatch(raw);
    if (m != null) {
      return _SlashDate._valid(
        int.parse(m.group(1)!),
        int.parse(m.group(2)!),
        int.parse(m.group(3)!),
      );
    }
    if (!RegExp(r'^\d{4}-\d{2}-\d{2}T').hasMatch(raw)) return null;
    final DateTime? t = DateTime.tryParse(raw);
    return t == null ? null : DateTime.utc(t.year, t.month, t.day);
  }
}

/// `a/b/yyyy` with `/`, `.` or `-` — the shape whose day/month order is not
/// written down. A two-digit year is 20yy.
class _SlashDate {
  const _SlashDate(this.a, this.b, this.year);

  final int a;
  final int b;
  final int year;

  static final RegExp _shape =
      RegExp(r'^(\d{1,2})([/.\-])(\d{1,2})\2(\d{4}|\d{2})$');

  static _SlashDate? tryParse(String raw) {
    final RegExpMatch? m = _shape.firstMatch(raw);
    if (m == null) return null;
    final int y = int.parse(m.group(4)!);
    return _SlashDate(
      int.parse(m.group(1)!),
      int.parse(m.group(3)!),
      m.group(4)!.length == 2 ? 2000 + y : y,
    );
  }

  DateTime? resolve(DateOrder order) => order == DateOrder.dayFirst
      ? _valid(year, b, a)
      : _valid(year, a, b);

  /// A real calendar date or null — `31/02` must not roll into March.
  static DateTime? _valid(int year, int month, int day) {
    if (month < 1 || month > 12 || day < 1) return null;
    final DateTime d = DateTime.utc(year, month, day);
    return d.month == month && d.day == day ? d : null;
  }
}
