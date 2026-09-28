import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// ST-X2 — a restore is refused before it touches anything, and an accepted
/// one is an id-stable merge that never deletes.
void main() {
  const String appId = 'subscriptiontracker';
  const BackupRestore restore = BackupRestore(appId: appId);

  List<Map<String, Object?>> records() => <Map<String, Object?>>[
        <String, Object?>{
          'id': 'a1',
          'name': 'Netflix',
          'price': <String, Object?>{'minor_units': 64900, 'currency': 'INR'},
          'cycle': 'monthly',
          'tags': <Object?>['video', 'family'],
        },
        <String, Object?>{
          'id': 'b2',
          'name': 'Spotify',
          'price': <String, Object?>{'minor_units': 11900, 'currency': 'INR'},
          'cycle': 'monthly',
          'tags': <Object?>[],
        },
      ];

  BackupEnvelope envelopeOf(
    List<Map<String, Object?>> rs, {
    String app = appId,
    int version = BackupEnvelope.currentVersion,
  }) =>
      BackupEnvelope(
        appId: app,
        exportedAt: DateTime.utc(2026, 9, 28),
        records: rs,
        version: version,
      );

  RestorePlan planOk(Result<RestorePlan> r) => r.fold(
        (RestorePlan p) => p,
        (Failure f) => fail('expected a plan, got $f'),
      );

  String refusal(Result<RestorePlan> r) => r.fold(
        (RestorePlan _) => fail('expected a refusal, got a plan'),
        (Failure f) => f.message,
      );

  test('export → encode → decode → restore onto the same list is IDENTITY',
      () {
    final String text = envelopeOf(records()).encode();
    final RestorePlan p = planOk(restore.planText(text, records()));
    expect(p.isIdentity, isTrue);
    expect(p.toAdd, isEmpty);
    expect(p.toUpdate, isEmpty);
    expect(p.unchanged, hasLength(2));
    expect(p.localOnly, isEmpty);
  });

  test('key order is not content: a re-ordered record is unchanged', () {
    final List<Map<String, Object?>> local = records();
    final Map<String, Object?> reordered = <String, Object?>{
      for (final String k in local.first.keys.toList().reversed)
        k: local.first[k],
    };
    final RestorePlan p =
        planOk(restore.plan(envelopeOf(<Map<String, Object?>>[reordered]), local));
    expect(p.isIdentity, isTrue);
  });

  test('another app\'s backup is refused, naming both ids', () {
    final String message = refusal(
      restore.plan(envelopeOf(records(), app: 'habittracker'), records()),
    );
    expect(message, contains('habittracker'));
    expect(message, contains(appId));
  });

  test('a version newer than this build reads is refused', () {
    final String message = refusal(
      restore.plan(
        envelopeOf(records(), version: BackupEnvelope.currentVersion + 1),
        records(),
      ),
    );
    expect(message, contains('version ${BackupEnvelope.currentVersion + 1}'));
  });

  test('the control: the current version from this app is accepted', () {
    expect(restore.plan(envelopeOf(records()), records()).isOk, isTrue);
  });

  test('a foreign format is refused, through planText too', () {
    expect(
      refusal(restore.planText('{"format":"x"}', records())),
      contains('"x"'),
    );
    expect(
      refusal(restore.plan(
        BackupEnvelope(
          appId: appId,
          exportedAt: DateTime.utc(2026),
          records: const <Map<String, Object?>>[],
          format: 'other',
        ),
        records(),
      )),
      contains('"other"'),
    );
  });

  test('a changed record is toUpdate, with both sides', () {
    final List<Map<String, Object?>> backup = records();
    backup[1] = <String, Object?>{...backup[1], 'cycle': 'yearly'};
    final RestorePlan p = planOk(restore.plan(envelopeOf(backup), records()));
    expect(p.toUpdate.single.current['id'], 'b2');
    expect(p.toUpdate.single.current['cycle'], 'monthly');
    expect(p.toUpdate.single.incoming['cycle'], 'yearly');
    expect(p.unchanged.single['id'], 'a1');
    expect(p.isIdentity, isFalse);
  });

  test('a nested change (a list element) is toUpdate too', () {
    final List<Map<String, Object?>> backup = records();
    backup[0] = <String, Object?>{
      ...backup[0],
      'tags': <Object?>['family', 'video'],
    };
    final RestorePlan p = planOk(restore.plan(envelopeOf(backup), records()));
    expect(p.toUpdate.single.incoming['id'], 'a1');
  });

  test('a new id is toAdd', () {
    final List<Map<String, Object?>> backup = records()
      ..add(<String, Object?>{'id': 'c3', 'name': 'iCloud+'});
    final RestorePlan p = planOk(restore.plan(envelopeOf(backup), records()));
    expect(p.toAdd.single['id'], 'c3');
    expect(p.unchanged, hasLength(2));
  });

  test('local-only records are KEPT, never deleted by a restore', () {
    final List<Map<String, Object?>> local = records()
      ..add(<String, Object?>{'id': 'z9', 'name': 'Added after the backup'})
      ..add(<String, Object?>{'name': 'no id at all'});
    final RestorePlan p = planOk(restore.plan(envelopeOf(records()), local));
    expect(p.isIdentity, isTrue);
    expect(
      p.localOnly.map((Map<String, Object?> r) => r['name']),
      unorderedEquals(<String>['Added after the backup', 'no id at all']),
    );
    expect(
      p.unchanged.length + p.localOnly.length,
      local.length,
      reason: 'every local record is accounted for',
    );
  });

  test('a backup record without an id, or an id twice, is refused', () {
    expect(
      refusal(restore.plan(
        envelopeOf(<Map<String, Object?>>[
          <String, Object?>{'name': 'x'},
        ]),
        records(),
      )),
      contains('no "id"'),
    );
    expect(
      refusal(restore.plan(envelopeOf(records()..addAll(records())), records())),
      contains('two records'),
    );
  });
}
