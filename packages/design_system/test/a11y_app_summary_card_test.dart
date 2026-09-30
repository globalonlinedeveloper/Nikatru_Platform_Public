// ─────────────────────────────────────────────────────────────────────────────
// a11y_app_summary_card_test.dart — the accessibility sweep for `AppSummaryCard`
// (train ST-D1), in both schemes.
//
// Named `a11y_*_test.dart` on purpose: `assert-a11y-coverage.mjs` reads a
// corpus of exactly that shape, and credits a sweep to a surface only when the
// surface is CONSTRUCTED and the guideline CALLED in one `testWidgets` body.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

Future<void> pumpAt(
  WidgetTester tester,
  Widget w, {
  required Brightness brightness,
}) async {
  await tester.binding.setSurfaceSize(const Size(375, 812));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    MaterialApp(
      theme: buildAppTheme(
        seed: const Color(0xFF6459F5),
        brightness: brightness,
      ),
      home: Scaffold(
        body: ListView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: <Widget>[w],
        ),
      ),
    ),
  );
}

void main() {
  for (final Brightness b in Brightness.values) {
    testWidgets('AppSummaryCard, ${b.name}', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pumpAt(
        tester,
        const AppSummaryCard(
          label: 'MONTHLY SPEND',
          figure: '1,234.56',
          facts: <String>['6 active', '14,815 / yr'],
          stats: <SummaryStat>[
            SummaryStat(label: 'DUE IN 7 DAYS', value: '27.48'),
            SummaryStat(label: 'DUE IN 30 DAYS', value: '1,109.90'),
          ],
        ),
        brightness: b,
      );
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });
  }
}
