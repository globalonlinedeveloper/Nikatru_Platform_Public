// ─────────────────────────────────────────────────────────────────────────────
// a11y_skeleton_list_test.dart — the accessibility sweep for `SkeletonList`
// (train ST-D0), both schemes. It carries no control, so the sweep is the
// labelled-target and contrast guidelines plus its one announcement.
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
    testWidgets('SkeletonList, ${b.name}', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await tester.binding.setSurfaceSize(const Size(375, 812));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(seed: const Color(0xFF6459F5), brightness: b),
          home: const Scaffold(
            body: SkeletonList(label: 'Loading subscriptions'),
          ),
        ),
      );
      expect(find.bySemanticsLabel('Loading subscriptions'), findsOneWidget);
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });
  }
}
