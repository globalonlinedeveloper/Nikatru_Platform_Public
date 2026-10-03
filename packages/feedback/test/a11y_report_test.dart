import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_feedback/nikatru_feedback.dart';

import 'support.dart';

/// The "Report a problem" surfaces against flutter_test's own guidelines (lane
/// feedback-intake): 48 x 48 hit areas, a name on every control a person can
/// activate, and text contrast — the same three the chassis sweeps run.

Future<FeedbackShot> _shot(WidgetTester tester) async {
  late ui.Image image;
  await tester.runAsync(() async {
    final ui.PictureRecorder rec = ui.PictureRecorder();
    Canvas(rec).drawRect(
      const Rect.fromLTWH(0, 0, 300, 600),
      Paint()..color = const Color(0xFF336699),
    );
    image = await rec.endRecording().toImage(300, 600);
  });
  return FeedbackShot(image: image, locked: const <Rect>[], pixelRatio: 1);
}


void main() {
  testWidgets(
    'ReportProblemPage meets the tap-target, label and contrast guidelines',
    (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await tester.pumpWidget(
          MaterialApp(
            home: ReportProblemPage(
              host: hostOver(outboxOver(FakeFeedbackTransport())),
            ),
          ),
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    },
  );

  testWidgets(
    'MarkupEditorPage meets the tap-target, label and contrast guidelines',
    (WidgetTester tester) async {
      final FeedbackShot shot = await _shot(tester);
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await tester.pumpWidget(
          MaterialApp(
            home: MarkupEditorPage(shot: shot, initial: const <MarkupOp>[]),
          ),
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    },
  );

  testWidgets('ShotPreview is labelled as the screenshot that will be sent', (
    WidgetTester tester,
  ) async {
    final FeedbackShot shot = await _shot(tester);
    final SemanticsHandle handle = tester.ensureSemantics();
    try {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ShotPreview(shot: shot, ops: const <MarkupOp>[], height: 120),
          ),
        ),
      );
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
    } finally {
      handle.dispose();
    }
  });
}
