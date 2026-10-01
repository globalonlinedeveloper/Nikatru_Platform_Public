import 'column_mapping.dart';

/// A known file shape: the header another app's CSV export carries, and which
/// of the caller's [ImportField] ids each of its columns fills.
///
/// MAPPING ONLY. A preset names header texts and field ids — never another
/// app's copy, logo or wording — and it is RECOGNISED by its header, never
/// chosen by a user who has to know which app a file came from. Core ships no
/// preset of its own: which apps an app imports from, and what their columns
/// mean in that app's fields, is the app's vocabulary (the same rule that keeps
/// `ImportField` synonyms out of core).
class ColumnPreset {
  const ColumnPreset({required this.name, required this.fieldByHeader});

  /// The other app's name, for the "Recognised: …" line on the mapping step.
  final String name;

  /// Header text → the field id that column fills. Compared through
  /// [ImportField.normalise], so case, spaces and punctuation do not matter.
  /// Every key must be present in a header for the preset to be recognised.
  final Map<String, String> fieldByHeader;

  Map<String, String> get _normalised => <String, String>{
    for (final MapEntry<String, String> e in fieldByHeader.entries)
      ImportField.normalise(e.key): e.value,
  };

  /// True when every header this preset names is in [header].
  bool matches(List<String> header) {
    if (fieldByHeader.isEmpty) return false;
    final Set<String> have = header.map(ImportField.normalise).toSet();
    return _normalised.keys.every(have.contains);
  }

  /// [ColumnMapping.infer] over [header], with every column this preset names
  /// overridden to its field. Columns the preset does not name are still
  /// inferred from the fields' synonyms, so a newer export that grew a column
  /// loses nothing the synonyms already knew.
  ColumnMapping apply(List<String> header, List<ImportField> fields) {
    final Map<String, String> byHeader = _normalised;
    final Set<String> known = fields.map((ImportField f) => f.id).toSet();
    final Map<int, String?> overrides = <int, String?>{};
    for (int c = 0; c < header.length; c++) {
      final String? field = byHeader[ImportField.normalise(header[c])];
      if (field != null && known.contains(field)) overrides[c] = field;
    }
    return ColumnMapping.infer(header, fields, overrides: overrides);
  }

  /// The preset [header] belongs to, or null. When more than one matches, the
  /// one naming the most columns wins: a longer signature is the more specific
  /// claim about where the file came from.
  static ColumnPreset? recognise(
    List<String> header,
    Iterable<ColumnPreset> presets,
  ) {
    ColumnPreset? best;
    for (final ColumnPreset p in presets) {
      if (!p.matches(header)) continue;
      if (best == null || p.fieldByHeader.length > best.fieldByHeader.length) {
        best = p;
      }
    }
    return best;
  }
}
