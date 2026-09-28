import '../result.dart';
import 'backup_envelope.dart';

/// A backup record whose id already exists locally with different content:
/// [incoming] replaces [current].
class RestoreUpdate {
  const RestoreUpdate({required this.current, required this.incoming});

  final Map<String, Object?> current;
  final Map<String, Object?> incoming;
}

/// What a restore WOULD change, before it changes anything.
///
/// ID-STABLE: records are matched by id, never by position or content, so a
/// restore can neither duplicate a record it already has nor fold two distinct
/// records into one.
class RestorePlan {
  const RestorePlan({
    required this.toAdd,
    required this.toUpdate,
    required this.unchanged,
    required this.localOnly,
  });

  /// Backup records whose id is not present locally.
  final List<Map<String, Object?>> toAdd;

  /// Same id, different content.
  final List<RestoreUpdate> toUpdate;

  /// Same id, identical content — nothing to do.
  final List<Map<String, Object?>> unchanged;

  /// Local records the backup does not mention (or that carry no id).
  ///
  /// 🔴 KEPT. A restore never deletes: a backup is a snapshot of the past, and
  /// a record added since it was taken is exactly the one a user would lose.
  final List<Map<String, Object?>> localOnly;

  /// No record to add and none to change: what restoring the data that was
  /// exported, onto itself, gives (backup_restore_test.dart, IDENTITY).
  bool get isIdentity => toAdd.isEmpty && toUpdate.isEmpty;
}

/// Checks a [BackupEnvelope] is this app's and readable, then plans an
/// id-stable merge onto the records the app already holds (ST-X2).
class BackupRestore {
  const BackupRestore({required this.appId, this.idField = 'id'});

  /// The restoring app's id; a backup carrying another is refused.
  final String appId;

  /// The record key that identifies a record across devices and restores.
  final String idField;

  /// [BackupEnvelope.decode] then [plan].
  Result<RestorePlan> planText(
    String text,
    List<Map<String, Object?>> existing,
  ) {
    final Result<BackupEnvelope> decoded = BackupEnvelope.decode(text);
    return switch (decoded) {
      Ok<BackupEnvelope>(:final BackupEnvelope value) => plan(value, existing),
      Err<BackupEnvelope>(:final Failure failure) =>
        Err<RestorePlan>(failure),
    };
  }

  /// Plans restoring [envelope] onto [existing] (the app's records, as JSON
  /// maps), or an [Err] saying why it must not be restored at all.
  ///
  /// Refused, with nothing planned: a foreign [BackupEnvelope.format]; a
  /// [BackupEnvelope.version] newer than [BackupEnvelope.currentVersion] (an
  /// older build would silently drop fields it cannot name); another app's
  /// [BackupEnvelope.appId]; and a backup record with no id, or an id twice,
  /// since neither can be merged without guessing.
  Result<RestorePlan> plan(
    BackupEnvelope envelope,
    List<Map<String, Object?>> existing,
  ) {
    if (envelope.format != BackupEnvelope.formatId) {
      return Err<RestorePlan>(Failure(
        'Not a backup file: format "${envelope.format}", '
        'expected "${BackupEnvelope.formatId}".',
      ));
    }
    if (envelope.version > BackupEnvelope.currentVersion) {
      return Err<RestorePlan>(Failure(
        'This backup is version ${envelope.version}; this app reads up to '
        'version ${BackupEnvelope.currentVersion}. Update the app to restore it.',
      ));
    }
    if (envelope.appId != appId) {
      return Err<RestorePlan>(Failure(
        'This backup belongs to "${envelope.appId}", not "$appId", '
        'so it is not restored here.',
      ));
    }

    final Map<Object, Map<String, Object?>> local =
        <Object, Map<String, Object?>>{};
    final List<Map<String, Object?>> localOnly = <Map<String, Object?>>[];
    for (final Map<String, Object?> r in existing) {
      final Object? id = r[idField];
      if (id == null) {
        localOnly.add(r);
      } else {
        local[id] = r;
      }
    }

    final List<Map<String, Object?>> toAdd = <Map<String, Object?>>[];
    final List<RestoreUpdate> toUpdate = <RestoreUpdate>[];
    final List<Map<String, Object?>> unchanged = <Map<String, Object?>>[];
    final Set<Object> restored = <Object>{};
    for (int i = 0; i < envelope.records.length; i++) {
      final Map<String, Object?> incoming = envelope.records[i];
      final Object? id = incoming[idField];
      if (id == null) {
        return Err<RestorePlan>(Failure(
          'Backup record $i has no "$idField", so it cannot be matched.',
        ));
      }
      if (!restored.add(id)) {
        return Err<RestorePlan>(Failure(
          'Backup has two records with $idField "$id".',
        ));
      }
      final Map<String, Object?>? current = local[id];
      if (current == null) {
        toAdd.add(incoming);
      } else if (jsonEquals(current, incoming)) {
        unchanged.add(current);
      } else {
        toUpdate.add(RestoreUpdate(current: current, incoming: incoming));
      }
    }
    for (final MapEntry<Object, Map<String, Object?>> e in local.entries) {
      if (!restored.contains(e.key)) localOnly.add(e.value);
    }

    return Ok<RestorePlan>(RestorePlan(
      toAdd: List<Map<String, Object?>>.unmodifiable(toAdd),
      toUpdate: List<RestoreUpdate>.unmodifiable(toUpdate),
      unchanged: List<Map<String, Object?>>.unmodifiable(unchanged),
      localOnly: List<Map<String, Object?>>.unmodifiable(localOnly),
    ));
  }

  /// Deep equality over JSON values: maps by key regardless of order, lists in
  /// order, scalars by `==`. Key order is not content — a record re-serialised
  /// by another build must not read as changed.
  static bool jsonEquals(Object? a, Object? b) {
    if (a is Map && b is Map) {
      if (a.length != b.length) return false;
      for (final Object? k in a.keys) {
        if (!b.containsKey(k) || !jsonEquals(a[k], b[k])) return false;
      }
      return true;
    }
    if (a is List && b is List) {
      if (a.length != b.length) return false;
      for (int i = 0; i < a.length; i++) {
        if (!jsonEquals(a[i], b[i])) return false;
      }
      return true;
    }
    return a == b;
  }
}
