// ─────────────────────────────────────────────────────────────────────────────
// a11y_decision_strip_test.dart — the accessibility sweep for `DecisionStrip`
// (train ST-D0): every status, both schemes.
//
// Named `a11y_*_test.dart` on purpose: `assert-a11y-coverage.mjs` reads a
// corpus of exactly that shape, and credits a sweep to a surface only when the
// surface is CONSTRUCTED and the guideline CALLED in one `testWidgets` body.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

void main() {
  for (final Brightness b in Brightness.values) {
    for (final StatusKind k in StatusKind.values) {
      testWidgets('DecisionStrip, ${k.name}, ${b.name}', (
        WidgetTester tester,
      ) async {
        final SemanticsHandle handle = tester.ensureSemantics();
        await tester.binding.setSurfaceSize(const Size(375, 812));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        await tester.pumpWidget(
          MaterialApp(
            theme: buildAppTheme(seed: const Color(0xFF6459F5), brightness: b),
            home: Scaffold(
              body: ListView(
                padding: const EdgeInsets.all(AppSpacing.lg),
                children: <Widget>[
                  DecisionStrip(
                    kind: k,
                    message: 'Trial converts tomorrow',
                    detail: '649 a month from 1 Oct',
                    actions: <DecisionAction>[
                      DecisionAction(label: 'Keep', onPressed: () {}),
                      DecisionAction(
                        label: 'Cancel',
                        onPressed: () {},
                        primary: true,
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        handle.dispose();
      });
    }
  }
}
