// ─────────────────────────────────────────────────────────────────────────────
// a11y_app_fab_test.dart — the accessibility sweep for `AppFab` (train ST-D0).
//
// Named `a11y_*_test.dart` on purpose: `assert-a11y-coverage.mjs` reads a
// corpus of exactly that shape, and credits a sweep to a surface only when the
// surface is CONSTRUCTED and the guideline CALLED in one `testWidgets` body.
// Both forms (icon-only and extended), both schemes.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

void main() {
  for (final Brightness b in Brightness.values) {
    testWidgets('AppFab, icon-only and extended, ${b.name}', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await tester.binding.setSurfaceSize(const Size(375, 812));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(seed: const Color(0xFF6459F5), brightness: b),
          home: Scaffold(
            body: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  AppFab(icon: Icons.add, label: 'Add', onPressed: () {}),
                  const SizedBox(height: AppSpacing.lg),
                  AppFab(
                    icon: Icons.add,
                    label: 'Add subscription',
                    onPressed: () {},
                    extended: true,
                  ),
                ],
              ),
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
