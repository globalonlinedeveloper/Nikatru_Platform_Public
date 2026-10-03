import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_feedback/nikatru_feedback.dart';

import 'support.dart';

/// The "Report a problem" surfaces at a phone and a desktop width (lane
/// feedback-intake): the sheet, its screenshot preview and the markup editor.
/// Each pump fails on any overflow, and the controls a person must reach stay
/// on screen.

Future<void> _at(WidgetTester tester, Size size, Widget child) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(home: child));
  await tester.pump();
}

/// A small real image to stand in for a capture.
Future<FeedbackShot> _shot(WidgetTester tester) async {
  late ui.Image image;
  await tester.runAsync(() async {
    final ui.PictureRecorder rec = ui.PictureRecorder();
    Canvas(rec).drawRect(
      const Rect.fromLTWH(0, 0, 400, 800),
      Paint()..color = const Color(0xFF336699),
    );
    image = await rec.endRecording().toImage(400, 800);
  });
  return FeedbackShot(image: image, locked: const <Rect>[], pixelRatio: 1);
}

void main() {
  testWidgets('ReportProblemPage at 375 x 812: no overflow, Send reachable', (
    WidgetTester tester,
  ) async {
    await _at(
      tester,
      const Size(375, 812),
      ReportProblemPage(host: hostOver(outboxOver(FakeFeedbackTransport()))),
    );
    expect(tester.takeException(), isNull);
    await tester.ensureVisible(find.byKey(FeedbackKeys.send));
    expect(find.byKey(FeedbackKeys.send).hitTestable(), findsOneWidget);
  });

  testWidgets('ReportProblemPage at 1280 x 800: no overflow, Send reachable', (
    WidgetTester tester,
  ) async {
    await _at(
      tester,
      const Size(1280, 800),
      ReportProblemPage(host: hostOver(outboxOver(FakeFeedbackTransport()))),
    );
    expect(tester.takeException(), isNull);
    await tester.ensureVisible(find.byKey(FeedbackKeys.send));
    expect(find.byKey(FeedbackKeys.send).hitTestable(), findsOneWidget);
  });

  testWidgets('MarkupEditorPage at 375 x 812 and 1280 x 800: no overflow', (
    WidgetTester tester,
  ) async {
    final FeedbackShot shot = await _shot(tester);
    for (final Size size in const <Size>[Size(375, 812), Size(1280, 800)]) {
      await _at(
        tester,
        size,
        MarkupEditorPage(shot: shot, initial: const <MarkupOp>[]),
      );
      expect(tester.takeException(), isNull, reason: '$size');
    }
  });

  testWidgets('ShotPreview keeps the image\'s aspect at a phone width', (
    WidgetTester tester,
  ) async {
    final FeedbackShot shot = await _shot(tester);
    await _at(
      tester,
      const Size(375, 812),
      Scaffold(
        body: Center(
          child: ShotPreview(shot: shot, ops: const <MarkupOp>[], height: 120),
        ),
      ),
    );
    expect(tester.takeException(), isNull);
    final Size drawn = tester.getSize(find.byType(ShotPreview));
    expect(drawn.height, 120);
    expect(drawn.width, closeTo(60, 0.5));
  });
}
