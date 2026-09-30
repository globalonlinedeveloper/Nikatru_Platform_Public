// B51 (round-2 review, ST-Y4) — THE CHASSIS ROW'S TITLE WAS ONE LINE AT ANY
// TEXT SIZE. At 200 % on a 360 px phone a long subscription name ellipsised to
// its first word or two. Above 1.3× it now takes two lines (ST-D0 D0-4).

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

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
        child: const Scaffold(
          body: AppListRow(title: longName, subtitle: 'Monthly', figure: '₹649'),
        ),
      ),
    ),
  );
  return tester.renderObject<RenderParagraph>(find.text(longName));
}

void main() {
  testWidgets('at 2.0× a long title wraps to two lines', (WidgetTester t) async {
    final RenderParagraph p = await pumpRow(t, 2);
    expect(p.maxLines, 2);
    expect(linesOf(p), 2);
  });

  testWidgets('at 1.0× the row stays one line — a column of names',
      (WidgetTester t) async {
    final RenderParagraph p = await pumpRow(t, 1);
    expect(p.maxLines, 1);
  });

  test('the rule: two lines only ABOVE the threshold, never fewer than asked',
      () {
    expect(AppListRow.titleLinesFor(const TextScaler.linear(1.3), 1), 1);
    expect(AppListRow.titleLinesFor(const TextScaler.linear(1.31), 1), 2);
    expect(AppListRow.titleLinesFor(const TextScaler.linear(2), 3), 3);
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
