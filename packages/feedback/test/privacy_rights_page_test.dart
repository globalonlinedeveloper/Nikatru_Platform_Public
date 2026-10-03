import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart';
import 'package:nikatru_feedback/nikatru_feedback.dart';

import 'support.dart';

// ─────────────────────────────────────────────────────────────────────────────
// "Your privacy rights" (lane dpdp-rights, Do 2): the red control is that a
// widget test opens EACH request type and reaches what that type does.
// ─────────────────────────────────────────────────────────────────────────────

class _FakeData implements PrivacyDataTransport {
  int exports = 0;
  PrivacyNominee? nominee;

  @override
  Future<Result<String>> exportData({required String? accessToken}) async {
    exports++;
    return const Result<String>.ok('{"schema":"nikatru.data-export/1"}');
  }

  @override
  Future<Result<PrivacyNominee?>> readNominee({
    required String? accessToken,
  }) async => Result<PrivacyNominee?>.ok(nominee);

  @override
  Future<Result<PrivacyNominee>> writeNominee({
    required String? accessToken,
    required PrivacyNominee nominee,
  }) async {
    this.nominee = nominee;
    return Result<PrivacyNominee>.ok(nominee);
  }

  @override
  Future<Result<void>> removeNominee({required String? accessToken}) async {
    nominee = null;
    return const Result<void>.ok(null);
  }
}

class _FakeExporter implements FileExporter {
  final List<ExportFile> files = <ExportFile>[];

  @override
  Future<ExportOutcome> export(ExportFile file) async {
    files.add(file);
    return ExportOutcome.exported;
  }
}

typedef _Rig = ({
  FakeFeedbackTransport transport,
  _FakeData data,
  _FakeExporter exporter,
  List<String> deletes,
  PrivacyRightsHost host,
});

_Rig _rig({required bool signedIn}) {
  final FakeFeedbackTransport t = FakeFeedbackTransport();
  final _FakeData data = _FakeData();
  final _FakeExporter exporter = _FakeExporter();
  final List<String> deletes = <String>[];
  return (
    transport: t,
    data: data,
    exporter: exporter,
    deletes: deletes,
    host: PrivacyRightsHost(
      feedback: hostOver(outboxOver(t), signedIn: signedIn),
      data: data,
      accessToken: () async => signedIn ? 'token' : null,
      exporter: exporter,
      openDeleteAccount: () async => deletes.add('open'),
    ),
  );
}

Future<void> _open(WidgetTester tester, _Rig rig, PrivacyRight r) async {
  // A fresh tree each time: a loop over the types must not open over the last one.
  await tester.pumpWidget(const SizedBox());
  await tester.pumpWidget(MaterialApp(home: PrivacyRightsPage(host: rig.host)));
  await tester.ensureVisible(find.byKey(PrivacyRightsKeys.tile(r)));
  await tester.tap(find.byKey(PrivacyRightsKeys.tile(r)));
  await tester.pumpAndSettle();
}

Future<void> _sendRequest(WidgetTester tester, {String? details}) async {
  if (details != null) {
    await tester.enterText(find.byKey(PrivacyRightsKeys.details), details);
    await tester.pump();
  }
  await tester.ensureVisible(find.byKey(PrivacyRightsKeys.send));
  await tester.tap(find.byKey(PrivacyRightsKeys.send));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('the list offers every right the server accepts, and the Board', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(home: PrivacyRightsPage(host: _rig(signedIn: true).host)),
    );
    for (final PrivacyRight r in PrivacyRight.values) {
      expect(find.byKey(PrivacyRightsKeys.tile(r)), findsOneWidget);
    }
    expect(
      PrivacyRight.values.map((PrivacyRight r) => r.wire).toList()..sort(),
      <String>[
        'access',
        'correction',
        'erasure',
        'grievance',
        'nomination',
        'withdraw-consent',
      ],
    );
    expect(find.byKey(PrivacyRightsKeys.board), findsOneWidget);
  });

  group('🔴 each request type opens and does what it says (signed in)', () {
    testWidgets('access: downloads the export through the file seam', (
      WidgetTester tester,
    ) async {
      final _Rig rig = _rig(signedIn: true);
      await _open(tester, rig, PrivacyRight.access);
      await tester.tap(find.byKey(PrivacyRightsKeys.download));
      await tester.pumpAndSettle();
      expect(rig.data.exports, 1);
      expect(rig.exporter.files.single.fileName, 'nikatru-data-export.json');
      expect(rig.exporter.files.single.mimeType, 'application/json');
    });

    testWidgets('erasure: opens the app\'s own account deletion', (
      WidgetTester tester,
    ) async {
      final _Rig rig = _rig(signedIn: true);
      await _open(tester, rig, PrivacyRight.erasure);
      await tester.tap(find.byKey(PrivacyRightsKeys.deleteAccount));
      await tester.pumpAndSettle();
      expect(rig.deletes, <String>['open']);
    });

    testWidgets('nomination: a name and an address, saved and removed', (
      WidgetTester tester,
    ) async {
      final _Rig rig = _rig(signedIn: true);
      await _open(tester, rig, PrivacyRight.nomination);
      FilledButton save() => tester.widget<FilledButton>(
        find.byKey(PrivacyRightsKeys.nomineeSave),
      );
      expect(save().onPressed, isNull);
      await tester.enterText(
        find.byKey(PrivacyRightsKeys.nomineeName),
        'Meena',
      );
      await tester.enterText(
        find.byKey(PrivacyRightsKeys.nomineeEmail),
        'meena@example.com',
      );
      await tester.pump();
      await tester.tap(find.byKey(PrivacyRightsKeys.nomineeSave));
      await tester.pumpAndSettle();
      expect(
        rig.data.nominee,
        const PrivacyNominee(name: 'Meena', email: 'meena@example.com'),
      );
      await tester.ensureVisible(find.byKey(PrivacyRightsKeys.nomineeRemove));
      await tester.tap(find.byKey(PrivacyRightsKeys.nomineeRemove));
      await tester.pumpAndSettle();
      expect(rig.data.nominee, isNull);
    });

    for (final PrivacyRight r in <PrivacyRight>[
      PrivacyRight.correction,
      PrivacyRight.grievance,
      PrivacyRight.withdrawConsent,
    ]) {
      testWidgets('${r.wire}: files a privacy-request on the intake', (
        WidgetTester tester,
      ) async {
        final _Rig rig = _rig(signedIn: true);
        await _open(tester, rig, r);
        if (r.needsDetails) {
          final FilledButton send = tester.widget<FilledButton>(
            find.byKey(PrivacyRightsKeys.send),
          );
          expect(send.onPressed, isNull, reason: '${r.wire} needs details');
        }
        await _sendRequest(tester, details: 'My billing name is spelt wrong.');
        final Map<String, Object?> body = rig.transport.received.single.report;
        expect(body['kind'], 'privacy-request');
        expect(body['requestType'], r.wire);
        expect(body['appId'], 'demo');
        expect(body.containsKey('contactEmail'), isFalse);
        expect(find.byKey(PrivacyRightsKeys.result), findsOneWidget);
      });
    }
  });

  testWidgets(
    '🔴 signed out, every type is a REQUEST that names an address, and the result says to confirm it',
    (WidgetTester tester) async {
      for (final PrivacyRight r in PrivacyRight.values) {
        final _Rig rig = _rig(signedIn: false);
        await _open(tester, rig, r);
        expect(find.byKey(PrivacyRightsKeys.download), findsNothing);
        expect(find.byKey(PrivacyRightsKeys.nomineeSave), findsNothing);
        final FilledButton send = tester.widget<FilledButton>(
          find.byKey(PrivacyRightsKeys.send),
        );
        expect(send.onPressed, isNull, reason: 'no address, no request');
        await tester.enterText(
          find.byKey(PrivacyRightsKeys.email),
          'asha@example.com',
        );
        await _sendRequest(tester, details: 'Please act on this.');
        final Map<String, Object?> body = rig.transport.received.single.report;
        expect(body['requestType'], r.wire);
        expect(body['contactEmail'], 'asha@example.com');
        expect(find.byKey(PrivacyRightsKeys.result), findsOneWidget);
      }
    },
  );
}
