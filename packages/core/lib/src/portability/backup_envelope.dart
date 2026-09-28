import 'dart:convert';

import '../result.dart';

/// The JSON backup file: `{format, version, appId, exportedAt, records}`
/// (ST-X1).
///
/// The envelope exists so a restore can REFUSE before it touches anything:
/// [format] says the file is ours at all, [version] says whether this build
/// can read it, and [appId] says whose data it is — a backup from one app of
/// the portfolio restored into another would merge unrelated records by id.
/// `BackupRestore` makes those refusals; this type only carries and parses.
class BackupEnvelope {
  const BackupEnvelope({
    required this.appId,
    required this.exportedAt,
    required this.records,
    this.format = BackupEnvelope.formatId,
    this.version = BackupEnvelope.currentVersion,
  });

  /// The value of `format` in every file this codebase writes.
  static const String formatId = 'nikatru-backup';

  /// The newest envelope version this build writes and can read.
  static const int currentVersion = 1;

  /// The media type a file exporter declares for [encodeBytes].
  static const String mimeType = 'application/json';

  final String format;
  final int version;
  final String appId;

  /// When the backup was taken. Written as UTC ISO-8601 whatever zone it was
  /// constructed in, so two devices agree on the instant.
  final DateTime exportedAt;

  /// The app's own records, each a JSON object. Opaque here on purpose: core
  /// stays app-agnostic, and the restore only needs each record's `id`.
  final List<Map<String, Object?>> records;

  Map<String, Object?> toJson() => <String, Object?>{
        'format': format,
        'version': version,
        'appId': appId,
        'exportedAt': exportedAt.toUtc().toIso8601String(),
        'records': records,
      };

  /// Canonical JSON text: `jsonEncode(toJson())`. Non-ASCII stays as the
  /// characters themselves (JSON is UTF-8), not `\u` escapes.
  String encode() => jsonEncode(toJson());

  /// The UTF-8 bytes a file exporter writes.
  List<int> encodeBytes() => utf8.encode(encode());

  /// Parses [text], or an [Err] naming what is wrong: malformed JSON, a
  /// `format` other than [formatId], a missing or mistyped field, or `records`
  /// that is not a list of objects.
  ///
  /// It does NOT judge [version] or [appId] — whether this build may restore
  /// the file is `BackupRestore`'s decision, and it needs both values parsed to
  /// say so in its refusal. A leading BOM is tolerated: an editor that re-saved
  /// the file may have added one.
  static Result<BackupEnvelope> decode(String text) {
    final String body = text.startsWith('\uFEFF') ? text.substring(1) : text;
    final Object? raw;
    try {
      raw = jsonDecode(body);
    } on FormatException catch (e) {
      return Err<BackupEnvelope>(
        Failure('Not a backup file: the JSON is malformed.', cause: e),
      );
    }
    if (raw is! Map<String, Object?>) {
      return const Err<BackupEnvelope>(
        Failure('Not a backup file: the top level is not a JSON object.'),
      );
    }
    final Object? format = raw['format'];
    if (format != formatId) {
      return Err<BackupEnvelope>(
        Failure('Not a backup file: format is ${jsonEncode(format)}, '
            'expected "$formatId".'),
      );
    }
    final Object? version = raw['version'];
    if (version is! int || version < 1) {
      return Err<BackupEnvelope>(
        Failure('Backup has no valid version (got ${jsonEncode(version)}).'),
      );
    }
    final Object? appId = raw['appId'];
    if (appId is! String || appId.isEmpty) {
      return const Err<BackupEnvelope>(
        Failure('Backup has no appId, so whose data it is cannot be told.'),
      );
    }
    final Object? exportedAtRaw = raw['exportedAt'];
    final DateTime? exportedAt =
        exportedAtRaw is String ? DateTime.tryParse(exportedAtRaw) : null;
    if (exportedAt == null) {
      return Err<BackupEnvelope>(
        Failure('Backup has no valid exportedAt '
            '(got ${jsonEncode(exportedAtRaw)}).'),
      );
    }
    final Object? recordsRaw = raw['records'];
    if (recordsRaw is! List<Object?>) {
      return const Err<BackupEnvelope>(
        Failure('Backup records are missing or not a list.'),
      );
    }
    final List<Map<String, Object?>> records = <Map<String, Object?>>[];
    for (int i = 0; i < recordsRaw.length; i++) {
      final Object? r = recordsRaw[i];
      if (r is! Map<String, Object?>) {
        return Err<BackupEnvelope>(
          Failure('Backup record $i is not a JSON object.'),
        );
      }
      records.add(r);
    }
    return Ok<BackupEnvelope>(
      BackupEnvelope(
        format: formatId,
        version: version,
        appId: appId,
        exportedAt: exportedAt.toUtc(),
        records: records,
      ),
    );
  }
}
