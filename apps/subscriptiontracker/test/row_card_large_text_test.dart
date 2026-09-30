// B51 (round-2 review, ST-Y4) — RowCard's title was `maxLines: 1` at any text
// size, so at 200 % a long subscription name ellipsised to its first words.
// It adopts the chassis row's rule: two lines above 1.3× (ST-D0 D0-4).

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/features/shared/widgets.dart';

const String longName = 'Amazon Prime Video Channels Premium Family Annual';

Future<RenderParagraph> pumpRow(WidgetTester tester, double scale) async {
  await tester.binding.setSurfaceSize(const Size(360, 800));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    MaterialApp(
      theme: buildAppTheme(seed: const Color(0xFF6459F5)),
      home: MediaQuery(
        data: MediaQueryData(
          size: const Size(360, 800),
          textScaler: TextScaler.linear(scale),
        ),
        child: const Scaffold(body: RowCard(title: longName)),
      ),
    ),
  );
  return tester.renderObject<RenderParagraph>(find.text(longName));
}

void main() {
  testWidgets('at 2.0× a long subscription name wraps to two lines', (
    WidgetTester t,
  ) async {
    final RenderParagraph p = await pumpRow(t, 2);
    expect(p.maxLines, 2);
    expect(linesOf(p), 2);
  });

  testWidgets('at 1.0× it stays one line', (WidgetTester t) async {
    final RenderParagraph p = await pumpRow(t, 1);
    expect(p.maxLines, 1);
  });
}

/// The lines [p] actually laid out: the distinct tops of its text boxes.
int linesOf(RenderParagraph p) => p
    .getBoxesForSelection(
      const TextSelection(baseOffset: 0, extentOffset: longName.length),
    )
    .map((TextBox b) => b.top.round())
    .toSet()
    .length;
