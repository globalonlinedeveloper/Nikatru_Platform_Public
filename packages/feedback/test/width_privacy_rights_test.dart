import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart';
import 'package:nikatru_feedback/nikatru_feedback.dart';

import 'support.dart';

/// "Your privacy rights" at a phone and a desktop width (lane dpdp-rights):
/// the list and every right's own page. Each pump fails on any overflow, and
/// the control a person must reach stays on screen.

class _NoExport implements FileExporter {
  @override
  Future<ExportOutcome> export(ExportFile file) async => ExportOutcome.failed;
}

PrivacyRightsHost _host({required bool signedIn}) => PrivacyRightsHost(
  feedback: hostOver(outboxOver(FakeFeedbackTransport()), signedIn: signedIn),
  data: const UnavailablePrivacyDataTransport(),
  accessToken: () async => signedIn ? 'token' : null,
  exporter: _NoExport(),
  openDeleteAccount: () async {},
);

Future<void> _at(WidgetTester tester, Size size, Widget child) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(const SizedBox());
  await tester.pumpWidget(MaterialApp(home: child));
  await tester.pump();
}

void main() {
  for (final Size size in const <Size>[Size(375, 812), Size(1280, 800)]) {
    testWidgets(
      'PrivacyRightsPage at $size: no overflow, the Board reachable',
      (WidgetTester tester) async {
        await _at(tester, size, PrivacyRightsPage(host: _host(signedIn: true)));
        expect(tester.takeException(), isNull);
        await tester.ensureVisible(find.byKey(PrivacyRightsKeys.board));
        expect(
          find.byKey(PrivacyRightsKeys.board).hitTestable(),
          findsOneWidget,
        );
      },
    );

    testWidgets('PrivacyRightPage at $size, every right, signed in and out', (
      WidgetTester tester,
    ) async {
      for (final bool signedIn in <bool>[true, false]) {
        for (final PrivacyRight r in PrivacyRight.values) {
          await _at(
            tester,
            size,
            PrivacyRightPage(
              host: _host(signedIn: signedIn),
              right: r,
            ),
          );
          expect(tester.takeException(), isNull, reason: '${r.wire} $size');
        }
      }
    });
  }
}
