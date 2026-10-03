import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart';
import 'package:nikatru_feedback/nikatru_feedback.dart';

import 'support.dart';

/// "Your privacy rights" against flutter_test's own guidelines (lane
/// dpdp-rights): 48 x 48 hit areas, a name on every control a person can
/// activate, and text contrast — the same three the chassis sweeps run.

class _NoExport implements FileExporter {
  @override
  Future<ExportOutcome> export(ExportFile file) async => ExportOutcome.failed;
}

PrivacyRightsHost _host() => PrivacyRightsHost(
  feedback: hostOver(outboxOver(FakeFeedbackTransport()), signedIn: true),
  data: const UnavailablePrivacyDataTransport(),
  accessToken: () async => 'token',
  exporter: _NoExport(),
  openDeleteAccount: () async {},
);

void main() {
  testWidgets(
    'PrivacyRightsPage meets the tap-target, label and contrast guidelines',
    (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await tester.pumpWidget(
          MaterialApp(home: PrivacyRightsPage(host: _host())),
        );
        await tester.pumpAndSettle();
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    },
  );

  testWidgets(
    'PrivacyRightPage (every right) meets the tap-target, label and contrast guidelines',
    (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        for (final PrivacyRight r in PrivacyRight.values) {
          await tester.pumpWidget(const SizedBox());
          await tester.pumpWidget(
            MaterialApp(
              home: PrivacyRightPage(host: _host(), right: r),
            ),
          );
          await tester.pumpAndSettle();
          await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
          await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
          await expectLater(tester, meetsGuideline(textContrastGuideline));
        }
      } finally {
        handle.dispose();
      }
    },
  );
}
