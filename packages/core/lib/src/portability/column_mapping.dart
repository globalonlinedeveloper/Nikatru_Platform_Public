/// How an import cell is read into a typed value. Core stays app-agnostic:
/// an app describes its columns with these, and the plan does the parsing.
enum ImportFieldKind {
  /// Trimmed text.
  text,

  /// An amount, read by `Money.parseLocalized` in the currency named by the
  /// field's [ImportField.currencyFieldId] column, or the plan's default.
  money,

  /// An ISO 4217 code, upper-cased; three letters or it is a row error.
  currencyCode,

  /// A calendar date (ISO, or day/month order resolved by the plan).
  date,

  /// One of [ImportField.choices], matched by synonym.
  choice,
}

/// One logical column an import understands, and the header texts that name
/// it in the files people actually bring.
class ImportField {
  const ImportField(
    this.id, {
    this.synonyms = const <String>[],
    this.kind = ImportFieldKind.text,
    this.isRequired = false,
    this.currencyFieldId,
    this.choices = const <String, List<String>>{},
  });

  /// The caller's own id for the field (e.g. `next_renewal`). It is always a
  /// synonym of itself.
  final String id;

  /// Header texts that mean this field. Compared through [normalise], so
  /// `Next Renewal`, `next_renewal` and `NEXT-RENEWAL` are one synonym.
  final List<String> synonyms;

  final ImportFieldKind kind;

  /// A row whose cell for this field is empty is a row ERROR, not a candidate.
  final bool isRequired;

  /// For [ImportFieldKind.money]: the field whose cell holds the currency code.
  final String? currencyFieldId;

  /// For [ImportFieldKind.choice]: canonical value → the texts that mean it.
  final Map<String, List<String>> choices;

  /// Case-, space- and punctuation-insensitive form of a header or synonym:
  /// lower case, letters and digits only. `Price (major)` → `pricemajor`.
  static String normalise(String text) =>
      text.toLowerCase().replaceAll(RegExp(r'[^\p{L}\p{N}]', unicode: true), '');

  /// Every normalised name this field answers to, its [id] first.
  Iterable<String> get normalisedNames sync* {
    yield normalise(id);
    for (final String s in synonyms) {
      yield normalise(s);
    }
  }
}

// A READY FIELD SET IS THE APP'S, NOT CORE'S. The synonyms that read a real
// export ("Renewal date", "Billing cycle", …) are one app's vocabulary, which
// assert-no-clone-tells keeps out of shared code: the Subscription Tracker's
// set is `kSubscriptionImportFields` in its data/portability/ folder, and a
// second app declares its own the same way.

/// Which file column feeds which [ImportField], plus every column that feeds
/// none.
///
/// 🔴 AN UNKNOWN COLUMN IS KEPT AND LISTED, NEVER DROPPED: a user who sees
/// "3 columns not imported: Card, Owner, Shared" can fix the mapping; a user
/// whose columns vanished finds out when the data is gone.
class ColumnMapping {
  const ColumnMapping._(this.header, this.columnByField);

  /// Maps [header] onto [fields] by synonym: an exact normalised match first,
  /// then — for a field still unmapped — a header that STARTS with a synonym of
  /// four or more characters (`Price (INR)` → price). When two columns match
  /// one field the leftmost wins and the other stays unknown.
  ///
  /// [overrides] (column index → field id, or null to unmap) are applied last,
  /// so the caller always has the final word.
  factory ColumnMapping.infer(
    List<String> header,
    List<ImportField> fields, {
    Map<int, String?> overrides = const <int, String?>{},
  }) {
    final Map<String, int> byField = <String, int>{};
    final List<String> normalised = header.map(ImportField.normalise).toList();
    for (final ImportField f in fields) {
      final Set<String> names = f.normalisedNames.toSet();
      for (int c = 0; c < normalised.length; c++) {
        if (byField.containsValue(c)) continue;
        if (names.contains(normalised[c])) {
          byField[f.id] = c;
          break;
        }
      }
    }
    for (final ImportField f in fields) {
      if (byField.containsKey(f.id)) continue;
      final Iterable<String> prefixes =
          f.normalisedNames.where((String s) => s.length >= 4);
      for (int c = 0; c < normalised.length; c++) {
        if (byField.containsValue(c)) continue;
        if (prefixes.any(normalised[c].startsWith)) {
          byField[f.id] = c;
          break;
        }
      }
    }
    ColumnMapping m = ColumnMapping._(List<String>.unmodifiable(header), byField);
    overrides.forEach((int column, String? fieldId) {
      m = m.withOverride(column, fieldId);
    });
    return m;
  }

  /// The file's header, as read.
  final List<String> header;

  /// Field id → column index. At most one column per field.
  final Map<String, int> columnByField;

  /// The column feeding [fieldId], or null when no column does.
  int? columnOf(String fieldId) => columnByField[fieldId];

  /// The field [column] feeds, or null when it is unknown.
  String? fieldOf(int column) {
    for (final MapEntry<String, int> e in columnByField.entries) {
      if (e.value == column) return e.key;
    }
    return null;
  }

  /// Column indices that feed no field, in file order.
  List<int> get unknownColumns => <int>[
        for (int c = 0; c < header.length; c++)
          if (fieldOf(c) == null) c,
      ];

  /// The header texts of [unknownColumns] — what a mapping screen lists.
  List<String> get unknownHeaders =>
      <String>[for (final int c in unknownColumns) header[c]];

  /// A copy with [column] feeding [fieldId] (null: feeding nothing). A column
  /// that fed [fieldId] before is unmapped, since a field has one source.
  ColumnMapping withOverride(int column, String? fieldId) {
    if (column < 0 || column >= header.length) {
      throw RangeError.range(column, 0, header.length - 1, 'column');
    }
    final Map<String, int> next = Map<String, int>.of(columnByField)
      ..removeWhere((String _, int c) => c == column);
    if (fieldId != null) next[fieldId] = column;
    return ColumnMapping._(header, next);
  }
}
